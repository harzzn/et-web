# Deploying ET:Legacy Web

Target: one Debian/Ubuntu VPS (2+ vCPU, ~2 GB RAM, EU location recommended),
a domain with an A record pointing at it.

## 1. Stage the bundle locally

Build the wasm client + stage the web dir as usual
(`cmake --build build/web && ./scripts/stage-web.sh`), then rsync:

```sh
VPS=root@your-vps
rsync -avL web/ "$VPS:/opt/et-web/web/"          # -L resolves symlinks (pk3s, etl.js/wasm)
rsync -av --exclude build --exclude .git src/ "$VPS:/opt/et-web/src/"
rsync -av tools/proxy/proxy.js "$VPS:/opt/et-web/tools/proxy/"
rsync -av deploy/ "$VPS:/opt/et-web/deploy/"
```

## 2. On the VPS

```sh
ssh $VPS
cd /opt/et-web && bash deploy/setup-server.sh
```

This installs packages, builds the native `etlded` from the same tree
(protocol + mod version match the client by construction), sets up the
runtime dir, installs the proxy and the two systemd units.

## 3. TLS + domain

- Edit `/etc/caddy/Caddyfile` from the `deploy/Caddyfile` template
  (replace `play.example.com`).
- Edit `/opt/et-web/web/config.js`: `server` stays an engine-side address
  (e.g. `127.0.0.1:27960` — the proxy decides the real routing; the value
  only needs to be a stable token the client can connect/reconnect to).
- `systemctl reload caddy`

On HTTPS pages the client automatically tunnels via `wss://<host>/net`
(see `net_web_tunnel.c`), which Caddy reverse-proxies to the local
ws-udp proxy. No extra open ports needed beyond 80/443 — and 27960/udp
if you also want NATIVE desktop clients to join the same server.

## 4. Edit before announcing

- `server/server.cfg`: rconpassword, hostname, map rotation
- `web/config.js`: download size text
- Decide master-server visibility (`dedicated 2` announces publicly;
  native players can then find and join the same matches)

## Notes

- Bandwidth: ~230 MB per first-time player. Put Cloudflare (free) in
  front of the static files if traffic grows; `/net` (WebSocket) should
  bypass the cache.
- The proxy binds 127.0.0.1 and is only reachable through Caddy.
- Updating: rebuild + restage locally, rsync `web/`, restart nothing
  (clients pick up new etl.js/manifest on reload; pk3 cache revalidates
  by size). For engine/mod changes also rebuild on the VPS and
  `systemctl restart etlded`.
