// Space of the Tourism: the 3D game. Launch from Spaceport Aurora, fly the HexGL Feisar,
// collect passport stamps from procedural planets, watch Space TV, browse with Chromium.iso.
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadFeisar, fallbackShip } from './hexgl.js';
import { buildStation, TUBE, SHIP_START } from './station.js';
import { buildCockpit } from './cockpit.js';
import { genSystem, StarSystem } from './planets.js';
import { clamp, lerp, damp, smooth, easeInOut, isTouch, qs, store, canvas, rrect, FONT, DISPLAY } from './util.js';

const $ = (id) => document.getElementById(id);
const EPISODES = [
  { id: 'YH3c1QZzRK4', title: 'Wanderers', by: 'Erik Wernquist', len: '3:50' },
  { id: 'sNhhvQGsMEc', title: 'The Fermi Paradox (1/2)', by: 'Kurzgesagt', len: '6:22' },
  { id: '1fQkVqno-uI', title: 'The Fermi Paradox II', by: 'Kurzgesagt', len: '' },
];
const EYE = new THREE.Vector3(0, 1.06, -0.22);       // pilot's eye in ship space (forward is -Z)
const CRUISE_MIN = 70, CRUISE_MAX = 3200;

export async function start({ iso, sound }) {
  const quality = qs.get('q') || store.get('quality', 'auto');
  const low = quality === 'low' || (quality === 'auto' && isTouch);
  const TEST = qs.has('test');

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: !low, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: TEST });
  renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('gl').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 2e6);
  scene.add(camera);
  const css = new CSS3DRenderer(); css.setSize(innerWidth, innerHeight); $('css3d').appendChild(css.domElement);
  const cssScene = new THREE.Scene();
  let composer = null, bloom = null;
  const useBloom = !low;
  if (useBloom) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.45, 0.9);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x1a1020, 0.55); scene.add(hemi);

  // ---------------------------------------------------------------- world
  let sysIndex = 0;
  let system = new StarSystem(renderer, scene, genSystem(sysIndex), { low });
  scene.environment = null;
  const station = buildStation({ envMap: system.env });
  scene.add(station.group);
  let ship;
  try { ship = await loadFeisar(renderer, { hi: !low, envMap: system.skyRT.texture }); }
  catch (e) { console.warn(e); ship = fallbackShip(); }
  const shipRoot = new THREE.Group(); shipRoot.add(ship.root); scene.add(shipRoot);
  // In the cockpit, clip away the part of the HexGL hull that sits inside the cabin (box in eye space).
  renderer.localClippingEnabled = true;
  const cabinLocal = [[1, 0, 0, -1.02], [-1, 0, 0, -1.02], [0, -1, 0, -0.82], [0, 1, 0, -2.0], [0, 0, -1, -1.18], [0, 0, 1, -0.9]].map(([x, y, z, c]) => new THREE.Plane(new THREE.Vector3(x, y, z), c));
  const cabinPlanes = cabinLocal.map((p) => p.clone());
  if (ship.hull.material) { ship.hull.material.clipIntersection = true; }
  function updateCabinClip(on) {
    if (!ship.hull.material) return;
    ship.hull.material.clippingPlanes = on ? cabinPlanes : null;
    if (!on) return;
    cockpit.group.updateWorldMatrix(true, false);
    for (let i = 0; i < 6; i++) cabinPlanes[i].copy(cabinLocal[i]).applyMatrix4(cockpit.group.matrixWorld);
  }
  shipRoot.position.copy(SHIP_START);
  const cockpit = buildCockpit({ envMap: system.env });
  cockpit.group.position.copy(EYE); shipRoot.add(cockpit.group);
  const isoTex = new THREE.CanvasTexture(iso.canvas); isoTex.colorSpace = THREE.SRGBColorSpace; isoTex.minFilter = THREE.LinearFilter; isoTex.generateMipmaps = false;
  cockpit.iso.display.material.map = isoTex; cockpit.iso.display.material.needsUpdate = true;
  iso.hooks.frame = () => { isoTex.needsUpdate = true; };

  // space dust gives a sense of speed between planets
  const DUST = 900, DB = 700;
  const dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST * 3; i++) dustPos[i] = (Math.random() - 0.5) * DB;
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fc8ff, size: 0.7, transparent: true, opacity: 0.55, depthWrite: false }));
  dust.frustumCulled = false; scene.add(dust);
  // warp tunnel for hyperjumps
  const [wc, wg] = canvas(64, 1024);
  wg.fillStyle = '#000'; wg.fillRect(0, 0, 64, 1024);
  for (let i = 0; i < 140; i++) { wg.fillStyle = `hsla(${190 + Math.random() * 80},90%,${60 + Math.random() * 30}%,${Math.random()})`; wg.fillRect(Math.random() * 64, Math.random() * 1024, 1 + Math.random() * 2, 40 + Math.random() * 200); }
  const warpTex = new THREE.CanvasTexture(wc); warpTex.wrapS = warpTex.wrapT = THREE.RepeatWrapping; warpTex.repeat.set(6, 3);
  const warp = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 3000, 32, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: warpTex, side: THREE.BackSide, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  warp.visible = false; shipRoot.add(warp);

  // ---------------------------------------------------------------- state
  const S = {
    mode: 'title', view: 'cockpit', t: 0, launchT: 0, timeScale: 1,
    speed: 0, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), throttle: 0.45, boost: false, boostE: 1,
    look: { yaw: 0, pitch: 0, holding: false, idle: 0 }, shake: 0, jump: 0, jumpPhase: null,
    stampsTotal: 0, passport: store.get('passport', []), lastAccel: new THREE.Vector3(),
  };
  const input = { pitch: 0, yaw: 0, roll: 0, keys: new Set(), stick: null, drag: null };
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(0, 0, 0, 'YXZ');
  const prevVel = new THREE.Vector3();

  // ---------------------------------------------------------------- HUD helpers
  let toastTimer;
  function toast(text, sub = '', ms = 3200) {
    const t = $('toast'); t.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; t.appendChild(s); }
    t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  iso.hooks.toast = (m) => toast('Chromium', m, 2600);
  function drawStamp(g, W, H, p, date) {
    const ink = { terran: '#2d6a4f', ocean: '#1d5fa8', desert: '#b5562a', ice: '#3a7fb5', lava: '#c0392b', gas: '#8a5a2a', toxic: '#6a2a8f', barren: '#555b66' }[p.type] || '#c0392b';
    g.clearRect(0, 0, W, H); g.save(); g.translate(W / 2, H / 2); g.rotate(-0.06);
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 6; rrect(g, -W / 2 + 10, -H / 2 + 10, W - 20, H - 20, 26); g.stroke();
    g.lineWidth = 2; rrect(g, -W / 2 + 22, -H / 2 + 22, W - 44, H - 44, 18); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `${Math.round(H * 0.15)}px ${DISPLAY}`; g.fillText(p.name.toUpperCase(), 0, -H * 0.16, W - 60);
    g.font = `700 ${Math.round(H * 0.08)}px ${FONT}`; g.fillText(`${p.label.toUpperCase()} · VISITED`, 0, H * 0.04, W - 60);
    g.font = `600 ${Math.round(H * 0.07)}px ${FONT}`; g.fillText(date, 0, H * 0.2);
    g.globalAlpha = 0.25; for (let i = 0; i < 40; i++) g.fillRect((Math.random() - 0.5) * W, (Math.random() - 0.5) * H, 3, 3);
    g.restore();
  }
  function showStamp(p) {
    const el = $('stamp'), c = el.querySelector('canvas');
    drawStamp(c.getContext('2d'), c.width, c.height, { name: p.name, type: p.spec.type, label: p.spec.label }, new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    el.querySelector('p').textContent = `${p.spec.info.blurb} ${'★'.repeat(p.spec.info.stars)}${'☆'.repeat(5 - p.spec.info.stars)} ${p.spec.info.review}`;
    el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 6500);
  }
  function renderPassport() {
    const box = $('passport'); box.textContent = '';
    if (!S.passport.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No stamps yet. Fly close to a planet to get one.'; box.appendChild(d); return; }
    for (const st of S.passport.slice(-60).reverse()) {
      const [c, g] = canvas(240, 160); drawStamp(g, 240, 160, st, st.date); c.title = `${st.name} (${st.sys})`; box.appendChild(c);
    }
  }
  renderPassport();
  function updateStampCount() {
    const list = system.planets;
    $('stamps').innerHTML = '';
    const b = document.createElement('b'); b.textContent = list.filter((p) => p.visited).length;
    $('stamps').append('Stamps ', b, `/${list.length}`);
  }

  // ---------------------------------------------------------------- Space TV (YouTube in a CSS3D screen)
  const tvDiv = document.createElement('div'); tvDiv.style.width = '1280px'; tvDiv.style.height = '720px'; tvDiv.style.background = '#000';
  const tvObj = new CSS3DObject(tvDiv); cssScene.add(tvObj); tvDiv.style.display = 'none';
  let tvEpisode = store.get('episode', 0) % EPISODES.length, tvFrame = null;
  function tvLoad() {
    const ep = EPISODES[tvEpisode];
    if (!tvFrame) {
      tvFrame = document.createElement('iframe');
      tvFrame.width = '1280'; tvFrame.height = '720';
      tvFrame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      tvFrame.referrerPolicy = 'strict-origin-when-cross-origin';
      tvFrame.title = 'Space TV';
      tvFrame.style.cssText = 'width:1280px;height:720px;border:0;display:block';
      tvDiv.appendChild(tvFrame);
    }
    tvFrame.src = `https://www.youtube-nocookie.com/embed/${ep.id}?autoplay=1&playsinline=1&rel=0&modestbranding=1`;
    toast(`Space TV · ${ep.title}`, `${ep.by}${ep.len ? ' · ' + ep.len : ''} · YouTube`, 3600);
  }
  function setTV(on) {
    if (on === !!cockpit.tv.target) return;
    cockpit.tv.target = on ? 1 : 0;
    if (on) { cockpit.tv.openedAt = performance.now(); setView('cockpit'); sound.servo(true); setTimeout(() => cockpit.tv.target && tvLoad(), 700); }
    else { sound.servo(false); if (tvFrame) tvFrame.src = 'about:blank'; }
    $('cTV').classList.toggle('on', on);
  }
  function setIso(on) {
    if (on === !!cockpit.iso.target) return;
    cockpit.iso.target = on ? 1 : 0;
    if (on) { cockpit.iso.openedAt = performance.now(); setView('cockpit'); sound.servo(true); iso.open(); if (iso.state === 'needkey') iso.hooks.needKey(); }
    else { sound.servo(false); iso.close(); iso.showPanel(false); }
    $('isoChip').classList.toggle('on', on);
  }
  iso.hooks.status = (s) => { if (s === 'needkey' && cockpit.iso.target) iso.hooks.needKey(); };

  // ---------------------------------------------------------------- views
  function setView(v) {
    S.view = v; $('cView').classList.toggle('on', v === 'chase');
    $('cView').textContent = v === 'chase' ? 'Cockpit' : 'Chase';
  }
  setView('cockpit');

  // ---------------------------------------------------------------- buttons
  function pressButton(btn) {
    btn = cockpit.buttons.find((b) => b.id === btn.id) || btn;
    cockpit.press(btn); sound.click();
    switch (btn.id) {
      case 'tv': setTV(!cockpit.tv.target); break;
      case 'iso': setIso(!cockpit.iso.target); break;
      case 'boost': kickBoost(); break;
      case 'jump': startJump(); break;
      case 'tv-next': tvEpisode = (tvEpisode + 1) % EPISODES.length; store.set('episode', tvEpisode); tvLoad(); break;
      case 'iso-back': iso.send({ type: 'back' }); break;
      case 'iso-home': iso.home(); break;
      case 'iso-reload': iso.send({ type: 'reload' }); break;
      case 'iso-keys': iso.showPanel(true); setTimeout(() => $('isoType').focus(), 50); break;
      case 'iso-expand': iso.showPanel(true); break;
    }
  }
  let boostHold = false, boostKickT = 0;
  function kickBoost() { boostKickT = 1.6; }

  // ---------------------------------------------------------------- input
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pickables = () => (S.view === 'cockpit' && S.mode !== 'title' && S.mode !== 'launch')
    ? [...cockpit.buttons.filter((b) => b.hit.visible !== false || true).map((b) => b.hit), cockpit.iso.display, cockpit.tv.display] : [];
  function rayFrom(e) { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); }
  function pick(e) {
    rayFrom(e);
    const hits = ray.intersectObjects(pickables(), false);
    for (const h of hits) {
      if (h.object.userData.button) { const b = h.object.userData.button; if (b.group.parent && !visibleChain(b.group)) continue; return { button: b }; }
      if (h.object.userData.screen) { const s = h.object.userData.screen; if (!s.shown) continue; return { screen: s, uv: h.uv }; }
    }
    return null;
  }
  const visibleChain = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
  const isoPlane = new THREE.Plane(), isoInv = new THREE.Matrix4();
  function isoUV(e) {           // project a pointer onto the ISO screen plane, even outside it, for drags
    rayFrom(e);
    const d = cockpit.iso.display; d.updateWorldMatrix(true, false);
    isoPlane.setFromNormalAndCoplanarPoint(tmpV.set(0, 0, 1).transformDirection(d.matrixWorld), tmpV2.setFromMatrixPosition(d.matrixWorld));
    if (!ray.ray.intersectPlane(isoPlane, tmpV)) return null;
    isoInv.copy(d.matrixWorld).invert(); tmpV.applyMatrix4(isoInv);
    return { x: clamp(tmpV.x / cockpit.iso.w + 0.5, 0, 1), y: clamp(0.5 - tmpV.y / cockpit.iso.h, 0, 1) };
  }
  const el = renderer.domElement;
  el.style.touchAction = 'none';
  let isoPointers = new Set();
  el.addEventListener('pointerdown', (e) => {
    sound.init();
    if (S.mode !== 'flight' && S.mode !== 'jump') return;
    const hit = pick(e);
    if (hit && hit.button) { pressButton(hit.button); if (hit.button.id === 'boost') { boostHold = true; input.boostPointer = e.pointerId; } return; }
    if (hit && hit.screen === cockpit.iso) {
      if (iso.state === 'needkey' || iso.state === 'error') { if (iso.state === 'needkey') iso.hooks.needKey(); else iso.open(); return; }
      el.setPointerCapture(e.pointerId); isoPointers.add(e.pointerId);
      iso.touch.down(e.pointerId, hit.uv.x, 1 - hit.uv.y); return;
    }
    if (e.pointerType === 'mouse' && e.button === 0) { input.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, kind: 'steer' }; }
    else { input.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, kind: 'look', yaw0: S.look.yaw, pitch0: S.look.pitch }; S.look.holding = true; }
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (isoPointers.has(e.pointerId)) { const p = isoUV(e); if (p) iso.touch.move(e.pointerId, p.x, p.y); return; }
    const d = input.drag; if (!d || d.id !== e.pointerId) return;
    if (d.kind === 'steer') { d.x = e.clientX; d.y = e.clientY; }
    else { S.look.yaw = clamp(d.yaw0 - (e.clientX - d.x0) / innerWidth * 3.2, -2.4, 2.4); S.look.pitch = clamp(d.pitch0 - (e.clientY - d.y0) / innerHeight * 2.2, -1.0, 1.1); }
  });
  const endPtr = (e) => {
    if (isoPointers.has(e.pointerId)) { const p = isoUV(e) || { x: 0.5, y: 0.5 }; iso.touch.up(e.pointerId, p.x, p.y, e.type === 'pointercancel'); isoPointers.delete(e.pointerId); return; }
    if (input.boostPointer === e.pointerId) { boostHold = false; input.boostPointer = null; }
    if (input.drag && input.drag.id === e.pointerId) { if (input.drag.kind === 'look') S.look.holding = false; input.drag = null; }
  };
  el.addEventListener('pointerup', endPtr); el.addEventListener('pointercancel', endPtr);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (S.view === 'cockpit' && cockpit.iso.shown) { const hit = pick(e); if (hit && hit.screen === cockpit.iso) { iso.wheel(e.deltaX, e.deltaY, hit.uv.x, 1 - hit.uv.y); return; } }
    S.throttle = clamp(S.throttle - e.deltaY * 0.0008, 0, 1);
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    sound.init();
    const k = e.key.toLowerCase();
    input.keys.add(k);
    if (S.mode !== 'flight') { if (k === 'enter' && S.mode === 'title' && !$('board').disabled) $('board').click(); if (k === 'escape' && S.mode === 'launch') skipLaunch(); return; }
    if (k === '1') pressButton({ id: 'tv', t: 0 });
    else if (k === '2') pressButton({ id: 'iso', t: 0 });
    else if (k === 'c') setView(S.view === 'cockpit' ? 'chase' : 'cockpit');
    else if (k === 'j') startJump();
    else if (k === 'm') toggleSound();
    else if (k === 'escape') { setTV(false); setIso(false); }
    if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  });
  addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => input.keys.clear());
  const cpress = (btn) => () => { if (S.mode === 'flight') pressButton({ id: btn, t: 0 }); };
  for (const b of cockpit.buttons) if (b.id === 'tv' || b.id === 'iso' || b.id === 'jump') b.hud = true;
  $('cTV').onclick = cpress('tv');
  $('cJump').onclick = cpress('jump');
  $('cView').onclick = () => setView(S.view === 'cockpit' ? 'chase' : 'cockpit');
  $('cStamps').onclick = () => { renderPassport(); document.body.classList.add('side'); };
  const toggleIso = () => { if (S.mode === 'flight' || S.mode === 'jump') pressButton({ id: 'iso', t: 0 }); else { iso.showPanel(true); iso.open(); } };
  function toggleSound() { sound.setMuted(sound.on); store.set('muted', !sound.on); $('sSound').textContent = 'Sound: ' + (sound.on ? 'on' : 'off'); }
  $('sSound').textContent = 'Sound: ' + (sound.on ? 'on' : 'off');
  $('sSound').onclick = () => { sound.init(); toggleSound(); };
  const QUAL = ['auto', 'low', 'high'];
  $('sQuality').textContent = 'Quality: ' + quality;
  $('sQuality').onclick = () => { const q = QUAL[(QUAL.indexOf(quality) + 1) % 3]; store.set('quality', q); $('sQuality').textContent = 'Quality: ' + q + ' (reload)'; };

  // touch stick + throttle + boost
  const stick = $('stick'), knobEl = stick.querySelector('i');
  stick.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sound.init(); stick.setPointerCapture(e.pointerId); const r = stick.getBoundingClientRect(); input.stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2, x: 0, y: 0 }; moveStick(e); });
  const moveStick = (e) => { const s = input.stick; if (!s || s.id !== e.pointerId) return; let x = (e.clientX - s.cx) / s.r, y = (e.clientY - s.cy) / s.r; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } s.x = x; s.y = y; knobEl.style.transform = `translate(${x * 38}px,${y * 38}px)`; };
  stick.addEventListener('pointermove', moveStick);
  const endStick = () => { input.stick = null; knobEl.style.transform = ''; };
  stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);
  const thr = $('thr'), thrFill = thr.querySelector('i');
  const setThr = (e) => { const r = thr.getBoundingClientRect(); S.throttle = clamp(1 - (e.clientY - r.top - 10) / (r.height - 20), 0, 1); };
  thr.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); thr.setPointerCapture(e.pointerId); setThr(e); thr.dragging = true; });
  thr.addEventListener('pointermove', (e) => { if (thr.dragging) setThr(e); });
  thr.addEventListener('pointerup', () => (thr.dragging = false));
  const bBtn = $('boost');
  bBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sound.init(); boostHold = true; bBtn.classList.add('on'); });
  const bEnd = () => { boostHold = false; bBtn.classList.remove('on'); };
  bBtn.addEventListener('pointerup', bEnd); bBtn.addEventListener('pointercancel', bEnd); bBtn.addEventListener('pointerleave', bEnd);

  // ---------------------------------------------------------------- resize
  function resize() {
    const w = innerWidth, h = innerHeight, a = w / h;
    renderer.setSize(w, h); css.setSize(w, h); if (composer) composer.setSize(w, h);
    camera.aspect = a;
    const needV = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(33)) / a) * 180 / Math.PI;
    S.baseFov = clamp(Math.max(70, needV), 70, 112);
    cockpit.setNarrow(a < 1.05);
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // ---------------------------------------------------------------- title, launch
  const board = $('board');
  function bakeProgress() {
    const p = system.bakeSome(low ? 24 : 40);
    $('loadTxt').textContent = p < 1 ? `Mapping the system… ${Math.round(p * 100)}%` : 'Ready for boarding';
    if (p >= 1 && board.disabled) { board.disabled = false; updateStampCount(); S.stampsTotal = system.planets.length; if (qs.has('autoboard')) board.click(); }
  }
  board.onclick = () => {
    sound.init();
    $('pass').classList.add('gone');
    setTimeout(() => { $('title').style.display = 'none'; $('credit').style.display = 'none'; }, 650);
    if (qs.has('skip')) { S.mode = 'launch'; S.launchT = 0; skipLaunch(); return; }
    startLaunch();
  };
  const T_DOOR0 = 1.3, T_DOOR1 = 4.4, T_FIRE = 5.2, ACC = 190;
  const LAUNCH_END = T_FIRE + 4.8;
  const camA = new THREE.Vector3(7.5, TUBE.floor + H(0.78), -104);
  function H(f) { return TUBE.h * f; }
  const camB = new THREE.Vector3(26, 7, -394);
  const lookM = new THREE.Matrix4(), lookQ1 = new THREE.Quaternion();
  let beeps = 0, fired = false, exited = false;
  function startLaunch() {
    S.mode = 'launch'; S.launchT = 0; beeps = 0; fired = false; exited = false;
    document.body.classList.add('launching');
    station.setAlarm(true); station.setInterior(true); sound.alarm(true);
    toast('Spaceport Aurora · Bay 3', 'Launch sequence started. Please keep your arms inside the Feisar.', 3800);
  }
  function skipLaunch() {
    S.launchT = LAUNCH_END; station.setDoor(1); station.setClamps(1); station.setAlarm(false); sound.alarm(false);
    shipRoot.position.set(0, SHIP_START.y + 2, -900); shipRoot.quaternion.identity();
    S.speed = 160; S.vel.set(0, 0, -160);
    endLaunch();
  }
  function endLaunch() {
    S.mode = 'flight'; S.timeScale = 1; document.body.classList.remove('launching'); document.body.classList.add('flying');
    station.setAlarm(false); sound.alarm(false);
    setView('cockpit');
    toast('Welcome aboard the Feisar!', isTouch ? 'Left stick steers, slider sets the throttle. Fly close to planets to collect passport stamps.' : 'WASD to steer, R/F throttle, Shift boost. Fly close to planets for passport stamps. Menu has all the keys.', 6000);
    setTimeout(() => !cockpit.tv.target && toast('Try the cockpit buttons', 'Space TV plays a short space film · Chromium.iso boots a real browser on Wikipedia: Space', 5000), 7000);
  }
  function updateLaunch(dt) {
    const t = (S.launchT += dt);
    // countdown
    const n = Math.floor(t);
    if (n >= beeps && beeps <= 4 && t < T_FIRE) { sound.beep(false); toast(`Launch in ${5 - beeps}`, beeps === 1 ? 'Opening the bay door' : 'Spaceport Aurora · Bay 3', 900); beeps++; }
    if (t > T_DOOR0 && t - dt <= T_DOOR0) sound.doorOpen();
    station.setDoor(easeInOut((t - T_DOOR0) / (T_DOOR1 - T_DOOR0)));
    station.setClamps(smooth((t - (T_FIRE - 0.8)) / 0.6));
    // catapult
    const tf = t - T_FIRE;
    if (tf >= 0 && !fired) { fired = true; sound.catapult(); sound.beep(true); toast('Launch!', '', 1200); station.startChase(); }
    let z = SHIP_START.z;
    if (tf > 0) {
      const tExit = Math.sqrt(2 * (SHIP_START.z - TUBE.front) / ACC), vExit = ACC * tExit;
      if (tf < tExit) { z = SHIP_START.z - 0.5 * ACC * tf * tf; S.speed = ACC * tf; }
      else { S.speed = Math.max(170, vExit - 45 * (tf - tExit)); z = Math.min(TUBE.front, shipRoot.position.z) - S.speed * dt; if (!exited) { exited = true; sound.whoosh(); } }
    }
    shipRoot.position.set(0, SHIP_START.y + (tf > 0 ? Math.min(2, tf * tf * 0.6) : Math.sin(t * 2) * 0.05), z);
    shipRoot.quaternion.identity();
    S.vel.set(0, 0, -S.speed);
    // time warp while the ship leaves the door
    S.timeScale = tf > 1.25 && tf < 2.1 ? lerp(1, 0.28, smooth((tf - 1.25) / 0.2)) * 1 : tf >= 2.1 && tf < 2.7 ? lerp(0.28, 1, smooth((tf - 2.1) / 0.6)) : 1;
    if (tf > 2.7) S.timeScale = 1;
    // cameras
    const shipPos = shipRoot.position;
    if (tf < 0.9) {
      camera.position.copy(camA).add(tmpV.set(0, 0, -t * 1.6));
      lookSmooth(tmpV2.copy(shipPos).add(tmpV.set(0, 0.8, tf > 0 ? -4 : 0)), 1);
      S.shake = tf > 0 ? 0.25 * (1 - tf / 0.9) : t > T_DOOR0 && t < T_DOOR1 ? 0.04 : 0.01;
      camera.fov = S.baseFov;
    } else if (tf < 2.9) {
      camera.position.copy(camB);
      lookSmooth(tmpV2.copy(shipPos).add(tmpV.set(0, 0.6, 0)), tf < 1.0 ? 1 : 0.25);
      camera.fov = S.baseFov - 12;
      S.shake = 0.02;
    } else {
      const u = easeInOut((tf - 2.9) / (LAUNCH_END - T_FIRE - 2.9));
      const eye = shipRoot.localToWorld(tmpV.copy(EYE));
      camera.position.lerpVectors(camB, eye, u);
      lookM.lookAt(camera.position, tmpV2.copy(shipPos).add(tmpV.set(0, 0.8, -40)), camera.up.set(0, 1, 0));
      lookQ1.setFromRotationMatrix(lookM);
      camera.quaternion.slerpQuaternions(lookQ1, shipRoot.quaternion, smooth((u - 0.35) / 0.65));
      camera.fov = lerp(S.baseFov - 12, S.baseFov, u);
      S.shake = 0.01;
    }
    cockpit.group.visible = tf > 2.9 && (tf - 2.9) / (LAUNCH_END - T_FIRE - 2.9) > 0.6;
    updateCabinClip(cockpit.group.visible);
    if (cockpit.group.visible && Math.floor(t * 10) !== Math.floor((t - dt) * 10)) drawInstruments(null, 0);
    if (t >= LAUNCH_END) endLaunch();
  }
  function lookSmooth(target, k) {
    tmpQ.copy(camera.quaternion); camera.lookAt(target);
    if (k < 1) { const q = camera.quaternion.clone(); camera.quaternion.copy(tmpQ).slerp(q, k); }
  }

  // ---------------------------------------------------------------- hyperjump
  let jumpBusy = false;
  function startJump() {
    if (S.mode !== 'flight' || jumpBusy) return;
    jumpBusy = true; S.jumpPhase = 'charge'; S.jump = 0; sound.jumpCharge();
    toast('Hyperdrive spooling…', `Next stop: a brand-new star system`, 2400);
  }
  async function doJump() {
    S.jumpPhase = 'warp'; warp.visible = true; sound.jumpFlash();
    const next = sysIndex + 1;
    await new Promise((r) => setTimeout(r, 900));
    // swap systems behind the flash
    const oldEnv = system.env, oldSky = system.skyRT.texture;
    if (station.group.parent) { scene.remove(station.group); }
    sysIndex = next;
    const fresh = new StarSystem(renderer, scene, genSystem(sysIndex), { low });
    shipRoot.traverse((o) => { if (o.material && o.material.envMap) o.material.envMap = o.material.envMap === oldSky ? fresh.skyRT.texture : o.material.envMap === oldEnv ? fresh.env : o.material.envMap; });
    system.dispose();
    system = fresh;
    while (!system.ready) { system.bakeSome(60); await new Promise((r) => requestAnimationFrame(r)); }
    shipRoot.position.set(0, 0, 0);
    const first = system.planets.filter((p) => !p.isMoon).sort((a, b) => a.group.position.length() - b.group.position.length())[0];
    if (first) { const m = new THREE.Matrix4().lookAt(shipRoot.position, first.group.position, new THREE.Vector3(0, 1, 0)); shipRoot.quaternion.setFromRotationMatrix(m); }
    S.speed = 900; S.vel.set(0, 0, -900).applyQuaternion(shipRoot.quaternion);
    updateStampCount(); $('sysName').textContent = system.sys.name;
    await new Promise((r) => setTimeout(r, 600));
    S.jumpPhase = 'arrive';
    toast(`Welcome to ${system.sys.name}`, `${system.planets.length} worlds to visit. Jump #${sysIndex}.`, 4200);
    setTimeout(() => { S.jumpPhase = null; warp.visible = false; jumpBusy = false; }, 1400);
  }

  // ---------------------------------------------------------------- flight
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3();
  function nearestSurface() {
    let best = null, bd = Infinity;
    for (const p of system.planets) { const d = p.group.position.distanceTo(shipRoot.position) - p.radius; if (d < bd) { bd = d; best = p; } }
    if (station.group.parent) { const d = Math.max(0, shipRoot.position.length() - 400); if (d < bd) { bd = d; best = null; } }
    return { planet: best, dist: bd };
  }
  function updateFlight(dt) {
    const k = input.keys;
    let pitch = 0, yaw = 0, roll = 0;
    if (k.has('w') || k.has('arrowup')) pitch += 1;
    if (k.has('s') || k.has('arrowdown')) pitch -= 1;
    if (k.has('a') || k.has('arrowleft')) yaw += 1;
    if (k.has('d') || k.has('arrowright')) yaw -= 1;
    if (k.has('q')) roll += 1;
    if (k.has('e')) roll -= 1;
    if (k.has('r')) S.throttle = clamp(S.throttle + dt * 0.6, 0, 1);
    if (k.has('f')) S.throttle = clamp(S.throttle - dt * 0.6, 0, 1);
    if (input.stick) { yaw -= input.stick.x; pitch -= input.stick.y; }
    if (input.drag && input.drag.kind === 'steer') { yaw -= clamp((input.drag.x - input.drag.x0) / 160, -1, 1); pitch -= clamp((input.drag.y - input.drag.y0) / 160, -1, 1); }
    if (store.get('invert', false)) pitch = -pitch;
    const boostWanted = boostHold || k.has('shift') || k.has(' ') || boostKickT > 0;
    boostKickT = Math.max(0, boostKickT - dt);
    S.boost = boostWanted && S.boostE > 0.02;
    S.boostE = clamp(S.boostE + (S.boost ? -0.32 : 0.14) * dt, 0, 1);
    if (S.boost && !S.wasBoost) sound.boost();
    S.wasBoost = S.boost;
    // angular motion with auto-bank
    const autoBank = roll === 0 ? yaw * 0.9 : 0;
    S.angVel.x = damp(S.angVel.x, pitch * 1.25, 5, dt);
    S.angVel.y = damp(S.angVel.y, yaw * 0.95, 5, dt);
    S.angVel.z = damp(S.angVel.z, roll * 1.8, 5, dt);
    tmpE.set(S.angVel.x * dt, S.angVel.y * dt, S.angVel.z * dt, 'YXZ');
    shipRoot.quaternion.multiply(tmpQ.setFromEuler(tmpE));
    // gentle self-levelling toward the system plane, plus bank into turns
    right.set(1, 0, 0).applyQuaternion(shipRoot.quaternion); fwd.set(0, 0, -1).applyQuaternion(shipRoot.quaternion);
    const bank = Math.asin(clamp(right.y, -1, 1));            // right wing up = positive
    const wantBank = autoBank * 0.6;                            // bank into the turn
    if (roll === 0 && Math.abs(fwd.y) < 0.9) shipRoot.quaternion.multiply(tmpQ.setFromAxisAngle(tmpV.set(0, 0, 1), (wantBank - bank) * Math.min(1, dt * 1.6)));
    shipRoot.quaternion.normalize();
    // speed: auto-cruise scales with the distance to the nearest surface
    const ns = nearestSurface();
    const cruise = clamp(ns.dist * 0.32, CRUISE_MIN, CRUISE_MAX);
    const target = S.throttle * cruise * (S.boost ? 2.4 : 1) + (S.throttle > 0.02 ? 12 : 0);
    S.speed = damp(S.speed, target, target > S.speed ? (S.boost ? 3 : 1.1) : 1.6, dt);
    fwd.set(0, 0, -1).applyQuaternion(shipRoot.quaternion);
    prevVel.copy(S.vel);
    S.vel.lerp(tmpV.copy(fwd).multiplyScalar(S.speed), 1 - Math.exp(-dt * 3.5));
    shipRoot.position.addScaledVector(S.vel, dt);
    collide();
    discover();
    // acceleration in ship space (drives the bobblehead)
    tmpV.copy(S.vel).sub(prevVel).divideScalar(Math.max(dt, 1e-3)).applyQuaternion(tmpQ.copy(shipRoot.quaternion).invert());
    S.lastAccel.lerp(tmpV.clampLength(0, 400), 0.3);
    sound.engine(S.throttle, clamp(S.speed / 800, 0, 1), S.boost);
    return ns;
  }
  function collide() {
    for (const p of system.planets) {
      const c = p.group.position, min = p.radius + 6;
      const d = shipRoot.position.distanceTo(c);
      if (d < min) {
        const n = tmpV.copy(shipRoot.position).sub(c).normalize();
        shipRoot.position.copy(c).addScaledVector(n, min);
        const vn = S.vel.dot(n); if (vn < 0) S.vel.addScaledVector(n, -1.6 * vn);
        S.speed *= 0.4; S.shake = 0.6; sound.thud();
        toast('Bounced off the atmosphere', `${p.name} would like you to keep a respectful altitude.`, 2200);
      }
    }
    if (station.group.parent) {           // spine capsule + ring torus
      const p = shipRoot.position, z = clamp(p.z, -320, 320), r = Math.hypot(p.x, p.y);
      if (r < 76 && Math.abs(p.z - z) < 1 && !(Math.abs(p.x) < TUBE.w / 2 && p.y > TUBE.floor && p.y < TUBE.floor + TUBE.h && p.z < -100)) {
        const n = tmpV.set(p.x, p.y, 0).normalize(); if (!n.lengthSq()) n.set(0, 1, 0);
        p.set(n.x * 76, n.y * 76, p.z); S.speed *= 0.4; S.vel.multiplyScalar(-0.3); S.shake = 0.5; sound.thud();
      }
      const ringR = Math.hypot(p.x, p.y), dz = p.z - 80, dist = Math.hypot(ringR - 260, dz);
      if (dist < 22) { const k2 = 22 / Math.max(dist, 0.01); const nr = 260 + (ringR - 260) * k2; p.x *= nr / Math.max(ringR, 0.01); p.y *= nr / Math.max(ringR, 0.01); p.z = 80 + dz * k2; S.speed *= 0.4; S.vel.multiplyScalar(-0.3); S.shake = 0.5; sound.thud(); }
    }
  }
  function discover() {
    for (const p of system.planets) {
      if (p.visited) continue;
      const d = shipRoot.position.distanceTo(p.group.position) - p.radius;
      if (d < p.radius * 0.9 + 600) {
        p.visited = true; sound.stamp(); showStamp(p);
        toast(`Passport stamped: ${p.name}`, `${p.spec.label} · ${p.spec.info.gravity.toFixed(1)} g · ${p.spec.info.temp[0]} to ${p.spec.info.temp[1]} °C`, 4200);
        S.passport.push({ name: p.name, type: p.spec.type, label: p.spec.label, sys: system.sys.name, date: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) });
        store.set('passport', S.passport.slice(-200)); renderPassport(); updateStampCount();
        if (system.planets.every((x) => x.visited)) setTimeout(() => toast('Every stamp in this system!', 'Pull the HYPERJUMP lever for a new one.', 5000), 4500);
      }
    }
  }

  // ---------------------------------------------------------------- HUD
  const tgt = $('target'), tgtN = tgt.querySelector('.n'), tgtK = tgt.querySelector('.k');
  const fmtDist = (d) => d > 1e4 ? `${(d / 1000).toFixed(1)}k km` : `${Math.max(0, Math.round(d)).toLocaleString()} km`;
  let instT = 0;
  function hud(ns, dt) {
    $('spd').textContent = Math.round(S.speed).toLocaleString();
    $('thrBar').firstElementChild.style.width = `${S.throttle * 100}%`;
    $('boostBar').firstElementChild.style.width = `${S.boostE * 100}%`;
    thrFill.style.height = `${S.throttle * 100}%`;
    $('alt').textContent = ns.planet && ns.dist < ns.planet.radius * 2 ? `Altitude ${fmtDist(ns.dist)}\nover ${ns.planet.name}` : '';
    // target: nearest unvisited world
    let best = null, bd = Infinity;
    for (const p of system.planets) { if (p.visited) continue; const d = p.group.position.distanceTo(shipRoot.position); if (d < bd) { bd = d; best = p; } }
    if (!best) { tgt.style.display = 'none'; } else {
      tmpV.copy(best.group.position).project(camera);
      const behind = tmpV.z > 1;
      let x = tmpV.x, y = tmpV.y;
      if (behind) { x = -x; y = -y; }
      const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
      if (edge) { const m = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1e-3); x /= m; y /= m; }
      tgt.style.display = 'block'; tgt.classList.toggle('edge', edge);
      tgt.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
      tgtN.textContent = best.name; tgtK.textContent = `${best.spec.label} · ${fmtDist(bd - best.radius)}`;
    }
    // cockpit instrument screen at 10 Hz
    instT -= dt;
    if (instT <= 0 && S.view === 'cockpit') { instT = 0.1; drawInstruments(best, bd); }
  }
  function drawInstruments(best, bd) {
    const g = cockpit.instCtx, W = 512, H = 256;
    g.fillStyle = '#050a0f'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(87,242,214,.35)'; g.lineWidth = 2; rrect(g, 4, 4, W - 8, H - 8, 14); g.stroke();
    g.fillStyle = '#57f2d6'; g.font = `700 64px ${FONT}`; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillText(Math.round(S.speed).toLocaleString(), 20, 92); g.font = `600 22px ${FONT}`; g.fillStyle = '#9fb8c9'; g.fillText('KM/S', 22, 120);
    const bar = (y, v, c, label) => { g.fillStyle = 'rgba(255,255,255,.12)'; rrect(g, 20, y, 200, 14, 7); g.fill(); g.fillStyle = c; rrect(g, 20, y, Math.max(14, 200 * v), 14, 7); g.fill(); g.fillStyle = '#9fb8c9'; g.font = `600 18px ${FONT}`; g.fillText(label, 20, y - 6); };
    bar(160, S.throttle, '#57f2d6', 'THROTTLE'); bar(212, S.boostE, '#ff9a3c', 'BOOST');
    // radar (top-down, ship heading up)
    const cx = 380, cy = 128, R = 104;
    g.strokeStyle = 'rgba(87,242,214,.4)'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(cx, cy, R / 2, 0, Math.PI * 2); g.stroke();
    const inv = tmpQ.copy(shipRoot.quaternion).invert();
    for (const p of system.planets) {
      tmpV.copy(p.group.position).sub(shipRoot.position).applyQuaternion(inv);
      const d = Math.hypot(tmpV.x, tmpV.z), s = Math.min(1, Math.log10(1 + d / 500) / Math.log10(1 + 80000 / 500));
      const a = Math.atan2(tmpV.x, -tmpV.z);
      g.fillStyle = p === best ? '#ff9a3c' : p.visited ? '#5a6b78' : '#e8f4f2';
      g.beginPath(); g.arc(cx + Math.sin(a) * s * R, cy - Math.cos(a) * s * R, p.isMoon ? 3 : 6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#57f2d6'; g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 7, cy + 7); g.lineTo(cx - 7, cy + 7); g.closePath(); g.fill();
    if (best) { g.fillStyle = '#ff9a3c'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.fillText(best.name.toUpperCase(), cx, H - 12); }
    cockpit.instTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera for flight
  const chasePos = new THREE.Vector3(), lookQ = new THREE.Quaternion();
  function flightCamera(dt) {
    if (!S.look.holding) S.look.yaw = damp(S.look.yaw, 0, 2.2, dt), S.look.pitch = damp(S.look.pitch, 0, 2.2, dt);
    lookQ.setFromEuler(tmpE.set(S.look.pitch, S.look.yaw, 0, 'YXZ'));
    if (S.view === 'cockpit') {
      shipRoot.localToWorld(camera.position.copy(EYE));
      camera.quaternion.copy(shipRoot.quaternion).multiply(lookQ);
      cockpit.group.visible = true;
      updateCabinClip(true);
    } else {
      const want = shipRoot.localToWorld(tmpV.set(0, 2.7, 11.5 + S.speed * 0.003));
      chasePos.lerp(want, 1 - Math.exp(-dt * 7));
      if (chasePos.distanceTo(want) > 200) chasePos.copy(want);
      camera.position.copy(chasePos);
      up.set(0, 1, 0).applyQuaternion(shipRoot.quaternion); camera.up.copy(up);
      camera.lookAt(shipRoot.localToWorld(tmpV2.set(0, 1.2, -24)));
      camera.quaternion.multiply(lookQ);
      cockpit.group.visible = false;
      updateCabinClip(false);
    }
    const jumpFov = S.jumpPhase === 'charge' ? S.jump * 8 : S.jumpPhase === 'warp' ? 30 : S.jumpPhase === 'arrive' ? 12 : 0;
    camera.fov = damp(camera.fov, S.baseFov + (S.boost ? 9 : 0) + clamp(S.speed / 400, 0, 6) + jumpFov, 4, dt);
  }

  // ---------------------------------------------------------------- loop
  let lastT = performance.now();
  let titleA = 0, frameN = 0, lastIsoBoot = 0;
  chasePos.copy(shipRoot.position);
  function frame() {
    const nowT = performance.now(), rdt = Math.min((nowT - lastT) / 1000, 0.05); lastT = nowT;
    const dt = rdt * S.timeScale;
    S.t += rdt; frameN++;
    if (!system.ready) bakeProgress();
    let ns = { planet: null, dist: 1e9 };
    if (S.mode === 'title') {
      titleA += rdt * 0.05;
      camera.position.set(Math.sin(titleA) * 1150 + 300, 260 + Math.sin(titleA * 0.7) * 120, -900 + Math.cos(titleA) * 700);
      camera.lookAt(0, 0, -120); camera.fov = S.baseFov; cockpit.group.visible = false;
    } else if (S.mode === 'launch') {
      updateLaunch(dt);
    } else {
      if (S.jumpPhase === 'charge') { S.jump = Math.min(1, S.jump + rdt / 2.4); if (S.jump >= 1) doJump(); }
      ns = updateFlight(dt);
      flightCamera(rdt);
    }
    // shake
    if (S.shake > 0.001) { camera.position.x += (Math.random() - 0.5) * S.shake * 0.12; camera.position.y += (Math.random() - 0.5) * S.shake * 0.12; S.shake = damp(S.shake, 0, 3, rdt); }
    camera.updateProjectionMatrix();
    // world updates
    system.update(dt, camera.position);
    if (station.group.parent) {
      station.update(dt, S.t);
      const far = shipRoot.position.length() > 30000;
      station.group.visible = !far;
      station.setInterior(shipRoot.position.z > TUBE.front - 400 || S.mode === 'title');
    }
    ship.update(rdt, S.mode === 'launch' ? (S.launchT > T_FIRE ? 2 : 0.3) : S.boost ? 2 : S.throttle);
    // dust follows the camera in a wrapping box
    dust.position.set(Math.floor(camera.position.x / DB) * DB, Math.floor(camera.position.y / DB) * DB, Math.floor(camera.position.z / DB) * DB);
    for (let i = 0; i < DUST; i++) {
      for (let a = 0; a < 3; a++) {
        const c = camera.position.getComponent(a) - dust.position.getComponent(a);
        let v = dustPos[i * 3 + a];
        while (v - c < -DB / 2) v += DB; while (v - c > DB / 2) v -= DB;
        dustPos[i * 3 + a] = v;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;
    dust.material.opacity = clamp(S.speed / 300, 0.15, 0.6);
    // warp tunnel
    if (warp.visible) { warpTex.offset.y -= rdt * 3; warp.material.opacity = S.jumpPhase === 'warp' ? damp(warp.material.opacity, 1, 4, rdt) : damp(warp.material.opacity, 0, 3, rdt); }
    // cockpit
    const yawRate = S.angVel.y;
    cockpit.update(rdt, { accel: S.lastAccel, yawRate, boostLevel: S.boostE, time: S.t, jumpCharge: S.jumpPhase ? 1 : S.jump });
    if (cockpit.iso.root.visible && !iso.hasFrame && frameN % 6 === 0) { iso.drawBoot(); isoTex.needsUpdate = true; }
    if (S.mode === 'flight' || S.mode === 'jump') hud(ns, rdt);
    // Space TV follows its 3D screen
    const tvShown = S.view === 'cockpit' && cockpit.tv.shown && (S.mode === 'flight');
    tvDiv.style.display = tvShown ? '' : 'none';
    if (tvShown) {
      const d = cockpit.tv.display; d.updateWorldMatrix(true, false);
      d.matrixWorld.decompose(tvObj.position, tvObj.quaternion, tmpV);
      tvObj.position.addScaledVector(tmpV2.set(0, 0, 1).applyQuaternion(tvObj.quaternion), 0.001);
      tvObj.scale.setScalar(cockpit.tv.w / 1280);
    }
    // render
    if (composer) composer.render(); else renderer.render(scene, camera);
    if (tvShown) css.render(cssScene, camera);
    if (TEST) window.__sottFrame = frameN;
    requestAnimationFrame(frame);
    void lastIsoBoot;
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (document.hidden && sound.ctx) sound.ctx.suspend(); else if (sound.ctx) sound.ctx.resume(); });

  const api = {
    toggleIso, setView, startJump, state: S, camera, scene, renderer, cockpit, station, get system() { return system; }, shipRoot, iso,
    press: (id) => pressButton({ id, t: 0 }),
  };
  if (TEST) window.__sott = api;
  return api;
}
