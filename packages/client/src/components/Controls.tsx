import { useState, useCallback, useRef, useEffect } from "react";

interface ControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isHost: boolean;
  title: string;
  onBack: () => void;
}

function fmt(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    : `${m}:${s.toString().padStart(2, "0")}`;
}

export function Controls({ videoRef, isHost, title, onBack }: ControlsProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
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
    if (video.paused) video.play();
    else video.pause();
  }, [videoRef, isHost]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isHost || !progressRef.current || !videoRef.current) return;
      if (!duration || !isFinite(duration)) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      videoRef.current.currentTime = pct * duration;
    },
    [isHost, duration, videoRef],
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
    <div style={styles.container}>
      <div style={styles.top}>
        <button onClick={onBack} style={styles.backBtn}>
          Back
        </button>
        <span style={styles.title}>{title}</span>
      </div>

      {/* Progress bar */}
      <div ref={progressRef} onClick={seek} style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${progress}%` }} />
      </div>

      <div style={styles.bottom}>
        <div style={styles.left}>
          {isHost && (
            <button onClick={togglePlay} style={styles.playBtn}>
              {playing ? "Pause" : "Play"}
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
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: "rgba(0,0,0,0.85)",
    padding: "8px 16px",
  },
  top: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "8px",
  },
  backBtn: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid #555",
    background: "transparent",
    color: "#e0e0e0",
    cursor: "pointer",
    fontSize: "13px",
  },
  title: {
    fontSize: "14px",
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  progressTrack: {
    height: "6px",
    background: "#333",
    borderRadius: "3px",
    cursor: "pointer",
    marginBottom: "8px",
  },
  progressFill: {
    height: "100%",
    background: "#e5a00d",
    borderRadius: "3px",
    transition: "width 0.1s linear",
  },
  bottom: {
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
  },
  playBtn: {
    padding: "6px 16px",
    borderRadius: "6px",
    border: "none",
    background: "#e5a00d",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "13px",
  },
  time: {
    fontSize: "13px",
    color: "#aaa",
    fontVariantNumeric: "tabular-nums",
  },
  volume: {
    width: "80px",
    accentColor: "#e5a00d",
  },
};
