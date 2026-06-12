#!/usr/bin/env bash
# Launch the full local stack: native etlded + ws-udp proxy + static http.
# Stop with Ctrl-C (kills all three).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAP="${1:-radar}"

trap 'kill 0' EXIT

"$ROOT/build/native-server/etlded" \
  +set fs_basepath "$ROOT/server" \
  +set fs_homepath "$ROOT/server/home" \
  +set fs_game legacy \
  +set dedicated 1 \
  +set sv_pure 0 +set sv_allowDownload 0 \
  +set net_port 27960 +set g_doWarmup 0 \
  +map "$MAP" &

node "$ROOT/tools/proxy/proxy.js" --listen 27970 --target 127.0.0.1:27960 &

cd "$ROOT/web" && python3 -m http.server 8666 &

echo
echo "stack up:"
echo "  game server  udp://127.0.0.1:27960 (map: $MAP)"
echo "  ws proxy     ws://localhost:27970"
echo "  web client   http://localhost:8666/?args=%2Bconnect%20127.0.0.1%3A27960"
echo
wait
