// procfig.js: prozedurale Glieder-Figuren für das Verlies
// Erweiterte Rigs (Bauch, Brust, Hals, Kiefer, Schlüsselbeine, Hände, Füße, getrennte Hundeschenkel),
// 2-Knochen-IK für Beine und Waffenarm (strikeAt), gedämpfte Federphysik für Umhang/Kiefer/Schwanz,
// zeitversetzte Gliedbewegung, Vertex-AO/Kantenaufhellung und Hüllkugel-Kollisionsprüfung.

const _PF_CACHE = Object.create(null);
const _PF_FIGS = [];
let _PF_FRAME = 0;

// Wiederverwendete temporäre Matrizen und Vektoren (keine Allokationen im Renderloop)
const _M_TMP = Mat4.create();
const _M_PARENT_TMP = Mat4.create();
const _V_TIP_WORLD = [0, 0, 0];
const _PF_POS = [0, 0, 0];
const _PF_ONE = [1, 1, 1];
const _V_HIP_W = [0, 0, 0];
const _V_ANKLE_W = [0, 0, 0];
const _V_SHOULDER_W = [0, 0, 0];
const _V_TARGET_L = [0, 0, 0];
const _V_SPHERE_W = [0, 0, 0];

function _pfMulMatVec(out, m, vx, vy, vz) {
  out[0] = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
  out[1] = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
  out[2] = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
  return out;
}

// --- Abstandsfunktionen ---
function _sdCapsule(p, a, b, r) {
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-8));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

function _sdTaper(p, a, b, ra, rb) {
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp01((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-8));
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - lerp(ra, rb, h);
}

function _sdEllipsoid(p, c, r) {
  const qx = (p[0] - c[0]) / r[0], qy = (p[1] - c[1]) / r[1], qz = (p[2] - c[2]) / r[2];
  return (Math.sqrt(qx * qx + qy * qy + qz * qz) - 1.0) * Math.min(r[0], r[1], r[2]);
}

function _sdBox(p, c, b) {
  const qx = Math.abs(p[0] - c[0]) - b[0];
  const qy = Math.abs(p[1] - c[1]) - b[1];
  const qz = Math.abs(p[2] - c[2]) - b[2];
  const ox = Math.max(qx, 0.0), oy = Math.max(qy, 0.0), oz = Math.max(qz, 0.0);
  return Math.min(Math.max(qx, Math.max(qy, qz)), 0.0) + Math.hypot(ox, oy, oz);
}

function _smin(a, b, k) {
  const h = clamp01(0.5 + 0.5 * (b - a) / (k + 1e-6));
  return lerp(b, a, h) - k * h * (1.0 - h);
}

function _smax(a, b, k) {
  return -_smin(-a, -b, k);
}

// Glied aus Abstandsfunktion mit Vertex-AO (Vertiefungen/Gelenke dunkler), Kantenaufhellung und Schmutz unten
function _buildLimbSdf(fn, minB, maxB, step, col, glow = 0.0, grain = 0.010, dirtY = -99.0) {
  const pOff = [0, 0, 0];
  return sdfMesh(fn, minB, maxB, step, (b, p, n) => {
    const nl = Math.hypot(n[0], n[1], n[2]) + 1e-8;
    const nx = n[0] / nl, ny = n[1] / nl, nz = n[2] / nl;

    // Pseudo-AO: Abstand zu einer leicht nach außen versetzten Hülle misst Konkavität/Spalten
    pOff[0] = p[0] + nx * 0.045;
    pOff[1] = p[1] + ny * 0.045;
    pOff[2] = p[2] + nz * 0.045;
    const dOut = fn(pOff);
    // dOut nahe 0.045 = flach/konvex; dOut < 0.035 = Vertiefung/Falte
    const cavity = clamp01((0.044 - dOut) / 0.032);
    // Gelenknähe (Ursprung bei 0,0,0) leicht abdunkeln
    const jointDist = Math.hypot(p[0], p[1], p[2]);
    const jointShade = clamp01(jointDist / 0.14);
    // Kantenaufhellung über Krümmung (dOut > 0.045)
    const edgeHi = clamp01((dOut - 0.045) / 0.015) * 0.16;

    const noise = grain > 0 ? (fbm2(p[0] * 16.0 + 3.1, p[1] * 16.0 + p[2] * 16.0, 2) - 0.5) * grain * 20.0 : 0.0;
    const shade = (1.0 - cavity * 0.34) * (0.84 + 0.16 * jointShade) + edgeHi + noise;

    let r = col[0] * shade;
    let g = col[1] * shade;
    let bl = col[2] * shade;

    // Schmutz/Abnutzung am unteren Rand
    if (p[1] < dirtY) {
      const dirt = clamp01((dirtY - p[1]) / 0.25) * 0.45;
      r = lerp(r, 0.14, dirt);
      g = lerp(g, 0.12, dirt);
      bl = lerp(bl, 0.10, dirt);
    }

    b.pushVertex(p[0], p[1], p[2], nx, ny, nz, glow, 0.0, clamp01(r), clamp01(g), clamp01(bl), 40);
  });
}

function _pfBox(b, c, size, rotY, rotZ, col, glow = 0.0) {
  const n0 = b.positions.length / 3;
  addBox(b, c, size, rotY, rotZ, 40, 0.0);
  const n1 = b.positions.length / 3;
  for (let i = n0; i < n1; i++) {
    b.uvs[i * 2] = glow;
    b.uvs[i * 2 + 1] = 0.0;
    b.extras[i * 3] = col[0];
    b.extras[i * 3 + 1] = col[1];
    b.extras[i * 3 + 2] = col[2];
  }
}

const _EYE_RED = [1.0, 0.35, 0.12];
const _EYE_GREEN = [0.45, 1.0, 0.5];
const _EMBER = [1.0, 0.38, 0.08];

// --- Gliederdefinitionen je Art (bis zu 22 Glieder, Gelenkkugel ragt in Elternglied) ---
function _makeLimbDefs(type) {
  if (type === "skeleton") {
    const bone = [0.76, 0.73, 0.64], darkBone = [0.54, 0.50, 0.43], blade = [0.42, 0.35, 0.30];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.90, 0], delay: 0.0, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.01, 0], [0.14, 0.08, 0.11]), _sdCapsule(p, [-0.11, 0.02, 0], [0.11, 0.02, 0], 0.048), 0.035),
        [-0.20, -0.11, -0.15], [0.20, 0.13, 0.15], 0.024, bone) },
      { id: "abdomen", parent: "pelvis", pivot: [0, 0.06, 0], delay: 0.015, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.055, 0.055]), _sdCapsule(p, [0, -0.02, -0.01], [0, 0.16, 0.01], 0.042), 0.02),
        [-0.09, -0.08, -0.09], [0.09, 0.20, 0.09], 0.022, darkBone) },
      { id: "chest", parent: "abdomen", pivot: [0, 0.15, 0.01], delay: 0.03, build: () => {
        const b = _buildLimbSdf((p) => {
          const jointBall = _sdEllipsoid(p, [0, 0, 0], [0.06, 0.06, 0.06]);
          const spine = _sdCapsule(p, [0, -0.02, -0.02], [0, 0.28, 0.03], 0.042);
          const rib1 = _sdEllipsoid(p, [0, 0.07, 0.02], [0.145, 0.032, 0.105]);
          const rib2 = _sdEllipsoid(p, [0, 0.15, 0.03], [0.165, 0.036, 0.12]);
          const rib3 = _sdEllipsoid(p, [0, 0.23, 0.03], [0.15, 0.034, 0.11]);
          const ribs = _smin(_smin(rib1, rib2, 0.022), rib3, 0.022);
          return _smin(jointBall, _smin(spine, ribs, 0.035), 0.02);
        }, [-0.21, -0.08, -0.13], [0.21, 0.33, 0.18], 0.024, bone);
        return b;
      } },
      { id: "neck", parent: "chest", pivot: [0, 0.27, 0.03], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _sdCapsule(p, [0, -0.02, 0], [0, 0.09, 0.01], 0.032), 0.018),
        [-0.07, -0.06, -0.07], [0.07, 0.12, 0.07], 0.020, darkBone) },
      { id: "head", parent: "neck", pivot: [0, 0.08, 0.01], delay: 0.06, build: () => {
        const b = _buildLimbSdf((p) => {
          const cranium = _sdEllipsoid(p, [0, 0.09, 0.01], [0.105, 0.11, 0.118]);
          const cheeks = _sdEllipsoid(p, [0, 0.03, 0.065], [0.082, 0.035, 0.06]);
          const skull = _smin(cranium, cheeks, 0.025);
          // Augenhöhlen aussparen
          const eyeL = _sdEllipsoid(p, [0.042, 0.085, 0.11], [0.028, 0.026, 0.035]);
          const eyeR = _sdEllipsoid(p, [-0.042, 0.085, 0.11], [0.028, 0.026, 0.035]);
          return _smax(_smax(skull, -eyeL, 0.012), -eyeR, 0.012);
        }, [-0.14, -0.04, -0.12], [0.14, 0.22, 0.16], 0.020, bone);
        _pfBox(b, [-0.042, 0.085, 0.095], [0.026, 0.022, 0.02], 0, 0, _EYE_RED, 1.0);
        _pfBox(b, [ 0.042, 0.085, 0.095], [0.026, 0.022, 0.02], 0, 0, _EYE_RED, 1.0);
        return b;
      } },
      { id: "jaw", parent: "head", pivot: [0, 0.02, 0.02], sway: "jaw", delay: 0.07, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.03, 0.05]), _sdTaper(p, [0, -0.01, 0.01], [0, -0.025, 0.085], 0.052, 0.032), 0.02),
        [-0.08, -0.06, -0.05], [0.08, 0.04, 0.12], 0.018, darkBone) },
      { id: "clavicleL", parent: "chest", pivot: [0.04, 0.24, 0.02], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _sdCapsule(p, [0, 0, 0], [0.15, -0.01, 0], 0.028), 0.018),
        [-0.06, -0.06, -0.06], [0.20, 0.06, 0.06], 0.020, bone) },
      { id: "armL", parent: "clavicleL", pivot: [0.15, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.048, 0.048, 0.048]), _sdCapsule(p, [0, 0, 0], [0.04, -0.27, 0.01], 0.034), 0.02),
        [-0.07, -0.32, -0.07], [0.11, 0.07, 0.08], 0.020, darkBone) },
      { id: "forearmL", parent: "armL", pivot: [0.04, -0.27, 0.01], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.042, 0.042, 0.042]), _sdCapsule(p, [0, 0, 0], [0.02, -0.24, 0.06], 0.030), 0.018),
        [-0.07, -0.29, -0.06], [0.09, 0.07, 0.12], 0.020, bone) },
      { id: "handL", parent: "forearmL", pivot: [0.02, -0.24, 0.06], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.034, 0.034, 0.034]), _sdEllipsoid(p, [0, -0.04, 0.04], [0.032, 0.024, 0.055]), 0.016),
        [-0.06, -0.08, -0.05], [0.06, 0.05, 0.11], 0.018, darkBone) },
      { id: "clavicleR", parent: "chest", pivot: [-0.04, 0.24, 0.02], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _sdCapsule(p, [0, 0, 0], [-0.15, -0.01, 0], 0.028), 0.018),
        [-0.20, -0.06, -0.06], [0.06, 0.06, 0.06], 0.020, bone) },
      { id: "armR", parent: "clavicleR", pivot: [-0.15, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.048, 0.048, 0.048]), _sdCapsule(p, [0, 0, 0], [-0.04, -0.27, 0.01], 0.034), 0.02),
        [-0.11, -0.32, -0.07], [0.07, 0.07, 0.08], 0.020, darkBone) },
      { id: "forearmR", parent: "armR", pivot: [-0.04, -0.27, 0.01], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.042, 0.042, 0.042]), _sdCapsule(p, [0, 0, 0], [-0.02, -0.24, 0.06], 0.030), 0.018),
        [-0.09, -0.29, -0.06], [0.07, 0.07, 0.12], 0.020, bone) },
      { id: "handR", parent: "forearmR", pivot: [-0.02, -0.24, 0.06], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.034, 0.034, 0.034]), _sdEllipsoid(p, [0, -0.03, 0.03], [0.032, 0.026, 0.05]), 0.016),
        [-0.06, -0.07, -0.05], [0.06, 0.05, 0.10], 0.018, darkBone) },
      { id: "bladeR", parent: "handR", pivot: [0, -0.03, 0.04], tip: [0, 0, 0.78], delay: 0.10, build: () => {
        const b = _buildLimbSdf((p) => _sdCapsule(p, [0, 0, -0.06], [0, 0, 0.12], 0.026), [-0.06, -0.06, -0.10], [0.06, 0.06, 0.16], 0.022, darkBone);
        _pfBox(b, [0, 0, 0.12], [0.16, 0.025, 0.03], 0, 0, darkBone);
        _pfBox(b, [0, 0, 0.45], [0.05, 0.015, 0.66], 0, 0, blade);
        return b;
      } },
      { id: "thighL", parent: "pelvis", pivot: [0.10, -0.03, 0], delay: 0.01, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.052, 0.052, 0.052]), _sdCapsule(p, [0, 0, 0], [0.01, -0.41, 0.01], 0.040), 0.022),
        [-0.08, -0.46, -0.08], [0.09, 0.08, 0.08], 0.024, bone) },
      { id: "shinL", parent: "thighL", pivot: [0.01, -0.41, 0.01], delay: 0.025, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.046, 0.046, 0.046]), _sdCapsule(p, [0, 0, 0], [0, -0.39, -0.01], 0.034), 0.02),
        [-0.07, -0.44, -0.07], [0.07, 0.07, 0.07], 0.024, darkBone) },
      { id: "footL", parent: "shinL", pivot: [0, -0.39, -0.01], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.040, 0.038, 0.042]), _sdEllipsoid(p, [0, -0.03, 0.06], [0.044, 0.026, 0.095]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.17], 0.022, bone) },
      { id: "thighR", parent: "pelvis", pivot: [-0.10, -0.03, 0], delay: 0.01, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.052, 0.052, 0.052]), _sdCapsule(p, [0, 0, 0], [-0.01, -0.41, 0.01], 0.040), 0.022),
        [-0.09, -0.46, -0.08], [0.08, 0.08, 0.08], 0.024, bone) },
      { id: "shinR", parent: "thighR", pivot: [-0.01, -0.41, 0.01], delay: 0.025, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.046, 0.046, 0.046]), _sdCapsule(p, [0, 0, 0], [0, -0.39, -0.01], 0.034), 0.02),
        [-0.07, -0.44, -0.07], [0.07, 0.07, 0.07], 0.024, darkBone) },
      { id: "footR", parent: "shinR", pivot: [0, -0.39, -0.01], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.040, 0.038, 0.042]), _sdEllipsoid(p, [0, -0.03, 0.06], [0.044, 0.026, 0.095]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.17], 0.022, bone) }
    ];
  }

  if (type === "cultist") {
    const robe = [0.22, 0.20, 0.27], robeDark = [0.15, 0.14, 0.19], handCol = [0.58, 0.53, 0.47];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.88, 0], delay: 0.0, build: () => _buildLimbSdf(
        (p) => {
          const base = _sdTaper(p, [0, 0.08, 0], [0, -0.82, 0], 0.17, 0.30);
          const ang = Math.atan2(p[0], p[2] + 1e-5);
          const folds = Math.sin(ang * 9.0 + p[1] * 2.5) * 0.016 * clamp01(-p[1] / 0.6);
          return base + folds;
        }, [-0.35, -0.86, -0.34], [0.35, 0.14, 0.34], 0.028, robeDark, 0.0, 0.012, -0.58) },
      { id: "cape", parent: "pelvis", pivot: [0, 0.40, -0.14], sway: "cape", delay: 0.06, build: () => _buildLimbSdf(
        (p) => {
          const base = _sdTaper(p, [0, 0.02, 0], [0, -1.08, -0.10], 0.20, 0.35);
          const folds = Math.sin(p[0] * 24.0) * 0.014;
          return base + folds;
        }, [-0.40, -1.14, -0.32], [0.40, 0.08, 0.14], 0.030, robe, 0.0, 0.012, -0.85) },
      { id: "abdomen", parent: "pelvis", pivot: [0, 0.05, 0], delay: 0.015, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.16, 0.12, 0.13]), _sdEllipsoid(p, [0, 0.12, 0], [0.17, 0.12, 0.135]), 0.04),
        [-0.22, -0.10, -0.18], [0.22, 0.24, 0.18], 0.026, robeDark) },
      { id: "chest", parent: "abdomen", pivot: [0, 0.16, 0], delay: 0.03, build: () => _buildLimbSdf(
        (p) => {
          const torso = _smin(_sdEllipsoid(p, [0, 0.12, 0.01], [0.19, 0.20, 0.15]), _sdEllipsoid(p, [0, 0.26, -0.02], [0.18, 0.10, 0.15]), 0.045);
          const folds = Math.sin(p[0] * 26.0) * 0.008;
          return torso + folds;
        }, [-0.25, -0.08, -0.19], [0.25, 0.38, 0.19], 0.025, robe) },
      { id: "neck", parent: "chest", pivot: [0, 0.27, 0.01], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0, 0.03, 0], [0.09, 0.08, 0.09]), [-0.12, -0.06, -0.12], [0.12, 0.12, 0.12], 0.022, robeDark) },
      { id: "head", parent: "neck", pivot: [0, 0.07, 0.01], delay: 0.06, build: () => {
        const b = _buildLimbSdf((p) => _smax(
          _smin(_sdEllipsoid(p, [0, 0.11, -0.01], [0.145, 0.165, 0.16]), _sdEllipsoid(p, [0, 0.03, 0.06], [0.115, 0.085, 0.115]), 0.035),
          -_sdEllipsoid(p, [0, 0.09, 0.13], [0.078, 0.088, 0.075]), 0.02),
          [-0.18, -0.06, -0.18], [0.18, 0.29, 0.18], 0.023, robeDark);
        _pfBox(b, [-0.03, 0.095, 0.085], [0.022, 0.012, 0.01], 0, 0, _EYE_GREEN, 1.0);
        _pfBox(b, [ 0.03, 0.095, 0.085], [0.022, 0.012, 0.01], 0, 0, _EYE_GREEN, 1.0);
        return b;
      } },
      { id: "clavicleL", parent: "chest", pivot: [0.05, 0.23, 0], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0.08, 0, 0], [0.11, 0.075, 0.08]), [-0.06, -0.09, -0.10], [0.20, 0.09, 0.10], 0.024, robe) },
      { id: "armL", parent: "clavicleL", pivot: [0.15, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.08, 0.08, 0.08]), _sdTaper(p, [0, 0, 0], [0.05, -0.27, 0.03], 0.078, 0.085), 0.025),
        [-0.09, -0.34, -0.11], [0.15, 0.10, 0.14], 0.024, robe) },
      { id: "forearmL", parent: "armL", pivot: [0.05, -0.27, 0.03], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.078, 0.078, 0.078]), _sdTaper(p, [0, 0, 0], [0.02, -0.21, 0.08], 0.082, 0.095), 0.025),
        [-0.10, -0.28, -0.09], [0.12, 0.10, 0.18], 0.023, robeDark) },
      { id: "handL", parent: "forearmL", pivot: [0.02, -0.21, 0.08], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.04, 0.04, 0.04]), _sdEllipsoid(p, [0, -0.03, 0.04], [0.042, 0.028, 0.06]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.12], 0.020, handCol) },
      { id: "clavicleR", parent: "chest", pivot: [-0.05, 0.23, 0], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [-0.08, 0, 0], [0.11, 0.075, 0.08]), [-0.20, -0.09, -0.10], [0.06, 0.09, 0.10], 0.024, robe) },
      { id: "armR", parent: "clavicleR", pivot: [-0.15, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.08, 0.08, 0.08]), _sdTaper(p, [0, 0, 0], [-0.05, -0.27, 0.03], 0.078, 0.085), 0.025),
        [-0.15, -0.34, -0.11], [0.09, 0.10, 0.14], 0.024, robe) },
      { id: "forearmR", parent: "armR", pivot: [-0.05, -0.27, 0.03], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.078, 0.078, 0.078]), _sdTaper(p, [0, 0, 0], [-0.02, -0.21, 0.08], 0.082, 0.095), 0.025),
        [-0.12, -0.28, -0.09], [0.10, 0.10, 0.18], 0.023, robeDark) },
      { id: "handR", parent: "forearmR", pivot: [-0.02, -0.21, 0.08], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.04, 0.04, 0.04]), _sdEllipsoid(p, [0, -0.03, 0.04], [0.042, 0.028, 0.06]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.12], 0.020, handCol) }
    ];
  }

  if (type === "wraith") {
    const shroud = [0.20, 0.28, 0.38], clawCol = [0.46, 0.62, 0.76];
    const strip = (sx, sz0, sz1, r0, r1, key) => ({
      id: key, parent: "core", pivot: [sx, 0.18, sz0], sway: key, delay: 0.08, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.07, 0.07, 0.07]), _sdTaper(p, [0, 0, 0], [sx * 0.35, -0.78, sz1 - sz0], r0, r1) + Math.sin(p[1] * 14.0) * 0.012, 0.03),
        [-0.24, -0.84, -0.68], [0.24, 0.12, 0.16], 0.028, shroud)
    });
    return [
      { id: "core", parent: null, pivot: [0, 0.95, 0], delay: 0.0, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.05, 0], [0.16, 0.20, 0.13]), _sdTaper(p, [0, 0.0, 0], [0, -0.36, -0.05], 0.15, 0.07), 0.05),
        [-0.22, -0.42, -0.18], [0.22, 0.28, 0.18], 0.026, shroud) },
      { id: "chest", parent: "core", pivot: [0, 0.16, 0], delay: 0.025, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.10, 0.01], [0.18, 0.18, 0.14]), _sdEllipsoid(p, [0, 0, 0], [0.14, 0.12, 0.12]), 0.04),
        [-0.24, -0.12, -0.18], [0.24, 0.30, 0.18], 0.025, shroud) },
      { id: "neck", parent: "chest", pivot: [0, 0.22, 0.02], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0, 0.03, 0], [0.08, 0.08, 0.08]), [-0.11, -0.06, -0.11], [0.11, 0.12, 0.11], 0.022, shroud) },
      { id: "head", parent: "neck", pivot: [0, 0.06, 0.01], delay: 0.055, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.10, 0.02], [0.11, 0.13, 0.12]), _sdTaper(p, [0, 0.20, -0.02], [0, 0.28, -0.12], 0.07, 0.015), 0.04),
          [-0.15, -0.05, -0.17], [0.15, 0.32, 0.15], 0.023, shroud);
        _pfBox(b, [-0.04, 0.11, 0.125], [0.03, 0.016, 0.012], 0, 0, [0.55, 0.85, 1.0], 1.0);
        _pfBox(b, [ 0.04, 0.11, 0.125], [0.03, 0.016, 0.012], 0, 0, [0.55, 0.85, 1.0], 1.0);
        return b;
      } },
      { id: "armL", parent: "chest", pivot: [0.19, 0.16, 0.02], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.065, 0.065, 0.065]), _sdTaper(p, [0, 0, 0], [0.10, -0.08, 0.20], 0.06, 0.042), 0.025),
        [-0.08, -0.16, -0.08], [0.18, 0.09, 0.26], 0.024, shroud) },
      { id: "handL", parent: "armL", pivot: [0.10, -0.08, 0.20], delay: 0.07, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _sdTaper(p, [0, 0, 0], [0.04, -0.04, 0.14], 0.04, 0.015), 0.02),
        [-0.06, -0.10, -0.06], [0.10, 0.06, 0.18], 0.020, clawCol, 0.2) },
      { id: "armR", parent: "chest", pivot: [-0.19, 0.16, 0.02], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.065, 0.065, 0.065]), _sdTaper(p, [0, 0, 0], [-0.10, -0.08, 0.20], 0.06, 0.042), 0.025),
        [-0.18, -0.16, -0.08], [0.08, 0.09, 0.26], 0.024, shroud) },
      { id: "handR", parent: "armR", pivot: [-0.10, -0.08, 0.20], delay: 0.07, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _sdTaper(p, [0, 0, 0], [-0.04, -0.04, 0.14], 0.04, 0.015), 0.02),
        [-0.10, -0.10, -0.06], [0.06, 0.06, 0.18], 0.020, clawCol, 0.2) },
      strip(-0.11, -0.08, -0.52, 0.085, 0.035, "mantle1"),
      strip( 0.11, -0.08, -0.52, 0.085, 0.035, "mantle2"),
      strip(-0.04, -0.10, -0.60, 0.095, 0.040, "mantle3"),
      strip( 0.04, -0.10, -0.60, 0.095, 0.040, "mantle4")
    ];
  }

  if (type === "hero") {
    const steel = [0.54, 0.57, 0.62], darkSteel = [0.28, 0.30, 0.35], capeCol = [0.46, 0.15, 0.16], bladeCol = [0.80, 0.83, 0.88], gold = [0.72, 0.58, 0.28];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.92, 0], delay: 0.0, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.175, 0.095, 0.135]), _sdCapsule(p, [-0.15, 0.01, 0], [0.15, 0.01, 0], 0.062), 0.035),
          [-0.24, -0.12, -0.18], [0.24, 0.12, 0.18], 0.025, darkSteel);
        _pfBox(b, [0, 0.04, 0.13], [0.09, 0.065, 0.03], 0, 0, gold);
        return b;
      } },
      { id: "cape", parent: "pelvis", pivot: [0, 0.42, -0.14], sway: "cape", delay: 0.06, build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0, -1.08, -0.12], 0.20, 0.33) + Math.sin(p[0] * 22.0) * 0.012,
        [-0.38, -1.14, -0.30], [0.38, 0.08, 0.14], 0.030, capeCol, 0.0, 0.012, -0.85) },
      { id: "abdomen", parent: "pelvis", pivot: [0, 0.06, 0], delay: 0.015, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.16, 0.11, 0.125]), _sdEllipsoid(p, [0, 0.10, 0.01], [0.175, 0.11, 0.13]), 0.04),
        [-0.22, -0.09, -0.17], [0.22, 0.22, 0.17], 0.025, darkSteel) },
      { id: "chest", parent: "abdomen", pivot: [0, 0.16, 0], delay: 0.03, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.14, 0.01], [0.215, 0.21, 0.155]), _sdEllipsoid(p, [0, 0.24, 0.05], [0.17, 0.13, 0.13]), 0.045),
          [-0.27, -0.08, -0.18], [0.27, 0.38, 0.22], 0.025, steel);
        _pfBox(b, [0, 0.15, 0.145], [0.26, 0.24, 0.05], 0, 0, steel);
        _pfBox(b, [0, 0.16, 0.172], [0.04, 0.18, 0.02], 0, 0, gold);
        _pfBox(b, [0, 0.20, 0.172], [0.14, 0.035, 0.02], 0, 0, gold);
        return b;
      } },
      { id: "neck", parent: "chest", pivot: [0, 0.30, 0.01], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0, 0.03, 0], [0.075, 0.075, 0.075]), [-0.10, -0.06, -0.10], [0.10, 0.11, 0.10], 0.022, darkSteel) },
      { id: "head", parent: "neck", pivot: [0, 0.07, 0.01], delay: 0.06, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.10, 0.01], [0.12, 0.13, 0.13]), _sdTaper(p, [0, 0.04, 0.04], [0, -0.04, 0.06], 0.10, 0.07), 0.03),
          [-0.16, -0.08, -0.14], [0.16, 0.25, 0.18], 0.022, steel);
        _pfBox(b, [0, 0.10, 0.135], [0.14, 0.024, 0.04], 0, 0, [0.02, 0.02, 0.025]);
        _pfBox(b, [0, 0.19, 0.0], [0.03, 0.09, 0.18], 0, 0, gold);
        return b;
      } },
      { id: "clavicleL", parent: "chest", pivot: [0.06, 0.26, 0], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0.10, 0, 0], [0.13, 0.085, 0.095]), [-0.06, -0.10, -0.11], [0.24, 0.10, 0.11], 0.024, steel) },
      { id: "armL", parent: "clavicleL", pivot: [0.17, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0.01, 0.0, 0], [0.085, 0.078, 0.085]), _sdCapsule(p, [0.01, 0, 0], [0.05, -0.27, 0.02], 0.056), 0.03),
        [-0.09, -0.34, -0.10], [0.15, 0.10, 0.11], 0.023, steel) },
      { id: "forearmL", parent: "armL", pivot: [0.05, -0.27, 0.02], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.055, 0.055]), _sdCapsule(p, [0, 0, 0], [0.02, -0.24, 0.06], 0.048), 0.022),
        [-0.08, -0.30, -0.07], [0.10, 0.08, 0.14], 0.023, darkSteel) },
      { id: "handL", parent: "forearmL", pivot: [0.02, -0.24, 0.06], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.042, 0.042, 0.042]), _sdEllipsoid(p, [0, -0.03, 0.03], [0.042, 0.03, 0.055]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.11], 0.020, steel) },
      { id: "clavicleR", parent: "chest", pivot: [-0.06, 0.26, 0], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [-0.10, 0, 0], [0.13, 0.085, 0.095]), [-0.24, -0.10, -0.11], [0.06, 0.10, 0.11], 0.024, steel) },
      { id: "armR", parent: "clavicleR", pivot: [-0.17, -0.01, 0], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [-0.01, 0.0, 0], [0.085, 0.078, 0.085]), _sdCapsule(p, [-0.01, 0, 0], [-0.05, -0.27, 0.02], 0.056), 0.03),
        [-0.15, -0.34, -0.10], [0.09, 0.10, 0.11], 0.023, steel) },
      { id: "forearmR", parent: "armR", pivot: [-0.05, -0.27, 0.02], delay: 0.075, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.055, 0.055]), _sdCapsule(p, [0, 0, 0], [-0.02, -0.24, 0.06], 0.048), 0.022),
        [-0.10, -0.30, -0.07], [0.08, 0.08, 0.14], 0.023, darkSteel) },
      { id: "handR", parent: "forearmR", pivot: [-0.02, -0.24, 0.06], delay: 0.09, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.042, 0.042, 0.042]), _sdEllipsoid(p, [0, -0.03, 0.03], [0.042, 0.03, 0.055]), 0.018),
        [-0.07, -0.07, -0.06], [0.07, 0.06, 0.11], 0.020, steel) },
      { id: "swordR", parent: "handR", pivot: [0, -0.03, 0.04], tip: [0, 0, 1.18], delay: 0.10, build: () => {
        const b = _buildLimbSdf((p) => _sdCapsule(p, [0, 0, -0.06], [0, 0, 0.14], 0.026), [-0.08, -0.08, -0.12], [0.08, 0.08, 0.20], 0.024, darkSteel);
        _pfBox(b, [0, 0, 0.15], [0.24, 0.035, 0.04], 0, 0, gold);
        _pfBox(b, [0, 0, 0.67], [0.055, 0.016, 1.02], 0, 0, bladeCol);
        return b;
      } },
      { id: "thighL", parent: "pelvis", pivot: [0.11, -0.03, 0], delay: 0.01, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.078, 0.078, 0.078]), _sdCapsule(p, [0, 0, 0], [0.01, -0.43, 0.01], 0.070), 0.025),
        [-0.10, -0.50, -0.10], [0.11, 0.10, 0.10], 0.026, darkSteel) },
      { id: "shinL", parent: "thighL", pivot: [0.01, -0.43, 0.01], delay: 0.025, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.068, 0.068, 0.068]), _sdCapsule(p, [0, 0, 0], [0, -0.41, -0.01], 0.060), 0.022),
        [-0.09, -0.48, -0.09], [0.09, 0.09, 0.09], 0.026, steel) },
      { id: "footL", parent: "shinL", pivot: [0, -0.41, -0.01], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.058, 0.055, 0.06]), _sdEllipsoid(p, [0, -0.03, 0.06], [0.062, 0.042, 0.125]), 0.022),
        [-0.09, -0.09, -0.08], [0.09, 0.08, 0.21], 0.024, darkSteel) },
      { id: "thighR", parent: "pelvis", pivot: [-0.11, -0.03, 0], delay: 0.01, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.078, 0.078, 0.078]), _sdCapsule(p, [0, 0, 0], [-0.01, -0.43, 0.01], 0.070), 0.025),
        [-0.11, -0.50, -0.10], [0.10, 0.10, 0.10], 0.026, darkSteel) },
      { id: "shinR", parent: "thighR", pivot: [-0.01, -0.43, 0.01], delay: 0.025, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.068, 0.068, 0.068]), _sdCapsule(p, [0, 0, 0], [0, -0.41, -0.01], 0.060), 0.022),
        [-0.09, -0.48, -0.09], [0.09, 0.09, 0.09], 0.026, steel) },
      { id: "footR", parent: "shinR", pivot: [0, -0.41, -0.01], delay: 0.04, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.058, 0.055, 0.06]), _sdEllipsoid(p, [0, -0.03, 0.06], [0.062, 0.042, 0.125]), 0.022),
        [-0.09, -0.09, -0.08], [0.09, 0.08, 0.21], 0.024, darkSteel) }
    ];
  }

  if (type === "boss") {
    const brute = [0.26, 0.22, 0.24], plateCol = [0.36, 0.32, 0.34], hornCol = [0.65, 0.56, 0.44], clubCol = [0.34, 0.28, 0.24];
    return [
      { id: "pelvis", parent: null, pivot: [0, 1.52, 0], delay: 0.0, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.46, 0.24, 0.36]), _sdBox(p, [0, -0.06, 0.28], [0.22, 0.18, 0.10]), 0.06),
        [-0.54, -0.32, -0.44], [0.54, 0.32, 0.46], 0.036, brute) },
      { id: "abdomen", parent: "pelvis", pivot: [0, 0.15, 0.02], delay: 0.02, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.10, 0.02], [0.48, 0.30, 0.38]), _sdBox(p, [0, 0.12, 0.34], [0.28, 0.22, 0.08]), 0.05),
        [-0.56, -0.22, -0.42], [0.56, 0.44, 0.48], 0.036, brute) },
      { id: "chest", parent: "abdomen", pivot: [0, 0.34, 0.02], delay: 0.04, build: () => {
        const b = _buildLimbSdf((p) => {
          const core = _sdEllipsoid(p, [0, 0.34, 0.03], [0.66, 0.52, 0.46]);
          const plateL = _sdBox(p, [0.32, 0.38, 0.38], [0.22, 0.26, 0.10]);
          const plateR = _sdBox(p, [-0.32, 0.38, 0.38], [0.22, 0.26, 0.10]);
          const backPlate = _sdBox(p, [0, 0.38, -0.38], [0.44, 0.32, 0.10]);
          return _smin(_smin(core, plateL, 0.06), _smin(plateR, backPlate, 0.06), 0.06);
        }, [-0.76, -0.22, -0.52], [0.76, 0.96, 0.56], 0.036, brute);
        _pfBox(b, [0, 0.38, 0.46], [0.08, 0.40, 0.06], 0, 0.12, _EMBER, 1.0);
        _pfBox(b, [0.16, 0.46, 0.44], [0.22, 0.06, 0.06], 0, -0.25, _EMBER, 1.0);
        _pfBox(b, [-0.14, 0.24, 0.45], [0.18, 0.05, 0.06], 0, 0.35, _EMBER, 1.0);
        return b;
      } },
      { id: "neck", parent: "chest", pivot: [0, 0.78, 0.10], delay: 0.055, build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0, 0.06, 0.02], [0.26, 0.18, 0.26]), [-0.32, -0.14, -0.30], [0.32, 0.26, 0.32], 0.034, brute) },
      { id: "head", parent: "neck", pivot: [0, 0.14, 0.04], delay: 0.07, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.18, 0.05], [0.27, 0.24, 0.30]), _sdBox(p, [0, 0.26, 0.26], [0.24, 0.08, 0.12]), 0.04),
          [-0.36, -0.10, -0.30], [0.36, 0.50, 0.42], 0.032, brute);
        _pfBox(b, [ 0.36, 0.42, -0.06], [0.34, 0.10, 0.10], 0,  0.52, hornCol);
        _pfBox(b, [-0.36, 0.42, -0.06], [0.34, 0.10, 0.10], 0, -0.52, hornCol);
        _pfBox(b, [-0.10, 0.21, 0.34], [0.07, 0.035, 0.03], 0, 0, _EMBER, 1.0);
        _pfBox(b, [ 0.10, 0.21, 0.34], [0.07, 0.035, 0.03], 0, 0, _EMBER, 1.0);
        return b;
      } },
      { id: "jaw", parent: "head", pivot: [0, 0.05, 0.06], sway: "jaw", delay: 0.08, build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0, 0.04], [0.20, 0.09, 0.20]), _sdBox(p, [0, -0.03, 0.18], [0.16, 0.06, 0.10]), 0.03),
          [-0.26, -0.12, -0.18], [0.26, 0.12, 0.32], 0.030, plateCol);
        _pfBox(b, [-0.11, 0.06, 0.24], [0.04, 0.10, 0.04], 0, -0.15, hornCol);
        _pfBox(b, [ 0.11, 0.06, 0.24], [0.04, 0.10, 0.04], 0,  0.15, hornCol);
        return b;
      } },
      { id: "clavicleL", parent: "chest", pivot: [0.22, 0.62, 0.04], delay: 0.05, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0.24, 0.04, 0], [0.34, 0.24, 0.28]), _sdBox(p, [0.34, 0.16, 0], [0.24, 0.12, 0.26]), 0.05),
        [-0.14, -0.22, -0.32], [0.64, 0.34, 0.32], 0.035, plateCol) },
      { id: "armL", parent: "clavicleL", pivot: [0.42, -0.02, 0], delay: 0.065, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.24, 0.24, 0.24]), _sdTaper(p, [0, 0, 0], [0.14, -0.74, 0.06], 0.23, 0.18), 0.04),
        [-0.26, -0.96, -0.26], [0.40, 0.26, 0.32], 0.035, brute) },
      { id: "forearmL", parent: "armL", pivot: [0.14, -0.74, 0.06], delay: 0.085, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.19, 0.19, 0.19]), _sdTaper(p, [0, 0, 0], [0.04, -0.60, 0.20], 0.18, 0.15), 0.035),
        [-0.20, -0.76, -0.20], [0.24, 0.20, 0.40], 0.035, plateCol) },
      { id: "handL", parent: "forearmL", pivot: [0.04, -0.60, 0.20], delay: 0.10, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.15, 0.15, 0.15]), _sdEllipsoid(p, [0, -0.08, 0.08], [0.15, 0.12, 0.16]), 0.03),
        [-0.18, -0.22, -0.16], [0.18, 0.16, 0.26], 0.032, brute) },
      { id: "clavicleR", parent: "chest", pivot: [-0.22, 0.62, 0.04], delay: 0.05, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [-0.24, 0.04, 0], [0.34, 0.24, 0.28]), _sdBox(p, [-0.34, 0.16, 0], [0.24, 0.12, 0.26]), 0.05),
        [-0.64, -0.22, -0.32], [0.14, 0.34, 0.32], 0.035, plateCol) },
      { id: "armR", parent: "clavicleR", pivot: [-0.42, -0.02, 0], delay: 0.065, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.24, 0.24, 0.24]), _sdTaper(p, [0, 0, 0], [-0.14, -0.74, 0.06], 0.23, 0.18), 0.04),
        [-0.40, -0.96, -0.26], [0.26, 0.26, 0.32], 0.035, brute) },
      { id: "forearmR", parent: "armR", pivot: [-0.14, -0.74, 0.06], delay: 0.085, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.19, 0.19, 0.19]), _sdTaper(p, [0, 0, 0], [-0.04, -0.60, 0.20], 0.18, 0.15), 0.035),
        [-0.24, -0.76, -0.20], [0.20, 0.20, 0.40], 0.035, plateCol) },
      { id: "handR", parent: "forearmR", pivot: [-0.04, -0.60, 0.20], delay: 0.10, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.15, 0.15, 0.15]), _sdEllipsoid(p, [0, -0.06, 0.06], [0.15, 0.12, 0.15]), 0.03),
        [-0.18, -0.20, -0.16], [0.18, 0.16, 0.24], 0.032, brute) },
      { id: "clubR", parent: "handR", pivot: [0, -0.06, 0.08], tip: [0, 0, 1.58], delay: 0.11, build: () => _buildLimbSdf(
        (p) => _smin(_sdTaper(p, [0, 0, -0.15], [0, 0, 1.55], 0.09, 0.24), _sdBox(p, [0, 0, 1.32], [0.26, 0.26, 0.26]), 0.04),
        [-0.32, -0.32, -0.24], [0.32, 0.32, 1.84], 0.036, clubCol) },
      { id: "thighL", parent: "pelvis", pivot: [0.26, -0.10, 0], delay: 0.015, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.22, 0.22, 0.22]), _sdTaper(p, [0, 0, 0], [0.02, -0.70, 0.02], 0.21, 0.17), 0.04),
        [-0.22, -0.88, -0.24], [0.26, 0.24, 0.26], 0.035, brute) },
      { id: "shinL", parent: "thighL", pivot: [0.02, -0.70, 0.02], delay: 0.03, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.18, 0.18, 0.18]), _sdTaper(p, [0, 0, 0], [0, -0.66, -0.02], 0.16, 0.13), 0.035),
        [-0.20, -0.80, -0.20], [0.20, 0.20, 0.20], 0.035, plateCol) },
      { id: "footL", parent: "shinL", pivot: [0, -0.66, -0.02], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.15, 0.14, 0.15]), _sdEllipsoid(p, [0, -0.06, 0.12], [0.16, 0.09, 0.26]), 0.035),
        [-0.20, -0.18, -0.18], [0.20, 0.16, 0.42], 0.034, brute) },
      { id: "thighR", parent: "pelvis", pivot: [-0.26, -0.10, 0], delay: 0.015, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.22, 0.22, 0.22]), _sdTaper(p, [0, 0, 0], [-0.02, -0.70, 0.02], 0.21, 0.17), 0.04),
        [-0.26, -0.88, -0.24], [0.22, 0.24, 0.26], 0.035, brute) },
      { id: "shinR", parent: "thighR", pivot: [-0.02, -0.70, 0.02], delay: 0.03, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.18, 0.18, 0.18]), _sdTaper(p, [0, 0, 0], [0, -0.66, -0.02], 0.16, 0.13), 0.035),
        [-0.20, -0.80, -0.20], [0.20, 0.20, 0.20], 0.035, plateCol) },
      { id: "footR", parent: "shinR", pivot: [0, -0.66, -0.02], delay: 0.045, build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.15, 0.14, 0.15]), _sdEllipsoid(p, [0, -0.06, 0.12], [0.16, 0.09, 0.26]), 0.035),
        [-0.20, -0.18, -0.18], [0.20, 0.16, 0.42], 0.034, brute) }
    ];
  }

  // hellhound: getrennte Ober- und Unterschenkel + Kiefer + Bauch/Brust/Hals/Schwanz
  const houndCol = [0.24, 0.16, 0.15], ribBone = [0.58, 0.44, 0.36];
  return [
    { id: "pelvis", parent: null, pivot: [0, 0.66, -0.22], delay: 0.0, build: () => _buildLimbSdf(
      (p) => _sdEllipsoid(p, [0, 0, 0], [0.14, 0.13, 0.17]), [-0.19, -0.17, -0.22], [0.19, 0.17, 0.22], 0.025, houndCol) },
    { id: "abdomen", parent: "pelvis", pivot: [0, 0.02, 0.12], delay: 0.015, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.13, 0.12, 0.13]), _sdEllipsoid(p, [0, 0.02, 0.10], [0.14, 0.13, 0.14]), 0.03),
      [-0.18, -0.16, -0.14], [0.18, 0.18, 0.26], 0.024, houndCol) },
    { id: "chest", parent: "abdomen", pivot: [0, 0.03, 0.16], delay: 0.03, build: () => {
      const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.14, 0.14, 0.14]), _sdEllipsoid(p, [0, 0.02, 0.16], [0.17, 0.175, 0.22]), 0.035),
        [-0.22, -0.18, -0.15], [0.22, 0.23, 0.42], 0.025, houndCol);
      for (let i = 0; i < 3; i++) _pfBox(b, [0, 0.01, 0.08 + i * 0.085], [0.33, 0.024, 0.028], 0, 0, ribBone);
      return b;
    } },
    { id: "neck", parent: "chest", pivot: [0, 0.10, 0.30], delay: 0.045, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.10, 0.10, 0.10]), _sdCapsule(p, [0, 0, 0], [0, 0.06, 0.12], 0.085), 0.025),
      [-0.14, -0.12, -0.12], [0.14, 0.17, 0.22], 0.022, houndCol) },
    { id: "head", parent: "neck", pivot: [0, 0.06, 0.12], delay: 0.06, build: () => {
      const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.04, 0.05], [0.11, 0.095, 0.11]), _sdTaper(p, [0, 0.02, 0.10], [0, 0.01, 0.26], 0.08, 0.042), 0.03),
        [-0.15, -0.09, -0.08], [0.15, 0.16, 0.32], 0.021, houndCol);
      _pfBox(b, [-0.05, 0.08, 0.14], [0.03, 0.02, 0.02], 0, 0, _EMBER, 1.0);
      _pfBox(b, [ 0.05, 0.08, 0.14], [0.03, 0.02, 0.02], 0, 0, _EMBER, 1.0);
      return b;
    } },
    { id: "jaw", parent: "head", pivot: [0, -0.01, 0.08], sway: "jaw", delay: 0.075, build: () => {
      const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.065, 0.035, 0.065]), _sdTaper(p, [0, -0.01, 0.02], [0, -0.015, 0.16], 0.065, 0.035), 0.02),
        [-0.10, -0.06, -0.07], [0.10, 0.05, 0.21], 0.019, houndCol);
      _pfBox(b, [0, 0.015, 0.10], [0.045, 0.012, 0.09], 0, 0, _EMBER, 0.85);
      return b;
    } },
    { id: "tail", parent: "pelvis", pivot: [0, 0.05, -0.15], sway: "cape", delay: 0.06, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.048, 0.048, 0.048]), _sdTaper(p, [0, 0, 0], [0, 0.16, -0.38], 0.044, 0.014), 0.02),
      [-0.09, -0.07, -0.44], [0.09, 0.22, 0.07], 0.021, ribBone) },
    // Vorderbeine: Oberarm (legFL/FR) + Unterarm (shinFL/FR)
    { id: "legFL", parent: "chest", pivot: [0.13, -0.05, 0.24], delay: 0.02, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.055, 0.055]), _sdCapsule(p, [0, 0, 0], [0.01, -0.28, -0.02], 0.046), 0.022),
      [-0.08, -0.34, -0.09], [0.09, 0.08, 0.08], 0.022, houndCol) },
    { id: "shinFL", parent: "legFL", pivot: [0.01, -0.28, -0.02], delay: 0.04, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _smin(_sdCapsule(p, [0, 0, 0], [0.01, -0.27, 0.03], 0.036), _sdEllipsoid(p, [0.01, -0.29, 0.07], [0.048, 0.028, 0.085]), 0.018), 0.02),
      [-0.07, -0.34, -0.07], [0.09, 0.07, 0.17], 0.022, houndCol) },
    { id: "legFR", parent: "chest", pivot: [-0.13, -0.05, 0.24], delay: 0.02, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.055, 0.055, 0.055]), _sdCapsule(p, [0, 0, 0], [-0.01, -0.28, -0.02], 0.046), 0.022),
      [-0.09, -0.34, -0.09], [0.08, 0.08, 0.08], 0.022, houndCol) },
    { id: "shinFR", parent: "legFR", pivot: [-0.01, -0.28, -0.02], delay: 0.04, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.045, 0.045, 0.045]), _smin(_sdCapsule(p, [0, 0, 0], [-0.01, -0.27, 0.03], 0.036), _sdEllipsoid(p, [-0.01, -0.29, 0.07], [0.048, 0.028, 0.085]), 0.018), 0.02),
      [-0.09, -0.34, -0.07], [0.07, 0.07, 0.17], 0.022, houndCol) },
    // Hinterbeine: Oberschenkel (legBL/BR) + Unterschenkel (shinBL/BR)
    { id: "legBL", parent: "pelvis", pivot: [0.12, -0.05, -0.04], delay: 0.02, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.062, 0.062, 0.062]), _sdCapsule(p, [0, 0, 0], [0.01, -0.28, -0.04], 0.052), 0.024),
      [-0.08, -0.34, -0.11], [0.09, 0.08, 0.08], 0.022, houndCol) },
    { id: "shinBL", parent: "legBL", pivot: [0.01, -0.28, -0.04], delay: 0.04, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.046, 0.046, 0.046]), _smin(_sdCapsule(p, [0, 0, 0], [0.01, -0.27, 0.02], 0.038), _sdEllipsoid(p, [0.01, -0.29, 0.06], [0.048, 0.028, 0.085]), 0.018), 0.02),
      [-0.07, -0.34, -0.07], [0.09, 0.07, 0.16], 0.022, houndCol) },
    { id: "legBR", parent: "pelvis", pivot: [-0.12, -0.05, -0.04], delay: 0.02, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.062, 0.062, 0.062]), _sdCapsule(p, [0, 0, 0], [-0.01, -0.28, -0.04], 0.052), 0.024),
      [-0.09, -0.34, -0.11], [0.08, 0.08, 0.08], 0.022, houndCol) },
    { id: "shinBR", parent: "legBR", pivot: [-0.01, -0.28, -0.04], delay: 0.04, build: () => _buildLimbSdf(
      (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.046, 0.046, 0.046]), _smin(_sdCapsule(p, [0, 0, 0], [-0.01, -0.27, 0.02], 0.038), _sdEllipsoid(p, [-0.01, -0.29, 0.06], [0.048, 0.028, 0.085]), 0.018), 0.02),
      [-0.09, -0.34, -0.07], [0.07, 0.07, 0.16], 0.022, houndCol) }
  ];
}

// Hüllkugeln aus den Eckpunkten eines Gliedes berechnen (für Waffen: Kette aus 4 Kugeln entlang z)
function _computeLimbBounds(builder, isWeapon) {
  const pos = builder.positions;
  const n = pos.length / 3;
  if (n === 0) return [{ c: [0, 0, 0], r: 0.05 }];
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = 0.5 * (minX + maxX), cy = 0.5 * (minY + maxY), cz = 0.5 * (minZ + maxZ);
  if (isWeapon) {
    const spheres = [];
    const count = 4;
    for (let k = 0; k < count; k++) {
      const z0 = lerp(minZ, maxZ, k / count);
      const z1 = lerp(minZ, maxZ, (k + 1) / count);
      const zm = 0.5 * (z0 + z1);
      let rMax = 0.02;
      for (let i = 0; i < n; i++) {
        const z = pos[i * 3 + 2];
        if (z >= z0 - 0.05 && z <= z1 + 0.05) {
          const d = Math.hypot(pos[i * 3] - cx, pos[i * 3 + 1] - cy, z - zm);
          if (d > rMax) rMax = d;
        }
      }
      spheres.push({ c: [cx, cy, zm], r: rMax });
    }
    return spheres;
  }
  let rMax = 0.02;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pos[i * 3] - cx, pos[i * 3 + 1] - cy, pos[i * 3 + 2] - cz);
    if (d > rMax) rMax = d;
  }
  return [{ c: [cx, cy, cz], r: rMax }];
}

function _getFigureSpec(type) {
  if (_PF_CACHE[type]) return _PF_CACHE[type];
  let totalVerts = 0;
  const limbs = _makeLimbDefs(type).map((d) => {
    const builder = d.build();
    const vCount = builder.positions.length / 3;
    totalVerts += vCount;
    const spheres = _computeLimbBounds(builder, !!d.tip);
    return {
      id: d.id, parent: d.parent, pivot: d.pivot, tip: d.tip || null,
      sway: d.sway || null, delay: d.delay || 0.0,
      mesh: uploadStaticMesh(gl, builder),
      spheres,
      parentIdx: -1
    };
  });
  const byId = Object.create(null);
  limbs.forEach((l, i) => { byId[l.id] = i; });
  limbs.forEach((l) => { l.parentIdx = l.parent === null ? -1 : byId[l.parent]; });
  const spec = { type, limbs, byId, totalVerts };
  _PF_CACHE[type] = spec;
  return spec;
}

// --- Schlüsselbilder je Art (4 bis 6 Schlüsselbilder mit Ausholen, Schlag, Nachschwingen, Gewichtsverlagerung) ---
const _CLIPS = {
  skeleton: {
    idle: { dur: 2.2, loop: true, frames: [
      { t: 0.0, root: [0.015, 0, 0], joints: { pelvis: [0, 0, 0.02], abdomen: [0.06, 0, 0], chest: [0.10, -0.02, -0.02], head: [-0.08, 0.03, 0], armL: [0.05, 0, 0.14], forearmL: [-0.25, 0, 0], armR: [0.05, 0, -0.14], forearmR: [-0.35, 0, 0], bladeR: [0.22, 0, 0] } },
      { t: 0.55, root: [0.0, -0.015, 0.005], joints: { pelvis: [0, 0, 0], abdomen: [0.09, 0.02, 0], chest: [0.13, 0.02, 0], head: [-0.05, 0, 0], armL: [0.08, 0, 0.16], forearmL: [-0.30, 0, 0], armR: [0.08, 0, -0.16], forearmR: [-0.42, 0, 0], bladeR: [0.28, 0, 0] } },
      { t: 1.1, root: [-0.015, -0.02, 0.01], joints: { pelvis: [0, 0, -0.02], abdomen: [0.10, 0.03, 0], chest: [0.15, 0.04, 0.02], head: [-0.04, -0.04, 0], armL: [0.06, 0, 0.15], forearmL: [-0.28, 0, 0], armR: [0.06, 0, -0.15], forearmR: [-0.40, 0, 0], bladeR: [0.26, 0, 0] } },
      { t: 1.65, root: [0.0, -0.01, 0.005], joints: { pelvis: [0, 0, 0], abdomen: [0.07, 0.01, 0], chest: [0.11, 0.01, 0], head: [-0.07, 0.01, 0], armL: [0.05, 0, 0.14], forearmL: [-0.26, 0, 0], armR: [0.05, 0, -0.14], forearmR: [-0.36, 0, 0], bladeR: [0.23, 0, 0] } },
      { t: 2.2, root: [0.015, 0, 0], joints: { pelvis: [0, 0, 0.02], abdomen: [0.06, 0, 0], chest: [0.10, -0.02, -0.02], head: [-0.08, 0.03, 0], armL: [0.05, 0, 0.14], forearmL: [-0.25, 0, 0], armR: [0.05, 0, -0.14], forearmR: [-0.35, 0, 0], bladeR: [0.22, 0, 0] } }
    ] },
    alert: { dur: 1.9, loop: true, frames: [
      { t: 0.0, root: [0.01, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.12, -0.04, 0], head: [0.18, 0.05, 0], armL: [-0.15, 0, 0.22], forearmL: [-0.55, 0, 0], armR: [-0.10, 0, -0.20], forearmR: [-0.50, 0, 0], bladeR: [0.15, 0, 0] } },
      { t: 0.5, root: [0, 0.015, 0.02], joints: { abdomen: [0.04, 0.04, 0], chest: [0.08, 0.06, 0], head: [0.24, 0.10, 0.04], armL: [-0.24, 0, 0.26], forearmL: [-0.62, 0, 0], armR: [-0.18, 0, -0.24], forearmR: [-0.58, 0, 0], bladeR: [0.10, 0, 0] } },
      { t: 1.0, root: [-0.01, 0.02, 0.01], joints: { abdomen: [0.05, 0.02, 0], chest: [0.09, 0.04, 0], head: [0.22, -0.08, -0.04], armL: [-0.22, 0, 0.25], forearmL: [-0.60, 0, 0], armR: [-0.16, 0, -0.22], forearmR: [-0.55, 0, 0], bladeR: [0.12, 0, 0] } },
      { t: 1.5, root: [0, 0.01, 0], joints: { abdomen: [0.07, -0.02, 0], chest: [0.11, -0.02, 0], head: [0.20, 0.02, 0], armL: [-0.18, 0, 0.23], forearmL: [-0.57, 0, 0], armR: [-0.12, 0, -0.21], forearmR: [-0.52, 0, 0], bladeR: [0.14, 0, 0] } },
      { t: 1.9, root: [0.01, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.12, -0.04, 0], head: [0.18, 0.05, 0], armL: [-0.15, 0, 0.22], forearmL: [-0.55, 0, 0], armR: [-0.10, 0, -0.20], forearmR: [-0.50, 0, 0], bladeR: [0.15, 0, 0] } }
    ] },
    look: { dur: 2.6, loop: true, frames: [
      { t: 0.0, root: [0.01, 0, 0], joints: { chest: [0.12, -0.14, 0], head: [0.06, -0.18, 0], armR: [-0.25, 0, -0.18], forearmR: [-0.65, 0, 0], bladeR: [0.10, 0, 0] } },
      { t: 0.7, root: [0, -0.01, 0], joints: { chest: [0.14, -0.04, 0], head: [0.02, -0.05, 0], armR: [-0.30, 0, -0.19], forearmR: [-0.68, 0, 0], bladeR: [0.08, 0, 0] } },
      { t: 1.3, root: [-0.01, 0, 0], joints: { chest: [0.12, 0.14, 0], head: [0.06, 0.18, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.72, 0, 0], bladeR: [0.05, 0, 0] } },
      { t: 2.0, root: [0, -0.01, 0], joints: { chest: [0.14, 0.02, 0], head: [0.03, 0.04, 0], armR: [-0.28, 0, -0.19], forearmR: [-0.67, 0, 0], bladeR: [0.08, 0, 0] } },
      { t: 2.6, root: [0.01, 0, 0], joints: { chest: [0.12, -0.14, 0], head: [0.06, -0.18, 0], armR: [-0.25, 0, -0.18], forearmR: [-0.65, 0, 0], bladeR: [0.10, 0, 0] } }
    ] },
    walk: { dur: 0.96, loop: true, frames: [
      { t: 0.0, root: [0.02, -0.02, 0], joints: { pelvis: [0, 0.06, -0.04], abdomen: [0.08, -0.03, 0.02], chest: [0.14, -0.05, 0.03], thighL: [-0.46, 0, 0], shinL: [0.22, 0, 0], footL: [-0.05, 0, 0], thighR: [0.38, 0, 0], shinR: [0.18, 0, 0], footR: [0.12, 0, 0], armL: [0.32, 0, 0.14], armR: [-0.30, 0, -0.16], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.24, root: [0.025, 0.01, 0], joints: { pelvis: [0, 0.02, -0.05], abdomen: [0.07, 0, 0.03], chest: [0.13, 0, 0.04], thighL: [-0.12, 0, 0], shinL: [0.10, 0, 0], footL: [0.02, 0, 0], thighR: [0.18, 0, 0], shinR: [0.68, 0, 0], footR: [0.25, 0, 0], armL: [0.05, 0, 0.14], armR: [-0.05, 0, -0.16], forearmR: [-0.58, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.48, root: [-0.02, -0.02, 0], joints: { pelvis: [0, -0.06, 0.04], abdomen: [0.08, 0.03, -0.02], chest: [0.15, 0.05, -0.03], thighL: [0.38, 0, 0], shinL: [0.18, 0, 0], footL: [0.12, 0, 0], thighR: [-0.46, 0, 0], shinR: [0.22, 0, 0], footR: [-0.05, 0, 0], armL: [-0.30, 0, 0.14], armR: [0.32, 0, -0.16], forearmR: [-0.60, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.72, root: [-0.025, 0.01, 0], joints: { pelvis: [0, -0.02, 0.05], abdomen: [0.07, 0, -0.03], chest: [0.13, 0, -0.04], thighL: [0.18, 0, 0], shinL: [0.68, 0, 0], footL: [0.25, 0, 0], thighR: [-0.12, 0, 0], shinR: [0.10, 0, 0], footR: [0.02, 0, 0], armL: [-0.05, 0, 0.14], armR: [0.05, 0, -0.16], forearmR: [-0.57, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.96, root: [0.02, -0.02, 0], joints: { pelvis: [0, 0.06, -0.04], abdomen: [0.08, -0.03, 0.02], chest: [0.14, -0.05, 0.03], thighL: [-0.46, 0, 0], shinL: [0.22, 0, 0], footL: [-0.05, 0, 0], thighR: [0.38, 0, 0], shinR: [0.18, 0, 0], footR: [0.12, 0, 0], armL: [0.32, 0, 0.14], armR: [-0.30, 0, -0.16], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0] } }
    ] },
    rise: { dur: 2.5, loop: false, frames: [
      { t: 0.0, root: [0, -0.76, 0], joints: { pelvis: [0.65, 0, 0], abdomen: [0.25, 0, 0], chest: [0.35, 0, 0], head: [0.25, 0, 0], armL: [-1.35, 0, 0.25], forearmL: [-0.40, 0, 0], armR: [-1.35, 0, -0.25], forearmR: [-0.40, 0, 0], thighL: [-0.75, 0, 0], shinL: [0.95, 0, 0], thighR: [-0.75, 0, 0], shinR: [0.95, 0, 0] } },
      { t: 0.85, root: [0, -0.52, 0.04], joints: { pelvis: [0.48, 0.08, 0], abdomen: [0.20, -0.05, 0], chest: [0.28, -0.05, 0], head: [0.18, 0, 0], armL: [-1.10, 0, 0.24], forearmL: [-0.50, 0, 0], armR: [-1.10, 0, -0.24], forearmR: [-0.50, 0, 0], thighL: [-0.60, 0, 0], shinL: [0.78, 0, 0], thighR: [-0.55, 0, 0], shinR: [0.72, 0, 0] } },
      { t: 1.65, root: [0, -0.22, 0.02], joints: { pelvis: [0.22, -0.06, 0], abdomen: [0.14, 0.04, 0], chest: [0.20, 0.04, 0], head: [0.06, 0, 0], armL: [-0.65, 0, 0.20], forearmL: [-0.55, 0, 0], armR: [-0.75, 0, -0.20], forearmR: [-0.60, 0, 0], thighL: [-0.30, 0, 0], shinL: [0.40, 0, 0], thighR: [-0.28, 0, 0], shinR: [0.38, 0, 0] } },
      { t: 2.5, root: [0, 0, 0], joints: { pelvis: [0, 0, 0], abdomen: [0.07, 0, 0], chest: [0.11, 0, 0], head: [-0.05, 0, 0], armL: [-0.15, 0, 0.16], forearmL: [-0.45, 0, 0], armR: [-0.35, 0, -0.18], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0], thighL: [-0.04, 0, 0], shinL: [0.06, 0, 0], thighR: [0.04, 0, 0], shinR: [0.05, 0, 0] } }
    ] },
    roar: { dur: 1.4, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.10, 0, 0], head: [0.0, 0, 0], armL: [-0.2, 0, 0.2], armR: [-0.2, 0, -0.2] } },
      { t: 0.28, root: [0, -0.04, 0.03], joints: { abdomen: [0.14, 0, 0], chest: [0.18, 0, 0], head: [0.12, 0, 0], armL: [-0.1, 0, 0.12], armR: [-0.1, 0, -0.12] } },
      { t: 0.62, root: [0, 0.03, -0.05], joints: { abdomen: [-0.10, 0, 0], chest: [-0.14, 0, 0], head: [-0.36, 0, 0], jaw: [0.42, 0, 0], armL: [-0.85, 0, 0.52], forearmL: [-0.35, 0, 0], armR: [-0.85, 0, -0.52], forearmR: [-0.35, 0, 0], bladeR: [-0.2, 0, 0] } },
      { t: 1.05, root: [0, 0.01, -0.02], joints: { abdomen: [-0.02, 0, 0], chest: [0.04, 0, 0], head: [-0.22, 0, 0], jaw: [0.24, 0, 0], armL: [-0.45, 0, 0.32], forearmL: [-0.40, 0, 0], armR: [-0.55, 0, -0.32], forearmR: [-0.45, 0, 0] } },
      { t: 1.4, root: [0, 0, 0], joints: { abdomen: [0.07, 0, 0], chest: [0.11, 0, 0], head: [-0.08, 0, 0], jaw: [0.05, 0, 0], armL: [-0.15, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [-0.35, 0, -0.18], forearmR: [-0.55, 0, 0] } }
    ] }
  },
  cultist: {
    idle: { dur: 2.4, loop: true, frames: [
      { t: 0.0, root: [0.01, 0, 0], joints: { abdomen: [0.05, 0, 0], chest: [0.08, -0.02, 0], head: [0.06, 0.02, 0], armL: [0.06, 0, 0.12], forearmL: [-0.45, 0, 0], armR: [0.06, 0, -0.12], forearmR: [-0.45, 0, 0] } },
      { t: 0.6, root: [0, -0.012, 0], joints: { abdomen: [0.07, 0.02, 0], chest: [0.10, 0.02, 0], head: [0.08, 0, 0], armL: [0.04, 0, 0.14], forearmL: [-0.49, 0, 0], armR: [0.04, 0, -0.14], forearmR: [-0.49, 0, 0] } },
      { t: 1.2, root: [-0.01, -0.02, 0], joints: { abdomen: [0.08, 0.03, 0], chest: [0.11, 0.03, 0], head: [0.10, -0.03, 0], armL: [0.02, 0, 0.15], forearmL: [-0.52, 0, 0], armR: [0.02, 0, -0.15], forearmR: [-0.52, 0, 0] } },
      { t: 1.8, root: [0, -0.01, 0], joints: { abdomen: [0.06, 0.01, 0], chest: [0.09, 0.01, 0], head: [0.07, -0.01, 0], armL: [0.05, 0, 0.13], forearmL: [-0.48, 0, 0], armR: [0.05, 0, -0.13], forearmR: [-0.48, 0, 0] } },
      { t: 2.4, root: [0.01, 0, 0], joints: { abdomen: [0.05, 0, 0], chest: [0.08, -0.02, 0], head: [0.06, 0.02, 0], armL: [0.06, 0, 0.12], forearmL: [-0.45, 0, 0], armR: [0.06, 0, -0.12], forearmR: [-0.45, 0, 0] } }
    ] },
    summon: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0.02, 0.02, 0], joints: { abdomen: [-0.04, 0.10, 0], chest: [-0.06, 0.14, 0], head: [-0.14, -0.12, 0], armL: [-1.15, 0.25, 0.35], forearmL: [-0.55, 0, 0], armR: [-1.25, -0.25, -0.35], forearmR: [-0.65, 0, 0] } },
      { t: 0.5, root: [0.0, 0.04, 0.02], joints: { abdomen: [-0.06, 0.0, 0], chest: [-0.09, 0.0, 0], head: [-0.18, 0.0, 0], armL: [-1.28, 0.0, 0.42], forearmL: [-0.65, 0, 0], armR: [-1.28, 0.0, -0.42], forearmR: [-0.65, 0, 0] } },
      { t: 1.0, root: [-0.02, 0.03, 0], joints: { abdomen: [-0.05, -0.10, 0], chest: [-0.08, -0.14, 0], head: [-0.16, 0.12, 0], armL: [-1.30, -0.25, 0.45], forearmL: [-0.70, 0, 0], armR: [-1.10, 0.25, -0.45], forearmR: [-0.45, 0, 0] } },
      { t: 1.5, root: [0.0, 0.01, -0.02], joints: { abdomen: [-0.03, 0.0, 0], chest: [-0.05, 0.0, 0], head: [-0.12, 0.0, 0], armL: [-1.20, 0.0, 0.38], forearmL: [-0.58, 0, 0], armR: [-1.20, 0.0, -0.38], forearmR: [-0.58, 0, 0] } },
      { t: 2.0, root: [0.02, 0.02, 0], joints: { abdomen: [-0.04, 0.10, 0], chest: [-0.06, 0.14, 0], head: [-0.14, -0.12, 0], armL: [-1.15, 0.25, 0.35], forearmL: [-0.55, 0, 0], armR: [-1.25, -0.25, -0.35], forearmR: [-0.65, 0, 0] } }
    ] },
    cast: { dur: 1.3, loop: false, frames: [
      { t: 0.0, root: [0, 0.03, -0.04], joints: { abdomen: [-0.06, 0, 0], chest: [-0.08, 0, 0], head: [-0.15, 0, 0], armL: [-1.20, 0, 0.35], forearmL: [-0.60, 0, 0], armR: [-1.20, 0, -0.35], forearmR: [-0.60, 0, 0] } },
      { t: 0.25, root: [0, 0.05, -0.08], joints: { abdomen: [-0.10, 0, 0], chest: [-0.14, 0, 0], head: [-0.22, 0, 0], armL: [-1.45, 0, 0.42], forearmL: [-0.75, 0, 0], armR: [-1.45, 0, -0.42], forearmR: [-0.75, 0, 0] } },
      { t: 0.55, root: [0, -0.02, 0.10], joints: { abdomen: [0.12, 0, 0], chest: [0.16, 0, 0], head: [0.06, 0, 0], armL: [-1.35, 0, 0.08], forearmL: [-0.12, 0, 0], armR: [-1.35, 0, -0.08], forearmR: [-0.12, 0, 0] } },
      { t: 0.9, root: [0, -0.01, 0.04], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [0.05, 0, 0], armL: [-0.85, 0, 0.14], forearmL: [-0.35, 0, 0], armR: [-0.85, 0, -0.14], forearmR: [-0.35, 0, 0] } },
      { t: 1.3, root: [0, 0, 0], joints: { abdomen: [0.05, 0, 0], chest: [0.08, 0, 0], head: [0.04, 0, 0], armL: [-0.45, 0, 0.16], forearmL: [-0.55, 0, 0], armR: [-0.45, 0, -0.16], forearmR: [-0.55, 0, 0] } }
    ] },
    alert: { dur: 2.1, loop: true, frames: [
      { t: 0.0, root: [0.01, 0, 0], joints: { chest: [0.05, -0.12, 0], head: [-0.05, 0.12, 0], armL: [-0.35, 0, 0.20], forearmL: [-0.65, 0, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.65, 0, 0] } },
      { t: 0.55, root: [0, 0.01, 0], joints: { chest: [0.06, 0.0, 0], head: [-0.06, 0.0, 0], armL: [-0.38, 0, 0.22], forearmL: [-0.68, 0, 0], armR: [-0.38, 0, -0.22], forearmR: [-0.68, 0, 0] } },
      { t: 1.05, root: [-0.01, 0.02, 0], joints: { chest: [0.05, 0.12, 0], head: [-0.05, -0.12, 0], armL: [-0.42, 0, 0.24], forearmL: [-0.70, 0, 0], armR: [-0.42, 0, -0.24], forearmR: [-0.70, 0, 0] } },
      { t: 1.6, root: [0, 0.01, 0], joints: { chest: [0.06, 0.0, 0], head: [-0.06, 0.0, 0], armL: [-0.38, 0, 0.22], forearmL: [-0.68, 0, 0], armR: [-0.38, 0, -0.22], forearmR: [-0.68, 0, 0] } },
      { t: 2.1, root: [0.01, 0, 0], joints: { chest: [0.05, -0.12, 0], head: [-0.05, 0.12, 0], armL: [-0.35, 0, 0.20], forearmL: [-0.65, 0, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.65, 0, 0] } }
    ] }
  },
  wraith: {
    float: { dur: 2.4, loop: true, frames: [
      { t: 0.0, root: [0.03, 0.05, 0], joints: { core: [0.10, 0, 0.04], chest: [0.06, 0, 0], head: [-0.08, 0, 0], armL: [0.15, 0, 0.22], armR: [0.15, 0, -0.22] } },
      { t: 0.6, root: [0.0, -0.02, 0.02], joints: { core: [0.14, 0.03, 0], chest: [0.08, 0.02, 0], head: [-0.05, -0.03, 0], armL: [0.20, 0, 0.25], armR: [0.20, 0, -0.25] } },
      { t: 1.2, root: [-0.03, -0.05, 0.04], joints: { core: [0.16, 0.05, -0.04], chest: [0.10, 0.03, 0], head: [-0.02, -0.05, 0], armL: [0.25, 0, 0.28], armR: [0.25, 0, -0.28] } },
      { t: 1.8, root: [0.0, 0.0, 0.02], joints: { core: [0.13, 0.02, 0], chest: [0.08, 0.01, 0], head: [-0.05, -0.02, 0], armL: [0.18, 0, 0.24], armR: [0.18, 0, -0.24] } },
      { t: 2.4, root: [0.03, 0.05, 0], joints: { core: [0.10, 0, 0.04], chest: [0.06, 0, 0], head: [-0.08, 0, 0], armL: [0.15, 0, 0.22], armR: [0.15, 0, -0.22] } }
    ] },
    rush: { dur: 1.4, loop: true, frames: [
      { t: 0.0, root: [0.04, 0.04, 0], joints: { core: [0.32, 0.04, 0.05], chest: [0.12, 0, 0], head: [-0.25, 0, 0], armL: [-0.95, 0.15, 0.22], armR: [-0.95, -0.15, -0.22] } },
      { t: 0.35, root: [0.0, 0.0, 0.02], joints: { core: [0.36, 0.0, 0], chest: [0.14, 0, 0], head: [-0.28, 0, 0], armL: [-1.02, 0.18, 0.24], armR: [-1.02, -0.18, -0.24] } },
      { t: 0.7, root: [-0.04, -0.04, 0], joints: { core: [0.38, -0.04, -0.05], chest: [0.15, 0, 0], head: [-0.30, 0, 0], armL: [-1.08, 0.20, 0.26], armR: [-1.08, -0.20, -0.26] } },
      { t: 1.05, root: [0.0, 0.0, -0.02], joints: { core: [0.35, 0.0, 0], chest: [0.13, 0, 0], head: [-0.27, 0, 0], armL: [-1.00, 0.17, 0.24], armR: [-1.00, -0.17, -0.24] } },
      { t: 1.4, root: [0.04, 0.04, 0], joints: { core: [0.32, 0.04, 0.05], chest: [0.12, 0, 0], head: [-0.25, 0, 0], armL: [-0.95, 0.15, 0.22], armR: [-0.95, -0.15, -0.22] } }
    ] },
    shriek: { dur: 1.5, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { core: [0.22, 0, 0], chest: [0.08, 0, 0], head: [-0.1, 0, 0], armL: [-0.4, 0, 0.3], armR: [-0.4, 0, -0.3] } },
      { t: 0.3, root: [0, -0.06, 0.05], joints: { core: [0.34, 0, 0], chest: [0.15, 0, 0], head: [0.05, 0, 0], armL: [-0.2, 0, 0.15], armR: [-0.2, 0, -0.15] } },
      { t: 0.65, root: [0, 0.12, -0.05], joints: { core: [-0.18, 0, 0], chest: [-0.12, 0, 0], head: [-0.38, 0, 0], armL: [-0.75, 0.35, 0.85], armR: [-0.75, -0.35, -0.85] } },
      { t: 1.1, root: [0, 0.08, -0.02], joints: { core: [0.06, 0, 0], chest: [0.04, 0, 0], head: [-0.26, 0, 0], armL: [-0.80, 0.25, 0.55], armR: [-0.80, -0.25, -0.55] } },
      { t: 1.5, root: [0, 0.05, 0], joints: { core: [0.24, 0, 0], chest: [0.08, 0, 0], head: [-0.18, 0, 0], armL: [-0.85, 0.15, 0.35], armR: [-0.85, -0.15, -0.35] } }
    ] }
  },
  hero: {
    idle: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0.02, 0, 0], joints: { pelvis: [0, -0.04, 0.02], abdomen: [0.04, -0.06, 0], chest: [0.06, -0.08, -0.02], head: [0.0, 0.12, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } },
      { t: 0.5, root: [0.0, -0.015, 0.01], joints: { pelvis: [0, -0.02, 0], abdomen: [0.06, -0.05, 0], chest: [0.08, -0.07, 0], head: [0.02, 0.11, 0], armL: [-0.23, 0, 0.19], forearmL: [-0.68, 0, 0], armR: [-0.43, 0.15, -0.21], forearmR: [-0.63, 0, 0], swordR: [-0.32, 0, 0] } },
      { t: 1.0, root: [-0.02, -0.025, 0], joints: { pelvis: [0, 0.02, -0.02], abdomen: [0.07, -0.04, 0], chest: [0.09, -0.06, 0.02], head: [0.04, 0.10, 0], armL: [-0.22, 0, 0.20], forearmL: [-0.70, 0, 0], armR: [-0.42, 0.15, -0.22], forearmR: [-0.65, 0, 0], swordR: [-0.30, 0, 0] } },
      { t: 1.5, root: [0.0, -0.01, -0.01], joints: { pelvis: [0, -0.01, 0], abdomen: [0.05, -0.05, 0], chest: [0.07, -0.07, 0], head: [0.02, 0.11, 0], armL: [-0.24, 0, 0.19], forearmL: [-0.67, 0, 0], armR: [-0.44, 0.15, -0.21], forearmR: [-0.62, 0, 0], swordR: [-0.33, 0, 0] } },
      { t: 2.0, root: [0.02, 0, 0], joints: { pelvis: [0, -0.04, 0.02], abdomen: [0.04, -0.06, 0], chest: [0.06, -0.08, -0.02], head: [0.0, 0.12, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } }
    ] },
    attack1: { dur: 0.85, loop: false, strikeTime: 0.42, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { pelvis: [0, -0.12, 0], abdomen: [0, -0.10, 0], chest: [0.04, -0.12, 0], armR: [-0.65, 0.20, -0.30], forearmR: [-0.55, 0, 0], swordR: [-0.35, 0, 0] } },
      { t: 0.18, root: [-0.04, 0.02, -0.08], joints: { pelvis: [0, -0.38, -0.04], abdomen: [-0.05, -0.22, 0], chest: [-0.08, -0.28, 0], armR: [-1.55, 0.38, -0.62], forearmR: [-0.48, 0, 0], swordR: [-0.45, 0, 0] } },
      { t: 0.42, root: [0.04, -0.03, 0.26], joints: { pelvis: [0.06, 0.34, 0.04], abdomen: [0.10, 0.20, 0], chest: [0.16, 0.24, 0], armR: [-1.05, -0.30, 0.12], forearmR: [-0.15, 0, 0], swordR: [0.05, 0, 0] } },
      { t: 0.62, root: [0.03, -0.02, 0.18], joints: { pelvis: [0.04, 0.28, 0.02], abdomen: [0.08, 0.16, 0], chest: [0.14, 0.18, 0], armR: [-0.85, -0.20, 0.05], forearmR: [-0.25, 0, 0], swordR: [-0.05, 0, 0] } },
      { t: 0.85, root: [0, 0, 0.04], joints: { pelvis: [0, 0.06, 0], abdomen: [0.05, 0, 0], chest: [0.08, -0.04, 0], armR: [-0.50, 0.12, -0.20], forearmR: [-0.55, 0, 0], swordR: [-0.30, 0, 0] } }
    ] },
    attack2: { dur: 0.85, loop: false, strikeTime: 0.42, frames: [
      { t: 0.0, root: [0, 0, 0.02], joints: { pelvis: [0, 0.12, 0], abdomen: [0.05, 0.12, 0], chest: [0.08, 0.15, 0], armR: [-0.65, -0.25, 0.15], forearmR: [-0.45, 0, 0], swordR: [-0.20, 0, 0] } },
      { t: 0.18, root: [0.04, 0.02, -0.06], joints: { pelvis: [0, 0.36, 0.04], abdomen: [0.04, 0.22, 0], chest: [0.06, 0.26, 0], armR: [-0.85, -0.52, 0.42], forearmR: [-0.55, 0, 0], swordR: [-0.25, 0, 0] } },
      { t: 0.42, root: [-0.04, -0.02, 0.24], joints: { pelvis: [0.05, -0.34, -0.04], abdomen: [0.08, -0.20, 0], chest: [0.14, -0.24, 0], armR: [-1.15, 0.40, -0.30], forearmR: [-0.18, 0, 0], swordR: [0.02, 0, 0] } },
      { t: 0.64, root: [-0.02, -0.01, 0.14], joints: { pelvis: [0.02, -0.24, -0.02], abdomen: [0.06, -0.14, 0], chest: [0.10, -0.16, 0], armR: [-0.80, 0.28, -0.25], forearmR: [-0.35, 0, 0], swordR: [-0.12, 0, 0] } },
      { t: 0.85, root: [0, 0, 0.02], joints: { pelvis: [0, -0.06, 0], abdomen: [0.05, -0.04, 0], chest: [0.08, -0.08, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.55, 0, 0], swordR: [-0.32, 0, 0] } }
    ] },
    attack3: { dur: 1.05, loop: false, strikeTime: 0.52, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { pelvis: [0, -0.10, 0], abdomen: [0.04, -0.08, 0], chest: [0.06, -0.10, 0], armR: [-0.55, 0.10, -0.20], forearmR: [-0.70, 0, 0], swordR: [-0.20, 0, 0] } },
      { t: 0.24, root: [-0.03, 0.01, -0.10], joints: { pelvis: [-0.04, -0.24, -0.03], abdomen: [-0.04, -0.14, 0], chest: [0.02, -0.16, 0], armR: [-0.75, 0, -0.25], forearmR: [-1.05, 0, 0], swordR: [0.0, 0, 0] } },
      { t: 0.52, root: [0.04, -0.04, 0.34], joints: { pelvis: [0.10, 0.16, 0.04], abdomen: [0.12, 0.10, 0], chest: [0.18, 0.12, 0], armR: [-1.38, 0.05, -0.05], forearmR: [-0.05, 0, 0], swordR: [0.0, 0, 0] } },
      { t: 0.78, root: [0.02, -0.02, 0.20], joints: { pelvis: [0.06, 0.10, 0.02], abdomen: [0.08, 0.05, 0], chest: [0.12, 0.05, 0], armR: [-1.05, 0.08, -0.12], forearmR: [-0.28, 0, 0], swordR: [-0.15, 0, 0] } },
      { t: 1.05, root: [0, 0, 0.04], joints: { pelvis: [0, 0, 0], abdomen: [0.05, -0.04, 0], chest: [0.08, -0.08, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } }
    ] },
    heavy: { dur: 1.35, loop: false, strikeTime: 0.68, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { abdomen: [0.04, 0, 0], chest: [0.06, 0, 0], armL: [-0.45, 0, 0.20], forearmL: [-0.65, 0, 0], armR: [-0.55, 0, -0.20], forearmR: [-0.65, 0, 0], swordR: [-0.35, 0, 0] } },
      { t: 0.32, root: [0, 0.04, -0.10], joints: { abdomen: [-0.12, 0, 0], chest: [-0.18, 0, 0], head: [-0.22, 0, 0], armL: [-2.10, 0, 0.22], forearmL: [-0.50, 0, 0], armR: [-2.10, 0, -0.22], forearmR: [-0.50, 0, 0], swordR: [-0.55, 0, 0] } },
      { t: 0.68, root: [0, -0.06, 0.32], joints: { abdomen: [0.16, 0, 0], chest: [0.22, 0, 0], head: [0.12, 0, 0], armL: [-1.05, 0, 0.15], forearmL: [-0.15, 0, 0], armR: [-1.05, 0, -0.15], forearmR: [-0.15, 0, 0], swordR: [0.10, 0, 0] } },
      { t: 0.98, root: [0, -0.04, 0.20], joints: { abdomen: [0.12, 0, 0], chest: [0.16, 0, 0], head: [0.08, 0, 0], armL: [-0.75, 0, 0.18], forearmL: [-0.35, 0, 0], armR: [-0.80, 0, -0.18], forearmR: [-0.35, 0, 0], swordR: [-0.08, 0, 0] } },
      { t: 1.35, root: [0, 0, 0.04], joints: { abdomen: [0.05, -0.04, 0], chest: [0.08, -0.08, 0], head: [0.04, 0.10, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.32, 0, 0] } }
    ] },
    block: { dur: 0.7, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.06, 0, 0], armL: [-0.65, 0, 0.22], forearmL: [-0.75, 0, 0], armR: [-0.75, 0, -0.22], forearmR: [-0.75, 0, 0], swordR: [0.20, 0, 0] } },
      { t: 0.22, root: [0, -0.03, -0.06], joints: { abdomen: [0.06, 0, 0], chest: [0.10, 0, 0], armL: [-0.98, 0, 0.20], forearmL: [-0.92, 0, 0], armR: [-1.08, 0, -0.20], forearmR: [-0.92, 0, 0], swordR: [0.42, 0, 0] } },
      { t: 0.45, root: [0, -0.02, -0.04], joints: { abdomen: [0.05, 0, 0], chest: [0.08, 0, 0], armL: [-0.90, 0, 0.22], forearmL: [-0.85, 0, 0], armR: [-0.98, 0, -0.22], forearmR: [-0.85, 0, 0], swordR: [0.35, 0, 0] } },
      { t: 0.7, root: [0, 0, 0], joints: { abdomen: [0.04, -0.05, 0], chest: [0.07, -0.08, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } }
    ] },
    victory: { dur: 2.2, loop: true, frames: [
      { t: 0.0, root: [0.015, 0, 0], joints: { abdomen: [0.07, 0, 0], chest: [0.11, 0, 0], head: [0.14, 0, 0], armR: [0.08, 0, -0.15], forearmR: [-0.20, 0, 0], swordR: [0.65, 0, 0] } },
      { t: 0.55, root: [0.0, -0.02, 0], joints: { abdomen: [0.09, 0.02, 0], chest: [0.14, 0.02, 0], head: [0.18, 0.03, 0], armR: [0.10, 0, -0.17], forearmR: [-0.23, 0, 0], swordR: [0.69, 0, 0] } },
      { t: 1.1, root: [-0.015, -0.03, 0], joints: { abdomen: [0.10, 0, 0], chest: [0.15, 0, 0], head: [0.22, 0, 0], armR: [0.12, 0, -0.18], forearmR: [-0.25, 0, 0], swordR: [0.72, 0, 0] } },
      { t: 1.65, root: [0.0, -0.015, 0], joints: { abdomen: [0.08, -0.02, 0], chest: [0.13, -0.02, 0], head: [0.18, -0.03, 0], armR: [0.10, 0, -0.16], forearmR: [-0.22, 0, 0], swordR: [0.68, 0, 0] } },
      { t: 2.2, root: [0.015, 0, 0], joints: { abdomen: [0.07, 0, 0], chest: [0.11, 0, 0], head: [0.14, 0, 0], armR: [0.08, 0, -0.15], forearmR: [-0.20, 0, 0], swordR: [0.65, 0, 0] } }
    ] }
  },
  boss: {
    idle: { dur: 2.6, loop: true, frames: [
      { t: 0.0, root: [0.03, 0, 0], joints: { pelvis: [0, 0, 0.02], abdomen: [0.08, 0, 0], chest: [0.12, -0.02, -0.02], head: [-0.08, 0.02, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.08, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } },
      { t: 0.65, root: [0.0, -0.02, 0.01], joints: { pelvis: [0, 0, 0], abdomen: [0.10, 0.02, 0], chest: [0.14, 0.02, 0], head: [-0.05, 0, 0], armL: [0.11, 0, 0.20], forearmL: [-0.48, 0, 0], armR: [0.11, 0, -0.20], forearmR: [-0.58, 0, 0], clubR: [0.28, 0, 0] } },
      { t: 1.3, root: [-0.03, -0.04, 0.02], joints: { pelvis: [0, 0, -0.02], abdomen: [0.11, 0.03, 0], chest: [0.15, 0.04, 0.02], head: [-0.02, -0.04, 0], armL: [0.14, 0, 0.22], forearmL: [-0.50, 0, 0], armR: [0.14, 0, -0.22], forearmR: [-0.62, 0, 0], clubR: [0.30, 0, 0] } },
      { t: 1.95, root: [0.0, -0.02, 0.01], joints: { pelvis: [0, 0, 0], abdomen: [0.09, 0.01, 0], chest: [0.13, 0.01, 0], head: [-0.05, 0.01, 0], armL: [0.10, 0, 0.20], forearmL: [-0.47, 0, 0], armR: [0.10, 0, -0.20], forearmR: [-0.58, 0, 0], clubR: [0.27, 0, 0] } },
      { t: 2.6, root: [0.03, 0, 0], joints: { pelvis: [0, 0, 0.02], abdomen: [0.08, 0, 0], chest: [0.12, -0.02, -0.02], head: [-0.08, 0.02, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.08, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    roar: { dur: 1.7, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.10, 0, 0], head: [0, 0, 0], armL: [0.1, 0, 0.2], armR: [0.1, 0, -0.2] } },
      { t: 0.32, root: [0, -0.08, 0.06], joints: { abdomen: [0.16, 0, 0], chest: [0.20, 0, 0], head: [0.14, 0, 0], armL: [0.2, 0, 0.12], armR: [0.2, 0, -0.12] } },
      { t: 0.72, root: [0, 0.05, -0.10], joints: { abdomen: [-0.12, 0, 0], chest: [-0.16, 0, 0], head: [-0.36, 0, 0], jaw: [0.48, 0, 0], armL: [-0.75, 0.25, 0.70], forearmL: [-0.35, 0, 0], armR: [-0.85, -0.25, -0.70], forearmR: [-0.35, 0, 0], clubR: [-0.15, 0, 0] } },
      { t: 1.25, root: [0, 0.02, -0.04], joints: { abdomen: [0.0, 0, 0], chest: [0.04, 0, 0], head: [-0.22, 0, 0], jaw: [0.26, 0, 0], armL: [-0.35, 0.1, 0.42], forearmL: [-0.40, 0, 0], armR: [-0.40, -0.1, -0.42], forearmR: [-0.45, 0, 0], clubR: [0.08, 0, 0] } },
      { t: 1.7, root: [0, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [-0.10, 0, 0], jaw: [0.04, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.10, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    attack: { dur: 1.15, loop: false, strikeTime: 0.62, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { abdomen: [0.06, 0, 0], chest: [0.10, 0, 0], armL: [0.0, 0, 0.2], armR: [-0.2, 0, -0.2], clubR: [0.2, 0, 0] } },
      { t: 0.28, root: [-0.06, 0.04, -0.14], joints: { abdomen: [-0.12, -0.14, 0], chest: [-0.16, -0.18, 0], head: [-0.18, 0.15, 0], armL: [-1.10, 0, 0.42], forearmL: [-0.45, 0, 0], armR: [-2.10, 0, -0.24], forearmR: [-0.40, 0, 0], clubR: [-0.45, 0, 0] } },
      { t: 0.62, root: [0.06, -0.06, 0.26], joints: { abdomen: [0.18, 0.14, 0], chest: [0.24, 0.18, 0], head: [0.15, -0.12, 0], armL: [-0.55, 0, 0.30], forearmL: [-0.30, 0, 0], armR: [-1.15, 0, -0.15], forearmR: [-0.15, 0, 0], clubR: [0.05, 0, 0] } },
      { t: 0.88, root: [0.04, -0.04, 0.16], joints: { abdomen: [0.14, 0.08, 0], chest: [0.18, 0.10, 0], head: [0.06, -0.06, 0], armL: [-0.25, 0, 0.24], forearmL: [-0.38, 0, 0], armR: [-0.55, 0, -0.18], forearmR: [-0.35, 0, 0], clubR: [0.18, 0, 0] } },
      { t: 1.15, root: [0, 0, 0.04], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [-0.08, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.10, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    hit: { dur: 0.55, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [-0.08, 0, 0] } },
      { t: 0.18, root: [0, 0.02, -0.14], joints: { abdomen: [-0.10, 0.08, -0.05], chest: [-0.14, 0.12, -0.08], head: [-0.22, -0.10, 0.08], jaw: [0.24, 0, 0], armL: [-0.45, 0, 0.35], armR: [-0.55, 0, -0.35] } },
      { t: 0.36, root: [0, 0.01, -0.08], joints: { abdomen: [0.0, 0.04, -0.02], chest: [0.04, 0.06, -0.04], head: [-0.15, -0.05, 0.04], jaw: [0.12, 0, 0], armL: [-0.20, 0, 0.26], armR: [-0.25, 0, -0.26] } },
      { t: 0.55, root: [0, 0, -0.02], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [-0.08, 0, 0], jaw: [0.04, 0, 0], armL: [0.08, 0, 0.18], armR: [0.08, 0, -0.18] } }
    ] },
    death: { dur: 2.9, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { pelvis: [0, 0, 0], abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [-0.08, 0, 0] } },
      { t: 0.7, root: [0, -0.25, 0.05], joints: { pelvis: [0.10, 0, 0], abdomen: [0.15, 0, 0], chest: [0.20, 0, 0], head: [0.15, 0, 0], jaw: [0.30, 0, 0], thighL: [-0.65, 0, 0.10], shinL: [0.85, 0, 0], thighR: [-0.65, 0, -0.10], shinR: [0.85, 0, 0], armL: [0.18, 0, 0.28], armR: [0.22, 0, -0.28], clubR: [0.35, 0, 0] } },
      { t: 1.4, root: [0, -0.62, 0.15], joints: { pelvis: [0.32, 0, 0.04], abdomen: [0.22, 0, 0], chest: [0.26, 0, 0], head: [0.28, 0, 0], thighL: [-1.15, 0, 0.15], shinL: [1.35, 0, 0], thighR: [-1.15, 0, -0.15], shinR: [1.35, 0, 0], armL: [0.30, 0, 0.38], armR: [0.35, 0, -0.38], clubR: [0.55, 0, 0] } },
      { t: 2.2, root: [0, -1.02, 0.35], joints: { pelvis: [0.95, 0, 0.06], abdomen: [0.26, 0, -0.04], chest: [0.30, 0, -0.04], head: [0.26, 0, 0], thighL: [-1.22, 0, 0.22], shinL: [0.85, 0, 0], thighR: [-1.22, 0, -0.22], shinR: [0.85, 0, 0], armL: [0.48, 0, 0.48], forearmL: [-0.15, 0, 0], armR: [0.55, 0, -0.42], forearmR: [-0.15, 0, 0], clubR: [0.80, 0, 0] } },
      { t: 2.9, root: [0, -1.16, 0.42], joints: { pelvis: [1.16, 0, 0.08], abdomen: [0.24, 0, -0.05], chest: [0.28, 0, -0.05], head: [0.24, 0, 0], jaw: [0.22, 0, 0], thighL: [-1.25, 0, 0.25], shinL: [0.65, 0, 0], thighR: [-1.25, 0, -0.25], shinR: [0.65, 0, 0], armL: [0.55, 0, 0.52], forearmL: [-0.2, 0, 0], armR: [0.65, 0, -0.45], forearmR: [-0.2, 0, 0], clubR: [0.92, 0, 0] } }
    ] }
  },
  hellhound: {
    idle: { dur: 1.8, loop: true, frames: [
      { t: 0.0, root: [0.01, -0.10, 0], joints: { pelvis: [-0.06, 0, 0], abdomen: [0.06, 0, 0], chest: [0.08, 0, 0], head: [-0.12, 0, 0], legFL: [-0.30, 0, 0], shinFL: [0.35, 0, 0], legFR: [-0.20, 0, 0], shinFR: [0.25, 0, 0], legBL: [0.30, 0, 0], shinBL: [-0.35, 0, 0], legBR: [0.20, 0, 0], shinBR: [-0.25, 0, 0], tail: [-0.15, 0.15, 0] } },
      { t: 0.45, root: [0, -0.12, 0], joints: { pelvis: [-0.07, 0, 0], abdomen: [0.08, 0, 0], chest: [0.10, 0, 0], head: [-0.14, 0.03, 0], legFL: [-0.32, 0, 0], shinFL: [0.38, 0, 0], legFR: [-0.22, 0, 0], shinFR: [0.28, 0, 0], legBL: [0.32, 0, 0], shinBL: [-0.38, 0, 0], legBR: [0.22, 0, 0], shinBR: [-0.28, 0, 0], tail: [-0.18, 0.0, 0] } },
      { t: 0.9, root: [-0.01, -0.13, 0], joints: { pelvis: [-0.08, 0, 0], abdomen: [0.09, 0, 0], chest: [0.11, 0, 0], head: [-0.16, 0.05, 0], legFL: [-0.34, 0, 0], shinFL: [0.40, 0, 0], legFR: [-0.24, 0, 0], shinFR: [0.30, 0, 0], legBL: [0.34, 0, 0], shinBL: [-0.40, 0, 0], legBR: [0.24, 0, 0], shinBR: [-0.30, 0, 0], tail: [-0.20, -0.15, 0] } },
      { t: 1.35, root: [0, -0.11, 0], joints: { pelvis: [-0.07, 0, 0], abdomen: [0.07, 0, 0], chest: [0.09, 0, 0], head: [-0.14, 0.02, 0], legFL: [-0.31, 0, 0], shinFL: [0.37, 0, 0], legFR: [-0.21, 0, 0], shinFR: [0.27, 0, 0], legBL: [0.31, 0, 0], shinBL: [-0.37, 0, 0], legBR: [0.21, 0, 0], shinBR: [-0.27, 0, 0], tail: [-0.17, 0.0, 0] } },
      { t: 1.8, root: [0.01, -0.10, 0], joints: { pelvis: [-0.06, 0, 0], abdomen: [0.06, 0, 0], chest: [0.08, 0, 0], head: [-0.12, 0, 0], legFL: [-0.30, 0, 0], shinFL: [0.35, 0, 0], legFR: [-0.20, 0, 0], shinFR: [0.25, 0, 0], legBL: [0.30, 0, 0], shinBL: [-0.35, 0, 0], legBR: [0.20, 0, 0], shinBR: [-0.25, 0, 0], tail: [-0.15, 0.15, 0] } }
    ] },
    look: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0.01, -0.10, 0], joints: { abdomen: [0.04, -0.08, 0], chest: [0.05, -0.12, 0], head: [-0.18, -0.25, 0], jaw: [0.12, 0, 0], tail: [-0.1, 0.2, 0] } },
      { t: 0.5, root: [0, -0.11, 0], joints: { abdomen: [0.05, 0.0, 0], chest: [0.06, 0.0, 0], head: [-0.16, 0.0, 0], jaw: [0.06, 0, 0], tail: [-0.12, 0.0, 0] } },
      { t: 1.0, root: [-0.01, -0.10, 0], joints: { abdomen: [0.04, 0.08, 0], chest: [0.05, 0.12, 0], head: [-0.18, 0.25, 0], jaw: [0.14, 0, 0], tail: [-0.1, -0.2, 0] } },
      { t: 1.5, root: [0, -0.11, 0], joints: { abdomen: [0.05, 0.0, 0], chest: [0.06, 0.0, 0], head: [-0.16, 0.0, 0], jaw: [0.06, 0, 0], tail: [-0.12, 0.0, 0] } },
      { t: 2.0, root: [0.01, -0.10, 0], joints: { abdomen: [0.04, -0.08, 0], chest: [0.05, -0.12, 0], head: [-0.18, -0.25, 0], jaw: [0.12, 0, 0], tail: [-0.1, 0.2, 0] } }
    ] },
    roar: { dur: 1.2, loop: false, frames: [
      { t: 0.0, root: [0, -0.10, 0], joints: { abdomen: [0.04, 0, 0], chest: [0.06, 0, 0], head: [-0.1, 0, 0] } },
      { t: 0.22, root: [0, -0.15, -0.04], joints: { abdomen: [0.08, 0, 0], chest: [0.12, 0, 0], head: [0.02, 0, 0], legFL: [-0.4, 0, 0], shinFL: [0.5, 0, 0], legFR: [-0.4, 0, 0], shinFR: [0.5, 0, 0] } },
      { t: 0.48, root: [0, -0.05, 0.05], joints: { abdomen: [-0.06, 0, 0], chest: [-0.10, 0, 0], head: [-0.36, 0, 0], jaw: [0.42, 0, 0], legFL: [-0.2, 0, 0], shinFL: [0.25, 0, 0], legFR: [-0.2, 0, 0], shinFR: [0.25, 0, 0], tail: [0.15, 0, 0] } },
      { t: 0.85, root: [0, -0.08, 0.02], joints: { abdomen: [0.0, 0, 0], chest: [0.02, 0, 0], head: [-0.22, 0, 0], jaw: [0.20, 0, 0], tail: [0.0, 0, 0] } },
      { t: 1.2, root: [0, -0.10, 0], joints: { abdomen: [0.06, 0, 0], chest: [0.08, 0, 0], head: [-0.12, 0, 0], jaw: [0.04, 0, 0], tail: [-0.15, 0, 0] } }
    ] },
    run: { dur: 0.44, loop: true, frames: [
      { t: 0.0, root: [0, 0.02, 0], joints: { pelvis: [0.14, 0, 0], abdomen: [-0.08, 0, 0], chest: [-0.08, 0, 0], head: [-0.15, 0, 0], legFL: [-0.68, 0, 0], shinFL: [0.42, 0, 0], legFR: [-0.35, 0, 0], shinFR: [0.25, 0, 0], legBL: [0.62, 0, 0], shinBL: [-0.48, 0, 0], legBR: [0.32, 0, 0], shinBR: [-0.25, 0, 0], tail: [0.10, 0.15, 0] } },
      { t: 0.11, root: [0, -0.02, 0], joints: { pelvis: [0.02, 0, 0], abdomen: [0.0, 0, 0], chest: [0.02, 0, 0], head: [-0.18, 0, 0], legFL: [-0.10, 0, 0], shinFL: [0.65, 0, 0], legFR: [0.10, 0, 0], shinFR: [0.55, 0, 0], legBL: [0.10, 0, 0], shinBL: [-0.60, 0, 0], legBR: [-0.10, 0, 0], shinBR: [-0.50, 0, 0], tail: [0.0, 0.0, 0] } },
      { t: 0.22, root: [0, -0.05, 0], joints: { pelvis: [-0.14, 0, 0], abdomen: [0.08, 0, 0], chest: [0.10, 0, 0], head: [-0.20, 0, 0], legFL: [0.58, 0, 0], shinFL: [0.35, 0, 0], legFR: [0.32, 0, 0], shinFR: [0.20, 0, 0], legBL: [-0.58, 0, 0], shinBL: [-0.38, 0, 0], legBR: [-0.28, 0, 0], shinBR: [-0.22, 0, 0], tail: [-0.10, -0.15, 0] } },
      { t: 0.33, root: [0, -0.01, 0], joints: { pelvis: [0.02, 0, 0], abdomen: [0.0, 0, 0], chest: [0.02, 0, 0], head: [-0.18, 0, 0], legFL: [-0.35, 0, 0], shinFL: [0.75, 0, 0], legFR: [-0.20, 0, 0], shinFR: [0.65, 0, 0], legBL: [0.35, 0, 0], shinBL: [-0.70, 0, 0], legBR: [0.20, 0, 0], shinBR: [-0.60, 0, 0], tail: [0.0, 0.0, 0] } },
      { t: 0.44, root: [0, 0.02, 0], joints: { pelvis: [0.14, 0, 0], abdomen: [-0.08, 0, 0], chest: [-0.08, 0, 0], head: [-0.15, 0, 0], legFL: [-0.68, 0, 0], shinFL: [0.42, 0, 0], legFR: [-0.35, 0, 0], shinFR: [0.25, 0, 0], legBL: [0.62, 0, 0], shinBL: [-0.48, 0, 0], legBR: [0.32, 0, 0], shinBR: [-0.25, 0, 0], tail: [0.10, 0.15, 0] } }
    ] }
  }
};

const _RADIUS_BY_TYPE = { skeleton: 0.34, cultist: 0.36, wraith: 0.42, hero: 0.42, boss: 0.85, hellhound: 0.36 };
const _TOP_BY_TYPE = { skeleton: 1.85, cultist: 1.80, wraith: 2.10, hero: 1.85, boss: 4.30, hellhound: 1.05 };

function _sampleClip(out, clip, timeSec) {
  const dur = Math.max(0.01, clip.dur);
  let t = timeSec;
  out.done = false;
  if (clip.loop) {
    t = ((t % dur) + dur) % dur;
  } else if (t >= dur) {
    t = dur;
    out.done = true;
  } else if (t < 0) {
    t = 0;
  }
  const fr = clip.frames;
  let i0 = fr.length - 2;
  for (let i = 0; i < fr.length - 1; i++) {
    if (t <= fr[i + 1].t) {
      i0 = i;
      break;
    }
  }
  out.f0 = fr[i0];
  out.f1 = fr[i0 + 1];
  const u = clamp01((t - out.f0.t) / Math.max(1e-5, out.f1.t - out.f0.t));
  out.u = u * u * (3.0 - 2.0 * u);
  return out;
}

function _evalJointRot(out, s, limbId, sway, fig) {
  const j0 = s.f0.joints[limbId], j1 = s.f1.joints[limbId];
  const a0 = j0 ? j0[0] : 0, a1 = j0 ? j0[1] : 0, a2 = j0 ? j0[2] : 0;
  let rx = lerp(a0, j1 ? j1[0] : a0, s.u);
  let ry = lerp(a1, j1 ? j1[1] : a1, s.u);
  let rz = lerp(a2, j1 ? j1[2] : a2, s.u);

  // Gedämpftes Nachfedern (Zustand aus fig._springs ohne Objektallokationen)
  if (sway && fig._springs[sway]) {
    const sp = fig._springs[sway];
    rx += sp.x;
    ry += sp.y;
    rz += sp.z;
  }

  // Kopf dreht sich weich zum Ziel (lookAt)
  if (limbId === "head" && fig.lookAt) {
    const lx = fig.lookAt[0] - fig.x, lz = fig.lookAt[2] - fig.z;
    const ly = fig.lookAt[1] - (fig.y + riverWaterY(fig.waterZ !== undefined ? fig.waterZ : fig.z) + fig.top * 0.85);
    let rel = Math.atan2(lx, lz) - fig.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    ry = lerp(ry, Math.max(-0.9, Math.min(0.9, rel)), 0.8);
    rx = lerp(rx, Math.max(-0.4, Math.min(0.4, -Math.atan2(ly, Math.hypot(lx, lz)))), 0.6);
  }
  out[0] = rx;
  out[1] = ry;
  out[2] = rz;
}

// Zwei-Knochen-IK in der Sagittalebene (Oberschenkel L1, Unterschenkel L2) hält Fuß auf Bodenhöhe yGround
function _solveLegIK(fig, thighIdx, shinIdx, footIdx, yGround, stepOut) {
  const spec = fig._spec;
  const thigh = spec.limbs[thighIdx];
  const shin = spec.limbs[shinIdx];
  const foot = spec.limbs[footIdx];
  const s = fig.scale || 1.0;

  const L1 = Math.hypot(shin.pivot[0], shin.pivot[1], shin.pivot[2]) * s;
  const L2 = Math.hypot(foot.pivot[0], foot.pivot[1], foot.pivot[2]) * s;
  const ankleH = 0.06 * s;

  // Hüftposition in Weltkoordinaten aus Elternglied (pelvis)
  const pelvisW = fig._world[thigh.parentIdx];
  _pfMulMatVec(_V_HIP_W, pelvisW, thigh.pivot[0], thigh.pivot[1], thigh.pivot[2]);
  // Aktuelle Knöchelposition aus der FK-Berechnung
  _pfMulMatVec(_V_ANKLE_W, fig._world[shinIdx], foot.pivot[0], foot.pivot[1], foot.pivot[2]);

  const targetY = yGround + ankleH;
  // Bodenkontakt: Wenn Fuß nahe am Boden (kein hoher Schwung), pinne ihn auf targetY
  if (_V_ANKLE_W[1] < targetY + 0.08 * s && _V_ANKLE_W[1] > targetY - 0.14 * s) {
    const dy = _V_HIP_W[1] - targetY;
    const dx = _V_ANKLE_W[0] - _V_HIP_W[0];
    const dz = _V_ANKLE_W[2] - _V_HIP_W[2];
    const horiz = Math.hypot(dx, dz);
    const dist = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, Math.hypot(horiz, dy)));

    // Kniebeugung nach Law of Cosines
    const cosKnee = clamp01((dist * dist - L1 * L1 - L2 * L2) / (2.0 * L1 * L2 + 1e-6));
    const kneeFlex = Math.acos(Math.max(-1.0, Math.min(1.0, (L1 * L1 + L2 * L2 - dist * dist) / (2.0 * L1 * L2 + 1e-6))));
    const bend = Math.PI - kneeFlex;

    // Vorwärtskomponente in Figur-Raum
    const sinY = Math.sin(fig.yaw), cosY = Math.cos(fig.yaw);
    const fwdDist = dx * sinY + dz * cosY;
    const pitchToTarget = Math.atan2(fwdDist, Math.max(1e-4, dy));
    const hipOffset = Math.acos(Math.max(-1.0, Math.min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2.0 * L1 * dist + 1e-6))));

    const rxThigh = -(pitchToTarget + hipOffset);
    const rxShin = bend;

    // Oberschenkel- und Unterschenkel-Matrizen lokal neu zusammensetzen
    _PF_POS[0] = thigh.pivot[0]; _PF_POS[1] = thigh.pivot[1]; _PF_POS[2] = thigh.pivot[2];
    Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, rxThigh, 0, _PF_ONE);
    Mat4.multiply(fig._world[thighIdx], pelvisW, _M_PARENT_TMP);

    _PF_POS[0] = shin.pivot[0]; _PF_POS[1] = shin.pivot[1]; _PF_POS[2] = shin.pivot[2];
    Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, rxShin, 0, _PF_ONE);
    Mat4.multiply(fig._world[shinIdx], fig._world[thighIdx], _M_PARENT_TMP);

    // Fuß waagerecht auf dem Boden halten
    _PF_POS[0] = foot.pivot[0]; _PF_POS[1] = foot.pivot[1]; _PF_POS[2] = foot.pivot[2];
    Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, -(rxThigh + rxShin), 0, _PF_ONE);
    Mat4.multiply(fig._world[footIdx], fig._world[shinIdx], _M_PARENT_TMP);
  }
}

// Zwei-Knochen-IK für den Waffenarm (Oberarm + Unterarm + Waffe) im Treffermoment
function _solveStrikeIK(fig, weight) {
  if (!fig.strikeAt || weight <= 1e-3) return;
  const spec = fig._spec;
  const armIdx = spec.byId["armR"];
  const foreIdx = spec.byId["forearmR"];
  const handIdx = spec.byId["handR"];
  let weapIdx = -1;
  for (let i = 0; i < spec.limbs.length; i++) {
    if (spec.limbs[i].tip) {
      weapIdx = i;
      break;
    }
  }
  if (armIdx === undefined || foreIdx === undefined || weapIdx < 0) return;

  const arm = spec.limbs[armIdx];
  const fore = spec.limbs[foreIdx];
  const hand = spec.limbs[handIdx];
  const weap = spec.limbs[weapIdx];
  const s = fig.scale || 1.0;

  const clavW = fig._world[arm.parentIdx];
  _pfMulMatVec(_V_SHOULDER_W, clavW, arm.pivot[0], arm.pivot[1], arm.pivot[2]);

  const tx = fig.strikeAt[0] - _V_SHOULDER_W[0];
  const ty = fig.strikeAt[1] - _V_SHOULDER_W[1];
  const tz = fig.strikeAt[2] - _V_SHOULDER_W[2];

  // Zielrichtung in Figur-Koordinaten transformieren
  const sinY = Math.sin(fig.yaw), cosY = Math.cos(fig.yaw);
  const lx = tx * cosY - tz * sinY;
  const ly = ty;
  const lz = tx * sinY + tz * cosY;

  const L1 = Math.hypot(fore.pivot[0], fore.pivot[1], fore.pivot[2]) * s;
  const L2 = (Math.hypot(hand.pivot[0], hand.pivot[1], hand.pivot[2]) + Math.hypot(weap.tip[0], weap.tip[1], weap.tip[2])) * s;
  const dist = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, Math.hypot(lx, ly, lz)));

  const pitchTarget = -Math.atan2(lz, -ly);
  const yawTarget = Math.atan2(lx, Math.hypot(ly, lz));
  const shoulderOff = Math.acos(Math.max(-1.0, Math.min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2.0 * L1 * dist + 1e-6))));
  const elbowAng = Math.PI - Math.acos(Math.max(-1.0, Math.min(1.0, (L1 * L1 + L2 * L2 - dist * dist) / (2.0 * L1 * L2 + 1e-6))));

  const rxArm = lerp(fig._lastArmRot[0], pitchTarget - shoulderOff * 0.5, weight);
  const ryArm = lerp(fig._lastArmRot[1], yawTarget, weight);
  const rzArm = lerp(fig._lastArmRot[2], 0.0, weight);
  const rxFore = lerp(fig._lastForeRot[0], -elbowAng * 0.65, weight);

  _PF_POS[0] = arm.pivot[0]; _PF_POS[1] = arm.pivot[1]; _PF_POS[2] = arm.pivot[2];
  Mat4.compose(_M_PARENT_TMP, _PF_POS, ryArm, rxArm, rzArm, _PF_ONE);
  Mat4.multiply(fig._world[armIdx], clavW, _M_PARENT_TMP);

  _PF_POS[0] = fore.pivot[0]; _PF_POS[1] = fore.pivot[1]; _PF_POS[2] = fore.pivot[2];
  Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, rxFore, 0, _PF_ONE);
  Mat4.multiply(fig._world[foreIdx], fig._world[armIdx], _M_PARENT_TMP);

  _PF_POS[0] = hand.pivot[0]; _PF_POS[1] = hand.pivot[1]; _PF_POS[2] = hand.pivot[2];
  Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, 0, 0, _PF_ONE);
  Mat4.multiply(fig._world[handIdx], fig._world[foreIdx], _M_PARENT_TMP);

  _PF_POS[0] = weap.pivot[0]; _PF_POS[1] = weap.pivot[1]; _PF_POS[2] = weap.pivot[2];
  Mat4.compose(_M_PARENT_TMP, _PF_POS, 0, 0, 0, _PF_ONE);
  Mat4.multiply(fig._world[weapIdx], fig._world[handIdx], _M_PARENT_TMP);
}

const _S_CUR = { f0: null, f1: null, u: 0, done: false };
const _S_PREV = { f0: null, f1: null, u: 0, done: false };
const _S_DELAYED = { f0: null, f1: null, u: 0, done: false };
const _J_CUR = [0, 0, 0], _J_PREV = [0, 0, 0];

function _computeFigureMatrices(fig) {
  const spec = fig._spec, limbs = spec.limbs, s = fig.scale || 1.0;
  const bank = _CLIPS[fig.type];
  const activeClip = bank[fig.clip] || bank[Object.keys(bank)[0]];
  const cur = _sampleClip(_S_CUR, activeClip, fig._clipTime);
  fig._done = cur.done;
  const fading = fig._fadeRem > 0 && fig._fadeDur > 1e-4 && fig._prevClip;
  const prev = fading ? _sampleClip(_S_PREV, bank[fig._prevClip], fig._prevClipTime) : null;
  const w = fading ? 1.0 - smoothstep(0.0, 1.0, 1.0 - fig._fadeRem / fig._fadeDur) : 0.0;

  const rootOf = (smp, k) => lerp(smp.f0.root[k], smp.f1.root[k], smp.u);
  const rdx = (fading ? lerp(rootOf(cur, 0), rootOf(prev, 0), w) : rootOf(cur, 0)) * s;
  const rdy = (fading ? lerp(rootOf(cur, 1), rootOf(prev, 1), w) : rootOf(cur, 1)) * s;
  const rdz = (fading ? lerp(rootOf(cur, 2), rootOf(prev, 2), w) : rootOf(cur, 2)) * s;

  const waterBase = riverWaterY(fig.waterZ !== undefined ? fig.waterZ : fig.z);
  _PF_POS[0] = fig.x;
  _PF_POS[1] = fig.y + waterBase;
  _PF_POS[2] = fig.z;
  _PF_ONE[0] = _PF_ONE[1] = _PF_ONE[2] = s;
  Mat4.compose(_M_TMP, _PF_POS, fig.yaw, 0, 0, _PF_ONE);
  _PF_ONE[0] = _PF_ONE[1] = _PF_ONE[2] = 1;

  for (let i = 0; i < limbs.length; i++) {
    const l = limbs[i];
    // Zeitversetzung pro Glied: Rumpf zuerst, Gliedmaßen/Waffe 0.05..0.10 s später
    const smpCur = l.delay > 0 ? _sampleClip(_S_DELAYED, activeClip, fig._clipTime - l.delay) : cur;
    _evalJointRot(_J_CUR, smpCur, l.id, l.sway, fig);
    if (fading) {
      const smpPrev = l.delay > 0 ? _sampleClip(_S_PREV, bank[fig._prevClip], fig._prevClipTime - l.delay) : prev;
      _evalJointRot(_J_PREV, smpPrev, l.id, l.sway, fig);
      for (let k = 0; k < 3; k++) _J_CUR[k] = lerp(_J_CUR[k], _J_PREV[k], w);
    }

    if (l.id === "armR") {
      fig._lastArmRot[0] = _J_CUR[0];
      fig._lastArmRot[1] = _J_CUR[1];
      fig._lastArmRot[2] = _J_CUR[2];
    } else if (l.id === "forearmR") {
      fig._lastForeRot[0] = _J_CUR[0];
      fig._lastForeRot[1] = _J_CUR[1];
      fig._lastForeRot[2] = _J_CUR[2];
    }

    _PF_POS[0] = l.pivot[0]; _PF_POS[1] = l.pivot[1]; _PF_POS[2] = l.pivot[2];
    if (l.parentIdx < 0) {
      _PF_POS[0] += rdx / s;
      _PF_POS[1] += rdy / s;
      _PF_POS[2] += rdz / s;
    }
    Mat4.compose(_M_PARENT_TMP, _PF_POS, _J_CUR[1], _J_CUR[0], _J_CUR[2], _PF_ONE);
    Mat4.multiply(fig._world[i], l.parentIdx < 0 ? _M_TMP : fig._world[l.parentIdx], _M_PARENT_TMP);
  }

  // Zwei-Knochen-IK für Zweibeiner (Füße bleiben auf dem Boden, wenn die Figur nicht gerade aufsteht/fällt)
  if (spec.byId["footL"] !== undefined && fig.clip !== "rise" && fig.clip !== "death") {
    const yGround = fig.y + waterBase;
    _solveLegIK(fig, spec.byId["thighL"], spec.byId["shinL"], spec.byId["footL"], yGround, 0);
    _solveLegIK(fig, spec.byId["thighR"], spec.byId["shinR"], spec.byId["footR"], yGround, 1);
  }

  // Zwei-Knochen-IK für den Waffenarm im Treffermoment (strikeAt)
  if (fig.strikeAt && activeClip.strikeTime !== undefined) {
    const dtStrike = Math.abs(fig._clipTime - activeClip.strikeTime);
    const ikW = 1.0 - smoothstep(0.02, 0.22, dtStrike);
    if (ikW > 0.0) _solveStrikeIK(fig, ikW);
  }
}

// Gedämpfte Federphysik für Umhang, Mantelbahnen, Schwanz und Kiefer aktualisieren (keine Allokationen)
function _updateFigureSprings(fig, dt) {
  const sp = fig._springs;
  const k = 28.0;    // Federkonstante
  const damp = 7.5;  // Dämpfung

  // Umhang / Schwanz
  if (sp.cape) {
    const targetX = 0.14 + fig._speed * 0.28 + Math.sin(fig._phase * 2.1) * 0.05;
    const targetZ = -fig._velX * 0.14 + Math.cos(fig._phase * 1.7) * 0.04;
    sp.cape.vx += ((targetX - sp.cape.x) * k - sp.cape.vx * damp) * dt;
    sp.cape.vz += ((targetZ - sp.cape.z) * k - sp.cape.vz * damp) * dt;
    sp.cape.x += sp.cape.vx * dt;
    sp.cape.z += sp.cape.vz * dt;
  }

  // Kiefer (federt bei Brüllen, Laufen und Atmen leicht nach)
  if (sp.jaw) {
    const targetJaw = (fig.clip === "roar" ? 0.32 : 0.03) + Math.abs(Math.sin(fig._phase * 1.8)) * 0.04;
    sp.jaw.vx += ((targetJaw - sp.jaw.x) * 42.0 - sp.jaw.vx * 8.5) * dt;
    sp.jaw.x += sp.jaw.vx * dt;
  }

  // Mantelbahnen (Wraith)
  for (let m = 1; m <= 4; m++) {
    const key = "mantle" + m;
    if (sp[key]) {
      const sObj = sp[key];
      const targetX = 0.22 + fig._speed * 0.35 + Math.sin(fig._phase * 2.8 + m * 1.2) * 0.10;
      const targetY = Math.cos(fig._phase * 2.2 + m * 0.9) * 0.09;
      sObj.vx += ((targetX - sObj.x) * 24.0 - sObj.vx * 6.5) * dt;
      sObj.vy += ((targetY - sObj.y) * 24.0 - sObj.vy * 6.5) * dt;
      sObj.x += sObj.vx * dt;
      sObj.y += sObj.vy * dt;
    }
  }
}

// --- Öffentliche Schnittstelle ---
function spawnProcFigure(name, o = {}) {
  const type = _CLIPS[name] ? name : "skeleton";
  const spec = _getFigureSpec(type);
  const bank = _CLIPS[type];
  const scale = o.scale !== undefined ? o.scale : 1.0;
  const fig = {
    type, x: o.x || 0, y: o.y || 0, z: o.z || 0, yaw: o.yaw || 0, scale,
    tint: o.tint ? [o.tint[0], o.tint[1], o.tint[2], 1] : [1, 1, 1, 1],
    clip: bank[o.clip] ? o.clip : Object.keys(bank)[0],
    clipNames: Object.keys(bank),
    visible: o.visible !== undefined ? !!o.visible : true,
    lookAt: null,
    strikeAt: null,
    waterZ: o.waterZ,
    radius: _RADIUS_BY_TYPE[type] * scale,
    top: _TOP_BY_TYPE[type] * scale,
    _spec: spec,
    _world: spec.limbs.map(() => Mat4.create()),
    _lastArmRot: [0, 0, 0],
    _lastForeRot: [0, 0, 0],
    _springs: {
      cape: { x: 0.14, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      jaw: { x: 0.02, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      mantle1: { x: 0.22, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      mantle2: { x: 0.22, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      mantle3: { x: 0.22, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      mantle4: { x: 0.22, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
    },
    _clipTime: 0, _clipSpeed: 1.0, _prevClip: null, _prevClipTime: 0, _fadeRem: 0, _fadeDur: 0, _done: false,
    _phase: hash2(o.x || 0, o.z || 0) * 6.2831853,
    _lastX: o.x || 0, _lastZ: o.z || 0, _velX: 0, _velZ: 0, _speed: 0,
    play(nextClip, fade = 0.2, speed = 1) {
      const target = bank[nextClip] ? nextClip : this.clip;
      if (target === this.clip && !this.clipDone()) {
        this._clipSpeed = speed;
        return true;
      }
      if (target !== this.clip && fade > 0) {
        this._prevClip = this.clip;
        this._prevClipTime = this._clipTime;
        this._fadeDur = fade;
        this._fadeRem = fade;
      } else {
        this._fadeRem = 0;
        this._fadeDur = 0;
      }
      this.clip = target;
      this._clipTime = 0;
      this._clipSpeed = speed || 1.0;
      this._done = false;
      return true;
    },
    clipDone() {
      const c = bank[this.clip];
      return !c.loop && this._clipTime >= c.dur - 1e-4;
    },
    tipWorld(out) {
      const limbs = this._spec.limbs;
      for (let i = 0; i < limbs.length; i++) {
        if (limbs[i].tip) {
          return _pfMulMatVec(out || _V_TIP_WORLD, this._world[i], limbs[i].tip[0], limbs[i].tip[1], limbs[i].tip[2]);
        }
      }
      return null;
    }
  };
  _computeFigureMatrices(fig);
  _PF_FIGS.push(fig);
  return fig;
}

function removeProcFigure(fig) {
  const i = _PF_FIGS.indexOf(fig);
  if (i >= 0) _PF_FIGS.splice(i, 1);
}

function updateProcFigures(dt, cam) {
  _PF_FRAME++;
  const stepDt = Math.max(0.0, Math.min(0.1, dt || 0));
  for (let i = 0; i < _PF_FIGS.length; i++) {
    const fig = _PF_FIGS[i];
    if (!fig.visible) {
      fig._lastX = fig.x;
      fig._lastZ = fig.z;
      continue;
    }
    if (stepDt > 0) {
      const vx = (fig.x - fig._lastX) / stepDt;
      const vz = (fig.z - fig._lastZ) / stepDt;
      fig._velX = Math.max(-1, Math.min(1, vx / 6.0));
      fig._velZ = Math.max(-1, Math.min(1, vz / 6.0));
      fig._speed = Math.min(1, Math.hypot(vx, vz) / 4.0);
      fig._lastX = fig.x;
      fig._lastZ = fig.z;
      fig._phase += stepDt * (1.2 + fig._speed * 3.0);
      fig._clipTime += stepDt * fig._clipSpeed;
      if (fig._fadeRem > 0) {
        fig._fadeRem = Math.max(0, fig._fadeRem - stepDt);
        fig._prevClipTime += stepDt;
      }
      _updateFigureSprings(fig, stepDt);
    }
    if (cam) {
      const dx = fig.x - cam[0], dz = fig.z - cam[2];
      if (dx * dx + dz * dz > 35.0 * 35.0 && ((_PF_FRAME + i) & 1) === 1) continue;
    }
    _computeFigureMatrices(fig);
  }
}

function collectProcFigureDraws(take) {
  for (let i = 0; i < _PF_FIGS.length; i++) {
    const fig = _PF_FIGS[i];
    if (!fig.visible) continue;
    const limbs = fig._spec.limbs;
    for (let j = 0; j < limbs.length; j++) {
      const d = take(limbs[j].mesh, fig.tint);
      if (!d) return;
      d.model.set(fig._world[j]);
    }
  }
}

// --- Kollisions- und Freiraumprüfung für das Verlies ---
function vaultClearanceReport() {
  if (typeof _initVaultFigures === "function") _initVaultFigures();
  const violations = [];
  const pillarsZ = [-174, -194, -214, -232];

  // Figuren und ihre verwendeten Clips/Positionen im Verlies
  const testCases = [
    { name: "skelGuardA", fig: _vault.figs.skelGuardA, clips: ["idle", "alert", "look", "walk"], x: _vault.figs.skelGuardA.x, y: _vault.figs.skelGuardA.y, z: _vault.figs.skelGuardA.z, yaw: _vault.figs.skelGuardA.yaw },
    { name: "skelGuardB", fig: _vault.figs.skelGuardB, clips: ["idle", "roar"], x: _vault.figs.skelGuardB.x, y: _vault.figs.skelGuardB.y, z: _vault.figs.skelGuardB.z, yaw: _vault.figs.skelGuardB.yaw },
    { name: "cultist", fig: _vault.figs.cultist, clips: ["idle", "summon", "cast", "alert"], x: _vault.figs.cultist.x, y: _vault.figs.cultist.y, z: _vault.figs.cultist.z, yaw: _vault.figs.cultist.yaw },
    { name: "skelRitual", fig: _vault.figs.skelRitual, clips: ["rise", "idle"], x: _vault.figs.skelRitual.x, y: _vault.figs.skelRitual.y, z: _vault.figs.skelRitual.z, yaw: _vault.figs.skelRitual.yaw },
    { name: "wraith", fig: _vault.figs.wraith, clips: ["rush", "shriek"], x: riverCenterX(-208.0), y: 0.45, z: -208.0, yaw: 0.0 },
    { name: "wraithPass", fig: _vault.figs.wraith, clips: ["rush"], x: riverCenterX(-202.0), y: 2.35, z: -202.0, yaw: 0.0 },
    { name: "hero", fig: _vault.figs.hero, clips: ["idle", "attack1", "attack2", "attack3", "heavy", "block", "victory"], x: _vault.figs.hero.x, y: _vault.figs.hero.y, z: _vault.figs.hero.z, yaw: _vault.figs.hero.yaw },
    { name: "boss", fig: _vault.figs.boss, clips: ["idle", "roar", "attack", "hit", "death"], x: _vault.figs.boss.x, y: _vault.figs.boss.y, z: _vault.figs.boss.z, yaw: _vault.figs.boss.yaw },
    { name: "hellhound", fig: _vault.figs.hellhound, clips: ["idle", "look", "roar", "run"], x: _vault.figs.hellhound.x, y: _vault.figs.hellhound.y, z: _vault.figs.hellhound.z, yaw: _vault.figs.hellhound.yaw }
  ];

  for (let tc = 0; tc < testCases.length; tc++) {
    const item = testCases[tc];
    const fig = item.fig;
    if (!fig) continue;

    // Zustand sichern
    const saved = { x: fig.x, y: fig.y, z: fig.z, yaw: fig.yaw, clip: fig.clip, time: fig._clipTime, fade: fig._fadeRem };
    fig.x = item.x;
    fig.y = item.y;
    fig.z = item.z;
    fig.yaw = item.yaw;
    fig._fadeRem = 0;

    for (let c = 0; c < item.clips.length; c++) {
      const clipName = item.clips[c];
      const clipObj = _CLIPS[fig.type][clipName];
      if (!clipObj) continue;
      fig.clip = clipName;

      for (let step = 0; step < 12; step++) {
        const tSample = (step / 11) * clipObj.dur;
        fig._clipTime = tSample;
        _computeFigureMatrices(fig);

        const limbs = fig._spec.limbs;
        for (let l = 0; l < limbs.length; l++) {
          const limb = limbs[l];
          const wMat = fig._world[l];
          for (let sIdx = 0; sIdx < limb.spheres.length; sIdx++) {
            const sp = limb.spheres[sIdx];
            _pfMulMatVec(_V_SPHERE_W, wMat, sp.c[0], sp.c[1], sp.c[2]);
            const sx = _V_SPHERE_W[0], sy = _V_SPHERE_W[1], sz = _V_SPHERE_W[2];
            const sr = sp.r * (fig.scale || 1.0);

            const cx = riverCenterX(sz);
            const hw = riverHalfWidth(sz);
            const relX = sx - cx; // > 0 rechts, < 0 links

            // 1. Nische (rechts, z -184.2 bis -195.8) & Podest (links, z -219.8 bis -232.2)
            const inNicheZ = sz <= -184.2 && sz >= -195.8;
            const inPedestalZ = sz <= -219.8 && sz >= -232.2;

            if (inNicheZ && relX > hw + 1.55) {
              // Rückwand Nische bei +5.6 ab Flussufer (relX > hw + 5.6)
              const penBack = (relX + sr) - (hw + 5.6);
              if (penBack > 0) violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Nische Rückwand", tiefe: +penBack.toFixed(3) });
              const penCeil = (sy + sr) - 7.5;
              if (penCeil > 0) violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Nische Decke", tiefe: +penCeil.toFixed(3) });
            } else if (inPedestalZ && relX < -(hw + 1.55)) {
              // Rückwand Podest bei -7.6 ab Flussufer (relX < -(hw + 7.6))
              const penBack = (-relX + sr) - (hw + 7.6);
              if (penBack > 0) violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Podest Rückwand", tiefe: +penBack.toFixed(3) });
              const penCeil = (sy + sr) - 8.2;
              if (penCeil > 0) violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Podest Decke", tiefe: +penCeil.toFixed(3) });
            } else if (!((inNicheZ && relX > 0) || (inPedestalZ && relX < 0))) {
              // Reguläre Gangwände: Innenseite bei riverHalfWidth(z) + 1.6 (nicht vor den Öffnungen von Nische und Podest)
              const wallDist = hw + 1.6;
              const penWall = (Math.abs(relX) + sr) - wallDist;
              if (penWall > 0) {
                violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: relX > 0 ? "Gangwand rechts" : "Gangwand links", tiefe: +penWall.toFixed(3) });
              }
              // Gewölbe über dem Gang: ab 5.4 m an der Wand bis Scheitel 10.5 m in der Mitte
              const normX = Math.min(1.0, Math.abs(relX) / wallDist);
              const vaultH = 5.4 + (10.5 - 5.4) * Math.sqrt(Math.max(0.0, 1.0 - normX * normX));
              const penVault = (sy + sr) - vaultH;
              if (penVault > 0) {
                violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Gewölbe", tiefe: +penVault.toFixed(3) });
              }
            }

            // 2. Säulen bei relX = ±(hw + 1.25), z = -174, -194, -214, -232, Radius 0.35 m
            for (let p = 0; p < pillarsZ.length; p++) {
              const pz = pillarsZ[p];
              if (Math.abs(sz - pz) > 1.5) continue;
              const pCx = riverCenterX(pz);
              const pHw = riverHalfWidth(pz);
              for (const side of [-1, 1]) {
                const px = pCx + side * (pHw + 1.25);
                const distP = Math.hypot(sx - px, sz - pz);
                const penPillar = (0.35 + sr) - distP;
                if (penPillar > 0) {
                  violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: `Säule (${side > 0 ? "R" : "L"} z=${pz})`, tiefe: +penPillar.toFixed(3) });
                }
              }
            }

            // 3. Boot: Mitte relX ±0.9 m, halbe Breite 1.0 m, bis y = 1.3 m (wenn Figur über dem Fluss ist)
            // nur für den Überflug: beim Anflug ist das Boot noch weit weg (die Szene hält 4,5 m Abstand vor der Kamera)
            if (item.name === "wraithPass" && Math.abs(relX) < 1.9 + sr && sy - sr < 1.3 && sy + sr > 0.0) {
              const penBoatX = (1.0 + sr) - Math.max(0.0, Math.abs(relX) - 0.9);
              const penBoatY = 1.3 - (sy - sr);
              const penBoat = Math.min(penBoatX, penBoatY);
              if (penBoat > 0) {
                violations.push({ figur: item.name, clip: clipName, zeit: +tSample.toFixed(2), glied: limb.id, hindernis: "Boot", tiefe: +penBoat.toFixed(3) });
              }
            }
          }
        }
      }
    }

    // Zustand wiederherstellen
    fig.x = saved.x;
    fig.y = saved.y;
    fig.z = saved.z;
    fig.yaw = saved.yaw;
    fig.clip = saved.clip;
    fig._clipTime = saved.time;
    fig._fadeRem = saved.fade;
    _computeFigureMatrices(fig);
  }

  return violations;
}