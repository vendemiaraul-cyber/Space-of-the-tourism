// Spaceport Aurora: a hexagonal spine with a launch tube, a two-part bay door, a rotating habitat ring,
// solar wings and blinking beacons. The ship starts inside the tube and is catapulted out along -Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, rrect, FONT, DISPLAY } from './util.js';

export const TUBE = { w: 20, h: 11, back: -100, front: -320, floor: -5.5 };
export const SHIP_START = new THREE.Vector3(0, TUBE.floor + 1.0, -122);

function hullTexture(windows) {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#7c838f'; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 260; i++) {           // plating
    const x = Math.random() * 1024, y = Math.random() * 512, w = 30 + Math.random() * 160, h = 20 + Math.random() * 90;
    const v = 105 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 4},${v + 12})`; g.fillRect(x, y, w, h);
  }
  g.strokeStyle = 'rgba(30,34,44,.55)'; g.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.fillStyle = 'rgba(255,154,60,.75)';
  for (let x = 16; x < 1024; x += 128) g.fillRect(x, 250, 70, 10);   // orange livery band
  const [e, ge] = canvas(1024, 512);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 1024, 512);
  if (windows) {
    for (let row = 0; row < 6; row++) {
      const y = 40 + row * 80;
      for (let x = 8; x < 1024; x += 14) {
        if (Math.random() < 0.38) continue;
        const warm = Math.random() < 0.8;
        g.fillStyle = '#1a1d24'; g.fillRect(x, y, 8, 12);
        ge.fillStyle = warm ? `hsl(${38 + Math.random() * 12},90%,${60 + Math.random() * 25}%)` : '#9fe8ff'; ge.fillRect(x, y, 8, 12);
      }
    }
  }
  const map = new THREE.CanvasTexture(c), emi = new THREE.CanvasTexture(e);
  for (const t of [map, emi]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; }
  map.colorSpace = emi.colorSpace = THREE.SRGBColorSpace;
  return { map, emi };
}

function stripeTexture(label) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#2a2e38'; g.fillRect(0, 0, 1024, 256);
  g.save(); g.beginPath(); g.rect(0, 0, 1024, 64); g.rect(0, 192, 1024, 64); g.clip();
  for (let x = -256; x < 1100; x += 64) { g.fillStyle = '#f2b01e'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 32, 0); g.lineTo(x + 32 + 64, 256); g.lineTo(x + 64, 256); g.fill(); }
  g.restore();
  g.fillStyle = '#f6ead2'; g.font = `700 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 512, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function wallTexture() {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#3b414d'; g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 128) {
    g.fillStyle = '#454c59'; g.fillRect(x + 6, 18, 116, 100); g.fillRect(x + 6, 138, 116, 100);
    g.fillStyle = '#2b3039'; g.fillRect(x + 12, 60, 104, 6);
  }
  const [e, ge] = canvas(512, 256);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 256);
  ge.fillStyle = '#bff6ff'; ge.fillRect(0, 124, 512, 8);           // light strip
  ge.fillStyle = '#ff9a3c'; for (let x = 20; x < 512; x += 128) ge.fillRect(x, 226, 40, 6);
  g.fillStyle = '#e8f4f2'; g.fillRect(0, 124, 512, 8);
  const map = new THREE.CanvasTexture(c), emi = new THREE.CanvasTexture(e);
  for (const t of [map, emi]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
  return { map, emi };
}

function signTexture(lines, w = 1024, h = 512, bg = '#11161f') {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of lines) { g.fillStyle = l.c || '#f6ead2'; g.font = l.f; g.fillText(l.t, w / 2, l.y); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function glowSprite(color, size) {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

export function buildStation({ envMap = null } = {}) {
  const group = new THREE.Group();
  const R = 70, L = 640, { w: W, h: H, back, front, floor } = TUBE;
  const hullTex = hullTexture(true);
  hullTex.map.repeat.set(3, 1); hullTex.emi.repeat.set(3, 1);
  const hullMat = new THREE.MeshStandardMaterial({ map: hullTex.map, emissiveMap: hullTex.emi, emissive: 0xffffff, emissiveIntensity: 1.2, metalness: 0.55, roughness: 0.5, envMap, envMapIntensity: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2c313b, metalness: 0.7, roughness: 0.45, envMap, envMapIntensity: 0.5 });

  // spine: open hexagonal prism along Z
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 6, 1, true).rotateX(Math.PI / 2).rotateZ(Math.PI / 6), hullMat);
  group.add(spine);

  // front face with the door opening cut out
  const hex = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3 + Math.PI / 6; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? hex.lineTo(x, y) : hex.moveTo(x, y); }
  hex.closePath();
  const hole = new THREE.Path(); hole.moveTo(-W / 2, floor); hole.lineTo(W / 2, floor); hole.lineTo(W / 2, floor + H); hole.lineTo(-W / 2, floor + H); hole.closePath();
  hex.holes.push(hole);
  const faceGeo = new THREE.ShapeGeometry(hex, 4);
  faceGeo.rotateY(Math.PI); faceGeo.translate(0, 0, front);
  const faceTex = hullTexture(false); faceTex.map.repeat.set(0.012, 0.012);
  const face = new THREE.Mesh(faceGeo, new THREE.MeshStandardMaterial({ map: faceTex.map, metalness: 0.5, roughness: 0.55, envMap, envMapIntensity: 0.5, side: THREE.DoubleSide }));
  group.add(face);
  const backCap = new THREE.Mesh(new THREE.CircleGeometry(R, 6).rotateZ(Math.PI / 6 + Math.PI / 6).translate(0, 0, L / 2), darkMat);
  group.add(backCap);

  // door frame: emissive amber border + "AURORA" sign
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1f27, emissive: 0xff9a3c, emissiveIntensity: 1.4 });
  const fr = [];
  fr.push(new THREE.BoxGeometry(W + 4, 0.8, 1).translate(0, floor + H + 1.2, front - 0.4));
  fr.push(new THREE.BoxGeometry(W + 4, 0.8, 1).translate(0, floor - 1.2, front - 0.4));
  fr.push(new THREE.BoxGeometry(0.8, H + 3.2, 1).translate(-W / 2 - 1.6, floor + H / 2, front - 0.4));
  fr.push(new THREE.BoxGeometry(0.8, H + 3.2, 1).translate(W / 2 + 1.6, floor + H / 2, front - 0.4));
  group.add(new THREE.Mesh(mergeGeometries(fr), frameMat));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(46, 9).rotateY(Math.PI), new THREE.MeshBasicMaterial({
    map: signTexture([{ t: 'SPACEPORT AURORA', f: `112px ${DISPLAY}`, y: 200, c: '#ff9a3c' }, { t: 'LAUNCH BAY 3 · TOURIST DEPARTURES', f: `600 46px ${FONT}`, y: 350 }], 1024, 512, '#0b0f16'),
  }));
  sign.position.set(0, floor + H + 9, front - 0.6);
  group.add(sign);

  // launch tube interior (inward-facing planes)
  const len = back - front, mid = (back + front) / 2;
  const wall = wallTexture(); wall.map.repeat.set(len / 40, 1); wall.emi.repeat.set(len / 40, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wall.map, emissiveMap: wall.emi, emissive: 0xffffff, emissiveIntensity: 0.32, metalness: 0.4, roughness: 0.6 });
  const left = new THREE.Mesh(new THREE.PlaneGeometry(len, H).rotateY(Math.PI / 2), wallMat); left.position.set(-W / 2, floor + H / 2, mid);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(len, H).rotateY(-Math.PI / 2), wallMat); right.position.set(W / 2, floor + H / 2, mid);
  const ceilTex = wallTexture(); ceilTex.map.repeat.set(1, len / 30); ceilTex.emi.repeat.set(1, len / 30);
  ceilTex.map.rotation = ceilTex.emi.rotation = Math.PI / 2;
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, len).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: ceilTex.map, emissiveMap: ceilTex.emi, emissive: 0xffffff, emissiveIntensity: 0.45, metalness: 0.4, roughness: 0.6 }));
  ceil.position.set(0, floor + H, mid);
  const [fc, fg] = canvas(256, 512);
  fg.fillStyle = '#23272f'; fg.fillRect(0, 0, 256, 512);
  fg.fillStyle = '#2d323c'; for (let y = 0; y < 512; y += 64) fg.fillRect(0, y, 256, 30);
  fg.fillStyle = '#f2b01e'; fg.fillRect(20, 0, 8, 512); fg.fillRect(228, 0, 8, 512);
  const floorTex = new THREE.CanvasTexture(fc); floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(1, len / 24); floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.anisotropy = 8;
  const flo = new THREE.Mesh(new THREE.PlaneGeometry(W, len).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.5, roughness: 0.5 }));
  flo.position.set(0, floor, mid);
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H).rotateY(Math.PI), new THREE.MeshBasicMaterial({
    map: signTexture([
      { t: 'THANK YOU FOR FLYING', f: `600 54px ${FONT}`, y: 120, c: '#9fb8c9' },
      { t: 'SPACEPORT AURORA', f: `118px ${DISPLAY}`, y: 250, c: '#ff9a3c' },
      { t: 'Keep arms inside the Feisar · Souvenirs at Ring B', f: `600 40px ${FONT}`, y: 390 },
    ], 1024, 560, '#0b0f16'),
  }));
  backWall.position.set(0, floor + H / 2, back - 0.05);
  group.add(left, right, ceil, flo, backWall);

  // rail + chase lights
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.35, len - 6).translate(0, floor + 0.17, mid - 3), darkMat);
  group.add(rail);
  const N = 90;
  const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.12, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }), N * 2);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const z = back - 8 - (i / (N - 1)) * (len - 14);
    m4.makeTranslation(-1.2, floor + 0.08, z); lights.setMatrixAt(i * 2, m4);
    m4.makeTranslation(1.2, floor + 0.08, z); lights.setMatrixAt(i * 2 + 1, m4);
    lights.setColorAt(i * 2, col.set(0x203040)); lights.setColorAt(i * 2 + 1, col.set(0x203040));
  }
  group.add(lights);

  // docking clamps that hold the ship until launch
  const clampGeo = mergeGeometries([new THREE.BoxGeometry(5.5, 0.6, 1.2).translate(2.75, 0, 0), new THREE.BoxGeometry(0.6, 1.6, 1.4).translate(5.3, 0.5, 0)]);
  const clamps = [];
  for (const side of [-1, 1]) for (const dz of [-2.5, 2.5]) {
    const cm = new THREE.Mesh(clampGeo, new THREE.MeshStandardMaterial({ color: 0xf2b01e, metalness: 0.4, roughness: 0.5 }));
    cm.scale.x = -side; cm.position.set(side * (W / 2), SHIP_START.y + 0.5, SHIP_START.z + dz);
    cm.userData.side = side; group.add(cm); clamps.push(cm);
  }

  // rotating amber beacons in the tube
  const beacons = [];
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const z of [back - 10, back - 60, mid, front + 30]) for (const x of [-W / 2 + 1.5, W / 2 - 1.5]) {
    const b = new THREE.Group(); b.position.set(x, floor + H - 0.6, z);
    b.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 12), new THREE.MeshBasicMaterial({ color: 0xff9a3c })));
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 6, 16, 1, true).translate(0, -3, 0).rotateZ(Math.PI / 2.2), beamMat);
    b.add(beam); b.visible = false; group.add(b); beacons.push(b);
  }
  const alarmLight = new THREE.PointLight(0xff8a2a, 0, 120, 1.2); alarmLight.position.set(0, floor + H - 2, SHIP_START.z); group.add(alarmLight);
  const tubeLights = [];
  for (const z of [SHIP_START.z + 6, mid + 10, front + 20]) { const p = new THREE.PointLight(0xcfefff, 24, 90, 1.4); p.position.set(0, floor + H - 1.5, z); group.add(p); tubeLights.push(p); }

  // the two-part bay door
  const doorTex = stripeTexture('BAY 3 · DEPARTURES');
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, metalness: 0.5, roughness: 0.5 });
  const doorTop = new THREE.Mesh(new THREE.BoxGeometry(W + 2, H / 2 + 0.6, 1.4), doorMat);
  const doorBot = new THREE.Mesh(new THREE.BoxGeometry(W + 2, H / 2 + 0.6, 1.4), doorMat);
  const doorZ = front + 1.6, yTop = floor + H * 0.75 + 0.3, yBot = floor + H * 0.25 - 0.3;
  doorTop.position.set(0, yTop, doorZ); doorBot.position.set(0, yBot, doorZ);
  group.add(doorTop, doorBot);

  // habitat ring with spokes
  const ring = new THREE.Group(); ring.position.z = 80;
  const ringTex = hullTexture(true); ringTex.map.repeat.set(24, 1); ringTex.emi.repeat.set(24, 1);
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(260, 16, 20, 160), new THREE.MeshStandardMaterial({ map: ringTex.map, emissiveMap: ringTex.emi, emissive: 0xffffff, emissiveIntensity: 1.2, metalness: 0.5, roughness: 0.5, envMap, envMapIntensity: 0.6 })));
  const spokes = [];
  for (let i = 0; i < 4; i++) spokes.push(new THREE.CylinderGeometry(5, 5, 180, 10).translate(0, 155, 0).rotateZ(i * Math.PI / 2 + Math.PI / 4));
  ring.add(new THREE.Mesh(mergeGeometries(spokes), darkMat));
  group.add(ring);

  // solar wings
  const [sc, sg] = canvas(256, 256);
  sg.fillStyle = '#0f1d3d'; sg.fillRect(0, 0, 256, 256);
  sg.strokeStyle = '#4a6fb5'; sg.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) { sg.beginPath(); sg.moveTo(x, 0); sg.lineTo(x, 256); sg.stroke(); sg.beginPath(); sg.moveTo(0, x); sg.lineTo(256, x); sg.stroke(); }
  const solarTex = new THREE.CanvasTexture(sc); solarTex.wrapS = solarTex.wrapT = THREE.RepeatWrapping; solarTex.repeat.set(6, 2); solarTex.colorSpace = THREE.SRGBColorSpace;
  const solarMat = new THREE.MeshStandardMaterial({ map: solarTex, metalness: 0.8, roughness: 0.25, envMap, envMapIntensity: 1, emissive: 0x0a1630 });
  const wings = [];
  for (const side of [-1, 1]) for (const z of [250, 300]) wings.push(new THREE.BoxGeometry(200, 1, 40).translate(side * (R + 130), 0, z));
  group.add(new THREE.Mesh(mergeGeometries(wings), solarMat));
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 2 * R + 480, 8).rotateZ(Math.PI / 2).translate(0, 0, 275), darkMat));
  // antenna dish
  const pts = []; for (let i = 0; i <= 12; i++) { const r = i * 5; pts.push(new THREE.Vector2(r, r * r / 160)); }
  const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 32).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8dce4, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }));
  dish.position.set(0, R + 30, 140); dish.rotation.x = -0.6; group.add(dish);
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 30, 8).translate(0, R + 15, 140), darkMat));

  // blinking beacons and docking lights
  const blinkers = [];
  for (const [p, c] of [[[R + 400, 0, 275], '#ff3344'], [[-R - 400, 0, 275], '#33ff88'], [[0, R + 2, -300], '#ffffff'], [[0, -R - 2, 300], '#ffffff'], [[290, 0, 80], '#ff3344'], [[-290, 0, 80], '#33ff88']]) {
    const s = glowSprite(c, 26); s.position.set(...p); group.add(s); blinkers.push(s);
  }
  const dockLights = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, s = glowSprite('#ff9a3c', 3.5);
    s.position.set(Math.cos(a) * (W / 2 + 6), floor + H / 2 + Math.sin(a) * (H / 2 + 5), front - 1);
    group.add(s); dockLights.push(s);
  }

  let doorOpen = 0, alarm = false, chase = -1;
  const api = {
    group, doorTop, doorBot, clamps, ring,
    setDoor(v) { doorOpen = v; const d = v * (H / 2 + 2.2); doorTop.position.y = yTop + d; doorBot.position.y = yBot - d; },
    setAlarm(on) { alarm = on; for (const b of beacons) b.visible = on; },
    setClamps(v) { for (const c of clamps) c.position.x = c.userData.side * (W / 2 + v * 4); },
    startChase() { chase = 0; },
    setInterior(on) { for (const p of tubeLights) p.visible = on; alarmLight.visible = on; },
    update(dt, t) {
      ring.rotation.z += dt * 0.03;
      for (let i = 0; i < blinkers.length; i++) blinkers[i].material.opacity = (Math.sin(t * 3 + i * 1.7) > 0.6) ? 1 : 0.15;
      for (let i = 0; i < dockLights.length; i++) dockLights[i].material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 6 - i * 0.6));
      if (alarm) {
        for (const b of beacons) b.rotation.y += dt * 5;
        alarmLight.intensity = 40 + 30 * Math.sin(t * 10);
      } else alarmLight.intensity = 0;
      // chase lights: a pulse running toward the door
      if (chase >= 0) chase += dt;
      for (let i = 0; i < N; i++) {
        let k = 0.12;
        if (chase >= 0) { const head = chase * 70; const d = head - i; k = d > 0 && d < 10 ? 1 - d / 10 : 0.12; if (chase > 4) k = 0.5 + 0.5 * Math.sin(t * 4 + i * 0.3); }
        else k = 0.15 + 0.1 * Math.sin(t * 2 + i * 0.25);
        col.setRGB(0.3 + k * 2.2, 0.55 + k * 1.2, 0.7 + k * 0.3);
        lights.setColorAt(i * 2, col); lights.setColorAt(i * 2 + 1, col);
      }
      lights.instanceColor.needsUpdate = true;
      void doorOpen;
    },
  };
  api.setDoor(0); api.setClamps(0);
  return api;
}
