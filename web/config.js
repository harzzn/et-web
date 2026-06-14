// Deployment configuration - edit per environment.
// Local dev: leave wsUrl/assetBase empty to use same-origin defaults
// (ws://host:27970 and files/...). Production sets the et.helja.la URLs.
window.ET_CONFIG = {
  // game server the "Deploy" button connects to (host:port as the engine
  // sees it; the ws<->udp proxy does the real routing)
  server: '127.0.0.1:27960',

  // WebSocket tunnel endpoint. Empty -> client default
  // (wss://<page-host>/net on https, ws://<host>:27970 on http), which is
  // what the Cloudflare-proxied production setup uses. Only set this to
  // override (e.g. a dedicated low-latency socket host).
  wsUrl: '',

  // Base URL the manifest's pak files are fetched from. Empty -> 'files/'
  // (served from the same origin, for local dev). Production: the R2
  // custom domain, e.g. 'https://assets.et.helja.la/'.
  // NOTE: this is consumed by stage-web.sh at build time to write
  // manifest.json; it is duplicated here only for reference.
  assetBase: '',

  // first-download size shown on the landing page
  downloadSize: '~230 MB',
};
