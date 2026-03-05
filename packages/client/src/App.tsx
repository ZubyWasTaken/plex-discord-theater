import { useState, useCallback, useEffect, useRef } from "react";
import { useDiscord } from "./hooks/useDiscord";
import { useSync } from "./hooks/useSync";
import { Library } from "./components/Library";
import { MovieDetail } from "./components/MovieDetail";
import { ShowDetail } from "./components/ShowDetail";
import { SeasonDetail } from "./components/SeasonDetail";
import { Player } from "./components/Player";
import type { PlexItem } from "./lib/api";

type View =
  | { kind: "library" }
  | { kind: "show"; item: PlexItem }
  | { kind: "season"; item: PlexItem; show: PlexItem }
  | { kind: "detail"; item: PlexItem }
  | { kind: "player"; item: PlexItem; subtitles: boolean };

export function App() {
  const { isReady, isHost, userId, username, instanceId, error } = useDiscord();
  const [viewStack, setViewStack] = useState<View[]>([{ kind: "library" }]);
  const view = viewStack[viewStack.length - 1];

  const { state: syncState, actions: syncActions } = useSync({
    instanceId,
    userId,
    enabled: isReady,
  });

  const effectiveIsHost = syncState.isHost ?? isHost;

  // Toast when promoted to host
  const [promotedToast, setPromotedToast] = useState(false);
  const prevSyncIsHost = useRef(syncState.isHost);
  useEffect(() => {
    const prev = prevSyncIsHost.current;
    prevSyncIsHost.current = syncState.isHost;
    if (syncState.isHost === true && prev !== true) {
      setPromotedToast(true);
      const timer = setTimeout(() => setPromotedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [syncState.isHost]);

  // Persist active library section across navigation
  const [librarySection, setLibrarySection] = useState<string | null>(null);

  const pushView = useCallback((v: View) => {
    setViewStack((s) => [...s, v]);
  }, []);

  const replaceView = useCallback((v: View) => {
    setViewStack((s) => (s.length > 1 ? [...s.slice(0, -1), v] : [v]));
  }, []);

  const popView = useCallback(() => {
    setViewStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const goHome = useCallback(() => {
    setViewStack([{ kind: "library" }]);
  }, []);

  // Track previous ratingKey to detect changes
  const prevRatingKeyRef = useRef<string | null>(null);

  // Viewer: auto-navigate when host starts or stops playback
  useEffect(() => {
    const prevKey = prevRatingKeyRef.current;
    const newKey = syncState.ratingKey;
    prevRatingKeyRef.current = newKey; // always update, even for host

    if (effectiveIsHost) return;

    // Host started playing — push player onto stack
    if (newKey && newKey !== prevKey) {
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
      setViewStack((s) => {
        const base = s[s.length - 1]?.kind === "player" ? s.slice(0, -1) : s;
        return [...base, playerView];
      });
    }

    // Host stopped — pop back from player if we're on one
    if (!newKey && prevKey) {
      setViewStack((s) => {
        const top = s[s.length - 1];
        if (top?.kind === "player") return s.slice(0, -1);
        return s;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveIsHost, syncState.ratingKey]);

  const handleRejoin = useCallback(() => {
    if (!syncState.ratingKey) return;
    pushView({
      kind: "player",
      item: {
        ratingKey: syncState.ratingKey,
        title: syncState.title || "Untitled",
        type: "movie",
        thumb: null,
      },
      subtitles: syncState.subtitles,
    });
  }, [syncState.ratingKey, syncState.title, syncState.subtitles, pushView]);

  // Show "Now Playing" banner when viewer is not on the player but host is playing
  const showNowPlaying = !effectiveIsHost && !!syncState.ratingKey && view.kind !== "player";

  const handleSelect = useCallback((item: PlexItem) => {
    if (item.type === "show") {
      pushView({ kind: "show", item });
    } else {
      pushView({ kind: "detail", item });
    }
  }, [pushView]);

  const handlePlay = useCallback((item: PlexItem, subtitles: boolean) => {
    pushView({ kind: "player", item, subtitles });
  }, [pushView]);

  const handleShowSeason = useCallback((season: PlexItem, show: PlexItem) => {
    pushView({ kind: "season", item: season, show });
  }, [pushView]);

  // For single-season shows: replace the show view with the season view
  // so back goes straight to library instead of looping
  const handleReplaceShowWithSeason = useCallback((season: PlexItem, show: PlexItem) => {
    replaceView({ kind: "season", item: season, show });
  }, [replaceView]);

  const handleSeasonEpisode = useCallback((episode: PlexItem) => {
    pushView({ kind: "detail", item: episode });
  }, [pushView]);

  if (error) {
    return (
      <div style={styles.center}>
        <p style={styles.error}>Failed to connect: {error}</p>
        <p style={styles.hint}>Make sure you're running this inside a Discord Activity.</p>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={styles.loading}>Connecting to Discord...</p>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {/* Header — visible on all non-player views */}
      {view.kind !== "player" && (
        <header style={styles.header}>
          {view.kind !== "library" ? (
            <button onClick={goHome} style={styles.homeBtn}>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M3 10L10 3L17 10M5 8.5V16A1 1 0 006 17H9V12H11V17H14A1 1 0 0015 16V8.5"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Home
            </button>
          ) : (
            <h1 style={styles.logo}>Watch Together</h1>
          )}
          <span style={styles.user}>
            {username} {effectiveIsHost ? "(Host)" : "(Viewer)"}
            {!effectiveIsHost && syncState.connected && " \u2022 Synced"}
          </span>
        </header>
      )}

      {/* Host promotion toast */}
      {promotedToast && (
        <div style={styles.promotedToast}>You are now the host</div>
      )}

      {/* Now Playing rejoin banner for viewers */}
      {showNowPlaying && (
        <div style={styles.nowPlayingBanner}>
          <span style={styles.nowPlayingText}>
            Now playing: <strong>{syncState.title || "Untitled"}</strong>
          </span>
          <button onClick={handleRejoin} style={styles.nowPlayingBtn}>
            Watch
          </button>
        </div>
      )}

      {view.kind === "library" && (
        <>
          {!effectiveIsHost && !syncState.ratingKey && (
            <div style={styles.waitingBanner}>
              Waiting for host to start playback...
            </div>
          )}
          <Library
            isHost={effectiveIsHost}
            onSelect={handleSelect}
            activeSection={librarySection}
            onActiveSectionChange={setLibrarySection}
          />
        </>
      )}

      {view.kind === "show" && (
        <ShowDetail
          item={view.item}
          onSelectSeason={handleShowSeason}
          onReplaceWithSeason={handleReplaceShowWithSeason}
          onBack={popView}
        />
      )}

      {view.kind === "season" && (
        <SeasonDetail
          season={view.item}
          show={view.show}
          onSelectEpisode={handleSeasonEpisode}
          onBack={popView}
        />
      )}

      {view.kind === "detail" && (
        <MovieDetail
          item={view.item}
          isHost={effectiveIsHost}
          onPlay={handlePlay}
          onBack={popView}
        />
      )}

      {view.kind === "player" && (
        <Player
          item={view.item}
          isHost={effectiveIsHost}
          subtitles={view.subtitles}
          onBack={popView}
          syncState={syncState}
          syncActions={syncActions}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
    background: "radial-gradient(ellipse at 50% 0%, #1a1a1a 0%, #0d0d0d 70%)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  logo: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#e5a00d",
    letterSpacing: "-0.02em",
  },
  homeBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#e5a00d",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: "inherit",
  },
  user: {
    fontSize: "13px",
    color: "#888",
    fontWeight: 500,
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "24px",
    textAlign: "center",
    gap: "16px",
  },
  loading: {
    fontSize: "16px",
    color: "#888",
    fontWeight: 500,
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid rgba(255,255,255,0.1)",
    borderTopColor: "#e5a00d",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  error: {
    fontSize: "16px",
    color: "#e74c3c",
  },
  hint: {
    fontSize: "14px",
    color: "#888",
  },
  waitingBanner: {
    textAlign: "center",
    padding: "12px 24px",
    background: "rgba(229,160,13,0.1)",
    color: "#e5a00d",
    fontSize: "14px",
    fontWeight: 500,
    borderBottom: "1px solid rgba(229,160,13,0.2)",
  },
  promotedToast: {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 24px",
    borderRadius: "8px",
    background: "rgba(46, 160, 67, 0.9)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    zIndex: 1000,
    pointerEvents: "none",
  },
  nowPlayingBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "10px 24px",
    background: "rgba(229,160,13,0.1)",
    borderBottom: "1px solid rgba(229,160,13,0.2)",
  },
  nowPlayingText: {
    fontSize: "14px",
    color: "#e5a00d",
    fontWeight: 500,
  },
  nowPlayingBtn: {
    padding: "5px 16px",
    borderRadius: "6px",
    border: "none",
    background: "#e5a00d",
    color: "#000",
    fontSize: "13px",
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
  },
};
