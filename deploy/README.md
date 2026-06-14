# Deploying ET:Legacy Web

Two supported shapes:

- **Box + R2 + Cloudflare** (`box-setup.sh` + `release.sh`) — paks live in
  Cloudflare R2 (zero egress), the box runs the game + serves the tiny shell
  behind a Cloudflare-proxied origin. Flat ~$9/mo at any scale. This is the
  production shape (what `et.helja.la` runs). See §B.
- **Single box** (`setup-server.sh`) — one VPS serves everything (shell + paks +
  game), auto-TLS, no R2/CDN. Simplest for a quick self-host; bandwidth = the
  full ~230 MB per new player off the box. See §A.

The native server is built from the **same source commit** as the wasm client,
so the server's `qagame` and the clients' `cgame/ui` match. `sv_pure 0` tolerates
the (cosmetic) pk3-checksum difference between the native-built and wasm-built
`legacy_*.pk3`; the **commit** is what must match — pin `ETLEGACY_SHA`.

> **Public / private split.** Everything in this repo is generic and
> parameterized — no IPs, operational domains, certs or keys. The real values
> and secrets (origin IP, R2 keys, rcon password, Origin CA cert) live in the
> private **helja.la** repo and its **chamber/SSM** vault, which injects them
> into these scripts (`chamber exec et-web -- env … deploy/release.sh`). For
> local convenience a gitignored `deploy/deploy.env` (from `deploy.env.example`)
> is sourced if present.

---

## B. Box + R2 + Cloudflare (production)

The cloud infra (box, firewall, DNS, R2 bucket + custom domain + cache rule) is
provisioned by the **helja.la** Pulumi repo. This repo delivers the *game* onto
that box and the paks into R2.

### Files

| File | Role |
|---|---|
| `box-setup.sh` | Run over SSH on the (already-provisioned) box: builds the native server from the pinned commit, installs the ws↔udp proxy, writes the Caddyfile (Origin CA TLS) + systemd units, starts everything (`dedicated 1`). |
| `Caddyfile` | Template; box-setup substitutes `{ET_HOST}`/`{TLS_DIR}`. Origin TLS via a Cloudflare Origin CA cert (port 80 + DNS plugin unavailable). |
| `release.sh` | Build wasm client → stage with `ASSET_BASE` → paks to R2 → shell+manifest+prod-`config.js` to the box. |
| `deploy.env.example` | Template of the env the wrapper/chamber supplies. |
| `rclone.conf.example` | R2 upload creds via env vars (no on-disk secret). |

### Origin TLS (the one real puzzle)

`et.helja.la` is Cloudflare-proxied, so CF terminates client TLS but the
**CF→origin** hop needs the box to answer 443 with a cert. Port 80 (HTTP-01) and
the `caddy-dns` plugin (DNS-01) are both unavailable, so use a **Cloudflare
Origin CA certificate**:

1. Generate it (helja.la: Pulumi `cloudflare.OriginCaCertificate` preferred, or
   CF dashboard → SSL/TLS → Origin Server → Create Certificate for `et.helja.la`).
2. Place on the box at `$TLS_DIR/origin.pem` + `origin.key`
   (`root:caddy`, key `0640`) — out of band; **never** in this repo.
3. Set the `et.helja.la` hostname's CF SSL mode to **Full (Strict)** (else
   CF→origin returns 5xx).

### First deploy

```sh
# helja.la wrapper injects BOX_IP, ET_HOST, RCONPASSWORD, ETLEGACY_SHA, R2 creds…
# 0. (helja.la) generate + scp the Origin CA cert to the box $TLS_DIR
# 1. provision the game on the box
ssh root@$BOX_IP mkdir -p /opt/et-web/deploy
rsync -av deploy/Caddyfile tools/proxy/proxy.js root@$BOX_IP:/opt/et-web/deploy/
ssh root@$BOX_IP "ET_HOST=$ET_HOST RCONPASSWORD=$RCONPASSWORD ETLEGACY_SHA=$ETLEGACY_SHA bash -s" \
    < deploy/box-setup.sh
# 2. push the client + paks
BOX_IP=$BOX_IP ASSET_BASE=$ASSET_BASE R2_REMOTE=$R2_REMOTE deploy/release.sh
```

The deploy runs from the machine/IP that ran the infra deploy (SSH is allowlisted
to that IP only).

### Every release

```sh
# rebuild gl4es + client first if engine/mod changed (see top-level README)
BOX_IP=… ASSET_BASE=… R2_REMOTE=… deploy/release.sh
```

`release.sh` bakes `ASSET_BASE` into `manifest.json`, generates a prod
`config.js` (asset base; empty `wsUrl` → same-origin `wss://<host>/net`) to a
temp file, `rclone sync`s `web/files/` to R2, and rsyncs the shell to the box.
The committed `web/config.js` (local-dev defaults) is never touched.

### Update flows

- **Shell/client only:** `release.sh` (paks unchanged → R2 sync is a no-op).
  Clients pick it up on reload; purge the CF cache for `…/manifest.json` +
  `/etl.js` if you set long browser TTLs.
- **Engine/mod:** bump `ETLEGACY_SHA`, rebuild client + rerun `box-setup.sh`
  (rebuilds + restarts the server) **together** — client paks (R2) and server
  must be the same commit or the server rejects clients.
- **Rollback:** push paks under a versioned R2 prefix and flip `ASSET_BASE` to
  roll the client back instantly; rerun `box-setup.sh` at the old SHA for the
  server.

### helja.la-side contract (lives in that repo, not here)

- **chamber/SSM secrets:** R2 access key + secret (from a CF R2 API token),
  `RCONPASSWORD`.
- **Origin CA cert** generated + scp'd to the box `$TLS_DIR` (see above).
- **SSL mode** Full (Strict) for `et.helja.la`.
- **Wrapper** that `chamber exec`s the env into `box-setup.sh` / `release.sh`.

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

Builds native `etlded`, sets up the runtime dir + proxy + units, auto-TLS Caddy.
Leave `web/config.js` `wsUrl`/`assetBase` empty → same-origin `wss://<host>/net`
and same-origin paks. Open `27960/udp` too if you want native desktop cross-play.

---

## Notes (both shapes)

- The proxy binds `127.0.0.1` and is only reachable through Caddy.
- `dedicated 1` = browser-only (no master heartbeat; UDP can stay closed).
  `dedicated 2` lists the server publicly so native desktop players can find +
  join the same matches — needs `27960/udp` open (exposes the origin IP).
- Game data (paks) is never in a repo — `box-setup.sh` pulls etmain paks from
  `mirror.etlegacy.com`; the `legacy_*.pk3` (with the mods) is produced by the
  build.
