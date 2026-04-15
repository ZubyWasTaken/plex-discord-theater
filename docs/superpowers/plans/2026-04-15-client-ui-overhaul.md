# Client UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Plex Discord Theater client for public use — fix viewer UX gaps, add robustness, and implement queue + continue watching features.

**Architecture:** 10 independent work items spanning client components and server sync. Each task is self-contained — no task depends on another unless noted. All styling uses inline React.CSSProperties (project convention). Server changes are Express routes + WebSocket message handlers.

**Tech Stack:** React 19, HLS.js, TypeScript, Express, WebSocket (ws), Vite

**Spec:** `docs/superpowers/specs/2026-04-15-client-ui-overhaul-design.md`

---

## File Map

**New files:**
| File | Purpose |
|------|---------|
| `packages/client/src/components/ErrorBoundary.tsx` | React error boundary (class component) |
| `packages/client/src/components/SkeletonBlock.tsx` | Reusable shimmer block primitive |
| `packages/client/src/components/QueuePanel.tsx` | Slide-out queue list |
| `packages/client/src/components/UpNext.tsx` | "Up Next" countdown overlay |
| `packages/server/src/routes/progress.ts` | CRUD endpoints for watch progress |
| `packages/server/src/services/progress.ts` | File-based watch progress persistence |

**Modified files:**
| File | Tasks |
|------|-------|
| `packages/client/src/main.tsx` | Task 1 (error boundary) |
| `packages/client/src/App.tsx` | Tasks 1, 2, 3, 6 |
| `packages/client/src/hooks/useSync.ts` | Tasks 3, 6, 10 |
| `packages/client/src/lib/api.ts` | Tasks 9, 10 |
| `packages/client/src/components/Controls.tsx` | Tasks 4, 5, 10 |
| `packages/client/src/components/Player.tsx` | Tasks 5, 7, 8, 9, 10 |
| `packages/client/src/components/Library.tsx` | Tasks 3, 6, 9 |
| `packages/client/src/components/MovieDetail.tsx` | Tasks 6, 7, 10 |
| `packages/client/src/components/ShowDetail.tsx` | Tasks 6, 7 |
| `packages/client/src/components/SeasonDetail.tsx` | Tasks 6, 7, 10 |
| `packages/server/src/services/sync.ts` | Tasks 3, 10 |
| `packages/server/src/index.ts` | Task 9 |

---

### Task 1: Error Boundaries

**Files:**
- Create: `packages/client/src/components/ErrorBoundary.tsx`
- Modify: `packages/client/src/main.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Create ErrorBoundary component**

Create `packages/client/src/components/ErrorBoundary.tsx`:

```tsx
import React from "react";

interface Props {
  fallback: React.ReactNode;
  children: React.ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap App in top-level ErrorBoundary**

In `packages/client/src/main.tsx`, replace the contents with:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", minHeight: "100vh", gap: "16px",
          background: "#0d0d0d", color: "#f0f0f0", fontFamily: "DM Sans, sans-serif",
        }}>
          <p style={{ fontSize: "16px", color: "#e74c3c" }}>Something went wrong</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 24px", borderRadius: "8px", border: "none",
              background: "#e5a00d", color: "#000", fontSize: "14px",
              fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Reload
          </button>
        </div>
      }
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
```

- [ ] **Step 3: Wrap Player in player-level ErrorBoundary**

In `packages/client/src/App.tsx`, add import at top:

```tsx
import { ErrorBoundary } from "./components/ErrorBoundary";
```

Then wrap the Player render (around line 253). Find:

```tsx
      {view.kind === "player" && (
        <Player
```

Replace with:

```tsx
      {view.kind === "player" && (
        <ErrorBoundary
          fallback={
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", minHeight: "100vh", gap: "16px",
              background: "#000", color: "#f0f0f0", fontFamily: "DM Sans, sans-serif",
            }}>
              <p style={{ fontSize: "16px", color: "#e74c3c" }}>Playback error</p>
              <button
                onClick={popView}
                style={{
                  padding: "10px 24px", borderRadius: "8px", border: "none",
                  background: "#e5a00d", color: "#000", fontSize: "14px",
                  fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Go Back
              </button>
            </div>
          }
          onReset={popView}
        >
          <Player
```

And add a closing `</ErrorBoundary>` after the Player's closing tag:

```tsx
          />
        </ErrorBoundary>
      )}
```

- [ ] **Step 4: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ErrorBoundary.tsx packages/client/src/main.tsx packages/client/src/App.tsx
git commit -m "feat: add error boundaries for crash recovery"
```

---

### Task 2: Empty States

**Files:**
- Modify: `packages/client/src/components/Library.tsx`
- Modify: `packages/client/src/components/SeasonDetail.tsx`
- Modify: `packages/client/src/components/ShowDetail.tsx`

- [ ] **Step 1: Improve Library empty states**

In `packages/client/src/components/Library.tsx`, find the render section (around line 191):

```tsx
      {loading ? (
        <SkeletonGrid />
      ) : displayItems.length === 0 ? (
        <div style={styles.empty}>No items found</div>
      ) : (
```

Replace the empty state with contextual messages:

```tsx
      {loading ? (
        <SkeletonGrid />
      ) : displayItems.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
          </div>
          <p style={styles.emptyText}>
            {searchResults !== null
              ? `No results for \u201c${searchQuery}\u201d`
              : selectedGenres.length > 0
                ? `No ${activeSectionType === "show" ? "shows" : "movies"} match these filters`
                : "This library is empty"}
          </p>
        </div>
      ) : (
```

You'll need to track the current search query. Add a ref at the top of the Library component (near the other state declarations):

```tsx
const searchQueryRef = useRef("");
```

And a derived variable before the return:

```tsx
const searchQuery = searchQueryRef.current;
```

Update `handleSearch` to store the query:

```tsx
  const handleSearch = useCallback(async (query: string) => {
    searchQueryRef.current = query;
    setLoading(true);
    // ... rest unchanged
```

Add these styles to the Library `styles` object:

```tsx
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 24px",
    gap: "12px",
  },
  emptyIcon: {
    color: "#555",
  },
  emptyText: {
    color: "#666",
    fontSize: "14px",
    textAlign: "center" as const,
  },
```

- [ ] **Step 2: Add empty state to SeasonDetail**

In `packages/client/src/components/SeasonDetail.tsx`, after the breadcrumb section and the loading check, add an empty state. Find where episodes are rendered (after the loading spinner). Add after the loading check:

```tsx
      {loading ? (
        <div style={styles.spinner} />
      ) : episodes.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column" as const, alignItems: "center",
          padding: "48px 24px", gap: "12px",
        }}>
          <p style={{ color: "#666", fontSize: "14px" }}>No episodes available</p>
        </div>
      ) : (
```

Ensure the episodes list is inside the `else` branch of this ternary.

- [ ] **Step 3: Add empty state to ShowDetail**

In `packages/client/src/components/ShowDetail.tsx`, find where seasons are rendered (the grid section). Wrap it with a conditional:

```tsx
      {seasons.length === 0 && !loading ? (
        <div style={{
          display: "flex", flexDirection: "column" as const, alignItems: "center",
          padding: "48px 24px", gap: "12px",
        }}>
          <p style={{ color: "#666", fontSize: "14px" }}>No seasons available</p>
        </div>
      ) : (
        <div style={styles.seasonsGrid}>
          {seasons.map((season) => (
            <MovieCard key={season.ratingKey} item={season} onClick={() => onSelectSeason(season, item)} />
          ))}
        </div>
      )}
```

- [ ] **Step 4: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Library.tsx packages/client/src/components/SeasonDetail.tsx packages/client/src/components/ShowDetail.tsx
git commit -m "feat: add contextual empty states for library, seasons, shows"
```

---

### Task 3: Detail Page Loading Skeletons

**Files:**
- Create: `packages/client/src/components/SkeletonBlock.tsx`
- Modify: `packages/client/src/components/MovieDetail.tsx`
- Modify: `packages/client/src/components/ShowDetail.tsx`
- Modify: `packages/client/src/components/SeasonDetail.tsx`

- [ ] **Step 1: Create SkeletonBlock component**

Create `packages/client/src/components/SkeletonBlock.tsx`:

```tsx
import type { CSSProperties } from "react";

interface SkeletonBlockProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: CSSProperties;
}

export function SkeletonBlock({
  width = "100%",
  height = 16,
  borderRadius = 6,
  style,
}: SkeletonBlockProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s ease-in-out infinite",
        ...style,
      }}
    />
  );
}
```

- [ ] **Step 2: Add skeleton to MovieDetail**

In `packages/client/src/components/MovieDetail.tsx`, add import:

```tsx
import { SkeletonBlock } from "./SkeletonBlock";
```

Find the early return for loading state. Currently, when `loading` is true, the page renders but with missing data. Add a skeleton before the main content. Find:

```tsx
  if (loading) {
```

If there's no explicit loading check in the render, add one right after the `return (` and before the main page div:

```tsx
  if (loading) {
    return (
      <div style={styles.page}>
        <SkeletonBlock width="100%" height={300} borderRadius={0} />
        <div style={{ display: "flex", gap: "24px", padding: "24px", maxWidth: 1100 }}>
          <SkeletonBlock width={180} height={270} borderRadius={8} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
            <SkeletonBlock width="60%" height={24} />
            <SkeletonBlock width="40%" height={16} />
            <div style={{ display: "flex", gap: "8px" }}>
              <SkeletonBlock width={60} height={24} borderRadius={12} />
              <SkeletonBlock width={80} height={24} borderRadius={12} />
              <SkeletonBlock width={50} height={24} borderRadius={12} />
            </div>
            <SkeletonBlock width="100%" height={14} />
            <SkeletonBlock width="90%" height={14} />
            <SkeletonBlock width="70%" height={14} />
          </div>
        </div>
      </div>
    );
  }
```

- [ ] **Step 3: Add skeleton to ShowDetail**

In `packages/client/src/components/ShowDetail.tsx`, add import:

```tsx
import { SkeletonBlock } from "./SkeletonBlock";
```

Add a loading skeleton return before the main render. Find the `return (` for the non-autoNavigated case and add before it:

```tsx
  if (loading) {
    return (
      <div style={styles.page}>
        <SkeletonBlock width="100%" height={300} borderRadius={0} />
        <div style={{ display: "flex", gap: "24px", padding: "24px", maxWidth: 1100 }}>
          <SkeletonBlock width={180} height={270} borderRadius={8} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
            <SkeletonBlock width="60%" height={24} />
            <SkeletonBlock width="40%" height={16} />
            <SkeletonBlock width="100%" height={14} />
            <SkeletonBlock width="90%" height={14} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "16px", padding: "0 24px 24px" }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <SkeletonBlock height={240} borderRadius={8} />
              <SkeletonBlock width="70%" height={14} style={{ marginTop: 8 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Add skeleton to SeasonDetail**

In `packages/client/src/components/SeasonDetail.tsx`, add import:

```tsx
import { SkeletonBlock } from "./SkeletonBlock";
```

Replace the loading spinner with a skeleton. Find the loading condition and replace the spinner with:

```tsx
      {loading ? (
        <div style={{ padding: "0 24px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <SkeletonBlock width="30%" height={18} />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <SkeletonBlock width={200} height={112} borderRadius={8} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                <SkeletonBlock width="50%" height={16} />
                <SkeletonBlock width="80%" height={12} />
                <SkeletonBlock width="60%" height={12} />
              </div>
            </div>
          ))}
        </div>
      ) : episodes.length === 0 ? (
```

- [ ] **Step 5: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/SkeletonBlock.tsx packages/client/src/components/MovieDetail.tsx packages/client/src/components/ShowDetail.tsx packages/client/src/components/SeasonDetail.tsx
git commit -m "feat: add shimmer loading skeletons to detail pages"
```

---

### Task 4: Viewer Player Controls

**Files:**
- Modify: `packages/client/src/components/Controls.tsx`

- [ ] **Step 1: Make progress bar and time visible for viewers**

In `packages/client/src/components/Controls.tsx`, the progress bar click handler should be gated on `isHost`. Find the `seek` callback (around line 128):

```tsx
  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isHost || !progressRef.current || !videoRef.current) return;
```

This is already correct — it returns early if not host. The progress bar itself renders for everyone, so viewers see it but can't click to seek. Good.

Now make the time display visible for viewers. Find the left controls section (around line 251):

```tsx
          <div style={styles.left}>
            {isHost && (
              <button onClick={togglePlay} style={styles.playBtn}>
```

Restructure it so time is always visible but play/skip are host-only:

```tsx
          <div style={styles.left}>
            {isHost && (
              <>
                <button onClick={togglePlay} style={styles.playBtn}>
                  {playing ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="3" y="2" width="4" height="12" rx="1"/>
                      <rect x="9" y="2" width="4" height="12" rx="1"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M4 2.5L13 8L4 13.5V2.5Z"/>
                    </svg>
                  )}
                </button>
                <button onClick={skipBack} style={styles.skipBtn} title="Back 10s">
                  <span style={{ fontSize: 16 }}>{"\u21BA"}</span>
                  <span style={{ fontSize: 11 }}>10</span>
                </button>
                <button onClick={skipForward} style={styles.skipBtn} title="Forward 10s">
                  <span style={{ fontSize: 16 }}>{"\u21BB"}</span>
                  <span style={{ fontSize: 11 }}>10</span>
                </button>
              </>
            )}
            <span style={styles.time}>
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>
```

The key change: the `<span style={styles.time}>` is now **outside** the `isHost` conditional, so viewers see elapsed / total time.

- [ ] **Step 2: Make seek-head dot host-only**

The seek-head dot (gold circle on hover) should only appear for the host. Find the seek-head div (around line 232 in the progress bar). It has `opacity: hoveringProgress ? 1 : 0`. Change it to:

```tsx
              opacity: isHost && hoveringProgress ? 1 : 0,
```

Also change the progress bar cursor to default for viewers. Find the `progressHit` style:

```tsx
  progressHit: {
    padding: "8px 0",
    cursor: "pointer",
    marginBottom: "4px",
  },
```

This needs to be dynamic. In the JSX, override the cursor:

```tsx
          style={{ ...styles.progressHit, cursor: isHost ? "pointer" : "default" }}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/components/Controls.tsx
git commit -m "feat: show progress bar and time for viewers"
```

---

### Task 5: Viewer Title Overlay (Rich Title Formatting)

**Files:**
- Modify: `packages/client/src/components/Player.tsx`
- Modify: `packages/client/src/App.tsx`

- [ ] **Step 1: Pass richer metadata through the player view**

In `packages/client/src/App.tsx`, the `View` type for player includes `item: PlexItem`. The `PlexItem` type already has `year`, `parentTitle`, `parentIndex`, and `index` fields. These need to be populated when pushing the player view.

Find the viewer auto-navigate to player (around line 76):

```tsx
      const playerView: View = {
        kind: "player",
        item: {
          ratingKey: newKey,
          title: syncState.title || "Untitled",
          type: "movie",
          thumb: null,
        },
        subtitles: syncState.subtitles,
      };
```

The issue: when a viewer auto-navigates, the sync state only has `title` and `ratingKey` — no year, parentTitle, etc. The rich title needs to come from either:
1. The sync state (add more fields to the `play` message), or
2. The title string itself (pre-formatted by the host before broadcasting)

Simpler approach: have the host send a pre-formatted `displayTitle` in the `play` message. The host has all the metadata, so it builds the formatted title before playing.

Update the `play` message in `useSync.ts` to accept and broadcast a `displayTitle` alongside `title`. But that changes the sync protocol. Simpler: just build the formatted title in `Player.tsx` from the `item` prop.

In `packages/client/src/components/Player.tsx`, build a formatted title before passing to Controls. Add above the `return` statement:

```tsx
  // Build rich display title for Controls top bar
  const displayTitle = item.parentTitle
    ? `${item.parentTitle} \u2014 S${item.parentIndex ?? "?"}E${item.index ?? "?"} \u00b7 ${item.title}`
    : item.year
      ? `${item.title} (${item.year})`
      : item.title;
```

Then change the Controls prop from `title={item.title}` to `title={displayTitle}`.

- [ ] **Step 2: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/Player.tsx packages/client/src/App.tsx
git commit -m "feat: show rich title (year, episode info) in player overlay"
```

---

### Task 6: Host Activity Broadcasting

**Files:**
- Modify: `packages/server/src/services/sync.ts`
- Modify: `packages/client/src/hooks/useSync.ts`
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/components/Library.tsx`

- [ ] **Step 1: Add browse message to server sync**

In `packages/server/src/services/sync.ts`, add `browseContext` to `RoomState` interface:

```ts
interface RoomState {
  ratingKey: string | null;
  title: string | null;
  subtitles: boolean;
  playing: boolean;
  position: number;
  updatedAt: number;
  hlsSessionId: string | null;
  browseContext: string | null;
}
```

Update `getOrCreateRoom` to initialize it:

```ts
        browseContext: null,
```

Add `browseContext` to the initial state message sent on join (in the `"join"` handler):

```ts
        sendTo(ws, {
          type: "state",
          ratingKey: room.state.ratingKey,
          title: room.state.title,
          subtitles: room.state.subtitles,
          playing: room.state.playing,
          position: interpolatedPosition(room.state),
          hlsSessionId: room.state.hlsSessionId,
          lastCommandAt: room.state.updatedAt,
          browseContext: room.state.browseContext,
        });
```

Add a `browse` case in the message switch (after `heartbeat`):

```ts
        case "browse": {
          room.state.browseContext = (msg.context as string) || null;
          broadcast(room, ws, { type: "browse", context: room.state.browseContext });
          break;
        }
```

Clear `browseContext` when play starts (in the `play` case, before the broadcast):

```ts
          room.state.browseContext = null;
```

- [ ] **Step 2: Add browse state and action to client useSync**

In `packages/client/src/hooks/useSync.ts`, add to `SyncState`:

```ts
  browseContext: string | null;
```

Add to `INITIAL_STATE`:

```ts
  browseContext: null,
```

Add `sendBrowse` to `SyncActions` interface:

```ts
  sendBrowse: (context: string) => void;
```

Add to the `actions` useMemo:

```ts
      sendBrowse: (context: string) => send({ type: "browse", context }),
```

Handle `browse` in the message switch:

```ts
          case "browse":
            setState((prev) => ({
              ...prev,
              browseContext: (msg.context as string) || null,
            }));
            break;
```

Update the `state` handler to include `browseContext`:

```ts
          case "state":
            setState((prev) => ({
              ...prev,
              // ... existing fields ...
              browseContext: (msg.browseContext as string) || null,
            }));
            break;
```

Clear `browseContext` on `play` and `stop`:

```ts
          case "play":
            setState((prev) => ({
              ...prev,
              // ... existing fields ...
              browseContext: null,
            }));
            break;
```

- [ ] **Step 3: Emit browse context from App on navigation**

In `packages/client/src/App.tsx`, update the navigation callbacks to emit browse context when the host navigates.

Add a helper function inside the `App` component:

```tsx
  const emitBrowse = useCallback((context: string) => {
    if (effectiveIsHost && syncActions) {
      syncActions.sendBrowse(context);
    }
  }, [effectiveIsHost, syncActions]);
```

Update `handleSelect`:

```tsx
  const handleSelect = useCallback((item: PlexItem) => {
    if (item.type === "show") {
      pushView({ kind: "show", item });
      emitBrowse(`Looking at ${item.title}`);
    } else {
      pushView({ kind: "detail", item });
      const label = item.parentTitle
        ? `Looking at ${item.parentTitle} \u2014 S${item.parentIndex ?? "?"}E${item.index ?? "?"} \u00b7 ${item.title}`
        : item.year
          ? `Looking at ${item.title} (${item.year})`
          : `Looking at ${item.title}`;
      emitBrowse(label);
    }
  }, [pushView, emitBrowse]);
```

Update `handleShowSeason`:

```tsx
  const handleShowSeason = useCallback((season: PlexItem, show: PlexItem) => {
    pushView({ kind: "season", item: season, show });
    emitBrowse(`Looking at ${show.title} \u2014 Season ${season.index ?? "?"}`);
  }, [pushView, emitBrowse]);
```

Update `handleReplaceShowWithSeason`:

```tsx
  const handleReplaceShowWithSeason = useCallback((season: PlexItem, show: PlexItem) => {
    replaceView({ kind: "season", item: season, show });
    emitBrowse(`Looking at ${show.title} \u2014 Season ${season.index ?? "?"}`);
  }, [replaceView, emitBrowse]);
```

Update `handleSeasonEpisode`:

```tsx
  const handleSeasonEpisode = useCallback((episode: PlexItem) => {
    pushView({ kind: "detail", item: episode });
    const label = episode.parentTitle
      ? `Looking at ${episode.parentTitle} \u2014 S${episode.parentIndex ?? "?"}E${episode.index ?? "?"} \u00b7 ${episode.title}`
      : `Looking at ${episode.title}`;
    emitBrowse(label);
  }, [pushView, emitBrowse]);
```

Update `goHome`:

```tsx
  const goHome = useCallback(() => {
    setViewStack([{ kind: "library" }]);
    emitBrowse("Browsing the library");
  }, [emitBrowse]);
```

- [ ] **Step 4: Emit browse context from Library on tab change**

In `packages/client/src/components/Library.tsx`, add `onBrowseContext` prop:

```tsx
interface LibraryProps {
  isHost: boolean;
  onSelect: (item: PlexItem) => void;
  activeSection: string | null;
  onActiveSectionChange: (id: string) => void;
  onBrowseContext?: (context: string) => void;
}
```

Update the destructured props:

```tsx
export function Library({ isHost, onSelect, activeSection, onActiveSectionChange, onBrowseContext }: LibraryProps) {
```

When a tab is clicked, emit context. Find the tab button `onClick`:

```tsx
              onClick={() => onActiveSectionChange(s.id)}
```

Change to:

```tsx
              onClick={() => {
                onActiveSectionChange(s.id);
                if (onBrowseContext) onBrowseContext(`Browsing ${s.title}`);
              }}
```

In `App.tsx`, pass the callback:

```tsx
          <Library
            isHost={effectiveIsHost}
            onSelect={handleSelect}
            activeSection={librarySection}
            onActiveSectionChange={setLibrarySection}
            onBrowseContext={effectiveIsHost ? (ctx) => syncActions.sendBrowse(ctx) : undefined}
          />
```

- [ ] **Step 5: Display browse context in viewer banner**

In `packages/client/src/App.tsx`, find the waiting banner (around line 208):

```tsx
          {!effectiveIsHost && !syncState.ratingKey && (
            <div style={styles.waitingBanner}>
              <div style={styles.waitingDot} />
              <div>
                <div style={styles.waitingPrimary}>Host is browsing the library...</div>
                <div style={styles.waitingSecondary}>You can browse too — playback starts when the host picks something</div>
              </div>
            </div>
          )}
```

Replace the primary text:

```tsx
                <div style={styles.waitingPrimary}>
                  {syncState.browseContext
                    ? `Host is ${syncState.browseContext.charAt(0).toLowerCase()}${syncState.browseContext.slice(1)}`
                    : "Host is browsing the library..."}
                </div>
```

The `browseContext` from the server is like "Browsing Movies" or "Looking at Interstellar (2014)". Prepending "Host is " and lowercasing the first letter gives: "Host is browsing Movies" or "Host is looking at Interstellar (2014)".

- [ ] **Step 6: Verify the app builds and server compiles**

Run: `cd packages/client && npx vite build && cd ../server && npx tsc --noEmit`
Expected: Both succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/services/sync.ts packages/client/src/hooks/useSync.ts packages/client/src/App.tsx packages/client/src/components/Library.tsx
git commit -m "feat: broadcast host browse activity to viewers"
```

---

### Task 7: Graceful Track Switching

**Files:**
- Modify: `packages/client/src/components/Player.tsx`

- [ ] **Step 1: Add track switching state and canvas capture**

In `packages/client/src/components/Player.tsx`, add state for track switching:

```tsx
  const [trackSwitching, setTrackSwitching] = useState<"audio" | "subtitle" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
```

Update `handleTrackChange` to capture the last frame before restarting:

```tsx
  const handleTrackChange = useCallback(async (partId: number, audioStreamID?: number, subtitleStreamID?: number) => {
    if (!sessionIdRef.current) return;

    // Capture last video frame to canvas for seamless transition
    const video = videoRef.current;
    if (video && video.videoWidth > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")!.drawImage(video, 0, 0);
      canvasRef.current = canvas;
    }

    // Show overlay
    setTrackSwitching(audioStreamID !== undefined ? "audio" : "subtitle");

    try {
      await setStreams(partId, { audioStreamID, subtitleStreamID });
    } catch (err) {
      console.error("Failed to set streams:", err);
      setTrackSwitching(null);
      canvasRef.current = null;
      return;
    }
    // Restart HLS session to apply new tracks, preserving current position
    if (video && video.currentTime > 0) {
      seekOffsetRef.current = video.currentTime;
    }
    setShowTrackSwitcher(false);
    setRetryKey((k) => k + 1);
  }, []);
```

- [ ] **Step 2: Clear overlay on successful stream load**

In the HLS effect, add a listener to clear the track switching overlay when the new stream is playable. Find the `Hls.Events.FRAG_LOADED` handler:

```tsx
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (mounted) {
            setError(null);
            setBuffering(false);
            retryCountRef.current = 0;
            networkRetryRef.current = 0;
            hlsDeadRef.current = false;
          }
        });
```

Add after it:

```tsx
        // Clear track switching overlay once new stream is playable
        const onCanPlay = () => {
          if (mounted) {
            setTrackSwitching(null);
            canvasRef.current = null;
          }
        };
        video.addEventListener("canplay", onCanPlay);
```

Make sure to clean up this listener in the effect teardown (add before `mounted = false`):

```tsx
        video.removeEventListener("canplay", onCanPlay);
```

Note: since `onCanPlay` is defined inside the `start()` function, hoist the `video.removeEventListener` to the effect teardown. One way: store the handler on a ref, or define it at the effect level.

Simpler approach — clear overlay in the `MANIFEST_PARSED` handler instead:

```tsx
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mounted) return;
          // Clear track switching overlay
          setTrackSwitching(null);
          canvasRef.current = null;
          // ... rest of existing code
```

- [ ] **Step 3: Render canvas overlay and switching message**

In the Player JSX, add the freeze-frame canvas and overlay message. Add after the `<video>` element:

```tsx
      {/* Track switching freeze-frame overlay */}
      {trackSwitching && (
        <div style={styles.trackSwitchOverlay}>
          {canvasRef.current && (
            <canvas
              ref={(el) => {
                if (el && canvasRef.current) {
                  el.width = canvasRef.current.width;
                  el.height = canvasRef.current.height;
                  el.getContext("2d")!.drawImage(canvasRef.current, 0, 0);
                }
              }}
              style={styles.trackSwitchCanvas}
            />
          )}
          <div style={styles.trackSwitchMessage}>
            <div style={styles.bufferingSpinner} />
            <span style={styles.bufferingText}>
              {trackSwitching === "audio" ? "Switching audio..." : "Switching subtitles..."}
            </span>
          </div>
        </div>
      )}
```

Add styles:

```tsx
  trackSwitchOverlay: {
    position: "absolute",
    inset: 0,
    background: "#000",
    zIndex: 15,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  trackSwitchCanvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    filter: "brightness(0.5)",
  },
  trackSwitchMessage: {
    position: "relative",
    zIndex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: "14px",
  },
```

- [ ] **Step 4: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Player.tsx
git commit -m "feat: freeze-frame overlay during track switching"
```

---

### Task 8: Stale Session Auto-Recovery (Host)

**Files:**
- Modify: `packages/client/src/components/Player.tsx`

- [ ] **Step 1: Add recovery state and refs**

In `packages/client/src/components/Player.tsx`, add recovery state near the other state declarations:

```tsx
  const [recovering, setRecovering] = useState(false);
  const recoveryAttemptRef = useRef(0);
  const recoveryPositionRef = useRef(0);
  const MAX_RECOVERY_ATTEMPTS = 2;
```

- [ ] **Step 2: Replace host fatal error handling with auto-recovery**

In the `Hls.Events.ERROR` handler, find the section that handles fatal errors for the host (the `else` branch after viewer retries). Replace the entire error handler:

```tsx
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          console.error("HLS fatal error:", data);

          // MEDIA_ERROR: try HLS.js built-in recovery first
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            console.warn("[HLS] Fatal media error, attempting recoverMediaError");
            hls.recoverMediaError();
            return;
          }

          // NETWORK_ERROR: try hls.startLoad() first (transient failures)
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetryRef.current < MAX_NETWORK_RETRIES) {
            networkRetryRef.current++;
            hls.startLoad();
            return;
          }

          // Viewer: retry by bumping retryKey
          if (!ownsSessionRef.current) {
            if (retryCountRef.current < MAX_VIEWER_RETRIES) {
              retryCountRef.current++;
              console.warn(`[Viewer] HLS fatal error, retry ${retryCountRef.current}/${MAX_VIEWER_RETRIES} in 2s`);
              setTimeout(() => {
                if (mounted) setRetryKey((k) => k + 1);
              }, 2000);
            } else {
              if (mounted) setError(`Playback error: ${data.type}`);
              hlsDeadRef.current = true;
            }
            return;
          }

          // Host: auto-recovery
          if (recoveryAttemptRef.current < MAX_RECOVERY_ATTEMPTS) {
            recoveryAttemptRef.current++;
            const video = videoRef.current;
            recoveryPositionRef.current = video?.currentTime ?? 0;

            // Capture freeze frame
            if (video && video.videoWidth > 0) {
              const canvas = document.createElement("canvas");
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.getContext("2d")!.drawImage(video, 0, 0);
              canvasRef.current = canvas;
            }

            if (mounted) {
              setRecovering(true);
              setError(null);
            }

            console.warn(`[Host] Stream interrupted, auto-recovery attempt ${recoveryAttemptRef.current}/${MAX_RECOVERY_ATTEMPTS}`);

            // Wait 2s then restart transcode at saved position
            setTimeout(() => {
              if (!mounted) return;
              destroyLocal();
              if (sessionIdRef.current) {
                pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
                sessionIdRef.current = null;
              }
              seekOffsetRef.current = recoveryPositionRef.current;
              setRetryKey((k) => k + 1);
            }, 2000);
          } else {
            // Recovery exhausted — show manual retry button
            if (mounted) {
              setError(null);
              setRecovering(false);
            }
            destroyLocal();
            if (sessionIdRef.current) {
              pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
              sessionIdRef.current = null;
            }
          }
        });
```

- [ ] **Step 3: Clear recovery overlay on success**

In the `MANIFEST_PARSED` handler, add:

```tsx
          // Clear recovery overlay
          setRecovering(false);
          canvasRef.current = null;
```

- [ ] **Step 4: Add recovery overlay and retry button UI**

In the Player JSX, add after the track switching overlay:

```tsx
      {/* Recovery overlay (stream interrupted) */}
      {recovering && (
        <div style={styles.trackSwitchOverlay}>
          {canvasRef.current && (
            <canvas
              ref={(el) => {
                if (el && canvasRef.current) {
                  el.width = canvasRef.current.width;
                  el.height = canvasRef.current.height;
                  el.getContext("2d")!.drawImage(canvasRef.current, 0, 0);
                }
              }}
              style={styles.trackSwitchCanvas}
            />
          )}
          <div style={styles.trackSwitchMessage}>
            <div style={styles.bufferingSpinner} />
            <span style={styles.bufferingText}>Stream interrupted — Reconnecting...</span>
          </div>
        </div>
      )}

      {/* Recovery exhausted — manual retry */}
      {!recovering && !error && recoveryAttemptRef.current >= MAX_RECOVERY_ATTEMPTS && !sessionIdRef.current && (
        <div style={styles.trackSwitchOverlay}>
          <div style={styles.trackSwitchMessage}>
            <span style={{ color: "#e74c3c", fontSize: "16px", fontWeight: 600 }}>Stream lost</span>
            <button
              onClick={() => {
                recoveryAttemptRef.current = 0;
                recoveryPositionRef.current = recoveryPositionRef.current || 0;
                seekOffsetRef.current = recoveryPositionRef.current;
                setRetryKey((k) => k + 1);
                setRecovering(true);
              }}
              style={{
                padding: "10px 24px", borderRadius: "8px", border: "none",
                background: "#e5a00d", color: "#000", fontSize: "14px",
                fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Retry
            </button>
            <button
              onClick={handleBack}
              style={{
                padding: "8px 20px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent", color: "#888", fontSize: "13px",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Go Back
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verify the app builds**

Run: `cd packages/client && npx vite build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/components/Player.tsx
git commit -m "feat: auto-recover host transcode on stream failure"
```

---

### Task 9: Continue Watching (Host Only)

**Files:**
- Create: `packages/server/src/services/progress.ts`
- Create: `packages/server/src/routes/progress.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/client/src/lib/api.ts`
- Modify: `packages/client/src/components/Library.tsx`
- Modify: `packages/client/src/components/Player.tsx`

- [ ] **Step 1: Create server-side progress persistence**

Create `packages/server/src/services/progress.ts`:

```ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../../data");
const PROGRESS_FILE = path.join(DATA_DIR, "watch-progress.json");
const MAX_ITEMS_PER_USER = 6;

export interface WatchProgress {
  ratingKey: string;
  title: string;
  thumb: string | null;
  type: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  position: number;
  duration: number;
  updatedAt: number;
}

type ProgressStore = Record<string, WatchProgress[]>;

function readStore(): ProgressStore {
  try {
    if (!fs.existsSync(PROGRESS_FILE)) return {};
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeStore(store: ProgressStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(store, null, 2));
}

export function getProgress(userId: string): WatchProgress[] {
  const store = readStore();
  const items = store[userId] || [];
  return items
    .filter((p) => p.duration > 0 && p.position / p.duration <= 0.95)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ITEMS_PER_USER);
}

export function upsertProgress(userId: string, entry: Omit<WatchProgress, "updatedAt">): void {
  const store = readStore();
  const items = store[userId] || [];
  const idx = items.findIndex((p) => p.ratingKey === entry.ratingKey);
  const record: WatchProgress = { ...entry, updatedAt: Date.now() };
  if (idx >= 0) {
    items[idx] = record;
  } else {
    items.push(record);
  }
  // Keep only most recent items
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  store[userId] = items.slice(0, MAX_ITEMS_PER_USER * 2); // Keep some buffer
  writeStore(store);
}

export function deleteProgress(userId: string, ratingKey: string): void {
  const store = readStore();
  const items = store[userId] || [];
  store[userId] = items.filter((p) => p.ratingKey !== ratingKey);
  writeStore(store);
}
```

- [ ] **Step 2: Create progress routes**

Create `packages/server/src/routes/progress.ts`:

```ts
import { Router, type Request, type Response } from "express";
import { getSessionUserId } from "../middleware/auth.js";
import { getProgress, upsertProgress, deleteProgress } from "../services/progress.js";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ items: getProgress(userId) });
});

router.put("/", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { ratingKey, title, thumb, type, parentTitle, parentIndex, index, position, duration } = req.body;
  if (!ratingKey || !title || position == null || duration == null) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  upsertProgress(userId, { ratingKey, title, thumb, type, parentTitle, parentIndex, index, position, duration });
  res.json({ ok: true });
});

router.delete("/:ratingKey", (req: Request, res: Response) => {
  const userId = getSessionUserId(req.headers.authorization?.replace("Bearer ", "") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  deleteProgress(userId, req.params.ratingKey);
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 3: Mount progress routes in server**

In `packages/server/src/index.ts`, add import:

```ts
import progressRoutes from "./routes/progress.js";
```

Add route mounting after the plex routes (after line 110):

```ts
app.use("/api/progress", requireAuth, progressRoutes);
```

- [ ] **Step 4: Add progress API functions to client**

In `packages/client/src/lib/api.ts`, add:

```ts
export interface WatchProgressItem {
  ratingKey: string;
  title: string;
  thumb: string | null;
  type: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  position: number;
  duration: number;
  updatedAt: number;
}

export function fetchProgress(): Promise<{ items: WatchProgressItem[] }> {
  return apiGet("/api/progress");
}

export function saveProgress(data: {
  ratingKey: string;
  title: string;
  thumb: string | null;
  type: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  position: number;
  duration: number;
}): Promise<{ ok: boolean }> {
  return apiPut("/api/progress", data);
}

export function deleteProgressItem(ratingKey: string): Promise<void> {
  return apiDelete(`/api/progress/${encodeURIComponent(ratingKey)}`);
}
```

- [ ] **Step 5: Save progress during host playback**

In `packages/client/src/components/Player.tsx`, add import:

```ts
import { ..., saveProgress } from "../lib/api";
```

Add a ref to debounce progress saves:

```tsx
  const lastProgressSaveRef = useRef(0);
  const PROGRESS_SAVE_INTERVAL_MS = 30_000; // Save every 30s
```

In the heartbeat interval (inside the `start()` function, in the host heartbeat `setInterval`), add progress saving:

```tsx
      if (isHostRef.current && heartbeatIntervalRef.current === null) {
        heartbeatIntervalRef.current = setInterval(() => {
          const v = videoRef.current;
          if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            syncActionsRef.current?.sendHeartbeat(v.currentTime, !v.paused);

            // Save progress every 30s
            const now = Date.now();
            if (now - lastProgressSaveRef.current >= PROGRESS_SAVE_INTERVAL_MS) {
              lastProgressSaveRef.current = now;
              saveProgress({
                ratingKey: item.ratingKey,
                title: item.title,
                thumb: item.thumb,
                type: item.type,
                parentTitle: item.parentTitle,
                parentIndex: item.parentIndex,
                index: item.index,
                position: v.currentTime,
                duration: v.duration || 0,
              }).catch(() => {});
            }
          }
        }, HEARTBEAT_INTERVAL_MS);
      }
```

- [ ] **Step 6: Add Continue Watching row to Library**

In `packages/client/src/components/Library.tsx`, add imports:

```tsx
import { fetchProgress, getSessionToken, type WatchProgressItem } from "../lib/api";
```

Add state for continue watching:

```tsx
  const [continueWatching, setContinueWatching] = useState<WatchProgressItem[]>([]);
```

Fetch on mount when host:

```tsx
  useEffect(() => {
    if (!isHost) return;
    fetchProgress()
      .then(({ items }) => setContinueWatching(items))
      .catch(() => {});
  }, [isHost]);
```

Add a helper for auth URLs:

```tsx
  function authThumbUrl(thumb: string | null): string {
    if (!thumb) return "";
    const token = getSessionToken();
    if (!token) return thumb;
    const sep = thumb.includes("?") ? "&" : "?";
    return `${thumb}${sep}token=${encodeURIComponent(token)}`;
  }
```

Render the Continue Watching row before the search bar. In the return JSX, add before `<Search>`:

```tsx
      {isHost && continueWatching.length > 0 && (
        <div style={styles.continueSection}>
          <h3 style={styles.continueLabel}>Continue Watching</h3>
          <div style={styles.continueRow}>
            {continueWatching.map((item) => {
              const pct = item.duration > 0 ? (item.position / item.duration) * 100 : 0;
              const minLeft = Math.round((item.duration - item.position) / 60);
              return (
                <div
                  key={item.ratingKey}
                  style={styles.continueCard}
                  onClick={() => onSelect({
                    ratingKey: item.ratingKey,
                    title: item.title,
                    type: item.type,
                    thumb: item.thumb,
                    parentTitle: item.parentTitle,
                    parentIndex: item.parentIndex,
                    index: item.index,
                  })}
                >
                  <div style={styles.continuePoster}>
                    {item.thumb && <img src={authThumbUrl(item.thumb)} alt="" style={styles.continuePosterImg} loading="lazy" />}
                  </div>
                  <div style={styles.continueInfo}>
                    <div style={styles.continueTitle}>{item.title}</div>
                    <div style={styles.continueTime}>{minLeft}m left</div>
                  </div>
                  <div style={styles.continueProgress}>
                    <div style={{ ...styles.continueProgressFill, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
```

Add these styles to the Library `styles` object:

```tsx
  continueSection: {
    padding: "0 24px 16px",
  },
  continueLabel: {
    color: "#e5a00d",
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "12px",
    letterSpacing: "-0.01em",
  },
  continueRow: {
    display: "flex",
    gap: "12px",
    overflowX: "auto" as const,
    paddingBottom: "8px",
  },
  continueCard: {
    flexShrink: 0,
    width: "140px",
    cursor: "pointer",
    borderRadius: "8px",
    overflow: "hidden",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    transition: "transform 0.15s ease",
  },
  continuePoster: {
    width: "100%",
    aspectRatio: "2/3",
    background: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  continuePosterImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
  },
  continueInfo: {
    padding: "8px",
  },
  continueTitle: {
    color: "#f0f0f0",
    fontSize: "12px",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  continueTime: {
    color: "#888",
    fontSize: "11px",
    marginTop: "2px",
  },
  continueProgress: {
    height: "3px",
    background: "rgba(255,255,255,0.1)",
  },
  continueProgressFill: {
    height: "100%",
    background: "#e5a00d",
    borderRadius: "2px",
  },
```

- [ ] **Step 7: Verify everything builds**

Run: `cd packages/client && npx vite build && cd ../server && npx tsc --noEmit`
Expected: Both succeed.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/services/progress.ts packages/server/src/routes/progress.ts packages/server/src/index.ts packages/client/src/lib/api.ts packages/client/src/components/Library.tsx packages/client/src/components/Player.tsx
git commit -m "feat: add continue watching row with server-side progress tracking"
```

---

### Task 10: Queue / Up Next

**Files:**
- Modify: `packages/server/src/services/sync.ts`
- Modify: `packages/client/src/hooks/useSync.ts`
- Modify: `packages/client/src/lib/api.ts` (minor — QueueItem type export)
- Create: `packages/client/src/components/QueuePanel.tsx`
- Create: `packages/client/src/components/UpNext.tsx`
- Modify: `packages/client/src/components/Player.tsx`
- Modify: `packages/client/src/components/Controls.tsx`
- Modify: `packages/client/src/components/MovieDetail.tsx`
- Modify: `packages/client/src/components/SeasonDetail.tsx`

This is the largest task. Break into sub-steps.

- [ ] **Step 1: Add queue to server sync**

In `packages/server/src/services/sync.ts`, add queue types and state.

Add interface before `RoomState`:

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
  year?: number;
}
```

Add `queue` to `RoomState`:

```ts
interface RoomState {
  // ... existing fields ...
  queue: QueueItem[];
}
```

Initialize in `getOrCreateRoom`:

```ts
        queue: [],
```

Add queue to initial state message (in `join` handler):

```ts
          queue: room.state.queue,
```

Add queue message handlers in the switch (after `browse`):

```ts
        case "queue-add": {
          const item = msg.item as QueueItem;
          if (item?.ratingKey) {
            room.state.queue.push(item);
            broadcast(room, ws, { type: "queue-updated", queue: room.state.queue });
            sendTo(ws, { type: "queue-updated", queue: room.state.queue });
          }
          break;
        }
        case "queue-remove": {
          const ratingKey = msg.ratingKey as string;
          room.state.queue = room.state.queue.filter((q) => q.ratingKey !== ratingKey);
          broadcast(room, ws, { type: "queue-updated", queue: room.state.queue });
          sendTo(ws, { type: "queue-updated", queue: room.state.queue });
          break;
        }
        case "queue-clear": {
          room.state.queue = [];
          broadcast(room, ws, { type: "queue-updated", queue: room.state.queue });
          sendTo(ws, { type: "queue-updated", queue: room.state.queue });
          break;
        }
        case "queue-reorder": {
          room.state.queue = (msg.queue as QueueItem[]) || [];
          broadcast(room, ws, { type: "queue-updated", queue: room.state.queue });
          sendTo(ws, { type: "queue-updated", queue: room.state.queue });
          break;
        }
```

Clear queue on `stop`:

In the existing `stop` case, add before the broadcast:
```ts
          room.state.queue = [];
```

- [ ] **Step 2: Add queue to client sync hook**

In `packages/client/src/hooks/useSync.ts`:

Add `QueueItem` type and export it:

```ts
export interface QueueItem {
  ratingKey: string;
  title: string;
  type: string;
  thumb: string | null;
  subtitles: boolean;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
}
```

Add `queue` to `SyncState`:

```ts
  queue: QueueItem[];
```

Add to `INITIAL_STATE`:

```ts
  queue: [],
```

Add queue actions to `SyncActions`:

```ts
  sendQueueAdd: (item: QueueItem) => void;
  sendQueueRemove: (ratingKey: string) => void;
  sendQueueClear: () => void;
  sendQueueReorder: (queue: QueueItem[]) => void;
```

Add to the actions useMemo:

```ts
      sendQueueAdd: (item: QueueItem) => send({ type: "queue-add", item }),
      sendQueueRemove: (ratingKey: string) => send({ type: "queue-remove", ratingKey }),
      sendQueueClear: () => send({ type: "queue-clear" }),
      sendQueueReorder: (queue: QueueItem[]) => send({ type: "queue-reorder", queue }),
```

Handle `queue-updated` in message switch:

```ts
          case "queue-updated":
            setState((prev) => ({
              ...prev,
              queue: (msg.queue as QueueItem[]) || [],
            }));
            break;
```

Include queue in `state` handler:

```ts
              queue: (msg.queue as QueueItem[]) || [],
```

Clear queue on `stop`:

```ts
              queue: [],
```

- [ ] **Step 3: Create QueuePanel component**

Create `packages/client/src/components/QueuePanel.tsx`:

```tsx
import type { QueueItem } from "../hooks/useSync";
import { getSessionToken } from "../lib/api";

interface QueuePanelProps {
  queue: QueueItem[];
  onRemove: (ratingKey: string) => void;
  onClear: () => void;
  onReorder: (queue: QueueItem[]) => void;
  onClose: () => void;
}

function authUrl(url: string | null): string {
  if (!url) return "";
  const token = getSessionToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

function moveItem(arr: QueueItem[], from: number, to: number): QueueItem[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

export function QueuePanel({ queue, onRemove, onClear, onReorder, onClose }: QueuePanelProps) {
  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Queue ({queue.length})</h3>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

        {queue.length === 0 ? (
          <p style={styles.empty}>Queue is empty</p>
        ) : (
          <div style={styles.list}>
            {queue.map((item, i) => (
              <div key={item.ratingKey} style={styles.item}>
                <div style={styles.thumb}>
                  {item.thumb && <img src={authUrl(item.thumb)} alt="" style={styles.thumbImg} />}
                </div>
                <div style={styles.info}>
                  <div style={styles.itemTitle}>
                    {item.parentTitle
                      ? `${item.parentTitle} \u2014 S${item.parentIndex ?? "?"}E${item.index ?? "?"}`
                      : item.title}
                  </div>
                  {item.parentTitle && <div style={styles.itemSub}>{item.title}</div>}
                </div>
                <div style={styles.actions}>
                  {i > 0 && (
                    <button
                      onClick={() => onReorder(moveItem(queue, i, i - 1))}
                      style={styles.moveBtn}
                      title="Move up"
                    >
                      &uarr;
                    </button>
                  )}
                  {i < queue.length - 1 && (
                    <button
                      onClick={() => onReorder(moveItem(queue, i, i + 1))}
                      style={styles.moveBtn}
                      title="Move down"
                    >
                      &darr;
                    </button>
                  )}
                  <button onClick={() => onRemove(item.ratingKey)} style={styles.removeBtn} title="Remove">
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {queue.length > 0 && (
          <button onClick={onClear} style={styles.clearBtn}>Clear Queue</button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    zIndex: 100, display: "flex", justifyContent: "flex-end",
  },
  panel: {
    width: "320px", maxWidth: "80vw", height: "100%", background: "#1a1a1a",
    borderLeft: "1px solid rgba(255,255,255,0.1)", display: "flex",
    flexDirection: "column", overflow: "hidden",
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  title: { color: "#f0f0f0", fontSize: "16px", fontWeight: 600 },
  closeBtn: {
    background: "none", border: "none", color: "#888", fontSize: "20px",
    cursor: "pointer", fontFamily: "inherit",
  },
  empty: { color: "#666", fontSize: "14px", textAlign: "center", padding: "32px" },
  list: { flex: 1, overflowY: "auto", padding: "8px" },
  item: {
    display: "flex", alignItems: "center", gap: "10px", padding: "8px",
    borderRadius: "8px", background: "rgba(255,255,255,0.03)",
    marginBottom: "4px",
  },
  thumb: {
    width: "48px", height: "32px", borderRadius: "4px", overflow: "hidden",
    background: "rgba(255,255,255,0.05)", flexShrink: 0,
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  info: { flex: 1, minWidth: 0 },
  itemTitle: {
    color: "#f0f0f0", fontSize: "12px", fontWeight: 600,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  itemSub: { color: "#888", fontSize: "11px", marginTop: "2px" },
  actions: { display: "flex", gap: "4px", flexShrink: 0 },
  moveBtn: {
    background: "none", border: "none", color: "#888", fontSize: "14px",
    cursor: "pointer", padding: "2px 4px", fontFamily: "inherit",
  },
  removeBtn: {
    background: "none", border: "none", color: "#666", fontSize: "16px",
    cursor: "pointer", padding: "2px 4px", fontFamily: "inherit",
  },
  clearBtn: {
    margin: "12px 16px 16px", padding: "8px", borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
    color: "#888", fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
  },
};
```

- [ ] **Step 4: Create UpNext component**

Create `packages/client/src/components/UpNext.tsx`:

```tsx
import { useState, useEffect, useRef } from "react";
import type { QueueItem } from "../hooks/useSync";

interface UpNextProps {
  item: QueueItem;
  onPlayNow: () => void;
  onCancel: () => void;
}

const COUNTDOWN_SECONDS = 15;

export function UpNext({ item, onPlayNow, onCancel }: UpNextProps) {
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          onPlayNow();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [onPlayNow]);

  const title = item.parentTitle
    ? `${item.parentTitle} \u2014 S${item.parentIndex ?? "?"}E${item.index ?? "?"} \u00b7 ${item.title}`
    : item.title;

  return (
    <div style={styles.container}>
      <div style={styles.label}>UP NEXT</div>
      <div style={styles.title}>{title}</div>
      <div style={styles.countdown}>Playing in {remaining}s</div>
      <div style={styles.buttons}>
        <button onClick={onPlayNow} style={styles.playNowBtn}>Play Now</button>
        <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute", bottom: "80px", right: "20px", zIndex: 30,
    background: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)",
    borderRadius: "12px", padding: "16px 20px", maxWidth: "280px",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  label: {
    color: "#e5a00d", fontSize: "10px", fontWeight: 700,
    letterSpacing: "1px", textTransform: "uppercase", marginBottom: "6px",
  },
  title: {
    color: "#f0f0f0", fontSize: "14px", fontWeight: 600,
    marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  countdown: { color: "#888", fontSize: "12px", marginBottom: "12px" },
  buttons: { display: "flex", gap: "8px" },
  playNowBtn: {
    flex: 1, padding: "8px", borderRadius: "6px", border: "none",
    background: "#e5a00d", color: "#000", fontSize: "12px",
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  },
  cancelBtn: {
    flex: 1, padding: "8px", borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.15)", background: "transparent",
    color: "#888", fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
  },
};
```

- [ ] **Step 5: Add queue badge to Controls**

In `packages/client/src/components/Controls.tsx`, add a `queueCount` prop:

```tsx
interface ControlsProps {
  // ... existing props ...
  queueCount?: number;
  onOpenQueue?: () => void;
}
```

Add to the destructured props. In the right controls section, add before the gear button:

```tsx
            {isHost && queueCount != null && queueCount > 0 && onOpenQueue && (
              <button onClick={onOpenQueue} style={styles.queueBtn} title="Queue">
                <span style={{ fontSize: 14 }}>{"\u25B6"}</span>
                <span style={styles.queueBadge}>{queueCount}</span>
              </button>
            )}
```

Add styles:

```tsx
  queueBtn: {
    display: "flex", alignItems: "center", gap: "4px",
    background: "rgba(255,255,255,0.1)", border: "none",
    borderRadius: "16px", padding: "4px 10px",
    color: "#fff", cursor: "pointer", fontSize: "12px", fontFamily: "inherit",
  },
  queueBadge: {
    background: "#e5a00d", color: "#000", borderRadius: "8px",
    padding: "1px 6px", fontSize: "11px", fontWeight: 700,
  },
```

- [ ] **Step 6: Wire queue into Player**

In `packages/client/src/components/Player.tsx`, add imports:

```tsx
import { QueuePanel } from "./QueuePanel";
import { UpNext } from "./UpNext";
import type { QueueItem } from "../hooks/useSync";
```

Add state:

```tsx
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [showUpNext, setShowUpNext] = useState(false);
```

Add auto-advance logic. Listen for video `ended` event:

```tsx
  // Auto-advance: play next queue item when current video ends
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHost) return;

    const onEnded = () => {
      const queue = syncStateRef.current?.queue;
      if (queue && queue.length > 0) {
        advanceQueue();
      }
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [isHost]);
```

Add `advanceQueue` callback:

```tsx
  const advanceQueue = useCallback(() => {
    const queue = syncStateRef.current?.queue;
    if (!queue || queue.length === 0) return;

    const next = queue[0];
    // Remove from queue
    syncActionsRef.current?.sendQueueRemove(next.ratingKey);

    // Navigate to next item — call handleBack then push new player view
    // But Player can't push views. Instead, use onPlayNext callback.
    onPlayNext?.(next);
  }, []);
```

Add an `onPlayNext` prop to `PlayerProps`:

```tsx
interface PlayerProps {
  // ... existing ...
  onPlayNext?: (item: QueueItem) => void;
}
```

Add to destructured props.

Show "Up Next" overlay when near end of video. Add a `timeupdate` effect:

```tsx
  // Show "Up Next" when within 30s of end and queue has items
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isHost) return;

    const onTime = () => {
      const queue = syncStateRef.current?.queue;
      const remaining = (video.duration || 0) - video.currentTime;
      if (queue && queue.length > 0 && remaining <= 30 && remaining > 0 && video.duration > 60) {
        setShowUpNext(true);
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, [isHost]);
```

In the JSX, add after Controls:

```tsx
      {/* Queue panel */}
      {showQueuePanel && syncState && (
        <QueuePanel
          queue={syncState.queue}
          onRemove={(rk) => syncActions?.sendQueueRemove(rk)}
          onClear={() => syncActions?.sendQueueClear()}
          onReorder={(q) => syncActions?.sendQueueReorder(q)}
          onClose={() => setShowQueuePanel(false)}
        />
      )}

      {/* Up Next overlay */}
      {showUpNext && isHost && syncState?.queue?.[0] && (
        <UpNext
          item={syncState.queue[0]}
          onPlayNow={() => {
            setShowUpNext(false);
            advanceQueue();
          }}
          onCancel={() => {
            setShowUpNext(false);
            syncActions?.sendQueueRemove(syncState.queue[0].ratingKey);
          }}
        />
      )}
```

Pass queue props to Controls:

```tsx
      <Controls
        // ... existing props ...
        queueCount={syncState?.queue?.length}
        onOpenQueue={isHost ? () => setShowQueuePanel(true) : undefined}
      />
```

- [ ] **Step 7: Wire onPlayNext from App.tsx**

In `packages/client/src/App.tsx`, add a callback that handles queue auto-advance:

```tsx
  const handlePlayNext = useCallback((queueItem: QueueItem) => {
    const playerView: View = {
      kind: "player",
      item: {
        ratingKey: queueItem.ratingKey,
        title: queueItem.title,
        type: queueItem.type,
        thumb: queueItem.thumb,
        parentTitle: queueItem.parentTitle,
        parentIndex: queueItem.parentIndex,
        index: queueItem.index,
      },
      subtitles: queueItem.subtitles,
    };
    setViewStack((s) => {
      const base = s[s.length - 1]?.kind === "player" ? s.slice(0, -1) : s;
      return [...base, playerView];
    });
  }, []);
```

Add import for `QueueItem`:

```tsx
import type { QueueItem } from "./hooks/useSync";
```

Pass to Player:

```tsx
          <Player
            // ... existing props ...
            onPlayNext={handlePlayNext}
          />
```

- [ ] **Step 8: Add "Add to Queue" buttons in MovieDetail and SeasonDetail**

In `packages/client/src/components/MovieDetail.tsx`, add props:

```tsx
interface MovieDetailProps {
  // ... existing ...
  isPlaying?: boolean;
  onAddToQueue?: (item: QueueItem) => void;
}
```

Add import:

```tsx
import type { QueueItem } from "../hooks/useSync";
```

In the play button area, add an "Add to Queue" button when something is already playing:

```tsx
            {isHost && isPlaying && onAddToQueue && (
              <button
                onClick={() => {
                  if (!meta) return;
                  onAddToQueue({
                    ratingKey: item.ratingKey,
                    title: item.title,
                    type: item.type,
                    thumb: item.thumb,
                    subtitles: selectedSubtitle != null,
                    parentTitle: item.parentTitle,
                    parentIndex: item.parentIndex,
                    index: item.index,
                    year: item.year,
                  });
                }}
                style={styles.queueBtn}
              >
                Add to Queue
              </button>
            )}
```

Add `queueBtn` style:

```tsx
  queueBtn: {
    padding: "10px 20px", borderRadius: "8px",
    border: "1px solid rgba(229,160,13,0.4)", background: "transparent",
    color: "#e5a00d", fontSize: "14px", fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
```

Pass these props from `App.tsx`:

```tsx
          <MovieDetail
            item={view.item}
            isHost={effectiveIsHost}
            onPlay={handlePlay}
            onBack={popView}
            isPlaying={!!syncState.ratingKey}
            onAddToQueue={effectiveIsHost ? (qi) => syncActions.sendQueueAdd(qi) : undefined}
          />
```

Do the same for `SeasonDetail` — add `isPlaying` and `onAddToQueue` props, and render an "Add to Queue" button next to each episode's play button. Pass from App.tsx similarly.

- [ ] **Step 9: Verify everything builds**

Run: `cd packages/client && npx vite build && cd ../server && npx tsc --noEmit`
Expected: Both succeed.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/services/sync.ts packages/client/src/hooks/useSync.ts packages/client/src/components/QueuePanel.tsx packages/client/src/components/UpNext.tsx packages/client/src/components/Player.tsx packages/client/src/components/Controls.tsx packages/client/src/components/MovieDetail.tsx packages/client/src/components/SeasonDetail.tsx packages/client/src/App.tsx
git commit -m "feat: add queue system with up-next auto-advance"
```

---

## Self-Review Checklist

1. **Spec coverage:** All 10 items mapped to tasks 1-10. Viewer controls (spec 1) = task 4. Viewer title (spec 2) = task 5. Host broadcast (spec 3) = task 6. Error boundaries (spec 4) = task 1. Empty states (spec 5) = task 2. Skeletons (spec 6) = task 3. Track switching (spec 7) = task 7. Recovery (spec 8) = task 8. Continue watching (spec 9) = task 9. Queue (spec 10) = task 10.

2. **Placeholder scan:** No TBD, TODO, or "implement later" entries. All code shown in full.

3. **Type consistency:** `QueueItem` interface consistent across sync.ts, useSync.ts, QueuePanel.tsx, UpNext.tsx, Player.tsx, MovieDetail.tsx. `WatchProgress`/`WatchProgressItem` consistent between server and client. `browseContext` consistent across sync.ts, useSync.ts, App.tsx.
