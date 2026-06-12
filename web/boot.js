/*
 * Boot shim for the ET: Legacy web client.
 *
 * Downloads the game paks listed in manifest.json into the Emscripten
 * filesystem before the engine starts, then hands control to main().
 * Layout inside the virtual FS:
 *
 *   /et/etmain/pak0.pk3 ...       original W:ET assets
 *   /et/legacy/legacy_*.pk3       ET:Legacy mod pak (includes wasm mods)
 *   /et/home                      fs_homepath (configs, extracted mod libs)
 */

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function logLine(msg, isErr) {
  const div = document.createElement('div');
  if (isErr) div.className = 'err';
  div.textContent = msg;
  logEl.appendChild(div);
  while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

async function fetchInto(path, url, onProgress) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch ${url}: HTTP ${resp.status}`);
  const total = Number(resp.headers.get('Content-Length')) || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (onProgress) onProgress(got, total);
  }
  const buf = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  FS.writeFile(path, buf);
}

var Module = {
  canvas: document.getElementById('canvas'),
  arguments: [
    '+set', 'fs_basepath', '/et',
    '+set', 'fs_homepath', '/et/home',
    '+set', 'r_fullscreen', '0',
    '+set', 'r_mode', '-1',
    '+set', 'r_customwidth', '1280',
    '+set', 'r_customheight', '720',
    '+set', 'r_allowsoftwaregl', '1',
    '+set', 's_initsound', '0',
    '+set', 'com_introplayed', '1',  // skip intro cinematic
    '+set', 'r_ext_compiled_vertex_array', '0',
    '+set', 'r_fbo', '0',
    '+set', 'r_textureMode', 'GL_LINEAR',
    '+set', 'r_speeds', '1',
  ],
  print: (t) => { console.log(t); logLine(t, false); },
  printErr: (t) => { console.error(t); logLine(t, true); },

  preRun: [function () {
    addRunDependency('et-paks');
    (async () => {
      FS.mkdir('/et');
      FS.mkdir('/et/etmain');
      FS.mkdir('/et/legacy');
      FS.mkdir('/et/home');

      const manifest = await (await fetch('manifest.json')).json();
      let i = 0;
      for (const f of manifest.files) {
        i++;
        const label = `[${i}/${manifest.files.length}] ${f.path}`;
        await fetchInto('/et/' + f.path, f.url, (got, total) => {
          const mb = (got / 1048576).toFixed(1);
          const tmb = total ? (total / 1048576).toFixed(1) : '?';
          setStatus(`downloading ${label} — ${mb}/${tmb} MB`);
        });
      }
      setStatus('starting engine…');
      removeRunDependency('et-paks');
    })().catch((e) => {
      setStatus('FAILED: ' + e.message);
      logLine(String(e.stack || e), true);
    });
  }],

  onRuntimeInitialized: function () {
    setStatus('engine running');
  },
};
