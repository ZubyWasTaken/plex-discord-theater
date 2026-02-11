import type { PlexItem } from "../lib/api";

interface MovieCardProps {
  item: PlexItem;
  onClick: (item: PlexItem) => void;
}

export function MovieCard({ item, onClick }: MovieCardProps) {
  return (
    <button onClick={() => onClick(item)} style={styles.card}>
      {item.thumb ? (
        <img src={item.thumb} alt={item.title} style={styles.poster} />
      ) : (
        <div style={styles.placeholder}>No Poster</div>
      )}
      <div style={styles.info}>
        <div style={styles.title}>{item.title}</div>
        {item.year && <div style={styles.year}>{item.year}</div>}
      </div>
    </button>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: "#16213e",
    borderRadius: "8px",
    overflow: "hidden",
    cursor: "pointer",
    border: "none",
    color: "inherit",
    textAlign: "left",
    transition: "transform 0.15s",
    width: "100%",
  },
  poster: {
    width: "100%",
    aspectRatio: "2/3",
    objectFit: "cover",
    display: "block",
  },
  placeholder: {
    width: "100%",
    aspectRatio: "2/3",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f3460",
    color: "#666",
    fontSize: "14px",
  },
  info: {
    padding: "8px",
  },
  title: {
    fontSize: "14px",
    fontWeight: 600,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  year: {
    fontSize: "12px",
    color: "#888",
    marginTop: "2px",
  },
};
