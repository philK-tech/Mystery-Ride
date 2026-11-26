// world.js: Welt: Platzierung aller Objekte entlang der Strecke (nach dem Fahrtskript)
// --- World Population ---
// Zone 1 (z 0 bis -160): finsterer Nebelwald mit Schloss.  Zone 2 (bis -320): Pilzwald.  Zone 3 (bis -480): offene Ebene.

// Szenen in Reihenfolge der Fahrt. Kommt das Boot auf `trigger` Einheiten heran, fährt es mit `slow` (Anteil des
// normalen Tempos) weiter, die Kamera richtet sich auf das Geschehen und zoomt um `zoom` heran (siehe creatures.js).
const SCENES = [
  { type: "wolf", z: -62, side: -1, dur: 10.5, trigger: 15, slow: 0.25, zoom: 0.55 },
  { type: "castle", z: -150, side: 1, dur: 12.5, trigger: 54, slow: 0.35, zoom: 0.3 },
  { type: "fish", z: -214, side: 1, dur: 6.5, trigger: 14, slow: 0.4, zoom: 0.25 },
  { type: "tentacles", z: -266, side: 1, dur: 10.5, trigger: 15, slow: 0.02, zoom: 0.0 },
  { type: "herd", z: -362, side: -1, dur: 12.0, trigger: 30, slow: 0.45, zoom: 0.45 },
  { type: "mantas", z: -422, side: 1, dur: 12.0, trigger: 36, slow: 0.45, zoom: 0.15 }
];

// Lichtung des Wolfs (halblinks) und sein Versteck im Wald dahinter
function wolfSpot(sc) {
  const x = riverCenterX(sc.z) + sc.side * (riverHalfWidth(sc.z) + 4.0);
  return { x, z: sc.z, y: terrainHeight(x, sc.z) + 0.6 }; // y: Oberkante des Felsvorsprungs
}
function wolfDen(sc) {
  const z = sc.z - 5.0;
  const x = riverCenterX(z) + sc.side * (riverHalfWidth(sc.z) + 15.0);
  return { x, z };
}


// freie Stellen: Lichtung des Wolfs, Weg ins Versteck, Fuß des Schlossfelsens
const CLEARINGS = [
  { ...wolfSpot(SCENES[0]), r: 7.0 },
  { x: (wolfSpot(SCENES[0]).x + wolfDen(SCENES[0]).x) / 2, z: SCENES[0].z - 2.5, r: 4.0 },
  { x: CASTLE.x, z: CASTLE.z, r: 14.0 }
];
// Sichtachsen vom Fluss zum Schloss und zur Lichtung des Wolfs freihalten (aus Richtung des herankommenden Boots)
function clearSightline(x, z, from, r0, r1) {
  for (let k = 1; k <= 6; k++) {
    const f = k / 7;
    CLEARINGS.push({ x: lerp(riverCenterX(z + from), x, f), z: lerp(z + from, z, f), r: lerp(r0, r1, f) });
  }
}
clearSightline(CASTLE.x, CASTLE.z, 45.0, 4.0, 11.0);
clearSightline(wolfSpot(SCENES[0]).x, SCENES[0].z, 16.0, 3.0, 6.0);
function inClearing(x, z, extra = 0) {
  for (const c of CLEARINGS) {
    const dz = Math.abs(z - c.z);
    if (Math.hypot(x - c.x, Math.min(dz, LOOP_LENGTH - dz)) < c.r + extra) return true;
  }
  return false;
}

// Alle Positionen liegen in z zwischen 0 und -LOOP_LENGTH. Beim Zeichnen wird die Welt
// vor und hinter der Kamera wiederholt, dadurch ist die Fahrt eine nahtlose Schleife.
function buildWorld() {
  const L = LOOP_LENGTH;
  const valleyMesh = uploadStaticMesh(gl, buildValleyTerrainMesh());
  const waterMesh = uploadStaticMesh(gl, buildWaterSurfaceMesh());
  const skyDomeMesh = uploadStaticMesh(gl, buildSkyDomeMesh());
  const cliffHousingMesh = uploadStaticMesh(gl, buildWaterfallCliffHousingMesh());
  const mountainMesh = uploadStaticMesh(gl, buildFloatingMountainMesh());
  const waterfallMesh = uploadStaticMesh(gl, buildWaterfallRibbonMesh());
  const plungeRippleMesh = uploadStaticMesh(gl, buildPlungeRippleMesh());
  const shaftMesh = uploadStaticMesh(gl, buildLightShaftMesh());

  const zw = [0, 0, 0];
  // true mit der Wahrscheinlichkeit, mit der die Zonengewichte wA/wB/wC an der Stelle z gelten
  const zoneChance = (z, wA, wB, wC, h) => {
    zoneWeights(z, zw);
    return h < zw[0] * wA + zw[1] * wB + zw[2] * wC;
  };

  // Instanzen
  const groups = {};
  function group(name) {
    if (!groups[name]) groups[name] = { mats: [], tints: [] };
    return groups[name];
  }
  const m = Mat4.create();
  function pushInst(name, pos, rotY, rotX, rotZ, scale, tint) {
    const g = group(name);
    Mat4.compose(m, pos, rotY, rotX, rotZ, scale);
    for (let i = 0; i < 16; i++) g.mats.push(m[i]);
    g.tints.push(tint[0], tint[1], tint[2], tint[3]);
  }
  // Zufallsposition neben dem Fluss: Abstand vom Ufer zwischen dMin und dMax, in z zwischen z0 und z1
  function bankSpot(i, salt, dMin, dMax, bias = 1.0, z0 = 0, z1 = -L) {
    const z = wrapZ(lerp(z0, z1, hash2(i, salt)));
    const side = hash2(i, salt + 0.5) < 0.5 ? -1 : 1;
    const hw = riverHalfWidth(z);
    const bank = dMin + Math.pow(hash2(i, salt + 1.1), bias) * (dMax - dMin);
    const x = riverCenterX(z) + side * (hw + bank);
    // reach: waagrechter Abstand zur Fahrrinne des Boots
    return { x, z, y: terrainHeight(x, z), side, bank, reach: hw + bank - 2.2 };
  }
  const CYAN = [0.10, 0.85, 1.0, 1], BLUE = [0.15, 0.45, 1.0, 1], VIOLET = [0.75, 0.28, 1.0, 1], MAGENTA = [1.0, 0.3, 0.8, 1];
  const rot = (i, salt) => hash2(i, salt) * Math.PI * 2;
  const STONE_A = [0.13, 0.13, 0.16, 1], STONE_C = [0.80, 0.78, 0.72, 1];

  const waterfalls = [];
  const clouds = [];
  const bankCliffHousings = [];
  const plungeRipples = [];
  const lightShafts = [];
  // Lichtkegel: die Achse des Kegels zeigt genau zum Mond
  const addShaft = (x, z, sx, intensity) => {
    const up = MOON_A;
    let rx = [up[1], -up[0], 0]; const rl = Math.hypot(rx[0], rx[1]) || 1; rx = [rx[0] / rl, rx[1] / rl, 0];
    const fz = [rx[1] * up[2], -rx[0] * up[2], rx[0] * up[1] - rx[1] * up[0]];
    const sy = 1.0 + sx * 0.25, y = terrainHeight(x, z);
    const model = new Float32Array([rx[0] * sx, rx[1] * sx, rx[2] * sx, 0, up[0] * sy, up[1] * sy, up[2] * sy, 0, fz[0] * sx, fz[1] * sx, fz[2] * sx, 0, x, y, z, 1]);
    lightShafts.push({ model, z, color: [0.55, 0.65, 0.85, intensity] });
  };

  // ---------------- Zone 1: finsterer Nebelwald ----------------
  // genau ein Wasserfall, an einer Felskante am rechten Ufer
  {
    const fz = -34, side = 1;
    const cx = riverCenterX(fz), hw = riverHalfWidth(fz);
    const cliffX = cx + side * (hw + 1.8);
    const yaw = side < 0 ? Math.PI * 0.42 : -Math.PI * 0.42;
    const h = 8.0;
    const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
    const crestX = cliffX + dirX * 0.25, crestZ = fz + dirZ * 0.25;
    bankCliffHousings.push({ x: cliffX, y: -0.6, z: fz, rotY: yaw, sx: 5.2, sy: h + 1.2, sz: 3.6 });
    CLEARINGS.push({ x: cliffX, z: fz, r: 9.0 }); // keine Bäume im Wasserfallfelsen
    waterfalls.push({ x: crestX, y: h - 0.55, z: crestZ, rotY: yaw, sx: 2.9, sy: h - 0.55, sz: 1.8, isSkyFall: false });
    plungeRipples.push({ x: crestX + dirX * 0.85, y: 0.02, z: crestZ + dirZ * 0.85, sx: 3.4, sz: 3.0 });
    for (const off of [-5.5, 5.0]) {
      const z = fz + off, s = 3.2;
      const x = riverCenterX(z) + side * (riverHalfWidth(z) + 1.5 + s * 1.1);
      pushInst("rocks", [x, terrainHeight(x, z) - 0.5, z], off, 0, 0, [s, s * 1.5, s], [0.8, 0.85, 0.95, 1]);
    }
  }
  // das Schloss auf einem schroffen Felsen
  pushInst("rocks", [CASTLE.x, CASTLE.gy - 2.0, CASTLE.z], 0.8, 0, 0, [14.0, CASTLE.rockH, 12.0], [0.7, 0.72, 0.8, 1]);
  pushInst("castleGothic", [CASTLE.x, CASTLE.gy - 2.0 + CASTLE.rockH * 0.93 - 0.8, CASTLE.z], -1.2, 0, 0, [26, 30, 26], STONE_A);

  // dichter Wald: Nadelbäume (leicht schief, unterschiedlich hoch) und dazwischen Totholz
  for (let i = 0; i < 1500; i++) {
    const p = bankSpot(i, 5.0, 3.5, 70.0, 1.6, -4.0, -172.0);
    if (inClearing(p.x, p.z) || !zoneChance(p.z, 1.0, 0.0, 0.0, hash2(i, 5.7))) continue;
    const h = Math.min(10.0 + hash2(i, 6.4) * 14.0, (p.reach - 2.5) / 0.38);
    if (h < 6.0) continue;
    const dead = hash2(i, 7.1) < 0.18;
    pushInst(dead ? "deadTrees" : "pines", [p.x, p.y - 0.3, p.z], rot(i, 8.1), (hash2(i, 9.1) - 0.5) * 0.14, (hash2(i, 9.7) - 0.5) * 0.14,
      [h, h * (dead ? 0.8 : 1.0), h], CYAN);
  }
  // ein wenig Unterholz: dunkle Farne, Büsche und umgestürzte Stämme (nichts leuchtet)
  const DARK = [0, 0, 0, 1];
  for (let i = 0; i < 200; i++) {
    const p = bankSpot(i, 15.0, 0.6, 10.0, 1.4, 0.0, -165.0);
    if (inClearing(p.x, p.z, -2.0) || !zoneChance(p.z, 1.0, 0.0, 0.0, hash2(i, 15.9))) continue;
    const sc = 0.9 + hash2(i, 16.3) * 1.0;
    pushInst("ferns", [p.x, p.y - 0.05, p.z], rot(i, 17.4), 0, 0, [sc, sc, sc], DARK);
  }
  for (let i = 0; i < 130; i++) {
    const p = bankSpot(i, 150.0, 1.5, 22.0, 1.3, 0.0, -165.0);
    if (inClearing(p.x, p.z, -2.0) || !zoneChance(p.z, 1.0, 0.0, 0.0, hash2(i, 150.9))) continue;
    const sc = 0.9 + hash2(i, 151.0) * 1.4;
    pushInst("bushes", [p.x, p.y - 0.25, p.z], rot(i, 152.0), 0, 0, [sc * 1.4, sc, sc * 1.4], DARK);
  }
  for (let i = 0; i < 26; i++) {
    const p = bankSpot(i, 155.0, 1.5, 18.0, 1.2, 0.0, -165.0);
    if (inClearing(p.x, p.z) || !zoneChance(p.z, 1.0, 0.0, 0.0, hash2(i, 155.9))) continue;
    const L = 5.0 + hash2(i, 156.0) * 5.0;
    pushInst("logs", [p.x, p.y - 0.1, p.z], rot(i, 157.0), 0, (hash2(i, 158.0) - 0.5) * 0.1, [L, L * 0.9, L], DARK);
  }
  // die Lichtung des Wolfs: flacher Felsvorsprung, davor (zum Fluss hin) ein umgestürzter Stamm, der die Beine verdeckt
  {
    const sp = wolfSpot(SCENES[0]);
    pushInst("rocks", [sp.x, sp.y - 0.75, sp.z], 0.4, 0, 0, [2.6, 0.75, 2.3], [0.75, 0.78, 0.85, 1]);
    const lx = sp.x - SCENES[0].side * 2.2;
    pushInst("logs", [lx, terrainHeight(lx, sp.z + 0.5) - 0.05, sp.z + 0.5], Math.PI * 0.5 + 0.15, 0, 0, [7.0, 8.5, 7.0], DARK);
  }
  // moosige Steine am Ufer, wenige
  for (let i = 0; i < 18; i++) {
    const p = bankSpot(i, 1.0, 0.5, 8.0, 1.0, 0.0, -160.0);
    if (inClearing(p.x, p.z)) continue;
    const s = Math.min(0.8 + hash2(i, 2.7) * 1.6, (Math.abs(p.x - riverCenterX(p.z)) - 5.0) / 1.25);
    if (s < 0.5) continue;
    pushInst("rocks", [p.x, p.y - 0.3, p.z], rot(i, 3.1), 0, 0, [s, s * 0.7, s * 0.9], [0.8, 0.85, 0.95, 1]);
  }
  // zwei Laternen
  [[-18, 1]].forEach(([z, side]) => {
    const x = riverCenterX(z) + side * (riverHalfWidth(z) + 1.3);
    pushInst("lanterns", [x, terrainHeight(x, z) - 0.05, z], side > 0 ? Math.PI : 0, 0, 0, [2.3, 2.3, 2.3], [1, 1, 1, 1]);
  });
  // schwache Lichtstrahlen durch den Nebel, ein kräftigerer hinter der Lichtung des Wolfs
  // sparsam: ein schwacher Lichtkegel am Anfang, ein etwas deutlicherer hinter der Lichtung des Wolfs
  addShaft(riverCenterX(-20) + 8.0, -20, 1.0, 0.6);

  // ---------------- Zone 2: Pilzwald ----------------
  // dichte Riesenpilze direkt am Ufer; manche neigen sich als Baldachin über den Fluss
  const MUSH_TINTS = [CYAN, VIOLET, MAGENTA, BLUE];
  // Mindestabstand: Hüte dürfen sich nicht gegenseitig durchdringen (Abstand der Hutmitten > Summe der Hutradien)
  const caps = [];
  for (let i = 0; i < 700; i++) {
    const p = bankSpot(i, 90.0, 0.5, 45.0, 2.0, -158.0, -322.0);
    if (!zoneChance(p.z, 0.0, 1.0, 0.0, hash2(i, 90.7))) continue;
    const canopy = p.bank < 4.0 && hash2(i, 91.5) < 0.5;
    let h = canopy ? 7.5 + hash2(i, 91.0) * 3.0 : (p.bank > 15 ? 7.0 : 3.5) + hash2(i, 91.0) * 5.0;
    // Baldachin: zum Fluss geneigt, der Hut hängt über dem Wasser, bleibt aber hoch über dem Boot
    const lean = canopy ? 0.24 + hash2(i, 92.5) * 0.1 : (hash2(i, 93.0) - 0.5) * 0.1;
    if (!canopy) h = Math.min(h, p.reach / 0.62 + 2.0);
    const capR = 0.66 * h, capX = p.x - p.side * Math.sin(lean) * h * 0.85, capY = p.y + h * 0.85;
    if (caps.some((c) => Math.hypot(c.x - capX, c.z - p.z) < (c.r + capR) * 0.92 && Math.abs(c.y - capY) < (c.r + capR) * 0.5)) continue;
    caps.push({ x: capX, y: capY, z: p.z, r: capR });
    pushInst("giantMushrooms", [p.x, p.y - 0.2, p.z], rot(i, 92.0), 0, p.side * lean, [h, h, h], MUSH_TINTS[Math.floor(hash2(i, 94.0) * 4)]);
  }
  // Torbögen aus Pilzstämmen, unter denen die Fahrt hindurchführt
  [-196, -244, -292].forEach((z, i) => {
    const hw = riverHalfWidth(z) + 2.5;
    pushInst("mushroomArches", [riverCenterX(z), terrainHeight(riverCenterX(z) + hw, z) - 0.3, z], -Math.atan(riverSlopeX(z)), 0, 0,
      [hw, 9.5 + i, hw * 0.9], i === 1 ? VIOLET : CYAN);
  });
  // leuchtendes Schilf und Blütenkelche am Wasser, kleine Pilze
  for (let i = 0; i < 380; i++) {
    const p = bankSpot(i, 25.0, -0.7, 2.0, 1.5, -150.0, -330.0);
    if (!zoneChance(p.z, 0.0, 1.0, 0.0, hash2(i, 25.9))) continue;
    const sc = 0.8 + hash2(i, 26.6) * 0.8;
    pushInst("reeds", [p.x, Math.max(p.y, -0.3) - 0.05, p.z], rot(i, 27.7), 0, 0, [sc, sc, sc], hash2(i, 28.0) < 0.6 ? CYAN : VIOLET);
  }
  for (let i = 0; i < 160; i++) {
    const p = bankSpot(i, 30.0, 0.2, 5.0, 1.4, -158.0, -322.0);
    if (!zoneChance(p.z, 0.0, 1.0, 0.0, hash2(i, 30.9))) continue;
    const sc = 0.7 + hash2(i, 31.5) * 0.7;
    pushInst("buds", [p.x, p.y - 0.05, p.z], rot(i, 32.2), 0, 0, [sc, sc, sc], hash2(i, 33.0) < 0.6 ? CYAN : MAGENTA);
  }
  for (let i = 0; i < 110; i++) {
    const p = bankSpot(i, 40.0, 0.4, 8.0, 1.3, -158.0, -322.0);
    if (!zoneChance(p.z, 0.0, 1.0, 0.0, hash2(i, 40.9))) continue;
    const sc = 0.6 + hash2(i, 42.9) * 1.0;
    pushInst("mushrooms", [p.x, p.y - 0.1, p.z], rot(i, 43.5), 0, 0, [sc, sc, sc], hash2(i, 44.0) < 0.5 ? VIOLET : CYAN);
  }
  for (let i = 0; i < 120; i++) {
    const p = bankSpot(i, 20.0, 0.6, 9.0, 1.5, -158.0, -322.0);
    if (!zoneChance(p.z, 0.0, 1.0, 0.0, hash2(i, 20.9))) continue;
    const sc = 0.8 + hash2(i, 21.3) * 1.0;
    pushInst("broadleaves", [p.x, p.y - 0.05, p.z], rot(i, 22.4), 0, 0, [sc, sc, sc], hash2(i, 23.0) < 0.6 ? CYAN : VIOLET);
  }
  // farbiger Nebel knapp über den Pilzhüten: weiche Nebelballen in Violett und Türkis (erst alle violetten, dann alle türkisen)
  const mistV = [], mistT = [];
  for (let i = 0; i < 240; i++) {
    const z = -168.0 - hash2(i, 500.0) * 146.0;
    const side = hash2(i, 501.0) < 0.5 ? -1 : 1;
    const x = riverCenterX(z) + side * (riverHalfWidth(z) * 0.3 + hash2(i, 502.0) * 40.0);
    const p = [x, 9.0 + hash2(i, 503.0) * 7.0, z, 14.0 + hash2(i, 504.0) * 18.0, 0.07 + hash2(i, 505.0) * 0.07];
    (pnoise(x, z, 0.03, 2) > 0.5 ? mistV : mistT).push(p);
  }

  // einige Quallen hoch über dem Pilzwald
  for (let i = 0; i < 9; i++) {
    const z = -175 - i * 16 - hash2(i, 45.0) * 6;
    const x = riverCenterX(z) + (hash2(i, 46.1) - 0.5) * 16.0;
    const sc = 1.6 + hash2(i, 48.7) * 1.4;
    pushInst("jellyfish", [x, 16.0 + hash2(i, 47.4) * 9.0, z], rot(i, 49.2), 0, 0, [sc, sc, sc], hash2(i, 50.0) < 0.5 ? CYAN : VIOLET);
  }

  // ---------------- Zone 3: offene Ebene mit drei Schwebefelsen ----------------
  // Felsen 1 links mit Wasserfall, Felsen 2 rechts mit Schloss, Felsen 3 rechts mit Ruine; alle eher entfernt
  // jeder Felsen mit eigener Form: Insel mit flachem Becken und Wasserfall, breiter Tafelberg mit Stufen, gespaltener Fels.
  // Sie hängen nicht zu hoch, damit man von unten auf die gekippte Oberseite sieht.
  const floatingPeaks = [
    { z: -360, offsetX: -86, y: 26, sx: 18, sy: 22, sz: 16, fall: true, build: null, variant: 0 },
    { z: -404, offsetX: 96, y: 31, sx: 24, sy: 22, sz: 20, fall: false, build: "fortress", variant: 1 },
    { z: -452, offsetX: 80, y: 23, sx: 17, sy: 20, sz: 15, fall: false, build: "ruins", variant: 2 }
  ];
  // Drehung, die die y-Achse auf u legt (Rodrigues), als Mat4 ohne Verschiebung
  const alignY = (u) => {
    const kx = u[2], kz = -u[0], kl = Math.hypot(kx, kz);
    const m = Mat4.create();
    if (kl < 1e-6) return m;
    const ax = kx / kl, az = kz / kl, c = u[1], sn = kl, t1 = 1 - c;
    m[0] = c + ax * ax * t1; m[1] = az * sn; m[2] = ax * az * t1;
    m[4] = -az * sn; m[5] = c; m[6] = ax * sn;
    m[8] = ax * az * t1; m[9] = -ax * sn; m[10] = c + az * az * t1;
    return m;
  };
  const matTRS = (pos, R, spin, scale) => {
    const S = Mat4.compose(Mat4.create(), [0, 0, 0], spin, 0, 0, scale);
    const M = Mat4.multiply(Mat4.create(), R, S);
    M[12] = pos[0]; M[13] = pos[1]; M[14] = pos[2];
    return M;
  };
  const pushInstM = (name, M, tint) => {
    const g = group(name);
    for (let k = 0; k < 16; k++) g.mats.push(M[k]);
    g.tints.push(tint[0], tint[1], tint[2], tint[3]);
  };
  floatingPeaks.forEach((pk, idx) => {
    pk.x = riverCenterX(pk.z) + pk.offsetX;
    // Oberseite zeigt zum Fluss und zur Anfahrt (Punkt auf dem Fluss 70 Einheiten vor dem Felsen)
    const ax = riverCenterX(pk.z + 70) - pk.x, az = 70.0, al = Math.hypot(ax, az);
    const u = [ax / al * 0.62, 1.0, az / al * 0.62], ul = Math.hypot(...u);
    const R = Mat4.multiply(Mat4.create(), alignY(u.map((c) => c / ul)), Mat4.compose(Mat4.create(), [0, 0, 0], idx * 1.4, 0, 0, [1, 1, 1]));
    pk.model = matTRS([pk.x, pk.y, pk.z], R, 0, [pk.sx, pk.sy, pk.sz]);
    const topH = pk.sy * 0.33;
    const at = (h, ox, oz) => [pk.x + R[0] * ox + R[4] * h + R[8] * oz, pk.y + R[1] * ox + R[5] * h + R[9] * oz, pk.z + R[2] * ox + R[6] * h + R[10] * oz];
    // Richtung zum Fluss im eigenen Koordinatensystem des Felsens
    const wx = pk.offsetX < 0 ? 1 : -1;
    const ldx = R[0] * wx, ldz = R[8] * wx, ldl = Math.hypot(ldx, ldz) || 1;
    if (pk.build === "fortress") pushInstM("citadel", matTRS(at(topH - 0.6, pk.sx * 0.12, 0), R, 0.6, [pk.sx * 0.6, pk.sx * 0.75, pk.sx * 0.6]), STONE_C);
    if (pk.build === "ruins") pushInstM("monoliths", matTRS(at(topH - 0.4, -pk.sx * 0.1, 0), R, 1.1, [pk.sx * 0.6, pk.sx * 0.62, pk.sx * 0.6]), STONE_C);
    // kleine Bäume und Felsbrocken auf dem Rand der Oberseite; wo der Wasserfall stürzt, bleibt der Rand frei
    const fallAng = Math.atan2(ldz, ldx);
    for (let k = 0; k < 7; k++) {
      let a = hash2(idx * 13 + k, 400.0) * Math.PI * 2;
      if (pk.fall && Math.abs(Math.atan2(Math.sin(a - fallAng), Math.cos(a - fallAng))) < 1.0) a += Math.PI * 0.7;
      const r = 0.45 + hash2(idx * 13 + k, 401.0) * 0.3;
      const ox = Math.cos(a) * r * pk.sx * 0.7, oz = Math.sin(a) * r * pk.sz * 0.7;
      const h = topH * (1.0 - r * r * 0.6) - 0.5;
      if (k < 5) { const th = 2.5 + hash2(idx * 13 + k, 402.0) * 3.0; pushInstM("islandTrees", matTRS(at(h, ox, oz), R, a, [th, th, th]), CYAN); }
      else { const sc = 0.8 + hash2(idx * 13 + k, 403.0) * 1.2; pushInstM("rocks", matTRS(at(h, ox, oz), R, a, [sc, sc * 0.7, sc]), [1.05, 0.95, 0.85, 1]); }
    }
    // Wolkenschleier unter dem Felsen (weiche Wolkenpunkte)
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2 + hash2(idx, k) * 0.4, r = pk.sx * (0.5 + hash2(idx * 31 + k, 410.0) * 0.8);
      clouds.push([pk.x + Math.cos(a) * r, pk.y - pk.sy * (0.25 + hash2(idx * 31 + k, 411.0) * 0.45), pk.z + Math.sin(a) * r * 0.8, 10.0 + hash2(idx * 31 + k, 412.0) * 14.0, 0.18 + hash2(idx * 31 + k, 413.0) * 0.16]);
    }
    if (pk.fall) {
      // Austritt am Beckenrand zum Fluss hin; das Band zeigt zum Fluss
      const start = at(pk.sy * 0.04, ldx / ldl * pk.sx * 0.8, ldz / ldl * pk.sz * 0.8);
      waterfalls.push({ x: start[0], y: start[1], z: start[2], rotY: wx * Math.PI * 0.5, sx: 3.0, sy: start[1] - 6.0, sz: 2.0, isSkyFall: true, peakIdx: idx, groundY: 6.0 });
    }
  });
;
  // Grasbüschel und wenige Wiesenblumen, sonst leer
  for (let i = 0; i < 700; i++) {
    const p = bankSpot(i, 35.0, 0.0, 30.0, 1.3, -318.0, -482.0);
    if (!zoneChance(p.z, 0.0, 0.0, 1.0, hash2(i, 35.9))) continue;
    const sc = 0.8 + hash2(i, 36.4) * 0.9;
    if (hash2(i, 36.9) < 0.85) pushInst("reeds", [p.x, p.y - 0.05, p.z], rot(i, 37.8), 0, 0, [sc, sc * 1.3, sc], [0.6, 0.7, 0.3, 1]);
    else pushInst("blossoms", [p.x, p.y - 0.05, p.z], rot(i, 37.8), 0, 0, [sc * 0.7, sc * 0.7, sc * 0.7], [1.0, 0.8, 0.2, 1]);
  }

  // Leuchtpunkte am Boden, nur im Pilzwald, in Flecken gehäuft, nach z sortiert
  const dots = [];
  let tries = 0;
  while (dots.length < 22000 && tries < 300000) {
    const i = tries++;
    const p = bankSpot(i, 60.0, -0.3, 22.0, 1.8, -150.0, -330.0);
    if (p.y < 0.02 || zoneWeights(p.z, zw)[1] < 0.3) continue;
    const patch = pnoise(p.x, p.z, 0.2, 2);
    if (patch < 0.46 + hash2(i, 61.0) * 0.12) continue;
    const h = hash2(i, 62.0);
    const c = h < 0.5 ? [0.05, 0.8, 1.0] : h < 0.8 ? [0.6, 0.25, 1.0] : [1.0, 0.3, 0.8];
    dots.push([p.x, p.y + 0.04, p.z, c[0], c[1], c[2], 0.5 + hash2(i, 63.0) * 1.2]);
  }
  dots.sort((a, b) => b[2] - a[2]);
  const dotData = new Float32Array(dots.length * 7);
  const dotZ = new Float32Array(dots.length);
  dots.forEach((d, i) => { dotData.set(d, i * 7); dotZ[i] = d[2]; });
  const dotVao = gl.createVertexArray();
  gl.bindVertexArray(dotVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, dotData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);

  // Glühwürmchen und schwebende Samen
  const pCount = 1200;
  const pData = new Float32Array(pCount * 7);
  for (let i = 0; i < pCount; i++) {
    const s2 = hash2(i, 52.7);
    const violet = s2 > 0.7;
    pData.set([hash2(i, 51.3), s2, hash2(i, 53.9), violet ? 0.8 : 0.35, violet ? 0.35 : 0.9, 1.0, 0.6 + hash2(i, 54.1) * 1.2], i * 7);
  }
  const pVao = gl.createVertexArray();
  gl.bindVertexArray(pVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, pData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);

  // Wolkenschleier als statischer Punktpuffer (gezeichnet wie die Staubwolken)
  const cloudData = new Float32Array(clouds.length * 5);
  clouds.forEach((c, i) => cloudData.set(c, i * 5));
  const cloudVao = gl.createVertexArray();
  gl.bindVertexArray(cloudVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, cloudData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  gl.bindVertexArray(null);
  const mistAll = mistV.concat(mistT);
  const mistData = new Float32Array(mistAll.length * 5);
  mistAll.forEach((c, i) => mistData.set(c, i * 5));
  const mistVao = gl.createVertexArray();
  gl.bindVertexArray(mistVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, mistData, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
  gl.bindVertexArray(null);
  const mountainMeshes = [
    uploadStaticMesh(gl, buildFloatingMountainMesh({ wide: 0.95, pool: 0.5, seed: 3.0 })),
    uploadStaticMesh(gl, buildFloatingMountainMesh({ wide: 1.1, terrace: 1.0, seed: 7.0 })),
    uploadStaticMesh(gl, buildFloatingMountainMesh({ wide: 1.0, split: 0.45, seed: 11.0 }))
  ];

  const inst = (name, builder, margin) => {
    const g = group(name);
    return uploadInstancedMesh(gl, builder, new Float32Array(g.mats), new Float32Array(g.tints), margin);
  };
  return {
    valleyMesh, waterMesh, skyDomeMesh, mountainMesh, mountainMeshes, floatingPeaks, cloudVao, cloudCount: clouds.length,
    mistVao, mistViolet: mistV.length, mistTeal: mistT.length,
    cliffHousingMesh, bankCliffHousings, plungeRippleMesh, plungeRipples, waterfallMesh, waterfalls,
    shaftMesh, lightShafts,
    instGroups: [
      inst("rocks", buildRockCliffMesh(), 16.0),
      inst("pines", buildPineMesh(), 12.0),
      inst("deadTrees", buildDeadTreeMesh(), 8.0),
      inst("castleGothic", buildGothicCastleMesh(), 30.0),
      inst("ferns", buildFernRosetteMesh(), 2.0),
      inst("bushes", buildBushMesh(), 3.0),
      inst("logs", buildFallenLogMesh(), 6.0),
      inst("lanterns", buildLanternPostMesh(), 2.0),
      inst("giantMushrooms", buildGiantMushroomMeshV2(), 14.0),
      inst("mushroomArches", buildMushroomArchMesh(), 14.0),
      inst("reeds", buildReedClusterMesh(), 2.0),
      inst("buds", buildGlowBudClusterMesh(), 2.0),
      inst("mushrooms", buildGiantMushroomMesh(), 4.0),
      inst("broadleaves", buildBroadLeafPlantMesh(), 3.0),
      inst("jellyfish", buildCanopyJellyfishMesh(), 4.0),
      inst("blossoms", buildGoldenBlossomMesh(), 2.0),
      inst("citadel", buildCrystalCitadelMesh(), 20.0),
      inst("monoliths", buildMonolithRingMesh(), 16.0),
      inst("islandTrees", buildRoundTreeMesh(), 16.0)
    ],
    dotVao, dotZ, dotCount: dots.length,
    particleVao: pVao,
    particleCount: pCount
  };
}

const world = buildWorld();
