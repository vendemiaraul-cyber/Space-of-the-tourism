// Space of the Tourism: Chromium ISO server.
// Runs inside the Vercel Sandbox VM ("the ISO"), or locally with Node for testing.
// Same protocol as 3d-browser: one WebSocket at /api/ws?s=<session>&key=<key>.
//   text frames  = JSON  {ev, data} from the server, {type, ..., rid} commands from the client
//   binary frames = JPEG screenshots of the active tab (CDP screencast)
//
// Env: PORT=3000 HOST=0.0.0.0 ACCESS_KEY=... CHROMIUM_PATH=/path/to/chrome START_URL=...
//      VIEWPORT_W=960 VIEWPORT_H=600 JPEG_QUALITY=60 MAX_FPS=15 IDLE_SECONDS=90 MAX_SESSIONS=3
//      ALLOWED_ORIGINS=https://a.example,https://b.example   HEADLESS=1|0

import http from 'node:http';
import { BrowserHub } from './core.js';

let puppeteer = null, WebSocketServer = null;
for (const name of ['puppeteer-core', 'puppeteer']) {
  try { puppeteer = (await import(name)).default; break; } catch { /* try the next one */ }
}
try { ({ WebSocketServer } = await import('ws')); } catch { /* reported below */ }
if (!puppeteer || !WebSocketServer) {
  console.error('Missing dependencies. Run:  npm i puppeteer-core ws');
  process.exit(1);
}

const env = process.env;
const PORT = +env.PORT || 3000;
const HOST = env.HOST || '0.0.0.0';
const KEY = env.ACCESS_KEY || '';
const IDLE_MS = (+env.IDLE_SECONDS || 90) * 1000;
const MAX_SESSIONS = +env.MAX_SESSIONS || 3;
const ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const VIEWPORT = { width: +env.VIEWPORT_W || 960, height: +env.VIEWPORT_H || 600 };
const START_URL = env.START_URL || 'https://en.wikipedia.org/wiki/Space';
const QUALITY = +env.JPEG_QUALITY || 60;
const MIN_GAP = 1000 / (+env.MAX_FPS || 15);

let version = '';
const launch = async () => {
  const b = await puppeteer.launch({
    headless: env.HEADLESS !== '0',
    executablePath: env.CHROMIUM_PATH || undefined,
    args: [
      '--no-sandbox',                 // the VM is the sandbox; Ubuntu blocks Chromium's userns sandbox
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      '--lang=en-US',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });
  version = await b.version().catch(() => version);
  return b;
};

// One BrowserHub (one Chromium) per viewer session id.
const sessions = new Map(); // sid -> { hub, clients:Set<ws>, idle, last }

function closeSession(sid, why = 'session closed') {
  const s = sessions.get(sid);
  if (!s) return;
  clearTimeout(s.idle);
  sessions.delete(sid);
  s.hub.close().catch(() => {});
  for (const ws of s.clients) ws.close(1001, why);
}

function getSession(sid) {
  let s = sessions.get(sid);
  if (s) return s;
  if (sessions.size >= MAX_SESSIONS) {
    // make room by closing the longest-idle session nobody is watching
    const victim = [...sessions.entries()].filter(([, x]) => !x.clients.size).sort((a, b) => a[1].last - b[1].last)[0];
    if (!victim) return null;
    closeSession(victim[0], 'evicted');
  }
  const clients = new Set();
  s = { clients, idle: null, last: Date.now() };
  // drop frames (never state events) for a client whose socket is backed up
  const sendFrame = (bytes) => { for (const ws of clients) if (ws.readyState === 1 && ws.bufferedAmount < 2e6) ws.send(bytes); };
  // cap the stream at MAX_FPS for phones; the newest frame of a burst is always delivered
  let lastSent = 0, latest = null, trail = null;
  const capped = (bytes) => {
    const now = Date.now(), wait = MIN_GAP - (now - lastSent);
    if (wait <= 0) { lastSent = now; latest = null; return sendFrame(bytes); }
    latest = bytes;
    if (!trail) trail = setTimeout(() => { trail = null; if (latest) { lastSent = Date.now(); sendFrame(latest); latest = null; } }, wait);
  };
  s.hub = new BrowserHub({
    launch,
    startUrl: START_URL,
    viewport: { ...VIEWPORT },
    jpegQuality: QUALITY,
    emit: (ev, data) => {
      const msg = JSON.stringify({ ev, data });
      for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
    },
    emitFrame: capped,
  });
  sessions.set(sid, s);
  return s;
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  const head = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
  if (pathname === '/healthz') {
    res.writeHead(200, { ...head, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, version, sessions: sessions.size, uptime: Math.round(process.uptime()) }));
  }
  res.writeHead(200, { ...head, 'content-type': 'text/plain; charset=utf-8' });
  res.end('Space of the Tourism / Chromium ISO.\nConnect a WebSocket to /api/ws?s=<session>&key=<key>\n');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x');
  const deny = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); socket.destroy(); };
  if (u.pathname !== '/api/ws') return deny(404, 'Not Found');
  if (KEY && u.searchParams.get('key') !== KEY) return deny(403, 'Forbidden');
  if (ORIGINS.length && req.headers.origin && !ORIGINS.includes(req.headers.origin)) return deny(403, 'Forbidden');
  const sid = (u.searchParams.get('s') || 'default').replace(/[^\w-]/g, '').slice(0, 64) || 'default';
  const s = getSession(sid);
  if (!s) return deny(503, 'Busy');
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, sid, s));
});

function onConnection(ws, sid, s) {
  clearTimeout(s.idle);
  s.clients.add(ws);
  s.last = Date.now();
  s.hub.greet((t) => ws.send(t), (b) => ws.send(b));
  s.hub.ensure().catch(() => {}); // boot Chromium right away; errors arrive as a status event
  let chain = Promise.resolve();   // commands run one after another, so down/up and key order hold
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let cmd;
    try { cmd = JSON.parse(String(data)); } catch { return; }
    s.last = Date.now();
    chain = chain.then(async () => {
      let out;
      try { out = await s.hub.handle(cmd); } catch (e) { out = { error: String((e && e.message) || e).split('\n')[0] }; }
      if (ws.readyState === 1) ws.send(JSON.stringify({ ev: 'reply', rid: cmd.rid, data: out }));
    });
  });
  ws.on('close', () => {
    s.clients.delete(ws);
    if (!s.clients.size && sessions.get(sid) === s) s.idle = setTimeout(() => closeSession(sid, 'idle'), IDLE_MS);
  });
  ws.on('error', () => {});
}

// keep sockets warm through proxies
setInterval(() => { for (const s of sessions.values()) for (const ws of s.clients) { try { ws.ping(); } catch {} } }, 25000).unref();

server.listen(PORT, HOST, () => console.log(`Chromium ISO server on http://${HOST}:${PORT} (key ${KEY ? 'required' : 'off'})`));

const quit = async () => { for (const sid of [...sessions.keys()]) closeSession(sid, 'shutdown'); setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
