# Plex Discord Theater

A Discord Activity that lets you browse a Plex library and watch movies and TV shows together in a voice channel — synchronized playback, host controls, and all streamed through Discord.

## Features

- **Browse your Plex library** — movies and TV shows with search, genre filters, and sorting
- **Synchronized playback** — the host controls play/pause/seek and all viewers stay in sync
- **Audio & subtitle selection** — pick audio tracks and subtitles before playing
- **Automatic host promotion** — if the host leaves, the next viewer is promoted so the session keeps going
- **Secure** — your Plex token never leaves the server; the backend proxies everything

## How It Works

The app runs as a Discord Activity (iframe inside Discord). A backend server proxies all Plex API calls and HLS video segments so nothing is exposed to the client. The first user to join becomes the host and can browse and start playback. Everyone else watches in sync via WebSocket.

```
Plex (transcodes) → Backend (proxy) → Discord → Viewers
```

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
| Server  | `http://localhost:3000` | Express API + WebSocket |
| Client  | `http://localhost:5173` | Vite dev server (proxies `/api` → `:3000`) |

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
| Video won't play | Check browser console for HLS errors. Ensure Plex can transcode |
| Tunnel URL changed | Update the URL mapping in Discord Developer Portal |
