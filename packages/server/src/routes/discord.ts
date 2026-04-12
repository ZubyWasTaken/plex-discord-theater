import { Router, type Request, type Response } from "express";
import { createSession, isValidSession, getSessionUserId } from "../middleware/auth.js";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const router = Router();

/** Comma-separated guild IDs that are allowed to use this activity */
const ALLOWED_GUILD_IDS = new Set(
  (process.env.ALLOWED_GUILD_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
);

const INSTANCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INSTANCES = 10_000;
export const instanceHosts = new Map<string, { hostUserId: string; guildId: string; createdAt: number }>();
/** Maps guildId → active instanceId (one activity per server) */
const guildInstances = new Map<string, string>();

// SQLite persistence for instance registrations
const dbDir = process.env.THUMB_CACHE_DIR
  ? path.resolve(process.env.THUMB_CACHE_DIR)
  : path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "../../data",
    );
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(path.join(dbDir, "instances.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    instance_id TEXT PRIMARY KEY,
    host_user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const insertInstanceStmt = db.prepare(
  "INSERT OR REPLACE INTO instances (instance_id, host_user_id, guild_id, created_at) VALUES (?, ?, ?, ?)"
);
const deleteInstanceStmt = db.prepare("DELETE FROM instances WHERE instance_id = ?");
const deleteExpiredInstancesStmt = db.prepare("DELETE FROM instances WHERE created_at < ?");

// Load existing valid instances into memory on startup
const validCutoff = Date.now() - INSTANCE_TTL_MS;
deleteExpiredInstancesStmt.run(validCutoff);
const existingInstances = db.prepare("SELECT instance_id, host_user_id, guild_id, created_at FROM instances").all() as Array<{
  instance_id: string;
  host_user_id: string;
  guild_id: string;
  created_at: number;
}>;
for (const row of existingInstances) {
  instanceHosts.set(row.instance_id, {
    hostUserId: row.host_user_id,
    guildId: row.guild_id,
    createdAt: row.created_at,
  });
  guildInstances.set(row.guild_id, row.instance_id);
}
console.log(`[Discord] Loaded ${existingInstances.length} instances from SQLite`);

export function closeInstanceDb(): void {
  db.close();
}

function pruneStaleInstances(): void {
  const now = Date.now();
  for (const [id, entry] of instanceHosts) {
    if (now - entry.createdAt > INSTANCE_TTL_MS) {
      instanceHosts.delete(id);
      deleteInstanceStmt.run(id);
      // Clean up guild mapping too
      if (guildInstances.get(entry.guildId) === id) {
        guildInstances.delete(entry.guildId);
      }
    }
  }
}

// Periodic pruning every 5 minutes
setInterval(pruneStaleInstances, 5 * 60 * 1000).unref();

/**
 * POST /api/token
 * Exchange Discord OAuth2 authorization code for access token.
 */
router.post("/token", async (req: Request, res: Response) => {
  const { code } = req.body;
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }
  if (code.length > 256) {
    res.status(400).json({ error: "Invalid authorization code" });
    return;
  }

  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI!,
      }),
    });

    if (!response.ok) {
      console.error("Discord token exchange failed:", response.status);
      const clientStatus = response.status >= 500 ? 502 : 400;
      res.status(clientStatus).json({ error: "Token exchange failed" });
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      console.error("Failed to parse Discord token response");
      res.status(502).json({ error: "Invalid response from Discord" });
      return;
    }
    if (!data.access_token || typeof data.access_token !== "string") {
      console.error("Discord response missing access_token");
      res.status(502).json({ error: "Invalid response from Discord" });
      return;
    }

    // Fetch verified Discord userId to bind to the session
    let discordUserId: string | undefined;
    try {
      const meRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { id?: string };
        discordUserId = me.id;
      }
    } catch {
      // Non-fatal — session will work but userId won't be verified
    }

    const sessionToken = createSession(discordUserId);
    res.json({ access_token: data.access_token, session_token: sessionToken });
  } catch (err) {
    console.error("Token exchange error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/register
 * Register the first user per instanceId as the host.
 */
router.post("/register", (req: Request, res: Response) => {
  const { instanceId, userId, guildId } = req.body;
  if (!instanceId || !userId || !guildId) {
    res.status(400).json({ error: "Missing instanceId, userId, or guildId" });
    return;
  }

  if (typeof instanceId !== "string" || typeof userId !== "string" || typeof guildId !== "string") {
    res.status(400).json({ error: "Invalid parameter types" });
    return;
  }

  if (instanceId.length > 200 || userId.length > 200 || guildId.length > 200) {
    res.status(400).json({ error: "Parameters too long" });
    return;
  }

  // Verify session token and that the claimed userId matches the authenticated identity
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token || !isValidSession(token)) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const verifiedUserId = getSessionUserId(token);
  if (!verifiedUserId) {
    res.status(403).json({ error: "Session has no verified identity" });
    return;
  }
  if (verifiedUserId !== userId) {
    res.status(403).json({ error: "userId does not match authenticated identity" });
    return;
  }

  pruneStaleInstances();

  // Reject guilds not in the allowlist
  if (ALLOWED_GUILD_IDS.size > 0 && !ALLOWED_GUILD_IDS.has(guildId)) {
    res.status(403).json({ error: "This server is not authorized to use this activity." });
    return;
  }

  // One active instance per guild — replace stale instances instead of blocking
  const existingInstanceId = guildInstances.get(guildId);
  if (existingInstanceId && existingInstanceId !== instanceId && instanceHosts.has(existingInstanceId)) {
    // Remove the old instance so the new one can take over
    deleteInstanceStmt.run(existingInstanceId);
    instanceHosts.delete(existingInstanceId);
    guildInstances.delete(guildId);
  }

  if (instanceHosts.size >= MAX_INSTANCES) {
    // Evict oldest 10% before rejecting
    const toEvict = Math.max(1, Math.floor(MAX_INSTANCES * 0.1));
    const oldest = [...instanceHosts.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, toEvict);
    for (const [id, entry] of oldest) {
      if (guildInstances.get(entry.guildId) === id) {
        guildInstances.delete(entry.guildId);
      }
      deleteInstanceStmt.run(id);
      instanceHosts.delete(id);
    }
  }

  if (!instanceHosts.has(instanceId)) {
    instanceHosts.set(instanceId, { hostUserId: userId, guildId, createdAt: Date.now() });
    guildInstances.set(guildId, instanceId);
    insertInstanceStmt.run(instanceId, userId, guildId, Date.now());
  }

  const hostId = instanceHosts.get(instanceId)!.hostUserId;
  res.json({ isHost: hostId === userId, hostId });
});

/** Check if a userId is host for any active instance. */
export function isUserHost(userId: string): boolean {
  for (const entry of instanceHosts.values()) {
    if (entry.hostUserId === userId) return true;
  }
  return false;
}

export default router;
