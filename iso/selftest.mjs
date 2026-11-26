// node selftest.mjs <ws-url> <key>  → connects like the game does and prints a JSON summary
import WebSocket from 'ws';
const [url, key] = process.argv.slice(2);
const t0 = Date.now();
const out = { url, opened: false, statuses: [], frames: 0, firstFrameMs: null, jpeg: false, tab: null, scrolled: null, error: null };
const ws = new WebSocket(`${url}?s=selftest&key=${encodeURIComponent(key || '')}`);
let rid = 0; const pending = new Map();
const send = (c) => new Promise((r) => { const id = ++rid; pending.set(id, r); ws.send(JSON.stringify({ ...c, rid: id })); });
ws.on('unexpected-response', (_q, r) => { out.error = 'HTTP ' + r.statusCode; done(); });
ws.on('error', (e) => { out.error = String(e.message || e); done(); });
ws.on('open', async () => {
  out.opened = true;
  await new Promise((r) => setTimeout(r, 9000));
  const y0 = out.tab && out.tab.title;
  await send({ type: 'touch', action: 'start', points: [{ id: 0, x: 0.5, y: 0.8 }] });
  for (let i = 1; i <= 6; i++) await send({ type: 'touch', action: 'move', points: [{ id: 0, x: 0.5, y: 0.8 - i * 0.08 }] });
  await send({ type: 'touch', action: 'end', points: [] });
  const f0 = out.frames;
  await new Promise((r) => setTimeout(r, 2500));
  out.scrolled = out.frames > f0;   // a scroll repaints, so new screencast frames must arrive
  out.title0 = y0;
  done();
});
ws.on('message', (d, bin) => {
  if (bin) { out.frames++; if (out.firstFrameMs === null) { out.firstFrameMs = Date.now() - t0; out.jpeg = d[0] === 0xff && d[1] === 0xd8; out.frameBytes = d.length; } return; }
  const m = JSON.parse(String(d));
  if (m.ev === 'reply') { const r = pending.get(m.rid); if (r) { pending.delete(m.rid); r(m.data); } }
  else if (m.ev === 'status') out.statuses.push(m.data.state + (m.data.msg ? ':' + m.data.msg.slice(0, 80) : ''));
  else if (m.ev === 'tabs') { const a = m.data.tabs.find((t) => t.id === m.data.active); if (a) out.tab = { url: a.url, title: a.title }; }
});
let finished = false;
function done() { if (finished) return; finished = true; out.totalMs = Date.now() - t0; console.log(JSON.stringify(out)); try { ws.close(); } catch {} setTimeout(() => process.exit(0), 200); }
setTimeout(done, 30000);
