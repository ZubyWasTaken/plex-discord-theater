# Stability Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 14 stability issues — Plex API conformance, race conditions, client resilience, session persistence — so users stop experiencing disconnections and phantom transcode states.

**Architecture:** Server-side Plex API calls are corrected to match the OpenAPI spec (POST timeline, correct param names, valid ranges). A stop-race guard prevents competing stop paths from creating phantom state. Client-side hls.js and P2P configs are fixed. Sessions are persisted in SQLite (already a dependency) so restarts don't lose state.

**Tech Stack:** Node.js/Express/TypeScript server, React client, better-sqlite3, hls.js, p2p-media-loader-hlsjs, ws (WebSocket)

**Note:** This project has no test infrastructure. Steps include manual verification commands and expected console output where applicable.

---

### Task 1: Plex API Conformance — Transcode Parameters

Fixes spec items 1a–1e: timeline POST, `session` → `transcodeSessionId`, bitrate params, videoQuality, ABR/location.

**Files:**
- Modify: `packages/server/src/routes/plex.ts:515-540` (notifyPlexStopped)
- Modify: `packages/server/src/routes/plex.ts:726-784` (transcode params, decision, start)
- Modify: `packages/server/src/routes/plex.ts:808-813` (retry decision)
- Modify: `packages/server/src/routes/plex.ts:960-968` (ping)
- Modify: `packages/server/src/routes/plex.ts:998-1008` (DELETE stop)
- Modify: `packages/server/src/routes/plex.ts:1065-1070` (bulk kill)
- Modify: `packages/server/src/routes/plex.ts:1205-1218` (shutdown stop)
- Modify: `packages/server/src/services/sync.ts:27-30` (killPlexTranscode stop call)

- [ ] **Step 1: Fix timeline to POST in `notifyPlexStopped`**

In `packages/server/src/routes/plex.ts`, find `notifyPlexStopped` (line ~520). Change the `plexFetch` call to use POST:

```typescript
export async function notifyPlexStopped(ratingKey: string | null, sessionId: string): Promise<void> {
  const effectiveRatingKey = ratingKey || sessionRatingKeys.get(sessionId) || "0";
  const duration = mediaDurations.get(effectiveRatingKey);
  try {
    const res = await plexFetch(
      "/:/timeline",
      {
        ratingKey: effectiveRatingKey,
        key: `/library/metadata/${effectiveRatingKey}`,
        state: "stopped",
        time: "0",
        duration: duration ? String(duration) : "0",
        identifier: "com.plexapp.plugins.library",
      },
      {
        "X-Plex-Session-Identifier": sessionId,
        "X-Plex-Client-Identifier": OUR_CLIENT_ID,
      },
      "POST",
    );
    console.log("[HLS] Timeline stopped for session:", sessionId.substring(0, 8),
      "ratingKey:", effectiveRatingKey, "→", res.status);
  } catch (err) {
    console.log("[HLS] Timeline stopped failed (non-fatal):", err);
  }
}
```

- [ ] **Step 2: Fix transcode params block**

In the `fetchManifest` function (line ~726), replace the params object:

```typescript
      const params: Record<string, string> = {
        hasMDE: "1",
        path: `/library/metadata/${ratingKey}`,
        mediaIndex: "0",
        partIndex: "0",
        protocol: "hls",
        fastSeek: "1",
        directPlay: "0",
        directStream: "0",
        directStreamAudio: "1",
        videoResolution: "1280x720",
        videoBitrate: "4000",
        peakBitrate: "8000",
        videoQuality: "99",
        autoAdjustQuality: "1",
        location: "wan",
        mediaBufferSize: "102400",
        subtitles: subtitleMode,
      };
```

- [ ] **Step 3: Fix `session` → `transcodeSessionId` in decision and start calls**

In the same `fetchManifest` function, replace `session: sessionId` with `transcodeSessionId: sessionId` in three places:

Decision call (~line 763):
```typescript
        const decisionRes = await plexFetch(decisionPath, { ...params, transcodeSessionId: sessionId }, hlsHeaders);
```

Start params (~line 783):
```typescript
      const startParams = { ...params, transcodeSessionId: sessionId };
```

Retry decision (~line 810):
```typescript
            const retryDecision = await plexFetch(decisionPath, { ...params, transcodeSessionId: sessionId }, hlsHeaders);
```

- [ ] **Step 4: Fix `session` → `transcodeSessionId` in ping endpoint**

In the ping handler (~line 962):
```typescript
    await plexFetch(
      "/video/:/transcode/universal/ping",
      { transcodeSessionId: plexKey },
      {
        "X-Plex-Session-Identifier": plexKey,
        "X-Plex-Client-Identifier": getSessionClientId(sessionId),
      },
    );
```

- [ ] **Step 5: Fix `session` → `transcodeSessionId` in all stop calls**

DELETE handler (~line 1002):
```typescript
          { transcodeSessionId: plexKey },
```

Bulk kill in `/hls/sessions` (~line 1067):
```typescript
          const stopRes = await plexFetch(`/video/:/transcode/universal/stop`, { transcodeSessionId: key }, {
```

Shutdown `stopAllActiveSessions` (~line 1212):
```typescript
        { transcodeSessionId: plexKey },
```

`flushStaleTranscodes` — three stop calls (~lines 583, 600, 638):
```typescript
            { transcodeSessionId: key },
```
```typescript
              { transcodeSessionId: sessionKey },
```
```typescript
            { transcodeSessionId: t.key },
```

- [ ] **Step 6: Fix `session` → `transcodeSessionId` in sync.ts killPlexTranscode**

In `packages/server/src/services/sync.ts` (~line 29):
```typescript
      { transcodeSessionId: stopKey },
```

- [ ] **Step 7: Verify build compiles**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`
Expected: Clean compile, no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/routes/plex.ts packages/server/src/services/sync.ts
git commit -m "fix: correct Plex API conformance — POST timeline, transcodeSessionId param, ABR params"
```

---

### Task 2: Segment Fetch Timeout

Adds a shorter 8s timeout for segment proxy requests instead of the 15s general timeout.

**Files:**
- Modify: `packages/server/src/services/plex.ts` (add `plexFetchSegment`)
- Modify: `packages/server/src/routes/plex.ts:896-897` (use it in seg handler)

- [ ] **Step 1: Add `plexFetchSegment` to plex.ts service**

In `packages/server/src/services/plex.ts`, add after the existing `plexFetch` function:

```typescript
const PLEX_SEGMENT_TIMEOUT_MS = 8_000;

export async function plexFetchSegment(
  path: string,
  params?: Record<string, string>,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLEX_SEGMENT_TIMEOUT_MS);
  try {
    return await fetch(plexUrl(path, params), {
      headers: PLEX_HEADERS,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Import and use in segment proxy handler**

In `packages/server/src/routes/plex.ts`, update the import at line 2:
```typescript
import { plexFetch, plexJSON, plexUrl, plexFetchSegment } from "../services/plex.js";
```

In the `/hls/seg` handler (~line 896), replace:
```typescript
    const plexRes = await plexFetch(segPath);
```
with:
```typescript
    const plexRes = await plexFetchSegment(segPath);
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/plex.ts packages/server/src/routes/plex.ts
git commit -m "fix: add 8s segment fetch timeout to prevent viewer hangs"
```

---

### Task 3: Stop Race Condition Guard

Prevents the WebSocket `stop` and HTTP `DELETE` from both sending Plex stop calls, which creates phantom state.

**Files:**
- Modify: `packages/server/src/routes/plex.ts` (add `stoppingSessions` Set + `isSessionStopping` export)
- Modify: `packages/server/src/routes/plex.ts:981-1030` (guard DELETE handler)
- Modify: `packages/server/src/services/sync.ts:17-50` (guard `killPlexTranscode`)

- [ ] **Step 1: Add `stoppingSessions` guard to plex.ts**

In `packages/server/src/routes/plex.ts`, after the `activeTranscodeKeys` Set (~line 483), add:

```typescript
/**
 * Sessions currently being stopped. Prevents the WebSocket stop handler and
 * HTTP DELETE handler from racing to send duplicate stop calls to Plex,
 * which creates phantom per-client state blocking new transcodes.
 */
const stoppingSessions = new Set<string>();

/** Check if a session is already being stopped (used by sync.ts). */
export function isSessionStopping(sessionId: string): boolean {
  return stoppingSessions.has(sessionId);
}

/** Mark a session as currently stopping (used by sync.ts). */
export function markSessionStopping(sessionId: string): void {
  stoppingSessions.add(sessionId);
}

/** Clear the stopping flag for a session (used by sync.ts). */
export function clearSessionStopping(sessionId: string): void {
  stoppingSessions.delete(sessionId);
}
```

- [ ] **Step 2: Guard the HTTP DELETE handler**

In the DELETE `/hls/session/:sessionId` handler (~line 981), add the guard at the top of the handler body (after the UUID validation):

```typescript
    // Race guard — if sync.ts is already stopping this session, skip
    if (stoppingSessions.has(sessionId)) {
      if (DEBUG) console.log("[HLS] Stop session", sessionId.substring(0, 8), "(already stopping via sync)");
      res.json({ ok: true });
      return;
    }
    stoppingSessions.add(sessionId);
```

Then wrap the existing stop logic in a try/finally to ensure cleanup:

After `stoppingSessions.add(sessionId);`, change the rest of the handler to be inside try/finally. The `finally` block should remove from the set:

At the very end of the handler (before the closing `}`), add the finally:

Replace the entire handler body (after UUID validation) with:

```typescript
    if (stoppingSessions.has(sessionId)) {
      if (DEBUG) console.log("[HLS] Stop session", sessionId.substring(0, 8), "(already stopping via sync)");
      res.json({ ok: true });
      return;
    }
    stoppingSessions.add(sessionId);

    try {
      // Clear cached manifest
      manifestCache.delete(sessionId);
      const ratingKey = sessionRatingKeys.get(sessionId) || null;
      const plexKey = plexTranscodeKeys.get(sessionId);

      if (plexKey) {
        try {
          const stopRes = await plexFetch(
            "/video/:/transcode/universal/stop",
            { transcodeSessionId: plexKey },
            {
              "X-Plex-Session-Identifier": plexKey,
              "X-Plex-Client-Identifier": OUR_CLIENT_ID,
            },
          );
          console.log("[HLS] Stop session", sessionId.substring(0, 8),
            `(plex key: ${plexKey.substring(0, 8)})`, "→", stopRes.status);
        } catch (err) {
          console.error("Stop session error:", err);
          res.status(502).json({ error: "Stop failed" });
          return;
        } finally {
          activeTranscodeKeys.delete(plexKey);
          plexTranscodeKeys.delete(sessionId);
          sessionRatingKeys.delete(sessionId);
          await notifyPlexStopped(ratingKey, sessionId);
        }
      } else {
        sessionRatingKeys.delete(sessionId);
        if (DEBUG) console.log("[HLS] Stop session", sessionId.substring(0, 8),
          "(already stopped via sync)");
      }

      res.json({ ok: true });
    } finally {
      stoppingSessions.delete(sessionId);
    }
```

- [ ] **Step 3: Guard `killPlexTranscode` in sync.ts**

In `packages/server/src/services/sync.ts`, update the import (~line 6):
```typescript
import { getPlexTranscodeKey, getSessionClientId, getSessionRatingKey, markTranscodeStopped, notifyPlexStopped, isSessionStopping, markSessionStopping, clearSessionStopping, terminatePlexSession } from "../routes/plex.js";
```

Also add the `plexFetch` import since the rewritten function calls it directly:
```typescript
import { plexFetch } from "./plex.js";
```

Then replace the entire `killPlexTranscode` function (~line 17) with a version that both checks AND marks the set:

```typescript
async function killPlexTranscode(hlsSessionId: string | null): Promise<void> {
  if (!hlsSessionId) return;

  // Race guard — if HTTP DELETE is already stopping this session, skip
  if (isSessionStopping(hlsSessionId)) {
    console.log("[Sync] Stop skipped for", hlsSessionId.substring(0, 8), "(already stopping via HTTP)");
    return;
  }

  // Mark as stopping so HTTP DELETE doesn't also fire
  markSessionStopping(hlsSessionId);

  try {
    const plexKey = getPlexTranscodeKey(hlsSessionId);
    const clientId = getSessionClientId(hlsSessionId);
    const ratingKey = getSessionRatingKey(hlsSessionId) || null;
    const stopKey = plexKey || hlsSessionId;

    try {
      const res = await plexFetch(
        "/video/:/transcode/universal/stop",
        { transcodeSessionId: stopKey },
        {
          "X-Plex-Session-Identifier": stopKey,
          "X-Plex-Client-Identifier": clientId,
        },
      );
      console.log("[Sync] Stop transcode", stopKey.substring(0, 8),
        plexKey ? "(mapped plex key)" : "(our UUID, no mapping)",
        "→", res.status);
    } catch (err) {
      console.error("[Sync] Stop transcode error:", err);
    }

    markTranscodeStopped(hlsSessionId);
    await notifyPlexStopped(ratingKey, hlsSessionId);

    if (plexKey) {
      await terminatePlexSession(plexKey);
    }
  } finally {
    clearSessionStopping(hlsSessionId);
  }
}
```

This requires updating the import and adding two more exports from plex.ts.

- [ ] **Step 4: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/plex.ts packages/server/src/services/sync.ts
git commit -m "fix: add stop race condition guard preventing duplicate Plex stop calls"
```

---

### Task 4: Plex Key Extraction Failure → Fatal

Makes manifest key extraction failure abort the session instead of silently continuing broken.

**Files:**
- Modify: `packages/server/src/routes/plex.ts:828-838` (key extraction block)

- [ ] **Step 1: Change key extraction failure from warn to fatal**

In `fetchManifest` inside the master.m3u8 handler (~line 828), replace the else branch:

```typescript
      const plexKeyMatch = m3u8.match(PLEX_SESSION_KEY_RE);
      if (plexKeyMatch) {
        plexTranscodeKeys.set(sessionId, plexKeyMatch[1]);
        sessionRatingKeys.set(sessionId, ratingKey);
        activeTranscodeKeys.add(plexKeyMatch[1]);
        allKnownPlexKeys.set(plexKeyMatch[1], Date.now());
        console.log("[HLS] Plex transcode key:", plexKeyMatch[1].substring(0, 8), "for session:", sessionId.substring(0, 8));
      } else {
        console.error("[HLS] FATAL: Could not extract Plex transcode key from manifest for session:",
          sessionId.substring(0, 8), "— aborting session to prevent phantom state");
        // Attempt to stop whatever we started — use our sessionId since we don't have the Plex key
        try {
          await plexFetch(
            "/video/:/transcode/universal/stop",
            { transcodeSessionId: sessionId },
            { "X-Plex-Session-Identifier": sessionId, "X-Plex-Client-Identifier": OUR_CLIENT_ID },
          );
        } catch {}
        await notifyPlexStopped(ratingKey, sessionId);
        throw new Error("Could not extract Plex transcode key from manifest");
      }
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/plex.ts
git commit -m "fix: abort session on Plex key extraction failure to prevent phantom state"
```

---

### Task 5: Session Termination Safety + Await notifyPlexStopped

Adds the official `POST /status/sessions/terminate` endpoint with triple safety, and fixes the fire-and-forget `notifyPlexStopped` in the DELETE handler.

**Files:**
- Modify: `packages/server/src/routes/plex.ts` (add `terminatePlexSession`, update stop flows)

- [ ] **Step 1: Add `terminatePlexSession` function**

In `packages/server/src/routes/plex.ts`, add after the `notifyPlexStopped` function (~line 540):

```typescript
/**
 * Safely terminate a specific Plex session using the official API.
 * Triple safety:
 * 1. Matches TranscodeSession.key against our exact plexKey
 * 2. Verifies Player.machineIdentifier is ours
 * 3. Verifies plexKey exists in our allKnownPlexKeys map
 * This ensures we never terminate another bot instance's or external user's session.
 */
async function terminatePlexSession(plexKey: string): Promise<void> {
  if (!allKnownPlexKeys.has(plexKey)) {
    if (DEBUG) console.log("[HLS] Terminate skipped — plexKey not in allKnownPlexKeys:", plexKey.substring(0, 8));
    return;
  }

  try {
    const data = await plexJSON<{
      MediaContainer: {
        Metadata?: Array<{
          Player?: { machineIdentifier?: string };
          TranscodeSession?: { key?: string };
          Session?: { id?: string };
        }>;
      };
    }>("/status/sessions");

    const sessions = data.MediaContainer.Metadata || [];
    for (const s of sessions) {
      const transcodeKey = s.TranscodeSession?.key;
      // Extract UUID from key path like "/transcode/sessions/<uuid>"
      const keyUuid = transcodeKey?.split("/").pop();

      if (keyUuid !== plexKey) continue;
      if (!s.Player?.machineIdentifier?.startsWith("plex-discord-theater")) continue;

      const sessionId = s.Session?.id;
      if (!sessionId) continue;

      console.log("[HLS] Terminating Plex session:", sessionId, "for transcode key:", plexKey.substring(0, 8));
      await plexFetch(
        "/status/sessions/terminate",
        { sessionId, reason: "Playback ended" },
        undefined,
        "POST",
      );
      return;
    }

    if (DEBUG) console.log("[HLS] No matching Plex session found for terminate:", plexKey.substring(0, 8));
  } catch (err) {
    // Non-fatal — the undocumented stop + timeline POST are the primary cleanup
    console.log("[HLS] Terminate session failed (non-fatal):", err);
  }
}
```

- [ ] **Step 2: Integrate `terminatePlexSession` into the stop flows**

In `notifyPlexStopped`, add the terminate call at the end (before the catch). The updated function becomes:

Actually, better to call it separately in the stop flows. Add it to the DELETE handler's finally block. In the DELETE handler's `finally` for the `if (plexKey)` branch (from Task 3), after `await notifyPlexStopped(ratingKey, sessionId);`, add:
```typescript
          await terminatePlexSession(plexKey);
```

In `killPlexTranscode` in `packages/server/src/services/sync.ts`, we need access to the terminate function. Export it from plex.ts:

Add to the export in plex.ts:
```typescript
export { terminatePlexSession };
```

The `terminatePlexSession` call and sync.ts import update are already handled in Task 3's rewritten `killPlexTranscode` function — no additional sync.ts changes needed here.

In `stopAllActiveSessions` in plex.ts, add after the `notifyPlexStopped` call:
```typescript
    await terminatePlexSession(plexKey).catch(() => {});
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/plex.ts packages/server/src/services/sync.ts
git commit -m "fix: add safe session termination via official Plex API with triple safety guard"
```

---

### Task 6: Server-Side Ping

Moves ping responsibility from the client to the server so transcode stays alive regardless of client network quality.

**Files:**
- Modify: `packages/server/src/services/sync.ts` (add room-level ping interval)
- Modify: `packages/server/src/routes/plex.ts` (export ping helper)

- [ ] **Step 1: Export a server-side ping helper from plex.ts**

In `packages/server/src/routes/plex.ts`, add after `terminatePlexSession`:

```typescript
/** Ping Plex to keep a transcode session alive. Called server-side per room. */
export async function pingPlexTranscode(hlsSessionId: string): Promise<void> {
  const plexKey = plexTranscodeKeys.get(hlsSessionId) ?? hlsSessionId;
  try {
    await plexFetch(
      "/video/:/transcode/universal/ping",
      { transcodeSessionId: plexKey },
      {
        "X-Plex-Session-Identifier": plexKey,
        "X-Plex-Client-Identifier": OUR_CLIENT_ID,
      },
    );
  } catch (err) {
    console.error("[HLS] Server-side ping failed for", hlsSessionId.substring(0, 8), err);
  }
}
```

- [ ] **Step 2: Add room-level ping interval in sync.ts**

In `packages/server/src/services/sync.ts`, update the import:
```typescript
import { getPlexTranscodeKey, getSessionClientId, getSessionRatingKey, markTranscodeStopped, notifyPlexStopped, isSessionStopping, terminatePlexSession, pingPlexTranscode } from "../routes/plex.js";
```

Add a Map to track ping intervals per room, near the `rooms` Map (~line 73):
```typescript
/** Server-side ping intervals per room — keeps transcode alive independent of client connectivity. */
const roomPingIntervals = new Map<string, ReturnType<typeof setInterval>>();

function startRoomPing(instanceId: string, hlsSessionId: string): void {
  stopRoomPing(instanceId);
  const interval = setInterval(() => {
    pingPlexTranscode(hlsSessionId).catch(() => {});
  }, 30_000);
  interval.unref();
  roomPingIntervals.set(instanceId, interval);
}

function stopRoomPing(instanceId: string): void {
  const interval = roomPingIntervals.get(instanceId);
  if (interval) {
    clearInterval(interval);
    roomPingIntervals.delete(instanceId);
  }
}
```

- [ ] **Step 3: Start ping when play begins, stop when session ends**

In the `play` case of the message handler (~line 274), after `room.state.updatedAt = Date.now();` add:
```typescript
          if (room.state.hlsSessionId) {
            startRoomPing(roomId, room.state.hlsSessionId);
          }
```

In the `stop` case (~line 311), after `room.state.updatedAt = Date.now();` add:
```typescript
          stopRoomPing(roomId);
```

In the `close` handler, when the last client leaves and we kill the transcode (~line 371), add before `killPlexTranscode`:
```typescript
          stopRoomPing(roomId);
```

In `closeWebSocketServer` (~line 396), before `rooms.clear();` add:
```typescript
  for (const instanceId of roomPingIntervals.keys()) {
    stopRoomPing(instanceId);
  }
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/plex.ts packages/server/src/services/sync.ts
git commit -m "feat: add server-side ping to keep transcodes alive independent of client"
```

---

### Task 7: Heartbeat Drift Improvements

Adds `lastCommandAt` to state messages and reduces drift threshold.

**Files:**
- Modify: `packages/server/src/services/sync.ts:246-257` (state message)
- Modify: `packages/client/src/hooks/useSync.ts:113-123` (state handler)
- Modify: `packages/client/src/hooks/useSync.ts:4-17` (SyncState type)
- Modify: `packages/client/src/components/Player.tsx:13` (drift threshold)

- [ ] **Step 1: Add `lastCommandAt` to sync state broadcast in sync.ts**

In `packages/server/src/services/sync.ts`, in the `state` message sent on join (~line 248):
```typescript
        sendTo(ws, {
          type: "state",
          ratingKey: room.state.ratingKey,
          title: room.state.title,
          subtitles: room.state.subtitles,
          playing: room.state.playing,
          position: interpolatedPosition(room.state),
          hlsSessionId: room.state.hlsSessionId,
          lastCommandAt: room.state.updatedAt,
        });
```

- [ ] **Step 2: Add `lastCommandAt` to client SyncState type and handler**

In `packages/client/src/hooks/useSync.ts`, add to the `SyncState` interface:
```typescript
  /** Timestamp of the last host command — used to detect stale state on reconnect */
  lastCommandAt: number;
```

Add to `INITIAL_STATE`:
```typescript
  lastCommandAt: 0,
```

In the `state` case of the message handler (~line 114):
```typescript
          case "state":
            setState((prev) => ({
              ...prev,
              ratingKey: (msg.ratingKey as string) || null,
              title: (msg.title as string) || null,
              subtitles: Boolean(msg.subtitles),
              playing: Boolean(msg.playing),
              position: (msg.position as number) ?? 0,
              hlsSessionId: (msg.hlsSessionId as string) || null,
              lastCommandAt: (msg.lastCommandAt as number) ?? Date.now(),
              commandSeq: prev.commandSeq + 1,
            }));
            break;
```

- [ ] **Step 3: Reduce heartbeat drift threshold**

In `packages/client/src/components/Player.tsx`, change:
```typescript
const HEARTBEAT_DRIFT_THRESHOLD_S = 3;
```
(was `5`)

- [ ] **Step 4: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server && npm run build --workspace=packages/client`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/sync.ts packages/client/src/hooks/useSync.ts packages/client/src/components/Player.tsx
git commit -m "fix: add lastCommandAt to sync state and reduce drift threshold to 3s"
```

---

### Task 8: WebSocket Reconnect Auth Handling

Stops the infinite reconnect loop when server restarts invalidate sessions.

**Files:**
- Modify: `packages/client/src/hooks/useSync.ts:4-17` (SyncState type)
- Modify: `packages/client/src/hooks/useSync.ts:76-224` (connect logic)

- [ ] **Step 1: Add auth failure state and max retries**

In `packages/client/src/hooks/useSync.ts`, add to `SyncState` interface:
```typescript
  /** True if the WebSocket closed due to authentication failure (code 1008) */
  authFailed: boolean;
  /** True if max reconnect attempts exhausted */
  reconnectFailed: boolean;
```

Add to `INITIAL_STATE`:
```typescript
  authFailed: false,
  reconnectFailed: false,
```

Add a constant at the top of the file:
```typescript
const MAX_RECONNECT_ATTEMPTS = 20;
```

- [ ] **Step 2: Detect close code 1008 and add max retry cap**

Replace the `close` event listener (~line 195) and `error` listener with:

```typescript
      ws.addEventListener("close", (event) => {
        if (!active) return;
        wsRef.current = null;
        setState((prev) => ({ ...prev, connected: false }));

        // Close code 1008 = policy violation (auth failure) — don't retry,
        // the session token is invalid and reconnecting will loop forever
        if (event.code === 1008) {
          console.error("[Sync] Auth failure (1008), not reconnecting:", event.reason);
          setState((prev) => ({ ...prev, authFailed: true }));
          return;
        }

        // Cap reconnect attempts to prevent infinite loops
        if (retryRef.current >= MAX_RECONNECT_ATTEMPTS) {
          console.error("[Sync] Max reconnect attempts reached, giving up");
          setState((prev) => ({ ...prev, reconnectFailed: true }));
          return;
        }

        // Reconnect with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 15000);
        retryRef.current++;
        retryTimerRef.current = setTimeout(connect, delay);
      });

      ws.addEventListener("error", () => {
        // close event will fire after this, triggering reconnect
      });
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/client`

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useSync.ts
git commit -m "fix: detect auth failure on WebSocket close, stop infinite reconnect loop"
```

---

### Task 9: hls.js Retry Config + P2P Fixes

Configures proper retry behavior and fixes the P2P time window values.

**Files:**
- Modify: `packages/client/src/components/Player.tsx:134-182` (Hls constructor config)

- [ ] **Step 1: Add hls.js retry config**

In `packages/client/src/components/Player.tsx`, in the `HlsWithP2P` constructor (~line 137), add the retry parameters after `maxMaxBufferLength: 60,`:

```typescript
        const hls = new HlsWithP2P({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          manifestLoadingMaxRetry: 4,
          manifestLoadingRetryDelay: 1000,
          manifestLoadingMaxRetryTimeout: 30000,
          levelLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 1000,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 1000,
          fragLoadingMaxRetryTimeout: 30000,
          startFragPrefetch: true,
          xhrSetup: (xhr: XMLHttpRequest, _urlStr: string) => {
```

- [ ] **Step 2: Fix P2P time window configuration**

In the same constructor, replace the `p2p.core` config:

```typescript
            p2p: {
            core: {
              swarmId: `pdt-${sessionId}`,
              announceTrackers: [
                `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/tracker${token ? `?token=${encodeURIComponent(token)}` : ""}`,
              ],
              highDemandTimeWindow: 15,
              p2pDownloadTimeWindow: 30,
              httpDownloadTimeWindow: 6,
              simultaneousP2PDownloads: 3,
              simultaneousHttpDownloads: 2,
              rtcConfig: {
                iceServers: [
                  { urls: "stun:stun.l.google.com:19302" },
                ],
              },
              httpRequestSetup: async (url, _byteRange, signal, requestByteRange) => {
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/client`

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/Player.tsx
git commit -m "fix: configure hls.js retry params and correct P2P time windows"
```

---

### Task 10: Rate Limiter Per-IP + Shutdown Timeout

Fixes the global HLS rate limiter and increases shutdown grace period.

**Files:**
- Modify: `packages/server/src/index.ts:81-86` (rate limiter)
- Modify: `packages/server/src/index.ts:137-139` (shutdown timeout)

- [ ] **Step 1: Add per-IP keyGenerator to HLS rate limiter**

In `packages/server/src/index.ts`, replace the `hlsLimiter` (~line 81):

```typescript
const hlsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 50000 : 3000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || "unknown",
});
```

- [ ] **Step 2: Increase shutdown timeout**

In the `shutdown` function (~line 137), change:
```typescript
  setTimeout(() => {
    console.warn("Shutdown timeout — forcing exit");
    process.exit(1);
  }, 15000).unref();
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "fix: per-IP rate limiting for HLS and increase shutdown timeout to 15s"
```

---

### Task 11: Session Persistence in SQLite

Persists sessions and instance registrations to SQLite so server restarts don't lose state.

**Files:**
- Modify: `packages/server/src/middleware/auth.ts` (SQLite session store)
- Modify: `packages/server/src/routes/discord.ts` (SQLite instance store)

- [ ] **Step 1: Rewrite auth.ts with SQLite persistence**

Replace the entire `packages/server/src/middleware/auth.ts` with:

```typescript
import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 10_000;

// Hot cache — avoids SQLite reads on every request
const sessionCache = new Map<string, { createdAt: number; userId: string | null }>();

// SQLite persistence — survives server restarts
const dbDir = process.env.THUMB_CACHE_DIR
  ? path.resolve(process.env.THUMB_CACHE_DIR)
  : path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "../../data",
    );
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "sessions.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT,
    created_at INTEGER NOT NULL
  )
`);

// Prepared statements for performance
const insertStmt = db.prepare("INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");
const selectStmt = db.prepare("SELECT user_id, created_at FROM sessions WHERE token = ?");
const deleteStmt = db.prepare("DELETE FROM sessions WHERE token = ?");
const deleteExpiredStmt = db.prepare("DELETE FROM sessions WHERE created_at < ?");
const countStmt = db.prepare("SELECT COUNT(*) as count FROM sessions");
const deleteOldestStmt = db.prepare(
  "DELETE FROM sessions WHERE token IN (SELECT token FROM sessions ORDER BY created_at ASC LIMIT ?)"
);

// Load existing valid sessions into cache on startup
const validCutoff = Date.now() - SESSION_TTL_MS;
deleteExpiredStmt.run(validCutoff);
const existingRows = db.prepare("SELECT token, user_id, created_at FROM sessions").all() as Array<{
  token: string;
  user_id: string | null;
  created_at: number;
}>;
for (const row of existingRows) {
  sessionCache.set(row.token, { createdAt: row.created_at, userId: row.user_id });
}
console.log(`[Auth] Loaded ${existingRows.length} sessions from SQLite`);

// Periodic cleanup every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  // Clean cache
  for (const [token, session] of sessionCache) {
    if (session.createdAt < cutoff) {
      sessionCache.delete(token);
    }
  }
  // Clean DB
  deleteExpiredStmt.run(cutoff);
}, 5 * 60 * 1000).unref();

export function createSession(userId?: string): string {
  const { count } = countStmt.get() as { count: number };
  if (count >= MAX_SESSIONS) {
    const toDelete = Math.floor(MAX_SESSIONS * 0.1);
    deleteOldestStmt.run(toDelete);
    // Also evict from cache
    const oldestTokens = db.prepare("SELECT token FROM sessions ORDER BY created_at ASC LIMIT ?").all(toDelete) as Array<{ token: string }>;
    for (const { token } of oldestTokens) {
      sessionCache.delete(token);
    }
  }

  const token = crypto.randomUUID();
  const now = Date.now();
  insertStmt.run(token, userId ?? null, now);
  sessionCache.set(token, { createdAt: now, userId: userId ?? null });
  return token;
}

function getSession(token: string): { createdAt: number; userId: string | null } | null {
  // Check hot cache first
  const cached = sessionCache.get(token);
  if (cached) {
    if (Date.now() - cached.createdAt > SESSION_TTL_MS) {
      sessionCache.delete(token);
      deleteStmt.run(token);
      return null;
    }
    return cached;
  }

  // Fall back to SQLite (session created before this process, loaded lazily)
  const row = selectStmt.get(token) as { user_id: string | null; created_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > SESSION_TTL_MS) {
    deleteStmt.run(token);
    return null;
  }

  // Promote to cache
  const session = { createdAt: row.created_at, userId: row.user_id };
  sessionCache.set(token, session);
  return session;
}

export function getSessionUserId(token: string): string | null {
  const session = getSession(token);
  return session?.userId ?? null;
}

export function isValidSession(token: string): boolean {
  return getSession(token) !== null;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (typeof req.query.token === "string" ? req.query.token : undefined);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isValidSession(token)) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  next();
}

export function closeSessionDb(): void {
  db.close();
}
```

- [ ] **Step 2: Add SQLite instance persistence to discord.ts**

In `packages/server/src/routes/discord.ts`, add SQLite storage. Replace the top section (imports through instanceHosts):

```typescript
import { Router, type Request, type Response } from "express";
import { createSession, isValidSession, getSessionUserId } from "../middleware/auth.js";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const router = Router();

const ALLOWED_GUILD_IDS = new Set(
  (process.env.ALLOWED_GUILD_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
);

const INSTANCE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INSTANCES = 10_000;
export const instanceHosts = new Map<string, { hostUserId: string; guildId: string; createdAt: number }>();
const guildInstances = new Map<string, string>();

// SQLite persistence for instance registrations
const dbDir = process.env.THUMB_CACHE_DIR
  ? path.resolve(process.env.THUMB_CACHE_DIR)
  : path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "../../data",
    );
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "instances.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    instance_id TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const insertInstanceStmt = db.prepare(
  "INSERT OR REPLACE INTO instances (instance_id, host_user_id, guild_id, created_at) VALUES (?, ?, ?, ?)"
);
const deleteInstanceStmt = db.prepare("DELETE FROM instances WHERE instance_id = ?");
const deleteExpiredInstancesStmt = db.prepare("DELETE FROM instances WHERE created_at < ?");

// Load existing valid instances into memory on startup
const validCutoff = Date.now() - INSTANCE_TTL_MS;
deleteExpiredInstancesStmt.run(validCutoff);
const existingInstances = db.prepare("SELECT instance_id, host_user_id, guild_id, created_at FROM instances").all() as Array<{
  instance_id: string;
  host_user_id: string;
  guild_id: string;
  created_at: number;
}>;
for (const row of existingInstances) {
  instanceHosts.set(row.instance_id, {
    hostUserId: row.host_user_id,
    guildId: row.guild_id,
    createdAt: row.created_at,
  });
  guildInstances.set(row.guild_id, row.instance_id);
}
console.log(`[Discord] Loaded ${existingInstances.length} instances from SQLite`);

export function closeInstanceDb(): void {
  db.close();
}
```

- [ ] **Step 3: Update pruneStaleInstances to also clean SQLite**

Replace the `pruneStaleInstances` function:

```typescript
function pruneStaleInstances(): void {
  const now = Date.now();
  for (const [id, entry] of instanceHosts) {
    if (now - entry.createdAt > INSTANCE_TTL_MS) {
      instanceHosts.delete(id);
      deleteInstanceStmt.run(id);
      if (guildInstances.get(entry.guildId) === id) {
        guildInstances.delete(entry.guildId);
      }
    }
  }
}
```

- [ ] **Step 4: Persist on register, delete on evict**

In the register handler, where `instanceHosts.set(instanceId, ...)` is called (~line 173), add after it:
```typescript
    insertInstanceStmt.run(instanceId, userId, guildId, Date.now());
```

Where `instanceHosts.delete(existingInstanceId)` is called for stale instance replacement (~line 154), add before it:
```typescript
    deleteInstanceStmt.run(existingInstanceId);
```

Where instances are evicted for capacity (~line 168 in the for loop), add:
```typescript
      deleteInstanceStmt.run(id);
```

- [ ] **Step 5: Close DBs on shutdown**

In `packages/server/src/index.ts`, update the import:
```typescript
import { closeSessionDb } from "./middleware/auth.js";
```

Add import for instance DB:
```typescript
import { closeInstanceDb } from "./routes/discord.js";
```

Wait — `discordRoutes` is already imported as `default`. Add a named import. Change line 8:
```typescript
import discordRoutes, { closeInstanceDb } from "./routes/discord.js";
```

In the `shutdown` function, in the `server.close` callback, before `process.exit(0)`:
```typescript
    thumbCache.close();
    closeSessionDb();
    closeInstanceDb();
    process.exit(0);
```

- [ ] **Step 6: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/middleware/auth.ts packages/server/src/routes/discord.ts packages/server/src/index.ts
git commit -m "feat: persist sessions and instances in SQLite to survive server restarts"
```

---

### Task 12: Display Auth/Reconnect Errors in UI

Surfaces the new `authFailed` and `reconnectFailed` states to the user.

**Files:**
- Modify: `packages/client/src/components/Player.tsx:362-421` (render section)

- [ ] **Step 1: Add error banners for auth and reconnect failure**

In `packages/client/src/components/Player.tsx`, in the return JSX, after the `hostDisconnected` banner:

```tsx
      {syncState?.authFailed && (
        <div style={styles.error}>Session expired — please close and restart the activity</div>
      )}

      {syncState?.reconnectFailed && (
        <div style={styles.error}>Connection lost — please close and restart the activity</div>
      )}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/client`

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Player.tsx
git commit -m "fix: show user-visible errors for auth failure and reconnect exhaustion"
```

---

### Task 13: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Full server build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/server`
Expected: Clean compile, zero errors.

- [ ] **Step 2: Full client build**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npm run build --workspace=packages/client`
Expected: Clean compile, zero errors.

- [ ] **Step 3: Verify no TypeScript errors across project**

Run: `cd /Users/zuby/Developer/plex-discord-theater && npx tsc --noEmit --project packages/server/tsconfig.json && npx tsc --noEmit --project packages/client/tsconfig.json`
Expected: No output (clean).

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: address build errors from stability fixes"
```
(Only if there are fixup changes — skip if builds were clean.)
