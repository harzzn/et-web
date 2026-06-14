#!/usr/bin/env bash
# Provision the ET:Legacy game onto an ALREADY-provisioned box (the cloud
# infra - box, firewall, DNS, R2 - is managed elsewhere; this only installs
# the game server, the ws<->udp proxy, Caddy config and systemd units).
#
# Generic + parameterized: no hostnames, IPs or secrets are baked in. The
# caller (e.g. a helja.la wrapper via `chamber exec`) supplies everything via
# env. Run AS ROOT on the box, e.g. from the deploy machine:
#
#   ssh root@$BOX_IP ETLEGACY_SHA=... ET_HOST=... RCONPASSWORD=... \
#       'bash -s' < deploy/box-setup.sh
#
# Expects (rsync'd to $DEPLOY_DIR beforehand, or fetched - see RAW_BASE):
#   proxy.js                the ws<->udp proxy
# Origin CA cert is placed out of band at $TLS_DIR/origin.{pem,key}.
#
# Env:
#   ET_HOST         vhost Caddy serves (e.g. et.example.com)        (required)
#   RCONPASSWORD    server rcon password                            (required)
#   ETLEGACY_REPO   default https://github.com/harzzn/etlegacy
#   ETLEGACY_BRANCH default web
#   ETLEGACY_SHA    commit to build; MUST match the wasm client build
#                   (default: branch HEAD - pin it for reproducible matches)
#   GL4ES_REPO      default https://github.com/harzzn/gl4es
#   GL4ES_BRANCH    default etweb
#   GL4ES_SHA       default branch HEAD
#   ET_ROOT         default /opt/et-web
#   TLS_DIR         default $ET_ROOT/tls   (origin.pem / origin.key live here)
#   SV_HOSTNAME     default "ET Web"
#   SV_MAXCLIENTS   default 24
#   START_MAP       default radar
set -euo pipefail

ET_HOST="${ET_HOST:?set ET_HOST=<vhost, e.g. et.example.com>}"
RCONPASSWORD="${RCONPASSWORD:?set RCONPASSWORD}"
ETLEGACY_REPO="${ETLEGACY_REPO:-https://github.com/harzzn/etlegacy}"
ETLEGACY_BRANCH="${ETLEGACY_BRANCH:-web}"
ETLEGACY_SHA="${ETLEGACY_SHA:-}"
GL4ES_REPO="${GL4ES_REPO:-https://github.com/harzzn/gl4es}"
GL4ES_BRANCH="${GL4ES_BRANCH:-etweb}"
GL4ES_SHA="${GL4ES_SHA:-}"
ET_ROOT="${ET_ROOT:-/opt/et-web}"
TLS_DIR="${TLS_DIR:-$ET_ROOT/tls}"
DEPLOY_DIR="${DEPLOY_DIR:-$ET_ROOT/deploy}"
SV_HOSTNAME="${SV_HOSTNAME:-ET Web}"
SV_MAXCLIENTS="${SV_MAXCLIENTS:-24}"
START_MAP="${START_MAP:-radar}"

echo "== packages =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q build-essential cmake git curl rsync
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -; apt-get install -y nodejs; }

id -u etweb >/dev/null 2>&1 || useradd -r -d "$ET_ROOT" -s /bin/bash etweb

echo "== source ($ETLEGACY_BRANCH${ETLEGACY_SHA:+@$ETLEGACY_SHA}) =="
mkdir -p "$ET_ROOT"
if [ -d "$ET_ROOT/src/.git" ]; then
  git -C "$ET_ROOT/src" fetch -q origin "$ETLEGACY_BRANCH"
else
  git clone -q -b "$ETLEGACY_BRANCH" "$ETLEGACY_REPO" "$ET_ROOT/src"
fi
git -C "$ET_ROOT/src" checkout -q "${ETLEGACY_SHA:-origin/$ETLEGACY_BRANCH}"
if [ -d "$ET_ROOT/tools/gl4es/.git" ]; then
  git -C "$ET_ROOT/tools/gl4es" fetch -q origin "$GL4ES_BRANCH"
else
  git clone -q -b "$GL4ES_BRANCH" "$GL4ES_REPO" "$ET_ROOT/tools/gl4es"
fi
git -C "$ET_ROOT/tools/gl4es" checkout -q "${GL4ES_SHA:-origin/$GL4ES_BRANCH}"
BUILT_SHA="$(git -C "$ET_ROOT/src" rev-parse --short HEAD)"

echo "== build native server ($BUILT_SHA) =="
# server-only: protocol + mod version come from the same commit the wasm
# client was built from, so cgame/ui (client) and qagame (server) match
cmake -S "$ET_ROOT/src" -B "$ET_ROOT/build-server" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SERVER=ON -DBUILD_CLIENT=OFF -DBUILD_MOD=ON \
  -DBUILD_CLIENT_MOD=OFF -DBUILD_SERVER_MOD=ON \
  -DBUNDLED_LIBS=ON -DCROSS_COMPILE32=OFF \
  -DFEATURE_OMNIBOT=OFF -DINSTALL_EXTRA=OFF -DENABLE_MULTI_BUILD=OFF \
  -DFEATURE_AUTOUPDATE=OFF -DFEATURE_TRACKER=OFF
cmake --build "$ET_ROOT/build-server" -j"$(nproc)"

echo "== server runtime =="
mkdir -p "$ET_ROOT/server/etmain" "$ET_ROOT/server/legacy" "$ET_ROOT/server/home"
cp "$ET_ROOT/build-server/etlded" "$ET_ROOT/server/"
cp "$ET_ROOT"/build-server/legacy/qagame.mp.*.so "$ET_ROOT/server/legacy/"
ln -f "$ET_ROOT"/build-server/legacy/legacy_*.pk3 "$ET_ROOT/server/legacy/"
# etmain paks (not in any repo - licensing) from the etlegacy mirror
for f in mp_bin pak0 pak1 pak2; do
  [ -f "$ET_ROOT/server/etmain/$f.pk3" ] || \
    curl -sfo "$ET_ROOT/server/etmain/$f.pk3" "https://mirror.etlegacy.com/etmain/$f.pk3"
done
cat > "$ET_ROOT/server/server.cfg" <<CFG
set rconpassword "$RCONPASSWORD"
set sv_hostname "$SV_HOSTNAME"
set sv_maxclients $SV_MAXCLIENTS
set sv_fps 20
set sv_maxRate 45000
CFG

echo "== proxy =="
mkdir -p "$ET_ROOT/proxy"
[ -f "$DEPLOY_DIR/proxy.js" ] && cp "$DEPLOY_DIR/proxy.js" "$ET_ROOT/proxy/proxy.js" \
  || curl -sfo "$ET_ROOT/proxy/proxy.js" "https://raw.githubusercontent.com/harzzn/et-web/main/tools/proxy/proxy.js"
( cd "$ET_ROOT/proxy" && [ -f package.json ] || npm init -y >/dev/null; npm i --omit=dev ws >/dev/null )

echo "== caddy ($ET_HOST, origin CA tls) =="
mkdir -p "$TLS_DIR"
if [ ! -s "$TLS_DIR/origin.pem" ] || [ ! -s "$TLS_DIR/origin.key" ]; then
  echo "WARNING: $TLS_DIR/origin.{pem,key} missing - place the Cloudflare Origin"
  echo "         CA cert there (root:caddy 0640 key) or Caddy will fail to serve TLS."
fi
chgrp -R caddy "$TLS_DIR" 2>/dev/null || true
chmod 0640 "$TLS_DIR"/origin.key 2>/dev/null || true
sed "s/{ET_HOST}/$ET_HOST/g; s#{TLS_DIR}#$TLS_DIR#g" "$DEPLOY_DIR/Caddyfile" > /etc/caddy/Caddyfile

echo "== systemd units =="
cat > /etc/systemd/system/etlded.service <<UNIT
[Unit]
Description=ET:Legacy dedicated server (web port)
After=network.target
[Service]
Type=simple
User=etweb
WorkingDirectory=$ET_ROOT/server
ExecStart=$ET_ROOT/server/etlded \\
  +set fs_basepath $ET_ROOT/server \\
  +set fs_homepath $ET_ROOT/server/home \\
  +set fs_game legacy +set dedicated 1 +set net_port 27960 \\
  +set sv_pure 0 +set sv_allowDownload 0 \\
  +exec server.cfg +map $START_MAP
Restart=always
RestartSec=5
CPUWeight=200
MemoryMax=2G
[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/et-proxy.service <<UNIT
[Unit]
Description=WebSocket to UDP proxy for ET:Legacy web clients
After=network.target etlded.service
[Service]
Type=simple
User=etweb
ExecStart=/usr/bin/node $ET_ROOT/proxy/proxy.js --host 127.0.0.1 --listen 27970 --target 127.0.0.1:27960
Restart=always
RestartSec=3
MemoryMax=512M
[Install]
WantedBy=multi-user.target
UNIT

mkdir -p "$ET_ROOT/web"
chown -R etweb:etweb "$ET_ROOT"
systemctl daemon-reload
systemctl enable --now etlded et-proxy
systemctl reload caddy || systemctl restart caddy

echo
echo "box-setup done (built $BUILT_SHA). server + proxy + caddy up."
echo "now push the client: deploy/release.sh  (shell -> box, paks -> R2)"
