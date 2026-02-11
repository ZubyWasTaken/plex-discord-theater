import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { Controls } from "./Controls";
import { hlsMasterUrl, pingSession, stopSession, fetchMeta } from "../lib/api";
import type { PlexItem, PlexMeta } from "../lib/api";

const PING_INTERVAL_MS = 30_000;

interface PlayerProps {
  item: PlexItem;
  isHost: boolean;
  onBack: () => void;
}

export function Player({ item, isHost, onBack }: PlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const [meta, setMeta] = useState<PlexMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMeta(item.ratingKey).then(setMeta).catch(console.error);
  }, [item.ratingKey]);

  const cleanup = useCallback(() => {
    mountedRef.current = false;
    if (pingIntervalRef.current !== null) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (sessionIdRef.current) {
      stopSession(sessionIdRef.current).catch(console.error);
      sessionIdRef.current = null;
    }
  }, []);

  function startSessionPing(url: string): void {
    fetch(url)
      .then((res) => {
        if (!mountedRef.current) return;
        const sid = res.headers.get("X-Session-Id");
        if (sid) {
          sessionIdRef.current = sid;
          pingIntervalRef.current = setInterval(() => {
            if (sessionIdRef.current) {
              pingSession(sessionIdRef.current).catch(console.error);
            }
          }, PING_INTERVAL_MS);
        }
      })
      .catch((err) => {
        console.error("Failed to retrieve session ID:", err);
      });
  }

  useEffect(() => {
    mountedRef.current = true;
    const video = videoRef.current;
    if (!video) return;

    const url = hlsMasterUrl(item.ratingKey);

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((err) => console.warn("Autoplay prevented:", err));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error("HLS fatal error:", data);
          setError(`Playback error: ${data.type}`);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
          } else {
            cleanup();
          }
        }
      });

      hls.loadSource(url);
      hls.attachMedia(video);
      startSessionPing(url);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.addEventListener("loadedmetadata", () => {
        video.play().catch((err) => console.warn("Autoplay prevented:", err));
      });
      startSessionPing(url);
    } else {
      setError("HLS playback is not supported in this browser");
    }

    return cleanup;
  }, [item.ratingKey, cleanup]);

  const handleBack = useCallback(() => {
    cleanup();
    onBack();
  }, [cleanup, onBack]);

  return (
    <div style={styles.container}>
      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.videoWrapper}>
        <video
          ref={videoRef}
          style={styles.video}
          playsInline
          autoPlay
        />
      </div>

      <Controls
        videoRef={videoRef}
        isHost={isHost}
        title={meta?.title ?? item.title}
        onBack={handleBack}
      />

      {meta && (
        <div style={styles.meta}>
          <h2 style={styles.metaTitle}>
            {meta.title} {meta.year && `(${meta.year})`}
          </h2>
          {meta.genres.length > 0 && (
            <div style={styles.genres}>{meta.genres.join(", ")}</div>
          )}
          {meta.summary && <p style={styles.summary}>{meta.summary}</p>}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: "#000",
  },
  videoWrapper: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#000",
    overflow: "hidden",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  error: {
    background: "#c0392b",
    color: "#fff",
    padding: "8px 16px",
    textAlign: "center",
    fontSize: "14px",
  },
  meta: {
    padding: "12px 16px",
    background: "rgba(0,0,0,0.85)",
    maxHeight: "120px",
    overflowY: "auto",
  },
  metaTitle: {
    fontSize: "16px",
    fontWeight: 600,
    marginBottom: "4px",
  },
  genres: {
    fontSize: "13px",
    color: "#e5a00d",
    marginBottom: "4px",
  },
  summary: {
    fontSize: "13px",
    color: "#aaa",
    lineHeight: 1.4,
  },
};
