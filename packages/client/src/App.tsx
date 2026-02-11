import { useState, useCallback, useEffect, useRef } from "react";
import { useDiscord } from "./hooks/useDiscord";
import { useSync } from "./hooks/useSync";
import { Library } from "./components/Library";
import { MovieDetail } from "./components/MovieDetail";
import { Player } from "./components/Player";
import type { PlexItem } from "./lib/api";

type View =
  | { kind: "library" }
  | { kind: "detail"; item: PlexItem }
  | { kind: "player"; item: PlexItem; subtitles: boolean };

export function App() {
  const { isReady, isHost, userId, username, instanceId, error } = useDiscord();
  const [view, setView] = useState<View>({ kind: "library" });

  const { state: syncState, actions: syncActions } = useSync({
    instanceId,
    userId,
    enabled: isReady,
  });

  // Track previous ratingKey to detect changes
  const prevRatingKeyRef = useRef<string | null>(null);

  // Viewer: auto-navigate when host starts or stops playback
  useEffect(() => {
    if (isHost) return;

    const prevKey = prevRatingKeyRef.current;
    const newKey = syncState.ratingKey;
    prevRatingKeyRef.current = newKey;

    // Host started playing — navigate viewer to player
    if (newKey && newKey !== prevKey) {
      setView({
        kind: "player",
        item: {
          ratingKey: newKey,
          title: syncState.title || "Untitled",
          type: "movie",
          thumb: null,
        },
        subtitles: syncState.subtitles,
      });
    }

    // Host stopped — navigate viewer back to library
    if (!newKey && prevKey) {
      setView({ kind: "library" });
    }
  }, [isHost, syncState.ratingKey, syncState.title, syncState.subtitles]);

  const handleSelect = useCallback((item: PlexItem) => {
    setView({ kind: "detail", item });
  }, []);

  const handlePlay = useCallback((item: PlexItem, subtitles: boolean) => {
    setView({ kind: "player", item, subtitles });
  }, []);

  const handleBack = useCallback(() => {
    setView({ kind: "library" });
  }, []);

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
      {view.kind === "library" && (
        <>
          <header style={styles.header}>
            <h1 style={styles.logo}>Watch Together</h1>
            <span style={styles.user}>
              {username} {isHost ? "(Host)" : "(Viewer)"}
              {!isHost && syncState.connected && " \u2022 Synced"}
            </span>
          </header>
          {!isHost && !syncState.ratingKey && (
            <div style={styles.waitingBanner}>
              Waiting for host to start playback...
            </div>
          )}
          <Library isHost={isHost} onSelect={handleSelect} />
        </>
      )}

      {view.kind === "detail" && (
        <MovieDetail
          item={view.item}
          isHost={isHost}
          onPlay={handlePlay}
          onBack={handleBack}
        />
      )}

      {view.kind === "player" && (
        <Player
          item={view.item}
          isHost={isHost}
          subtitles={view.subtitles}
          onBack={handleBack}
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
};
