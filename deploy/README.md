# Deploying ET:Legacy Web

This repo knows how to **build and run** ET:Legacy Web. It does **not** know
about any specific host, tunnel, TLS, CDN account, or secret — those live in
whatever private wrapper fronts the box. Everything here is parameterized.

The box serves plain local HTTP (shell + the `/net` WebSocket). **Public TLS
and the public hostname are provided outside this repo** by a fronting layer —
e.g. a Cloudflare Tunnel (outbound; zero open inbound ports), a reverse proxy,
or, for a quick self-host, Caddy's own auto-TLS (see §A).

The native server is built from the **same source commit** as the wasm client,
so the server's `qagame` and the clients' `cgame/ui` match. `sv_pure 0` tolerates
the (cosmetic) pk3-checksum difference between the native-built and wasm-built
`legacy_*.pk3`; the **commit** is what must match — pin `ETLEGACY_SHA`.

> **Public / private split.** No IPs, hostnames, certs, keys, or secrets are in
> this repo. A private wrapper (for the helja.la deployment: the Pulumi repo +
> chamber/SSM vault) injects the real values into these generic scripts —
> `chamber exec et-web -- env SSH_TARGET=… ASSET_BASE=… deploy/release.sh`. For
> local convenience a gitignored `deploy/deploy.env` (from `deploy.env.example`)
> is sourced if present.

---

## B. Box + R2 + fronting layer (production)

The cloud infra (box, networking, DNS, R2 bucket + custom domain + cache, and
the public-TLS fronting layer) is provisioned by a private repo. This repo
delivers the *game* onto the box and the paks into R2.

### Files

| File | Role |
|---|---|
| `box-setup.sh` | Run over SSH on the box: builds the native server from the pinned commit, installs the ws↔udp proxy, drops the Caddyfile + systemd units, starts everything (`dedicated 1`). |
| `Caddyfile` | Plain local-HTTP origin (`:80`, shell + `/net`). Public TLS is the fronting layer's job. |
| `release.sh` | Build wasm client → stage with `ASSET_BASE` → paks to R2 → shell+manifest+prod-`config.js` to the box. |
| `deploy.env.example` | Template of the env the wrapper supplies. |
| `rclone.conf.example` | R2 upload creds via env vars (no on-disk secret). |

### How public traffic reaches the box

The box opens **no inbound ports**. A Cloudflare Tunnel (or similar) runs
on/near the box, connects *outbound* to the edge, and forwards the public
hostname to Caddy's local `:80`. SSH for deploys goes over a private network
(e.g. Tailscale) — so `SSH_TARGET` is a Tailscale hostname, an SSH alias, or an
IP, whatever resolves for you. None of this is configured here; it's the
fronting layer's concern.

### First deploy

```sh
# the private wrapper injects SSH_TARGET, RCONPASSWORD, ETLEGACY_SHA,
# ASSET_BASE, R2_REMOTE, R2 creds…
# 1. provision the game on the box
ssh root@$SSH_TARGET mkdir -p /opt/et-web/deploy
rsync -av deploy/Caddyfile tools/proxy/proxy.js root@$SSH_TARGET:/opt/et-web/deploy/
ssh root@$SSH_TARGET "RCONPASSWORD=$RCONPASSWORD ETLEGACY_SHA=$ETLEGACY_SHA bash -s" \
    < deploy/box-setup.sh
# 2. push the client + paks
SSH_TARGET=$SSH_TARGET ASSET_BASE=$ASSET_BASE R2_REMOTE=$R2_REMOTE deploy/release.sh
```

### Every release

```sh
# rebuild gl4es + client first if engine/mod changed (see top-level README)
SSH_TARGET=… ASSET_BASE=… R2_REMOTE=… deploy/release.sh
```

`release.sh` bakes `ASSET_BASE` into `manifest.json`, generates a prod
`config.js` (asset base; empty `wsUrl` → same-origin `wss://<host>/net`) to a
temp file, `rclone sync`s `web/files/` to R2, and rsyncs the shell to the box.
The committed `web/config.js` (local-dev defaults) is never touched.

### Update flows

- **Shell/client only:** `release.sh` (paks unchanged → R2 sync is a no-op).
  Clients pick it up on reload; purge the CDN cache for `…/manifest.json` +
  `/etl.js` if you set long browser TTLs.
- **Engine/mod:** bump `ETLEGACY_SHA`, rebuild client + rerun `box-setup.sh`
  (rebuilds + restarts the server) **together** — client paks (R2) and server
  must be the same commit or the server rejects clients.
- **Rollback:** push paks under a versioned R2 prefix and flip `ASSET_BASE` to
  roll the client back instantly; rerun `box-setup.sh` at the old SHA for the
  server.

### Private-wrapper contract (lives outside this repo)

- **Secrets** (vault): R2 access key + secret, `RCONPASSWORD`.
- **Fronting layer**: tunnel/proxy mapping the public hostname → box `:80`, and
  the private path (Tailscale/SSH) for `SSH_TARGET`.
- **Wrapper** that injects the env into `box-setup.sh` / `release.sh`.

---

## A. Single box (quick self-host)

```sh
cmake --build build/web && ./scripts/stage-web.sh
VPS=root@your-vps
rsync -avL web/ "$VPS:/opt/et-web/web/"
rsync -av --exclude build --exclude .git src/ "$VPS:/opt/et-web/src/"
rsync -av tools/proxy/proxy.js "$VPS:/opt/et-web/tools/proxy/"
rsync -av deploy/ "$VPS:/opt/et-web/deploy/"
ssh $VPS 'cd /opt/et-web && bash deploy/setup-server.sh'
```

For a directly-public box, give Caddy a hostname instead of `:80` in
`deploy/Caddyfile` so it auto-provisions TLS (needs 80/443 reachable). Leave
`web/config.js` `wsUrl`/`assetBase` empty → same-origin `wss://<host>/net` and
same-origin paks. Open `27960/udp` too if you want native desktop cross-play.

---

## Notes (both shapes)

- The proxy binds `127.0.0.1` and is only reachable through Caddy.
- `dedicated 1` = browser-only (no master heartbeat; no open game port needed).
  `dedicated 2` lists the server publicly so native desktop players can find +
  join the same matches — needs `27960/udp` reachable.
- Game data (paks) is never in a repo — `box-setup.sh` pulls etmain paks from
  `mirror.etlegacy.com`; the `legacy_*.pk3` (with the wasm mods) is produced by
  the build.
