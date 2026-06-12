#!/usr/bin/env bash
# Stage the web client for local serving: link build artifacts + assets into
# web/ and generate manifest.json. Run after every build.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
BUILD="$ROOT/build/web"
ASSETS="$ROOT/assets"

ln -sf "$BUILD/etl"      "$WEB/etl.js"
ln -sf "$BUILD/etl.wasm" "$WEB/etl.wasm"
mkdir -p "$WEB/files/etmain" "$WEB/files/legacy"

for f in "$ASSETS"/etmain/*.pk3; do
  ln -sf "$f" "$WEB/files/etmain/$(basename "$f")"
done

# the mod pk3 carries cgame/ui (extracted at runtime); qagame is served as a
# loose file like on a native server, for the in-browser local listen server
legacy_pk3=$(ls "$BUILD"/legacy/legacy_*.pk3 | head -1)
ln -sf "$legacy_pk3" "$WEB/files/legacy/$(basename "$legacy_pk3")"
ln -sf "$BUILD/legacy/qagame.mp.wasm32.wasm" "$WEB/files/legacy/qagame.mp.wasm32.wasm"

# manifest: path = location under /et in the wasm FS, url = fetch URL
{
  echo '{ "files": ['
  first=1
  for f in "$WEB"/files/etmain/*.pk3 "$WEB"/files/legacy/*.pk3 "$WEB"/files/legacy/*.wasm; do
    rel="${f#"$WEB/files/"}"
    [ $first -eq 1 ] || echo ','
    first=0
    printf '  { "path": "%s", "url": "files/%s" }' "$rel" "$rel"
  done
  echo ''
  echo '] }'
} > "$WEB/manifest.json"

echo "staged: $(ls "$WEB")"
