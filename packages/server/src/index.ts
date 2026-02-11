import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import discordRoutes from "./routes/discord.js";
import plexRoutes from "./routes/plex.js";
import { requireAuth } from "./middleware/auth.js";

const required = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "PLEX_URL", "PLEX_TOKEN"] as const;
for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (!allowedOrigins || allowedOrigins.length === 0) {
  console.error("Missing required environment variable: ALLOWED_ORIGINS");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        mediaSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
    frameguard: false, // Allow Discord iframe embedding
  }),
);

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "DELETE"],
  }),
);

app.use(express.json({ limit: "10kb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many authentication attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

const hlsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3000, // HLS segments: ~1 req/2-10s per stream
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/token", authLimiter);
app.use("/api/register", authLimiter);
app.use("/api/plex/hls/seg", hlsLimiter);
app.use("/api", apiLimiter);

app.use("/api", discordRoutes);
app.use("/api/plex", requireAuth, plexRoutes);

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.sendFile(path.join(clientDist, "index.html"));
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => process.exit(0));
});
