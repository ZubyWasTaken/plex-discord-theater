import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "./Search";
import { FilterBar } from "./FilterBar";
import { MovieCard } from "./MovieCard";
import { SkeletonGrid } from "./SkeletonGrid";
import {
  fetchSections,
  fetchSectionItems,
  fetchGenres,
  searchPlex,
  type PlexItem,
  type PlexSection,
  type Genre,
} from "../lib/api";

const PAGE_SIZE = 50;

interface LibraryProps {
  isHost: boolean;
  onSelect: (item: PlexItem) => void;
  activeSection: string | null;
  onActiveSectionChange: (id: string) => void;
}

export function Library({ isHost, onSelect, activeSection, onActiveSectionChange }: LibraryProps) {
  const [sections, setSections] = useState<PlexSection[]>([]);
  const [items, setItems] = useState<PlexItem[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [searchResults, setSearchResults] = useState<PlexItem[] | null>(null);
  const rawSearchResults = useRef<PlexItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [sort, setSort] = useState("titleSort:asc");
  const loadMoreAbort = useRef<AbortController | null>(null);

  // Load sections on mount
  useEffect(() => {
    fetchSections()
      .then(({ sections: s }) => {
        setSections(s);
        // Only default to first section if no section is persisted from a previous visit
        if (s.length > 0 && !activeSection) onActiveSectionChange(s[0].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch genres when section changes
  useEffect(() => {
    if (!activeSection) return;
    setGenres([]);
    setSelectedGenres([]);
    setSort("titleSort:asc");
    fetchGenres(activeSection)
      .then((res) => setGenres(res.genres))
      .catch(console.error);
  }, [activeSection]);

  // Load items when section, genres, or sort changes
  useEffect(() => {
    if (!activeSection) return;
    // Cancel any in-flight load-more request
    loadMoreAbort.current?.abort();
    loadMoreAbort.current = null;
    setLoadingMore(false);
    const controller = new AbortController();
    setLoading(true);
    setItems([]);
    setTotalSize(0);
    fetchSectionItems(activeSection, {
      signal: controller.signal,
      start: 0,
      size: PAGE_SIZE,
      genre: selectedGenres.length > 0 ? selectedGenres : undefined,
      sort,
    })
      .then((res) => {
        setItems(res.items);
        setTotalSize(res.totalSize);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [activeSection, selectedGenres, sort]);

  const handleLoadMore = useCallback(() => {
    if (!activeSection || loadingMore) return;
    const controller = new AbortController();
    loadMoreAbort.current = controller;
    setLoadingMore(true);
    fetchSectionItems(activeSection, {
      signal: controller.signal,
      start: items.length,
      size: PAGE_SIZE,
      genre: selectedGenres.length > 0 ? selectedGenres : undefined,
      sort,
    })
      .then((res) => {
        setItems((prev) => [...prev, ...res.items]);
        setTotalSize(res.totalSize);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error(err);
      })
      .finally(() => setLoadingMore(false));
  }, [activeSection, items.length, loadingMore, selectedGenres, sort]);

  // Find the active section's type ("movie" or "show") to filter search results
  const activeSectionType = sections.find((s) => s.id === activeSection)?.type;

  const handleSearch = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const { items: results } = await searchPlex(query);
      rawSearchResults.current = results;
      // Filter by active tab: Movies tab → only movies, TV Shows tab → only shows (no episodes/seasons)
      const filtered = activeSectionType
        ? results.filter((item) => item.type === activeSectionType)
        : results;
      setSearchResults(filtered);
    } catch (err) {
      console.error("Search failed:", err);
    }
    setLoading(false);
  }, [activeSectionType]);

  // Re-filter search results when switching tabs during an active search
  useEffect(() => {
    if (!rawSearchResults.current) return;
    const filtered = activeSectionType
      ? rawSearchResults.current.filter((item) => item.type === activeSectionType)
      : rawSearchResults.current;
    setSearchResults(filtered);
  }, [activeSectionType]);

  const handleClearSearch = useCallback(() => {
    rawSearchResults.current = null;
    setSearchResults(null);
  }, []);

  const handleClick = useCallback(
    (item: PlexItem) => {
      onSelect(item);
    },
    [onSelect],
  );

  const displayItems = searchResults ?? items;
  const hasMore = !searchResults && items.length < totalSize;

  return (
    <div style={styles.container}>
      <Search onSearch={handleSearch} onClear={handleClearSearch} />

      {/* Filter bar (hidden during search) */}
      {!searchResults && genres.length > 0 && (
        <FilterBar
          genres={genres}
          selectedGenres={selectedGenres}
          onGenresChange={setSelectedGenres}
          sort={sort}
          onSortChange={setSort}
        />
      )}

      {/* Section tabs — visible during search so user can switch result type */}
      {sections.length > 1 && (
        <div style={styles.tabs}>
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => onActiveSectionChange(s.id)}
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


      {loading ? (
        <SkeletonGrid />
      ) : displayItems.length === 0 ? (
        <div style={styles.empty}>No items found</div>
      ) : (
        <>
          <div style={styles.grid}>
            {displayItems.map((item) => (
              <MovieCard key={item.ratingKey} item={item} onClick={handleClick} />
            ))}
          </div>
          {hasMore && (
            <div style={styles.loadMoreWrap}>
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={styles.loadMoreBtn}
                onMouseEnter={(e) => {
                  if (!loadingMore) e.currentTarget.style.borderColor = "rgba(229,160,13,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                }}
              >
                {loadingMore ? "Loading..." : `Load More (${items.length} of ${totalSize})`}
              </button>
            </div>
          )}
        </>
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
    padding: "0 24px 16px",
  },
  tab: {
    padding: "8px 20px",
    borderRadius: "20px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "#888",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily: "inherit",
    transition: "all 0.2s ease",
  },
  tabActive: {
    background: "rgba(229,160,13,0.15)",
    color: "#e5a00d",
    borderColor: "rgba(229,160,13,0.3)",
    fontWeight: 600,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
    gap: "14px",
    padding: "16px 24px",
  },
  empty: {
    textAlign: "center",
    padding: "64px",
    color: "#666",
    fontSize: "15px",
  },
  loadMoreWrap: {
    display: "flex",
    justifyContent: "center",
    padding: "8px 24px 32px",
  },
  loadMoreBtn: {
    padding: "10px 28px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color: "#aaa",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 500,
    fontFamily: "inherit",
    transition: "all 0.2s ease",
  },
};
