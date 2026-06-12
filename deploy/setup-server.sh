#!/usr/bin/env bash
# One-shot setup for a Debian/Ubuntu VPS. Run as root from /opt/et-web after
# rsyncing the bundle there (see deploy/README.md for the rsync layout).
set -euo pipefail

ETWEB=/opt/et-web
cd "$ETWEB"

echo "== packages =="
apt-get update -q
apt-get install -y -q build-essential cmake git nodejs npm caddy curl unzip

echo "== user =="
id -u etweb >/dev/null 2>&1 || useradd -r -d "$ETWEB" -s /usr/sbin/nologin etweb

echo "== native server build =="
# server-only build of the same tree the wasm client came from: protocol,
# mod version and pk3 contents match by construction
cmake -S src -B build-server -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SERVER=ON -DBUILD_CLIENT=OFF -DBUILD_MOD=ON \
  -DBUILD_CLIENT_MOD=OFF -DBUILD_SERVER_MOD=ON \
  -DBUNDLED_LIBS=ON -DCROSS_COMPILE32=OFF \
  -DFEATURE_OMNIBOT=OFF -DINSTALL_EXTRA=OFF -DENABLE_MULTI_BUILD=OFF \
  -DFEATURE_AUTOUPDATE=OFF -DFEATURE_TRACKER=OFF
cmake --build build-server -j"$(nproc)"

echo "== server runtime =="
mkdir -p server/etmain server/legacy server/home
cp build-server/etlded server/
cp build-server/legacy/qagame.mp.*.so server/legacy/
# paks: hardlink from the web assets (NOT symlinks - the engine skips
# symlinked pk3s when scanning)
for f in web/files/etmain/*.pk3; do ln -f "$(readlink -f "$f")" "server/etmain/$(basename "$f")"; done
for f in web/files/legacy/*.pk3; do ln -f "$(readlink -f "$f")" "server/legacy/$(basename "$f")"; done
[ -f server/server.cfg ] || cat > server/server.cfg <<'CFG'
// map rotation + admin password; edit me
set rconpassword "CHANGE_ME"
set sv_maxclients 24
set sv_fps 20
set sv_maxRate 45000
CFG

echo "== proxy =="
mkdir -p proxy
cp tools/proxy/proxy.js proxy/
cd proxy && npm install --omit=dev ws >/dev/null && cd ..

echo "== permissions =="
chown -R etweb:etweb "$ETWEB"

echo "== services =="
cp deploy/systemd/etlded.service deploy/systemd/et-proxy.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now etlded et-proxy

echo "== caddy =="
echo "Edit /etc/caddy/Caddyfile with your domain (template: deploy/Caddyfile),"
echo "set ET_CONFIG.server in web/config.js to <your-domain>:27960 equivalent,"
echo "then: systemctl reload caddy"
echo
echo "done. check: systemctl status etlded et-proxy"
