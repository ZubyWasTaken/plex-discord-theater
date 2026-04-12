# Plex Discord Theater — Stability Fixes Design

## Problem

Users experience frequent disconnections, phantom transcode states blocking new playback, and degraded streaming quality. Root causes fall into three categories:

1. **Plex API conformance violations** — wrong HTTP methods, undocumented parameter names, out-of-range values
2. **Client-side fragility** — weak hls.js retry config, broken P2P settings, infinite WebSocket reconnect loops
3. **Server-side race conditions** — competing stop paths, missing atomic guards, fire-and-forget cleanup

## Constraint

The Plex server is shared. Two Discord servers run this bot against the same Plex instance. External Plex users also use the server directly. Session termination must only affect the exact transcode being stopped — never other bot instances' sessions or external users' sessions.

---

## Changes

### 1. Plex API Conformance (routes/plex.ts)

#### 1a. Timeline endpoint: GET → POST

The OpenAPI spec defines `POST /:/timeline`. The code calls it via `plexFetch` with no method argument (defaults to GET). The stopped-state timeline notification likely fails silently, leaving per-client state that causes 400 errors on subsequent transcode starts.

**Change:** Add `"POST"` as the fourth argument to `plexFetch` in `notifyPlexStopped`.

#### 1b. Query parameter: `session` → `transcodeSessionId`

The OpenAPI spec defines the transcode session parameter as `transcodeSessionId`. The code uses `session`. While Plex may accept both today, this is undocumented behavior.

**Change:** Replace `session: sessionId` with `transcodeSessionId: sessionId` in:
- Decision call params
- Start call params (`startParams`)
- Ping endpoint
- Stop calls in both plex.ts and sync.ts

#### 1c. Bitrate parameters: `maxVideoBitrate` → `videoBitrate` + `peakBitrate`

`maxVideoBitrate` does not exist in the spec. The correct parameters are `videoBitrate` (target, kbps) and `peakBitrate` (ABR upper bound, kbps).

**Change:** Replace `maxVideoBitrate: "8000"` with `videoBitrate: "4000"` and `peakBitrate: "8000"`.

Lower default target to 4Mbps to accommodate 100Mb/s upload shared across viewers. ABR can scale up to 8Mbps peak when bandwidth allows.

#### 1d. videoQuality: 100 → 99

Spec defines maximum as 99.

**Change:** `videoQuality: "100"` → `videoQuality: "99"`.

#### 1e. Add missing ABR and location parameters

The spec supports `autoAdjustQuality` (enables adaptive bitrate) and `location` (helps Plex determine bandwidth constraints). Neither is sent.

**Change:** Add to transcode params:
```
autoAdjustQuality: "1"
location: "wan"
```

### 2. Session Termination Safety (routes/plex.ts)

#### 2a. Add `terminatePlexSession` function

New function that safely terminates a specific Plex session:

1. Takes the `plexKey` we're stopping
2. Queries `GET /status/sessions` to get all active sessions
3. Finds the session where `TranscodeSession.key` matches our exact `plexKey`
4. Verifies `Player.machineIdentifier` starts with `"plex-discord-theater"`
5. Verifies `plexKey` exists in our `allKnownPlexKeys` map (we allocated it)
6. Only then calls `POST /status/sessions/terminate` with that specific `Session.id`

Triple safety: exact key match + our client identifier + our allocation map.

#### 2b. Integrate into stop flow

After the existing undocumented stop call (which kills the ffmpeg process) and the timeline POST (which clears per-client state), also call `terminatePlexSession` to formally terminate the session in Plex's session registry.

### 3. Stop Race Condition Guard (routes/plex.ts, services/sync.ts)

#### 3a. Add atomic `stoppingSessions` Set

A module-level `Set<string>` in plex.ts tracks sessions currently being stopped. Exported via a `isSessionStopping` check function.

#### 3b. Guard both stop paths

- HTTP DELETE handler: check `stoppingSessions`, skip if already stopping
- `killPlexTranscode` in sync.ts: check `isSessionStopping`, skip if already stopping
- Both paths: add to set on entry, remove in finally block

### 4. Plex Key Extraction Failure → Fatal (routes/plex.ts)

Currently a `console.warn` that lets the session continue broken. Without the key, ping sends the wrong ID (transcode dies), stop creates phantom state, and segment blocking doesn't work.

**Change:** If regex fails to extract the Plex key from the manifest, attempt to stop whatever we started, then throw an error (returns 502 to client). The client will see a playback error and can retry.

### 5. Await notifyPlexStopped in DELETE (routes/plex.ts)

Currently fire-and-forget in the HTTP DELETE path (`catch(() => {})`). The WebSocket path correctly awaits it. If the next transcode start races ahead before timeline processes, phantom 400.

**Change:** `await notifyPlexStopped(ratingKey, sessionId)` in the DELETE handler's finally block.

### 6. Segment Fetch Timeout (routes/plex.ts, services/plex.ts)

Segment requests use `plexFetch` with 15s timeout. HLS segments are requested constantly — a 15s hang per segment drains the viewer's buffer.

**Change:** Add `plexFetchSegment` function with 8s timeout. Use it in the `/hls/seg` handler.

### 7. WebSocket Reconnect Auth Handling (hooks/useSync.ts)

When the server restarts, in-memory sessions are lost. The WebSocket reconnects with a stale token, server rejects with close code 1008, triggering another reconnect — infinite loop. User sees "Host disconnected" forever.

**Changes:**
- Detect close code 1008 specifically — this means auth failure, not network drop
- On auth failure: set an `authFailed` state instead of retrying. Surface a user-visible message ("Session expired — please restart the activity")
- Add max reconnect cap of 20 attempts for non-auth disconnects, then surface error
- Reset retry counter on successful reconnect (already done)

### 8. hls.js Retry Configuration (components/Player.tsx)

Default hls.js config only retries manifest loading once. For a proxied HLS setup, this is too aggressive.

**Change:** Add to Hls constructor config:
```
manifestLoadingMaxRetry: 4
manifestLoadingRetryDelay: 1000
manifestLoadingMaxRetryTimeout: 30000
levelLoadingMaxRetry: 6
levelLoadingRetryDelay: 1000
fragLoadingMaxRetry: 8
fragLoadingRetryDelay: 1000
fragLoadingMaxRetryTimeout: 30000
startFragPrefetch: true
```

### 9. P2P Configuration Fix (components/Player.tsx)

`p2pDownloadTimeWindow: 8000` is 8000 seconds (2+ hours). `httpDownloadTimeWindow: 2000` is 2000 seconds (33 minutes). These should be small values in seconds.

**Change:**
```
highDemandTimeWindow: 15      (was 8)
p2pDownloadTimeWindow: 30     (was 8000)
httpDownloadTimeWindow: 6     (was 2000)
simultaneousP2PDownloads: 3   (was 5)
simultaneousHttpDownloads: 2  (was 1)
```

Also add basic STUN config for WebRTC NAT traversal:
```
rtcConfig: {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
}
```

### 10. Rate Limiter Per-IP (index.ts)

The HLS rate limiter is global: 3000 req/15min across ALL viewers. With 15 viewers this gets hit.

**Change:** Add `keyGenerator` to use request IP:
```typescript
keyGenerator: (req) => req.ip || req.socket.remoteAddress || "unknown"
```

### 11. Shutdown Timeout (index.ts)

5 seconds isn't enough to stop multiple active transcodes (each needs stop + timeline POST + terminate, with 15s Plex timeout).

**Change:** `5000` → `15000` ms.

### 12. Server-Side Ping (services/sync.ts)

Currently only the host client pings to keep the transcode alive. If the host's network drops briefly, pings stop and Plex kills the transcode. Viewers can't keep it alive.

**Change:** Add a server-side ping interval per room. When a room has an active `hlsSessionId`, the server pings Plex every 30s directly — independent of any client. Clear the interval when the room's session ends.

This is more reliable than client pings because the server→Plex connection is stable (same machine or LAN), while client→server crosses the internet.

### 13. Heartbeat Drift Improvements (components/Player.tsx, services/sync.ts)

#### 13a. Include timestamp in state messages

Add `lastCommandAt` timestamp to the `state` message sent on join. Viewers can detect if the state is stale (e.g., host paused while viewer was disconnected but interpolation kept advancing).

#### 13b. Reduce heartbeat drift threshold

`HEARTBEAT_DRIFT_THRESHOLD_S: 5` → `3`. Combined with the 5s heartbeat interval, this means max 8s of drift before correction instead of 10s.

### 14. Session Persistence in SQLite (middleware/auth.ts)

In-memory sessions are lost on restart. Since `better-sqlite3` is already a dependency (used for thumb-cache), add session persistence.

**Changes:**
- Create a `sessions` table: `token TEXT PRIMARY KEY, user_id TEXT, created_at INTEGER`
- On `createSession`: INSERT into SQLite
- On `isValidSession`/`getSessionUserId`: check SQLite if not in memory Map (lazy load)
- On cleanup interval: DELETE expired rows
- Keep the in-memory Map as a hot cache — SQLite is the durable fallback

Also persist `instanceHosts` map to a second table so host/viewer roles survive restart:
- `instances` table: `instance_id TEXT PRIMARY KEY, host_user_id TEXT, guild_id TEXT, created_at INTEGER`

---

## Files Changed

| File | Changes |
|------|---------|
| `packages/server/src/routes/plex.ts` | API conformance (1a-1e), terminate safety (2a-2b), race guard (3a-3b), key extraction fatal (4), await notifyPlexStopped (5), segment timeout (6) |
| `packages/server/src/services/plex.ts` | Add `plexFetchSegment` with 8s timeout |
| `packages/server/src/services/sync.ts` | Race guard check (3b), server-side ping (12), state timestamp (13a) |
| `packages/server/src/middleware/auth.ts` | SQLite session persistence (14) |
| `packages/server/src/routes/discord.ts` | SQLite instance persistence (14) |
| `packages/server/src/index.ts` | Rate limiter per-IP (10), shutdown timeout (11) |
| `packages/client/src/hooks/useSync.ts` | Auth failure detection (7), max retries |
| `packages/client/src/components/Player.tsx` | hls.js config (8), P2P config (9), drift threshold (13b) |

## Testing

- Verify timeline POST clears per-client state (no more 400 on second play)
- Verify `terminatePlexSession` only terminates the exact matching session
- Verify stopping in one Discord server doesn't affect the other
- Verify WebSocket reconnect surfaces auth error instead of looping
- Verify hls.js recovers from transient network errors without fatal
- Verify P2P peers discover each other (check tracker logs)
- Verify sessions survive server restart (SQLite persistence)
- Verify rate limiter doesn't block legitimate traffic at 15 viewers
