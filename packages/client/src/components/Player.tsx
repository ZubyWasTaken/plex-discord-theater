import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { Controls } from "./Controls";
import { hlsMasterUrl, pingSession, stopSession, getSessionToken } from "../lib/api";
import type { PlexItem } from "../lib/api";

const PING_INTERVAL_MS = 30_000;

interface PlayerProps {
  item: PlexItem;
  isHost: boolean;
  subtitles: boolean;
  onBack: () => void;
}

export function Player({ item, isHost, subtitles, onBack }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingStopRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const destroyLocal = useCallback(() => {
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
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
        });

        // Clear error banner when recovery succeeds (unconditional — React
        // bails out if state is already null, avoiding stale closure issues)
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
  }, [item.ratingKey, subtitles, destroyLocal]);

  const handleBack = useCallback(() => {
    destroyLocal();
    if (sessionIdRef.current) {
      pendingStopRef.current = stopSession(sessionIdRef.current).catch(() => {});
      sessionIdRef.current = null;
    }
    onBack();
  }, [destroyLocal, onBack]);

  return (
    <div style={styles.container}>
      {error && <div style={styles.error}>{error}</div>}

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
};
