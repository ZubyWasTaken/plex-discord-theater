import { Router, type Request, type Response } from "express";
import { createSession } from "../middleware/auth.js";

const router = Router();

const INSTANCE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_INSTANCES = 10_000;
const instanceHosts = new Map<string, { hostUserId: string; createdAt: number }>();

function pruneStaleInstances(): void {
  const now = Date.now();
  for (const [id, entry] of instanceHosts) {
    if (now - entry.createdAt > INSTANCE_TTL_MS) {
      instanceHosts.delete(id);
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
    const sessionToken = createSession();
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
  const { instanceId, userId } = req.body;
  if (!instanceId || !userId) {
    res.status(400).json({ error: "Missing instanceId or userId" });
    return;
  }

  if (typeof instanceId !== "string" || typeof userId !== "string") {
    res.status(400).json({ error: "Invalid parameter types" });
    return;
  }

  if (instanceId.length > 200 || userId.length > 200) {
    res.status(400).json({ error: "Parameters too long" });
    return;
  }

  pruneStaleInstances();

  if (instanceHosts.size >= MAX_INSTANCES) {
    // Evict oldest 10% before rejecting
    const toEvict = Math.max(1, Math.floor(MAX_INSTANCES * 0.1));
    const oldest = [...instanceHosts.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, toEvict);
    for (const [id] of oldest) instanceHosts.delete(id);
  }

  if (!instanceHosts.has(instanceId)) {
    instanceHosts.set(instanceId, { hostUserId: userId, createdAt: Date.now() });
  }

  const hostId = instanceHosts.get(instanceId)!.hostUserId;
  res.json({ isHost: hostId === userId, hostId });
});

export default router;
