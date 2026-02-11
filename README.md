# Plex Discord Theater

A Discord Activity that lets a host browse their Plex library and stream 1080p video to everyone in a voice channel — like Discord's "Watch Together" but for self-hosted Plex media.

## How It Works

The app runs as a Discord Activity inside an iframe. The backend proxies all Plex API calls and HLS video segments, so your Plex token never leaves the server. HLS manifests are rewritten so that segment URLs route back through the backend, meaning everything flows cleanly through Discord's Cloudflare-based proxy.

```
Plex (transcodes) → Backend (auth + URL rewrite) → Discord Proxy → Browser
```

The first user to join an Activity instance becomes the **host** and can browse the library and control playback. Other users see the library but cannot select content or control the player (sync is planned for Phase 2).

## Prerequisites

- **Node.js 22+** (or Docker)
- **A Plex Media Server** accessible from the machine running the backend
- **A Discord application** with Activities enabled
- **A public HTTPS URL** pointing to the backend (for Discord's iframe proxy)

## Setup

### 1. Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application
2. Go to **Activities > Settings** and enable Activities
3. Add a URL mapping: `/` → your server's public URL
4. Copy your **Client ID** and **Client Secret**

### 2. Get Your Plex Token

You can find your Plex token by:

1. Opening Plex Web and signing in
2. Playing any media, then opening browser DevTools (F12)
3. Going to **Network** tab, filtering for requests to your Plex server
4. Looking for `X-Plex-Token=` in the query parameters

Or follow the [official Plex guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

### 3. Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
PLEX_URL=http://localhost:32400
PLEX_TOKEN=your_plex_token
PORT=3000
```

For local development, also create `packages/client/.env`:

```env
VITE_DISCORD_CLIENT_ID=your_discord_client_id
```

### 4. Run

#### Production (Docker)

```bash
docker compose up --build
```

The app is served at `http://localhost:3000`.

#### Local Development

```bash
npm install
npm run dev
```

This starts both services concurrently:

| Service | URL | Description |
|---------|-----|-------------|
| Server  | `http://localhost:3000` | Express API with hot reload (`tsx watch`) |
| Client  | `http://localhost:5173` | Vite dev server (proxies `/api` → `:3000`) |

#### Tunnel for Discord

Discord Activities require a public HTTPS URL. For local dev, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# Install (macOS)
brew install cloudflared

# Start a quick tunnel
cloudflared tunnel --url http://localhost:5173
```

This gives you a `https://xxxx.trycloudflare.com` URL. Set this as the URL mapping in your Discord app's Activities settings.

> **Note:** The tunnel URL changes every restart. Use a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) for a stable URL, or update the mapping in the Developer Portal each time.

### 5. Launch the Activity

1. Join a voice channel in Discord
2. Click the **Activities** (rocket) icon in the voice channel toolbar
3. Select your app from the list
4. The Activity loads in an iframe — the Discord SDK authenticates you and you'll see the Plex library

## Project Structure

```
plex-discord-theater/
├── docker-compose.yml          # Production deployment
├── Dockerfile                  # Multi-stage build (client + server)
├── package.json                # npm workspaces root
├── tsconfig.base.json          # Shared TypeScript config
│
├── packages/server/            # Express backend
│   └── src/
│       ├── index.ts            # App entry — serves API + static SPA
│       ├── routes/
│       │   ├── discord.ts      # POST /api/token — OAuth2 code exchange
│       │   │                   # POST /api/register — host detection
│       │   └── plex.ts         # GET  /api/plex/sections — library sections
│       │                       # GET  /api/plex/sections/:id/all — section items
│       │                       # GET  /api/plex/search?q= — search
│       │                       # GET  /api/plex/meta/:id — item metadata
│       │                       # GET  /api/plex/thumb/* — image proxy
│       │                       # GET  /api/plex/hls/:id/master.m3u8 — start HLS
│       │                       # GET  /api/plex/hls/seg/* — segment proxy
│       │                       # GET  /api/plex/hls/ping/:sid — keep-alive
│       │                       # DELETE /api/plex/hls/session/:sid — stop
│       ├── services/
│       │   └── plex.ts         # Plex API client (token injected server-side)
│       └── middleware/
│           └── auth.ts         # Session validation (placeholder for Phase 2)
│
└── packages/client/            # React SPA (Vite)
    └── src/
        ├── main.tsx            # React entry point
        ├── App.tsx             # Root component — library vs player view
        ├── hooks/
        │   └── useDiscord.ts   # Discord SDK init, auth flow, host detection
        ├── components/
        │   ├── Library.tsx     # Section tabs + poster grid
        │   ├── Search.tsx      # Debounced search bar
        │   ├── MovieCard.tsx   # Poster thumbnail + title + year
        │   ├── Player.tsx      # hls.js video player + session management
        │   └── Controls.tsx    # Play/pause, seek bar, volume (host only)
        └── lib/
            └── api.ts          # Typed fetch helpers for all /api/plex/* routes
```

## Architecture Notes

- **Plex token stays server-side.** The client never sees `X-Plex-Token`. All Plex requests go through the Express backend which injects auth.
- **HLS manifest rewriting.** When the backend fetches an m3u8 from Plex, it rewrites all segment/sub-manifest URLs to point back through `/api/plex/hls/seg/*`. Sub-manifests are also rewritten on the fly.
- **Session lifecycle.** Starting playback creates a UUID session. The client pings every 30 seconds to keep the transcode alive. On cleanup (unmount or navigate away), the session is stopped.
- **Single URL mapping.** Only one Discord URL mapping is needed (`/` → your server). The backend handles all routing.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to Discord" | Make sure you're launching the app as a Discord Activity from a voice channel, not visiting the URL directly |
| Library is empty | Check that `PLEX_URL` and `PLEX_TOKEN` are correct. The server must be able to reach Plex |
| Video won't play | Check browser console for HLS errors. Ensure Plex can transcode (check Plex dashboard for active sessions) |
| Posters not loading | The image proxy should handle this — check server logs for `Thumb proxy error` messages |
| Tunnel URL changed | Update the URL mapping in Discord Developer Portal → Activities → URL Mappings |

## Phase 2 (Future)

- WebSocket-based playback sync (host controls propagate to all viewers)
- TV show season/episode browser
- Resume playback / watch history
- Quality selector (720p/1080p/4K)
- Subtitle support
- "Up Next" queue
