# Plex Discord Theater

A Discord Activity that lets you browse your Plex library and watch movies and TV shows together in a voice channel — synchronized playback, host controls, and all streamed through Discord.

## Features

- **Browse your Plex library** — movies and TV shows with search, genre filters, and sorting
- **Synchronized playback** — the host controls play/pause/seek and all viewers stay in sync
- **Audio & subtitle selection** — pick audio tracks and subtitles before playing
- **VPS relay** — optional nginx caching proxy offloads segment delivery to a VPS with 1 Gbps, so your home upload isn't the bottleneck
- **P2P segment sharing** — when no VPS is configured, viewers share HLS segments with each other via WebRTC, reducing server bandwidth
- **Automatic host promotion** — if the host leaves, the next viewer is promoted so the session continues
- **Thumbnail caching** — artwork is cached server-side in SQLite for fast browsing
- **Persistent sessions** — sessions and host roles survive server restarts (SQLite-backed)
- **Secure** — your Plex token never leaves the server; the backend proxies everything

## How It Works

```
Discord Voice Channel
  └─ Activity (iframe)
       └─ React client (hls.js)
            ├─ VPS relay (nginx cache) — when configured
            ├─ OR: WebRTC ↔ other viewers (P2P segment sharing) — fallback
            └─ Express backend (WebSocket sync + API proxy)
                 └─ Plex Media Server (HLS transcoding)
```

The first user to join becomes the host and can browse the library and start playback. Everyone else watches in sync via WebSocket. The backend proxies all Plex API calls and HLS video segments so nothing is exposed directly to clients.

### VPS Relay (Recommended)

When `VPS_RELAY_URL` is configured, HLS segments are served through a VPS with nginx caching instead of directly from your home server. Your Plex server transcodes once and uploads one stream to the VPS — the VPS then fans it out to all viewers from its 1 Gbps connection.

```
Without VPS:  Home upload = N viewers × bitrate (bottleneck)
With VPS:     Home upload = 1 stream to VPS (~8 Mbps), VPS handles the rest
```

This is the recommended setup for watch parties with more than a few viewers. P2P is automatically disabled when VPS relay is active. See [VPS Relay Setup](#vps-relay-optional) below and [docs/vps-relay-setup.md](docs/vps-relay-setup.md) for the full guide.

### P2P Segment Sharing (Fallback)

When no VPS is configured, viewers in the same watch session automatically form a peer-to-peer mesh using WebRTC. When one viewer downloads an HLS segment from the server, they share it directly with other viewers — so the same segment doesn't need to be fetched from Plex multiple times.

- **BitTorrent tracker** — the server runs an embedded [bittorrent-tracker](https://github.com/webtorrent/bittorrent-tracker) over WebSocket for peer discovery and signaling
- **Swarm per session** — viewers watching the same content share a swarm ID, so P2P only happens within a watch session
- **Transparent fallback** — if a segment isn't available from peers in time, it falls back to fetching from the server normally
- **Tuned for live-ish playback** — P2P prefetch window of 30s with 6s HTTP window and 2 concurrent HTTP downloads, so peers have time to supply segments before the client fetches them directly
- **NAT traversal** — uses a STUN server for WebRTC connections behind NAT

P2P reduces bandwidth when multiple people are watching together, but is limited by the host's upload speed. For larger watch parties, the VPS relay is a better solution.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Client | React, hls.js, [p2p-media-loader](https://github.com/nicedoc/p2p-media-loader), Discord Embedded App SDK |
| Server | Express, WebSocket (ws), bittorrent-tracker, better-sqlite3 |
| Streaming | HLS via Plex transcoder, WebRTC P2P segment sharing |
| Infrastructure | Docker, Node.js 22, optional nginx VPS relay |

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

# Optional — VPS relay (see "VPS Relay Setup" section below)
# VPS_RELAY_URL=https://theater.yourdomain.com
# VPS_RELAY_KEY=your-secret-key
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

## VPS Relay (Optional)

Route HLS segments through a cheap VPS (~€4.50/mo) to offload upload bandwidth from your home server during watch parties. Instead of your home connection uploading to every viewer, it uploads one stream to the VPS, and the VPS fans it out to everyone.

### Why

If your home upload is 100 Mb/s and you're running a watch party with 10 viewers at 8 Mbps, that's 80 Mb/s — leaving almost nothing for your other Plex users. With a VPS relay, your home upload only uses ~8 Mb/s (one stream to the VPS) regardless of how many viewers are watching.

### Quick Setup

1. **Create a Hetzner CX23** (~€4.50/mo with IPv4) at [hetzner.com/cloud](https://www.hetzner.com/cloud)
2. **SSH in and install nginx + certbot:**
   ```bash
   apt update && apt upgrade -y
   ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
   apt install nginx certbot python3-certbot-nginx -y
   ```
3. **Point a domain at the VPS and get SSL:**
   ```bash
   # After creating DNS A record: theater.yourdomain.com → VPS_IP
   certbot --nginx -d theater.yourdomain.com
   ```
4. **Configure nginx** — create `/etc/nginx/sites-available/theater`:
   ```nginx
   proxy_cache_path /tmp/hls-cache levels=1:2
       keys_zone=hls:10m max_size=2g inactive=5m use_temp_path=off;

   server {
       listen 443 ssl;
       server_name theater.yourdomain.com;

       ssl_certificate /etc/letsencrypt/live/theater.yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/theater.yourdomain.com/privkey.pem;

       location /seg/ {
           if ($arg_key != "YOUR_SECRET_KEY") {
               return 403;
           }
           if ($request_method = OPTIONS) {
               add_header Access-Control-Allow-Origin * always;
               add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
               add_header Content-Length 0;
               return 204;
           }

           set $args "";
           proxy_pass https://YOUR_HOME_PUBLIC_IP:32400/;
           proxy_ssl_verify off;
           proxy_set_header X-Plex-Token YOUR_PLEX_TOKEN;
           proxy_set_header X-Plex-Client-Identifier plex-discord-theater;
           proxy_set_header Host $proxy_host;

           proxy_cache hls;
           proxy_cache_valid 200 10s;
           proxy_cache_lock on;
           proxy_cache_lock_age 10s;
           proxy_cache_lock_timeout 10s;
           proxy_cache_key $uri;
           proxy_cache_use_stale error timeout updating;

           add_header Access-Control-Allow-Origin * always;
           add_header X-Cache-Status $upstream_cache_status always;

           proxy_connect_timeout 5s;
           proxy_read_timeout 10s;
       }

       location /health {
           return 200 "ok";
           add_header Content-Type text/plain;
       }
   }
   ```
   Then enable it:
   ```bash
   rm -f /etc/nginx/sites-enabled/default
   ln -s /etc/nginx/sites-available/theater /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```
5. **Open port 32400** on your home router/firewall for the VPS IP
6. **Add env vars** to your `.env`:
   ```env
   VPS_RELAY_URL=https://theater.yourdomain.com
   VPS_RELAY_KEY=your-secret-key
   ```
   Generate a strong key with: `openssl rand -hex 32`

Replace `YOUR_SECRET_KEY`, `YOUR_HOME_PUBLIC_IP`, and `YOUR_PLEX_TOKEN` in the nginx config with your actual values. The `VPS_RELAY_KEY` in `.env` must match `YOUR_SECRET_KEY` in the nginx config.

### How It Works

When `VPS_RELAY_URL` and `VPS_RELAY_KEY` are set:
- HLS manifest segment URLs are rewritten to point to the VPS instead of the Express server
- The VPS nginx caches each segment on first fetch, then serves it from cache for subsequent viewers
- P2P is automatically disabled (the VPS handles fan-out, making P2P unnecessary)
- CSP headers are updated to allow the browser to fetch segments from the VPS origin

When the env vars are removed, everything reverts to the default behavior (segments through Express, P2P enabled).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VPS_RELAY_URL` | No | Full URL of the VPS relay (e.g. `https://theater.yourdomain.com`). Omit to disable. |
| `VPS_RELAY_KEY` | No | Shared secret between the app and VPS nginx. Must match the key in the nginx config. |

Both must be set for VPS relay to activate. If either is missing, the app falls back to direct segment proxying with P2P.

### Full Documentation

For detailed setup instructions, troubleshooting, testing, and architecture diagrams, see [docs/vps-relay-setup.md](docs/vps-relay-setup.md).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Failed to connect to Discord" | Make sure you're launching as a Discord Activity from a voice channel, not visiting the URL directly |
| Library is empty | Check that `PLEX_URL` and `PLEX_TOKEN` are correct and the server can reach Plex |
| Video won't play | Check browser console for HLS errors; ensure Plex can transcode |
| "Session expired" banner | The server restarted and your session is stale — close and reopen the Activity |
| Tunnel URL changed | Update the URL mapping in Discord Developer Portal |
| VPS segments return 403 | Check that `VPS_RELAY_KEY` in `.env` matches the key in the nginx config |
| VPS segments return 502 | VPS can't reach Plex — check port 32400 is open for the VPS IP, and `YOUR_HOME_PUBLIC_IP` is correct in nginx |
| CORS errors with VPS | Verify `add_header Access-Control-Allow-Origin * always;` is in the nginx config (the `always` keyword matters) |

## License

[GPL-3.0](LICENSE)
