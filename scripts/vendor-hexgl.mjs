// Build step: copies the HexGL Feisar ship assets (MIT, Thibaut Despoulain) into public/assets/hexgl,
// pinned to one commit of github.com/BKcore/HexGL. If a download fails the build still passes and the
// game loads the same files from jsDelivr at runtime.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const SHA = '6addc95a2fce3bf05f4d751823cc054c61a16d68';
const FILES = [
  'LICENSE',
  'geometries/ships/feisar/feisar.js',
  'geometries/booster/booster.js',
  'textures.full/ships/feisar/diffuse.jpg',
  'textures.full/ships/feisar/specular.jpg',
  'textures.full/ships/feisar/normal.jpg',
  'textures.full/ships/feisar/booster/booster.png',
  'textures.full/ships/feisar/booster/boostersprite.jpg',
  'textures/ships/feisar/diffuse.jpg',
  'textures/ships/feisar/booster/booster.png',
];
const SOURCES = [
  (f) => `https://raw.githubusercontent.com/BKcore/HexGL/${SHA}/${f}`,
  (f) => `https://cdn.jsdelivr.net/gh/BKcore/HexGL@${SHA}/${f}`,
];
const OUT = path.join(process.cwd(), 'public', 'assets', 'hexgl');

let ok = 0;
for (const f of FILES) {
  const dest = path.join(OUT, f);
  try { if ((await stat(dest)).size > 0) { ok++; continue; } } catch { /* not there yet */ }
  for (const src of SOURCES) {
    try {
      const r = await fetch(src(f));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await r.arrayBuffer()));
      ok++;
      break;
    } catch (e) {
      console.warn(`vendor-hexgl: ${f} from ${src(f)} failed: ${e.message}`);
    }
  }
}
console.log(`vendor-hexgl: ${ok}/${FILES.length} HexGL files in public/assets/hexgl (commit ${SHA.slice(0, 7)})`);
