// Chromium.iso client. Plain JS with no three.js, so the browser keeps working even if the 3D part fails.
// Boots the Vercel Sandbox VM through /api/vm, then speaks the 3d-browser protocol over one WebSocket:
// JSON text events/commands plus binary JPEG frames. ?iso=ws://host:port/api/ws skips /api/vm (local server).
import { store, qs, clamp, FONT, rrect } from './util.js';

if (qs.get('key')) store.set('isoKey', qs.get('key'));
const SESSION = qs.get('session') || store.get('isoSession') || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/[^\w-]/g, '');
  store.set('isoSession', id); return id;
})();
export const HOME_URL = 'https://en.wikipedia.org/wiki/Space';
const $ = (id) => document.getElementById(id);

export class Iso {
  constructor() {
    this.canvas = document.createElement('canvas'); this.canvas.width = 960; this.canvas.height = 600;
    this.ctx = this.canvas.getContext('2d');
    this.hooks = { frame: () => {}, status: () => {}, toast: () => {} };
    this.state = 'off'; this.ws = null; this.rid = 0; this.pending = new Map(); this.retry = 0; this.wanted = false;
    this.lines = []; this.tabs = { active: null, tabs: [] }; this.hasFrame = false; this.frames = 0; this.reloadedFor = '';
    this.decoding = false; this.nextFrame = null; this.bootT0 = 0;
    this.touch = new TouchDriver(this);
    this.drawBoot();
    this.panel();
  }
  get key() { return store.get('isoKey', ''); }
  setKey(k) { store.set('isoKey', String(k || '').trim()); }
  get active() { return this.tabs.tabs.find((t) => t.id === this.tabs.active) || null; }

  setState(s, msg = '') { this.state = s; this.stateMsg = msg; const chip = $('isoChip'); if (chip) chip.dataset.s = s; this.hooks.status(s, msg); }
  line(t) { this.lines.push(t); if (this.lines.length > 14) this.lines.shift(); if (!this.hasFrame) this.drawBoot(); }
  fail(msg) { this.setState('error', msg); this.line('ERROR: ' + msg); this.line('Press the CHROMIUM.ISO button to retry.'); }

  async open() {
    this.wanted = true;
    if (this.ws && this.ws.readyState <= 1) return;
    if (this.state === 'booting' || this.state === 'connecting') return;
    await this.boot();
  }
  close() {
    this.wanted = false; clearInterval(this.keepTimer); clearTimeout(this.retryTimer);
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* closed */ } }
    this.setState('off');
  }

  async boot() {
    this.lines = []; this.hasFrame = false; this.bootT0 = performance.now();
    this.line('SPACE OF THE TOURISM  ·  CHROMIUM.ISO');
    this.line('Mounting chromium.iso …');
    let ws = qs.get('iso');
    if (!ws) {
      if (!this.key) { this.setState('needkey'); this.line('Access key required to boot the VM.'); return; }
      this.setState('booting'); this.line('Waking the Vercel Sandbox VM …');
      let res;
      try {
        const r = await fetch('/api/vm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'boot', key: this.key }) });
        res = { status: r.status, j: await r.json().catch(() => ({})) };
      } catch (e) { return this.fail('Could not reach /api/vm (' + e.message + ')'); }
      if (!this.wanted) return;
      if (res.status === 403) { this.setState('needkey'); this.line('That access key was refused.'); return; }
      if (!res.j.ok || !res.j.ws) return this.fail(res.j.error || res.j.log || 'The VM did not start');
      this.line(`${res.j.resumed ? 'VM resumed from its snapshot' : 'VM was already running'} (${((performance.now() - this.bootT0) / 1000).toFixed(1)} s)`);
      ws = res.j.ws;
      clearInterval(this.keepTimer);
      this.keepTimer = setInterval(() => this.keepalive(), 4 * 60 * 1000);
    }
    this.wsUrl = ws;
    this.connect();
  }
  keepalive() {
    if (!this.wanted || qs.get('iso')) return;
    fetch('/api/vm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'keepalive', key: this.key }) }).catch(() => {});
  }

  connect() {
    this.setState('connecting'); this.line('Connecting to Chromium …');
    const sep = this.wsUrl.includes('?') ? '&' : '?';
    const ws = new WebSocket(`${this.wsUrl}${sep}s=${encodeURIComponent(SESSION)}&key=${encodeURIComponent(this.key)}`);
    ws.binaryType = 'blob';
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.line('Connected. Starting the browser …'); };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return this.onFrame(e.data);
      let m; try { m = JSON.parse(e.data); } catch { return; }
      const d = m.data;
      if (m.ev === 'reply') { const r = this.pending.get(m.rid); if (r) { this.pending.delete(m.rid); r(d); } if (d && d.error) this.hooks.toast(d.error); }
      else if (m.ev === 'status') this.onStatus(d);
      else if (m.ev === 'tabs') this.onTabs(d);
      else if (m.ev === 'toast') this.hooks.toast(d.text);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      for (const r of this.pending.values()) r({ error: 'disconnected' });
      this.pending.clear();
      if (!this.wanted) return;
      this.retry++;
      if (this.retry > 3 && !qs.get('iso')) { this.line('Lost the VM. Booting it again …'); this.retry = 0; this.ws = null; this.boot(); return; }
      this.setState('connecting'); this.line('Connection dropped, retrying …');
      this.retryTimer = setTimeout(() => this.wanted && this.connect(), Math.min(10000, 800 * 2 ** this.retry));
    };
  }
  send(cmd) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.resolve({ error: 'not connected' });
    const id = ++this.rid;
    this.ws.send(JSON.stringify({ ...cmd, rid: id }));
    return new Promise((res) => this.pending.set(id, res));
  }
  onStatus(s) {
    if (s.state === 'launching') this.line(s.msg || 'Starting Chromium …');
    if (s.state === 'ready') { this.setState('ready'); this.line('Chromium is up. Loading Wikipedia: Space …'); }
    if (s.state === 'closed' || s.state === 'error') { this.hasFrame = false; this.line(s.msg || 'Chromium stopped.'); if (s.state === 'error') this.setState('error', s.msg); }
  }
  onTabs(d) {
    this.tabs = d;
    const a = this.active;
    // Wikimedia sometimes answers a brand-new VM with an error page; one automatic reload fixes it.
    if (a && /Wikimedia Error/i.test(a.title || '') && this.reloadedFor !== a.url) {
      this.reloadedFor = a.url; setTimeout(() => this.send({ type: 'reload' }), 2500);
    }
    this.renderTabs();
  }
  onFrame(blob) { this.nextFrame = blob; if (!this.decoding) this.decodeNext(); }
  async decodeNext() {
    const f = this.nextFrame; this.nextFrame = null;
    if (!f) return;
    this.decoding = true;
    try {
      const bmp = await createImageBitmap(new Blob([f], { type: 'image/jpeg' }));
      this.ctx.drawImage(bmp, 0, 0, this.canvas.width, this.canvas.height); bmp.close();   // fixed size: it backs a GPU texture
      this.hasFrame = true; this.frames++;
      this.hooks.frame();
      this.mirror();
    } catch { /* corrupt frame */ }
    this.decoding = false;
    if (this.nextFrame) this.decodeNext();
  }

  // retro boot screen, drawn until the first frame arrives
  drawBoot(time = performance.now()) {
    if (this.hasFrame) return;
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(87,242,214,.06)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
    g.font = `600 ${Math.round(H / 24)}px ${FONT}`; g.textBaseline = 'top';
    this.lines.forEach((l, i) => { g.fillStyle = l.startsWith('ERROR') ? '#ff6b75' : i === 0 ? '#ff9a3c' : '#57f2d6'; g.fillText(l, W * 0.05, H * 0.07 + i * H / 17); });
    const busy = this.state === 'booting' || this.state === 'connecting' || (this.state === 'ready' && !this.hasFrame);
    if (busy) {
      const t = (time - this.bootT0) / 1000;
      g.fillStyle = '#57f2d6'; g.fillText((Math.floor(time / 400) % 2 ? '█' : ' ') + `  ${t.toFixed(1)} s`, W * 0.05, H * 0.07 + this.lines.length * H / 17);
      const bw = W * 0.9, bx = W * 0.05, by = H * 0.88;
      g.strokeStyle = '#57f2d6'; g.lineWidth = 2; rrect(g, bx, by, bw, H * 0.04, 6); g.stroke();
      const p = (Math.sin(time / 500) * 0.5 + 0.5);
      g.fillStyle = '#57f2d6'; rrect(g, bx + 4 + p * (bw - bw * 0.25 - 8), by + 4, bw * 0.25, H * 0.04 - 8, 4); g.fill();
    }
    if (this.state === 'needkey') {
      g.fillStyle = '#ff9a3c'; g.font = `700 ${Math.round(H / 16)}px ${FONT}`; g.fillText('Tap here to enter the access key', W * 0.05, H * 0.8);
    }
    this.mirror();
  }

  // ---------------------------------------------------------------- input (normalized 0..1 coordinates)
  wheel(dx, dy, x, y) { this.send({ type: 'mouse', action: 'move', x, y }); this.send({ type: 'wheel', dx, dy }); }
  type(text) { if (text) this.send({ type: 'type', text }); }
  press(key) { this.send({ type: 'press', key }); }
  navigate(url) { this.send({ type: 'navigate', url }); }
  home() { this.navigate(HOME_URL); }

  // ---------------------------------------------------------------- 2D Chromium panel
  panel() {
    const P = $('isoPanel'); if (!P) return;
    const cv = $('isoCanvas'); this.pc = cv.getContext('2d');
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) }; };
    cv.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; e.preventDefault(); cv.setPointerCapture(e.pointerId); if (this.state === 'needkey') return this.hooks.needKey?.(); const p = pos(e); this.touch.down(e.pointerId, p.x, p.y); });
    cv.addEventListener('pointermove', (e) => { const p = pos(e); this.touch.move(e.pointerId, p.x, p.y); });
    const up = (e) => { const p = pos(e); this.touch.up(e.pointerId, p.x, p.y, e.type === 'pointercancel'); };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    let acc = { dx: 0, dy: 0 }, timer = null;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); acc.dx += e.deltaX; acc.dy += e.deltaY; if (timer) return;
      const p = pos(e); timer = setTimeout(() => { timer = null; this.wheel(acc.dx, acc.dy, p.x, p.y); acc = { dx: 0, dy: 0 }; }, 50);
    }, { passive: false });
    const url = $('isoUrl');
    url.addEventListener('focus', () => url.select());
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.navigate(url.value); url.blur(); } e.stopPropagation(); });
    const typeBox = $('isoType');
    const sendTyped = (enter) => { this.type(typeBox.value); if (enter) this.press('Enter'); typeBox.value = ''; };
    typeBox.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); sendTyped(true); } });
    $('pEnter').onclick = () => sendTyped(true);
    $('pBksp').onclick = () => { if (typeBox.value) typeBox.value = typeBox.value.slice(0, -1); else this.press('Backspace'); };
    $('pBack').onclick = () => this.send({ type: 'back' });
    $('pFwd').onclick = () => this.send({ type: 'forward' });
    $('pReload').onclick = () => this.send({ type: 'reload' });
    $('pHome').onclick = () => this.home();
    $('pClose').onclick = () => this.showPanel(false);
  }
  showPanel(on) { const P = $('isoPanel'); if (!P) return; P.classList.toggle('open', on); this.panelOpen = on; if (on) this.mirror(); }
  mirror() {
    if (!this.panelOpen || !this.pc) return;
    const cv = this.pc.canvas;
    if (cv.width !== this.canvas.width || cv.height !== this.canvas.height) { cv.width = this.canvas.width; cv.height = this.canvas.height; }
    this.pc.drawImage(this.canvas, 0, 0);
  }
  renderTabs() {
    const box = $('isoTabs'), url = $('isoUrl'), a = this.active;
    if (a && url && document.activeElement !== url) url.value = a.url === 'about:blank' ? '' : a.url;
    if (!box) return;
    box.textContent = '';
    for (const t of this.tabs.tabs) {
      const el = document.createElement('button'); el.className = 'chip' + (t.id === this.tabs.active ? ' on' : '');
      const s = document.createElement('span'); s.textContent = (t.title || t.url || 'New tab').slice(0, 28); el.appendChild(s);
      const x = document.createElement('b'); x.textContent = ' ✕'; x.title = 'Close tab'; el.appendChild(x);
      el.onclick = (e) => { if (e.target === x) this.send({ type: 'closeTab', id: t.id }); else if (t.id !== this.tabs.active) this.send({ type: 'switch', id: t.id }); };
      box.appendChild(el);
    }
    const plus = document.createElement('button'); plus.className = 'chip'; plus.textContent = '+'; plus.title = 'New tab';
    plus.onclick = () => this.send({ type: 'newTab', url: HOME_URL });
    box.appendChild(plus);
  }
}

// Fingers (or the mouse) become real touch events in Chromium: native scrolling, taps, pinch.
// Moves are coalesced to one per animation frame with at most 3 in flight, and the final move
// is sent before "end" so fast swipes keep their last stretch.
class TouchDriver {
  constructor(iso) { this.iso = iso; this.fingers = new Map(); this.inFlight = 0; this.queued = false; }
  points() { return [...this.fingers.values()].map((f) => ({ id: f.id, x: f.x, y: f.y })); }
  freeId() { const used = new Set([...this.fingers.values()].map((f) => f.id)); let i = 0; while (used.has(i)) i++; return i; }
  down(pid, x, y) { this.fingers.set(pid, { id: this.freeId(), x, y }); this.iso.send({ type: 'touch', action: 'start', points: this.points() }); }
  move(pid, x, y) { const f = this.fingers.get(pid); if (!f) return; f.x = x; f.y = y; this.queue(); }
  up(pid, x, y, cancel = false) {
    const f = this.fingers.get(pid); if (!f) return;
    f.x = x; f.y = y;
    if (!cancel) this.iso.send({ type: 'touch', action: 'move', points: this.points() });
    this.fingers.delete(pid);
    this.iso.send({ type: 'touch', action: cancel ? 'cancel' : 'end', points: this.points() });
  }
  queue() {
    if (this.queued) return;
    this.queued = true;
    const flush = () => {
      if (this.inFlight >= 3) return requestAnimationFrame(flush);
      this.queued = false;
      if (!this.fingers.size) return;
      this.inFlight++;
      this.iso.send({ type: 'touch', action: 'move', points: this.points() }).finally(() => this.inFlight--);
    };
    requestAnimationFrame(flush);
  }
}
