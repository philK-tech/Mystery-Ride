// creatures.js: Tiere und ihre Szenen (Ablauf nach dem Fahrtskript)
// Zone 1: Wolf tritt auf eine Lichtung und heult; Fledermausschwarm stürzt vom Schloss auf das Boot zu
// Zone 2: Leuchtfisch springt vor dem Bug; Tentakel peitschen links und rechts aus dem Wasser
// Zone 3: Herde zieht in der Ferne über die Ebene; schwarze Mantas gleiten an den Schwebefelsen vorbei
// Jede Szene ist an eine Stelle der Strecke gebunden (SCENES in world.js) und läuft dann nach Zeit ab.

function buildGliderMesh() {
  const b = createGeometryBuilder();
  // schlanker Körper, Kopf bei -z
  addLathe(b, 14, 8, (t) => [0, 0, -0.6 + t * 1.7], (t) => {
    const r = 0.13 * Math.pow(Math.sin(Math.min(t * 1.4, 1.0) * Math.PI), 0.7) + 0.01;
    return [r, r * 0.7];
  }, 21, (t) => [0.8, t > 0.6 ? 0.8 : 0.2, 0.0]);
  // zwei Schwingen, nach hinten gepfeilt; extra.z = Abstand vom Körper (für den Flügelschlag)
  for (const s of [-1, 1]) {
    const base = b.positions.length / 3;
    const nI = 12, nJ = 5;
    for (let i = 0; i <= nI; i++) {
      const u = i / nI;
      const chord = 0.95 * (1.0 - Math.pow(u, 1.4) * 0.8);
      const lead = -0.35 + u * 0.55 + Math.sin(u * Math.PI) * 0.1;
      for (let j = 0; j <= nJ; j++) {
        const v = j / nJ;
        const x = s * (0.08 + u * 1.7);
        const y = -0.08 * u * u + 0.03 * Math.sin(v * Math.PI);
        const z = lead + v * chord;
        b.pushVertex(x, y, z, 0, 1, 0, u, v, 0.9, 1.0, u, 21);
      }
    }
    for (let i = 0; i < nI; i++) {
      for (let j = 0; j < nJ; j++) {
        const a = base + i * (nJ + 1) + j;
        b.pushQuad(a, a + 1, a + nJ + 2, a + nJ + 1);
      }
    }
  }
  b.computeSmoothNormals();
  return b;
}



// Fledermaus: kleiner Körper, zwei gezackte Hautflügel (Material 21, extra.z = Spannweite für den Flügelschlag)
function buildBatMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 6, 6, (t) => [0, 0, -0.18 + t * 0.36], (t) => { const r = 0.06 * Math.sin(t * Math.PI) + 0.01; return [r, r]; }, 21, () => [0.8, 0.0, 0.0]);
  // spitze Ohren
  for (const s of [-1, 1]) {
    const base = b.positions.length / 3;
    b.pushVertex(s * 0.02, 0.04, -0.15, 0, 0, -1, 0, 0, 0.8, 0, 0, 21);
    b.pushVertex(s * 0.05, 0.04, -0.13, 0, 0, -1, 0, 0, 0.8, 0, 0, 21);
    b.pushVertex(s * 0.045, 0.11, -0.16, 0, 0, -1, 0, 0, 0.8, 0, 0, 21);
    b.pushTri(base, base + 1, base + 2);
  }
  // Flughaut als feines Gitter: Vorderkante folgt dem Arm, Hinterkante zwischen den Fingerspitzen bogig eingezogen.
  // uv = (Spannweite, Tiefe), extra.y = 0.5 markiert die Flughaut, extra.z = Abstand zum Körper (Flügelschlag)
  const NU = 16, NV = 6;
  const tips = [[0, 0.14], [0.38, 0.2], [0.64, 0.22], [0.86, 0.17], [1.0, 0.0]];
  const trail = (u) => {
    for (let k = 1; k < tips.length; k++) {
      const [u0, z0] = tips[k - 1], [u1, z1] = tips[k];
      if (u <= u1) { const f = (u - u0) / (u1 - u0); return z0 + (z1 - z0) * f - 0.05 * Math.sin(f * Math.PI) * (k > 1 ? 1 : 0.4); }
    }
    return 0;
  };
  const lead = (u) => (u < 0.42 ? -0.1 - 0.035 * (u / 0.42) : -0.135 + 0.135 * Math.pow((u - 0.42) / 0.58, 1.4));
  for (const s of [-1, 1]) {
    const base = b.positions.length / 3;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV;
      const x = 0.04 + u * 0.56;
      const z = lead(u) + (trail(u) - lead(u)) * v;
      const y = 0.025 * Math.sin(v * Math.PI) * (1 - u * 0.6) - 0.02 * u * u;
      b.pushVertex(s * x, y, z, 0, 1, 0, u, v, 0.8, 0.5, x / 0.55, 21);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = base + j * (NU + 1) + i;
      if (s > 0) b.pushQuad(a, a + 1, a + NU + 2, a + NU + 1); else b.pushQuad(a, a + NU + 1, a + NU + 2, a + 1);
    }
  }
  b.computeSmoothNormals();
  return b;
}

// Manta: flacher Körper mit weit geschwungenen, nach hinten gezogenen Schwingen, Kopflappen und Peitschenschwanz.
// Spannweite ~2, schaut nach -z. extra.z = Abstand von der Körpermitte (für den wellenförmigen Flügelschlag).
function buildMantaMesh() {
  const f = (p) => {
    let d = sdEllipsoid(p, [0, 0, 0], [0.22, 0.07, 0.42]);
    for (const s of [-1, 1]) {
      // Schwinge: Vorderkante leicht gebogen, Spitze nach hinten gezogen, nach außen dünner
      d = smin(d, sdFlat(p, [s * 0.1, 0.0, -0.18], [s * 0.62, 0.02, 0.0], 0.13, 1, 3.5), 0.12);
      d = smin(d, sdFlat(p, [s * 0.55, 0.02, 0.0], [s * 1.0, -0.03, 0.22], 0.05, 1, 3.5), 0.12);
      d = smin(d, sdFlat(p, [s * 0.1, 0.0, 0.15], [s * 0.5, 0.0, 0.12], 0.1, 1, 3.5), 0.1);
      d = smin(d, sdFlat(p, [s * 0.1, -0.01, -0.38], [s * 0.13, -0.03, -0.55], 0.03, 0, 2.0), 0.03);
    }
    d = smin(d, sdTaper(p, [0, 0, 0.35], [0, -0.03, 1.9], 0.035, 0.006), 0.05);
    return d;
  };
  return sdfMesh(f, [-1.08, -0.15, -0.65], [1.08, 0.15, 1.95], 0.02, (b, p, n) => {
    b.pushVertex(p[0], p[1], p[2], n[0], n[1], n[2], Math.abs(p[0]), p[2] + 0.6, 0.9, 0.0, Math.abs(p[0]), 21);
  });
}


// --- Tiere aus verschmolzenen Grundkörpern (siehe sdfmesh.js) ---
// abgeflachte Kapsel: Abstand mit gestauchter Achse (für Flossen und Hörner)
function sdFlat(p, a, b, r, ax, squash) {
  const q = [p[0], p[1], p[2]], aa = [a[0], a[1], a[2]], bb = [b[0], b[1], b[2]];
  q[ax] *= squash; aa[ax] *= squash; bb[ax] *= squash;
  return sdCapsule(q, aa, bb, r) / squash;
}
// Fellrauheit: kleine Störung der Oberfläche
const furNoise = (p, s) => (fbm2(p[0] * 31.0 + p[1] * 17.0, p[2] * 29.0 + p[1] * 7.0, 2) - 0.5) * s;

// Wolf: schaut nach -z, Pfoten bei y=0, Schulterhöhe ~0.8.
// Material 23 = Rumpf und Beine, 24 = Hals und Kopf (dreht sich beim Heulen). extra.z der Beine = Schrittphase.
function buildWolfMesh() {
  const legs = [
    { ph: 1, pts: [[-0.08, 0.52, -0.34], [-0.085, 0.26, -0.37], [-0.085, 0.04, -0.35]], r: [0.058, 0.038, 0.03] },
    { ph: -1, pts: [[0.08, 0.52, -0.34], [0.085, 0.26, -0.37], [0.085, 0.04, -0.35]], r: [0.058, 0.038, 0.03] },
    { ph: -1, pts: [[-0.09, 0.56, 0.34], [-0.095, 0.3, 0.47], [-0.09, 0.04, 0.41]], r: [0.075, 0.04, 0.03] },
    { ph: 1, pts: [[0.09, 0.56, 0.34], [0.095, 0.3, 0.47], [0.09, 0.04, 0.41]], r: [0.075, 0.04, 0.03] }
  ];
  const legD = (p, L) => {
    const [a, b2, c2] = L.pts;
    return Math.min(sdTaper(p, a, b2, L.r[0], L.r[1]), sdTaper(p, b2, c2, L.r[1], L.r[2]), sdEllipsoid(p, [c2[0], 0.03, c2[2] - 0.03], [0.038, 0.028, 0.055]));
  };
  const earD = (p) => Math.min(...[-1, 1].map((s) => sdFlat(p, [s * 0.06, 0.9, -0.62], [s * 0.085, 1.07, -0.6], 0.042, 2, 2.2)));
  const headD = (p) => {
    let d = sdTaper(p, [0, 0.62, -0.38], [0, 0.82, -0.6], 0.16, 0.11);
    d = smin(d, sdEllipsoid(p, [0, 0.84, -0.66], [0.1, 0.1, 0.13]), 0.06);
    d = smin(d, sdTaper(p, [0, 0.82, -0.74], [0, 0.77, -0.96], 0.065, 0.034), 0.04);
    return smin(d, earD(p), 0.02);
  };
  const bodyD = (p) => {
    let d = sdEllipsoid(p, [0, 0.58, -0.22], [0.17, 0.23, 0.3]);
    d = smin(d, sdEllipsoid(p, [0, 0.6, 0.22], [0.13, 0.16, 0.32]), 0.14);
    d = smin(d, sdTaper(p, [0, 0.64, 0.5], [0, 0.36, 0.86], 0.06, 0.04), 0.06);
    return d;
  };
  const f = (p) => {
    let d = smin(bodyD(p), headD(p), 0.08);
    for (const L of legs) d = smin(d, legD(p, L), 0.06);
    return d + furNoise(p, 0.016);
  };
  const b = sdfMesh(f, [-0.32, -0.02, -1.05], [0.32, 1.1, 0.95], 0.022, (b, p, n) => {
    const dh = headD(p), db = bodyD(p);
    let best = Math.min(dh, db), leg = null;
    for (const L of legs) { const dl = legD(p, L); if (dl < best) { best = dl; leg = L; } }
    const isHead = !leg && dh <= db;
    const swing = leg ? leg.ph * (0.05 + clamp01((0.56 - p[1]) / 0.56)) : 0.0;
    // Ohren (extra.y = 1) werden beim Heulen im Shader nach hinten angelegt; Gewicht wächst zur Ohrspitze
    const ear = isHead && p[1] > 0.88 && earD(p) < 0.012 ? 1.0 : 0.0;
    b.pushVertex(p[0], p[1], p[2], n[0], n[1], n[2], Math.atan2(p[0], p[1]) / 6.283 + 0.5, p[2] + 1.0, 0.45 + 0.55 * clamp01(p[1] / 0.8), ear, swing, isHead ? 24 : 23);
  });
  // glühende Augen
  for (const s of [-1, 1]) addBox(b, [s * 0.052, 0.865, -0.765], [0.035, 0.02, 0.02], s * 0.4, 0, 24, 3.0);
  return b;
}

// Leuchtfisch: schaut nach -z, Länge ~1. extra.z = Position entlang des Körpers (für den Schwanzschlag)
function buildFishMesh() {
  const f = (p) => {
    let d = sdEllipsoid(p, [0, 0, -0.05], [0.085, 0.15, 0.42]);
    d = smin(d, sdTaper(p, [0, 0, 0.25], [0, 0, 0.5], 0.06, 0.018), 0.08);
    // gegabelte Schwanzflosse, Rücken-, Bauch- und Brustflossen als flache Kapseln
    d = smin(d, sdFlat(p, [0, 0.0, 0.48], [0, 0.2, 0.7], 0.035, 0, 5.0), 0.03);
    d = smin(d, sdFlat(p, [0, 0.0, 0.48], [0, -0.2, 0.7], 0.035, 0, 5.0), 0.03);
    d = smin(d, sdFlat(p, [0, 0.12, -0.15], [0, 0.26, 0.12], 0.035, 0, 5.0), 0.04);
    d = smin(d, sdFlat(p, [0, -0.12, 0.05], [0, -0.2, 0.2], 0.03, 0, 5.0), 0.04);
    for (const s of [-1, 1]) d = smin(d, sdFlat(p, [s * 0.07, -0.05, -0.18], [s * 0.2, -0.12, -0.02], 0.03, 1, 4.0), 0.03);
    return d;
  };
  const b = sdfMesh(f, [-0.25, -0.3, -0.55], [0.25, 0.32, 0.8], 0.014, (b, p, n) => {
    const fin = Math.abs(p[0]) < 0.03 && (Math.abs(p[1]) > 0.14 || p[2] > 0.45) ? 1.0 : 0.0;
    b.pushVertex(p[0], p[1], p[2], n[0], n[1], n[2], Math.atan2(p[0], p[1]) / 6.283 + 0.5, p[2] + 0.5, 0.9, fin, clamp01((p[2] + 0.45) / 1.15) * 1.2, 22);
  });
  for (const s of [-1, 1]) addBox(b, [s * 0.075, 0.04, -0.33], [0.012, 0.035, 0.035], 0, 0, 22, 3.0);
  return b;
}

// Herdentier (antilopenartig): schaut nach -z, Schulterhöhe ~1. Beine mit Schrittphase wie beim Wolf.
function buildHerdAnimalMesh() {
  const legs = [
    { ph: 1, pts: [[-0.08, 0.88, -0.32], [-0.08, 0.46, -0.35], [-0.08, 0.0, -0.31]] },
    { ph: -1, pts: [[0.08, 0.88, -0.32], [0.08, 0.46, -0.35], [0.08, 0.0, -0.31]] },
    { ph: -1, pts: [[-0.09, 0.9, 0.33], [-0.09, 0.46, 0.45], [-0.09, 0.0, 0.38]] },
    { ph: 1, pts: [[0.09, 0.9, 0.33], [0.09, 0.46, 0.45], [0.09, 0.0, 0.38]] }
  ];
  const legD = (p, L) => Math.min(sdTaper(p, L.pts[0], L.pts[1], 0.055, 0.03), sdTaper(p, L.pts[1], L.pts[2], 0.028, 0.02));
  const f = (p) => {
    let d = sdEllipsoid(p, [0, 0.96, 0.05], [0.15, 0.19, 0.46]);
    d = smin(d, sdEllipsoid(p, [0, 0.98, -0.28], [0.16, 0.22, 0.22]), 0.1);
    d = smin(d, sdTaper(p, [0, 1.05, -0.4], [0, 1.42, -0.6], 0.09, 0.055), 0.06);
    d = smin(d, sdEllipsoid(p, [0, 1.46, -0.68], [0.06, 0.07, 0.1]), 0.04);
    d = smin(d, sdTaper(p, [0, 1.44, -0.74], [0, 1.39, -0.86], 0.05, 0.03), 0.03);
    for (const s of [-1, 1]) {
      d = Math.min(d, sdTaper(p, [s * 0.035, 1.51, -0.67], [s * 0.075, 1.72, -0.6], 0.028, 0.02));
      d = Math.min(d, sdTaper(p, [s * 0.075, 1.72, -0.6], [s * 0.06, 1.86, -0.42], 0.02, 0.006));
    }
    for (const L of legs) d = smin(d, legD(p, L), 0.05);
    d = smin(d, sdTaper(p, [0, 1.02, 0.5], [0, 0.82, 0.6], 0.03, 0.015), 0.03);
    return d + furNoise(p, 0.008);
  };
  return sdfMesh(f, [-0.3, -0.02, -0.95], [0.3, 1.9, 0.7], 0.028, (b, p, n) => {
    let best = 1e9, leg = null;
    for (const L of legs) { const dl = legD(p, L); if (dl < best) { best = dl; leg = L; } }
    const onLeg = leg && best < 0.02 && p[1] < 0.9;
    b.pushVertex(p[0], p[1], p[2], n[0], n[1], n[2], 0.5, p[1], 0.5 + 0.5 * clamp01(p[1] / 1.0), 0.0, onLeg ? leg.ph * (0.05 + clamp01((0.9 - p[1]) / 0.9)) : 0.0, 23);
  });
}

const creatureMeshes = {
  glider: uploadStaticMesh(gl, buildGliderMesh()),
  fish: uploadStaticMesh(gl, buildFishMesh()),
  wolf: uploadStaticMesh(gl, buildWolfMesh()),
  bat: uploadStaticMesh(gl, buildBatMesh()),
  manta: uploadStaticMesh(gl, buildMantaMesh()),
  herd: uploadStaticMesh(gl, buildHerdAnimalMesh()),
  tentacle: uploadStaticMesh(gl, buildWhipTentacleMesh())
};

// Abstand entlang der Strecke vom Boot zum Ereignis, positiv = liegt noch voraus (berücksichtigt die Schleife)
function aheadDist(camZ, z) {
  let d = (camZ - z) % LOOP_LENGTH;
  if (d < 0) d += LOOP_LENGTH;
  if (d > LOOP_LENGTH * 0.5) d -= LOOP_LENGTH;
  return d;
}

// Für jedes Bild: Positionen der sichtbaren Tiere und Blickziele (POIs) für die Kamera
const creatureDraws = [];   // { mesh, model, tint, anim }
const pois = [];            // { x, y, z, w }
const drawPool = Array.from({ length: 160 }, () => ({ mesh: null, model: Mat4.create(), tint: [1, 1, 1, 1], anim: [0, 0, 0, 0] }));
const ripplePool = Array.from({ length: 16 }, () => ({ x: 0, z: 0, a: 0 }));
const rippleDraws = [];

// Blickziel der laufenden Szene (die Kamera richtet sich fest darauf) und kurzes Ducken der Kamera (0..1)
const sceneFocus = [0, 0, 0];
let sceneFocusOn = false;
let sceneDuck = 0.0;
let sceneShake = 0.0; // Schütteln des Boots (Tentakel)
let sceneRock = 0.0;  // Kippen des Boots im Takt der Tentakel (-1..1)
let sceneStand = 0.0;
let sceneGrowl = 0.0;
// auf Handys (Touch) sparsamer: weniger Fellschichten, die ferne Herde ganz ohne
const LOW_POWER = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches; // Lautstärke des Tentakelgrollens (audio.js) // Aufstehen und einen Schritt zurück im Boot (0..1)
// Staubwolken: je Wolke x, y, z, Größe, Deckkraft
const DUST_MAX = 240;
const dustData = new Float32Array(DUST_MAX * 5);
let dustCount = 0;

// weicher Verlauf 0..1 zwischen den Zeiten t0 und t1
const ease = (t, t0, t1) => smoothstep(t0, t1, t);
const bez3 = (p0, p1, p2, p3, u) => { const v = 1 - u; return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3; };

function updateCreatures(camZ, t, sceneIdx, sceneT, cam) {
  creatureDraws.length = 0;
  pois.length = 0;
  rippleDraws.length = 0;
  sceneFocusOn = false;
  sceneDuck = 0.0;
  sceneShake = 0.0;
  sceneRock = 0.0;
  sceneStand = 0.0;
  sceneGrowl = 0.0;
  dustCount = 0;
  const dust = (x, y, z, size, a) => {
    if (dustCount >= DUST_MAX || a <= 0.002) return;
    dustData.set([x, y, z, size, a], dustCount * 5);
    dustCount++;
  };
  let k = 0;
  const take = (mesh, tint) => {
    if (k >= drawPool.length) return null;
    const d = drawPool[k++];
    d.mesh = mesh;
    d.tint[0] = tint[0]; d.tint[1] = tint[1]; d.tint[2] = tint[2]; d.tint[3] = tint.length > 3 ? tint[3] : 1;
    d.anim[0] = 0; d.anim[1] = 0; d.anim[2] = 0; d.anim[3] = 0;
    d.fur = 0; d.shells = 0;
    creatureDraws.push(d);
    return d;
  };
  const ripple = (x, z, a) => {
    if (a <= 0) return;
    const r = ripplePool[rippleDraws.length % ripplePool.length];
    r.x = x; r.z = z; r.a = Math.min(a, 1);
    rippleDraws.push(r);
  };
  const focus = (x, y, z) => { sceneFocus[0] = x; sceneFocus[1] = y; sceneFocus[2] = z; sceneFocusOn = true; };
  // Geräusch einmal pro Szenendurchlauf auslösen, sobald die Szenenzeit 'at' erreicht (pan: -1 links .. 1 rechts)
  const cue = (sc, st, name, at, pan) => {
    const k = "_cue" + name + at;
    if (st < at) { sc[k] = false; return; }
    if (sc[k]) return;
    sc[k] = true;
    if (st - at < 0.6 && typeof sfx === "function") sfx(name, Math.max(-1, Math.min(1, pan || 0)));
  };
  const panX = (x) => (x - cam[0]) / 10.0;

  SCENES.forEach((sc, si) => {
    const d = aheadDist(camZ, sc.z);
    if (d > 200 || d < -80) return;
    const zOff = (camZ - d) - sc.z; // Versatz, falls die Szene in einer anderen Runde der Schleife liegt
    const active = si === sceneIdx;
    if (!active && sc.type !== "wolf") return; // der Wolf bleibt nach seiner Szene stehen und sieht dem Boot nach
    const st = active ? sceneT : d > 0 ? 0 : sc.dur;

    if (sc.type === "wolf") {
      // tritt ruhig aus dem Wald auf den Felsvorsprung, heult, bleibt stehen und sieht dem Boot nach
      if (!active && d > 0) return;
      if (d < -45) return;
      const spot = wolfSpot(sc), den = wolfDen(sc);
      const f = ease(st, 0.5, 4.2);
      const x = lerp(den.x, spot.x, f), z = lerp(den.z, spot.z, f) + zOff;
      // auf den letzten Schritten steigt der Wolf auf den Felsvorsprung
      const y = lerp(terrainHeight(x, z) - 0.05, spot.y, ease(f, 0.75, 1.0));
      const g = take(creatureMeshes.wolf, [1.0, 0.65, 0.2]);
      g.fur = 0.045; g.shells = LOW_POWER ? 7 : 12;
      const yawOut = Math.atan2(-(spot.x - den.x), -(spot.z - den.z));
      const toBoat = Math.atan2(-(cam[0] - x), -(cam[2] - z));
      // Körper dreht sich halb zum Boot, den Rest übernimmt der Kopf
      const turn = ease(st, 3.8, 5.0);
      const bodyYaw = lerp(yawOut, yawOut + wrapAngle(toBoat - yawOut) * 0.55, turn);
      const headYaw = Math.max(-1.1, Math.min(1.1, wrapAngle(toBoat - bodyYaw))) * turn;
      Mat4.compose(g.model, [x, y, z], bodyYaw, 0, 0, [2.4, 2.4, 2.4]);
      g.anim[0] = 1.0;
      g.anim[1] = (1.0 - ease(st, 3.4, 4.4)) * ease(st, 0.3, 0.9) * 0.8;
      g.anim[2] = headYaw;
      g.anim[3] = -0.12 + 0.95 * (ease(st, 5.4, 6.3) - ease(st, 8.0, 8.8));
      if (active && st > 5.6 && !sc.howled) { sc.howled = true; if (typeof playHowl === "function") playHowl(); }
      if (!active && d > 0) sc.howled = false;
      if (active && st < 8.8) focus(x, y + 1.4, z); // nach dem Heulen gibt die Kamera den Wolf frei
    } else if (sc.type === "castle") {
      // das Schloss tritt aus dem Nebel; ein Fledermausschwarm steigt von den Zinnen vor den Mond (als Silhouette),
      // dann stürzt er auf Augenhöhe direkt auf das Boot zu und rauscht knapp über den Kopf hinweg
      // Start oberhalb der Turmspitzen, damit der Schwarm nicht durch die Türme fliegt
      const top = [CASTLE.x, CASTLE.top + 12.0, CASTLE.z + zOff];
      const moonPt = [cam[0] + MOON_A[0] * 70, cam[1] + MOON_A[1] * 70, cam[2] + MOON_A[2] * 70];
      const N = 90;
      for (let i = 0; i < N; i++) {
        const h1 = hash2(i, 300.0), h2 = hash2(i, 301.0), h3 = hash2(i, 302.0);
        const q = clamp01((st - 3.0 - h1 * 1.8) / 5.2);
        if (q <= 0 || q >= 1) continue;
        const sx = (h2 - 0.5) * 2.0, sy = (h3 - 0.5);
        // Teil 1 (q < 0.55): vom Turm zum Mond, Teil 2: vom Mond direkt auf den Kopf zu und darüber hinweg
        let x, y, z, px, pz;
        const P = (u) => {
          if (u < 0.55) {
            const v = u / 0.55;
            return [bez3(top[0] + sx * 5, top[0] + sx * 3, moonPt[0] + sx * 8, moonPt[0] + sx * 6, v), bez3(top[1] + h3 * 4, top[1] + 12, moonPt[1] + sy * 8, moonPt[1] + sy * 6, v),
              bez3(top[2] + (h1 - 0.5) * 6, top[2] + 6, moonPt[2] + 4, moonPt[2], v)];
          }
          const v = (u - 0.55) / 0.45;
          return [bez3(moonPt[0] + sx * 6, lerp(moonPt[0], cam[0], 0.5) + sx * 4, cam[0] + sx * 2.2, cam[0] + sx * 5, v),
            bez3(moonPt[1] + sy * 6, lerp(moonPt[1], cam[1], 0.6), cam[1] + 0.55 + sy * 0.6, cam[1] + 1.4 + sy, v),
            bez3(moonPt[2], lerp(moonPt[2], cam[2], 0.5), cam[2] - 3.0, cam[2] + 12.0, v)];
        };
        [x, y, z] = P(q);
        [px, , pz] = P(Math.min(q + 0.01, 1));
        y += Math.sin(t * 9 + i) * 0.15;
        const g = take(creatureMeshes.bat, [0.02, 0.02, 0.025, 0]);
        if (!g) break;
        const s = 0.9 + h1 * 0.6;
        Mat4.compose(g.model, [x, y, z], Math.atan2(-(px - x), -(pz - z)), 0, Math.sin(t * 5 + i) * 0.4, [s, s, s]);
        g.anim[0] = i * 1.7;
        g.anim[2] = 5.0;
      }
      // das Schloss bleibt im Blick; wenn der Schwarm vorbeirauscht, duckt sich die Kamera kurz
      if (st < 10.2) focus(CASTLE.x, CASTLE.top - 6.0, CASTLE.z + zOff);
      // gerade so ducken, wenn der Schwarm ankommt
      sceneDuck = ease(st, 7.3, 7.9) * (1.0 - ease(st, 9.6, 10.6));
      cue(sc, st, "batsFlutter", 3.0, panX(CASTLE.x) * 0.3);
      cue(sc, st, "batsRush", 6.4, 0);
    } else if (sc.type === "fish") {
      // ein Leuchtfisch steigt vor dem Bug auf, springt im Bogen über die Fahrspur und taucht wieder ein
      const zJ = cam[2] - 9.0, cx = riverCenterX(zJ);
      const t0 = 1.4, t1 = 3.8, xa = sc.side * 4.5, xb = -sc.side * 3.5;
      ripple(cx + xa, zJ, st > t0 - 1.0 && st < t0 + 0.5 ? 1.0 - Math.abs(st - t0 + 0.3) * 1.3 : 0);
      cue(sc, st, "splashOut", t0, panX(cx + xa));
      cue(sc, st, "splashIn", t1, panX(cx + xb));
      ripple(cx + xb, zJ, st > t1 - 0.1 && st < t1 + 1.5 ? 1.0 - (st - t1) * 0.65 : 0);
      if (st > t0 && st < t1) {
        const p = (st - t0) / (t1 - t0);
        const x = cx + lerp(xa, xb, p), y = -0.4 + Math.sin(p * Math.PI) * 3.6;
        const f = take(creatureMeshes.fish, [0.2, 0.9, 1.0]);
        const dir = Math.sign(xb - xa);
        Mat4.compose(f.model, [x, y, zJ], dir > 0 ? -Math.PI * 0.5 : Math.PI * 0.5, Math.cos(p * Math.PI) * 0.9, 0, [2.4, 2.4, 2.4]);
        f.anim[0] = 3.0;
        focus(x, Math.max(y, 0.4), zJ);
      } else focus(cx + (st < t0 ? xa : xb) * 0.6, 0.3, zJ);
    } else if (sc.type === "tentacles") {
      // vier Tentakel dicht am Boot: je einer links und rechts, zwei vorn. Sie peitschen im selben Takt,
      // und das Boot kippt im Takt mit (sceneRock, siehe boat.js)
      const bx = riverCenterX(cam[2]);
      const spots = [
        [-1, cam[0] - 4.6, cam[2] - 4.0, 0.0, 8.0],
        [1, cam[0] + 4.4, cam[2] - 5.0, 0.25, 8.0],
        [-1, bx - 1.8, cam[2] - 9.0, 0.6, 11.0],
        [1, bx + 1.9, cam[2] - 12.0, 0.85, 12.0]
      ];
      let fx = 0, fy = 0, fz = 0, n = 0, rockAmp = 0;
      spots.forEach(([side, x, z, delay, h], i) => {
        const up = ease(st, 0.6 + delay, 1.4 + delay), down = ease(st, 7.6 + delay * 0.3, 8.6 + delay * 0.3);
        const lift = up * (1.0 - down);
        cue(sc, st, "tentacleRise", 0.6 + delay, panX(x));
        ripple(x, z, (st > 0.3 + delay && st < 2.5 + delay ? 1.0 : 0) + (st > 7.6 && st < 10.0 ? 0.8 : 0));
        if (lift <= 0.001) return;
        const g = take(creatureMeshes.tentacle, side > 0 ? [0.6, 0.12, 0.9] : [0.05, 0.55, 0.8]);
        // die seitlichen neigen sich über das Boot, die vorderen bäumen sich vor dem Bug auf
        const lean = i < 2 ? 0.3 : 0.15;
        Mat4.compose(g.model, [x, -h * (1.0 - lift) - 0.3, z], side > 0 ? Math.PI : 0, 0, -side * lean * lift, [h, h * 1.1, h]);
        // jeder bewegt sich anders: [Phase, Tempo, Stil]. Die beiden seitlichen schlagen im Takt des Boots,
        // vorn rollt einer langsam spiralig, der andere peitscht schnell mit einrollender Spitze
        const mv = [[Math.PI, 1.0, 1.0], [0.0, 1.0, 0.35], [0.6, 0.6, 0.9], [2.1, 1.4, 2.15]][i];
        g.anim[0] = mv[0];
        g.anim[1] = (i < 2 ? 0.5 : 0.9) + (i < 2 ? 0.35 : 0.7) * ease(st, 2.0, 2.8);
        g.anim[2] = mv[1];
        g.anim[3] = mv[2];
        fx += x; fy += h * lift * 0.5; fz += z; n++;
        rockAmp = Math.max(rockAmp, lift);
      });
      // Boot kippt im Takt der Schläge (gleiche Frequenz wie die Peitschenwelle im Shader)
      sceneRock = Math.sin(t * 4.0) * rockAmp * ease(st, 1.5, 2.5);
      sceneGrowl = rockAmp * (1.0 - ease(st, 8.0, 9.5));
      // Schlag aufs Wasser bei jedem Umkehrpunkt des Kippens, abwechselnd links und rechts
      const sw = Math.sin(t * 4.0) > 0 ? 1 : -1;
      if (sc._sw !== undefined && sw !== sc._sw && st > 2.6 && st < 8.0 && typeof sfx === "function") sfx("tentacleSlap", sw * 0.7);
      sc._sw = sw;
      // man steht auf und tritt einen Schritt zurück, um die Tentakel besser zu sehen
      sceneStand = ease(st, 0.8, 2.2) * (1.0 - ease(st, 9.0, 10.4));
      sceneShake = Math.max(sceneShake, rockAmp * (1.0 - ease(st, 1.4, 2.6)) * 0.6);
      if (n) focus(fx / n, Math.max(fy / n * 0.6, 0.8), Math.min(fz / n, cam[2] - 6.0)); else focus(bx, 1.0, cam[2] - 10.0);
    } else if (sc.type === "herd") {
      // eine Herde zieht in der Ferne schräg über die Ebene
      let cxs = 0, cys = 0, czs = 0, n = 0;
      const p = clamp01(st / sc.dur);
      cue(sc, st, "herd", 0.8, -0.6);
      for (let i = 0; i < 14; i++) {
        const ox = (hash2(i, 320.0) - 0.5) * 16, oz = (hash2(i, 321.0) - 0.5) * 12;
        // die Herde zieht auf dem Hügelkamm entlang, als Silhouette vor dem Himmel
        const x0 = riverCenterX(sc.z - 120) + sc.side * HERD_RIDGE, x1 = riverCenterX(sc.z + 40) + sc.side * HERD_RIDGE;
        const z0 = sc.z - 120, z1 = sc.z + 40;
        const x = lerp(x0, x1, p) + ox, z = lerp(z0, z1, p) + oz + zOff;
        const y = terrainHeight(x, z) - 0.05;
        const g = take(creatureMeshes.herd, [0.32, 0.22, 0.14, 0]);
        if (g && !LOW_POWER) { g.fur = 0.035; g.shells = 5; }
        if (!g) break;
        const s = 3.2 + hash2(i, 322.0) * 0.8;
        const ph = t * 6.5 + i * 1.3;
        Mat4.compose(g.model, [x, y + Math.max(0, Math.sin(ph * 2.0)) * 0.25, z], Math.atan2(-(x1 - x0), -(z1 - z0)), Math.sin(ph * 2.0) * 0.04, 0, [s, s, s]);
        g.anim[0] = i * 1.3;
        g.anim[1] = 1.5;
        // Staub hinter jedem Tier: Wolken entstehen an den Hufen, steigen auf, wachsen und verblassen
        for (let k = 0; k < 8; k++) {
          const age = (t * 0.28 + k / 8 + i * 0.137) % 1.0;
          const back = age * 22.0;
          const dx = (x1 - x0), dz = (z1 - z0), dl = Math.hypot(dx, dz);
          dust(x - dx / dl * back + Math.sin(k * 3.1 + i) * 1.2, y + 0.4 + age * 2.6, z - dz / dl * back, 4.0 + age * 12.0, (1.0 - age) * 0.5);
        }
        cxs += x; cys += y; czs += z; n++;
      }
      if (n) focus(cxs / n, cys / n + 2.0, czs / n);
    } else if (sc.type === "mantas") {
      // schwarze Mantas: kommen schräg von links vorn aus der Ferne, gleiten über den Fluss
      // und ziehen schräg rechts hinter das Boot, wo sie aus dem Bild verschwinden
      let lead = null;
      cue(sc, st, "mantaCall", 1.5, -0.7);
      for (let i = 0; i < 4; i++) cue(sc, st, "mantaPass", 5.8 + i * 1.1, 0);
      for (let i = 0; i < 4; i++) {
        const q = clamp01((st - 0.3 - i * 1.1) / 10.0);
        if (q <= 0 || q >= 1) continue;
        const bz = cam[2], bx = cam[0];
        // jeder Manta auf eigener, seitlich und in der Höhe versetzter Bahn
        const ox = [0, 14, -12, 26][i], oy = [0, 7, -3, 12][i], oz = [0, -10, 12, -22][i];
        const P0 = [bx - 110 + ox, 48 + oy, bz - 150 + oz], P1 = [bx - 40 + ox, 30 + oy, bz - 70 + oz];
        const P2 = [bx + 12 + ox * 0.6, 16 + oy * 0.7, bz - 18 + oz * 0.5], P3 = [bx + 60 + ox, 20 + oy, bz + 60 + oz];
        const pos = (u) => [bez3(P0[0], P1[0], P2[0], P3[0], u), bez3(P0[1], P1[1], P2[1], P3[1], u), bez3(P0[2], P1[2], P2[2], P3[2], u)];
        const [x, y, z] = pos(q), p2 = pos(Math.min(q + 0.01, 1));
        const g = take(creatureMeshes.manta, [0.015, 0.015, 0.02, 0]);
        const s = 5.5 + i * 0.7;
        Mat4.compose(g.model, [x, y + Math.sin(t * 0.6 + i) * 0.6, z], Math.atan2(-(p2[0] - x), -(p2[2] - z)), -(p2[1] - y) * 0.3, -0.25 * Math.sin(q * Math.PI), [s, s, s]);
        g.anim[0] = i * 1.1;
        g.anim[2] = -0.72;
        if (i === 1) lead = [x, y, z];
      }
      // die Kamera folgt nur, solange die Mantas vor dem Boot sind, danach ziehen sie einfach vorbei
      if (lead && lead[2] < cam[2] - 28) focus(lead[0], lead[1], lead[2]);
    }
  });
}
