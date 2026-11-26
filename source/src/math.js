// math.js: Mathe, Noise, Flussverlauf und Mat4
// --- Math & Noise Utilities ---
const LOOP_LENGTH = 480.0;

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3.0 - 2.0 * t);
}
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}
function fbm2(x, y, octaves = 4) {
  let val = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    val += amp * vnoise2(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return val / norm;
}

// Gewundener Fluss entlang -Z. Alle Frequenzen sind Vielfache von 2*PI/LOOP_LENGTH,
// dadurch schließt die Strecke nahtlos an ihren Anfang an.
const KZ = (Math.PI * 2.0) / LOOP_LENGTH;
function wrapZ(z) {
  return -((((-z) % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH);
}
function riverCenterX(z) {
  return Math.sin(z * KZ * 2.0) * 7.5 + Math.cos(z * KZ) * 4.2 + Math.sin(z * KZ * 3.0 + 1.3) * 1.6;
}
function riverSlopeX(z) {
  const eps = 0.5;
  return (riverCenterX(z + eps) - riverCenterX(z - eps)) / (2.0 * eps);
}
function riverHalfWidth(z) {
  return 7.2 + Math.sin(z * KZ * 4.0 + 1.1) * 1.6;
}
// fbm, die in z periodisch über die Schleifenlänge ist (Überblendung zweier Abtastungen)
function pnoise(x, z, scale, octaves) {
  z = wrapZ(z);
  const s = -z / LOOP_LENGTH;
  return lerp(fbm2(x * scale, z * scale, octaves), fbm2(x * scale, (z + LOOP_LENGTH) * scale, octaves), s);
}
// Drei Zonen hintereinander: 0 Nebeltal, 1 Pilzwald, 2 Himmelsinseln, je ein Drittel der Schleife.
// zoneWeights liefert für eine Stelle z die Anteile der drei Zonen (Summe 1), mit kurzen Übergängen.
const ZONE_FADE = 14.0; // halbe Länge eines Übergangs in Einheiten
function zoneWeights(z, out = [0, 0, 0]) {
  const u = (-wrapZ(z) / LOOP_LENGTH) * 3.0;
  const tw = (ZONE_FADE / LOOP_LENGTH) * 3.0;
  for (let k = 0; k < 3; k++) {
    let w = 0;
    for (const s of [-3, 0, 3]) w += smoothstep(k - tw, k + tw, u + s) - smoothstep(k + 1 - tw, k + 1 + tw, u + s);
    out[k] = clamp01(w);
  }
  const sum = out[0] + out[1] + out[2] || 1;
  out[0] /= sum; out[1] /= sum; out[2] /= sum;
  return out;
}

// Höhe des Bodens an (x, z), identisch mit dem Terrain-Mesh.
// Offene Landschaft: flaches Ufer, sanft gewellte Wiesen, Höhenzüge erst weit hinten.
// Je Zone unterschiedlich: Nebeltal mit flachen Stufen, Pilzwald fast eben, Himmelsinseln hügelig.
const _tw = [0, 0, 0];
const HERD_RIDGE = 95.0; // Abstand des Hügelkamms (Zone 3) von der Flussmitte
function terrainHeight(x, z) {
  const cx = riverCenterX(z);
  const hw = riverHalfWidth(z);
  const ax = Math.abs(x - cx);
  const d = Math.max(0.0, ax - hw);
  zoneWeights(z, _tw);
  const riverDip = -1.35 * (1.0 - smoothstep(0.0, hw * 1.12, ax));
  const lip = 0.7 * smoothstep(0.0, 3.0, d);
  const amp = _tw[0] * 3.0 + _tw[1] * 1.4 + _tw[2] * 4.0;
  let roll = (pnoise(x, z, 0.022, 3) - 0.42) * amp * smoothstep(3.0, 22.0, d);
  // Nebeltal: weiche Geländestufen
  const step = Math.floor(roll / 1.6) * 1.6;
  roll = lerp(roll, step + smoothstep(0.0, 1.6, roll - step) * 1.6, _tw[0] * 0.8);
  const far = smoothstep(80.0, 170.0, d) * (6.0 + 16.0 * pnoise(x, z, 0.012, 2));
  const fine = (pnoise(x, z, 0.16, 2) - 0.5) * 0.35 * smoothstep(0.5, 4.0, d);
  // Hügelkamm links in der offenen Ebene, auf dem die Herde zieht
  const ridgeC = x < cx ? _tw[2] * 10.0 * Math.exp(-Math.pow((ax - HERD_RIDGE) / 16.0, 2.0)) : 0.0;
  return riverDip + lip + Math.max(roll, -0.3) + far + fine + ridgeC;
}

// Mat4 helpers (column-major)
const Mat4 = {
  create() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  multiply(out, a, b) {
    const o = out === a || out === b ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4 + 0], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      o[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
      o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
      o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    if (out !== o) out.set(o);
    return out;
  },
  perspective(out, fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad * 0.5);
    const nf = 1.0 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1.0;
    out[14] = 2.0 * far * near * nf;
    return out;
  },
  lookAt(out, eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    out[0] = xx; out[4] = xy; out[8]  = xz; out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[1] = yx; out[5] = yy; out[9]  = yz; out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[2] = zx; out[6] = zy; out[10] = zz; out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[3] = 0;  out[7] = 0;  out[11] = 0;  out[15] = 1;
    return out;
  },
  compose(out, pos, rotY, rotX, rotZ, scale) {
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    const cx = Math.cos(rotX), sx = Math.sin(rotX);
    const cz = Math.cos(rotZ), sz = Math.sin(rotZ);

    // R = Ry * Rx * Rz
    const r00 = cy * cz + sy * sx * sz;
    const r01 = -cy * sz + sy * sx * cz;
    const r02 = sy * cx;

    const r10 = cx * sz;
    const r11 = cx * cz;
    const r12 = -sx;

    const r20 = -sy * cz + cy * sx * sz;
    const r21 = sy * sz + cy * sx * cz;
    const r22 = cy * cx;

    const sxS = scale[0], syS = scale[1], szS = scale[2];
    out[0] = r00 * sxS; out[4] = r01 * syS; out[8]  = r02 * szS; out[12] = pos[0];
    out[1] = r10 * sxS; out[5] = r11 * syS; out[9]  = r12 * szS; out[13] = pos[1];
    out[2] = r20 * sxS; out[6] = r21 * syS; out[10] = r22 * szS; out[14] = pos[2];
    out[3] = 0;         out[7] = 0;         out[11] = 0;         out[15] = 1;
    return out;
  }
};

// Das Schloss auf seinem Felsen am Ende des Nebelwalds
const CASTLE = (() => {
  const z = -150, side = 1;
  const x = riverCenterX(z) + side * (riverHalfWidth(z) + 19.0);
  const gy = terrainHeight(x, z);
  return { x, z, side, gy, rockH: 16.0, top: gy - 2.0 + 16.0 * 0.93 + 28.0 };
})();

// Richtung zum gelben Mond im Nebelwald: von der Anfahrt aus gesehen steht er genau hinter den Schlosstürmen.
// Wird in den Shader eingesetzt (SUN_A) und für die Lichtkegel verwendet.
const MOON_A = (() => {
  const vz = CASTLE.z + 58.0, vx = riverCenterX(vz);
  const v = [CASTLE.x - vx, CASTLE.top + 6.0 - 2.0, CASTLE.z - 40.0 - vz];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / l);
})();

// Sonnenrichtung auf der Ebene (wie SUN_C im Shader), für die Lichtstrahlen
const SUN_C_DIR = [0.45, 0.72, -0.53];
