# Client UI Overhaul — Design Spec

**Date:** 2026-04-15
**Scope:** Polish, robustness, and new features for the Plex Discord Theater client
**Target audience:** Broader Discord communities — users unfamiliar with Plex should find the experience intuitive

---

## Overview

Ten changes spanning two buckets: **ship-readiness polish** (items 1-8) and **new features** (items 9-10). All changes are client-side unless explicitly noted as requiring server work.

---

## 1. Viewer Player Controls

**Problem:** Viewers see a fullscreen video with zero UI — no volume control, no progress bar, no indication of elapsed time.

**Design:**

The `Controls` component currently hides play/pause, skip, and gear buttons behind an `isHost` check. The progress bar and seek handler are also host-gated.

Changes to `Controls.tsx`:
- **Progress bar:** Always visible for both host and viewer. Show elapsed/total time for everyone. The progress bar `onClick` handler (`seek`) and the seek-head dot remain **host-only**. Viewers see a read-only progress bar that tracks playback position — no click-to-seek, no drag.
- **Volume + Mute:** Already rendered for everyone (the `toggleMute` and `handleVolume` callbacks don't check `isHost`). No changes needed — volume is already viewer-accessible. Verify this is the case and fix if not.
- **Time display:** The `fmt(currentTime) / fmt(duration)` span currently sits inside the host-only left controls group. Move it outside the `isHost` conditional so viewers see elapsed/total time.
- **Play/Pause, Skip, Gear:** Remain host-only. No change.

**Files modified:**
- `packages/client/src/components/Controls.tsx` — restructure left controls to show time for all, make progress bar non-interactive for viewers

---

## 2. Viewer Title Overlay

**Problem:** Viewers have no indication of what they're watching while in the player.

**Design:**

The Controls component already renders for all users (host and viewer alike), including the top bar with title and back button. The fix is to enrich the title with year/episode context so viewers see meaningful info on hover.

Title format:
- **Movie:** "Interstellar (2014)"
- **TV Episode:** "Breaking Bad — S1E1 \u00b7 Pilot"

The top bar uses the existing Controls visibility logic: appears on mouse move, fades after 3 seconds of inactivity. No separate overlay component needed — just pass richer metadata to Controls.

**Title construction:** Build the formatted title in `Player.tsx` before passing to Controls:
- If `item.parentTitle` exists (TV): `"${item.parentTitle} — S${item.parentIndex}E${item.index} \u00b7 ${item.title}"`
- If `item.year` exists (movie): `"${item.title} (${item.year})"`
- Fallback: `item.title`

**Files modified:**
- `packages/client/src/components/Player.tsx` — build formatted title string, pass richer data to Controls
- `packages/client/src/components/Controls.tsx` — ensure top bar renders for all users
- `packages/client/src/App.tsx` — pass additional metadata (year, parentTitle, parentIndex, index) through the player view item

---

## 3. Host Activity Broadcasting

**Problem:** Viewers see a static "Host is browsing the library..." message with no context about what the host is actually looking at.

**Design:**

**New sync message type:** `browse`

The host's client emits a lightweight WebSocket message whenever their navigation state changes:
```json
{ "type": "browse", "context": "Browsing Movies" }
{ "type": "browse", "context": "Looking at Interstellar (2014)" }
{ "type": "browse", "context": "Looking at Breaking Bad \u2014 S1E1 \u00b7 Pilot" }
```

Context strings by view:
| Host view | Context string |
|-----------|---------------|
| Library (Movies tab) | "Browsing Movies" |
| Library (TV Shows tab) | "Browsing TV Shows" |
| Show detail | "Looking at {showTitle}" |
| Season detail | "Looking at {showTitle} \u2014 Season {n}" |
| Movie/Episode detail | "Looking at {title} ({year})" or "Looking at {showTitle} \u2014 S{x}E{y} \u00b7 {episodeTitle}" |
| Player | (not sent \u2014 viewers auto-navigate to player) |

**Server changes (`sync.ts`):**
- Handle `browse` messages from host: update `room.state.browseContext` (new string field on `RoomState`, default `null`)
- Broadcast `{ type: "browse", context }` to all viewers
- Include `browseContext` in the initial `state` message sent to new joiners
- Only host can send `browse` messages (existing guard at line 297 covers this)

**Client changes:**
- `useSync.ts`: Add `browseContext: string | null` to `SyncState`. Update on `browse` and `state` messages. Clear on `play`/`stop`.
- `App.tsx`: The host's client sends `browse` messages on navigation. Add a `sendBrowse(context: string)` action to `SyncActions`. Call it in `pushView`/`replaceView`/`goHome` callbacks when `effectiveIsHost` is true.
- `App.tsx`: Replace the static "Host is browsing the library..." banner text with `syncState.browseContext` when available. Fallback to the current static text if `browseContext` is null.

**Files modified:**
- `packages/server/src/services/sync.ts` — new `browse` message type, `browseContext` field on RoomState
- `packages/client/src/hooks/useSync.ts` — `browseContext` field, `sendBrowse` action
- `packages/client/src/components/Library.tsx` — emit browse context when tab changes
- `packages/client/src/App.tsx` — emit browse context on navigation, display in viewer banner

---

## 4. Error Boundaries

**Problem:** A React render error white-screens the entire Discord activity iframe with no recovery.

**Design:**

Create a new `ErrorBoundary` class component (React still requires class components for error boundaries as of React 19):

```tsx
class ErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
```

**Placement (two levels):**

1. **Top-level** in `main.tsx` wrapping `<App />`:
   - Fallback: "Something went wrong. Click to reload." with a button that calls `window.location.reload()`
   - Catches any crash anywhere in the app

2. **Player-level** wrapping `<Player />` in `App.tsx`:
   - Fallback: "Playback error. Click to go back." with a button that pops the view stack back to library
   - The Player is the most crash-prone component (HLS errors, codec issues, DOM manipulation). Isolating it means a player crash doesn't kill browsing.

**Files created:**
- `packages/client/src/components/ErrorBoundary.tsx`

**Files modified:**
- `packages/client/src/main.tsx` — wrap App in top-level ErrorBoundary
- `packages/client/src/App.tsx` — wrap Player in player-level ErrorBoundary

---

## 5. Empty States

**Problem:** When search returns nothing, filters match nothing, or a section is empty, the user sees a blank void.

**Design:**

Add contextual empty state messages wherever content can be absent:

| Location | Condition | Message |
|----------|-----------|---------|
| `Library.tsx` (search) | Search returns 0 items | "No results for \u201c{query}\u201d" |
| `Library.tsx` (filter) | Filter+sort returns 0 items | "No movies match these filters" / "No shows match these filters" |
| `Library.tsx` (section) | Section has 0 items | "This library is empty" |
| `SeasonDetail.tsx` | Season has 0 episodes | "No episodes available" |
| `ShowDetail.tsx` | Show has 0 seasons | "No seasons available" |

Each empty state is a centered container with muted text and a subtle icon. Consistent styling: `#666` text, `14px`, centered, with `48px` vertical padding.

**Files modified:**
- `packages/client/src/components/Library.tsx` — empty state for search, filter, and section
- `packages/client/src/components/SeasonDetail.tsx` — empty state for no episodes
- `packages/client/src/components/ShowDetail.tsx` — empty state for no seasons

---

## 6. Detail Page Loading Skeletons

**Problem:** MovieDetail, ShowDetail, and SeasonDetail show a bare spinner while loading, unlike Library which has shimmer skeleton cards.

**Design:**

Create skeleton layouts that match the actual detail page structure:

**MovieDetail skeleton:**
- Large backdrop placeholder (full-width, 300px height, shimmer)
- Below: flex row with poster placeholder (left, 180px\u00d7270px) and info block (right):
  - Title bar (60% width, 20px height, shimmer)
  - Meta row (40% width, 14px height, shimmer)
  - Genre pills row (3 small rounded rects, shimmer)
  - Summary lines (3 lines at 100%, 90%, 70% width, shimmer)

**ShowDetail skeleton:** Same as MovieDetail but with a grid of season card placeholders below (reuse SkeletonGrid with 4 items).

**SeasonDetail skeleton:**
- Breadcrumb placeholder (30% width, 16px height, shimmer)
- 4 episode row placeholders (each: 200px thumbnail left + text block right, shimmer)

Reuse the existing `shimmer` keyframe animation from `index.html`. Create a shared `SkeletonBlock` component for reuse (a div with shimmer background, configurable width/height/borderRadius).

**Files created:**
- `packages/client/src/components/SkeletonBlock.tsx` — reusable shimmer block primitive

**Files modified:**
- `packages/client/src/components/MovieDetail.tsx` — show skeleton while loading
- `packages/client/src/components/ShowDetail.tsx` — show skeleton while loading
- `packages/client/src/components/SeasonDetail.tsx` — show skeleton while loading

---

## 7. Graceful Track Switching

**Problem:** Changing audio/subtitle tracks restarts the HLS stream, causing a jarring 3-5 second black screen.

**Design:**

Make the track switch feel seamless by bridging the gap between old and new streams:

1. **Capture last frame:** Before destroying the old HLS instance, grab the current `<canvas>` snapshot or simply keep the old `<video>` element visible (paused on last frame) while the new stream loads underneath.

   Implementation: Use a `<canvas>` element. Before stopping the old stream:
   ```ts
   const canvas = document.createElement("canvas");
   canvas.width = video.videoWidth;
   canvas.height = video.videoHeight;
   canvas.getContext("2d")!.drawImage(video, 0, 0);
   ```
   Position the canvas over the video element. Remove it once the new stream fires `FRAG_BUFFERED` or `canplay`.

2. **Show overlay:** Display a centered overlay on top of the freeze frame: "Switching audio..." or "Switching subtitles..." with a subtle spinner. Same dark semi-transparent backdrop style as the TrackSwitcher modal.

3. **Persist position:** Already handled — the current code captures `currentTime` before restarting. No change needed.

4. **Resume:** Once the new HLS stream fires `canplay` or equivalent, remove the canvas and overlay. Playback resumes at the saved position.

**State flow:**
```
User clicks new track in TrackSwitcher
  -> setTrackSwitching({ type: "audio" | "subtitle" })
  -> capture canvas snapshot
  -> show overlay with snapshot + "Switching..." message
  -> stop old HLS, start new HLS with offset
  -> new HLS fires canplay
  -> clear overlay and canvas
  -> setTrackSwitching(null)
```

**Files modified:**
- `packages/client/src/components/Player.tsx` — add `trackSwitching` state, canvas capture logic, overlay rendering, canplay listener to clear overlay
- `packages/client/src/components/TrackSwitcher.tsx` — no changes needed (it already calls the parent's track change handler)

---

## 8. Stale Session Auto-Recovery (Host)

**Problem:** When the Plex transcode dies mid-movie (server timeout, crash, resource pressure), the host sees a red "Playback error" banner and must manually restart. No auto-recovery exists.

**Current behavior (from code analysis):**
- HLS.js fires `Hls.Events.ERROR` with `data.fatal = true`
- Host: after `MAX_NETWORK_RETRIES = 5` network errors, displays permanent error and gives up
- Viewer: 3 auto-retries, can recover if host sends a new command

**Design:**

Add auto-recovery for the host when a fatal network error occurs:

1. **Detect fatal error:** On `Hls.Events.ERROR` where `data.fatal === true` and `data.type === Hls.ErrorTypes.NETWORK_ERROR`:

2. **Capture position:** Save `videoRef.current.currentTime` to a ref (`recoveryPositionRef`).

3. **Show recovery overlay:** Instead of the red error banner, show a centered overlay: "Stream interrupted \u2014 Reconnecting..." with a spinner. Uses the same freeze-frame canvas technique from item 7. The video element is hidden behind the canvas.

4. **Auto-restart transcode:** After a 2-second delay:
   - Stop the old HLS instance
   - Stop the old Plex session (call `stopSession` API)
   - Start a new HLS session with `offset` set to the saved position (reuse the existing offset/seek-restart logic from `onSeekRestart`)
   - Use a new UUID for the session
   - Broadcast the new `hlsSessionId` to viewers via `sendPlay` (they auto-recover on new play command)

5. **Retry limits:** Allow up to 2 auto-recovery attempts per playback session. Track with a `recoveryAttemptRef` counter, reset when a new item starts playing. If both attempts fail:
   - Show "Stream lost \u2014 Retry?" with a manual Retry button
   - Retry button resets the counter and tries once more
   - If that also fails, show permanent "Playback failed. Go back and try again."

6. **HLS.js built-in recovery:** For `MEDIA_ERROR` type fatal errors (codec issues, not network), use `hls.recoverMediaError()` first (HLS.js built-in recovery). Only fall back to full transcode restart if `recoverMediaError` fails.

**Recovery flow:**
```
HLS fatal NETWORK_ERROR
  -> if recoveryAttempts < 2:
       -> capture position + canvas frame
       -> show "Reconnecting..." overlay
       -> wait 2s
       -> stop old session
       -> start new transcode at saved position
       -> broadcast new hlsSessionId to viewers
       -> on canplay: clear overlay, increment recoveryAttempts
  -> else:
       -> show "Stream lost \u2014 Retry?" with button
       -> button click: reset attempts, retry once

HLS fatal MEDIA_ERROR
  -> hls.recoverMediaError()
  -> if still fatal after 5s: fall through to NETWORK_ERROR recovery flow
```

**Files modified:**
- `packages/client/src/components/Player.tsx` — add recovery state machine, canvas capture, recovery overlay, auto-restart logic, retry button fallback

---

## 9. Continue Watching Row (Host Only)

**Problem:** Host has no way to resume previously watched content. Every session starts from scratch.

**Design:**

**Data model:** Server stores watch progress per Discord user:
```ts
interface WatchProgress {
  discordUserId: string;
  ratingKey: string;
  title: string;
  thumb: string | null;
  type: string; // "movie" | "episode"
  parentTitle?: string; // show name for episodes
  parentIndex?: number; // season number
  index?: number; // episode number
  position: number; // seconds
  duration: number; // seconds
  updatedAt: number; // timestamp
}
```

**Storage:** JSON file on disk (`data/watch-progress.json`). Simple, no database needed. Keyed by `discordUserId`, value is an array of `WatchProgress` entries.

**Server endpoints:**
- `PUT /api/progress` — upsert watch progress. Body: `{ ratingKey, title, thumb, type, parentTitle?, parentIndex?, index?, position, duration }`. Auth required (uses session token to identify user). Deduplicates by `ratingKey` per user.
- `GET /api/progress` — get watch progress for authenticated user. Returns array of up to 6 most recent entries, sorted by `updatedAt` desc. Excludes items where `position / duration > 0.95` (finished watching).
- `DELETE /api/progress/:ratingKey` — remove a specific entry (for "remove from continue watching" if needed later).

**When progress is saved:** The host's Player component already sends heartbeats every 5 seconds with `position`. Piggyback on this: alongside the heartbeat, also call `PUT /api/progress` with the current item's metadata and position. Debounce to avoid spamming — save every 30 seconds (every 6th heartbeat), not every 5 seconds.

**When progress is cleared:** When a movie/episode finishes (position reaches >95% of duration), the progress entry is excluded from the GET response (not deleted, just filtered out).

**Client: Continue Watching row:**
- `Library.tsx`: When `isHost` is true and the library view mounts, fetch `GET /api/progress`.
- If items exist, render a horizontal scroll row at the top of the library (above the tab bar):
  - Label: "Continue Watching"
  - Cards: Poster thumbnail, title, progress bar (thin gold bar showing % complete), "X min left" label
  - Max 6 cards
  - Clicking a card navigates to the detail page for that item (same as `onSelect`)
- If no items, don't render the row at all (no empty state needed).

**Plex API note:** The Plex `/hubs/home/continueWatching` endpoint exists (confirmed in openapi.json, `hubIdentifier: "home.continue"`) but requires Plex account-level tracking which may not reflect our app's sessions. We use our own progress tracking to stay independent of Plex's watch state.

**Files created:**
- `packages/server/src/routes/progress.ts` — CRUD endpoints for watch progress
- `packages/server/src/services/progress.ts` — file-based persistence, read/write/dedup logic

**Files modified:**
- `packages/server/src/index.ts` — mount progress routes
- `packages/client/src/lib/api.ts` — `fetchProgress()`, `saveProgress()`, `deleteProgress()` functions
- `packages/client/src/components/Library.tsx` — fetch and render Continue Watching row when isHost
- `packages/client/src/components/Player.tsx` — save progress every 30s during host playback

---

## 10. Queue / Up Next

**Problem:** Host can only play one item at a time. No way to line up multiple movies or auto-advance through TV episodes.

**Design:**

**Queue data model (server-side room state):**
```ts
interface QueueItem {
  ratingKey: string;
  title: string;
  type: string;
  thumb: string | null;
  subtitles: boolean;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
}

// Added to RoomState:
interface RoomState {
  // ... existing fields ...
  queue: QueueItem[]; // ordered list, first item = next up
}
```

Queue lives in the sync room state (server memory, not persisted). It's tied to the activity session and cleared when everyone leaves.

**New sync messages:**

| Direction | Type | Payload | Description |
|-----------|------|---------|-------------|
| Host \u2192 Server | `queue-add` | `{ item: QueueItem }` | Add item to end of queue |
| Host \u2192 Server | `queue-remove` | `{ ratingKey: string }` | Remove item from queue |
| Host \u2192 Server | `queue-clear` | `{}` | Clear entire queue |
| Host \u2192 Server | `queue-reorder` | `{ queue: QueueItem[] }` | Replace queue (for drag reorder) |
| Server \u2192 All | `queue-updated` | `{ queue: QueueItem[] }` | Broadcast current queue state |

Server handles all queue mutations, validates host-only, stores in `room.state.queue`, and broadcasts `queue-updated` to all clients after every change. New joiners receive queue in the initial `state` message.

**Auto-advance:** When the host's player detects the video has ended (`video.ended` event or `currentTime >= duration - 2`):
1. Check if `queue.length > 0`
2. If yes: shift the first item off the queue, start playing it (same flow as clicking play on a detail page)
3. Broadcast `play` + `queue-updated` to viewers
4. Viewers auto-navigate to the new item (existing sync behavior)

**"Up Next" indicator:** When queue has items and the current video is within the last 30 seconds:
- Show a small overlay bottom-right: "Up Next: {title}" with a 15-second countdown
- "Play Now" button to skip the countdown
- "Cancel" button to remove from queue and stop auto-advance

**Adding to queue — UI entry points:**

1. **MovieDetail / SeasonDetail:** When `isHost` and something is already playing, show "Add to Queue" button alongside the "Play" button. If nothing is playing, only show "Play" (no point queueing if nothing is active).

2. **SeasonDetail:** "Play All" button that queues all remaining episodes. If one is already playing, queue everything after it.

**Queue display:**
- Small queue indicator in the player controls (bottom-right area near volume): shows queue count badge, e.g., "\u25B6 3"
- Clicking it opens a slide-out panel (right side) showing the queue list with:
  - Ordered items with poster, title, type
  - Drag handles for reorder (or up/down buttons for simplicity)
  - X button to remove individual items
  - "Clear Queue" button at bottom

**Files modified:**
- `packages/server/src/services/sync.ts` — add `queue` to `RoomState`, handle queue message types, broadcast updates, include in initial state
- `packages/client/src/hooks/useSync.ts` — add `queue` to `SyncState`, add queue actions to `SyncActions`, handle `queue-updated` message
- `packages/client/src/components/Player.tsx` — auto-advance on video end, "Up Next" overlay near end of playback, queue badge button
- `packages/client/src/components/Controls.tsx` — queue badge indicator in right controls area
- `packages/client/src/components/MovieDetail.tsx` — "Add to Queue" button when host and something is playing
- `packages/client/src/components/SeasonDetail.tsx` — "Add to Queue" per episode, "Play All" button

**Files created:**
- `packages/client/src/components/QueuePanel.tsx` — slide-out queue list with reorder/remove/clear
- `packages/client/src/components/UpNext.tsx` — "Up Next" countdown overlay

---

## Implementation Priority

Ordered by impact and dependency:

1. **Error Boundaries** (item 4) — safety net, do first
2. **Empty States** (item 5) — quick wins, low risk
3. **Detail Page Skeletons** (item 6) — quick wins, low risk
4. **Viewer Player Controls** (item 1) — high-impact UX fix
5. **Viewer Title Overlay** (item 2) — small, pairs with item 1
6. **Host Activity Broadcasting** (item 3) — moderate scope, server + client
7. **Graceful Track Switching** (item 7) — moderate scope, player-only
8. **Stale Session Auto-Recovery** (item 8) — moderate scope, player-only
9. **Continue Watching** (item 9) — new feature, server + client
10. **Queue / Up Next** (item 10) — largest feature, depends on nothing else

---

## Files Summary

**New files (6):**
- `packages/client/src/components/ErrorBoundary.tsx`
- `packages/client/src/components/SkeletonBlock.tsx`
- `packages/client/src/components/QueuePanel.tsx`
- `packages/client/src/components/UpNext.tsx`
- `packages/server/src/routes/progress.ts`
- `packages/server/src/services/progress.ts`

**Modified files (12):**
- `packages/client/src/main.tsx`
- `packages/client/src/App.tsx`
- `packages/client/src/hooks/useSync.ts`
- `packages/client/src/lib/api.ts`
- `packages/client/src/components/Controls.tsx`
- `packages/client/src/components/Player.tsx`
- `packages/client/src/components/Library.tsx`
- `packages/client/src/components/MovieDetail.tsx`
- `packages/client/src/components/ShowDetail.tsx`
- `packages/client/src/components/SeasonDetail.tsx`
- `packages/server/src/services/sync.ts`
- `packages/server/src/index.ts`
