// Loads HexGL's Feisar ship (github.com/BKcore/HexGL, MIT, Thibaut Despoulain).
// The models use the old three.js JSON format 3.x, which current three.js no longer reads,
// so parseModel() converts them to a BufferGeometry.
import * as THREE from 'three';

const SHA = '6addc95a2fce3bf05f4d751823cc054c61a16d68';
const BASES = ['assets/hexgl/', `https://cdn.jsdelivr.net/gh/BKcore/HexGL@${SHA}/`];

export function parseModel(json) {
  const s = json.scale ? 1 / json.scale : 1;
  const V = json.vertices, N = json.normals || [], F = json.faces;
  const layers = (json.uvs || []).filter((l) => l.length), U = layers[0] || [];
  const pos = [], nor = [], uv = [];
  let i = 0;
  while (i < F.length) {
    const type = F[i++];
    const nv = type & 1 ? 4 : 3;
    const vi = F.slice(i, i + nv); i += nv;
    if (type & 2) i++;                              // material index
    if (type & 4) i += layers.length;               // face uv
    let ui = null;
    if (type & 8) { ui = F.slice(i, i + nv); i += nv * layers.length; } // per-vertex uv (first layer used)
    let fn = null;
    if (type & 16) fn = F[i++];                     // face normal
    let ni = null;
    if (type & 32) { ni = F.slice(i, i + nv); i += nv; } // per-vertex normals
    if (type & 64) i++;                             // face colour
    if (type & 128) i += nv;                        // vertex colours
    const tris = nv === 4 ? [[0, 1, 3], [1, 2, 3]] : [[0, 1, 2]];
    for (const t of tris) for (const k of t) {
      const v = vi[k] * 3;
      pos.push(V[v] * s, V[v + 1] * s, V[v + 2] * s);
      const n = ni ? ni[k] * 3 : fn !== null ? fn * 3 : -1;
      if (n >= 0) nor.push(N[n], N[n + 1], N[n + 2]);
      if (ui) { const u = ui[k] * 2; uv.push(U[u], U[u + 1]); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (nor.length === pos.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else g.computeVertexNormals();
  if (uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

async function fetchFirst(path) {
  for (const base of BASES) {
    try { const r = await fetch(base + path); if (r.ok) return { json: await r.json(), base }; } catch { /* next */ }
  }
  throw new Error('HexGL asset missing: ' + path);
}

function loadTex(loader, url, srgb, aniso) {
  return new Promise((res) => loader.load(url, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso;
    res(t);
  }, undefined, () => res(null)));
}

// Returns { root, hull, booster, sprite, light, update(dt, power) }.
// root faces -Z (like a camera); the HexGL mesh inside it is turned around because its nose points +Z.
export async function loadFeisar(renderer, { hi = true, envMap = null } = {}) {
  const [{ json: shipJson, base }, { json: boosterJson }] = await Promise.all([
    fetchFirst('geometries/ships/feisar/feisar.js'),
    fetchFirst('geometries/booster/booster.js'),
  ]);
  const tl = new THREE.TextureLoader(); tl.setCrossOrigin('anonymous');
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const T = hi ? 'textures.full/' : 'textures/';
  const [diffuse, specular, normal, boosterTex, spriteTex] = await Promise.all([
    loadTex(tl, base + T + 'ships/feisar/diffuse.jpg', true, aniso),
    loadTex(tl, base + 'textures.full/ships/feisar/specular.jpg', false, aniso),
    loadTex(tl, base + 'textures.full/ships/feisar/normal.jpg', false, aniso),
    loadTex(tl, base + T + 'ships/feisar/booster/booster.png', true, 1),
    loadTex(tl, base + 'textures.full/ships/feisar/booster/boostersprite.jpg', true, 1),
  ]);

  const hullMat = new THREE.MeshPhongMaterial({
    map: diffuse, specularMap: specular, normalMap: normal, normalScale: new THREE.Vector2(1, -1),
    shininess: 42, specular: 0xbfc8d6, color: 0xffffff,
    envMap, reflectivity: envMap ? 0.22 : 0, combine: THREE.MixOperation,
  });
  const hull = new THREE.Mesh(parseModel(shipJson), hullMat);
  hull.rotation.y = Math.PI;

  const booster = new THREE.Mesh(parseModel(boosterJson), new THREE.MeshBasicMaterial({
    map: boosterTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fd8ff,
  }));
  booster.position.set(0, 0.665, -3.8);
  booster.renderOrder = 2;
  hull.add(booster);

  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: 0x9fd8ff }));
  sprite.scale.set(3.2, 3.2, 3.2);
  sprite.position.set(0, 0.665, -4.0);
  sprite.renderOrder = 3;
  hull.add(sprite);

  const light = new THREE.PointLight(0x00a2ff, 6, 40, 1.6);
  light.position.set(0, 0.665, -4.6);
  hull.add(light);

  const root = new THREE.Group();
  root.add(hull);

  let t = 0;
  // power: 0 idle .. 1 full throttle .. 2 boost (same flicker as HexGL's ShipEffects)
  const update = (dt, power) => {
    t += dt;
    const r = Math.random();
    const s = 0.55 + power * 0.45 + r * 0.08;
    booster.scale.set(s, s, s * (0.8 + power * 0.5));
    booster.rotation.z += dt * 60;
    booster.material.opacity = 0.55 + r * 0.35;
    sprite.material.opacity = 0.5 + r * 0.4;
    const ss = 2.4 + power * 1.6 + r * 0.4;
    sprite.scale.set(ss, ss, ss);
    light.intensity = (2 + power * 5) * (0.8 + r * 0.4);
  };
  return { root, hull, booster, sprite, light, update, source: base };
}

// A plain stand-in if the HexGL files cannot be reached at all.
export function fallbackShip() {
  const root = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, metalness: 0.6, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.9, 8, 6), m);
  body.rotation.x = -Math.PI / 2; body.position.y = 0.6; root.add(body);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.15, 2), m); wing.position.set(0, 0.4, 1.5); root.add(wing);
  return { root, hull: body, booster: null, sprite: null, light: null, update() {}, source: 'fallback' };
}
