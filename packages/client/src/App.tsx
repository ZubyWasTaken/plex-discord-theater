import { useState, useCallback } from "react";
import { useDiscord } from "./hooks/useDiscord";
import { Library } from "./components/Library";
import { Player } from "./components/Player";
import type { PlexItem } from "./lib/api";

type View = { kind: "library" } | { kind: "player"; item: PlexItem };

export function App() {
  const { isReady, isHost, username, error } = useDiscord();
  const [view, setView] = useState<View>({ kind: "library" });

  const handleSelect = useCallback((item: PlexItem) => {
    setView({ kind: "player", item });
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
        <p style={styles.loading}>Connecting to Discord...</p>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      {view.kind === "library" && (
        <>
          <header style={styles.header}>
            <h1 style={styles.logo}>Plex Theater</h1>
            <span style={styles.user}>
              {username} {isHost ? "(Host)" : "(Viewer)"}
            </span>
          </header>
          <Library isHost={isHost} onSelect={handleSelect} />
        </>
      )}

      {view.kind === "player" && (
        <Player item={view.item} isHost={isHost} onBack={handleBack} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #222",
  },
  logo: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#e5a00d",
  },
  user: {
    fontSize: "14px",
    color: "#888",
  },
  center: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    padding: "24px",
    textAlign: "center",
  },
  loading: {
    fontSize: "18px",
    color: "#888",
  },
  error: {
    fontSize: "16px",
    color: "#e74c3c",
    marginBottom: "8px",
  },
  hint: {
    fontSize: "14px",
    color: "#888",
  },
};
