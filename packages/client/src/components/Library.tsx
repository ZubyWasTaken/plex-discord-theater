import { useState, useEffect, useCallback } from "react";
import { Search } from "./Search";
import { MovieCard } from "./MovieCard";
import {
  fetchSections,
  fetchSectionItems,
  searchPlex,
  type PlexItem,
  type PlexSection,
} from "../lib/api";

interface LibraryProps {
  isHost: boolean;
  onSelect: (item: PlexItem) => void;
}

export function Library({ isHost, onSelect }: LibraryProps) {
  const [sections, setSections] = useState<PlexSection[]>([]);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [items, setItems] = useState<PlexItem[]>([]);
  const [searchResults, setSearchResults] = useState<PlexItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Load sections on mount
  useEffect(() => {
    fetchSections()
      .then(({ sections: s }) => {
        setSections(s);
        if (s.length > 0) setActiveSection(s[0].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Load items when section changes
  useEffect(() => {
    if (!activeSection) return;
    const controller = new AbortController();
    setLoading(true);
    fetchSectionItems(activeSection, { signal: controller.signal })
      .then(({ items: i }) => setItems(i))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [activeSection]);

  const handleSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const { items: results } = await searchPlex(query);
      setSearchResults(results);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setLoading(false);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchResults(null);
  }, []);

  const handleClick = useCallback(
    (item: PlexItem) => {
      if (isHost) onSelect(item);
    },
    [isHost, onSelect],
  );

  const displayItems = searchResults ?? items;

  return (
    <div style={styles.container}>
      <Search onSearch={handleSearch} onClear={handleClearSearch} />

      {/* Section tabs */}
      {!searchResults && sections.length > 1 && (
        <div style={styles.tabs}>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                ...styles.tab,
                ...(s.id === activeSection ? styles.tabActive : {}),
              }}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}

      {!isHost && (
        <div style={styles.notice}>
          Waiting for the host to pick something to watch...
        </div>
      )}

      {loading ? (
        <div style={styles.loading}>Loading...</div>
      ) : displayItems.length === 0 ? (
        <div style={styles.loading}>No items found</div>
      ) : (
        <div style={styles.grid}>
          {displayItems.map((item) => (
            <MovieCard key={item.ratingKey} item={item} onClick={handleClick} />
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: "1200px",
    margin: "0 auto",
  },
  tabs: {
    display: "flex",
    gap: "8px",
    padding: "0 16px 12px",
  },
  tab: {
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #333",
    background: "transparent",
    color: "#888",
    cursor: "pointer",
    fontSize: "14px",
  },
  tabActive: {
    background: "#e5a00d",
    color: "#000",
    borderColor: "#e5a00d",
    fontWeight: 600,
  },
  notice: {
    textAlign: "center",
    color: "#888",
    padding: "8px 16px",
    fontSize: "14px",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "16px",
    padding: "16px",
  },
  loading: {
    textAlign: "center",
    padding: "48px",
    color: "#888",
  },
};
