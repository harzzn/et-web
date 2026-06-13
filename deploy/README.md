# Deploying ET:Legacy Web

Two supported shapes:

- **Single box** (`setup-server.sh`) — one VPS serves everything (shell +
  paks + game). Simplest; bandwidth = ~230 MB per new player off the box.
  Put Cloudflare in front of the static files if it grows. See §A.
- **Box + R2 + Cloudflare** (`cloud-init.yaml` + `release.sh`) — paks live in
  Cloudflare R2 (zero egress), the box only runs the game + serves the tiny
  shell. Flat ~$9/mo at any scale. This is the recommended production shape
  and what the `et.helja.la` Pulumi setup targets. See §B.

The native server is built from the *same source tree* as the wasm client, so
protocol, mod version, and pk3 checksums match by construction — but only if
both come from the same commit. **Pin the commit** when client (R2) and
server (box) are built separately.

---

## B. Box + R2 + Cloudflare (recommended)

Topology, DNS, and the Pulumi half live in the separate handover doc
(`et.helja.la` infra is managed from the helja.la repo). This section is the
app-side runbook.

### Files

| File | Role |
|---|---|
| `cloud-init.yaml` | Hetzner box bootstrap (`userData` from Pulumi): builds native server, installs proxy + Caddy(+CF DNS plugin) + systemd. Substitute `__PINNED_SHA__` and `__CF_DNS_TOKEN__`. |
| `release.sh` | Build wasm client → stage with prod asset base → paks to R2 → shell+manifest to box. |
| `rclone.conf.example` | R2 S3 remote for the pak upload. |

### One-time

1. Provision via Pulumi (box, firewall, DNS for `et` / `assets` / `net`, R2
   bucket `et-assets` + custom domain + cache rule). cloud-init builds the
   server on first boot (~10-15 min).
2. Configure rclone for R2 (`deploy/rclone.conf.example` → `~/.config/rclone/`).

### Every release (from the et-web repo)

```sh
# build gl4es + client first if engine/mod changed (see top-level README)
BOX_IP=<hetzner ip> deploy/release.sh
```

`release.sh` env knobs (all have et.helja.la defaults):
`R2_REMOTE`, `ASSET_BASE`, `WS_URL`, `GAME_SERVER`, `SKIP_BUILD=1`.

It writes `manifest.json` with pak URLs under `ASSET_BASE`
(`https://assets.et.helja.la/…`), generates a prod `config.js` (grey-cloud
`wsUrl`, asset base) to a temp file, syncs `web/files/` to R2, and rsyncs the
shell to the box. The committed `web/config.js` (local-dev defaults) is left
untouched.

### Client wiring (already in the repo)

- `web/config.js` — `wsUrl` (grey-cloud socket) + `assetBase` (R2). Empty in
  the committed file = local-dev same-origin defaults.
- `boot.js` — passes `+set net_wsUrl <wsUrl>` when set; otherwise the engine's
  same-origin default in `net_web_tunnel.c` applies.
- `scripts/stage-web.sh` — `ASSET_BASE=… ./scripts/stage-web.sh` bakes the pak
  URL base into the manifest (defaults to `files/`).

### Update flows

- **Shell/client only:** `deploy/release.sh` (paks unchanged → R2 sync is a
  no-op). Clients pick it up on reload; purge CF cache for
  `et.helja.la/manifest.json` + `/etl.js` if you set long browser TTLs.
- **Engine/mod:** bump the pinned SHA, rebuild client+server from it, push
  paks to R2 **and** rebuild/restart `etlded` on the box together (checksum
  lockstep, or the server rejects clients).
- **Rollback:** keep versioned R2 prefixes (`/<sha>/…`) and flip `assetBase`
  to roll the client back instantly; revert the box build for the server.

---

## A. Single box (simple)

### 1. Stage + ship

```sh
cmake --build build/web && ./scripts/stage-web.sh
VPS=root@your-vps
rsync -avL web/ "$VPS:/opt/et-web/web/"          # -L resolves symlinks (pk3s, etl.js/wasm)
rsync -av --exclude build --exclude .git src/ "$VPS:/opt/et-web/src/"
rsync -av tools/proxy/proxy.js "$VPS:/opt/et-web/tools/proxy/"
rsync -av deploy/ "$VPS:/opt/et-web/deploy/"
```

### 2. On the VPS

```sh
ssh $VPS
cd /opt/et-web && bash deploy/setup-server.sh
```

Installs packages, builds native `etlded`, sets up the runtime dir, installs
the proxy + the two systemd units.

### 3. TLS + domain

- Edit `/etc/caddy/Caddyfile` from `deploy/Caddyfile` (replace the hostname).
- `web/config.js`: leave `wsUrl`/`assetBase` empty → the client uses
  `wss://<host>/net` (proxied) and same-origin paks.
- `systemctl reload caddy`

No extra open ports beyond 80/443 — plus `27960/udp` if you also want native
desktop clients to join the same server.

---

## Notes (both shapes)

- The proxy binds `127.0.0.1` and is only reachable through Caddy.
- `server/server.cfg`: set `rconpassword`, hostname, map rotation before
  announcing.
- Master-server visibility: `dedicated 2` lists the server publicly (native
  ET:Legacy desktop players can find + join the same matches — needs
  `27960/udp` open); `dedicated 1` keeps it browser-only.
- Game data (paks) is never in a repo — cloud-init pulls etmain paks from
  `mirror.etlegacy.com`; the legacy pk3 (with the wasm mods) is produced by
  the build.
