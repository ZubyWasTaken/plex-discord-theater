import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { plexFetch, plexJSON, plexUrl } from "../services/plex.js";

const router = Router();

// ─── Types ──────────────────────────────────────────────────────

interface PlexDirectory {
  key: string;
  title: string;
  type: string;
}

interface PlexMetadataItem {
  ratingKey: string;
  title: string;
  year?: number;
  type: string;
  thumb?: string;
  summary?: string;
  duration?: number;
  art?: string;
  Genre?: Array<{ tag: string }>;
}

// ─── Library browsing ────────────────────────────────────────────

/**
 * GET /api/plex/sections
 * List all library sections (Movies, TV Shows, etc.)
 */
router.get("/sections", async (_req: Request, res: Response) => {
  try {
    const data = await plexJSON<{ MediaContainer: { Directory?: PlexDirectory[] } }>("/library/sections");
    const directories = data.MediaContainer.Directory || [];
    const sections = directories.map((d) => ({
      id: d.key,
      title: d.title,
      type: d.type,
    }));
    res.json({ sections });
  } catch (err) {
    console.error("Sections error:", err);
    res.status(502).json({ error: "Failed to fetch library sections" });
  }
});

/**
 * GET /api/plex/sections/:id/all
 * List all items in a library section.
 */
router.get("/sections/:id/all", async (req: Request, res: Response) => {
  try {
    const data = await plexJSON<{ MediaContainer: { Metadata?: PlexMetadataItem[] } }>(
      `/library/sections/${req.params.id}/all`,
    );
    const items = (data.MediaContainer.Metadata || []).map(mapItem);
    res.json({ items });
  } catch (err) {
    console.error("Section items error:", err);
    res.status(502).json({ error: "Failed to fetch section items" });
  }
});

/**
 * GET /api/plex/search?q=<query>
 * Search across all Plex libraries.
 */
router.get("/search", async (req: Request, res: Response) => {
  const q = req.query.q;
  if (!q || typeof q !== "string") {
    res.status(400).json({ error: "Missing query parameter q" });
    return;
  }
  if (q.length > 200) {
    res.status(400).json({ error: "Query too long" });
    return;
  }

  try {
    const data = await plexJSON<{
      MediaContainer: { Hub?: Array<{ Metadata?: PlexMetadataItem[] }> };
    }>("/hubs/search", { query: q });
    const hubs = data.MediaContainer.Hub || [];
    const items: ReturnType<typeof mapItem>[] = [];
    for (const hub of hubs) {
      if (!hub.Metadata) continue;
      for (const m of hub.Metadata) {
        items.push(mapItem(m));
      }
    }
    res.json({ items });
  } catch (err) {
    console.error("Search error:", err);
    res.status(502).json({ error: "Failed to search Plex" });
  }
});

/**
 * GET /api/plex/meta/:ratingKey
 * Get detailed metadata for a single item.
 */
router.get("/meta/:ratingKey", async (req: Request, res: Response) => {
  try {
    const data = await plexJSON<{ MediaContainer: { Metadata?: PlexMetadataItem[] } }>(
      `/library/metadata/${req.params.ratingKey}`,
    );
    const metadata = data.MediaContainer.Metadata;
    if (!metadata || metadata.length === 0) {
      res.status(404).json({ error: "Item not found" });
      return;
    }
    const m = metadata[0];
    res.json({
      ratingKey: m.ratingKey,
      title: m.title,
      year: m.year,
      summary: m.summary,
      duration: m.duration,
      thumb: m.thumb ? `/api/plex/thumb${m.thumb}` : null,
      art: m.art ? `/api/plex/thumb${m.art}` : null,
      genres: (m.Genre || []).map((g) => g.tag),
      type: m.type,
    });
  } catch (err) {
    console.error("Metadata error:", err);
    res.status(502).json({ error: "Failed to fetch metadata" });
  }
});

// ─── Image proxy ────────────────────────────────────────────────

/**
 * GET /api/plex/thumb/*
 * Proxy Plex images (posters, artwork).
 */
router.get("/thumb/*", async (req: Request, res: Response) => {
  const imagePath = "/" + req.params[0];
  if (!isAllowedProxyPath(imagePath)) {
    res.status(400).end();
    return;
  }

  try {
    const plexRes = await plexFetch(imagePath);
    if (!plexRes.ok) {
      res.status(plexRes.status).end();
      return;
    }
    const contentType = plexRes.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");

    await pipeBody(plexRes.body, res);
  } catch (err) {
    console.error("Thumb proxy error:", err);
    res.status(502).end();
  }
});

// ─── HLS streaming ──────────────────────────────────────────────

/**
 * GET /api/plex/hls/:ratingKey/master.m3u8
 * Start a Plex HLS transcode session and return rewritten manifest.
 */
router.get(
  "/hls/:ratingKey/master.m3u8",
  async (req: Request, res: Response) => {
    const { ratingKey } = req.params;
    const sessionId = uuidv4();

    try {
      const plexRes = await plexFetch(
        "/video/:/transcode/universal/start.m3u8",
        {
          path: `/library/metadata/${ratingKey}`,
          protocol: "hls",
          directPlay: "0",
          directStream: "1",
          videoResolution: "1920x1080",
          maxVideoBitrate: "20000",
          videoQuality: "100",
          session: sessionId,
          fastSeek: "1",
          "X-Plex-Client-Identifier": "plex-discord-theater",
          "X-Plex-Product": "Plex Discord Theater",
        },
      );

      if (!plexRes.ok) {
        const text = await plexRes.text();
        console.error("HLS start error:", plexRes.status, text);
        res.status(plexRes.status).json({ error: "Failed to start transcode" });
        return;
      }

      const m3u8 = await plexRes.text();
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("X-Session-Id", sessionId);
      res.send(rewriteManifestUrls(m3u8));
    } catch (err) {
      console.error("HLS start error:", err);
      res.status(502).json({ error: "Failed to start HLS session" });
    }
  },
);

/**
 * GET /api/plex/hls/seg/*
 * Proxy HLS segments and sub-manifests from Plex.
 */
router.get("/hls/seg/*", async (req: Request, res: Response) => {
  const segPath = "/" + req.params[0];
  if (!isAllowedProxyPath(segPath)) {
    res.status(400).end();
    return;
  }

  try {
    const url = plexUrl(segPath);
    const plexRes = await fetch(url);

    if (!plexRes.ok) {
      res.status(plexRes.status).end();
      return;
    }

    const contentType = plexRes.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    } else if (segPath.endsWith(".ts")) {
      res.setHeader("Content-Type", "video/MP2T");
    } else if (segPath.endsWith(".m3u8")) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    }

    // If this is a sub-manifest, rewrite URLs too
    if (segPath.endsWith(".m3u8")) {
      const m3u8 = await plexRes.text();
      res.send(rewriteManifestUrls(m3u8));
      return;
    }

    await pipeBody(plexRes.body, res);
  } catch (err) {
    console.error("HLS segment proxy error:", err);
    res.status(502).end();
  }
});

/**
 * GET /api/plex/hls/ping/:sessionId
 * Keep a transcode session alive.
 */
router.get("/hls/ping/:sessionId", async (req: Request, res: Response) => {
  try {
    await plexFetch("/video/:/transcode/universal/ping", {
      session: req.params.sessionId as string,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Ping error:", err);
    res.status(502).json({ error: "Ping failed" });
  }
});

/**
 * DELETE /api/plex/hls/session/:sessionId
 * Stop a transcode session.
 */
router.delete(
  "/hls/session/:sessionId",
  async (req: Request, res: Response) => {
    try {
      await plexFetch("/video/:/transcode/universal/stop", {
        session: req.params.sessionId as string,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error("Stop session error:", err);
      res.status(502).json({ error: "Stop failed" });
    }
  },
);

// ─── Helpers ────────────────────────────────────────────────────

function mapItem(m: PlexMetadataItem) {
  return {
    ratingKey: m.ratingKey,
    title: m.title,
    year: m.year,
    type: m.type,
    thumb: m.thumb ? `/api/plex/thumb${m.thumb}` : null,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reject paths with traversal sequences, double slashes, or null bytes. */
function isAllowedProxyPath(p: string): boolean {
  const decoded = decodeURIComponent(p);
  return !decoded.includes("..") && !decoded.includes("//") && !decoded.includes("\0");
}

/** Rewrite absolute and relative Plex URLs in an m3u8 manifest. */
function rewriteManifestUrls(m3u8: string): string {
  const plexBase = process.env.PLEX_URL!.replace(/\/$/, "");
  let result = m3u8;

  result = result.replace(
    new RegExp(escapeRegExp(plexBase) + "(/[^\\s]+)", "g"),
    (_match: string, path: string) => {
      const cleanPath = path.replace(/[?&]X-Plex-Token=[^&\s]*/g, "");
      return `/api/plex/hls/seg${cleanPath}`;
    },
  );

  result = result.replace(
    /^(?!#)(?!https?:\/\/)(?!\/api\/plex\/)(.+\.(?:m3u8|ts).*)$/gm,
    (_match: string, path: string) => {
      const cleanPath = path.replace(/[?&]X-Plex-Token=[^&\s]*/g, "");
      return `/api/plex/hls/seg/${cleanPath}`;
    },
  );

  return result;
}

/** Stream a fetch response body to an Express response, with error logging. */
async function pipeBody(
  body: ReadableStream<Uint8Array> | null,
  res: Response,
): Promise<void> {
  if (!body) {
    res.end();
    return;
  }
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded) break;
      res.write(value);
    }
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error("Stream pipe error:", err);
    if (!res.writableEnded) res.end();
  }
}

export default router;
