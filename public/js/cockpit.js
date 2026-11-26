// The Feisar's cabin: dashboard, canopy struts, 3D buttons, two pop-up screens, and tourist clutter.
// Group origin = the pilot's eye; -Z is forward, +Y up.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { canvas, rrect, FONT, DISPLAY, easeOutBack, clamp, damp } from './util.js';

function textTex(w, h, draw) {
  const [c, g] = canvas(w, h); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function labelPlate(text, color, w = 0.11, h = 0.03) {
  const tex = textTex(256, 72, (g) => {
    g.fillStyle = '#141922'; rrect(g, 0, 0, 256, 72, 14); g.fill();
    g.strokeStyle = color; g.lineWidth = 4; rrect(g, 3, 3, 250, 66, 12); g.stroke();
    g.fillStyle = '#f2f6f8'; g.font = `700 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 38);
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

export function buildCockpit({ envMap = null } = {}) {
  const group = new THREE.Group();
  const buttons = [];
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a3039, metalness: 0.7, roughness: 0.38, envMap, envMapIntensity: 0.8 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1a1f27, metalness: 0.35, roughness: 0.6, envMap, envMapIntensity: 0.4 });
  const trim = new THREE.MeshStandardMaterial({ color: 0xff9a3c, emissive: 0xff7a1a, emissiveIntensity: 0.22, metalness: 0.3, roughness: 0.4 });

  // dashboard: body, top deck tilted toward the pilot, glare shield, instrument face
  const dash = new THREE.Group(); group.add(dash);
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.34, 0.5, 4, 0.04), panel); body.position.set(0, -0.42, -0.74); dash.add(body);
  const deck = new THREE.Mesh(new RoundedBoxGeometry(1.66, 0.05, 0.42, 4, 0.02), metal); deck.position.set(0, -0.235, -0.69); deck.rotation.x = 0.16; dash.add(deck);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.006, 0.006), trim); lip.position.set(0, -0.255, -0.485); dash.add(lip);
  
  // instrument display (canvas updated by the game)
  const [ic, ig] = canvas(512, 256);
  const instTex = new THREE.CanvasTexture(ic); instTex.colorSpace = THREE.SRGBColorSpace; instTex.anisotropy = 8;
  const instG = new THREE.Group(); instG.position.set(0, -0.19, -0.635); instG.rotation.x = -0.85; dash.add(instG);
  const inst = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.125), new THREE.MeshBasicMaterial({ map: instTex, toneMapped: false, color: new THREE.Color(0.85, 0.85, 0.85) }));
  inst.position.z = 0.003; instG.add(inst);
  const instFrame = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.145, 0.02, 2, 0.008), metal);
  instFrame.position.z = -0.009; instG.add(instFrame);

  // canopy struts
  const strutMat = new THREE.MeshStandardMaterial({ color: 0x23282f, metalness: 0.8, roughness: 0.3, envMap, envMapIntensity: 1 });
  const tube = (pts, r) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 48, r, 8), strutMat);
  group.add(tube([[-0.95, -0.24, -0.86], [-0.6, 0.32, -1.02], [0, 0.58, -1.1], [0.6, 0.32, -1.02], [0.95, -0.24, -0.86]], 0.022));
  group.add(tube([[0, 0.58, -1.1], [0, 0.66, -0.4], [0, 0.6, 0.25], [0, 0.42, 0.7]], 0.02));
  for (const s of [-1, 1]) group.add(tube([[s * 0.95, -0.24, -0.86], [s * 1.0, -0.1, -0.2], [s * 0.95, -0.05, 0.6]], 0.026));
  // faint canopy glass: fresnel glint only
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.15, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    vertexShader: `#include <common>
    #include <logdepthbuf_pars_vertex>
    varying vec3 vN; varying vec3 vV; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv;
    #include <logdepthbuf_vertex>
    }`,
    fragmentShader: `#include <common>
    #include <logdepthbuf_pars_fragment>
    varying vec3 vN; varying vec3 vV; void main(){
    #include <logdepthbuf_fragment>
    float f=pow(1.0-abs(dot(vN,vV)),4.0); gl_FragColor=vec4(vec3(0.35,0.6,0.7)*f*0.35,1.0); }`,
  }));
  glass.scale.set(1, 0.75, 1.1); glass.position.set(0, -0.2, -0.15); group.add(glass);

  // tub: side walls, floor, rear bulkhead with a porthole
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x313844, metalness: 0.3, roughness: 0.7, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), wallMat); w.position.set(s * 0.98, -0.5, -0.1); w.rotation.y = -s * Math.PI / 2; group.add(w);
    const con = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.16, 0.8, 3, 0.03), panel); con.position.set(s * 0.78, -0.4, -0.2); group.add(con);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.7), trim); strip.position.set(s * 0.64, -0.32, -0.2); group.add(strip);
  }
  const rearTex = textTex(512, 512, (g) => {
    g.fillStyle = '#2c333e'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#232931'; for (let y = 20; y < 512; y += 70) g.fillRect(20, y, 472, 40);
    g.fillStyle = '#ff9a3c'; g.font = `600 30px ${FONT}`; g.textAlign = 'center';
    g.fillText('FEISAR · TOURIST CLASS', 256, 470);
    g.fillStyle = '#9fb8c9'; g.font = `24px ${FONT}`; g.fillText('Max occupancy: 1 pilot + 1 bobblehead', 256, 500);
  });
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), new THREE.MeshStandardMaterial({ map: rearTex, roughness: 0.8 }));
  rear.position.set(0, -0.1, 0.75); rear.rotation.y = Math.PI; group.add(rear);
  const port = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 10, 32), strutMat); port.position.set(0.45, 0.12, 0.74); group.add(port);
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.7), wallMat); floorM.rotation.x = -Math.PI / 2; floorM.position.set(0, -0.78, -0.05); group.add(floorM);
  const seat = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.5, 0.12, 4, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a3a1a, roughness: 0.8 }));
  seat.position.set(0, -0.12, 0.3); group.add(seat);

  // tourist clutter: postcard, suitcase with stickers, rocket air freshener, bobblehead
  const postcard = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshStandardMaterial({ roughness: 0.9, map: textTex(320, 200, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 200); gr.addColorStop(0, '#ff9a3c'); gr.addColorStop(1, '#5a2a8a');
    g.fillStyle = gr; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#1d2330'; g.beginPath(); g.arc(250, 150, 90, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f6ead2'; g.font = `24px ${DISPLAY}`; g.fillText('Greetings from', 18, 46); g.font = `40px ${DISPLAY}`; g.fillText('AURORA', 18, 92);
  }) }));
  postcard.position.set(-0.96, -0.32, -0.45); postcard.rotation.y = Math.PI / 2 - 0.1; postcard.rotation.z = 0.08; group.add(postcard);
  const caseTex = textTex(512, 256, (g) => {
    g.fillStyle = '#7a4a2a'; g.fillRect(0, 0, 512, 256);
    const st = [['SATURN RINGS', '#ffd25a', 90, 70], ['MARS RESORT', '#ff5a3a', 330, 60], ['I ♥ EARTH', '#5ad0ff', 120, 190], ['AURORA', '#ff9a3c', 360, 180]];
    for (const [t, c, x, y] of st) { g.save(); g.translate(x, y); g.rotate((x % 7 - 3) * 0.06); g.fillStyle = c; rrect(g, -88, -30, 176, 60, 14); g.fill(); g.fillStyle = '#1d2330'; g.font = `700 24px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 0, 2); g.restore(); }
  });
  const suitcase = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.22, 0.12, 3, 0.02), new THREE.MeshStandardMaterial({ map: caseTex, roughness: 0.7 }));
  suitcase.position.set(0.62, -0.62, 0.5); suitcase.rotation.y = 0.5; group.add(suitcase);
  const fresh = new THREE.Group(); fresh.position.set(0.16, 0.52, -0.72); group.add(fresh);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.16, 4).translate(0, -0.08, 0), new THREE.MeshBasicMaterial({ color: 0xdddddd }));
  fresh.add(string);
  const rocketMat = new THREE.MeshStandardMaterial({ color: 0x3fe0a0, roughness: 0.6 });
  const rocket = new THREE.Group(); rocket.position.y = -0.2; fresh.add(rocket);
  rocket.add(new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 12).translate(0, 0.02, 0), rocketMat));
  rocket.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 12).translate(0, -0.02, 0), rocketMat));
  for (let i = 0; i < 3; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.02, 0.016), new THREE.MeshStandardMaterial({ color: 0xff5a7a })); fin.position.set(Math.cos(i * 2.1) * 0.018, -0.035, Math.sin(i * 2.1) * 0.018); fin.rotation.y = -i * 2.1; rocket.add(fin); }
  const bob = new THREE.Group(); bob.position.set(-0.56, -0.2, -0.7); group.add(bob);
  const suit = new THREE.MeshStandardMaterial({ color: 0xbcc2c8, roughness: 0.7 });
  bob.add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.012, 16), metal));
  bob.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.03, 4, 12).translate(0, 0.035, 0), suit));
  const head = new THREE.Group(); head.position.y = 0.075; bob.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 14), suit));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 12, -0.9, 1.8, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0x1a3a7a, metalness: 0.9, roughness: 0.1, emissive: 0x112244, envMap }));
  visor.position.z = -0.012; visor.rotation.y = Math.PI; head.add(visor);

  // buttons
  function makeButton(id, x, z, color, label, r = 0.028) {
    const b = new THREE.Group(); b.position.set(x, -0.205 + (z + 0.69) * -0.16, z); b.rotation.x = 0.16;
    b.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.35, r * 1.45, 0.012, 24), metal));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.022, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35 }));
    cap.position.y = 0.014; b.add(cap);
    const lp = labelPlate(label, '#' + new THREE.Color(color).getHexString()); lp.rotation.x = -Math.PI / 2; lp.position.set(0, 0.007, 0.06); b.add(lp);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(r * 4, 0.06, r * 4 + 0.06), new THREE.MeshBasicMaterial({ visible: false })); hit.position.z = 0.02; b.add(hit);
    group.add(b);
    const btn = { id, group: b, cap, hit, t: 0 };
    hit.userData.button = btn; buttons.push(btn);
    return btn;
  }
  makeButton('tv', -0.36, -0.71, 0xff5a3a, 'SPACE TV');
  makeButton('iso', 0.36, -0.71, 0x3a8cff, 'CHROMIUM.ISO');
  const boostBtn = makeButton('boost', 0.2, -0.64, 0xff9a3c, 'BOOST', 0.034);
  // hyperjump lever
  const lever = new THREE.Group(); lever.position.set(-0.2, -0.198, -0.64); lever.rotation.x = 0.16; group.add(lever);
  lever.add(new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.02, 0.1, 2, 0.006), metal));
  const arm = new THREE.Group(); lever.add(arm);
  arm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8).translate(0, 0.045, 0), strutMat));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9a5cff, emissive: 0x6a3cff, emissiveIntensity: 0.8 }));
  knob.position.y = 0.095; arm.add(knob);
  arm.rotation.x = -0.5;
  const lp = labelPlate('HYPERJUMP', '#9a5cff'); lp.rotation.x = -Math.PI / 2; lp.position.set(0, 0.012, 0.075); lever.add(lp);
  const leverHit = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.16), new THREE.MeshBasicMaterial({ visible: false })); leverHit.position.y = 0.05; lever.add(leverHit);
  const jumpBtn = { id: 'jump', group: lever, cap: knob, hit: leverHit, t: 0, arm };
  leverHit.userData.button = jumpBtn; buttons.push(jumpBtn);

  // screens that eject from slots in the deck
  function makeScreen(id, side, aspect, standby) {
    const w = 0.5, h = w / aspect;
    const root = new THREE.Group(); group.add(root);
    const frame = new THREE.Mesh(new RoundedBoxGeometry(w + 0.034, h + 0.034, 0.024, 3, 0.01), new THREE.MeshStandardMaterial({ color: 0x15191f, metalness: 0.6, roughness: 0.35, envMap, envMapIntensity: 0.6 }));
    root.add(frame);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.004, 0.026), new THREE.MeshBasicMaterial({ color: id === 'tv' ? 0xff5a3a : 0x3a8cff }));
    edge.position.y = -(h + 0.034) / 2 + 0.002; root.add(edge);
    const display = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: standby, toneMapped: false, color: new THREE.Color(0.8, 0.8, 0.8) }));
    display.position.z = 0.0125; root.add(display);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.3, 0.012).translate(0, -0.15, 0), strutMat);
    armL.position.set(-w * 0.32, -h / 2, -0.004); root.add(armL);
    const armR = armL.clone(); armR.position.x = w * 0.32; root.add(armR);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.006, 0.05), new THREE.MeshBasicMaterial({ color: 0x05070a }));
    slot.position.set(side * 0.36, -0.212, -0.78); slot.rotation.x = 0.16; group.add(slot);
    const scr = { id, root, display, w, h, t: 0, target: 0, side, bezel: [] };
    display.userData.screen = scr;
    root.visible = false;
    return scr;
  }
  const standbyTV = textTex(1280, 720, (g, W, H) => {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1b0f2e'); gr.addColorStop(1, '#3a1220');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff9a3c'; g.font = `150px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('SPACE TV', W / 2, H / 2);
    g.fillStyle = '#f6ead2'; g.font = `600 44px ${FONT}`; g.fillText('Tuning in…', W / 2, H / 2 + 90);
  });
  const tv = makeScreen('tv', -1, 16 / 9, standbyTV);
  const isoTex = new THREE.CanvasTexture(document.createElement('canvas'));
  const iso = makeScreen('iso', 1, 16 / 10, isoTex);

  // small bezel buttons on the ISO screen: back, home, keyboard, expand
  function bezelButton(scr, id, x, label) {
    const tex = textTex(96, 96, (g) => { g.fillStyle = '#202733'; rrect(g, 4, 4, 88, 88, 18); g.fill(); g.fillStyle = '#e8f4f2'; g.font = `700 50px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 48, 52); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.04), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(x, -scr.h / 2 - 0.035, 0.008); scr.root.add(m);
    const btn = { id, group: m, cap: m, hit: m, t: 0 }; m.userData.button = btn; buttons.push(btn); scr.bezel.push(btn);
  }
  bezelButton(iso, 'iso-back', -0.18, '◀'); bezelButton(iso, 'iso-home', -0.12, '⌂'); bezelButton(iso, 'iso-reload', -0.06, '↻');
  bezelButton(iso, 'iso-keys', 0.12, '⌨'); bezelButton(iso, 'iso-expand', 0.18, '⤢');
  bezelButton(tv, 'tv-next', 0.18, '▶▶');
  // the bezel bar
  for (const scr of [tv, iso]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(scr.w + 0.034, 0.05, 0.014, 2, 0.006), new THREE.MeshStandardMaterial({ color: 0x15191f, metalness: 0.5, roughness: 0.4 }));
    bar.position.set(0, -scr.h / 2 - 0.035, -0.002); scr.root.add(bar);
  }

  const light = new THREE.PointLight(0xffd9b0, 1.1, 2.5, 1.5); light.position.set(0, 0.35, -0.2); group.add(light);
  const fill = new THREE.PointLight(0x7fb6ff, 0.5, 2.6, 1.5); fill.position.set(0, 0.35, 0.35); group.add(fill);

  // stowed / deployed poses (deployed depends on screen shape: wide shows both, narrow centres one)
  const stowed = (scr) => ({ p: new THREE.Vector3(scr.side * 0.36, -0.42, -0.79), r: new THREE.Euler(-1.2, 0, 0) });
  const deployed = (scr, narrow, solo) => narrow || solo === scr
    ? { p: new THREE.Vector3(narrow ? 0 : scr.side * 0.2, 0.02, narrow ? -0.68 : -0.74), r: new THREE.Euler(0.05, 0, 0) }
    : { p: new THREE.Vector3(scr.side * 0.36, 0.0, -0.74), r: new THREE.Euler(0.05, -scr.side * 0.38, 0) };

  const bobState = { x: 0, z: 0, vx: 0, vz: 0 }, freshState = { a: 0, v: 0, b: 0, vb: 0 };
  let narrow = false;
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  return {
    group, buttons, tv, iso, isoTex, inst, instTex, instCtx: ig, boostBtn, jumpBtn,
    setNarrow(v) { narrow = v; },
    press(btn) { btn.t = 0.18; },
    update(dt, { accel, yawRate, boostLevel, time, jumpCharge }) {
      for (const b of buttons) {
        if (b.t > 0) b.t = Math.max(0, b.t - dt);
        if (b.id === 'jump') continue;
        if (b.cap.geometry.type === 'CylinderGeometry') b.cap.position.y = 0.014 - (b.t > 0 ? 0.008 : 0);
        else b.cap.scale.setScalar(b.t > 0 ? 0.85 : 1);
      }
      boostBtn.cap.material.emissiveIntensity = 0.3 + boostLevel * 0.9 + (boostBtn.t > 0 ? 1 : 0);
      jumpBtn.arm.rotation.x = -0.5 + clamp(jumpCharge, 0, 1) * 1.0;
      jumpBtn.cap.material.emissiveIntensity = 0.6 + Math.sin(time * 4) * 0.25 + jumpCharge;
      // screens
      const solo = tv.target && !iso.target ? tv : iso.target && !tv.target ? iso : null;
      for (const scr of [tv, iso]) {
        let target = scr.target;
        if (narrow && target && scr === tv && iso.target && iso.openedAt > tv.openedAt) target = 0;
        if (narrow && target && scr === iso && tv.target && tv.openedAt > iso.openedAt) target = 0;
        scr.t = clamp(scr.t + (target ? dt : -dt) / 0.9, 0, 1);
        scr.root.visible = scr.t > 0.001;
        if (!scr.root.visible) continue;
        const a = stowed(scr), b = deployed(scr, narrow, solo);
        const k = target ? easeOutBack(scr.t) : scr.t * scr.t;
        scr.root.position.lerpVectors(a.p, b.p, k);
        qa.setFromEuler(a.r); qb.setFromEuler(b.r); scr.root.quaternion.slerpQuaternions(qa, qb, clamp(k, 0, 1.05));
        scr.shown = target && scr.t > 0.98;
      }
      // bobblehead spring (driven by acceleration in cabin space) and swinging air freshener
      const k = 90, c = 7;
      bobState.vx += (-k * bobState.x - c * bobState.vx - accel.x * 0.004) * dt; bobState.x += bobState.vx * dt;
      bobState.vz += (-k * bobState.z - c * bobState.vz + accel.z * 0.004) * dt; bobState.z += bobState.vz * dt;
      head.rotation.z = clamp(bobState.x * 9, -0.6, 0.6); head.rotation.x = clamp(bobState.z * 9, -0.6, 0.6);
      head.rotation.y = Math.sin(time * 0.7) * 0.15;
      freshState.v += (-12 * freshState.a - 1.2 * freshState.v - accel.x * 0.02 - yawRate * 0.3) * dt; freshState.a += freshState.v * dt;
      freshState.vb += (-12 * freshState.b - 1.2 * freshState.vb + accel.z * 0.02) * dt; freshState.b += freshState.vb * dt;
      fresh.rotation.z = clamp(freshState.a, -0.9, 0.9); fresh.rotation.x = clamp(freshState.b, -0.9, 0.9);
      rocket.rotation.y += dt * 0.6;
      void damp;
    },
  };
}
