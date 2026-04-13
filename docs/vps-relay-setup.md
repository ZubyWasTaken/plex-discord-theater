# VPS Relay Setup Guide

Route HLS segments through a Hetzner VPS to offload upload bandwidth from your home server during watch parties.

## Why

Your home server has 100 Mb/s upload. During a watch party with 10 viewers at 6.2 Mb/s average, that's 62 Mb/s just for the party — leaving little room for your other 24-28 Plex users and qBittorrent seeding.

With a VPS relay, your home server uploads **one stream** to the VPS (~6.2 Mb/s), and the VPS (1 Gbps) fans it out to all viewers. Home upload during a watch party drops from ~62 Mb/s to ~6.2 Mb/s.

## Architecture

```
BEFORE (current):
  Plex (home) ──segments──► Express (home) ──► Viewer 1
                                           ──► Viewer 2
                                           ──► Viewer 3
  Home upload: N × bitrate (bottleneck)

AFTER (with VPS):
  Plex (home) ──segments──► VPS (nginx cache) ──► Viewer 1
                            (1st fetch only)  ──► Viewer 2
                                              ──► Viewer 3
  Express (home) ──manifests only──► Viewers (tiny, ~2KB each)
  Home upload: 1 × bitrate (just feeding the VPS)
```

What stays on Express (home):
- Manifest requests (`master.m3u8`) — small, infrequent
- Session lifecycle (decision, start, stop, ping)
- Transcode key tracking, auth

What moves to VPS:
- Segment delivery (`.ts` files) — the actual video bytes

---

## Step 1: Create the Hetzner VPS

1. Go to https://www.hetzner.com/cloud
2. Create a **CX23** instance (Shared Cost-Optimized)
   - 2 vCPU, 4 GiB RAM, 40 GB SSD
   - ~€3.99/mo + €0.50/mo for IPv4
   - 20 TB traffic included (you'll use ~1-1.5 TB)
3. **Select Primary IPv4** (not IPv6 only — your Plex server and viewers need IPv4)
4. Location: **NBG-1 (Nuremberg)** — best peering
5. Add your SSH key during creation

## Step 2: Initial Server Setup

SSH in and lock it down:

```bash
ssh root@YOUR_VPS_IP

# Update
apt update && apt upgrade -y

# Firewall
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP (certbot verification)
ufw allow 443/tcp   # HTTPS (HLS segments)
ufw enable

# Install nginx + certbot
apt install nginx certbot python3-certbot-nginx -y
```

## Step 3: DNS + SSL

Point a domain/subdomain at the VPS:

```
theater.yourdomain.com  →  A record  →  YOUR_VPS_IP
```

Then get an SSL certificate:

```bash
certbot --nginx -d theater.yourdomain.com
```

## Step 4: Configure nginx

Create `/etc/nginx/sites-available/theater`:

```nginx
proxy_cache_path /tmp/hls-cache levels=1:2
    keys_zone=hls:10m max_size=2g inactive=5m
    use_temp_path=off;

server {
    listen 443 ssl;
    server_name theater.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/theater.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/theater.yourdomain.com/privkey.pem;

    # ── Segment proxy ────────────────────────────────────────
    # Clients request: /seg/video/:/transcode/universal/session/.../00000.ts?key=SECRET
    # nginx strips /seg, validates the key, proxies to Plex, caches the response.
    #
    # Path-based approach avoids URL encoding issues with Plex's
    # special characters (like :/ in transcode paths).

    location /seg/ {
        # ── Auth: validate shared secret in query param ──
        # segProxyUrl() appends ?key=SECRET to every segment URL,
        # so no client-side xhrSetup is needed — hls.js just uses the URLs as-is.
        if ($arg_key != "YOUR_SECRET_KEY_HERE") {
            return 403;
        }

        # ── CORS preflight (browsers need this for cross-origin segments) ──
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Content-Length 0;
            return 204;
        }

        # ── Proxy to home Plex server ──
        # The trailing / on both location and proxy_pass makes nginx strip /seg/
        # and forward the rest of the path to Plex.
        # Example: /seg/video/:/transcode/... → GET /video/:/transcode/... on Plex
        #
        # Strip query params (?key=...) so they aren't forwarded to Plex.
        # Plex ignores unknown params, but there's no reason to send our auth key upstream.
        set $args "";
        proxy_pass https://YOUR_HOME_PUBLIC_IP:32400/;
        proxy_ssl_verify off;

        # Auth to Plex (stays server-side, never exposed to clients)
        proxy_set_header X-Plex-Token YOUR_PLEX_TOKEN;
        proxy_set_header X-Plex-Client-Identifier plex-discord-theater;

        # Strip the ?key= param so Plex doesn't see it
        proxy_set_header Host $proxy_host;

        # ── Caching ──
        # IMPORTANT: proxy_buffering must stay ON (the default).
        # nginx cannot cache responses when buffering is disabled.
        # Do NOT add "proxy_buffering off" here — it breaks caching entirely.
        proxy_cache hls;
        proxy_cache_valid 200 10s;          # Cache successful responses for 10s
        proxy_cache_lock on;                # Only one request per segment to Plex
        proxy_cache_lock_age 10s;           # If lock holder is slow, let others through
        proxy_cache_lock_timeout 10s;       # Max wait for lock before fetching directly
        proxy_cache_key $uri;               # Cache by path only (ignore query params)
        proxy_cache_use_stale error timeout updating;  # Serve stale if Plex is slow

        # ── Response headers ──
        add_header Access-Control-Allow-Origin * always;
        add_header X-Cache-Status $upstream_cache_status always;  # Debug: HIT/MISS

        # ── Timeouts ──
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }

    # ── Health check ─────────────────────────────────────────
    location /health {
        return 200 "ok";
        add_header Content-Type text/plain;
    }
}
```

Enable and test:

```bash
# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Enable theater config
ln -s /etc/nginx/sites-available/theater /etc/nginx/sites-enabled/

# Test config for syntax errors
nginx -t

# If test passes, reload
systemctl reload nginx
```

### What This Config Does

1. Client requests `https://theater.yourdomain.com/seg/video/:/transcode/.../00000.ts?key=SECRET`
2. nginx validates `?key=SECRET` — rejects with 403 if wrong
3. nginx strips `/seg/` prefix, proxies `GET /video/:/transcode/.../00000.ts` to your Plex
4. nginx caches the response for 10 seconds
5. Next viewer requesting the same segment gets it from cache instantly (no Plex fetch)

### Why Path-Based Instead of Query Parameter

The previous version used `?p=<encoded-path>` which causes URL encoding problems:
- `segProxyUrl()` encodes the path with `encodeURIComponent()`
- nginx's `$arg_p` gives the raw encoded value
- Passing encoded slashes (`%2F`) as a path in `proxy_pass` creates invalid requests
- Plex paths with `:/` make this worse

The path-based approach avoids all encoding issues — the Plex path goes directly
into the URL path, and nginx's `location /seg/` + `proxy_pass .../` strips the
prefix cleanly.

## Step 5: Open Plex to the VPS

On your Unraid/router, ensure port 32400 is reachable from the VPS IP.

**Ideally, firewall it so ONLY the VPS IP can connect:**

```bash
# On Unraid or your router's firewall:
# Allow 32400 from VPS_IP only (in addition to existing rules)
iptables -A INPUT -p tcp --dport 32400 -s YOUR_VPS_IP -j ACCEPT
```

## Step 6: Code Change — `segProxyUrl()`

The only code change is in `packages/server/src/routes/plex.ts`.

The function `segProxyUrl()` (line ~1264) rewrites segment URLs in HLS manifests. Currently all segments point back to Express. With the VPS, segments point to the VPS instead.

### Current code:

```typescript
function segProxyUrl(plexPath: string, authToken?: string): string {
  let url = `/api/plex/hls/seg?p=${encodeURIComponent(plexPath)}`;
  if (authToken) url += `&token=${encodeURIComponent(authToken)}`;
  return url;
}
```

### New code:

```typescript
const VPS_RELAY_URL = process.env.VPS_RELAY_URL?.replace(/\/$/, "");
const VPS_RELAY_KEY = process.env.VPS_RELAY_KEY;

function segProxyUrl(plexPath: string, authToken?: string): string {
  if (VPS_RELAY_URL && VPS_RELAY_KEY) {
    // Path-based: /seg/video/:/transcode/...?key=SECRET
    // No encodeURIComponent — Plex paths go directly into the URL path.
    // The key is a query param so nginx validates it, and hls.js sends it
    // automatically (no xhrSetup needed).
    let url = `${VPS_RELAY_URL}/seg${plexPath}?key=${encodeURIComponent(VPS_RELAY_KEY)}`;
    if (authToken) url += `&token=${encodeURIComponent(authToken)}`;
    return url;
  }
  // No VPS — fall back to proxying through Express (query-param based)
  let url = `/api/plex/hls/seg?p=${encodeURIComponent(plexPath)}`;
  if (authToken) url += `&token=${encodeURIComponent(authToken)}`;
  return url;
}
```

**No client-side changes needed.** The segment URLs in the manifest already point
to the VPS with the key included, and hls.js fetches them as-is.

## Step 7: P2P Toggle (Optional)

When VPS is active, P2P is unnecessary (1 Gbps handles 80+ viewers at 12 Mbps).
To disable P2P when VPS is active, wrap the P2P init in `Player.tsx` (lines ~136-194):

```typescript
// Fetch VPS config from server (add a /api/config endpoint, or include in existing response)
const useP2P = !serverConfig.vpsRelayEnabled;

if (useP2P) {
  // Existing P2P setup: HlsJsP2PEngine.injectMixin(Hls), tracker, swarm, ICE, etc.
} else {
  // Plain HLS — no P2P engine, no tracker connection
  hls = new Hls({ /* standard hls.js config without P2P */ });
}
```

When `VPS_RELAY_URL` is removed from `.env`, P2P re-enables automatically.

## Step 8: Environment Variables

Add to `.env`:

```bash
# VPS Relay (optional — omit both to disable, segments proxy through Express as before)
VPS_RELAY_URL=https://theater.yourdomain.com
VPS_RELAY_KEY=some-random-secret-string
```

Add to `.env.example`:

```bash
# Optional — VPS relay for watch party segment delivery
# When set, HLS segments route through the VPS instead of this server.
# Also disables P2P (VPS bandwidth makes it unnecessary).
# VPS_RELAY_URL=https://theater.yourdomain.com
# VPS_RELAY_KEY=
```

Generate a strong key:

```bash
openssl rand -hex 32
```

---

## Testing

### 1. Test nginx config on VPS

```bash
# SSH into VPS
nginx -t
# Should say: syntax is ok, test is successful
```

### 2. Test health endpoint

```bash
curl https://theater.yourdomain.com/health
# Should return: ok
```

### 3. Test auth rejection

```bash
# No key — should get 403
curl -o /dev/null -w "%{http_code}" "https://theater.yourdomain.com/seg/test"
# 403

# Wrong key — should get 403
curl -o /dev/null -w "%{http_code}" "https://theater.yourdomain.com/seg/test?key=wrong"
# 403
```

### 4. Test Plex proxy (from VPS)

```bash
# SSH into VPS, test direct connectivity to Plex
curl -k -H "X-Plex-Token: YOUR_PLEX_TOKEN" \
  "https://YOUR_HOME_IP:32400/identity"
# Should return Plex server identity XML
```

### 5. Test a watch party

Start a watch party with the VPS enabled and check browser DevTools Network tab:
- Manifest (`master.m3u8`) comes from your Express server (home IP)
- Segments (`.ts` files) come from `theater.yourdomain.com` (VPS)
- Check the `X-Cache-Status` response header:
  - `MISS` = first fetch, pulled from Plex
  - `HIT` = served from VPS cache (no Plex fetch)

### 6. Monitor VPS cache

```bash
# On the VPS, watch requests in real time
tail -f /var/log/nginx/access.log

# You should see:
# First viewer requests 00001.ts → upstream_cache_status=MISS
# Second viewer requests 00001.ts → upstream_cache_status=HIT
```

### 7. Monitor home upload

During a watch party, your home upload should only show ~6-8 Mb/s
(one stream to VPS) regardless of how many viewers are watching.

---

## Troubleshooting

### Segments return 403
- Check that `VPS_RELAY_KEY` in `.env` matches `YOUR_SECRET_KEY_HERE` in nginx config
- Check browser network tab — the segment URL should have `?key=...` appended

### Segments return 502 Bad Gateway
- VPS can't reach your Plex server. Check:
  - Port 32400 is open on your router/firewall for the VPS IP
  - `YOUR_HOME_PUBLIC_IP` in nginx config is correct
  - Plex is running and accessible

### Segments return 504 Gateway Timeout
- Plex is slow to respond. Increase `proxy_read_timeout` in nginx config

### CORS errors in browser console
- Check that `add_header Access-Control-Allow-Origin * always;` is in the config
- The `always` keyword is important — without it, nginx only adds headers on 2xx responses

### Cache not working (all requests show MISS)
- Verify `proxy_buffering` is NOT set to `off` (it must be `on`, which is the default)
- Check cache directory exists: `ls -la /tmp/hls-cache/`
- Check nginx error log: `tail -f /var/log/nginx/error.log`

---

## Rollback

To disable the VPS relay, just remove or comment out `VPS_RELAY_URL` from `.env`
and restart the server. Segments will route through Express again, P2P re-enables,
everything works exactly like before.

---

## Cost Summary

| Item | Cost |
|------|------|
| Hetzner CX23 | €3.99/mo |
| Primary IPv4 | ~€0.50/mo |
| Domain (if needed) | ~€2/year |
| **Total** | **~€4.50/mo** |

Bandwidth used: ~1-1.5 TB/month out of 20 TB included. Overage: €1/TB.
