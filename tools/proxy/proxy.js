// WebSocket <-> UDP proxy for the ET:Legacy web client.
//
// Each WebSocket connection gets its own UDP socket; binary WS messages map
// 1:1 to UDP datagrams toward a fixed target server (Phase 3: single server,
// no relaying to arbitrary hosts). Run colocated with etlded.
//
// usage: node proxy.js [--listen 27970] [--target 127.0.0.1:27960]

const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
}

const LISTEN = Number(argVal('listen', 27970));
const [TARGET_HOST, TARGET_PORT_S] = argVal('target', '127.0.0.1:27960').split(':');
const TARGET_PORT = Number(TARGET_PORT_S);
const MAX_CLIENTS = 64;
const IDLE_MS = 5 * 60 * 1000;

const wss = new WebSocketServer({ port: LISTEN });
let clients = 0;

console.log(`ws-udp proxy: ws://0.0.0.0:${LISTEN} -> udp ${TARGET_HOST}:${TARGET_PORT}`);

wss.on('connection', (ws, req) => {
  if (clients >= MAX_CLIENTS) {
    ws.close(1013, 'full');
    return;
  }
  clients++;
  const peer = req.socket.remoteAddress;
  const udp = dgram.createSocket('udp4');
  let lastActivity = Date.now();
  console.log(`[+] ${peer} (${clients} clients)`);

  udp.on('message', (msg) => {
    lastActivity = Date.now();
    if (ws.readyState === ws.OPEN) ws.send(msg);
  });
  udp.on('error', (e) => {
    console.log(`udp error for ${peer}: ${e.message}`);
    ws.close();
  });

  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    lastActivity = Date.now();
    udp.send(data, TARGET_PORT, TARGET_HOST);
  });

  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_MS) ws.close(1000, 'idle');
  }, 30000);

  ws.on('close', () => {
    clients--;
    clearInterval(idleTimer);
    udp.close();
    console.log(`[-] ${peer} (${clients} clients)`);
  });
});
