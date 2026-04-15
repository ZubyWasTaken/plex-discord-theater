import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 10_000;

// Hot cache — avoids SQLite reads on every request
const sessionCache = new Map<string, { createdAt: number; userId: string | null }>();

// SQLite persistence — survives server restarts
const dbDir = process.env.THUMB_CACHE_DIR
  ? path.resolve(process.env.THUMB_CACHE_DIR)
  : path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "../../data",
    );
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "sessions.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT,
    created_at INTEGER NOT NULL
  )
`);

// Prepared statements for performance
const insertStmt = db.prepare("INSERT OR REPLACE INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)");
const selectStmt = db.prepare("SELECT user_id, created_at FROM sessions WHERE token = ?");
const deleteStmt = db.prepare("DELETE FROM sessions WHERE token = ?");
const deleteExpiredStmt = db.prepare("DELETE FROM sessions WHERE created_at < ?");
const countStmt = db.prepare("SELECT COUNT(*) as count FROM sessions");
const deleteOldestStmt = db.prepare(
  "DELETE FROM sessions WHERE token IN (SELECT token FROM sessions ORDER BY created_at ASC LIMIT ?)"
);
const selectAllStmt = db.prepare("SELECT token, user_id, created_at FROM sessions");

// Load existing valid sessions into cache on startup
const validCutoff = Date.now() - SESSION_TTL_MS;
deleteExpiredStmt.run(validCutoff);
const existingRows = db.prepare("SELECT token, user_id, created_at FROM sessions").all() as Array<{
  token: string;
  user_id: string | null;
  created_at: number;
}>;
for (const row of existingRows) {
  sessionCache.set(row.token, { createdAt: row.created_at, userId: row.user_id });
}
console.log(`[Auth] Loaded ${existingRows.length} sessions from SQLite`);

// Periodic cleanup every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [token, session] of sessionCache) {
    if (session.createdAt < cutoff) {
      sessionCache.delete(token);
    }
  }
  deleteExpiredStmt.run(cutoff);
}, 5 * 60 * 1000).unref();

export function createSession(userId?: string): string {
  const { count } = countStmt.get() as { count: number };
  if (count >= MAX_SESSIONS) {
    const toDelete = Math.floor(MAX_SESSIONS * 0.1);
    deleteOldestStmt.run(toDelete);
    // Also evict from cache — re-query to get the tokens that were deleted
    // Since SQLite already deleted them, just rebuild cache from DB
    sessionCache.clear();
    const remaining = selectAllStmt.all() as Array<{
      token: string;
      user_id: string | null;
      created_at: number;
    }>;
    for (const row of remaining) {
      sessionCache.set(row.token, { createdAt: row.created_at, userId: row.user_id });
    }
  }

  const token = crypto.randomUUID();
  const now = Date.now();
  insertStmt.run(token, userId ?? null, now);
  sessionCache.set(token, { createdAt: now, userId: userId ?? null });
  return token;
}

function getSession(token: string): { createdAt: number; userId: string | null } | null {
  // Check hot cache first
  const cached = sessionCache.get(token);
  if (cached) {
    if (Date.now() - cached.createdAt > SESSION_TTL_MS) {
      sessionCache.delete(token);
      deleteStmt.run(token);
      return null;
    }
    return cached;
  }

  // Fall back to SQLite (session created before this process, loaded lazily)
  const row = selectStmt.get(token) as { user_id: string | null; created_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > SESSION_TTL_MS) {
    deleteStmt.run(token);
    return null;
  }

  // Promote to cache
  const session = { createdAt: row.created_at, userId: row.user_id };
  sessionCache.set(token, session);
  return session;
}

export function getSessionUserId(token: string): string | null {
  const session = getSession(token);
  return session?.userId ?? null;
}

export function isValidSession(token: string): boolean {
  return getSession(token) !== null;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // VPS relay key bypass — segments proxied from the VPS have ?key= instead
  // of a Bearer token.  Scoped to the segment proxy endpoint ONLY so the key
  // cannot be used to access other Plex API routes (library browsing, metadata,
  // search, etc.).  Uses constant-time comparison to prevent timing attacks.
  const vpsKey = process.env.VPS_RELAY_KEY;
  if (
    vpsKey &&
    typeof req.query.key === "string" &&
    req.originalUrl.startsWith("/api/plex/hls/seg")
  ) {
    const keyBuf = Buffer.from(req.query.key);
    const expectedBuf = Buffer.from(vpsKey);
    if (
      keyBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(keyBuf, expectedBuf)
    ) {
      next();
      return;
    }
  }

  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (typeof req.query.token === "string" ? req.query.token : undefined);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!isValidSession(token)) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  next();
}

export function closeSessionDb(): void {
  db.close();
}
