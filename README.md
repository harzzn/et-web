# ET: Legacy — Web Port

Wolfenstein: Enemy Territory (via ET: Legacy) compiled to WebAssembly,
running in the browser. **Status: Phase 3 milestone reached** — the browser
client connects to a NATIVE dedicated server (etlded) through a
WebSocket↔UDP proxy: full handshake, gamestate, ClientBegin, live snapshot
rendering. Also working: in-browser local listen server (Phase 2), menu +
profile UI (Phase 1).

Quick start: `./scripts/run-stack.sh radar` then open
`http://localhost:8666/?args=%2Bconnect%20127.0.0.1%3A27960`

## Source & licensing

- Engine: [ET: Legacy](https://www.etlegacy.com) fork, branch `web` —
  [github.com/harzzn/etlegacy](https://github.com/harzzn/etlegacy/tree/web).
  **GPLv3** (id Software's 2010 source release + id's additional terms).
  Serving `etl.wasm` is conveying a GPL binary: these repos ARE the
  corresponding source offer. Keep them public and in sync with deploys.
- GL translation: [gl4es](https://github.com/ptitSeb/gl4es) fork, branch
  `etweb` — [github.com/harzzn/gl4es](https://github.com/harzzn/gl4es/tree/etweb) (MIT).
- This repo (shell, proxy, deploy tooling): GPLv3 to match.
- Game data (`pak0.pk3` etc.) is NOT included and NOT GPL: it remains the
  property of id Software / ZeniMax / Microsoft, distributed free of charge
  since 2003 under the W:ET EULA (non-commercial redistribution of intact
  data is long-established community practice). Fetch from
  `mirror.etlegacy.com/etmain/` into `assets/etmain/`.
- Non-commercial fan project; not affiliated with Splash Damage, id
  Software, ZeniMax or Microsoft.

## Layout

| Path | What |
|---|---|
| `src/` | ET: Legacy clone, branch `web` carries the Emscripten patches |
| `tools/emsdk/` | Emscripten SDK (latest, activated) |
| `tools/gl4es/` | gl4es clone, branch `etweb` carries WebGL fixes (also in `patches/`) |
| `tools/headless/` | puppeteer-core harness: boots the page, captures console + screenshots |
| `assets/etmain/` | pak0/1/2 + mp_bin (freely redistributable, from mirror.etlegacy.com) |
| `web/` | index.html + boot.js shell; `stage-web.sh` links build artifacts here |
| `patches/` | exported gl4es diff for reproducibility |
| `build/web/` | CMake build dir (client wasm + legacy mod side modules + mod pk3) |

## Build

```sh
source tools/emsdk/emsdk_env.sh

# gl4es (once, or after changing it)
cd tools/gl4es
emcmake cmake -B build-web -DCMAKE_BUILD_TYPE=Release -DSTATICLIB=ON \
  -DNOX11=ON -DNOEGL=ON -DNO_LOADER=ON -DNO_INIT_CONSTRUCTOR=ON \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_C_FLAGS="-DDEFAULT_ES=2 -O3 -fPIC"
cmake --build build-web -j8

# client + mods (note: cmake >= 4.3.3 required for emscripten side modules)
emcmake cmake -S src -B build/web -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SERVER=OFF -DBUILD_CLIENT=ON -DBUILD_MOD=ON \
  -DBUILD_CLIENT_MOD=ON -DBUILD_SERVER_MOD=ON \
  -DBUNDLED_LIBS=ON -DCROSS_COMPILE32=OFF \
  -DFEATURE_CURL=OFF -DFEATURE_SSL=OFF -DFEATURE_AUTH=OFF \
  -DFEATURE_OGG_VORBIS=OFF -DFEATURE_THEORA=OFF -DFEATURE_OPENAL=OFF \
  -DFEATURE_FREETYPE=ON -DFEATURE_PNG=OFF \
  -DFEATURE_TRACKER=OFF -DFEATURE_AUTOUPDATE=OFF \
  -DFEATURE_IPV6=OFF -DFEATURE_IRC_CLIENT=OFF -DFEATURE_IRC_SERVER=OFF \
  -DFEATURE_DBMS=OFF -DFEATURE_RENDERER1=ON -DRENDERER_DYNAMIC=OFF \
  -DFEATURE_OMNIBOT=OFF -DINSTALL_EXTRA=OFF -DENABLE_MULTI_BUILD=OFF
cmake --build build/web -j8

# IMPORTANT: the etl link does not depend on tools/gl4es/lib/libGL.a;
# after rebuilding gl4es, force a relink:
#   rm build/web/etl build/web/etl.wasm && cmake --build build/web -j8 --target etl

./scripts/stage-web.sh
```

## Run

```sh
cd web && python3 -m http.server 8666
# open http://localhost:8666/
```

Headless smoke test (Chrome required):

```sh
cd tools/headless && ET_SECS=40 node boot-test.js   # screenshot at /tmp/etweb-shot.png
```

## Architecture notes (what made this work)

- **GL**: vanilla renderer1 (GL1.x) → gl4es → GLES2 → WebGL2 (`-sFULL_ES2`,
  `MIN/MAX_WEBGL_VERSION=2`). GLEW replaced by `tr_gl4es_compat.h`.
- **Three gl4es/WebGL landmines fixed** (all invisible-failure modes):
  1. Emscripten's `eglGetProcAddress` returns *non-emulated* GL functions
     (precompiled system lib without FULL_ES2) — gl4es must be fed the
     statically-linked symbols (`sdl_gl4es_procs.c`).
  2. WebGL can't read vertex attribs from client memory; gl4es now streams
     client arrays into VBOs per draw (gl4es `fpe.c` patch).
  3. vid_restart reuses the same WebGL context; binding shadows and
     attrib-enable mirrors desync across it (sdl_glimp resync +
     gl4es `buffers.c` patch). Don't touch attrib enables at restart.
- **Mods**: cgame/ui are Emscripten side modules (`SIDE_MODULE=1`, PIC
  everywhere, client is `MAIN_MODULE=1`), packed into the legacy pk3 and
  extracted + dlopen'd at runtime exactly like native. `vmMain` is called
  through a 13-arg signature on wasm (exact-match indirect calls).
- **Indices**: ushort on Emscripten (`tr_local.h`), like the GLES renderer.
- **Main loop**: `emscripten_set_main_loop` drives `Com_Frame` (rAF).
- **Console**: `con_passive.c` (tty stdin polling deadlocks the event loop).
- **FS**: paks fetched by `boot.js` into MEMFS under `/et`; `fs_homepath`
  `/et/home`. IDBFS/OPFS persistence is still TODO.

## Networking (Phase 3)

- `src/sys/net_web_tunnel.c`: every outgoing engine datagram = one binary
  WS message to the proxy; incoming messages dispatched via the normal
  packet path from `NET_Sleep`. Single-tunnel model: incoming packets are
  attributed to the last send destination, the proxy owns real addressing.
  `net_wsUrl` cvar overrides the default `ws://<page-host>:27970`.
- `tools/proxy/proxy.js`: one UDP socket per WS client, fixed UDP target
  (no open relay), idle timeout, client cap. Colocate with etlded.
- Native server: `build/native-server/etlded`, runtime dir `server/`
  (NB: pk3s must be hardlinks/copies — the engine skips symlinked pk3s).

## Next

- Interactive online playtest; join team, latency feel via proxy
- WebTransport upgrade beneath the same tunnel API (WS stays as fallback)
- Server browser / multi-target addressing in tunnel frame format
- Persistence: IDBFS or OPFS for /et/home + pak cache (currently re-downloads)
- Perf pass: in-map r_speeds, SIMD build, lazy per-map paks
- Cosmetics: benign generateMipmap/texParameter warnings at init;
  'sound muted' until focus; 'unknown cmd vdr' from server
