import { useState, useEffect } from "react";
import { fetchChildren, getSessionToken, type PlexItem } from "../lib/api";

interface SeasonDetailProps {
  season: PlexItem;
  show: PlexItem;
  onSelectEpisode: (episode: PlexItem) => void;
  onBack: () => void;
}

function authUrl(url: string, w?: number, h?: number): string {
  const token = getSessionToken();
  if (!token || !url) return url;
  const sep = url.includes("?") ? "&" : "?";
  let out = `${url}${sep}token=${encodeURIComponent(token)}`;
  if (w && h) out += `&w=${w}&h=${h}`;
  return out;
}

export function SeasonDetail({ season, show, onSelectEpisode, onBack }: SeasonDetailProps) {
  const [episodes, setEpisodes] = useState<PlexItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchChildren(season.ratingKey)
      .then((res) => { if (!cancelled) setEpisodes(res.items); })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season.ratingKey]);

  const seasonLabel = season.index != null ? `Season ${season.index}` : season.title;

  return (
    <div style={styles.page}>
      {/* Back button */}
      <button onClick={onBack} style={styles.backBtn}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      {/* Breadcrumb */}
      <div style={styles.breadcrumb}>
        <span style={styles.breadcrumbShow}>{show.title}</span>
        <span style={styles.breadcrumbSep}>&rsaquo;</span>
        <span style={styles.breadcrumbSeason}>{seasonLabel}</span>
      </div>

      {loading ? (
        <div style={styles.loadingWrap}>
          <div style={styles.spinner} />
        </div>
      ) : episodes.length === 0 ? (
        <div style={styles.empty}>No episodes found</div>
      ) : (
        <div style={styles.list}>
          {episodes.map((ep) => (
            <button
              key={ep.ratingKey}
              onClick={() => onSelectEpisode(ep)}
              style={styles.episodeRow}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                e.currentTarget.style.borderColor = "rgba(229,160,13,0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
              }}
            >
              {ep.thumb ? (
                <img src={authUrl(ep.thumb, 320, 180)} alt="" style={styles.episodeThumb} loading="lazy" />
              ) : (
                <div style={styles.episodePlaceholder}>No Image</div>
              )}
              <div style={styles.episodeInfo}>
                <div style={styles.episodeNumber}>
                  Episode {ep.index ?? "?"}
                </div>
                <div style={styles.episodeTitle}>{ep.title}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#0d0d0d",
  },
  backBtn: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    margin: "16px 24px",
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.05)",
    color: "#f0f0f0",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 500,
    fontFamily: "inherit",
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 24px 16px",
    maxWidth: "1100px",
    margin: "0 auto",
  },
  breadcrumbShow: {
    fontSize: "14px",
    color: "#888",
    fontWeight: 500,
  },
  breadcrumbSep: {
    fontSize: "16px",
    color: "#555",
  },
  breadcrumbSeason: {
    fontSize: "14px",
    color: "#e5a00d",
    fontWeight: 600,
  },
  loadingWrap: {
    display: "flex",
    justifyContent: "center",
    padding: "64px",
  },
  spinner: {
    width: "32px",
    height: "32px",
    border: "3px solid rgba(255,255,255,0.1)",
    borderTopColor: "#e5a00d",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  empty: {
    textAlign: "center",
    padding: "64px",
    color: "#666",
    fontSize: "15px",
  },
  list: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "0 24px 48px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  episodeRow: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "8px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.02)",
    cursor: "pointer",
    color: "inherit",
    textAlign: "left",
    fontFamily: "inherit",
    transition: "background 0.15s ease, border-color 0.15s ease",
    width: "100%",
  },
  episodeThumb: {
    width: "160px",
    height: "90px",
    objectFit: "cover",
    borderRadius: "6px",
    flexShrink: 0,
    background: "rgba(255,255,255,0.03)",
  },
  episodePlaceholder: {
    width: "160px",
    height: "90px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "6px",
    flexShrink: 0,
    background: "rgba(255,255,255,0.03)",
    color: "#555",
    fontSize: "12px",
    fontWeight: 500,
  },
  episodeInfo: {
    flex: 1,
    minWidth: 0,
  },
  episodeNumber: {
    fontSize: "12px",
    color: "#e5a00d",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    marginBottom: "4px",
  },
  episodeTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#e0e0e0",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
};
