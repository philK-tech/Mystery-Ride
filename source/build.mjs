// Setzt source/template.html, source/style.css und source/src/*.js wieder zu ../index.html zusammen.
// Das Boot aus assets/boat.glb und assets/boat-texture.jpg wird dabei komprimiert eingebettet.
//   node build.mjs
// Keine Abhängigkeiten nötig, nur Node.js 18 oder neuer.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Die Reihenfolge ist wichtig: alles läuft in einer gemeinsamen Funktion, spätere Dateien nutzen frühere.
const FILES = ['setup.js', 'math.js', 'geometry.js', 'meshes.js', 'sdfmesh.js', 'shaders.js', 'world.js', 'renderer.js', 'boat.js', 'creatures.js', 'figures.js', 'audio.js', 'main.js'];

const read = (f) => readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n');
const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');
// erste Zeile jeder Datei ist nur ihr Kopfkommentar und landet nicht im Ergebnis
const body = (s) => s.replace(/^\/\/[^\n]*\n/, '').replace(/\n+$/, '');

// GLB lesen (ein Mesh mit POSITION, TEXCOORD_0 und Indizes) und kompakt verpacken:
// Kopf: bbox min/max (6 x float32), Anzahl Vertices und Indizes (2 x uint32),
// danach Positionen und UVs als uint16 (auf die bbox bzw. 0..1 normiert) und Indizes als uint16.
function packGlb(file) {
  const d = readFileSync(path.join(here, file));
  const jsonLen = d.readUInt32LE(12);
  const gltf = JSON.parse(d.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = 20 + jsonLen + 8;
  const prim = gltf.meshes[0].primitives[0];
  const acc = (i, Arr, n) => {
    const a = gltf.accessors[i], bv = gltf.bufferViews[a.bufferView];
    const off = bin + (bv.byteOffset || 0) + (a.byteOffset || 0);
    return new Arr(d.buffer.slice(d.byteOffset + off, d.byteOffset + off + a.count * n * Arr.BYTES_PER_ELEMENT));
  };
  const pos = acc(prim.attributes.POSITION, Float32Array, 3);
  const uv = acc(prim.attributes.TEXCOORD_0, Float32Array, 2);
  const idxAcc = gltf.accessors[prim.indices];
  const idx = acc(prim.indices, idxAcc.componentType === 5125 ? Uint32Array : Uint16Array, 1);
  const n = pos.length / 3;
  if (n > 65535) throw new Error('Boot-Modell hat zu viele Vertices für 16-Bit-Indizes');
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i * 3 + k]); mx[k] = Math.max(mx[k], pos[i * 3 + k]); }
  const out = Buffer.alloc(32 + n * 10 + idx.length * 2);
  for (let k = 0; k < 3; k++) { out.writeFloatLE(mn[k], k * 4); out.writeFloatLE(mx[k], 12 + k * 4); }
  out.writeUInt32LE(n, 24);
  out.writeUInt32LE(idx.length, 28);
  let o = 32;
  for (let i = 0; i < n * 3; i++, o += 2) { const k = i % 3; out.writeUInt16LE(Math.round(((pos[i] - mn[k]) / (mx[k] - mn[k] || 1)) * 65535), o); }
  for (let i = 0; i < n * 2; i++, o += 2) out.writeUInt16LE(Math.round(Math.min(Math.max(uv[i], 0), 1) * 65535), o);
  for (let i = 0; i < idx.length; i++, o += 2) out.writeUInt16LE(idx[i], o);
  return gzipSync(out, { level: 9 }).toString('base64');
}
const ASSETS = {
  'boat-mesh': () => packGlb('assets/boat.glb'),
  'boat-texture': () => readFileSync(path.join(here, 'assets/boat-texture.jpg')).toString('base64'),
  // gebackene Figuren aus tools/vigil-bake (Format VFG1), gzip-komprimiert eingebettet
  ...Object.fromEntries(['skeleton', 'cultist', 'wraith', 'boss', 'hellhound', 'hero'].map((n) =>
    ['fig-' + n, () => gzipSync(readFileSync(path.join(here, 'assets/figures/' + n + '.vfg')), { level: 9 }).toString('base64')]))
};

const js = FILES.map((f) => body(read(path.join('src', f))))
  .join('\n\n')
  .replace(/__ASSET__\("([\w-]+)"\)/g, (_, name) => JSON.stringify(ASSETS[name]()));
const css = read('style.css').replace(/\n+$/, '');
const html = read('template.html')
  .replace(/\n+$/, '')
  .replace('/*STYLE*/', () => indent(css, 4))
  .replace('/*SCRIPT*/', () => indent(js, 4));

writeFileSync(path.join(here, '..', 'index.html'), html);
console.log(`index.html: ${(html.length / 1024).toFixed(1)} kB`);
