# Plex Discord Theater

A Discord Activity that lets you browse your Plex library and watch movies and TV shows together in a voice channel — synchronized playback, host controls, and all streamed through Discord.

## Features

- **Browse your Plex library** — movies and TV shows with search, genre filters, and sorting
- **Synchronized playback** — the host controls play/pause/seek and all viewers stay in sync
- **Audio & subtitle selection** — pick audio tracks and subtitles before playing
- **P2P segment sharing** — viewers share HLS segments with each other, reducing server bandwidth
- **Automatic host promotion** — if the host leaves, the next viewer is promoted so the session continues
- **Thumbnail caching** — artwork is cached server-side in SQLite for fast browsing
- **Persistent sessions** — sessions and host roles survive server restarts (SQLite-backed)
- **Secure** — your Plex token never leaves the server; the backend proxies everything

## How It Works

```
Discord Voice Channel
  └─ Activity (iframe)
       └─ React client (hls.js + P2P)
            ├─ WebRTC ↔ other viewers (segment sharing)
            └─ Express backend (WebSocket sync + API proxy)
                 └─ Plex Media Server (HLS transcoding)
```

The first user to join becomes the host and can browse the library and start playback. Everyone else watches in sync via WebSocket. The backend proxies all Plex API calls and HLS video segments so nothing is exposed directly to clients.

### P2P Segment Sharing

Viewers in the same watch session automatically form a peer-to-peer mesh using WebRTC. When one viewer downloads an HLS segment from the server, they share it directly with other viewers — so the same segment doesn't need to be fetched from Plex multiple times.

- **BitTorrent tracker** — the server runs an embedded [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker) over WebSocket for peer discovery and signaling
- **Swarm per session** — viewers watching the same content share a swarm ID, so P2P only happens within a watch session
- **Transparent fallback** — if a segment isn't available from peers in time, it falls back to fetching from the server normally
- **Tuned for live-ish playback** — P2P prefetch window of 30s with 6s HTTP window and 2 concurrent HTTP downloads, so peers have time to supply segments before the client fetches them directly
- **NAT traversal** — uses a STUN server for WebRTC connections behind NAT

This significantly reduces bandwidth from Plex when multiple people are watching together — the server transcodes once and peers distribute segments amongst themselves.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Client | React, hls.js, [p2p-media-loader](https://github.com/nicedoc/p2p-media-loader), Discord Embedded App SDK |
| Server | Express, WebSocket (ws), bittorrent-tracker, better-sqlite3 |
| Streaming | HLS via Plex transcoder, WebRTC P2P segment sharing |
| Infrastructure | Docker, Node.js 22 |

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

Find your token by opening Plex Web, playing any media, then checking the Network tab in DevTools for `X-Plex-Token=` in query parameters. Or follow the [official Plex guide](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

### 3. Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your values:

```env
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
PLEX_URL=http://localhost:32400
PLEX_TOKEN=your_plex_token
PORT=3000
REDIRECT_URI=https://your-public-url.example.com
ALLOWED_ORIGINS=https://your-public-url.example.com
```

For local development, also create `packages/client/.env`:

```env
VITE_DISCORD_CLIENT_ID=your_discord_client_id
```

### 4. Run

#### Docker (recommended)

```bash
docker compose up --build
```

#### Local Development

```bash
npm install
npm run dev
```

This starts both services concurrently:

| Service | URL | Description |
|---------|-----|-------------|
| Server  | `http://localhost:3000` | Express API + WebSocket |
| Client  | `http://localhost:5173` | Vite dev server (proxies `/api` to server) |

#### Tunnel for Discord

Discord Activities require a public HTTPS URL. For local dev, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:5173
```

Set the resulting `https://xxxx.trycloudflare.com` URL as the URL mapping in your Discord app's Activities settings.

> **Note:** The tunnel URL changes every restart. Use a [named tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/) for a stable URL.

### 5. Launch

1. Join a voice channel in Discord
2. Click the **Activities** (rocket) icon
3. Select your app — the Activity loads and you'll see the Plex library

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to Discord" | Make sure you're launching as a Discord Activity from a voice channel, not visiting the URL directly |
| Library is empty | Check that `PLEX_URL` and `PLEX_TOKEN` are correct and the server can reach Plex |
| Video won't play | Check browser console for HLS errors; ensure Plex can transcode |
| "Session expired" banner | The server restarted and your session is stale — close and reopen the Activity |
| Tunnel URL changed | Update the URL mapping in Discord Developer Portal |

## License

[GPL-3.0](LICENSE)
