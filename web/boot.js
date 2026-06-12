/*
 * Boot shim for the ET: Legacy web client.
 *
 * The landing page calls startET(extraArgs); game paks listed in
 * manifest.json are then fetched into the Emscripten filesystem (persisted
 * in IndexedDB - one-time download) before the engine starts.
 *
 * Layout inside the virtual FS (all under the IDBFS mount):
 *   /et/etmain/pak0.pk3 ...       original W:ET assets
 *   /et/legacy/legacy_*.pk3       ET:Legacy mod pak (includes wasm mods)
 *   /et/legacy/qagame.mp.*.wasm   server mod for the local listen server
 *   /et/home                      fs_homepath (configs, profiles, etkey)
 *
 * Harness/dev compatibility: ?args=... in the URL auto-starts the engine
 * with those arguments appended (no landing interaction needed).
 */

const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const barEl = document.getElementById('bar');

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setProgress(frac) {
  if (barEl) barEl.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
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
  arguments: [], // set by startET
  print: (t) => { console.log(t); logLine(t, false); },
  printErr: (t) => { console.error(t); logLine(t, true); },

  preRun: [function () {
    addRunDependency('et-paks');
    (async () => {
      // /et lives in IndexedDB: paks download once, configs persist
      FS.mkdir('/et');
      FS.mount(IDBFS, {}, '/et');
      setStatus('loading cache…');
      await new Promise((res, rej) => FS.syncfs(true, (e) => (e ? rej(e) : res())));

      if (new URLSearchParams(location.search).get('reset')) {
        logLine('cache reset requested', false);
        const rmTree = (dir) => {
          for (const name of FS.readdir(dir)) {
            if (name === '.' || name === '..') continue;
            const p = dir + '/' + name;
            if (FS.isDir(FS.stat(p).mode)) { rmTree(p); FS.rmdir(p); }
            else FS.unlink(p);
          }
        };
        rmTree('/et');
      }

      for (const d of ['/et/etmain', '/et/legacy', '/et/home']) {
        try { FS.mkdir(d); } catch (e) { /* exists */ }
      }

      const manifest = await (await fetch('manifest.json')).json();

      // drop stale pak/mod versions no longer in the manifest
      const wanted = new Set(manifest.files.map((f) => '/et/' + f.path));
      for (const dir of ['/et/etmain', '/et/legacy']) {
        for (const name of FS.readdir(dir)) {
          if (name === '.' || name === '..') continue;
          const p = dir + '/' + name;
          if (!wanted.has(p) && FS.isFile(FS.stat(p).mode)) {
            logLine('dropping stale ' + p, false);
            FS.unlink(p);
          }
        }
      }

      // figure out what needs downloading (for aggregate progress)
      const todo = [];
      let totalBytes = 0;
      for (const f of manifest.files) {
        const path = '/et/' + f.path;
        try {
          const st = FS.stat(path);
          if (FS.isFile(st.mode) && (!f.size || st.size === f.size)) continue; // cached
        } catch (e) { /* missing */ }
        todo.push(f);
        totalBytes += f.size || 0;
      }

      let doneBytes = 0, i = 0;
      for (const f of todo) {
        i++;
        await fetchInto('/et/' + f.path, f.url, (got, total) => {
          const mb = ((doneBytes + got) / 1048576).toFixed(1);
          const tmb = totalBytes ? (totalBytes / 1048576).toFixed(0) : '?';
          setStatus(`downloading [${i}/${todo.length}] — ${mb}/${tmb} MB`);
          if (totalBytes) setProgress((doneBytes + got) / totalBytes);
        });
        doneBytes += f.size || 0;
      }

      if (todo.length > 0) {
        setStatus('saving cache…');
        await new Promise((res, rej) => FS.syncfs(false, (e) => (e ? rej(e) : res())));
      }
      setProgress(1);
      setStatus('starting engine…');
      removeRunDependency('et-paks');
    })().catch((e) => {
      setStatus('FAILED: ' + e.message);
      logLine(String(e.stack || e), true);
    });
  }],

  onRuntimeInitialized: function () {
    setStatus('in the field');
    // persist configs/profiles (and anything else under /et) periodically
    // and on tab close; syncfs diffs against IndexedDB so this is cheap
    setInterval(() => FS.syncfs(false, () => {}), 15000);
    addEventListener('beforeunload', () => FS.syncfs(false, () => {}));
  },
};

const BASE_ARGS = [
  '+set', 'fs_basepath', '/et',
  '+set', 'fs_homepath', '/et/home',
  '+set', 'r_fullscreen', '0',
  '+set', 'r_mode', '-1',
  '+set', 'r_customwidth', '1280',
  '+set', 'r_customheight', '720',
  '+set', 'r_allowsoftwaregl', '1',
  '+set', 'com_introplayed', '1',
  '+set', 'r_ext_compiled_vertex_array', '0',
  '+set', 'r_fbo', '0',
  '+set', 'cl_motd', '0',
];

let started = false;
function startET(extraArgs) {
  if (started) return;
  started = true;

  const urlArgs = (new URLSearchParams(location.search).get('args') || '')
    .split(' ').filter(Boolean);
  Module.arguments = BASE_ARGS.concat(extraArgs || [], urlArgs);

  document.body.classList.add('playing');
  setStatus('preparing…');

  const s = document.createElement('script');
  s.src = 'etl.js';
  document.body.appendChild(s);
}

/* ---------------------------------------------- landing wiring */

(function () {
  const cfg = window.ET_CONFIG || {};
  const callsign = document.getElementById('callsign');
  const dlsize = document.getElementById('dlsize');

  if (dlsize && cfg.downloadSize) dlsize.textContent = cfg.downloadSize;
  if (callsign) {
    callsign.value = localStorage.getItem('et_callsign') || '';
    callsign.addEventListener('change', () =>
      localStorage.setItem('et_callsign', callsign.value));
  }

  function nameArgs() {
    const n = (callsign && callsign.value.trim()) || '';
    return n ? ['+set', 'name', n.slice(0, 30)] : [];
  }

  const online = document.getElementById('btn-online');
  const offline = document.getElementById('btn-offline');
  if (online) online.addEventListener('click', () =>
    startET(nameArgs().concat(['+connect', cfg.server || '127.0.0.1:27960'])));
  if (offline) offline.addEventListener('click', () =>
    startET(nameArgs().concat(['+set', 'sv_pure', '0', '+devmap', 'radar'])));

  // status text toggles the console log
  statusEl.addEventListener('click', () =>
    document.body.classList.toggle('showlog'));

  // harness/dev: auto-start when args are supplied in the URL
  const qs = new URLSearchParams(location.search);
  if (qs.get('args') !== null || qs.get('autoplay') !== null) {
    startET([]);
  }
})();
