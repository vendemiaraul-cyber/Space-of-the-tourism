// BrowserHub — the Chromium side of 3D-Browser, shared by:
//   • src/worker.js  (Cloudflare Worker + Durable Object, Browser Run via @cloudflare/puppeteer)
//   • server.js      (local Node server, puppeteer)
// It manages tabs, navigation, mouse/keyboard input, auto-browse (crawl) and a live JPEG
// frame stream. Transport is injected: emit(ev, data) for JSON events, emitFrame(bytes) for frames.

const errMsg = (e) => String((e && e.message) || e).split('\n')[0];
const b64ToBytes = (b64) => globalThis.Buffer
  ? globalThis.Buffer.from(b64, 'base64')
  : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;                        // has a scheme
  if (/^(localhost|127\.|\[::1\])/i.test(s)) return 'http://' + s;
  if (/^[^\s/]+\.[^\s/]{2,}(\/\S*)?$/.test(s)) return 'https://' + s;  // looks like a host
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);         // otherwise search
}
const canon = (h) => {
  try { const u = new URL(h); if (!/^https?:$/.test(u.protocol)) return null; u.hash = ''; return u.href; }
  catch { return null; }
};
const BUTTONS = ['left', 'middle', 'right'];

export class BrowserHub {
  constructor(o) {
    this.launchFn = o.launch;
    this.emit = o.emit;
    this.emitFrame = o.emitFrame;
    this.startUrl = o.startUrl || 'https://en.wikipedia.org/wiki/Color';
    this.viewport = o.viewport || { width: 1280, height: 720 };
    this.quality = o.jpegQuality || 70;
    this.browser = null;
    this.launching = null;
    this.tabs = new Map();
    this.byPage = new WeakMap();
    this.activeId = null;
    this.nextId = 1;
    this.lastFrame = null;
    this.state = { state: 'idle', msg: '' };
    this.pollTimer = null;
    this.crawl = { on: false, dwell: 6, sameOrigin: false, max: 200, scroll: true, queue: [], visited: new Set(), count: 0, timer: null, scrollTimer: null, current: '' };
  }

  // ---------------------------------------------------------------- state out
  status(state, msg = '') { this.state = { state, msg }; this.emit('status', this.state); }
  tabList() {
    return {
      active: this.activeId,
      tabs: [...this.tabs.values()].map((t) => ({ id: t.id, title: t.title || t.page.url(), url: t.page.url(), loading: t.loading })),
    };
  }
  pushTabs() { this.emit('tabs', this.tabList()); }
  crawlState() {
    const c = this.crawl;
    return { on: c.on, visited: c.count, queued: c.queue.length, current: c.current, max: c.max, dwell: c.dwell, sameOrigin: c.sameOrigin, scroll: c.scroll };
  }
  pushCrawl() { this.emit('crawl', this.crawlState()); }
  toast(text) { this.emit('toast', { text }); }
  /** Send the current state to one newly connected client. */
  greet(sendText, sendBinary) {
    const j = (ev, data) => sendText(JSON.stringify({ ev, data }));
    j('hello', { viewport: this.viewport });
    j('status', this.state);
    j('tabs', this.tabList());
    j('crawl', this.crawlState());
    if (this.lastFrame) sendBinary(this.lastFrame);
  }
  frame(bytes) { this.lastFrame = bytes; this.emitFrame(bytes); }

  // ---------------------------------------------------------------- browser lifecycle
  get alive() {
    const b = this.browser;
    return !!b && (typeof b.connected === 'boolean' ? b.connected : b.isConnected());
  }
  async ensure() {
    if (this.alive) return this.browser;
    if (this.launching) return this.launching;
    this.launching = (async () => {
      this.status('launching', 'Starting Chromium…');
      const b = await this.launchFn();
      this.browser = b;
      this.tabs.clear(); this.activeId = null;
      b.on('disconnected', () => {
        if (this.browser !== b) return;
        this.browser = null; this.tabs.clear(); this.activeId = null;
        clearInterval(this.pollTimer);
        this.stopCrawl();
        this.status('closed', 'Chromium session ended. Click the screen or press Enter in the URL bar to restart.');
        this.pushTabs();
      });
      const pages = await b.pages();
      const first = this.adopt(pages[0] || await b.newPage());
      for (const p of pages.slice(1)) this.adopt(p);
      await this.activate(first.id);
      this.go(first, this.startUrl);
      this.status('ready');
      return b;
    })();
    try { return await this.launching; }
    catch (e) { this.status('error', 'Could not start Chromium: ' + errMsg(e)); throw e; }
    finally { this.launching = null; }
  }
  async close() {
    this.stopCrawl();
    clearInterval(this.pollTimer);
    const b = this.browser;
    this.browser = null; this.tabs.clear(); this.activeId = null;
    if (b) await b.close().catch(() => {});
    this.status('closed', 'Chromium session closed (idle).');
  }

  // ---------------------------------------------------------------- tabs
  adopt(page) {
    let t = this.byPage.get(page);
    if (t) return t;
    t = { id: this.nextId++, page, cdp: null, title: '', loading: false, lastMouse: null, castOk: false };
    this.tabs.set(t.id, t);
    this.byPage.set(page, t);
    const refreshTitle = async () => { t.title = await page.title().catch(() => t.title); };
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) { t.loading = true; this.pushTabs(); } });
    page.on('domcontentloaded', async () => { await refreshTitle(); t.loading = false; this.pushTabs(); });
    page.on('load', async () => {
      await refreshTitle(); t.loading = false; this.pushTabs();
      if (this.activeId === t.id) { t.castOk = false; await this.startCast(t); this.snapshot(t); }
    });
    page.on('popup', (p) => { if (p) { const nt = this.adopt(p); this.activate(nt.id); } });
    page.on('close', () => {
      this.tabs.delete(t.id);
      if (this.activeId === t.id) {
        this.activeId = null;
        const rest = [...this.tabs.keys()];
        if (rest.length) this.activate(rest[rest.length - 1]);
        else if (this.alive) this.newTab(this.startUrl).catch(() => {});
      }
      this.pushTabs();
    });
    page.setViewport({ ...this.viewport, deviceScaleFactor: 1 }).catch(() => {});
    refreshTitle().then(() => this.pushTabs());
    this.pushTabs();
    return t;
  }
  async newTab(url) {
    const t = this.adopt(await this.browser.newPage());
    await this.activate(t.id);
    const u = normalizeUrl(url);
    if (u) this.go(t, u);
    return t;
  }
  async activate(id) {
    const t = this.tabs.get(id);
    if (!t) return;
    if (this.activeId !== null && this.activeId !== id) await this.stopCast(this.tabs.get(this.activeId));
    this.activeId = id;
    await t.page.bringToFront().catch(() => {});
    await this.startCast(t);
    this.pushTabs();
    this.snapshot(t);
  }

  // ---------------------------------------------------------------- frames
  // CDP screencast pushes a frame whenever the page repaints. Screenshot polling is a fallback
  // until the first screencast frame arrives for the tab (e.g. right after a cross-process navigation).
  async cdpFor(t) {
    if (!t.cdp) {
      t.cdp = await t.page.createCDPSession();
      t.cdp.on('Page.screencastFrame', (f) => {
        t.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
        t.castOk = true;
        if (this.activeId === t.id) this.frame(b64ToBytes(f.data));
      });
    }
    return t.cdp;
  }
  // Real touch input: the page sees touchstart/move/end, native scrolling, taps and pinch.
  async touch(t, action, points) {
    const cdp = await this.cdpFor(t);
    if (!t.touch) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      t.touch = true;
    }
    const type = { start: 'touchStart', move: 'touchMove', end: 'touchEnd', cancel: 'touchCancel' }[action];
    if (!type) throw new Error('bad touch action');
    const vp = this.viewport;
    const touchPoints = (Array.isArray(points) ? points : []).slice(0, 5).map((p) => ({
      x: Math.max(0, Math.min(1, +p.x || 0)) * vp.width,
      y: Math.max(0, Math.min(1, +p.y || 0)) * vp.height,
      id: p.id | 0, radiusX: 10, radiusY: 10, force: 1,
    }));
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
  async startCast(t) {
    try {
      await this.cdpFor(t);
      await t.cdp.send('Page.startScreencast', {
        format: 'jpeg', quality: this.quality,
        maxWidth: this.viewport.width, maxHeight: this.viewport.height, everyNthFrame: 1,
      });
    } catch { /* mid-navigation; 'load' retries */ }
    this.startPoll(t);
  }
  async stopCast(t) { if (t && t.cdp) await t.cdp.send('Page.stopScreencast').catch(() => {}); }
  startPoll(t) {
    clearInterval(this.pollTimer);
    let busy = false, ticks = 0;
    this.pollTimer = setInterval(async () => {
      if (this.activeId !== t.id || busy || !this.alive) return;
      busy = true;
      if (++ticks % 4 === 0) {                     // keep the tab title live (pages change it at runtime)
        const title = await t.page.title().catch(() => t.title);
        if (title !== t.title) { t.title = title; this.pushTabs(); }
      }
      if (!t.castOk) {
        const bytes = await this.capture(t);
        if (bytes && this.activeId === t.id && !t.castOk) this.frame(bytes);
      }
      busy = false;
    }, 400);
  }
  async snapshot(t) {
    const bytes = await this.capture(t);
    if (bytes && this.activeId === t.id) this.frame(bytes);
  }
  // Raw CDP capture instead of page.screenshot(): puppeteer's newPage() waits on pending
  // page.screenshot() calls, and one taken mid-navigation can stall forever.
  async capture(t) {
    if (!t.cdp) return null;
    let timer;
    try {
      const r = await Promise.race([
        t.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: this.quality, optimizeForSpeed: true }),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('capture timeout')), 3000); }),
      ]);
      return b64ToBytes(r.data);
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  // ---------------------------------------------------------------- navigation
  async go(t, url) {
    t.loading = true; this.pushTabs();
    try { await t.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
    catch (e) { if (this.alive) this.toast(`Couldn't load ${url}: ${errMsg(e)}`); }
    t.loading = false; this.pushTabs();
  }

  // ---------------------------------------------------------------- auto-browse
  enqueue(urls, front = false) {
    const c = this.crawl, add = [];
    for (const raw of urls) {
      const s = canon(normalizeUrl(raw));
      if (s && !c.visited.has(s) && !c.queue.includes(s) && !add.includes(s)) add.push(s);
    }
    if (front) c.queue.unshift(...add); else c.queue.push(...add);
    if (c.queue.length > 5000) c.queue.length = 5000;
    this.pushCrawl();
    return add.length;
  }
  async harvest(t) {
    try {
      const here = new URL(t.page.url());
      let links = await t.page.$$eval('a[href]', (as) => as.map((a) => a.href));
      links = links.map(canon).filter(Boolean).filter((h) => !this.crawl.sameOrigin || new URL(h).origin === here.origin);
      for (let i = links.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [links[i], links[j]] = [links[j], links[i]]; }
      this.enqueue(links.slice(0, 300));
    } catch {}
  }
  stopCrawl() {
    const c = this.crawl;
    c.on = false;
    clearTimeout(c.timer); clearInterval(c.scrollTimer);
    this.pushCrawl();
  }
  async crawlStep() {
    const c = this.crawl;
    if (!c.on) return;
    clearInterval(c.scrollTimer);
    const t = this.tabs.get(this.activeId);
    if (!t) return this.stopCrawl();
    const here = canon(t.page.url());
    if (here) c.visited.add(here);
    await this.harvest(t);
    let next;
    while ((next = c.queue.shift()) && c.visited.has(next)) { /* skip seen */ }
    if (!next || c.count >= c.max) {
      this.toast(c.count >= c.max ? `Auto-browse finished: ${c.count} pages` : 'Auto-browse: no more links');
      return this.stopCrawl();
    }
    c.visited.add(next); c.count++; c.current = next;
    this.pushCrawl();
    await this.go(t, next);
    if (!c.on) return;
    if (c.scroll) {
      c.scrollTimer = setInterval(() => {
        t.page.evaluate(() => window.scrollBy({ top: innerHeight * 0.6, behavior: 'smooth' })).catch(() => {});
      }, Math.max(1200, (c.dwell * 1000) / 4));
    }
    c.timer = setTimeout(() => this.crawlStep(), c.dwell * 1000);
  }

  // ---------------------------------------------------------------- keyboard combos ("Control+a")
  async press(page, combo) {
    const parts = combo === '+' ? ['+'] : String(combo).split('+').filter(Boolean);
    const key = parts.pop();
    for (const m of parts) await page.keyboard.down(m);
    try { await page.keyboard.press(key); }
    finally { for (const m of parts.reverse()) await page.keyboard.up(m); }
  }

  // ---------------------------------------------------------------- commands from the 3D client
  async handle(cmd) {
    if (!cmd || typeof cmd !== 'object') return { error: 'bad command' };
    if (cmd.type === 'crawl' && cmd.on !== true) return this.crawlCmd(cmd); // config/stop needs no browser
    await this.ensure();
    const t = this.tabs.get(cmd.tab) || this.tabs.get(this.activeId);
    const vp = this.viewport;
    switch (cmd.type) {
      case 'navigate': { const u = normalizeUrl(cmd.url); if (u && t) this.go(t, u); return { ok: true, url: u }; }
      case 'newTab': { const nt = await this.newTab(cmd.url || 'about:blank'); return { ok: true, id: nt.id }; }
      case 'closeTab': { const x = this.tabs.get(cmd.id); if (x) await x.page.close().catch(() => {}); return { ok: true }; }
      case 'switch': await this.activate(cmd.id); return { ok: true };
      case 'back': if (t) t.page.goBack({ timeout: 15000 }).catch(() => {}); return { ok: true };
      case 'forward': if (t) t.page.goForward({ timeout: 15000 }).catch(() => {}); return { ok: true };
      case 'reload': if (t) t.page.reload({ timeout: 25000 }).catch(() => {}); return { ok: true };
      case 'mouse': {
        if (!t) return { ok: false };
        const x = Math.max(0, Math.min(1, +cmd.x || 0)) * vp.width;
        const y = Math.max(0, Math.min(1, +cmd.y || 0)) * vp.height;
        t.lastMouse = { x, y };
        const button = BUTTONS[cmd.button] || 'left';
        await t.page.mouse.move(x, y);
        if (cmd.action === 'down') await t.page.mouse.down({ button });
        else if (cmd.action === 'up') await t.page.mouse.up({ button });
        return { ok: true };
      }
      case 'wheel': {
        if (!t) return { ok: false };
        const m = t.lastMouse || { x: vp.width / 2, y: vp.height / 2 };
        await t.page.mouse.move(m.x, m.y);
        await t.page.mouse.wheel({ deltaX: +cmd.dx || 0, deltaY: +cmd.dy || 0 });
        return { ok: true };
      }
      case 'touch': if (t) await this.touch(t, cmd.action, cmd.points); return { ok: true };
      case 'type': if (t) await t.page.keyboard.type(String(cmd.text || '').slice(0, 500)); return { ok: true };
      case 'press': if (t) await this.press(t.page, cmd.key); return { ok: true };
      case 'viewport': {
        this.viewport = { width: Math.max(320, Math.min(1920, cmd.width | 0)), height: Math.max(320, Math.min(1920, cmd.height | 0)) };
        for (const x of this.tabs.values()) { await x.page.setViewport({ ...this.viewport, deviceScaleFactor: 1 }).catch(() => {}); x.touch = false; }
        const a = this.tabs.get(this.activeId);
        if (a) { await this.stopCast(a); a.castOk = false; await this.startCast(a); this.snapshot(a); }
        return { ok: true, viewport: this.viewport };
      }
      case 'crawl': return this.crawlCmd(cmd);
      case 'enqueue': return { ok: true, added: this.enqueue(Array.isArray(cmd.urls) ? cmd.urls : [], !!cmd.front) };
      case 'ping': return { ok: true };
      default: return { error: 'unknown command ' + cmd.type };
    }
  }
  crawlCmd(cmd) {
    const c = this.crawl;
    if ('dwell' in cmd) c.dwell = Math.max(1, Math.min(120, +cmd.dwell || 6));
    if ('sameOrigin' in cmd) c.sameOrigin = !!cmd.sameOrigin;
    if ('scroll' in cmd) c.scroll = !!cmd.scroll;
    if ('max' in cmd) c.max = Math.max(1, Math.min(100000, cmd.max | 0));
    if (cmd.reset) { c.visited.clear(); c.queue.length = 0; c.count = 0; c.current = ''; }
    if (cmd.on === true && !c.on) { c.on = true; c.count = 0; this.pushCrawl(); c.timer = setTimeout(() => this.crawlStep(), 300); }
    else if (cmd.on === false) this.stopCrawl();
    else this.pushCrawl();
    return { ok: true, crawl: this.crawlState() };
  }
}
