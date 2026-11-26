// procfig.js: prozedurale Glieder-Figuren für das Verlies (Entwurf von Gemini, eingebaut und korrigiert)
// Jede Figur besteht aus starren Gliedern (je ein kleines sdfMesh, Ursprung im Gelenk). Pro Bild werden aus
// Schlüsselbildern Gelenkwinkel gerechnet, daraus die Weltmatrizen der Glieder; gezeichnet wird über die Tiere
// (creatures.js, take). Material 40: e0..e2 = sRGB-Grundfarbe, u = Leuchtmaske.

const _PF_CACHE = Object.create(null);
const _PF_FIGS = [];
let _PF_FRAME = 0;
const _M_TMP = Mat4.create();
const _M_PARENT_TMP = Mat4.create();
const _V_TIP_WORLD = [0, 0, 0];
const _PF_POS = [0, 0, 0];
const _PF_ONE = [1, 1, 1];

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
function _smin(a, b, k) {
  const h = clamp01(0.5 + 0.5 * (b - a) / (k + 1e-6));
  return lerp(b, a, h) - k * h * (1.0 - h);
}
function _smax(a, b, k) { return -_smin(-a, -b, k); }

// Glied aus einer Abstandsfunktion, Material 40
function _buildLimbSdf(fn, minB, maxB, step, col, glow = 0.0, grain = 0.008) {
  return sdfMesh(fn, minB, maxB, step, (b, p, n) => {
    const nl = Math.hypot(n[0], n[1], n[2]) + 1e-8;
    const shade = grain > 0 ? 1.0 + (fbm2(p[0] * 14.0 + 3.1, p[1] * 14.0 + p[2] * 14.0, 2) - 0.5) * grain * 18.0 : 1.0;
    b.pushVertex(p[0], p[1], p[2], n[0] / nl, n[1] / nl, n[2] / nl, glow, 0.0, clamp01(col[0] * shade), clamp01(col[1] * shade), clamp01(col[2] * shade), 40);
  });
}
// Kantiges Teil (Klinge, Platte, Auge) in Material 40 mit eigener Farbe und Leuchtmaske.
// addBox schreibt sonst UV-Ecken (0/1) und (0.85, extraY, 0) als Extras, das wäre bei Material 40 rot und halb leuchtend.
function _pfBox(b, c, size, rotY, rotZ, col, glow = 0.0) {
  const n0 = b.positions.length / 3;
  addBox(b, c, size, rotY, rotZ, 40, 0.0);
  const n1 = b.positions.length / 3;
  for (let i = n0; i < n1; i++) {
    b.uvs[i * 2] = glow; b.uvs[i * 2 + 1] = 0.0;
    b.extras[i * 3] = col[0]; b.extras[i * 3 + 1] = col[1]; b.extras[i * 3 + 2] = col[2];
  }
}
const _EYE_RED = [1.0, 0.35, 0.12], _EYE_GREEN = [0.45, 1.0, 0.5], _EMBER = [1.0, 0.38, 0.08];

// --- Glieder je Art: id, parent (null = Wurzel), pivot (im Elternglied), build, tip (Waffenspitze), sway ---
function _makeLimbDefs(type) {
  if (type === "skeleton") {
    const bone = [0.76, 0.73, 0.64], darkBone = [0.56, 0.53, 0.46], blade = [0.40, 0.33, 0.28];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.92, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.14, 0.08, 0.11]), _sdCapsule(p, [-0.11, 0.02, 0], [0.11, 0.02, 0], 0.045), 0.03),
        [-0.20, -0.12, -0.16], [0.20, 0.12, 0.16], 0.024, bone) },
      { id: "chest", parent: "pelvis", pivot: [0, 0.06, 0], build: () => {
        const b = _buildLimbSdf((p) => {
          const spine = _sdCapsule(p, [0, 0, -0.02], [0, 0.42, 0.04], 0.04);
          const ribs = _smin(_smin(_sdEllipsoid(p, [0, 0.12, 0.03], [0.14, 0.035, 0.11]), _sdEllipsoid(p, [0, 0.22, 0.04], [0.16, 0.04, 0.125]), 0.02), _sdEllipsoid(p, [0, 0.32, 0.04], [0.15, 0.04, 0.12]), 0.02);
          return _smin(spine, ribs, 0.035);
        }, [-0.22, -0.06, -0.14], [0.22, 0.48, 0.20], 0.025, bone);
        for (let i = 0; i < 4; i++) _pfBox(b, [0, 0.11 + i * 0.075, 0.04], [(0.13 + Math.sin((i / 3) * Math.PI) * 0.04) * 1.85, 0.028, 0.17], 0, 0.08, darkBone);
        return b;
      } },
      { id: "head", parent: "chest", pivot: [0, 0.45, 0.05], build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.10, 0.02], [0.105, 0.115, 0.12]), _sdEllipsoid(p, [0, 0.01, 0.04], [0.075, 0.045, 0.085]), 0.025),
          [-0.15, -0.06, -0.12], [0.15, 0.24, 0.18], 0.022, bone);
        _pfBox(b, [-0.042, 0.105, 0.125], [0.036, 0.032, 0.03], 0, 0, _EYE_RED, 1.0);
        _pfBox(b, [0.042, 0.105, 0.125], [0.036, 0.032, 0.03], 0, 0, _EYE_RED, 1.0);
        return b;
      } },
      { id: "armL", parent: "chest", pivot: [0.19, 0.36, 0.02], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0.05, -0.28, 0.02], 0.036), _sdEllipsoid(p, [0.05, -0.28, 0.02], [0.045, 0.045, 0.045]), 0.02),
        [-0.08, -0.35, -0.08], [0.14, 0.08, 0.10], 0.022, darkBone) },
      { id: "forearmL", parent: "armL", pivot: [0.05, -0.28, 0.02], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0.02, -0.25, 0.09], 0.032), _sdEllipsoid(p, [0.02, -0.25, 0.09], [0.045, 0.035, 0.055]), 0.02),
        [-0.08, -0.32, -0.06], [0.10, 0.08, 0.18], 0.022, bone) },
      { id: "armR", parent: "chest", pivot: [-0.19, 0.36, 0.02], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [-0.05, -0.28, 0.02], 0.036), _sdEllipsoid(p, [-0.05, -0.28, 0.02], [0.045, 0.045, 0.045]), 0.02),
        [-0.14, -0.35, -0.08], [0.08, 0.08, 0.10], 0.022, darkBone) },
      { id: "forearmR", parent: "armR", pivot: [-0.05, -0.28, 0.02], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [-0.02, -0.25, 0.09], 0.032), _sdEllipsoid(p, [-0.02, -0.25, 0.09], [0.045, 0.035, 0.055]), 0.02),
        [-0.10, -0.32, -0.06], [0.08, 0.08, 0.18], 0.022, bone) },
      { id: "bladeR", parent: "forearmR", pivot: [-0.02, -0.25, 0.12], tip: [0, 0, 0.80], build: () => {
        const b = _buildLimbSdf((p) => _sdCapsule(p, [0, 0, -0.05], [0, 0, 0.12], 0.028), [-0.08, -0.08, -0.10], [0.08, 0.08, 0.18], 0.024, darkBone);
        _pfBox(b, [0, 0, 0.46], [0.055, 0.016, 0.68], 0, 0, blade);
        return b;
      } },
      { id: "thighL", parent: "pelvis", pivot: [0.10, -0.04, 0], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [0.01, -0.42, 0.01], 0.042), [-0.08, -0.48, -0.08], [0.10, 0.08, 0.10], 0.025, bone) },
      { id: "shinL", parent: "thighL", pivot: [0.01, -0.42, 0.01], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0, -0.40, -0.01], 0.036), _sdEllipsoid(p, [0, -0.42, 0.05], [0.045, 0.03, 0.10]), 0.02),
        [-0.09, -0.48, -0.10], [0.09, 0.08, 0.17], 0.025, darkBone) },
      { id: "thighR", parent: "pelvis", pivot: [-0.10, -0.04, 0], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [-0.01, -0.42, 0.01], 0.042), [-0.10, -0.48, -0.08], [0.08, 0.08, 0.10], 0.025, bone) },
      { id: "shinR", parent: "thighR", pivot: [-0.01, -0.42, 0.01], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0, -0.40, -0.01], 0.036), _sdEllipsoid(p, [0, -0.42, 0.05], [0.045, 0.03, 0.10]), 0.02),
        [-0.09, -0.48, -0.10], [0.09, 0.08, 0.17], 0.025, darkBone) }
    ];
  }

  if (type === "cultist") {
    const robe = [0.22, 0.20, 0.27], robeDark = [0.15, 0.14, 0.19], handCol = [0.58, 0.53, 0.47];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.90, 0], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0.06, 0], [0, -0.68, 0], 0.17, 0.28), [-0.32, -0.74, -0.28], [0.32, 0.12, 0.28], 0.028, robeDark) },
      { id: "cape", parent: "pelvis", pivot: [0, 0.04, -0.14], sway: "cape", build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0.35, 0], [0, -0.76, -0.10], 0.19, 0.34), [-0.38, -0.82, -0.32], [0.38, 0.40, 0.14], 0.030, robe) },
      { id: "chest", parent: "pelvis", pivot: [0, 0.05, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.22, 0.01], [0.18, 0.24, 0.14]), _sdEllipsoid(p, [0, 0.42, -0.02], [0.16, 0.10, 0.14]), 0.04),
        [-0.24, -0.04, -0.18], [0.24, 0.54, 0.18], 0.026, robe) },
      { id: "head", parent: "chest", pivot: [0, 0.43, 0.02], build: () => {
        // Kapuze, das Gesicht als Höhlung im Schatten, darin zwei glimmende Augen
        const b = _buildLimbSdf((p) => _smax(
          _smin(_sdEllipsoid(p, [0, 0.12, -0.01], [0.145, 0.165, 0.16]), _sdEllipsoid(p, [0, 0.04, 0.06], [0.11, 0.08, 0.11]), 0.03),
          -_sdEllipsoid(p, [0, 0.10, 0.13], [0.075, 0.085, 0.07]), 0.02),
          [-0.18, -0.05, -0.18], [0.18, 0.30, 0.18], 0.024, robeDark);
        _pfBox(b, [-0.03, 0.105, 0.085], [0.022, 0.012, 0.01], 0, 0, _EYE_GREEN, 1.0);
        _pfBox(b, [0.03, 0.105, 0.085], [0.022, 0.012, 0.01], 0, 0, _EYE_GREEN, 1.0);
        return b;
      } },
      { id: "armL", parent: "chest", pivot: [0.20, 0.36, 0], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0.06, -0.28, 0.03], 0.075, 0.062), [-0.05, -0.36, -0.10], [0.16, 0.10, 0.14], 0.024, robe) },
      { id: "forearmL", parent: "armL", pivot: [0.06, -0.28, 0.03], build: () => _buildLimbSdf(
        (p) => _smin(_sdTaper(p, [0, 0, 0], [0.02, -0.22, 0.10], 0.06, 0.048), _sdEllipsoid(p, [0.02, -0.24, 0.12], [0.045, 0.032, 0.055]), 0.02),
        [-0.08, -0.30, -0.06], [0.10, 0.08, 0.20], 0.022, handCol) },
      { id: "armR", parent: "chest", pivot: [-0.20, 0.36, 0], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [-0.06, -0.28, 0.03], 0.075, 0.062), [-0.16, -0.36, -0.10], [0.05, 0.10, 0.14], 0.024, robe) },
      { id: "forearmR", parent: "armR", pivot: [-0.06, -0.28, 0.03], build: () => _buildLimbSdf(
        (p) => _smin(_sdTaper(p, [0, 0, 0], [-0.02, -0.22, 0.10], 0.06, 0.048), _sdEllipsoid(p, [-0.02, -0.24, 0.12], [0.045, 0.032, 0.055]), 0.02),
        [-0.10, -0.30, -0.06], [0.08, 0.08, 0.20], 0.022, handCol) }
    ];
  }

  if (type === "wraith") {
    const shroud = [0.20, 0.28, 0.38], clawCol = [0.46, 0.62, 0.76];
    const strip = (sx, sz0, sz1, r0, r1, key) => ({
      id: key, parent: "core", pivot: [sx, 0.28, sz0], sway: key, build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [sx * 0.35, -0.82, sz1 - sz0], r0, r1), [-0.25, -0.90, -0.75], [0.25, 0.12, 0.18], 0.028, shroud)
    });
    return [
      { id: "core", parent: null, pivot: [0, 0.95, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0.12, 0], [0.17, 0.26, 0.14]), _sdTaper(p, [0, 0.05, 0], [0, -0.32, -0.05], 0.16, 0.08), 0.05),
        [-0.24, -0.40, -0.20], [0.24, 0.42, 0.20], 0.028, shroud) },
      { id: "head", parent: "core", pivot: [0, 0.36, 0.03], build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.11, 0.02], [0.11, 0.14, 0.12]), _sdTaper(p, [0, 0.22, -0.02], [0, 0.30, -0.12], 0.07, 0.015), 0.04),
          [-0.16, -0.04, -0.18], [0.16, 0.34, 0.16], 0.024, shroud);
        _pfBox(b, [-0.04, 0.12, 0.125], [0.03, 0.016, 0.012], 0, 0, [0.55, 0.85, 1.0], 1.0);
        _pfBox(b, [0.04, 0.12, 0.125], [0.03, 0.016, 0.012], 0, 0, [0.55, 0.85, 1.0], 1.0);
        return b;
      } },
      { id: "armL", parent: "core", pivot: [0.20, 0.26, 0.02], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0.14, -0.12, 0.28], 0.06, 0.035), [-0.08, -0.22, -0.08], [0.24, 0.10, 0.36], 0.025, clawCol, 0.15) },
      { id: "armR", parent: "core", pivot: [-0.20, 0.26, 0.02], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [-0.14, -0.12, 0.28], 0.06, 0.035), [-0.24, -0.22, -0.08], [0.08, 0.10, 0.36], 0.025, clawCol, 0.15) },
      strip(-0.12, -0.08, -0.58, 0.09, 0.04, "mantle1"),
      strip(0.12, -0.08, -0.58, 0.09, 0.04, "mantle2"),
      strip(-0.05, -0.10, -0.68, 0.10, 0.045, "mantle3"),
      strip(0.05, -0.10, -0.68, 0.10, 0.045, "mantle4")
    ];
  }

  if (type === "hero") {
    const steel = [0.52, 0.55, 0.60], darkSteel = [0.28, 0.30, 0.35], capeCol = [0.46, 0.15, 0.16], bladeCol = [0.78, 0.81, 0.85];
    return [
      { id: "pelvis", parent: null, pivot: [0, 0.94, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0, 0, 0], [0.17, 0.09, 0.13]), _sdCapsule(p, [-0.15, 0.02, 0], [0.15, 0.02, 0], 0.06), 0.035),
        [-0.24, -0.12, -0.18], [0.24, 0.12, 0.18], 0.026, darkSteel) },
      { id: "cape", parent: "pelvis", pivot: [0, 0.42, -0.15], sway: "cape", build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0, -1.12, -0.12], 0.20, 0.34), [-0.38, -1.18, -0.32], [0.38, 0.08, 0.14], 0.032, capeCol) },
      { id: "chest", parent: "pelvis", pivot: [0, 0.06, 0], build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.24, 0.01], [0.21, 0.25, 0.15]), _sdEllipsoid(p, [0, 0.38, 0.06], [0.16, 0.14, 0.12]), 0.045),
          [-0.28, -0.04, -0.18], [0.28, 0.54, 0.22], 0.026, steel);
        _pfBox(b, [0, 0.25, 0.14], [0.28, 0.28, 0.06], 0, 0, steel);
        return b;
      } },
      { id: "head", parent: "chest", pivot: [0, 0.46, 0.02], build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.11, 0.01], [0.12, 0.13, 0.13]), _sdTaper(p, [0, 0.05, 0.04], [0, -0.04, 0.06], 0.10, 0.07), 0.03),
          [-0.16, -0.08, -0.14], [0.16, 0.26, 0.18], 0.022, steel);
        _pfBox(b, [0, 0.11, 0.135], [0.14, 0.024, 0.04], 0, 0, [0.02, 0.02, 0.025]);   // Sehschlitz
        return b;
      } },
      { id: "armL", parent: "chest", pivot: [0.23, 0.38, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [0.02, 0.0, 0], [0.085, 0.075, 0.085]), _sdCapsule(p, [0.02, 0, 0], [0.06, -0.28, 0.02], 0.055), 0.03),
        [-0.10, -0.36, -0.10], [0.16, 0.10, 0.12], 0.024, steel) },
      { id: "forearmL", parent: "armL", pivot: [0.06, -0.28, 0.02], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [0.02, -0.25, 0.08], 0.048), [-0.08, -0.32, -0.06], [0.12, 0.08, 0.18], 0.024, darkSteel) },
      { id: "armR", parent: "chest", pivot: [-0.23, 0.38, 0], build: () => _buildLimbSdf(
        (p) => _smin(_sdEllipsoid(p, [-0.02, 0.0, 0], [0.085, 0.075, 0.085]), _sdCapsule(p, [-0.02, 0, 0], [-0.06, -0.28, 0.02], 0.055), 0.03),
        [-0.16, -0.36, -0.10], [0.10, 0.10, 0.12], 0.024, steel) },
      { id: "forearmR", parent: "armR", pivot: [-0.06, -0.28, 0.02], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [-0.02, -0.25, 0.08], 0.048), [-0.12, -0.32, -0.06], [0.08, 0.08, 0.18], 0.024, darkSteel) },
      { id: "swordR", parent: "forearmR", pivot: [-0.02, -0.25, 0.10], tip: [0, 0, 1.20], build: () => {
        const b = _buildLimbSdf((p) => _sdCapsule(p, [0, 0, -0.06], [0, 0, 0.14], 0.026), [-0.08, -0.08, -0.12], [0.08, 0.08, 0.20], 0.024, darkSteel);
        _pfBox(b, [0, 0, 0.15], [0.24, 0.035, 0.04], 0, 0, darkSteel);   // Parierstange
        _pfBox(b, [0, 0, 0.68], [0.055, 0.016, 1.04], 0, 0, bladeCol);   // Klinge
        return b;
      } },
      { id: "thighL", parent: "pelvis", pivot: [0.11, -0.04, 0], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [0.01, -0.44, 0.01], 0.072), [-0.10, -0.52, -0.10], [0.12, 0.10, 0.12], 0.028, darkSteel) },
      { id: "shinL", parent: "thighL", pivot: [0.01, -0.44, 0.01], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0, -0.42, -0.01], 0.062), _sdEllipsoid(p, [0, -0.44, 0.06], [0.065, 0.045, 0.13]), 0.025),
        [-0.12, -0.50, -0.12], [0.12, 0.10, 0.20], 0.028, steel) },
      { id: "thighR", parent: "pelvis", pivot: [-0.11, -0.04, 0], build: () => _buildLimbSdf(
        (p) => _sdCapsule(p, [0, 0, 0], [-0.01, -0.44, 0.01], 0.072), [-0.12, -0.52, -0.10], [0.10, 0.10, 0.12], 0.028, darkSteel) },
      { id: "shinR", parent: "thighR", pivot: [-0.01, -0.44, 0.01], build: () => _buildLimbSdf(
        (p) => _smin(_sdCapsule(p, [0, 0, 0], [0, -0.42, -0.01], 0.062), _sdEllipsoid(p, [0, -0.44, 0.06], [0.065, 0.045, 0.13]), 0.025),
        [-0.12, -0.50, -0.12], [0.12, 0.10, 0.20], 0.028, steel) }
    ];
  }

  if (type === "boss") {
    const brute = [0.26, 0.22, 0.24], hornCol = [0.65, 0.56, 0.44], clubCol = [0.34, 0.28, 0.24];
    return [
      { id: "pelvis", parent: null, pivot: [0, 1.55, 0], build: () => _buildLimbSdf(
        (p) => _sdEllipsoid(p, [0, 0, 0], [0.46, 0.24, 0.36]), [-0.54, -0.32, -0.44], [0.54, 0.32, 0.44], 0.035, brute) },
      { id: "chest", parent: "pelvis", pivot: [0, 0.16, 0.04], build: () => {
        const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.62, 0.04], [0.68, 0.64, 0.48]), _sdEllipsoid(p, [0, 0.20, 0.02], [0.48, 0.32, 0.38]), 0.12),
          [-0.78, -0.15, -0.48], [0.78, 1.32, 0.56], 0.035, brute);
        _pfBox(b, [0, 0.68, 0.46], [0.08, 0.42, 0.06], 0, 0.12, _EMBER, 1.0);      // glühende Risse
        _pfBox(b, [0.14, 0.76, 0.44], [0.22, 0.06, 0.06], 0, -0.25, _EMBER, 1.0);
        _pfBox(b, [-0.12, 0.52, 0.45], [0.18, 0.05, 0.06], 0, 0.35, _EMBER, 1.0);
        return b;
      } },
      { id: "head", parent: "chest", pivot: [0, 1.15, 0.14], build: () => {
        const b = _buildLimbSdf((p) => _sdEllipsoid(p, [0, 0.22, 0.06], [0.28, 0.28, 0.32]), [-0.36, -0.10, -0.30], [0.36, 0.56, 0.42], 0.032, brute);
        _pfBox(b, [0.38, 0.48, -0.08], [0.36, 0.11, 0.11], 0, 0.52, hornCol);      // Hörner
        _pfBox(b, [-0.38, 0.48, -0.08], [0.36, 0.11, 0.11], 0, -0.52, hornCol);
        _pfBox(b, [-0.10, 0.27, 0.36], [0.07, 0.035, 0.03], 0, 0, _EMBER, 1.0);    // Augen
        _pfBox(b, [0.10, 0.27, 0.36], [0.07, 0.035, 0.03], 0, 0, _EMBER, 1.0);
        return b;
      } },
      { id: "armL", parent: "chest", pivot: [0.68, 0.96, 0.05], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0.16, -0.78, 0.08], 0.24, 0.19), [-0.26, -1.02, -0.26], [0.44, 0.28, 0.36], 0.035, brute) },
      { id: "forearmL", parent: "armL", pivot: [0.16, -0.78, 0.08], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0.05, -0.65, 0.25], 0.18, 0.15), [-0.20, -0.82, -0.20], [0.28, 0.20, 0.46], 0.035, brute) },
      { id: "armR", parent: "chest", pivot: [-0.68, 0.96, 0.05], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [-0.16, -0.78, 0.08], 0.24, 0.19), [-0.44, -1.02, -0.26], [0.26, 0.28, 0.36], 0.035, brute) },
      { id: "forearmR", parent: "armR", pivot: [-0.16, -0.78, 0.08], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [-0.05, -0.65, 0.25], 0.18, 0.15), [-0.28, -0.82, -0.20], [0.20, 0.20, 0.46], 0.035, brute) },
      { id: "clubR", parent: "forearmR", pivot: [-0.05, -0.65, 0.28], tip: [0, 0, 1.65], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, -0.15], [0, 0, 1.65], 0.09, 0.24), [-0.34, -0.34, -0.26], [0.34, 0.34, 1.92], 0.035, clubCol) },
      { id: "thighL", parent: "pelvis", pivot: [0.26, -0.12, 0], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [0.02, -0.72, 0.03], 0.21, 0.17), [-0.22, -0.92, -0.24], [0.26, 0.24, 0.28], 0.035, brute) },
      { id: "shinL", parent: "thighL", pivot: [0.02, -0.72, 0.03], build: () => _buildLimbSdf(
        (p) => _smin(_sdTaper(p, [0, 0, 0], [0, -0.68, -0.02], 0.16, 0.13), _sdEllipsoid(p, [0, -0.70, 0.12], [0.16, 0.10, 0.26]), 0.04),
        [-0.22, -0.84, -0.24], [0.22, 0.20, 0.42], 0.035, brute) },
      { id: "thighR", parent: "pelvis", pivot: [-0.26, -0.12, 0], build: () => _buildLimbSdf(
        (p) => _sdTaper(p, [0, 0, 0], [-0.02, -0.72, 0.03], 0.21, 0.17), [-0.26, -0.92, -0.24], [0.22, 0.24, 0.28], 0.035, brute) },
      { id: "shinR", parent: "thighR", pivot: [-0.02, -0.72, 0.03], build: () => _buildLimbSdf(
        (p) => _smin(_sdTaper(p, [0, 0, 0], [0, -0.68, -0.02], 0.16, 0.13), _sdEllipsoid(p, [0, -0.70, 0.12], [0.16, 0.10, 0.26]), 0.04),
        [-0.22, -0.84, -0.24], [0.22, 0.20, 0.42], 0.035, brute) }
    ];
  }

  // hellhound (Schulterhöhe etwa 1,05 m)
  const houndCol = [0.24, 0.16, 0.15], ribBone = [0.58, 0.44, 0.36];
  return [
    { id: "pelvis", parent: null, pivot: [0, 0.68, -0.22], build: () => _buildLimbSdf(
      (p) => _sdEllipsoid(p, [0, 0, 0], [0.14, 0.13, 0.18]), [-0.20, -0.18, -0.24], [0.20, 0.18, 0.24], 0.026, houndCol) },
    { id: "chest", parent: "pelvis", pivot: [0, 0.04, 0.14], build: () => {
      const b = _buildLimbSdf((p) => _sdEllipsoid(p, [0, 0.04, 0.22], [0.17, 0.18, 0.26]), [-0.24, -0.16, -0.06], [0.24, 0.26, 0.54], 0.026, houndCol);
      for (let i = 0; i < 3; i++) _pfBox(b, [0, 0.02, 0.14 + i * 0.09], [0.33, 0.025, 0.03], 0, 0, ribBone);
      return b;
    } },
    { id: "head", parent: "chest", pivot: [0, 0.12, 0.44], build: () => {
      const b = _buildLimbSdf((p) => _smin(_sdEllipsoid(p, [0, 0.05, 0.06], [0.11, 0.10, 0.12]), _sdTaper(p, [0, 0.02, 0.12], [0, 0.0, 0.28], 0.085, 0.045), 0.03),
        [-0.16, -0.10, -0.08], [0.16, 0.18, 0.34], 0.022, houndCol);
      _pfBox(b, [-0.05, 0.09, 0.15], [0.03, 0.02, 0.02], 0, 0, _EMBER, 1.0);       // Augen
      _pfBox(b, [0.05, 0.09, 0.15], [0.03, 0.02, 0.02], 0, 0, _EMBER, 1.0);
      _pfBox(b, [0, -0.025, 0.24], [0.05, 0.012, 0.10], 0, 0, _EMBER, 0.8);         // glühendes Maul
      return b;
    } },
    { id: "tail", parent: "pelvis", pivot: [0, 0.05, -0.16], sway: "cape", build: () => _buildLimbSdf(
      (p) => _sdTaper(p, [0, 0, 0], [0, 0.18, -0.42], 0.045, 0.015), [-0.10, -0.08, -0.48], [0.10, 0.24, 0.08], 0.022, ribBone) },
    { id: "legFL", parent: "chest", pivot: [0.13, -0.06, 0.34], build: () => _buildLimbSdf(
      (p) => _smin(_sdCapsule(p, [0, 0, 0], [0.02, -0.56, 0.02], 0.042), _sdEllipsoid(p, [0.02, -0.58, 0.06], [0.05, 0.03, 0.09]), 0.02),
      [-0.08, -0.64, -0.08], [0.10, 0.08, 0.16], 0.024, houndCol) },
    { id: "legFR", parent: "chest", pivot: [-0.13, -0.06, 0.34], build: () => _buildLimbSdf(
      (p) => _smin(_sdCapsule(p, [0, 0, 0], [-0.02, -0.56, 0.02], 0.042), _sdEllipsoid(p, [-0.02, -0.58, 0.06], [0.05, 0.03, 0.09]), 0.02),
      [-0.10, -0.64, -0.08], [0.08, 0.08, 0.16], 0.024, houndCol) },
    { id: "legBL", parent: "pelvis", pivot: [0.12, -0.06, -0.04], build: () => _buildLimbSdf(
      (p) => _smin(_sdCapsule(p, [0, 0, 0], [0.02, -0.56, -0.03], 0.048), _sdEllipsoid(p, [0.02, -0.58, 0.02], [0.05, 0.03, 0.09]), 0.02),
      [-0.08, -0.64, -0.10], [0.10, 0.08, 0.12], 0.024, houndCol) },
    { id: "legBR", parent: "pelvis", pivot: [-0.12, -0.06, -0.04], build: () => _buildLimbSdf(
      (p) => _smin(_sdCapsule(p, [0, 0, 0], [-0.02, -0.56, -0.03], 0.048), _sdEllipsoid(p, [-0.02, -0.58, 0.02], [0.05, 0.03, 0.09]), 0.02),
      [-0.10, -0.64, -0.10], [0.08, 0.08, 0.12], 0.024, houndCol) }
  ];
}

function _getFigureSpec(type) {
  if (_PF_CACHE[type]) return _PF_CACHE[type];
  let totalVerts = 0;
  const limbs = _makeLimbDefs(type).map((d) => {
    const builder = d.build();
    totalVerts += builder.positions.length / 3;
    return { id: d.id, parent: d.parent, pivot: d.pivot, tip: d.tip || null, sway: d.sway || null,
      mesh: uploadStaticMesh(gl, builder), localMat: Mat4.create(), worldMat: Mat4.create(), parentIdx: -1 };
  });
  const byId = Object.create(null);
  limbs.forEach((l, i) => { byId[l.id] = i; });
  limbs.forEach((l) => { l.parentIdx = l.parent === null ? -1 : byId[l.parent]; });
  const spec = { type, limbs, byId, totalVerts };
  _PF_CACHE[type] = spec;
  return spec;
}

// --- Schlüsselbilder je Art: { t, root: [dx, dy, dz], joints: { glied: [rx, ry, rz] } } ---
// Winkel in Bogenmaß. Negatives rx dreht ein hängendes Glied nach vorn (+z).
const _CLIPS = {
  skeleton: {
    idle: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.16, 0, 0], head: [-0.10, 0, 0], armL: [0.05, 0, 0.12], forearmL: [-0.25, 0, 0], armR: [0.05, 0, -0.12], forearmR: [-0.35, 0, 0], bladeR: [0.25, 0, 0], thighL: [-0.04, 0, 0], shinL: [0.06, 0, 0], thighR: [0.04, 0, 0], shinR: [0.05, 0, 0] } },
      { t: 1.0, root: [0, -0.02, 0.01], joints: { chest: [0.22, 0.04, 0], head: [-0.04, -0.04, 0], armL: [0.08, 0, 0.15], forearmL: [-0.30, 0, 0], armR: [0.08, 0, -0.15], forearmR: [-0.42, 0, 0], bladeR: [0.30, 0, 0], thighL: [-0.05, 0, 0], shinL: [0.08, 0, 0], thighR: [0.05, 0, 0], shinR: [0.07, 0, 0] } },
      { t: 2.0, root: [0, 0, 0], joints: { chest: [0.16, 0, 0], head: [-0.10, 0, 0], armL: [0.05, 0, 0.12], forearmL: [-0.25, 0, 0], armR: [0.05, 0, -0.12], forearmR: [-0.35, 0, 0], bladeR: [0.25, 0, 0], thighL: [-0.04, 0, 0], shinL: [0.06, 0, 0], thighR: [0.04, 0, 0], shinR: [0.05, 0, 0] } }
    ] },
    alert: { dur: 1.9, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.20, 0, 0], head: [0.22, 0, 0], armL: [-0.15, 0, 0.22], forearmL: [-0.55, 0, 0], armR: [-0.10, 0, -0.20], forearmR: [-0.50, 0, 0], bladeR: [0.15, 0, 0] } },
      { t: 0.95, root: [0, 0.02, 0], joints: { chest: [0.12, 0.08, 0], head: [0.28, 0.12, 0.05], armL: [-0.25, 0, 0.28], forearmL: [-0.65, 0, 0], armR: [-0.20, 0, -0.25], forearmR: [-0.60, 0, 0], bladeR: [0.10, 0, 0] } },
      { t: 1.9, root: [0, 0, 0], joints: { chest: [0.20, 0, 0], head: [0.22, 0, 0], armL: [-0.15, 0, 0.22], forearmL: [-0.55, 0, 0], armR: [-0.10, 0, -0.20], forearmR: [-0.50, 0, 0], bladeR: [0.15, 0, 0] } }
    ] },
    look: { dur: 2.6, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.15, -0.15, 0], head: [0.06, -0.20, 0], armR: [-0.25, 0, -0.18], forearmR: [-0.65, 0, 0], bladeR: [0.10, 0, 0] } },
      { t: 1.3, root: [0, 0, 0], joints: { chest: [0.15, 0.15, 0], head: [0.06, 0.20, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.72, 0, 0], bladeR: [0.05, 0, 0] } },
      { t: 2.6, root: [0, 0, 0], joints: { chest: [0.15, -0.15, 0], head: [0.06, -0.20, 0], armR: [-0.25, 0, -0.18], forearmR: [-0.65, 0, 0], bladeR: [0.10, 0, 0] } }
    ] },
    walk: { dur: 0.9, loop: true, frames: [
      { t: 0.0, root: [0, -0.03, 0], joints: { pelvis: [0, 0.06, -0.04], chest: [0.22, -0.06, 0.04], thighL: [-0.45, 0, 0], shinL: [0.35, 0, 0], thighR: [0.38, 0, 0], shinR: [0.15, 0, 0], armL: [0.32, 0, 0.14], armR: [-0.30, 0, -0.16], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.45, root: [0, -0.05, 0], joints: { pelvis: [0, -0.06, 0.04], chest: [0.24, 0.06, -0.04], thighL: [0.35, 0, 0], shinL: [0.12, 0, 0], thighR: [-0.48, 0, 0], shinR: [0.42, 0, 0], armL: [-0.28, 0, 0.14], armR: [0.35, 0, -0.16], forearmR: [-0.60, 0, 0], bladeR: [0.20, 0, 0] } },
      { t: 0.9, root: [0, -0.03, 0], joints: { pelvis: [0, 0.06, -0.04], chest: [0.22, -0.06, 0.04], thighL: [-0.45, 0, 0], shinL: [0.35, 0, 0], thighR: [0.38, 0, 0], shinR: [0.15, 0, 0], armL: [0.32, 0, 0.14], armR: [-0.30, 0, -0.16], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0] } }
    ] },
    rise: { dur: 2.5, loop: false, frames: [
      { t: 0.0, root: [0, -0.78, 0], joints: { pelvis: [0.65, 0, 0], chest: [0.55, 0, 0], head: [0.25, 0, 0], armL: [-1.35, 0, 0.25], forearmL: [-0.40, 0, 0], armR: [-1.35, 0, -0.25], forearmR: [-0.40, 0, 0], thighL: [-0.75, 0, 0], shinL: [0.95, 0, 0], thighR: [-0.75, 0, 0], shinR: [0.95, 0, 0] } },
      { t: 1.25, root: [0, -0.36, 0], joints: { pelvis: [0.35, 0, 0], chest: [0.35, 0, 0], head: [0.12, 0, 0], armL: [-0.90, 0, 0.22], forearmL: [-0.55, 0, 0], armR: [-0.90, 0, -0.22], forearmR: [-0.55, 0, 0], thighL: [-0.45, 0, 0], shinL: [0.60, 0, 0], thighR: [-0.45, 0, 0], shinR: [0.60, 0, 0] } },
      { t: 2.5, root: [0, 0, 0], joints: { pelvis: [0, 0, 0], chest: [0.18, 0, 0], head: [-0.05, 0, 0], armL: [-0.15, 0, 0.16], forearmL: [-0.45, 0, 0], armR: [-0.35, 0, -0.18], forearmR: [-0.55, 0, 0], bladeR: [0.20, 0, 0], thighL: [-0.04, 0, 0], shinL: [0.06, 0, 0], thighR: [0.04, 0, 0], shinR: [0.05, 0, 0] } }
    ] },
    roar: { dur: 1.4, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.15, 0, 0], head: [0.0, 0, 0], armL: [-0.2, 0, 0.2], armR: [-0.2, 0, -0.2] } },
      { t: 0.55, root: [0, 0.02, -0.04], joints: { chest: [-0.18, 0, 0], head: [-0.35, 0, 0], armL: [-0.85, 0, 0.55], forearmL: [-0.35, 0, 0], armR: [-0.85, 0, -0.55], forearmR: [-0.35, 0, 0], bladeR: [-0.2, 0, 0] } },
      { t: 1.4, root: [0, 0, 0], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0], armL: [-0.15, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [-0.35, 0, -0.18], forearmR: [-0.55, 0, 0] } }
    ] },
    death: { dur: 1.6, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { pelvis: [0, 0, 0], chest: [0.18, 0, 0], head: [0, 0, 0] } },
      { t: 0.7, root: [0, -0.45, 0.05], joints: { pelvis: [0.55, 0, 0.25], chest: [0.65, 0.2, -0.2], head: [0.55, 0, 0.3], armL: [0.3, 0, 0.6], forearmL: [-0.2, 0, 0], armR: [0.4, 0, -0.5], forearmR: [-0.2, 0, 0], bladeR: [0.8, 0, 0], thighL: [-0.5, 0, 0.25], shinL: [0.7, 0, 0], thighR: [-0.3, 0, -0.25], shinR: [0.5, 0, 0] } },
      { t: 1.6, root: [0, -0.82, 0.12], joints: { pelvis: [1.25, 0, 0.35], chest: [0.35, 0.3, -0.35], head: [0.45, 0.2, 0.45], armL: [0.6, 0, 0.95], forearmL: [0.1, 0, 0], armR: [0.7, 0, -0.85], forearmR: [0.15, 0, 0], bladeR: [1.35, 0, 0.4], thighL: [-1.1, 0, 0.4], shinL: [0.9, 0, 0], thighR: [-0.95, 0, -0.4], shinR: [0.85, 0, 0] } }
    ] }
  },
  cultist: {
    idle: { dur: 2.4, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.12, 0, 0], head: [0.06, 0, 0], armL: [0.06, 0, 0.12], forearmL: [-0.45, 0, 0], armR: [0.06, 0, -0.12], forearmR: [-0.45, 0, 0] } },
      { t: 1.2, root: [0, -0.02, 0], joints: { chest: [0.16, 0.04, 0], head: [0.10, -0.04, 0], armL: [0.02, 0, 0.15], forearmL: [-0.52, 0, 0], armR: [0.02, 0, -0.15], forearmR: [-0.52, 0, 0] } },
      { t: 2.4, root: [0, 0, 0], joints: { chest: [0.12, 0, 0], head: [0.06, 0, 0], armL: [0.06, 0, 0.12], forearmL: [-0.45, 0, 0], armR: [0.06, 0, -0.12], forearmR: [-0.45, 0, 0] } }
    ] },
    summon: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0, 0.02, 0], joints: { chest: [-0.08, 0.20, 0], head: [-0.14, -0.15, 0], armL: [-1.15, 0.25, 0.35], forearmL: [-0.55, 0, 0], armR: [-1.25, -0.25, -0.35], forearmR: [-0.65, 0, 0] } },
      { t: 1.0, root: [0, 0.04, 0], joints: { chest: [-0.12, -0.20, 0], head: [-0.18, 0.15, 0], armL: [-1.30, -0.25, 0.45], forearmL: [-0.70, 0, 0], armR: [-1.10, 0.25, -0.45], forearmR: [-0.45, 0, 0] } },
      { t: 2.0, root: [0, 0.02, 0], joints: { chest: [-0.08, 0.20, 0], head: [-0.14, -0.15, 0], armL: [-1.15, 0.25, 0.35], forearmL: [-0.55, 0, 0], armR: [-1.25, -0.25, -0.35], forearmR: [-0.65, 0, 0] } }
    ] },
    cast: { dur: 1.3, loop: false, frames: [
      { t: 0.0, root: [0, 0.03, -0.04], joints: { chest: [-0.12, 0, 0], head: [-0.15, 0, 0], armL: [-1.20, 0, 0.35], forearmL: [-0.60, 0, 0], armR: [-1.20, 0, -0.35], forearmR: [-0.60, 0, 0] } },
      { t: 0.55, root: [0, -0.02, 0.10], joints: { chest: [0.24, 0, 0], head: [0.06, 0, 0], armL: [-1.35, 0, 0.08], forearmL: [-0.12, 0, 0], armR: [-1.35, 0, -0.08], forearmR: [-0.12, 0, 0] } },
      { t: 1.3, root: [0, 0, 0], joints: { chest: [0.12, 0, 0], head: [0.04, 0, 0], armL: [-0.45, 0, 0.16], forearmL: [-0.55, 0, 0], armR: [-0.45, 0, -0.16], forearmR: [-0.55, 0, 0] } }
    ] },
    alert: { dur: 2.1, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.05, -0.12, 0], head: [-0.05, 0.12, 0], armL: [-0.35, 0, 0.20], forearmL: [-0.65, 0, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.65, 0, 0] } },
      { t: 1.05, root: [0, 0.02, 0], joints: { chest: [0.05, 0.12, 0], head: [-0.05, -0.12, 0], armL: [-0.42, 0, 0.24], forearmL: [-0.70, 0, 0], armR: [-0.42, 0, -0.24], forearmR: [-0.70, 0, 0] } },
      { t: 2.1, root: [0, 0, 0], joints: { chest: [0.05, -0.12, 0], head: [-0.05, 0.12, 0], armL: [-0.35, 0, 0.20], forearmL: [-0.65, 0, 0], armR: [-0.35, 0, -0.20], forearmR: [-0.65, 0, 0] } }
    ] }
  },
  wraith: {
    float: { dur: 2.4, loop: true, frames: [
      { t: 0.0, root: [0, 0.05, 0], joints: { core: [0.12, 0, 0], head: [-0.08, 0, 0], armL: [0.15, 0, 0.22], armR: [0.15, 0, -0.22] } },
      { t: 1.2, root: [0, -0.05, 0.04], joints: { core: [0.18, 0.05, 0], head: [-0.02, -0.05, 0], armL: [0.25, 0, 0.28], armR: [0.25, 0, -0.28] } },
      { t: 2.4, root: [0, 0.05, 0], joints: { core: [0.12, 0, 0], head: [-0.08, 0, 0], armL: [0.15, 0, 0.22], armR: [0.15, 0, -0.22] } }
    ] },
    rush: { dur: 1.4, loop: true, frames: [
      { t: 0.0, root: [0, 0.04, 0], joints: { core: [0.42, 0.04, 0], head: [-0.25, 0, 0], armL: [-0.95, 0.15, 0.22], armR: [-0.95, -0.15, -0.22] } },
      { t: 0.7, root: [0, -0.04, 0], joints: { core: [0.48, -0.04, 0], head: [-0.30, 0, 0], armL: [-1.08, 0.20, 0.26], armR: [-1.08, -0.20, -0.26] } },
      { t: 1.4, root: [0, 0.04, 0], joints: { core: [0.42, 0.04, 0], head: [-0.25, 0, 0], armL: [-0.95, 0.15, 0.22], armR: [-0.95, -0.15, -0.22] } }
    ] },
    shriek: { dur: 1.5, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { core: [0.25, 0, 0], head: [-0.1, 0, 0], armL: [-0.4, 0, 0.3], armR: [-0.4, 0, -0.3] } },
      { t: 0.65, root: [0, 0.12, -0.05], joints: { core: [-0.22, 0, 0], head: [-0.38, 0, 0], armL: [-0.75, 0.35, 0.85], armR: [-0.75, -0.35, -0.85] } },
      { t: 1.5, root: [0, 0.05, 0], joints: { core: [0.28, 0, 0], head: [-0.18, 0, 0], armL: [-0.85, 0.15, 0.35], armR: [-0.85, -0.15, -0.35] } }
    ] }
  },
  hero: {
    idle: { dur: 1.8, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.08, -0.12, 0], head: [0.0, 0.12, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0], thighL: [-0.12, 0, 0.05], shinL: [0.18, 0, 0], thighR: [0.12, 0, -0.05], shinR: [0.14, 0, 0] } },
      { t: 0.9, root: [0, -0.02, 0], joints: { chest: [0.12, -0.10, 0], head: [0.04, 0.10, 0], armL: [-0.22, 0, 0.20], forearmL: [-0.70, 0, 0], armR: [-0.42, 0.15, -0.22], forearmR: [-0.65, 0, 0], swordR: [-0.30, 0, 0], thighL: [-0.14, 0, 0.05], shinL: [0.22, 0, 0], thighR: [0.12, 0, -0.05], shinR: [0.18, 0, 0] } },
      { t: 1.8, root: [0, 0, 0], joints: { chest: [0.08, -0.12, 0], head: [0.0, 0.12, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0], thighL: [-0.12, 0, 0.05], shinL: [0.18, 0, 0], thighR: [0.12, 0, -0.05], shinR: [0.14, 0, 0] } }
    ] },
    attack1: { dur: 0.7, loop: false, frames: [
      { t: 0.0, root: [0, 0.02, -0.06], joints: { pelvis: [0, -0.35, 0], chest: [-0.10, -0.45, 0], armR: [-1.45, 0.35, -0.65], forearmR: [-0.45, 0, 0], swordR: [-0.40, 0, 0] } },
      { t: 0.35, root: [0, -0.03, 0.30], joints: { pelvis: [0.08, 0.35, 0], chest: [0.22, 0.42, 0], armR: [-1.05, -0.35, 0.15], forearmR: [-0.15, 0, 0], swordR: [0.05, 0, 0] } },
      { t: 0.7, root: [0, 0, 0.06], joints: { pelvis: [0, 0.10, 0], chest: [0.12, 0.05, 0], armR: [-0.55, 0.10, -0.20], forearmR: [-0.50, 0, 0], swordR: [-0.25, 0, 0] } }
    ] },
    attack2: { dur: 0.7, loop: false, frames: [
      { t: 0.0, root: [0, 0.02, -0.04], joints: { pelvis: [0, 0.35, 0], chest: [0.08, 0.45, 0], armR: [-0.85, -0.55, 0.45], forearmR: [-0.55, 0, 0], swordR: [-0.20, 0, 0] } },
      { t: 0.35, root: [0, -0.02, 0.28], joints: { pelvis: [0.05, -0.35, 0], chest: [0.18, -0.40, 0], armR: [-1.15, 0.45, -0.35], forearmR: [-0.18, 0, 0], swordR: [0.02, 0, 0] } },
      { t: 0.7, root: [0, 0, 0.04], joints: { pelvis: [0, -0.08, 0], chest: [0.10, -0.08, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.55, 0, 0], swordR: [-0.30, 0, 0] } }
    ] },
    attack3: { dur: 1.0, loop: false, frames: [
      { t: 0.0, root: [0, 0, -0.08], joints: { pelvis: [0, -0.20, 0], chest: [0.05, -0.25, 0], armR: [-0.75, 0, -0.25], forearmR: [-0.95, 0, 0], swordR: [0.0, 0, 0] } },
      { t: 0.50, root: [0, -0.04, 0.40], joints: { pelvis: [0.12, 0.15, 0], chest: [0.28, 0.18, 0], armR: [-1.42, 0.05, -0.05], forearmR: [-0.05, 0, 0], swordR: [0.0, 0, 0] } },
      { t: 1.0, root: [0, 0, 0.05], joints: { pelvis: [0, 0, 0], chest: [0.10, -0.10, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } }
    ] },
    heavy: { dur: 1.3, loop: false, frames: [
      { t: 0.0, root: [0, 0.04, -0.08], joints: { chest: [-0.22, 0, 0], head: [-0.20, 0, 0], armL: [-2.15, 0, 0.22], forearmL: [-0.45, 0, 0], armR: [-2.15, 0, -0.22], forearmR: [-0.45, 0, 0], swordR: [-0.55, 0, 0] } },
      { t: 0.65, root: [0, -0.06, 0.36], joints: { chest: [0.34, 0, 0], head: [0.12, 0, 0], armL: [-1.05, 0, 0.15], forearmL: [-0.15, 0, 0], armR: [-1.05, 0, -0.15], forearmR: [-0.15, 0, 0], swordR: [0.10, 0, 0] } },
      { t: 1.3, root: [0, 0, 0.05], joints: { chest: [0.12, -0.10, 0], head: [0.04, 0.10, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.30, 0, 0] } }
    ] },
    block: { dur: 0.6, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.05, 0, 0], armL: [-0.85, 0, 0.25], forearmL: [-0.85, 0, 0], armR: [-0.95, 0, -0.25], forearmR: [-0.85, 0, 0], swordR: [0.35, 0, 0] } },
      { t: 0.3, root: [0, -0.02, -0.04], joints: { chest: [0.10, 0, 0], armL: [-0.95, 0, 0.20], forearmL: [-0.90, 0, 0], armR: [-1.05, 0, -0.20], forearmR: [-0.90, 0, 0], swordR: [0.40, 0, 0] } },
      { t: 0.6, root: [0, 0, 0], joints: { chest: [0.08, -0.12, 0], armL: [-0.25, 0, 0.18], forearmL: [-0.65, 0, 0], armR: [-0.45, 0.15, -0.20], forearmR: [-0.60, 0, 0], swordR: [-0.35, 0, 0] } }
    ] },
    victory: { dur: 2.2, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.16, 0, 0], head: [0.14, 0, 0], armR: [0.08, 0, -0.15], forearmR: [-0.20, 0, 0], swordR: [0.65, 0, 0] } },
      { t: 1.1, root: [0, -0.03, 0], joints: { chest: [0.24, 0, 0], head: [0.22, 0, 0], armR: [0.12, 0, -0.18], forearmR: [-0.25, 0, 0], swordR: [0.72, 0, 0] } },
      { t: 2.2, root: [0, 0, 0], joints: { chest: [0.16, 0, 0], head: [0.14, 0, 0], armR: [0.08, 0, -0.15], forearmR: [-0.20, 0, 0], swordR: [0.65, 0, 0] } }
    ] }
  },
  boss: {
    idle: { dur: 2.6, loop: true, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.08, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } },
      { t: 1.3, root: [0, -0.04, 0.02], joints: { chest: [0.24, 0.04, 0], head: [-0.02, -0.04, 0], armL: [0.14, 0, 0.22], forearmL: [-0.50, 0, 0], armR: [0.14, 0, -0.22], forearmR: [-0.62, 0, 0], clubR: [0.30, 0, 0] } },
      { t: 2.6, root: [0, 0, 0], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.08, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    roar: { dur: 1.7, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.15, 0, 0], head: [0, 0, 0], armL: [0.1, 0, 0.2], armR: [0.1, 0, -0.2] } },
      { t: 0.65, root: [0, 0.05, -0.10], joints: { chest: [-0.24, 0, 0], head: [-0.36, 0, 0], armL: [-0.75, 0.25, 0.72], forearmL: [-0.35, 0, 0], armR: [-0.85, -0.25, -0.72], forearmR: [-0.35, 0, 0], clubR: [-0.15, 0, 0] } },
      { t: 1.7, root: [0, 0, 0], joints: { chest: [0.20, 0, 0], head: [-0.10, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.10, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    attack: { dur: 1.0, loop: false, frames: [
      { t: 0.0, root: [0, 0.04, -0.12], joints: { chest: [-0.22, -0.20, 0], head: [-0.18, 0.15, 0], armL: [-1.10, 0, 0.45], forearmL: [-0.45, 0, 0], armR: [-2.15, 0, -0.25], forearmR: [-0.40, 0, 0], clubR: [-0.45, 0, 0] } },
      { t: 0.55, root: [0, -0.06, 0.28], joints: { chest: [0.36, 0.22, 0], head: [0.15, -0.12, 0], armL: [-0.55, 0, 0.30], forearmL: [-0.30, 0, 0], armR: [-1.15, 0, -0.15], forearmR: [-0.15, 0, 0], clubR: [0.05, 0, 0] } },
      { t: 1.0, root: [0, 0, 0.06], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0], armL: [0.08, 0, 0.18], forearmL: [-0.45, 0, 0], armR: [0.10, 0, -0.18], forearmR: [-0.55, 0, 0], clubR: [0.25, 0, 0] } }
    ] },
    hit: { dur: 0.5, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0] } },
      { t: 0.2, root: [0, 0.02, -0.14], joints: { chest: [-0.20, 0.14, -0.10], head: [-0.22, -0.10, 0.08], armL: [-0.45, 0, 0.35], armR: [-0.55, 0, -0.35] } },
      { t: 0.5, root: [0, 0, -0.05], joints: { chest: [0.18, 0, 0], head: [-0.08, 0, 0], armL: [0.08, 0, 0.18], armR: [0.08, 0, -0.18] } }
    ] },
    death: { dur: 2.9, loop: false, frames: [
      { t: 0.0, root: [0, 0, 0], joints: { pelvis: [0, 0, 0], chest: [0.18, 0, 0], head: [-0.08, 0, 0] } },
      { t: 1.2, root: [0, -0.58, 0.12], joints: { pelvis: [0.25, 0, 0], chest: [0.35, 0, 0], head: [0.28, 0, 0], thighL: [-1.15, 0, 0.15], shinL: [1.35, 0, 0], thighR: [-1.15, 0, -0.15], shinR: [1.35, 0, 0], armL: [0.25, 0, 0.35], armR: [0.30, 0, -0.35], clubR: [0.45, 0, 0] } },
      { t: 2.9, root: [0, -1.18, 0.45], joints: { pelvis: [1.18, 0, 0.08], chest: [0.38, 0, -0.06], head: [0.25, 0, 0], thighL: [-1.25, 0, 0.25], shinL: [0.65, 0, 0], thighR: [-1.25, 0, -0.25], shinR: [0.65, 0, 0], armL: [0.55, 0, 0.55], forearmL: [-0.2, 0, 0], armR: [0.65, 0, -0.45], forearmR: [-0.2, 0, 0], clubR: [0.95, 0, 0] } }
    ] }
  },
  hellhound: {
    idle: { dur: 1.8, loop: true, frames: [
      { t: 0.0, root: [0, -0.14, 0], joints: { pelvis: [-0.08, 0, 0], chest: [0.14, 0, 0], head: [-0.12, 0, 0], legFL: [-0.25, 0, 0], legFR: [-0.15, 0, 0], legBL: [0.25, 0, 0], legBR: [0.15, 0, 0], tail: [-0.15, 0.15, 0] } },
      { t: 0.9, root: [0, -0.17, 0], joints: { pelvis: [-0.10, 0, 0], chest: [0.18, 0, 0], head: [-0.16, 0.05, 0], legFL: [-0.28, 0, 0], legFR: [-0.18, 0, 0], legBL: [0.28, 0, 0], legBR: [0.18, 0, 0], tail: [-0.20, -0.15, 0] } },
      { t: 1.8, root: [0, -0.14, 0], joints: { pelvis: [-0.08, 0, 0], chest: [0.14, 0, 0], head: [-0.12, 0, 0], legFL: [-0.25, 0, 0], legFR: [-0.15, 0, 0], legBL: [0.25, 0, 0], legBR: [0.15, 0, 0], tail: [-0.15, 0.15, 0] } }
    ] },
    look: { dur: 2.0, loop: true, frames: [
      { t: 0.0, root: [0, -0.12, 0], joints: { chest: [0.06, -0.18, 0], head: [-0.18, -0.25, 0], tail: [-0.1, 0.2, 0] } },
      { t: 1.0, root: [0, -0.12, 0], joints: { chest: [0.06, 0.18, 0], head: [-0.18, 0.25, 0], tail: [-0.1, -0.2, 0] } },
      { t: 2.0, root: [0, -0.12, 0], joints: { chest: [0.06, -0.18, 0], head: [-0.18, -0.25, 0], tail: [-0.1, 0.2, 0] } }
    ] },
    roar: { dur: 1.2, loop: false, frames: [
      { t: 0.0, root: [0, -0.12, 0], joints: { chest: [0.08, 0, 0], head: [-0.1, 0, 0] } },
      { t: 0.45, root: [0, -0.06, 0.04], joints: { chest: [-0.12, 0, 0], head: [-0.36, 0, 0], legFL: [-0.2, 0, 0], legFR: [-0.2, 0, 0], tail: [0.15, 0, 0] } },
      { t: 1.2, root: [0, -0.14, 0], joints: { chest: [0.14, 0, 0], head: [-0.12, 0, 0], tail: [-0.15, 0, 0] } }
    ] },
    run: { dur: 0.4, loop: true, frames: [
      { t: 0.0, root: [0, 0.02, 0], joints: { pelvis: [0.12, 0, 0], chest: [-0.10, 0, 0], head: [-0.15, 0, 0], legFL: [-0.65, 0, 0], legFR: [-0.35, 0, 0], legBL: [0.60, 0, 0], legBR: [0.30, 0, 0], tail: [0.10, 0.15, 0] } },
      { t: 0.2, root: [0, -0.05, 0], joints: { pelvis: [-0.12, 0, 0], chest: [0.14, 0, 0], head: [-0.20, 0, 0], legFL: [0.55, 0, 0], legFR: [0.30, 0, 0], legBL: [-0.55, 0, 0], legBR: [-0.25, 0, 0], tail: [-0.10, -0.15, 0] } },
      { t: 0.4, root: [0, 0.02, 0], joints: { pelvis: [0.12, 0, 0], chest: [-0.10, 0, 0], head: [-0.15, 0, 0], legFL: [-0.65, 0, 0], legFR: [-0.35, 0, 0], legBL: [0.60, 0, 0], legBR: [0.30, 0, 0], tail: [0.10, 0.15, 0] } }
    ] }
  }
};

const _RADIUS_BY_TYPE = { skeleton: 0.34, cultist: 0.36, wraith: 0.42, hero: 0.42, boss: 0.85, hellhound: 0.36 };
const _TOP_BY_TYPE = { skeleton: 1.85, cultist: 1.80, wraith: 2.10, hero: 1.85, boss: 4.30, hellhound: 1.05 };

// Zeit t im Clip -> Schlüsselbilder f0, f1 und weicher Anteil u (in out abgelegt, keine Objekte pro Bild)
function _sampleClip(out, clip, timeSec) {
  const dur = Math.max(0.01, clip.dur);
  let t = timeSec;
  out.done = false;
  if (clip.loop) t = ((t % dur) + dur) % dur;
  else if (t >= dur) { t = dur; out.done = true; }
  else if (t < 0) t = 0;
  const fr = clip.frames;
  let i0 = fr.length - 2;
  for (let i = 0; i < fr.length - 1; i++) if (t <= fr[i + 1].t) { i0 = i; break; }
  out.f0 = fr[i0]; out.f1 = fr[i0 + 1];
  const u = clamp01((t - out.f0.t) / Math.max(1e-5, out.f1.t - out.f0.t));
  out.u = u * u * (3.0 - 2.0 * u);
  return out;
}

function _evalJointRot(out, s, limbId, sway, fig) {
  const j0 = s.f0.joints[limbId], j1 = s.f1.joints[limbId];
  const a0 = j0 ? j0[0] : 0, a1 = j0 ? j0[1] : 0, a2 = j0 ? j0[2] : 0;
  let rx = lerp(a0, j1 ? j1[0] : a0, s.u), ry = lerp(a1, j1 ? j1[1] : a1, s.u), rz = lerp(a2, j1 ? j1[2] : a2, s.u);
  // Nachschwingen: Umhang, Mantelbahnen, Schwanz
  const ph = fig._phase;
  if (sway === "cape") {
    rx += 0.14 + 0.08 * Math.sin(ph * 2.3) + fig._velZ * 0.06;
    rz += 0.07 * Math.cos(ph * 1.9) - fig._velX * 0.05;
  } else if (sway) {
    const idx = sway.charCodeAt(sway.length - 1) - 49;
    rx += 0.24 + 0.14 * Math.sin(ph * 3.1 + idx * 1.1) + fig._speed * 0.35;
    ry += 0.12 * Math.cos(ph * 2.4 + idx * 0.8);
    rz += 0.08 * Math.sin(ph * 2.7 + idx * 1.4);
  }
  // Kopf dreht sich weich zum Ziel (lookAt)
  if (limbId === "head" && fig.lookAt) {
    const lx = fig.lookAt[0] - fig.x, lz = fig.lookAt[2] - fig.z;
    const ly = fig.lookAt[1] - (fig.y + fig.top * 0.85);
    let rel = Math.atan2(lx, lz) - fig.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    ry = lerp(ry, Math.max(-0.9, Math.min(0.9, rel)), 0.8);
    rx = lerp(rx, Math.max(-0.4, Math.min(0.4, -Math.atan2(ly, Math.hypot(lx, lz)))), 0.6);
  }
  out[0] = rx; out[1] = ry; out[2] = rz;
}

const _S_CUR = { f0: null, f1: null, u: 0, done: false };
const _S_PREV = { f0: null, f1: null, u: 0, done: false };
const _J_CUR = [0, 0, 0], _J_PREV = [0, 0, 0];

function _computeFigureMatrices(fig) {
  const spec = fig._spec, limbs = spec.limbs, s = fig.scale || 1.0;
  const bank = _CLIPS[fig.type];
  const cur = _sampleClip(_S_CUR, bank[fig.clip] || bank[Object.keys(bank)[0]], fig._clipTime);
  fig._done = cur.done;
  const fading = fig._fadeRem > 0 && fig._fadeDur > 1e-4 && fig._prevClip;
  const prev = fading ? _sampleClip(_S_PREV, bank[fig._prevClip], fig._prevClipTime) : null;
  const w = fading ? 1.0 - smoothstep(0.0, 1.0, 1.0 - fig._fadeRem / fig._fadeDur) : 0.0;   // Anteil des alten Clips
  const rootOf = (smp, k) => lerp(smp.f0.root[k], smp.f1.root[k], smp.u);
  const rdx = (fading ? lerp(rootOf(cur, 0), rootOf(prev, 0), w) : rootOf(cur, 0)) * s;
  const rdy = (fading ? lerp(rootOf(cur, 1), rootOf(prev, 1), w) : rootOf(cur, 1)) * s;
  const rdz = (fading ? lerp(rootOf(cur, 2), rootOf(prev, 2), w) : rootOf(cur, 2)) * s;

  // Figur in der Welt; die Skalierung steckt nur hier, Glieder und Gelenke bleiben in Modellmaßen
  _PF_POS[0] = fig.x; _PF_POS[1] = fig.y; _PF_POS[2] = fig.z;
  _PF_ONE[0] = _PF_ONE[1] = _PF_ONE[2] = s;
  Mat4.compose(_M_TMP, _PF_POS, fig.yaw, 0, 0, _PF_ONE);
  _PF_ONE[0] = _PF_ONE[1] = _PF_ONE[2] = 1;

  for (let i = 0; i < limbs.length; i++) {
    const l = limbs[i];
    _evalJointRot(_J_CUR, cur, l.id, l.sway, fig);
    if (fading) {
      _evalJointRot(_J_PREV, prev, l.id, l.sway, fig);
      for (let k = 0; k < 3; k++) _J_CUR[k] = lerp(_J_CUR[k], _J_PREV[k], w);
    }
    _PF_POS[0] = l.pivot[0]; _PF_POS[1] = l.pivot[1]; _PF_POS[2] = l.pivot[2];
    if (l.parentIdx < 0) { _PF_POS[0] += rdx / s; _PF_POS[1] += rdy / s; _PF_POS[2] += rdz / s; }
    Mat4.compose(_M_PARENT_TMP, _PF_POS, _J_CUR[1], _J_CUR[0], _J_CUR[2], _PF_ONE);
    // Weltmatrix pro Figur (nicht pro Art: sonst stünden alle Skelette an derselben Stelle)
    Mat4.multiply(fig._world[i], l.parentIdx < 0 ? _M_TMP : fig._world[l.parentIdx], _M_PARENT_TMP);
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
    radius: _RADIUS_BY_TYPE[type] * scale, top: _TOP_BY_TYPE[type] * scale,
    _spec: spec, _world: spec.limbs.map(() => Mat4.create()),
    _clipTime: 0, _clipSpeed: 1.0, _prevClip: null, _prevClipTime: 0, _fadeRem: 0, _fadeDur: 0, _done: false,
    _phase: hash2(o.x || 0, o.z || 0) * 6.2831853, _lastX: o.x || 0, _lastZ: o.z || 0, _velX: 0, _velZ: 0, _speed: 0,
    play(nextClip, fade = 0.2, speed = 1) {
      const target = bank[nextClip] ? nextClip : this.clip;
      if (target === this.clip && !this.clipDone()) { this._clipSpeed = speed; return true; }
      if (target !== this.clip && fade > 0) {
        this._prevClip = this.clip; this._prevClipTime = this._clipTime; this._fadeDur = fade; this._fadeRem = fade;
      } else { this._fadeRem = 0; this._fadeDur = 0; }
      this.clip = target; this._clipTime = 0; this._clipSpeed = speed || 1.0; this._done = false;
      return true;
    },
    clipDone() {
      const c = bank[this.clip];
      return !c.loop && this._clipTime >= c.dur - 1e-4;
    },
    tipWorld(out) {
      const limbs = this._spec.limbs;
      for (let i = 0; i < limbs.length; i++) if (limbs[i].tip) return _pfMulMatVec(out || _V_TIP_WORLD, this._world[i], limbs[i].tip[0], limbs[i].tip[1], limbs[i].tip[2]);
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

// cam: Kameraposition (für das Ausdünnen ab 35 m)
function updateProcFigures(dt, cam) {
  _PF_FRAME++;
  const stepDt = Math.max(0.0, Math.min(0.1, dt || 0));
  for (let i = 0; i < _PF_FIGS.length; i++) {
    const fig = _PF_FIGS[i];
    if (!fig.visible) { fig._lastX = fig.x; fig._lastZ = fig.z; continue; }
    if (stepDt > 0) {
      const vx = (fig.x - fig._lastX) / stepDt, vz = (fig.z - fig._lastZ) / stepDt;
      fig._velX = Math.max(-1, Math.min(1, vx / 6.0));
      fig._velZ = Math.max(-1, Math.min(1, vz / 6.0));
      fig._speed = Math.min(1, Math.hypot(vx, vz) / 4.0);
      fig._lastX = fig.x; fig._lastZ = fig.z;
      fig._phase += stepDt * (1.2 + fig._speed * 3.0);
      fig._clipTime += stepDt * fig._clipSpeed;
      if (fig._fadeRem > 0) { fig._fadeRem = Math.max(0, fig._fadeRem - stepDt); fig._prevClipTime += stepDt; }
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
