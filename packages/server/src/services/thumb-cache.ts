import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_MAX_MB = 500;

const TTL_MS = parseInt(process.env.THUMB_CACHE_TTL_MS || "", 10) || DEFAULT_TTL_MS;
const MAX_BYTES =
  (parseInt(process.env.THUMB_CACHE_MAX_MB || "", 10) || DEFAULT_MAX_MB) * 1024 * 1024;

const dbDir = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../data",
);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "thumb-cache.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS thumbs (
    path TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BLOB NOT NULL,
    cached_at INTEGER NOT NULL
  )
`);

const stmtGet = db.prepare<[string], { content_type: string; data: Buffer; cached_at: number }>(
  "SELECT content_type, data, cached_at FROM thumbs WHERE path = ?",
);

const stmtSet = db.prepare(
  "INSERT OR REPLACE INTO thumbs (path, content_type, data, cached_at) VALUES (?, ?, ?, ?)",
);

const stmtDeleteExpired = db.prepare("DELETE FROM thumbs WHERE cached_at < ?");

const stmtTotalSize = db.prepare<[], { total: number }>(
  "SELECT COALESCE(SUM(LENGTH(data)), 0) AS total FROM thumbs",
);

const stmtEvictOldest = db.prepare(
  "DELETE FROM thumbs WHERE path IN (SELECT path FROM thumbs ORDER BY cached_at ASC LIMIT ?)",
);

interface CacheEntry {
  contentType: string;
  data: Buffer;
}

export function get(thumbPath: string): CacheEntry | null {
  const row = stmtGet.get(thumbPath);
  if (!row) return null;

  // Check TTL
  if (Date.now() - row.cached_at > TTL_MS) {
    db.prepare("DELETE FROM thumbs WHERE path = ?").run(thumbPath);
    return null;
  }

  return { contentType: row.content_type, data: row.data };
}

export function set(thumbPath: string, contentType: string, data: Buffer): void {
  stmtSet.run(thumbPath, contentType, data, Date.now());

  // Lazy eviction: remove expired entries
  stmtDeleteExpired.run(Date.now() - TTL_MS);

  // Evict oldest entries in batches until under size limit
  let { total } = stmtTotalSize.get() ?? { total: 0 };
  while (total > MAX_BYTES) {
    const changes = stmtEvictOldest.run(50).changes;
    if (changes === 0) break; // nothing left to evict
    total = (stmtTotalSize.get() ?? { total: 0 }).total;
  }
}

export function close(): void {
  db.close();
}
