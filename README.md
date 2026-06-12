# ET: Legacy — Web Port

Wolfenstein: Enemy Territory (via ET: Legacy) compiled to WebAssembly,
running in the browser. **Status: Phase 2 core complete** — the in-browser
local listen server hosts maps (qagame/cgame/ui all run as wasm side
modules); the 3D world renders (verified on radar), keyboard/mouse input
reaches the engine, SDL audio initializes. Test a map directly:
`http://localhost:8666/?args=%2Bset%20sv_pure%200%20%2Bdevmap%20radar`

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
  -DBUILD_CLIENT_MOD=ON -DBUILD_SERVER_MOD=OFF \
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

## Next (Phase 3+)

- Interactive playtest: join team via limbo, pointer-lock mouselook feel
- Networking: WebSocket→UDP proxy + native etlded (Phase 3)
- Persistence: IDBFS or OPFS for /et/home + pak cache (currently re-downloads)
- Perf pass: in-map r_speeds, SIMD build, lazy per-map paks
- Cosmetics: 5 benign generateMipmap/texParameter warnings at renderer init;
  'sound system is muted' until window focus
