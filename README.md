# ET: Legacy Web

**Wolfenstein: Enemy Territory** — the free 2003 multiplayer WWII shooter —
running in your browser, no install. This is the real
[ET: Legacy](https://www.etlegacy.com) engine (the actively-maintained
successor to id Software's id Tech 3 codebase) compiled to WebAssembly: the
same game, the same netcode, rendered through WebGL and played against a
standard dedicated server over a WebSocket tunnel.

**Play:** [et.helja.la](https://et.helja.la) — first visit downloads ~230 MB of
game data once, then it's cached in your browser.

> Non-commercial fan project. Not affiliated with Splash Damage, id Software,
> ZeniMax or Microsoft. See [Licensing](#licensing).

## What it does

- Runs the genuine ET: Legacy client in the browser — menu, 3D world, HUD,
  sound — at native-ish frame rates on a desktop GPU.
- **Multiplayer** against an ordinary `etlded` dedicated server. Browsers
  can't send UDP, so a tiny WebSocket↔UDP proxy bridges the gap; the server is
  unmodified and can host browser and native desktop players in the same match.
- **Offline practice** — the client embeds a listen server, so you can spawn
  into a map with no network at all.
- **One-time download** — game data is fetched once and persisted in the
  browser (IndexedDB); later visits start immediately.

## How it works

A native FPS engine wasn't built for the web, so the interesting parts are the
seams:

- **Rendering** — the vanilla OpenGL 1.x renderer runs on
  [gl4es](https://github.com/ptitSeb/gl4es), which translates desktop GL to the
  GLES2 calls Emscripten maps onto WebGL2 (`-sFULL_ES2`, WebGL2 only). GLEW is
  replaced by a small compatibility shim (`renderercommon/tr_gl4es_compat.h`).
- **Game modules** — `cgame`/`ui` (and the listen server's `qagame`) are built
  as Emscripten *side modules* and `dlopen`'d at runtime exactly like the native
  `.so`/`.dll` mods, packed inside the standard `legacy` pk3.
- **Main loop** — the blocking frame loop becomes
  `emscripten_set_main_loop` (driven by `requestAnimationFrame`).
- **Networking** — `src/sys/net_web_tunnel.c` funnels every engine datagram
  through one binary WebSocket to a colocated proxy; incoming messages are
  dispatched on the normal packet path. The client-side shim sits at the
  `Sys_SendPacket`/`NET_Sleep` boundary, so the transport can later be swapped
  for WebTransport without touching game code.
- **Assets** — `boot.js` fetches the paks into the Emscripten filesystem
  mounted on IndexedDB; the manifest carries sizes so cached files are skipped
  and stale ones re-fetched.

Several non-obvious WebGL/Emscripten issues had to be solved for any of this to
draw a pixel — they're documented inline where fixed (search the engine fork's
`web` branch for `__EMSCRIPTEN__`) and in [`patches/`](patches/).

## Build

Requires the Emscripten SDK and CMake ≥ 4.3.3 (for Emscripten side modules).

```sh
source tools/emsdk/emsdk_env.sh

# gl4es (once, or after changing it)
cd tools/gl4es
emcmake cmake -B build-web -DCMAKE_BUILD_TYPE=Release -DSTATICLIB=ON \
  -DNOX11=ON -DNOEGL=ON -DNO_LOADER=ON -DNO_INIT_CONSTRUCTOR=ON \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_C_FLAGS="-DDEFAULT_ES=2 -O3 -fPIC"
cmake --build build-web -j8
cd ../..

# client + game modules
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

# the etl link doesn't depend on libGL.a, so after rebuilding gl4es force a relink:
#   rm build/web/etl build/web/etl.wasm && cmake --build build/web -j8 --target etl

./scripts/stage-web.sh   # links artifacts into web/ and writes manifest.json
```

You also need the game data, which is **not** included (see Licensing). Fetch
`mp_bin.pk3` and `pak0/1/2.pk3` from `mirror.etlegacy.com/etmain/` into
`assets/etmain/` before staging.

## Run locally

The full local stack (dedicated server + proxy + web host):

```sh
./scripts/run-stack.sh radar
# then open http://localhost:8666
```

Or just the web client served statically:

```sh
cd web && python3 -m http.server 8666
```

There's a headless smoke-test harness (needs Chrome) under `tools/headless/`
that boots the page, drives input, and captures screenshots.

## Deploy

The box serves plain local HTTP; the public hostname and TLS come from whatever
fronts it (a tunnel, a reverse proxy, or Caddy's own auto-TLS for a direct
self-host). Everything is parameterized — no host, secret, or account detail
lives in this repo. See [`deploy/README.md`](deploy/README.md).

## Repository layout

| Path | What |
|---|---|
| `src/` | ET: Legacy engine fork (branch `web`) — the Emscripten patches |
| `tools/gl4es/` | gl4es fork (branch `etweb`) — the WebGL fixes |
| `tools/proxy/` | the WebSocket↔UDP proxy (`proxy.js`) |
| `tools/headless/` | puppeteer-based smoke-test harness |
| `web/` | the browser shell: landing page, `boot.js` loader, `config.js` |
| `scripts/` | build staging + local run helpers |
| `deploy/` | generic server-provisioning + release tooling |
| `patches/` | exported gl4es diff for reproducibility |
| `assets/etmain/` | game paks (you supply these; not in the repo) |

## Licensing

- **Engine** — [ET: Legacy](https://github.com/harzzn/etlegacy/tree/web) fork
  (branch `web`): **GPLv3**, from id Software's 2010 source release plus id's
  additional terms. Serving `etl.wasm` conveys a GPL binary, so these source
  repos are the corresponding-source offer.
- **GL translation** — [gl4es](https://github.com/harzzn/gl4es/tree/etweb) fork
  (branch `etweb`): MIT.
- **This repo** (shell, proxy, deploy tooling): GPLv3 to match.
- **Game data** (`pak0.pk3` etc.) is **not** included and **not** GPL — it
  remains the property of id Software / ZeniMax / Microsoft, distributed free of
  charge since 2003 under the W:ET EULA. Non-commercial redistribution of the
  intact data is long-established community practice.

## Credits

Built on [ET: Legacy](https://www.etlegacy.com) and
[gl4es](https://github.com/ptitSeb/gl4es). The browser-port approach was
demonstrated for Return to Castle Wolfenstein at
[rtcw.pieter.com](https://rtcw.pieter.com). Hosted by
[Harri Heljala](https://helja.la).
