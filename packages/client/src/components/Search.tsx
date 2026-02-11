import { useState, useCallback, useRef, useEffect } from "react";

interface SearchProps {
  onSearch: (query: string) => void;
  onClear: () => void;
}

export function Search({ onSearch, onClear }: SearchProps) {
  const [value, setValue] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setValue(q);

      clearTimeout(debounceRef.current);
      if (q.trim().length === 0) {
        onClear();
        return;
      }
      debounceRef.current = setTimeout(() => onSearch(q.trim()), 400);
    },
    [onSearch, onClear],
  );

  return (
    <div style={styles.container}>
      <input
        type="text"
        placeholder="Search your Plex library..."
        value={value}
        onChange={handleChange}
        style={styles.input}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "16px",
  },
  input: {
    width: "100%",
    padding: "12px 16px",
    fontSize: "16px",
    borderRadius: "8px",
    border: "1px solid #333",
    background: "#16213e",
    color: "#e0e0e0",
    outline: "none",
  },
};
