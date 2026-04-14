# VPS Relay Setup Guide

Route HLS segments through a VPS with nginx caching to offload home upload bandwidth during watch parties.

## Why

Without VPS: during a watch party with 10 viewers at 8 Mbps, your home upload pushes 80 Mbps — leaving nothing for other Plex users. With VPS: your home uploads one stream (~8 Mbps) to the VPS, and the VPS fans it out to all viewers from its 1 Gbps connection.

## Architecture

```
WITHOUT VPS:
  Plex (home) ──segments──► Express (home) ──► Viewer 1
                                           ──► Viewer 2  
                                           ──► Viewer 3
  Home upload: N × bitrate (bottleneck)

WITH VPS:
  Plex (home)
      │ (local, unthrottled)
  Express (home) ──segments──► VPS (nginx cache) ──► Viewer 1
                               (1st fetch only)  ──► Viewer 2
                                                 ──► Viewer 3
  Express manifests ──────────────────────────────► All viewers (~2KB each)
  Home upload: 1 stream to VPS
```

**Important:** The VPS proxies through your Express server (not directly to Plex).
Plex throttles external HTTP segment delivery to 1x realtime. Express fetches
segments from Plex locally (same network), which is unthrottled, and the VPS caches
the result.

What stays on Express (home):
- All manifests (`master.m3u8`, sub-manifests) — small, need server-side rewriting
- Session lifecycle (decision, start, stop, ping, auth)

What routes through VPS:
- `.ts` segment delivery — the actual video bytes

---

## Step 1: Create the Hetzner VPS

1. Go to https://www.hetzner.com/cloud
2. Create a **CAX11** (Arm64 Ampere, Shared Cost-Optimized) or **CX23** (x86)
   - 2 vCPU, 4 GiB RAM, 40 GB SSD, 20 TB traffic
   - ~$7.31/mo (CAX11 + IPv4) or ~€4.50/mo (CX23 + IPv4)
3. **Select Primary IPv4** (not IPv6 only)
4. Location: NBG-1 (Nuremberg) — best peering for EU
5. Add your SSH key during creation
6. OS: Ubuntu 24.04

## Step 2: Initial Server Setup

```bash
ssh root@YOUR_VPS_IP
export TERM=xterm-256color   # fixes nano on some terminals

apt update && apt upgrade -y
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
apt install nginx certbot python3-certbot-nginx -y
```

## Step 3: DNS + SSL

Create an **A record** pointing a subdomain at the VPS (do NOT proxy through Cloudflare — use DNS only/grey cloud):

```
theater.yourdomain.com  →  A record  →  YOUR_VPS_IP
```

Get SSL certificate:

```bash
certbot --nginx -d theater.yourdomain.com
```

## Step 4: Discord Developer Portal — URL Mapping

In your Discord app's **Activities → URL Mappings**, add a Proxy Path Mapping:

```
Prefix: /theater
Target: theater.yourdomain.com
```

This is required because Discord's Activity iframe enforces its own CSP. The app
generates relative segment URLs (`/theater/seg/...`) which Discord's proxy forwards
to `theater.yourdomain.com`. Without this mapping, browsers block cross-origin
segment fetches.

## Step 5: Cloudflare WAF (if Express domain uses Cloudflare)

If your Express server domain (e.g. `watchtogether.yourdomain.com`) is proxied
through Cloudflare, you must whitelist the VPS IP or Cloudflare will block the
VPS's segment proxy requests.

In Cloudflare → **Security → WAF → Custom Rules**, create:
- **Name:** Allow VPS relay
- **Field:** IP Source Address | **Operator:** equals | **Value:** YOUR_VPS_IP
- **Action:** Skip
- **Check all boxes:** All remaining custom rules, All rate limiting rules, All managed rules, All Super Bot Fight Mode Rules

Save the rule.

## Step 6: Configure nginx

Use `cat >` to avoid nano encoding issues:

```bash
cat > /etc/nginx/sites-available/theater << 'CONF'
proxy_cache_path /tmp/hls-cache levels=1:2
    keys_zone=hls:10m max_size=2g inactive=5m use_temp_path=off;

# map evaluated before rewrite phase — allows key validation with rewrite
map_hash_bucket_size 128;
map $arg_key $key_valid {
    "YOUR_SECRET_KEY" 1;
    default 0;
}

server {
    listen 443 ssl;
    server_name theater.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/theater.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/theater.yourdomain.com/privkey.pem;

    # Only proxy transcode segments — prevents key being used to access other paths
    location /seg/video/:/transcode/ {
        if ($key_valid = 0) {
            return 403;
        }
        if ($request_method = OPTIONS) {
            add_header Access-Control-Allow-Origin * always;
            add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
            add_header Content-Length 0;
            return 204;
        }

        # Save original URI for cache key before rewrite changes it
        set $seg_path $uri;

        # Rewrite to Express seg endpoint — Express fetches from Plex locally
        # (unthrottled). Do NOT proxy directly to Plex port 32400 — Plex throttles
        # external HTTP delivery to 1x realtime, causing stuttering.
        rewrite ^/seg(.*)$ /api/plex/hls/seg?p=$1 break;

        proxy_pass https://YOUR_EXPRESS_DOMAIN;
        proxy_ssl_verify off;
        proxy_set_header Host YOUR_EXPRESS_DOMAIN;
        proxy_set_header Authorization "";   # strip — Express handles its own auth

        proxy_cache hls;
        proxy_cache_valid 200 5m;
        proxy_cache_lock on;
        proxy_cache_lock_age 10s;
        proxy_cache_lock_timeout 10s;
        proxy_cache_key $seg_path;           # cache by path, ignore query params
        proxy_cache_use_stale error timeout updating;

        add_header Access-Control-Allow-Origin * always;
        add_header X-Cache-Status $upstream_cache_status always;

        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }

    location /health {
        return 200 "ok";
        add_header Content-Type text/plain;
    }
}
CONF
```

Replace `YOUR_SECRET_KEY`, `YOUR_EXPRESS_DOMAIN` (e.g. `watchtogether.yourdomain.com`), and `theater.yourdomain.com` with your actual values.

Enable and reload:

```bash
rm -f /etc/nginx/sites-enabled/default
ln -s /etc/nginx/sites-available/theater /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## Step 7: Environment Variables

Add to your app's `.env`:

```bash
VPS_RELAY_URL=https://theater.yourdomain.com
VPS_RELAY_KEY=your-secret-key   # must match nginx config
```

Generate a strong key: `openssl rand -hex 32`

Add to `docker-compose.yml` environment:
```yaml
- VPS_RELAY_URL=${VPS_RELAY_URL}
- VPS_RELAY_KEY=${VPS_RELAY_KEY}
```

Rebuild and restart the container.

---

## How It Works (Request Flow)

1. Host starts playback → Express starts Plex transcode → returns manifest
2. Express rewrites segment URLs to `/theater/seg/video/:/transcode/...?key=SECRET`
3. hls.js fetches segments via `/theater/seg/...` (relative, same-origin to Discord)
4. Discord's proxy forwards to `theater.yourdomain.com/seg/video/:/transcode/...?key=SECRET`
5. VPS nginx validates `?key=`, rewrites to `/api/plex/hls/seg?p=/video/:/transcode/...`
6. VPS proxies to your Express server (via `YOUR_EXPRESS_DOMAIN`)
7. Express fetches segment from Plex **locally** (no throttling) and returns it
8. VPS caches the segment for 5 minutes, serves all subsequent viewers from cache

Sub-manifests (`.m3u8` files) are **not** routed through VPS — they stay on Express
so URL rewriting works correctly (RFC 3986 relative URL resolution drops query params
from base URLs, which would lose the `?key=` on segment requests).

---

## Testing

```bash
# 1. Health check
curl https://theater.yourdomain.com/health
# → ok

# 2. Auth rejection (no key)
curl -o /dev/null -w "%{http_code}" "https://theater.yourdomain.com/seg/video/test"
# → 403

# 3. Express connectivity (from VPS)
curl -I https://YOUR_EXPRESS_DOMAIN/api/plex/config
# → 200 (requires Cloudflare WAF rule if Express uses Cloudflare)
```

**Watch party test:**
- Open browser DevTools → Network tab while playing
- Filter by `ts` — segments should come from `theater.yourdomain.com`
- Check `X-Cache-Status` header: `MISS` first viewer, `HIT` second viewer
- VPS logs: `tail -f /var/log/nginx/access.log`

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Segments 403 | Key mismatch or map not evaluating | Check key in `.env` matches nginx config exactly |
| Segments 403 from Cloudflare | Cloudflare blocking VPS | Add WAF rule to allow VPS IP |
| Segments 502 | VPS can't reach Express | Check Cloudflare WAF rule, Express domain DNS |
| Segments slow (6s+) | Proxying directly to Plex | Use Express proxy (Step 6) — never proxy direct to Plex:32400 |
| Segments blocked in Discord | Missing URL mapping | Add `/theater → theater.yourdomain.com` in Discord Dev Portal |
| `nginx -t` fails on map | Key >64 chars | Add `map_hash_bucket_size 128;` before the map block |

---

## Rollback

Remove `VPS_RELAY_URL` from `.env` and restart. Segments route through Express directly,
P2P re-enables automatically. Everything works as before.

---

## Cost

| Item | Cost |
|------|------|
| Hetzner CAX11 (ARM) | ~$6.59/mo |
| Primary IPv4 | ~$0.72/mo |
| **Total** | **~$7.31/mo** |

Bandwidth: ~1-1.5 TB/month out of 20 TB included.
