import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSIONS = 10_000;

interface Session {
  createdAt: number;
  userId: string | null;
}

const sessions = new Map<string, Session>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}, 5 * 60 * 1000).unref();

export function createSession(userId?: string): string {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, Math.floor(MAX_SESSIONS * 0.1));
    for (const [token] of oldest) sessions.delete(token);
  }
  const token = crypto.randomUUID();
  sessions.set(token, { createdAt: Date.now(), userId: userId ?? null });
  return token;
}

/** Return the verified Discord userId bound to this session, or null if not set. */
export function getSessionUserId(token: string): string | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session.userId;
}

export function isValidSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : (typeof req.query.token === "string" ? req.query.token : undefined);

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const session = sessions.get(token);
  if (!session || Date.now() - session.createdAt > SESSION_TTL_MS) {
    if (session) sessions.delete(token);
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  next();
}
