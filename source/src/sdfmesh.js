// sdfmesh.js: organische Formen aus weich verschmolzenen Grundkörpern (Signed Distance Fields)
// Ein Körper wird als Abstandsfunktion beschrieben (negativ = innen). Grundkörper wie Kapseln und Ellipsoide
// werden mit smin weich verschmolzen, so entstehen nahtlose Übergänge (Technik nach Inigo Quilez).
// sdfMesh tastet die Funktion auf einem Gitter ab und baut daraus mit "Surface Nets" ein glattes Mesh.

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function sdCapsule(p, a, b, r) {
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = clamp01((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]));
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - r;
}
// Kapsel mit unterschiedlichen Radien an beiden Enden (verjüngt)
function sdTaper(p, a, b, ra, rb) {
  const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = clamp01((pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]));
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - lerp(ra, rb, h);
}
function sdEllipsoid(p, c, r) {
  const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]];
  const k0 = Math.hypot(q[0], q[1], q[2]);
  const k1 = Math.hypot(q[0] / r[0], q[1] / r[1], q[2] / r[2]);
  return k1 > 0 ? (k0 * (k0 - 1.0)) / k1 : -Math.min(r[0], r[1], r[2]);
}

// f(p) -> Abstand, vert(b, p, n) legt einen Vertex an (Material, UV und Extras wählt der Aufrufer)
function sdfMesh(f, min, max, step, vert) {
  const nx = Math.ceil((max[0] - min[0]) / step) + 1, ny = Math.ceil((max[1] - min[1]) / step) + 1, nz = Math.ceil((max[2] - min[2]) / step) + 1;
  const vals = new Float32Array(nx * ny * nz);
  const P = (i, j, k) => [min[0] + i * step, min[1] + j * step, min[2] + k * step];
  const id = (i, j, k) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[id(i, j, k)] = f(P(i, j, k));

  const b = createGeometryBuilder();
  const cellIdx = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const e = step * 0.5;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = corners.map(([a, c, d]) => vals[id(i + a, j + c, k + d)]);
    let neg = 0;
    for (const x of v) if (x < 0) neg++;
    if (neg === 0 || neg === 8) continue;
    // Mittelwert der Schnittpunkte auf den Zellkanten
    let px = 0, py = 0, pz = 0, n = 0;
    for (const [a, c] of edges) {
      if ((v[a] < 0) === (v[c] < 0)) continue;
      const t = v[a] / (v[a] - v[c]);
      const A = corners[a], C = corners[c];
      px += A[0] + (C[0] - A[0]) * t; py += A[1] + (C[1] - A[1]) * t; pz += A[2] + (C[2] - A[2]) * t;
      n++;
    }
    const p = [min[0] + (i + px / n) * step, min[1] + (j + py / n) * step, min[2] + (k + pz / n) * step];
    const g = [f([p[0] + e, p[1], p[2]]) - f([p[0] - e, p[1], p[2]]), f([p[0], p[1] + e, p[2]]) - f([p[0], p[1] - e, p[2]]), f([p[0], p[1], p[2] + e]) - f([p[0], p[1], p[2] - e])];
    const gl2 = Math.hypot(g[0], g[1], g[2]) || 1;
    cellIdx[cid(i, j, k)] = b.positions.length / 3;
    vert(b, p, [g[0] / gl2, g[1] / gl2, g[2] / gl2]);
  }
  // für jede Gitterkante mit Vorzeichenwechsel ein Viereck aus den vier angrenzenden Zellen
  const quad = (a, c, d, e2) => {
    if (a < 0 || c < 0 || d < 0 || e2 < 0) return;
    // Umlaufsinn so wählen, dass die Fläche nach außen zeigt (wie die Gradienten-Normalen)
    const pos = b.positions, nor = b.normals;
    const ux = pos[c * 3] - pos[a * 3], uy = pos[c * 3 + 1] - pos[a * 3 + 1], uz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[d * 3] - pos[a * 3], vy = pos[d * 3 + 1] - pos[a * 3 + 1], vz = pos[d * 3 + 2] - pos[a * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const dot = cx * (nor[a * 3] + nor[d * 3]) + cy * (nor[a * 3 + 1] + nor[d * 3 + 1]) + cz * (nor[a * 3 + 2] + nor[d * 3 + 2]);
    if (dot > 0) b.pushQuad(a, c, d, e2); else b.pushQuad(a, e2, d, c);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if ((vals[id(i, j, k)] < 0) === (vals[id(i + 1, j, k)] < 0)) continue;
    quad(cellIdx[cid(i, j - 1, k - 1)], cellIdx[cid(i, j, k - 1)], cellIdx[cid(i, j, k)], cellIdx[cid(i, j - 1, k)]);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    if ((vals[id(i, j, k)] < 0) === (vals[id(i, j + 1, k)] < 0)) continue;
    quad(cellIdx[cid(i - 1, j, k - 1)], cellIdx[cid(i, j, k - 1)], cellIdx[cid(i, j, k)], cellIdx[cid(i - 1, j, k)]);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    if ((vals[id(i, j, k)] < 0) === (vals[id(i, j, k + 1)] < 0)) continue;
    quad(cellIdx[cid(i - 1, j - 1, k)], cellIdx[cid(i, j - 1, k)], cellIdx[cid(i, j, k)], cellIdx[cid(i - 1, j, k)]);
  }
  return b;
}
