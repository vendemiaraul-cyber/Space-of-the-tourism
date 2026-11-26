// Planet surfaces. Diving into a planet (anything but a gas giant) lands the Feisar in a generated landscape:
// a displaced terrain grid that follows the ship, a liquid plane (water, acid, lava or frozen lakes), a sky
// dome and instanced props. Heights come from the same noise on the GPU (vertex displacement) and on the CPU
// (collision and prop placement), so the ground you hit is the ground you see.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, canvas } from './util.js';

export const TYPE_ID = { terran: 0, ocean: 1, desert: 2, ice: 3, lava: 4, gas: 5, toxic: 6, barren: 7 };
export const EXIT_ALT = 1000;            // climb above this to leave the atmosphere

// ---------------------------------------------------------------- CPU noise (exact twin of the GLSL below)
const fract = (v) => v - Math.floor(v);
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const m289 = (x) => x - Math.floor(x * (1 / 289)) * 289;
const perm = (x) => m289((x * 34 + 10) * x);
const NC0 = 0.211324865405187, NC1 = 0.366025403784439, NC2 = -0.577350269189626, NC3 = 0.024390243902439;
export function snoise2(vx, vy) {           // 2D simplex noise (Ashima / Gustavson)
  const s = (vx + vy) * NC1, ix = Math.floor(vx + s), iy = Math.floor(vy + s);
  const t = (ix + iy) * NC0, x0x = vx - ix + t, x0y = vy - iy + t;
  const i1x = x0x > x0y ? 1 : 0, i1y = 1 - i1x;
  const x1x = x0x + NC0 - i1x, x1y = x0y + NC0 - i1y, x2x = x0x + NC2, x2y = x0y + NC2;
  const mx = m289(ix), my = m289(iy);
  const p0 = perm(perm(my) + mx), p1 = perm(perm(my + i1y) + mx + i1x), p2 = perm(perm(my + 1) + mx + 1);
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0), m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0), m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
  m0 *= m0; m0 *= m0; m1 *= m1; m1 *= m1; m2 *= m2; m2 *= m2;
  const g0 = 2 * fract(p0 * NC3) - 1, g1 = 2 * fract(p1 * NC3) - 1, g2 = 2 * fract(p2 * NC3) - 1;
  const h0 = Math.abs(g0) - 0.5, h1 = Math.abs(g1) - 0.5, h2 = Math.abs(g2) - 0.5;
  const a0 = g0 - Math.floor(g0 + 0.5), a1 = g1 - Math.floor(g1 + 0.5), a2 = g2 - Math.floor(g2 + 0.5);
  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2);
  return 130 * (m0 * (a0 * x0x + h0 * x0y) + m1 * (a1 * x1x + h1 * x1y) + m2 * (a2 * x2x + h2 * x2y));
}
function fbm(x, y, oct) { let a = 0.5, s = 0; for (let i = 0; i < oct; i++) { s += a * snoise2(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; a *= 0.5; } return s; }
function ridge(x, y) { let a = 0.5, s = 0; for (let i = 0; i < 4; i++) { const n = 1 - Math.abs(snoise2(x, y)); s += a * n * n; x = x * 2.07 + 9.3; y = y * 2.07 + 4.1; a *= 0.5; } return s; }
function hashU(x) { x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; }
function hash2(cx, cy) { const h = hashU((Math.imul(cx | 0, 0x9E3779B9) ^ hashU(((cy | 0) + 0x85EBCA6B) >>> 0)) >>> 0); return [(h & 0xffff) / 65535, (h >>> 16) / 65535]; }
function craterLayer(x, z, cell, depth, salt) {
  const gx = x / cell, gz = z / cell, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
  let best = 8, rr = 0;
  for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
    const cx = ix + xx, cz = iz + yy, h = hash2(cx + salt, cz);
    const dx = xx + 0.15 + h[0] * 0.7 - fx, dz = yy + 0.15 + h[1] * 0.7 - fz, dd = dx * dx + dz * dz;
    if (dd < best) { best = dd; rr = hash2(cx, cz + salt + 7)[0]; }
  }
  const q = Math.sqrt(best) / (0.18 + 0.22 * rr), e = (q - 1) * 4;
  return ((q < 1 ? q * q - 1 : 0) + Math.exp(-e * e) * 0.4) * depth;
}
function makeHeight(T, ox, oy) {
  return (x, z) => {
    const px = x * 0.0011 + ox, py = z * 0.0011 + oy, n = fbm(px, py, 6);
    switch (T) {
      case 1: return n * 160 + ridge(px * 1.6 + 2, py * 1.6 + 2) * 70 - 78;
      case 2: {
        let d = 1 - Math.abs(snoise2(px * 5 + py * 1.3 + 11, py * 1.6 + 11)); d *= d;
        const mesa = smoothstep(0.3, 0.38, fbm(px * 0.5 + 7, py * 0.5 + 7, 3)) * 120;
        const canyon = Math.pow(1 - Math.abs(snoise2(px * 0.7 + 3, py * 0.7 + 3)), 9) * 130;
        return n * 55 + d * 16 + mesa - canyon + 30;
      }
      case 3: return n * 110 + ridge(px * 1.3, py * 1.3) * 110 - Math.pow(1 - Math.abs(snoise2(px * 4 + 1, py * 4 + 1)), 16) * 30 + 8;
      case 4: return n * 150 + ridge(px * 1.5, py * 1.5) * 80 - Math.pow(1 - Math.abs(snoise2(px * 0.8 + 5, py * 0.8 + 5)), 6) * 100 + 20;
      case 7: return n * 70 + craterLayer(x, z, 520, 70, 0) + craterLayer(x, z, 160, 24, 101) + 12;
      default: { const m = ridge(px * 1.8 + 3.1, py * 1.8 + 3.1); return n * 180 + smoothstep(0.05, 0.5, n) * m * 280 + 4; }
    }
  };
}

// ---------------------------------------------------------------- GPU twin
const GLSL_TERRAIN = /* glsl */`
uniform int uType; uniform vec2 uOff;
vec3 tMod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec2 tMod289(vec2 x){return x-floor(x*(1.0/289.0))*289.0;}
vec3 tPermute(vec3 x){return tMod289(((x*34.0)+10.0)*x);}
float snoise2(vec2 v){
  const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
  vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
  vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
  vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1;
  i=tMod289(i);
  vec3 p=tPermute(tPermute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
  vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0); m=m*m; m=m*m;
  vec3 x=2.0*fract(p*C.www)-1.0; vec3 h=abs(x)-0.5; vec3 ox=floor(x+0.5); vec3 a0=x-ox;
  m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);
  vec3 g; g.x=a0.x*x0.x+h.x*x0.y; g.yz=a0.yz*x12.xz+h.yz*x12.yw;
  return 130.0*dot(m,g);
}
float tFbm(vec2 p,int oct){float a=0.5,s=0.0;for(int i=0;i<6;i++){if(i>=oct)break;s+=a*snoise2(p);p=p*2.03+vec2(17.1,9.7);a*=0.5;}return s;}
float tRidge(vec2 p){float a=0.5,s=0.0;for(int i=0;i<4;i++){float n=1.0-abs(snoise2(p));s+=a*n*n;p=p*2.07+vec2(9.3,4.1);a*=0.5;}return s;}
uint tHashU(uint x){x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;x^=x>>16u;return x;}
vec2 tHash2(ivec2 c){uint h=tHashU(uint(c.x)*0x9E3779B9u^tHashU(uint(c.y)+0x85EBCA6Bu));return vec2(float(h&0xFFFFu),float(h>>16u))/65535.0;}
float tCraterLayer(vec2 xz,float cell,float depth,int salt){
  vec2 g=xz/cell; vec2 i=floor(g); vec2 f=g-i; float best=8.0,rr=0.0;
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    ivec2 c=ivec2(int(i.x)+x,int(i.y)+y);
    vec2 h=tHash2(ivec2(c.x+salt,c.y));
    vec2 d=vec2(float(x),float(y))+0.15+h*0.7-f; float dd=dot(d,d);
    if(dd<best){best=dd;rr=tHash2(ivec2(c.x,c.y+salt+7)).x;}
  }
  float q=sqrt(best)/(0.18+0.22*rr); float e=(q-1.0)*4.0;
  return ((q<1.0?q*q-1.0:0.0)+exp(-e*e)*0.4)*depth;
}
float terrainH(vec2 xz){
  vec2 p=xz*0.0011+uOff; float n=tFbm(p,6);
  if(uType==1) return n*160.0+tRidge(p*1.6+2.0)*70.0-78.0;
  if(uType==2){
    float d=1.0-abs(snoise2(vec2(p.x*5.0+p.y*1.3+11.0,p.y*1.6+11.0))); d*=d;
    float mesa=smoothstep(0.3,0.38,tFbm(p*0.5+7.0,3))*120.0;
    float canyon=pow(1.0-abs(snoise2(p*0.7+3.0)),9.0)*130.0;
    return n*55.0+d*16.0+mesa-canyon+30.0;
  }
  if(uType==3) return n*110.0+tRidge(p*1.3)*110.0-pow(1.0-abs(snoise2(p*4.0+1.0)),16.0)*30.0+8.0;
  if(uType==4) return n*150.0+tRidge(p*1.5)*80.0-pow(1.0-abs(snoise2(p*0.8+5.0)),6.0)*100.0+20.0;
  if(uType==7) return n*70.0+tCraterLayer(xz,520.0,70.0,0)+tCraterLayer(xz,160.0,24.0,101)+12.0;
  float m=tRidge(p*1.8+3.1);
  return n*180.0+smoothstep(0.05,0.5,n)*m*280.0+4.0;
}`;
const GLSL_BIOME = /* glsl */`
uniform int uType; uniform vec3 uP[6];
vec3 biome(float h,float slope,float d){
  vec3 c;
  if(uType==2){
    c=mix(uP[1],uP[3],smoothstep(-10.0,90.0,h+d*22.0));
    c=mix(c,uP[2],smoothstep(70.0,130.0,h)*0.7);
    c=mix(c,uP[4],smoothstep(0.3,0.55,slope));
  } else if(uType==3){
    c=mix(uP[1],uP[3],smoothstep(-30.0,110.0,h+d*30.0));
    c=mix(c,uP[2],smoothstep(0.2,0.8,d+0.4)*0.35);
    c=mix(c,uP[0],smoothstep(0.42,0.7,slope));
  } else if(uType==4){
    c=mix(uP[0],uP[1],smoothstep(0.0,150.0,h+d*30.0));
    c=mix(c,uP[2],smoothstep(0.45,0.75,slope)*0.55);
  } else if(uType==7){
    c=mix(uP[0],uP[2],smoothstep(-50.0,80.0,h+d*25.0));
    c=mix(c,uP[1],smoothstep(0.35,0.65,slope)*0.7);
    c*=0.9+0.2*d;
  } else {
    float e=h+d*12.0;
    c=mix(uP[2],uP[3],smoothstep(3.0,12.0,e));
    c=mix(c,uP[3]*0.72,smoothstep(0.1,0.7,d+0.3)*0.4);
    c=mix(c,uP[4],smoothstep(120.0,210.0,e));
    c=mix(c,uP[4]*0.8,smoothstep(0.36,0.62,slope));
    c=mix(c,uP[5],smoothstep(255.0,310.0,e)*(uType==6?0.0:1.0));
    c=mix(c,uP[1]*0.6,smoothstep(0.0,-50.0,h));
  }
  return c;
}`;

// ---------------------------------------------------------------- textures
function sineField(n, waves, fn) {         // tileable field from integer-frequency sines
  const [c, g] = canvas(n, n), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let v = 0, dx = 0, dy = 0;
    for (const [fx, fy, a, ph] of waves) { const k = 2 * Math.PI * (fx * x / n + fy * y / n) + ph; v += Math.sin(k) * a; dx += Math.cos(k) * a * fx; dy += Math.cos(k) * a * fy; }
    const o = (y * n + x) * 4, rgb = fn(v, dx, dy);
    img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const WAVES = [[1, 2, 0.9, 0.3], [3, -1, 0.5, 1.1], [-2, 3, 0.35, 2.0], [5, 4, 0.2, 0.7], [-6, 5, 0.12, 2.6], [8, -7, 0.07, 1.4]];
const waterNormals = () => sineField(128, WAVES, (v, dx, dy) => { const nx = -dx * 0.16, ny = -dy * 0.16, l = Math.hypot(nx, ny, 1); return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255]; });
const lavaVeins = () => { const t = sineField(128, WAVES, (v) => { const k = Math.pow(Math.max(0, 1 - Math.abs(v) / 0.9), 5); return [255 * k, 200 * k * k, 90 * k * k * k]; }); t.colorSpace = THREE.SRGBColorSpace; return t; };

// ---------------------------------------------------------------- props
function propGeometry(kind) {
  const col = (geo, r, g, b) => { const n = geo.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([r, g, b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); return geo; };
  const prep = (geo) => { geo = geo.index ? geo.toNonIndexed() : geo; geo.deleteAttribute('uv'); return geo; };
  if (kind === 'tree') return mergeGeometries([col(prep(new THREE.CylinderGeometry(0.7, 1.0, 6, 5).translate(0, 3, 0)), 0.55, 0.38, 0.25), col(prep(new THREE.ConeGeometry(5, 15, 6).translate(0, 12, 0)), 1, 1, 1), col(prep(new THREE.ConeGeometry(3.6, 10, 6).translate(0, 18.5, 0)), 1, 1, 1)]);
  if (kind === 'shroom') return mergeGeometries([col(prep(new THREE.CylinderGeometry(0.8, 1.2, 8, 6).translate(0, 4, 0)), 0.8, 0.8, 0.75), col(prep(new THREE.SphereGeometry(5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 7.5, 0)), 1, 1, 1)]);
  if (kind === 'spike') return col(prep(new THREE.ConeGeometry(2.6, 26, 5).translate(0, 12, 0)), 1, 1, 1);
  return col(prep(new THREE.DodecahedronGeometry(4, 0).scale(1, 0.62, 1.2).translate(0, 0.8, 0)), 1, 1, 1);
}
const PROPS = {
  terran: { kind: 'tree', per: 30, lo: 5, hi: 210, slope: 0.32, pal: [3, 3, 4] },
  ocean: { kind: 'tree', per: 16, lo: 4, hi: 170, slope: 0.3, pal: [3, 3, 4] },
  toxic: { kind: 'shroom', per: 22, lo: 4, hi: 230, slope: 0.36, pal: [5, 2, 3] },
  desert: { kind: 'rock', per: 12, lo: -999, hi: 999, slope: 0.45, pal: [4, 2, 0] },
  ice: { kind: 'spike', per: 16, lo: -2, hi: 999, slope: 0.45, pal: [2, 3, 1] },
  lava: { kind: 'rock', per: 16, lo: 6, hi: 999, slope: 0.55, pal: [0, 1, 2] },
  barren: { kind: 'rock', per: 14, lo: -999, hi: 999, slope: 0.55, pal: [1, 2, 0] },
};
const LIQUID = { terran: 'water', ocean: 'water', toxic: 'acid', lava: 'lava', ice: 'ice' };

export class Surface {
  constructor({ spec, name, sunColor, low = false }) {
    this.spec = spec; this.name = name; this.type = spec.type; this.low = low;
    const T = TYPE_ID[spec.type];
    const ox = spec.noiseOff.x % 97, oy = spec.noiseOff.z % 97;
    this.heightAt = makeHeight(T, ox, oy);
    this.liquid = LIQUID[spec.type] || null;
    this.level = this.liquid === 'ice' ? -6 : this.liquid ? 0 : -Infinity;
    this.group = new THREE.Group();
    const pal = spec.palette;

    // terrain: a uniform grid snapped to its own spacing, displaced on the GPU
    const N = low ? 160 : 240, STEP = low ? 11 : 10;
    this.step = STEP; this.extent = (N * STEP) / 2;
    const geo = new THREE.PlaneGeometry(N * STEP, N * STEP, N, N); geo.rotateX(-Math.PI / 2); geo.deleteAttribute('uv');
    const uniforms = { uType: { value: T }, uOff: { value: new THREE.Vector2(ox, oy) }, uP: { value: pal } };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: spec.type === 'ice' ? 0.5 : 0.92, metalness: 0, flatShading: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_TERRAIN}\nvarying float vH; varying float vDet; varying vec3 vWP;`)
        .replace('#include <begin_vertex>', `vec4 tWorld = modelMatrix * vec4(position, 1.0);
          float tH = terrainH(tWorld.xz);
          vec3 transformed = vec3(position.x, position.y + tH, position.z);
          vH = tH; vWP = vec3(tWorld.x, tH, tWorld.z);
          vDet = snoise2(tWorld.xz * 0.013) * 0.6 + snoise2(tWorld.xz * 0.061 + 3.0) * 0.3;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_BIOME}\nvarying float vH; varying float vDet; varying vec3 vWP;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 tN = normalize(cross(dFdx(vWP), dFdy(vWP)));
          diffuseColor.rgb = biome(vH, 1.0 - abs(tN.y), vDet);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (uType == 4) totalEmissiveRadiance += uP[3] * smoothstep(16.0, 0.0, vH) * 1.4;`);
    };
    this.terrain = new THREE.Mesh(geo, mat); this.terrain.frustumCulled = false; this.group.add(this.terrain);

    // liquid plane (texture repeats every 100 units, the plane snaps to that so the pattern stays put)
    this.textures = [];
    if (this.liquid) {
      const L = Math.ceil((this.extent * 2) / 100) * 100;
      const lg = new THREE.PlaneGeometry(L, L); lg.rotateX(-Math.PI / 2);
      let lm;
      if (this.liquid === 'lava') {
        const veins = lavaVeins(); veins.repeat.set(L / 100, L / 100); this.textures.push(veins); this.flow = veins;
        lm = new THREE.MeshStandardMaterial({ color: pal[0], emissive: pal[3], emissiveMap: veins, emissiveIntensity: 2.2, roughness: 0.75 });
        lm.emissive.lerp(pal[4], 0.25);
      } else {
        const nm = waterNormals(); nm.repeat.set(L / 100, L / 100); this.textures.push(nm); this.flow = nm;
        const c = this.liquid === 'ice' ? pal[2].clone() : pal[1].clone().lerp(pal[0], 0.35);
        lm = new THREE.MeshStandardMaterial({ color: c, roughness: this.liquid === 'ice' ? 0.08 : 0.18, metalness: 0, normalMap: nm, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true, opacity: this.liquid === 'ice' ? 0.78 : this.liquid === 'acid' ? 0.9 : 0.82 });
        if (this.liquid === 'acid') { lm.emissive = pal[2].clone(); lm.emissiveIntensity = 0.45; }
      }
      this.liquidMesh = new THREE.Mesh(lg, lm); this.liquidMesh.position.y = this.level; this.liquidMesh.renderOrder = 1;
      this.group.add(this.liquidMesh);
    }

    // sky dome, fog and light colours
    // [white in the horizon, horizon brightness, fog start as a share of the view distance]
    const air = { terran: [0.3, 1, 0.32], ocean: [0.3, 1, 0.32], toxic: [0.22, 0.9, 0.3], desert: [0.1, 0.82, 0.55], ice: [0.06, 0.86, 0.5], lava: [0.08, 0.55, 0.28], barren: [0, 1, 0.6] }[spec.type] || [0.3, 1, 0.32];
    const atmo = spec.atmo ? spec.atmo.clone() : null;
    const hor = atmo ? atmo.clone().lerp(new THREE.Color(1, 1, 1), air[0]).multiplyScalar(air[1]) : new THREE.Color(0.012, 0.014, 0.02);
    const top = atmo ? atmo.clone().multiplyScalar(0.32).lerp(new THREE.Color(0.02, 0.05, 0.14), 0.45) : new THREE.Color(0, 0, 0.002);
    this.sunDir = new THREE.Vector3(0.55, 0.6, 0.58).normalize();        // behind the ship at touchdown: lit slopes, no glare
    this.fog = new THREE.Fog(hor, this.extent * air[2], this.extent * 0.96);
    this.hemiSky = hor.clone(); this.hemiGround = pal[3].clone().multiplyScalar(0.35); this.hemiIntensity = atmo ? 0.85 : 0.3;
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: top }, uHor: { value: hor }, uSun: { value: this.sunDir }, uSunCol: { value: (sunColor || new THREE.Color(1, 0.95, 0.85)).clone() }, uStars: { value: atmo ? 0 : 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uHor, uSun, uSunCol; uniform float uStars; varying vec3 vDir;
        float sh(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d=normalize(vDir); float t=clamp(d.y,0.0,1.0);
          vec3 c=mix(uHor,uTop,pow(t,0.5));
          float s=max(dot(d,uSun),0.0);
          c+=uSunCol*(pow(s,1200.0)*8.0+pow(s,24.0)*0.35+pow(s,4.0)*0.06);
          if(uStars>0.5){ float st=step(0.9975,sh(floor(d*420.0))); c+=vec3(st)*smoothstep(0.0,0.25,d.y)*0.9; }
          gl_FragColor=vec4(c,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // props, generated per chunk around the ship and cached
    const pc = PROPS[spec.type];
    this.props = null;
    if (pc) {
      this.pc = pc; this.CH = 300; this.R = 2; this.cache = new Map(); this.chunkKey = '';
      const max = (this.R * 2 + 1) ** 2 * pc.per;
      const pm = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: pc.kind === 'spike' ? 0.25 : 0.85, metalness: 0 });
      if (pc.kind === 'shroom') { pm.emissive = pal[2].clone(); pm.emissiveIntensity = 0.5; }
      if (pc.kind === 'spike') { pm.emissive = pal[1].clone(); pm.emissiveIntensity = 0.12; }
      this.props = new THREE.InstancedMesh(propGeometry(pc.kind), pm, max);
      this.props.count = 0; this.props.frustumCulled = false;
      this.props.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(this.props);
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }
  groundAt(x, z) { return Math.max(this.heightAt(x, z), this.level); }
  onLiquid(x, z) { return !!this.liquid && this.heightAt(x, z) < this.level; }
  chunk(cx, cz) {
    const key = cx + ',' + cz;
    let list = this.cache.get(key);
    if (list) return list;
    list = [];
    const pc = this.pc, pal = this.spec.palette, CH = this.CH;
    const r = rng(hashU((Math.imul(cx | 0, 73856093) ^ Math.imul(cz | 0, 19349663) ^ Math.floor(this.spec.radius)) >>> 0));
    for (let i = 0; i < pc.per; i++) {
      const x = (cx + r()) * CH, z = (cz + r()) * CH, h = this.heightAt(x, z);
      const s = 0.6 + r() * r() * 1.4, yaw = r() * Math.PI * 2, tint = r();
      if (h < pc.lo || h > pc.hi || h < this.level + 2) continue;
      const gx = (this.heightAt(x + 4, z) - h) / 4, gz = (this.heightAt(x, z + 4) - h) / 4;
      if (1 - 1 / Math.sqrt(1 + gx * gx + gz * gz) > pc.slope) continue;
      const c = pal[pc.pal[0]].clone().lerp(pal[pc.pal[1]], tint * 0.6).lerp(pal[pc.pal[2]], tint * tint * 0.3).multiplyScalar(0.8 + r() * 0.45);
      list.push({ x, y: h - 0.5, z, s, yaw, c });
    }
    this.cache.set(key, list);
    return list;
  }
  fillProps(px, pz) {
    const cx0 = Math.floor(px / this.CH), cz0 = Math.floor(pz / this.CH), key = cx0 + ',' + cz0;
    if (key === this.chunkKey) return;
    this.chunkKey = key;
    let n = 0;
    const keep = new Set();
    for (let dz = -this.R; dz <= this.R; dz++) for (let dx = -this.R; dx <= this.R; dx++) {
      keep.add((cx0 + dx) + ',' + (cz0 + dz));
      for (const it of this.chunk(cx0 + dx, cz0 + dz)) {
        this._q.setFromAxisAngle(this._up, it.yaw);
        this._m.compose(this._p.set(it.x, it.y, it.z), this._q, this._s.setScalar(it.s));
        this.props.setMatrixAt(n, this._m); this.props.setColorAt(n, it.c); n++;
      }
    }
    for (const k of this.cache.keys()) if (!keep.has(k)) this.cache.delete(k);
    this.props.count = n;
    this.props.instanceMatrix.needsUpdate = true;
    if (this.props.instanceColor) this.props.instanceColor.needsUpdate = true;
  }
  update(dt, ship, cam) {
    const s = this.step;
    this.terrain.position.set(Math.round(ship.x / s) * s, 0, Math.round(ship.z / s) * s);
    if (this.liquidMesh) {
      this.liquidMesh.position.set(Math.round(ship.x / 100) * 100, this.level, Math.round(ship.z / 100) * 100);
      if (this.flow) { this.flow.offset.x += dt * (this.liquid === 'lava' ? 0.004 : 0.012); this.flow.offset.y += dt * (this.liquid === 'lava' ? 0.003 : 0.008); }
    }
    this.sky.position.copy(cam);
    if (this.props) this.fillProps(ship.x, ship.z);
  }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    for (const t of this.textures) t.dispose();
    if (this.props) this.props.dispose();
  }
}
