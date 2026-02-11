import { useState, useCallback, useRef, useEffect } from "react";

interface ControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isHost: boolean;
  title: string;
  onBack: () => void;
  onSyncPause?: (position: number) => void;
  onSyncResume?: (position: number) => void;
  onSyncSeek?: (position: number) => void;
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

const HIDE_DELAY_MS = 3000;

export function Controls({ videoRef, isHost, title, onBack, onSyncPause, onSyncResume, onSyncSeek }: ControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [visible, setVisible] = useState(true);
  const progressRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetHideTimer = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    const parent = videoRef.current?.parentElement?.parentElement;
    if (!parent) return;

    const onMove = () => resetHideTimer();
    const onLeave = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(false);
    };

    parent.addEventListener("mousemove", onMove);
    parent.addEventListener("mouseleave", onLeave);
    resetHideTimer();

    return () => {
      parent.removeEventListener("mousemove", onMove);
      parent.removeEventListener("mouseleave", onLeave);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [videoRef, resetHideTimer]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      setVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    const onTime = () => setCurrentTime(video.currentTime);
    const onDur = () => setDuration(video.duration || 0);

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onDur);
    video.addEventListener("durationchange", onDur);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onDur);
      video.removeEventListener("durationchange", onDur);
    };
  }, [videoRef]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isHost) return;
    if (video.paused) {
      video.play();
      onSyncResume?.(video.currentTime);
    } else {
      video.pause();
      onSyncPause?.(video.currentTime);
    }
  }, [videoRef, isHost, onSyncPause, onSyncResume]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isHost || !progressRef.current || !videoRef.current) return;
      if (!duration || !isFinite(duration)) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = pct * duration;
      videoRef.current.currentTime = newTime;
      onSyncSeek?.(newTime);
    },
    [isHost, duration, videoRef, onSyncSeek],
  );

  const handleVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      setVolume(v);
      if (videoRef.current) videoRef.current.volume = v;
    },
    [videoRef],
  );

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      style={{
        ...styles.overlay,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      {/* Top bar: back + title */}
      <div style={styles.topBar}>
        <button onClick={onBack} style={styles.backBtn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ marginRight: 4 }}>
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>
        <span style={styles.title}>{title}</span>
      </div>

      {/* Bottom bar */}
      <div style={styles.bottomBar}>
        {/* Progress bar with larger hit area */}
        <div ref={progressRef} onClick={seek} style={styles.progressHit}>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
        </div>

        <div style={styles.controls}>
          <div style={styles.left}>
            {isHost && (
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
            )}
            <span style={styles.time}>
              {fmt(currentTime)} / {fmt(duration)}
            </span>
          </div>
          <div style={styles.right}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={handleVolume}
              style={styles.volume}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    transition: "opacity 0.3s ease",
    zIndex: 10,
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "16px 20px",
    background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)",
  },
  backBtn: {
    display: "flex",
    alignItems: "center",
    padding: "6px 14px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    backdropFilter: "blur(12px)",
    color: "#f0f0f0",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily: "inherit",
  },
  title: {
    fontSize: "15px",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "#f0f0f0",
  },
  bottomBar: {
    padding: "0 20px 16px",
    background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
    paddingTop: "48px",
  },
  progressHit: {
    padding: "8px 0",
    cursor: "pointer",
    marginBottom: "4px",
  },
  progressTrack: {
    height: "4px",
    background: "rgba(255,255,255,0.15)",
    borderRadius: "2px",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "#e5a00d",
    borderRadius: "2px",
    transition: "width 0.1s linear",
  },
  controls: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  right: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  playBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "#e5a00d",
    color: "#000",
    cursor: "pointer",
    transition: "transform 0.15s ease",
  },
  time: {
    fontSize: "13px",
    color: "#bbb",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
  },
  volume: {
    width: "80px",
    accentColor: "#e5a00d",
  },
};
