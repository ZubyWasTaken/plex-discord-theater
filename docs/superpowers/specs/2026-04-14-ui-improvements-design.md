# UI Improvements Design Spec

8 improvements to the client UI, prioritized by impact. Design direction: **Cinematic + Social Energy** — full-bleed artwork, dramatic backdrops, gold accent (`#e5a00d`), bold interactive elements with playful micro-animations.

All styling remains inline `React.CSSProperties` (matching existing codebase pattern).

---

## 1. Buffering / Loading Indicator

**File:** `packages/client/src/components/Player.tsx`

Gold spinner overlay shown during initial load and rebuffer events. Centered on the video element with a semi-transparent dark backdrop.

**Visual:**
- Overlay: `rgba(0,0,0,0.4)` covering the full video area
- Spinner: 48px, 3px border, `rgba(229,160,13,0.3)` track, `#e5a00d` top arc, CSS `spin` animation 1s linear infinite
- Text: "Loading..." in `rgba(255,255,255,0.7)`, 13px, font-weight 500, 14px below spinner

**Behavior:**
- Show when `video.readyState < HAVE_FUTURE_DATA` and video is not paused (initial load)
- Show on hls.js `BUFFER_STALLED_ERROR` or when `video` fires `waiting` event
- Hide on `playing` event or `FRAG_LOADED` when `readyState >= HAVE_FUTURE_DATA`
- Use a state variable `buffering: boolean` to toggle the overlay
- Don't show during intentional pause (check `video.paused`)

---

## 2. Keyboard Shortcuts

**File:** `packages/client/src/components/Player.tsx` (event listener), `packages/client/src/components/Controls.tsx` (hint display)

Global `keydown` listener on the Player component. Host-only for playback controls, everyone for volume.

**Bindings:**

| Key | Action | Who |
|-----|--------|-----|
| Space | Play/pause toggle | Host only |
| Left arrow | Seek -10s | Host only |
| Right arrow | Seek +10s | Host only |
| M | Mute/unmute toggle | Everyone |
| Up arrow | Volume +10% | Everyone |
| Down arrow | Volume -10% | Everyone |

**Keyboard hint badges** in the controls bar (right side, next to volume):
- Two small badges: `Space` and `←→`
- Style: `rgba(255,255,255,0.08)` background, 3px border-radius, `rgba(255,255,255,0.3)` text, 10px font
- Fade out after 10 seconds of playback (one-time hint, not persistent)
- Use a ref to track whether hints have been shown; once faded, don't re-show

**Implementation:**
- Add `useEffect` with `keydown` listener in Player.tsx
- `event.preventDefault()` for all handled keys to prevent page scroll
- Check `isHostRef.current` before dispatching play/pause/seek
- Seek dispatches `syncActions.sendSeek(newPosition)` (same as scrub bar)
- Volume changes are local (not synced)

---

## 3. Mute Button

**File:** `packages/client/src/components/Controls.tsx`

Speaker icon button placed to the left of the volume slider.

**Visual:**
- Icon: Unicode speaker characters — `\u{1F50A}` (loud) when unmuted, `\u{1F507}` (muted) when muted
- Size: 16px, color `#fff`, cursor pointer
- Click toggles mute state

**Behavior:**
- Track `muted: boolean` and `previousVolume: number` in Controls state
- Mute: store current volume in `previousVolume`, set `video.volume = 0`, set `muted = true`
- Unmute: restore `video.volume = previousVolume`, set `muted = false`
- If user drags volume slider above 0 while muted, auto-unmute
- If user drags volume slider to 0, auto-mute
- Keyboard `M` key in Player.tsx calls the same toggle function (passed as prop or via ref)

---

## 4. Chunky Progress Bar

**File:** `packages/client/src/components/Controls.tsx`

Replace the current thin 3px progress bar with a chunkier, more interactive version.

**Visual:**
- Bar height: 5px (expands to 8px on hover via CSS transition)
- Track: `rgba(255,255,255,0.15)`, border-radius 3px
- Buffer indicator: `rgba(255,255,255,0.12)` fill showing `video.buffered` range
- Progress fill: `#e5a00d`
- Scrubber dot: 14px circle, `#e5a00d`, `box-shadow: 0 0 8px rgba(229,160,13,0.5)`, positioned at current progress. Only visible on hover (opacity transition).
- Hit area: 20px tall (transparent padding around the 5px bar) for easy clicking
- Host-only seeking (viewers see the bar but clicking does nothing)

**Skip buttons** (±10s) placed between play/pause and time display:
- Two small icons: `↺ 10` and `↻ 10`
- Color: `rgba(255,255,255,0.6)`, 11px font for number, 16px for icon
- Host-only (hidden for viewers)
- On click: `video.currentTime += 10` / `-= 10`, then `syncActions.sendSeek()`

---

## 5. Skeleton Loading Cards

**File:** `packages/client/src/components/Library.tsx`

Replace the CSS spinner with shimmer-animated skeleton cards during initial library load and section switches.

**Visual:**
- 8 skeleton cards in the same grid layout as real cards (`auto-fill, minmax(160px, 1fr)`)
- Each skeleton card:
  - Poster placeholder: `aspect-ratio: 2/3`, border-radius 6px
  - Title placeholder: 12px height, 75% width, border-radius 4px
  - Subtitle placeholder: 10px height, 40% width, border-radius 4px
- Shimmer animation: `background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)`, `background-size: 200% 100%`, animate position left-to-right over 1.5s, ease-in-out, infinite
- Staggered animation delay: poster 0s, title 0.1s, subtitle 0.2s

**Behavior:**
- Show skeletons when `loading` is true and `items.length === 0`
- Once items load, replace skeletons with real cards (no crossfade needed)
- Also show during section tab switches (items clear, loading restarts)

**New component:** `SkeletonGrid` — simple functional component rendering 8 skeleton cards. Keeps Library.tsx clean.

---

## 6. Viewer Waiting Experience

**Files:** `packages/client/src/components/App.tsx`

Improve the waiting banner and now-playing notification for viewers.

**Waiting banner** (when host hasn't started playback):
- Gradient background: `linear-gradient(135deg, rgba(229,160,13,0.06), rgba(229,160,13,0.12))`
- Border: `1px solid rgba(229,160,13,0.2)`, border-radius 10px
- Left side: 8px pulsing gold dot (CSS animation: scale 1→0.85, opacity 1→0.4, 2s ease-in-out infinite)
- Primary text: "Host is browsing the library..." — `#e5a00d`, 13px, font-weight 500
- Secondary text: "You can browse too — playback starts when the host picks something" — `rgba(229,160,13,0.6)`, 11px
- Library is **not dimmed** — viewers can browse freely (this is already the case in the current code, the banner just needs the improved text/styling)

**Now Playing banner** (when host starts playback, viewer hasn't joined yet):
- Gradient background: `linear-gradient(135deg, rgba(229,160,13,0.08), rgba(229,160,13,0.15))`
- Border: `1px solid rgba(229,160,13,0.25)`, border-radius 12px
- Layout: row with mini poster (48×72, border-radius 6px), text block, Watch button
- "NOW PLAYING" label: `rgba(229,160,13,0.7)`, 10px, uppercase, letter-spacing 1px
- Title: `#f0f0f0`, 15px, font-weight 600
- Subtitle: year + duration, `#888`, 12px
- Watch button: `background: #e5a00d`, `color: #000`, 13px font-weight 700, padding 8px 20px, border-radius 8px
- The existing `nowPlaying` state in App.tsx already tracks this; just replace the current simpler banner markup

---

## 7. Mid-Playback Audio/Subtitle Switcher

**Files:**
- Create: `packages/client/src/components/TrackSwitcher.tsx`
- Modify: `packages/client/src/components/Controls.tsx` (add gear button)
- Modify: `packages/client/src/components/Player.tsx` (manage state, handle track change)

Center modal with Audio/Subtitle tabs. **Host-only** — gear icon hidden for viewers.

**Gear button** in Controls.tsx:
- Placed in the right side of the bottom controls, before the mute/volume section
- 32px circle, `rgba(255,255,255,0.1)` background, `#fff` icon (⚙ `\u2699`), 16px
- Only rendered when `isHost` is true
- On click: sets `showTrackSwitcher: true` in Player.tsx (passed down as prop/callback)

**TrackSwitcher modal:**
- Backdrop: `rgba(0,0,0,0.6)` covering full player area, click to close
- Modal: 320px wide, centered, `rgba(13,13,13,0.95)` background, `backdrop-filter: blur(20px)`, 1px border `rgba(255,255,255,0.1)`, border-radius 12px, padding 20px
- Header: "Track Settings" (15px, 600 weight) + close X button (28px circle)
- Tab bar: two tabs "Audio" and "Subtitles", full-width, border-radius 8px with overflow hidden
  - Active tab: `rgba(229,160,13,0.15)` background, `#e5a00d` text, 12px, 600 weight
  - Inactive tab: `rgba(255,255,255,0.03)` background, `#888` text
- Track list: vertical stack, 4px gap
  - Selected track: `rgba(229,160,13,0.12)` background, `1px solid rgba(229,160,13,0.3)`, gold checkmark
  - Unselected track: `rgba(255,255,255,0.03)` background, `1px solid rgba(255,255,255,0.06)`, cursor pointer
  - Track info: name (13px, `#f0f0f0` or `#ccc`) + codec/channels (11px, `#888` or `#666`)
  - Subtitle tracks: name only, no codec line. First option is always "None"
- Footer disclaimer: "Changing tracks briefly restarts the stream at your current position." — `#666`, 11px, border-top separator

**Track change behavior:**
- On track selection, call existing `setStreams(partId, { audioStreamID, subtitleStreamID })` API
- Then restart the HLS session at the current `video.currentTime`:
  1. Store current position
  2. Stop current session (`stopSession`)
  3. Start new session with `offset` param set to current position
  4. This is the same flow as if the user went back and re-played — just automated
- Close the modal after selection
- Track data (audio/subtitle lists, partId) needs to be fetched via `fetchMeta(ratingKey)` and stored in Player.tsx state when the modal opens (or eagerly on mount)

**Props for TrackSwitcher:**
```typescript
interface TrackSwitcherProps {
  ratingKey: string;
  onClose: () => void;
  onTrackChange: (audioStreamID?: number, subtitleStreamID?: number) => void;
}
```

---

## 8. Episode List Redesign

**File:** `packages/client/src/components/SeasonDetail.tsx`

Replace the compact 160×90 thumbnail rows with horizontal cards.

**Visual per episode card:**
- Row layout: thumbnail (200×112) + text block
- Container: padding 10px, border-radius 8px, `rgba(255,255,255,0.03)` background, `1px solid rgba(255,255,255,0.06)` border
- Hover: border color `rgba(229,160,13,0.3)`, background `rgba(255,255,255,0.05)`, scale 1.01
- Thumbnail: 200×112px, border-radius 6px, `object-fit: cover`
  - Play button overlay: 36px circle, `rgba(0,0,0,0.6)`, white play icon, centered. Opacity 0 → 1 on card hover.
  - Duration badge: bottom-right, `rgba(0,0,0,0.7)` background, 10px text, `#ccc`, border-radius 3px, padding 1px 6px
- Text block:
  - Episode number: `#e5a00d`, 12px, font-weight 700 (e.g. "E1")
  - Title: `#f0f0f0`, 14px, font-weight 500
  - Description: `#888`, 12px, line-height 1.4, 2-line clamp (`-webkit-line-clamp: 2`)
- Gap between cards: 10px

**Data:** Episode description comes from the existing `summary` field in Plex metadata. The current `fetchChildren` endpoint doesn't return summaries — needs to either:
- (a) Fetch metadata individually per episode on mount (expensive for many episodes), or
- (b) Extend the server's `/api/plex/children/:ratingKey` endpoint to include `summary` and `duration` fields in the response

Option (b) is better — one request with all data. Modify `mapItem()` in `plex.ts` to include `summary` and `duration` when present in the Plex response.

**Duration display:** The Plex metadata includes `duration` in milliseconds. Format to `MM:SS` or `H:MM:SS` for the duration badge.

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `packages/client/src/components/Player.tsx` | Buffering state, keyboard shortcuts, track switcher state, mute callback |
| `packages/client/src/components/Controls.tsx` | Mute button, chunky progress bar, skip buttons, gear icon, keyboard hints |
| `packages/client/src/components/TrackSwitcher.tsx` | **New** — center modal for audio/subtitle switching |
| `packages/client/src/components/SkeletonGrid.tsx` | **New** — shimmer skeleton cards for loading states |
| `packages/client/src/components/Library.tsx` | Use SkeletonGrid instead of spinner |
| `packages/client/src/components/SeasonDetail.tsx` | Horizontal episode cards with larger thumbnails + descriptions |
| `packages/client/src/components/App.tsx` | Improved waiting banner + now-playing banner styling |
| `packages/server/src/routes/plex.ts` | Add `summary` and `duration` to `mapItem()` for episode data |
