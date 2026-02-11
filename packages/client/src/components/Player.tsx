import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { Controls } from "./Controls";
import { hlsMasterUrl, pingSession, stopSession, getSessionToken } from "../lib/api";
import type { PlexItem } from "../lib/api";
import type { SyncState, SyncActions } from "../hooks/useSync";

const PING_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const DRIFT_THRESHOLD_S = 2;

interface PlayerProps {
  item: PlexItem;
  isHost: boolean;
  subtitles: boolean;
  onBack: () => void;
  syncState?: SyncState;
  syncActions?: SyncActions;
}

export function Player({ item, isHost, subtitles, onBack, syncState, syncActions }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destroyLocal = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (heartbeatIntervalRef.current !== null) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  // Single HLS session — no mid-stream switching
  useEffect(() => {
    let mounted = true;

    destroyLocal();

    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;

    const url = hlsMasterUrl(item.ratingKey, sessionId, { subtitles });

    async function start() {
      if (pendingStopRef.current) {
        try { await pendingStopRef.current; } catch {}
        pendingStopRef.current = null;
      }

      const video = videoRef.current;
      if (!mounted || !video) return;

      if (Hls.isSupported()) {
        const token = getSessionToken();
        const hls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          xhrSetup: (xhr: XMLHttpRequest, _urlStr: string) => {
            if (token) {
              xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            }
          },
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!mounted) return;
          video.play().catch((err) => console.warn("Autoplay prevented:", err));

          // Host: broadcast play when manifest is ready
          if (isHost && syncActions) {
            syncActions.sendPlay(item.ratingKey, item.title, subtitles);
          }
        });

        // Clear error banner when recovery succeeds
        hls.on(Hls.Events.FRAG_LOADED, () => {
          if (mounted) setError(null);
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error("HLS fatal error:", data);
            if (mounted) setError(`Playback error: ${data.type}`);
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else {
              destroyLocal();
              if (sessionIdRef.current) {
                pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
                sessionIdRef.current = null;
              }
            }
          }
        });

        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        const token = getSessionToken();
        const sep = url.includes("?") ? "&" : "?";
        const nativeUrl = token ? `${url}${sep}token=${encodeURIComponent(token)}` : url;
        video.src = nativeUrl;
        const onLoaded = () => {
          video.play().catch((err) => console.warn("Autoplay prevented:", err));
          if (isHost && syncActions) {
            syncActions.sendPlay(item.ratingKey, item.title, subtitles);
          }
        };
        video.addEventListener("loadedmetadata", onLoaded, { once: true });
      } else {
        setError("HLS playback is not supported in this browser");
        return;
      }

      // Start ping interval after successful player setup
      pingIntervalRef.current = setInterval(() => {
        if (sessionIdRef.current) {
          pingSession(sessionIdRef.current).catch(console.error);
        }
      }, PING_INTERVAL_MS);

      // Host: heartbeat every 5s
      if (isHost && syncActions) {
        heartbeatIntervalRef.current = setInterval(() => {
          const v = videoRef.current;
          if (v) {
            syncActions.sendHeartbeat(v.currentTime, !v.paused);
          }
        }, HEARTBEAT_INTERVAL_MS);
      }
    }

    start();

    return () => {
      mounted = false;
      destroyLocal();
      if (sessionIdRef.current) {
        pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [item.ratingKey, subtitles, destroyLocal, isHost, syncActions]);

  // Viewer: drift correction — sync position + play/pause state
  useEffect(() => {
    if (isHost || !syncState) return;
    const video = videoRef.current;
    if (!video) return;

    // Sync play/pause state
    if (syncState.playing && video.paused) {
      video.play().catch(() => {});
    } else if (!syncState.playing && !video.paused) {
      video.pause();
    }

    // Drift correction — only when we have a meaningful position
    if (syncState.position > 0) {
      const drift = Math.abs(video.currentTime - syncState.position);
      if (drift > DRIFT_THRESHOLD_S) {
        video.currentTime = syncState.position;
      }
    }
  }, [isHost, syncState?.playing, syncState?.position]);

  const handleBack = useCallback(() => {
    destroyLocal();
    if (sessionIdRef.current) {
      pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }
    if (isHost && syncActions) {
      syncActions.sendStop();
    }
    onBack();
  }, [destroyLocal, onBack, isHost, syncActions]);

  return (
    <div style={styles.container}>
      {error && <div style={styles.error}>{error}</div>}

      {syncState?.hostDisconnected && (
        <div style={styles.hostDisconnected}>Host disconnected — waiting for reconnection...</div>
      )}

      <video
        ref={videoRef}
        style={styles.video}
        playsInline
      />

      <Controls
        videoRef={videoRef}
        isHost={isHost}
        title={item.title}
        onBack={handleBack}
        onSyncPause={isHost ? syncActions?.sendPause : undefined}
        onSyncResume={isHost ? syncActions?.sendResume : undefined}
        onSyncSeek={isHost ? syncActions?.sendSeek : undefined}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "relative",
    width: "100vw",
    height: "100vh",
    background: "#000",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  error: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    background: "#c0392b",
    color: "#fff",
    padding: "8px 16px",
    textAlign: "center",
    fontSize: "14px",
    zIndex: 20,
  },
  hostDisconnected: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    background: "#e67e22",
    color: "#fff",
    padding: "8px 16px",
    textAlign: "center",
    fontSize: "14px",
    zIndex: 20,
  },
};
