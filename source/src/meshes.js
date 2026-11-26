// meshes.js: Prozedurale Meshes (Terrain, Felsen, Wasserfälle, Pflanzen, Quallen ...)
// --- Procedural Meshes ---
function buildValleyTerrainMesh() {
  const b = createGeometryBuilder();
  const segX = 160;
  const segZ = Math.round(LOOP_LENGTH);
  const spanX = 220.0;
  for (let iz = 0; iz <= segZ; iz++) {
    const z = -(iz / segZ) * LOOP_LENGTH;
    const cx = riverCenterX(z);
    const hw = riverHalfWidth(z);
    for (let ix = 0; ix <= segX; ix++) {
      // Spalten nahe am Fluss dichter, weit draußen gröber
      const u = (ix / segX) * 2.0 - 1.0;
      const localX = Math.sign(u) * Math.pow(Math.abs(u), 2.0) * spanX;
      const x = cx + localX;
      const y = terrainHeight(x, z);
      const distFromRiver = Math.max(0.0, Math.abs(localX) - hw);
      const emMask = smoothstep(0.2, 1.6, distFromRiver) * (1.0 - smoothstep(14.0, 30.0, distFromRiver));
      b.pushVertex(x, y, z, 0, 1, 0, x * 0.18, z * 0.18, 0.85, emMask, 0.0, 0);
    }
  }
  const row = segX + 1;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * row + ix;
      b.pushQuad(a, a + 1, a + row + 1, a + row);
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildWaterSurfaceMesh() {
  const b = createGeometryBuilder();
  const segX = 72;
  const segZ = Math.round(LOOP_LENGTH / 1.5);
  const spanX = 22.0;
  for (let iz = 0; iz <= segZ; iz++) {
    const z = -(iz / segZ) * LOOP_LENGTH;
    const cx = riverCenterX(z);
    for (let ix = 0; ix <= segX; ix++) {
      const vx = ix / segX;
      const x = cx + (vx * 2.0 - 1.0) * spanX;
      // e0: Nähe zum Ufer (Terrain knapp unter der Wasserlinie) für leuchtenden Uferschaum
      const shore = smoothstep(-0.7, 0.05, terrainHeight(x, z));
      b.pushVertex(x, 0.0, z, 0, 1, 0, vx, z, shore, 0.0, 0.0, 1);
    }
  }
  const row = segX + 1;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = iz * row + ix;
      b.pushQuad(a, a + 1, a + row + 1, a + row);
    }
  }
  return b;
}

function buildSkyDomeMesh() {
  const b = createGeometryBuilder();
  const rings = 24;
  const sectors = 40;
  const radius = 260.0;
  for (let ir = 0; ir <= rings; ir++) {
    const v = ir / rings;
    const phi = v * Math.PI * 0.52;
    const y = Math.sin(phi) * radius;
    const rXZ = Math.cos(phi) * radius;
    for (let is = 0; is <= sectors; is++) {
      const u = is / sectors;
      const theta = u * Math.PI * 2.0;
      const x = Math.cos(theta) * rXZ;
      const z = Math.sin(theta) * rXZ;
      b.pushVertex(x, y, z, -x, -y, -z, u, v, 1.0, 0.0, 0.0, 99);
    }
  }
  const row = sectors + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < sectors; is++) {
      const a = ir * row + is;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, d, e, c);
    }
  }
  return b;
}

function buildRockCliffMesh() {
  const b = createGeometryBuilder();
  const rings = 28;
  const sectors = 32;
  for (let ir = 0; ir <= rings; ir++) {
    const v = ir / rings;
    // runder, zerklüfteter Felsblock mit geschlossener Kuppe und leicht überhängender Mitte
    const dome = Math.pow(Math.max(0.0, 1.0 - Math.pow(v, 2.4)), 0.55);
    const bulge = 1.0 + 0.18 * Math.sin(v * Math.PI * 0.9);
    const radius = dome * bulge;
    const y = v * 1.0;
    for (let is = 0; is <= sectors; is++) {
      const u = is / sectors;
      const ang = u * Math.PI * 2.0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const nA = fbm2(ca * 1.7 + v * 2.2, sa * 1.7 + v * 1.4 + 3.7, 5);
      const nB = fbm2(ca * 5.0 + v * 7.0, sa * 5.0 - v * 5.0, 3);
      const jag = 0.62 + 0.6 * nA + (nB - 0.5) * 0.12;
      const rx = ca * radius * jag;
      const rz = sa * radius * jag * 0.88;
      const ao = clamp01(0.32 + 0.68 * v);
      const glow = smoothstep(0.55, 0.8, nB) * 0.5;
      b.pushVertex(rx, y, rz, rx, 0.3, rz, u * 3.0, v * 3.0, ao, glow, 0.0, 2);
    }
  }
  const row = sectors + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < sectors; is++) {
      const a = ir * row + is;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  b.computeSmoothNormals();
  return b;
}

// Sculpted waterfall cliff basin: local +Z faces toward the river
function buildWaterfallCliffHousingMesh() {
  const b = createGeometryBuilder();
  const segsX = 28;
  const segsY = 24;
  for (let iy = 0; iy <= segsY; iy++) {
    const v = iy / segsY; // 0 = river base, 1 = top crest
    const y = v * 1.0;
    for (let ix = 0; ix <= segsX; ix++) {
      const u = ix / segsX;
      const sx = u * 2.0 - 1.0; // -1..+1 across cliff face
      const absX = Math.abs(sx);

      const chuteMask = 1.0 - smoothstep(0.14, 0.44, absX);
      const topLip = smoothstep(0.76, 0.92, v) * (1.0 - smoothstep(0.92, 1.0, v));
      const flankBulge = smoothstep(0.16, 0.62, absX) * (1.0 - smoothstep(0.76, 1.0, absX)) * 1.1;
      const taper = 1.0 - Math.pow(v, 1.75) * 0.32;
      const crag = fbm2(sx * 3.6 + 2.1, v * 5.0 + 1.4, 4);

      // Recessed dark alcove in center, overhanging lip at top crest
      let z = (-0.3 + flankBulge + (crag - 0.5) * 0.62) * taper;
      z -= chuteMask * (0.46 - topLip * 0.42);
      z += chuteMask * topLip * 0.34;

      const px = sx * (1.0 + (1.0 - v) * 0.22);
      const ao = clamp01((0.36 + 0.64 * v) * (1.0 - chuteMask * 0.45));
      const glow = smoothstep(0.42, 0.88, crag) * (1.0 - chuteMask * 0.75) * 0.5;
      b.pushVertex(px, y, z, 0, 0.2, 1, u * 3.0, v * 3.0, ao, glow, 0.0, 2);
    }
  }
  const row = segsX + 1;
  for (let iy = 0; iy < segsY; iy++) {
    for (let ix = 0; ix < segsX; ix++) {
      const a = iy * row + ix;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  b.computeSmoothNormals();
  return b;
}

const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Form-Varianten: wide = Breite, pool = Mulde oben (Wasserbecken), terrace = Felsstufen, split = Spalt quer durch den Fels
function buildFloatingMountainMesh(opt = {}) {
  const { wide = 1.0, pool = 0.0, terrace = 0.0, split = 0.0, seed = 0.0 } = opt;
  const b = createGeometryBuilder();
  const rings = 40;
  const sectors = 56;
  // v=0 ist die hängende Spitze unten, v=0.7 das breite Plateau, v=1 die bemooste Kuppe
  const ringStart = [];
  for (let ir = 0; ir <= rings; ir++) {
    const v = ir / rings;
    let radius, y;
    if (v < 0.7) {
      const t = v / 0.7;
      radius = Math.pow(t, 0.72) * wide;
      y = (t - 0.7) * 0.95;
      if (terrace > 0) radius *= 1.0 + terrace * Math.max(0, Math.sin(t * Math.PI * 4.0)) * 0.12;
    } else {
      const t = (v - 0.7) / 0.3;
      radius = Math.cos(t * Math.PI * 0.47) * wide;
      y = t * 0.34 - pool * Math.pow(Math.max(0, t - 0.55) / 0.45, 2.0) * 0.18;
    }
    ringStart.push(b.positions.length / 3);
    for (let is = 0; is <= sectors; is++) {
      const u = is / sectors;
      const ang = u * Math.PI * 2.0;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const n = fbm2(ca * 2.2 + v * 3.0 + seed, sa * 2.2 + 8.2 + seed * 0.7, 5);
      // Spalt: an zwei gegenüberliegenden Winkeln tief eingeschnitten
      const cleft = split > 0 ? 1.0 - split * (Math.exp(-Math.pow(wrapAng(ang - 0.6), 2) * 30.0) + Math.exp(-Math.pow(wrapAng(ang - 0.6 - Math.PI), 2) * 30.0)) * smoothstep(0.2, 0.8, v) : 1.0;
      // Unterseite: senkrechte Felsrippen und Zacken, oben ein leicht überhängender Rand
      const ribs = v < 0.72 ? (fbm2(ang * 4.0, v * 1.2 + 3.0, 3) - 0.5) * 0.35 * (1.0 - v) : 0.0;
      const lip = smoothstep(0.66, 0.74, v) * (1.0 - smoothstep(0.74, 0.86, v)) * 0.08;
      const jag = (0.62 + 0.58 * n) * (1.0 + ribs + lip) * cleft;
      const rx = ca * radius * jag;
      const rz = sa * radius * jag * 0.86;
      const glow = smoothstep(0.55, 0.85, n) * 0.6;
      b.pushVertex(rx, y, rz, rx, y + 0.2, rz, u * 4.0, v * 4.0, 0.35 + 0.65 * v, glow, 0.0, 2);
    }
  }
  const row = sectors + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < sectors; is++) {
      const a = ir * row + is;
      b.pushQuad(a, a + 1, a + row + 1, a + row);
    }
  }
  b.computeSmoothNormals();

  return b;
}

function buildStoneArchMesh() {
  const b = createGeometryBuilder();
  const segs = 36;
  const radialSegs = 12;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ang = t * Math.PI; // 0..PI across river
    const archX = -Math.cos(ang) * 11.5;
    const archY = Math.sin(ang) * 10.5 - 0.6;
    const thick = lerp(2.1, 1.15, Math.sin(ang));
    const tx = Math.sin(ang) * 11.5;
    const ty = Math.cos(ang) * 10.5;
    const tLen = Math.hypot(tx, ty) || 1.0;
    const nxBase = -ty / tLen;
    const nyBase = tx / tLen;

    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs;
      const phi = v * Math.PI * 2.0;
      const crag = 0.78 + 0.36 * fbm2(t * 9.0, v * 5.0, 3);
      const r = thick * crag;
      const px = archX + nxBase * Math.cos(phi) * r;
      const py = archY + nyBase * Math.cos(phi) * r;
      const pz = Math.sin(phi) * r * 1.15;
      const glow = smoothstep(0.62, 0.92, crag) * 0.45;
      b.pushVertex(px, py, pz, nxBase * Math.cos(phi), nyBase * Math.cos(phi), Math.sin(phi), t * 5.0, v * 2.0, 0.75, glow, 0.0, 2);
    }
  }
  const row = radialSegs + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * row + j;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  b.computeSmoothNormals();
  return b;
}

// Waterfall ribbon: local y goes from 0 (crest) down to -1 (river surface), curving forward along +Z
function buildWaterfallRibbonMesh() {
  const b = createGeometryBuilder();
  const layers = [
    { zOff: 0.0, wScale: 1.0, uvMul: 1.0, glow: 1.0 },
    { zOff: 0.14, wScale: 0.82, uvMul: 1.35, glow: 1.25 }
  ];
  for (let l = 0; l < layers.length; l++) {
    const lay = layers[l];
    const segsX = 18;
    const segsY = 28;
    const baseIdx = b.positions.length / 3;
    for (let iy = 0; iy <= segsY; iy++) {
      const v = iy / segsY; // 0 = top crest, 1 = bottom splash
      const curveZ = lay.zOff + Math.sin(Math.min(v * 1.35, 1.0) * Math.PI * 0.5) * 0.85;
      const flareX = (0.76 + Math.pow(v, 0.85) * 0.46) * lay.wScale;
      for (let ix = 0; ix <= segsX; ix++) {
        const u = ix / segsX;
        const ux = (u * 2.0 - 1.0) * 0.5 * flareX;
        const rippleZ = Math.sin(u * Math.PI * 6.0 + v * 8.0 + l * 1.7) * 0.05;
        const edgeFade = 1.0 - Math.pow(Math.abs(u * 2.0 - 1.0), 2.2);
        const topFade = smoothstep(0.0, 0.06, v);
        b.pushVertex(
          ux, -v, curveZ + rippleZ,
          0, 0.25, 1,
          u * lay.uvMul, v * 3.0 * lay.uvMul,
          edgeFade * topFade, lay.glow, l * 0.5, 4
        );
      }
    }
    const row = segsX + 1;
    for (let iy = 0; iy < segsY; iy++) {
      for (let ix = 0; ix < segsX; ix++) {
        const a = baseIdx + iy * row + ix;
        const c = a + 1;
        const d = a + row;
        const e = d + 1;
        b.pushQuad(a, d, e, c);
      }
    }
  }
  return b;
}

function buildPlungeRippleMesh() {
  const b = createGeometryBuilder();
  const rings = 6;
  const sectors = 28;
  for (let ir = 0; ir <= rings; ir++) {
    const v = ir / rings; // 0 = center, 1 = outer edge
    const r = 0.1 + v * 0.9;
    for (let is = 0; is <= sectors; is++) {
      const u = is / sectors;
      const ang = u * Math.PI * 2.0;
      b.pushVertex(Math.cos(ang) * r, 0.02, Math.sin(ang) * r, 0, 1, 0, u, v, 1.0 - v, 1.0, 0.0, 15);
    }
  }
  const row = sectors + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < sectors; is++) {
      const a = ir * row + is;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  return b;
}

// Großblättrige Bodenpflanze mit leuchtenden Blattadern (Material 13)
function buildBroadLeafPlantMesh() {
  const b = createGeometryBuilder();
  const leaves = 7;
  for (let l = 0; l < leaves; l++) {
    const ang = (l / leaves) * Math.PI * 2.0 + hash2(l, 2.0) * 0.5;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const stemLen = 0.25 + hash2(l, 3.0) * 0.25;
    const rise = 0.35 + hash2(l, 4.0) * 0.45;
    const bladeLen = 0.75 + hash2(l, 5.0) * 0.4;
    const bladeW = 0.42 + hash2(l, 6.0) * 0.12;
    const segL = 8, segW = 4;
    const base = b.positions.length / 3;
    for (let i = 0; i <= segL; i++) {
      const t = i / segL;
      const r = stemLen + t * bladeLen;
      const y = rise + Math.sin(t * Math.PI * 0.6) * 0.18 - t * t * 0.42;
      const halfW = Math.pow(Math.sin(Math.min(t * 1.25 + 0.05, 1.0) * Math.PI * 0.5 + (t > 0.8 ? 0 : 0)), 0.6) * bladeW * 0.5 * (1.0 - Math.pow(t, 3.0));
      for (let j = 0; j <= segW; j++) {
        const s2 = j / segW * 2.0 - 1.0;
        const cup = -s2 * s2 * 0.06;
        b.pushVertex(ca * r - sa * s2 * halfW, y + cup, sa * r + ca * s2 * halfW, 0, 1, 0, j / segW, t, 0.6 + 0.4 * t, 1.0, 0.3 + t * 0.7, 13);
      }
    }
    for (let i = 0; i < segL; i++) {
      for (let j = 0; j < segW; j++) {
        const a = base + i * (segW + 1) + j;
        b.pushQuad(a, a + 1, a + segW + 2, a + segW + 1);
      }
    }
    // Stiel
    const sBase = b.positions.length / 3;
    const segS = 4;
    for (let i = 0; i <= segS; i++) {
      const t = i / segS;
      const r = t * stemLen;
      const y = Math.sin(t * Math.PI * 0.5) * rise;
      const w = 0.025;
      b.pushVertex(ca * r + sa * w, y, sa * r - ca * w, 0, 1, 0, 0.45, -1.0, 0.5, 0.4, t * 0.3, 13);
      b.pushVertex(ca * r - sa * w, y, sa * r + ca * w, 0, 1, 0, 0.55, -1.0, 0.5, 0.4, t * 0.3, 13);
    }
    for (let i = 0; i < segS; i++) {
      const a = sBase + i * 2;
      b.pushQuad(a, a + 1, a + 3, a + 2);
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildFernRosetteMesh() {
  const b = createGeometryBuilder();
  const fronds = 10;
  const segs = 5;
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2.0 + (f % 2) * 0.15;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const perpX = -sinA, perpZ = cosA;
    const len = 0.68 + (f % 3) * 0.14;
    const lift = 0.36 + (f % 2) * 0.1;
    const startIdx = b.positions.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = t * len;
      const y = Math.sin(t * Math.PI * 0.72) * lift;
      const halfW = Math.sin(t * Math.PI) * 0.12 + 0.015;
      const tipGlow = smoothstep(0.45, 1.0, t) * 0.85;
      const px = cosA * r;
      const pz = sinA * r;
      b.pushVertex(px - perpX * halfW, y, pz - perpZ * halfW, 0, 1, 0, 0, t, 0.7 + 0.3 * t, tipGlow, t, 7);
      b.pushVertex(px + perpX * halfW, y, pz + perpZ * halfW, 0, 1, 0, 1, t, 0.7 + 0.3 * t, tipGlow, t, 7);
    }
    for (let s = 0; s < segs; s++) {
      const a = startIdx + s * 2;
      b.pushQuad(a, a + 1, a + 3, a + 2);
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildReedClusterMesh() {
  const b = createGeometryBuilder();
  const blades = 12;
  for (let i = 0; i < blades; i++) {
    const ang = (i / blades) * Math.PI * 2.0;
    const lean = 0.14 + (i % 3) * 0.06;
    const h = 0.55 + (i % 4) * 0.16;
    const bx = Math.cos(ang) * 0.12;
    const bz = Math.sin(ang) * 0.12;
    const dx = Math.cos(ang) * lean;
    const dz = Math.sin(ang) * lean;
    const px = -Math.sin(ang) * 0.025;
    const pz = Math.cos(ang) * 0.025;
    const baseIdx = b.positions.length / 3;
    b.pushVertex(bx - px, 0, bz - pz, 0, 1, 0, 0, 0, 0.6, 0.0, 0.0, 8);
    b.pushVertex(bx + px, 0, bz + pz, 0, 1, 0, 1, 0, 0.6, 0.0, 0.0, 8);
    b.pushVertex(bx + dx * 0.5 - px * 0.7, h * 0.5, bz + dz * 0.5 - pz * 0.7, 0, 1, 0, 0, 0.5, 0.85, 0.45, 0.5, 8);
    b.pushVertex(bx + dx * 0.5 + px * 0.7, h * 0.5, bz + dz * 0.5 + pz * 0.7, 0, 1, 0, 1, 0.5, 0.85, 0.45, 0.5, 8);
    b.pushVertex(bx + dx, h, bz + dz, 0, 1, 0, 0.5, 1.0, 1.0, 1.2, 1.0, 8);
    b.pushQuad(baseIdx, baseIdx + 1, baseIdx + 3, baseIdx + 2);
    b.pushTri(baseIdx + 2, baseIdx + 3, baseIdx + 4);
  }
  b.computeSmoothNormals();
  return b;
}

function buildGlowBudClusterMesh() {
  const b = createGeometryBuilder();
  const buds = [
    { x: 0.0, y: 0.0, z: 0.0, r: 0.14, h: 0.38 },
    { x: 0.18, y: 0.0, z: 0.08, r: 0.11, h: 0.28 },
    { x: -0.16, y: 0.0, z: 0.11, r: 0.10, h: 0.24 },
    { x: 0.05, y: 0.0, z: -0.17, r: 0.12, h: 0.31 }
  ];
  for (const bud of buds) {
    const rings = 7, sectors = 10;
    const baseIdx = b.positions.length / 3;
    for (let ir = 0; ir <= rings; ir++) {
      const v = ir / rings;
      const profile = Math.sin(v * Math.PI) * bud.r;
      const py = bud.y + v * bud.h;
      const glow = smoothstep(0.25, 0.95, v) * 1.45;
      for (let is = 0; is <= sectors; is++) {
        const u = is / sectors;
        const ang = u * Math.PI * 2.0;
        b.pushVertex(bud.x + Math.cos(ang) * profile, py, bud.z + Math.sin(ang) * profile, Math.cos(ang), 0.3, Math.sin(ang), u, v, 0.7 + 0.3 * v, glow, v, 9);
      }
    }
    const row = sectors + 1;
    for (let ir = 0; ir < rings; ir++) {
      for (let is = 0; is < sectors; is++) {
        const a = baseIdx + ir * row + is;
        const c = a + 1;
        const d = a + row;
        const e = d + 1;
        b.pushQuad(a, c, e, d);
      }
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildGoldenBlossomMesh() {
  const b = createGeometryBuilder();
  const petals = 10;
  for (let p = 0; p < petals; p++) {
    const ang = (p / petals) * Math.PI * 2.0;
    const tilt = 0.55 + (p % 2) * 0.25;
    const len = 0.52;
    const wid = 0.14;
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const px = -sinA * wid, pz = cosA * wid;
    const tipX = cosA * len * Math.sin(tilt);
    const tipZ = sinA * len * Math.sin(tilt);
    const tipY = 0.16 + len * Math.cos(tilt);
    const baseIdx = b.positions.length / 3;
    b.pushVertex(0, 0.12, 0, 0, 1, 0, 0.5, 0.0, 0.7, 0.4, 0.0, 10);
    b.pushVertex(tipX * 0.55 - px, 0.15 + len * 0.55 * Math.cos(tilt), tipZ * 0.55 - pz, 0, 1, 0, 0, 0.5, 0.9, 1.1, 0.5, 10);
    b.pushVertex(tipX * 0.55 + px, 0.15 + len * 0.55 * Math.cos(tilt), tipZ * 0.55 + pz, 0, 1, 0, 1, 0.5, 0.9, 1.1, 0.5, 10);
    b.pushVertex(tipX, tipY, tipZ, 0, 1, 0, 0.5, 1.0, 1.0, 1.65, 1.0, 10);
    b.pushTri(baseIdx, baseIdx + 1, baseIdx + 2);
    b.pushTri(baseIdx + 1, baseIdx + 3, baseIdx + 2);
  }
  b.computeSmoothNormals();
  return b;
}

function buildGiantMushroomMesh() {
  const b = createGeometryBuilder();
  // Stalk
  const sRings = 8, sSecs = 10;
  for (let ir = 0; ir <= sRings; ir++) {
    const v = ir / sRings;
    const r = lerp(0.14, 0.08, v);
    const y = v * 0.72;
    for (let is = 0; is <= sSecs; is++) {
      const u = is / sSecs;
      const ang = u * Math.PI * 2.0;
      b.pushVertex(Math.cos(ang) * r, y, Math.sin(ang) * r, Math.cos(ang), 0.1, Math.sin(ang), u, v, 0.6 + 0.4 * v, 0.25, v * 0.4, 11);
    }
  }
  const sRow = sSecs + 1;
  for (let ir = 0; ir < sRings; ir++) {
    for (let is = 0; is < sSecs; is++) {
      const a = ir * sRow + is;
      const c = a + 1;
      const d = a + sRow;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  // Cap
  const cRings = 7, cSecs = 18;
  const baseIdx = b.positions.length / 3;
  for (let ir = 0; ir <= cRings; ir++) {
    const v = ir / cRings;
    const r = Math.sin(v * Math.PI * 0.88) * 0.62;
    const y = 0.72 + Math.cos(v * Math.PI * 0.5) * 0.24;
    for (let is = 0; is <= cSecs; is++) {
      const u = is / cSecs;
      const ang = u * Math.PI * 2.0;
      const rib = 1.0 + 0.08 * Math.sin(ang * 14.0);
      const glow = (0.55 + 0.65 * Math.sin(ang * 14.0)) * smoothstep(0.15, 0.85, v);
      b.pushVertex(Math.cos(ang) * r * rib, y, Math.sin(ang) * r * rib, Math.cos(ang) * 0.5, 0.85, Math.sin(ang) * 0.5, u, v, 0.85, glow, 0.8, 11);
    }
  }
  const cRow = cSecs + 1;
  for (let ir = 0; ir < cRings; ir++) {
    for (let is = 0; is < cSecs; is++) {
      const a = baseIdx + ir * cRow + is;
      const c = a + 1;
      const d = a + cRow;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildCanopyJellyfishMesh() {
  const b = createGeometryBuilder();
  // Ribbed bell (top at y=0 down to rim y=-0.42)
  const rings = 8, secs = 22;
  for (let ir = 0; ir <= rings; ir++) {
    const v = ir / rings;
    const r = Math.sin(v * Math.PI * 0.65) * 1.15;
    const y = -v * 0.42;
    for (let is = 0; is <= secs; is++) {
      const u = is / secs;
      const ang = u * Math.PI * 2.0;
      const rib = 1.0 + 0.09 * Math.sin(ang * 16.0);
      const glow = 0.75 + 0.55 * Math.sin(ang * 16.0);
      b.pushVertex(Math.cos(ang) * r * rib, y, Math.sin(ang) * r * rib, Math.cos(ang) * 0.4, 0.9, Math.sin(ang) * 0.4, u, v, 0.9, glow, 1.0, 12);
    }
  }
  const row = secs + 1;
  for (let ir = 0; ir < rings; ir++) {
    for (let is = 0; is < secs; is++) {
      const a = ir * row + is;
      const c = a + 1;
      const d = a + row;
      const e = d + 1;
      b.pushQuad(a, c, e, d);
    }
  }
  // Trailing glowing tentacles
  const tenCount = 12, tenSegs = 8;
  for (let tc = 0; tc < tenCount; tc++) {
    const ang = (tc / tenCount) * Math.PI * 2.0;
    const rStart = 0.25 + (tc % 3) * 0.22;
    const tx = Math.cos(ang) * rStart;
    const tz = Math.sin(ang) * rStart;
    const tLen = 1.35 + (tc % 4) * 0.28;
    const nx = -Math.sin(ang), nz = Math.cos(ang);
    const startIdx = b.positions.length / 3;
    for (let s = 0; s <= tenSegs; s++) {
      const t = s / tenSegs;
      const w = lerp(0.024, 0.004, t);
      const py = -0.35 - t * tLen;
      const swayX = Math.sin(t * 5.0 + tc) * 0.14 * t;
      const glow = 1.25 * (1.0 - t * 0.45);
      b.pushVertex(tx + swayX - nx * w, py, tz - nz * w, nx, 0, nz, 0, t, 0.95, glow, 1.0, 12);
      b.pushVertex(tx + swayX + nx * w, py, tz + nz * w, nx, 0, nz, 1, t, 0.95, glow, 1.0, 12);
    }
    for (let s = 0; s < tenSegs; s++) {
      const a = startIdx + s * 2;
      b.pushQuad(a, a + 1, a + 3, a + 2);
    }
  }
  b.computeSmoothNormals();
  return b;
}

function buildLightShaftMesh() {
  const b = createGeometryBuilder();
  const segs = 16;
  const topR = 0.35;
  const botR = 1.6;
  const h = 16.0;
  for (let iy = 0; iy <= 1; iy++) {
    const v = iy;
    const y = (1.0 - v) * h;
    const r = lerp(topR, botR, v);
    for (let is = 0; is <= segs; is++) {
      const u = is / segs;
      const ang = u * Math.PI * 2.0;
      b.pushVertex(Math.cos(ang) * r, y, Math.sin(ang) * r, Math.cos(ang), 0.15, Math.sin(ang), u, v, 1.0, 1.0, 0.0, 20);
    }
  }
  const row = segs + 1;
  for (let is = 0; is < segs; is++) {
    b.pushQuad(is, is + 1, row + is + 1, row + is);
  }
  return b;
}

// Nadelbaum (Nebeltal): dünner Stamm, gestaffelte, hängende Nadelschichten. Höhe 1, Fuß bei 0.
function buildPineMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 10, 8, (t) => [0, t * 0.98, 0], (t) => { const r = lerp(0.035, 0.008, t) * (1.0 + 0.8 * Math.pow(1.0 - t, 6.0)); return [r, r]; },
    31, (t) => [0.4 + 0.6 * t, 0.0, t * 0.2]);
  const tiers = 10;
  for (let k = 0; k < tiers; k++) {
    const f = k / (tiers - 1);
    const yTop = 0.2 + f * 0.8;
    const R = 0.27 * Math.pow(1.0 - f, 0.85) + 0.035;
    const drop = 0.10 + 0.05 * (1.0 - f);
    const segs = 18;
    const base = b.positions.length / 3;
    // Mitte, ein Zwischenring und der gezackte, herabhängende Rand
    for (const [rf, yf, v] of [[0.0, 0.0, 0.0], [0.55, 0.45, 0.55], [1.0, 1.0, 1.0]]) {
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2.0 + k * 0.7;
        const jag = rf > 0.9 ? 0.82 + 0.3 * Math.abs(Math.sin(a * 4.5 + k)) : 1.0;
        const r = R * rf * jag;
        const y = yTop - drop * Math.pow(yf, 1.3) - (rf > 0.9 ? 0.02 * Math.sin(a * 9.0) : 0.0);
        b.pushVertex(Math.cos(a) * r, y, Math.sin(a) * r, 0, 1, 0, j / segs, v, 0.35 + 0.65 * f * (0.6 + 0.4 * v), 0.0, 0.2 + 0.6 * v * f, 30);
      }
    }
    for (let ring = 0; ring < 2; ring++) {
      for (let j = 0; j < segs; j++) {
        const a = base + ring * (segs + 1) + j;
        b.pushQuad(a, a + 1, a + segs + 2, a + segs + 1);
      }
    }
  }
  b.computeSmoothNormals();
  return b;
}

// Riesenpilz (Pilzwald): geschwungener Stiel, breiter flacher Hut mit Krempe und Lamellen. Höhe ~1.
// extra.y: 0 Stiel, 1 Hutoberseite, 2 Unterseite
function buildGiantMushroomMeshV2() {
  const b = createGeometryBuilder();
  const bend = (t) => [Math.sin(t * 2.2) * 0.06, t * 0.72, Math.sin(t * 1.7) * 0.03];
  addLathe(b, 14, 16, bend, (t) => {
    const r = 0.11 + 0.10 * Math.pow(1.0 - t, 3.0) + 0.07 * Math.pow(t, 4.0);
    return [r, r * 0.92];
  }, 32, (t) => [0.45 + 0.55 * t, 0.0, 0.0]);
  const top = bend(1.0);
  const capR = 0.62, rings = 12, secs = 32;
  // Oberseite: flache Kuppel bis zur Krempe, die leicht nach unten fällt
  let base = b.positions.length / 3;
  for (let i = 0; i <= rings; i++) {
    const f = i / rings;
    const r = f * capR;
    const y = top[1] + 0.16 * (1.0 - f * f) - (f > 0.85 ? (f - 0.85) * 0.5 : 0.0);
    for (let j = 0; j <= secs; j++) {
      const a = (j / secs) * Math.PI * 2.0;
      const wob = 1.0 + 0.05 * Math.sin(a * 3.0) * f;
      b.pushVertex(top[0] + Math.cos(a) * r * wob, y, top[2] + Math.sin(a) * r * wob, 0, 1, 0, j / secs, f, 0.95, 1.0, 0.0, 32);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < secs; j++) {
    const a = base + i * (secs + 1) + j;
    b.pushQuad(a, a + 1, a + secs + 2, a + secs + 1);
  }
  // Unterseite mit Lamellen: vom Rand zurück zum Stiel
  base = b.positions.length / 3;
  for (let i = 0; i <= 6; i++) {
    const f = 1.0 - i / 6;
    const r = 0.1 + f * (capR - 0.1);
    const y = top[1] - 0.03 + 0.10 * (1.0 - f) - (f > 0.85 ? (f - 0.85) * 0.5 : 0.0) + 0.02;
    for (let j = 0; j <= secs; j++) {
      const a = (j / secs) * Math.PI * 2.0;
      const wob = 1.0 + 0.05 * Math.sin(a * 3.0) * f;
      b.pushVertex(top[0] + Math.cos(a) * r * wob, y, top[2] + Math.sin(a) * r * wob, 0, -1, 0, j / secs, f, 0.7, 2.0, 0.0, 32);
    }
  }
  for (let i = 0; i < 6; i++) for (let j = 0; j < secs; j++) {
    const a = base + i * (secs + 1) + j;
    b.pushQuad(a, a + 1, a + secs + 2, a + secs + 1);
  }
  b.computeSmoothNormals();
  return b;
}

// Rundkronen-Baum (Himmelsinseln): gedrehter Stamm, der sich in Äste mit gebauschten Kronen teilt. Höhe ~1.
function buildRoundTreeMesh() {
  const b = createGeometryBuilder();
  const trunk = (t) => [Math.sin(t * 2.5) * 0.08, t * 0.55, Math.cos(t * 1.9) * 0.05 - 0.05];
  addLathe(b, 12, 10, trunk, (t) => { const r = lerp(0.07, 0.04, t) * (1.0 + 1.2 * Math.pow(1.0 - t, 5.0)); return [r, r]; },
    31, (t) => [0.4 + 0.6 * t, 0.0, t * 0.1]);
  const fork = trunk(1.0);
  const crowns = [[0.0, 0.85, 0.0, 0.30], [0.26, 0.72, 0.12, 0.22], [-0.24, 0.70, -0.08, 0.21], [0.05, 0.68, -0.27, 0.19], [-0.08, 0.66, 0.26, 0.18]];
  crowns.forEach(([cx, cy, cz, cr], ci) => {
    if (ci > 0) {
      addLathe(b, 6, 6, (t) => [lerp(fork[0], cx, t), lerp(fork[1] - 0.05, cy - cr * 0.6, t), lerp(fork[2], cz, t)],
        (t) => { const r = lerp(0.035, 0.018, t); return [r, r]; }, 31, (t) => [0.6, 0.0, 0.1 + t * 0.1]);
    }
    // gebauschte Krone: Kugel mit Beulen, unten abgeflacht
    const rings = 10, secs = 14;
    const base = b.positions.length / 3;
    for (let i = 0; i <= rings; i++) {
      const v = i / rings;
      const phi = v * Math.PI;
      for (let j = 0; j <= secs; j++) {
        const a = (j / secs) * Math.PI * 2.0;
        const nx = Math.sin(phi) * Math.cos(a), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(a);
        const bump = 1.0 + 0.22 * (fbm2(nx * 2.2 + ci * 3.1, nz * 2.2 + ny * 1.7, 3) - 0.5) * 2.0;
        const flat = ny < 0 ? 0.55 : 1.0;
        b.pushVertex(cx + nx * cr * bump, cy + ny * cr * bump * 0.8 * flat, cz + nz * cr * bump, nx, ny, nz, j / secs, v, 0.5 + 0.5 * (ny * 0.5 + 0.5), 0.0, 0.3, 33);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < secs; j++) {
      const a = base + i * (secs + 1) + j;
      b.pushQuad(a, a + secs + 1, a + secs + 2, a + 1);
    }
  });
  b.computeSmoothNormals();
  return b;
}

// Quader mit eigenen (flachen) Normalen, gedreht um z (rotZ) und dann um y (rotY)
function addBox(b, c, size, rotY, rotZ, matId, extraY = 0.0) {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const cy = Math.cos(rotY), sy = Math.sin(rotY), cz = Math.cos(rotZ), sz = Math.sin(rotZ);
  const tr = (x, y, z) => {
    const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
    return [x1 * cy + z * sy, y1, -x1 * sy + z * cy];
  };
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]]
  ];
  for (const [n, corners] of faces) {
    const base = b.positions.length / 3;
    const nn = tr(n[0], n[1], n[2]);
    corners.forEach(([x, y, z], k) => {
      const p = tr(x * hx, y * hy, z * hz);
      b.pushVertex(c[0] + p[0], c[1] + p[1], c[2] + p[2], nn[0], nn[1], nn[2], k === 0 || k === 3 ? 0 : 1, k < 2 ? 0 : 1, 0.85, extraY, 0.0, matId);
    });
    b.pushQuad(base, base + 1, base + 2, base + 3);
  }
}

// Tentakel (Pilzwald): wächst aus dem Boden und rollt sich oben ein. Höhe 1.
// extra.z = Position entlang des Tentakels (für die Bewegung im Shader)
function buildTentacleMesh() {
  const b = createGeometryBuilder();
  const center = (t) => {
    const s = Math.sin(t * 2.4) * 0.12;
    if (t < 0.62) return [s, t, 0];
    const f = (t - 0.62) / 0.38;
    const ang = f * 4.2, r = 0.16 * (1.0 - f * 0.6);
    return [Math.sin(0.62 * 2.4) * 0.12 + Math.sin(ang) * r, 0.62 + (1.0 - Math.cos(ang)) * r * 0.9 + f * 0.05, 0];
  };
  addLathe(b, 40, 14, center, (t) => { const r = 0.075 * Math.pow(1.0 - t, 0.8) + 0.006; return [r, r]; },
    34, (t) => [0.45 + 0.55 * t, 1.0, t]);
  return b;
}

// leuchtende Glaskugel (Pilzwald), Radius 1
function buildOrbMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 14, 18, (t) => [0, -1 + t * 2, 0], (t) => { const r = Math.sin(t * Math.PI) + 0.001; return [r, r]; }, 35, () => [1.0, 1.0, 0.0]);
  return b;
}

// verfallener Torbogen: zwei Pfeiler, ein gebrochener Bogen, herabgefallene Steine. Höhe ~1.
function buildRuinArchMesh() {
  const b = createGeometryBuilder();
  const w = 0.16;
  addBox(b, [-0.55, 0.32, 0], [w, 0.64, w * 1.2], 0, 0, 36);
  addBox(b, [0.55, 0.26, 0], [w, 0.52, w * 1.2], 0, 0.03, 36);
  addBox(b, [-0.55, 0.66, 0], [w * 1.3, 0.05, w * 1.5], 0, 0, 36);
  const segs = 11;
  for (let i = 0; i < segs; i++) {
    if (i === 7 || i === 8 || i === 10) continue; // gebrochen
    const a = Math.PI * (1 - (i + 0.5) / segs);
    const x = Math.cos(a) * 0.55, y = 0.66 + Math.sin(a) * 0.5;
    addBox(b, [x, y, 0], [0.16, 0.13, w * 1.1], 0, a - Math.PI / 2, 36);
  }
  [[0.75, 0.05, 0.3, 0.6], [0.4, 0.04, -0.35, 1.9], [0.95, 0.06, -0.15, 0.3]].forEach(([x, y, z, r]) => addBox(b, [x, y, z], [0.15, 0.1, 0.13], r, 0.2, 36));
  return b;
}

// schlanker weißer Turm mit Balkonringen und spitzem Dach (Himmelsinseln). Höhe 1.
function buildSpireTowerMesh() {
  const b = createGeometryBuilder();
  const tower = (ox, oz, h, r) => {
    addLathe(b, 8, 12, (t) => [ox, t * h * 0.72, oz], (t) => { const rr = r * (1.0 - t * 0.25); return [rr, rr]; }, 36, (t) => [0.6 + 0.4 * t, 0.0, 0.0]);
    for (const f of [0.35, 0.72]) {
      addLathe(b, 2, 12, (t) => [ox, h * f - 0.01 + t * 0.02, oz], () => [r * 1.35, r * 1.35], 36, () => [0.9, 0.0, 0.0]);
    }
    // Fenster als leuchtende Schlitze
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI * 0.5 + 0.4;
      addBox(b, [ox + Math.cos(a) * r * 0.92, h * 0.55, oz + Math.sin(a) * r * 0.92], [0.012, 0.06, 0.02], -a, 0, 38);
    }
    addLathe(b, 6, 12, (t) => [ox, h * 0.72 + t * h * 0.28, oz], (t) => { const rr = r * 1.15 * Math.pow(1.0 - t, 1.3) + 0.002; return [rr, rr]; }, 37, (t) => [0.9, t, 0.0]);
  };
  tower(0, 0, 1.0, 0.07);
  tower(0.12, 0.05, 0.62, 0.045);
  tower(-0.09, -0.08, 0.48, 0.04);
  return b;
}

// Burgruine (Nebeltal, als Silhouette auf einem fernen Hügel). Grundfläche ~1 x 1.
function buildCastleRuinMesh() {
  const b = createGeometryBuilder();
  const towers = [[-0.45, -0.4, 0.55, 0.11], [0.45, -0.38, 0.42, 0.1], [0.4, 0.42, 0.3, 0.1], [-0.42, 0.4, 0.62, 0.12], [0.0, 0.0, 0.85, 0.14]];
  towers.forEach(([x, z, h, r], k) => {
    addLathe(b, 6, 10, (t) => [x, t * h, z], () => [r, r], 36, (t) => [0.5 + 0.5 * t, 0.0, 0.0]);
    // Zinnen, bei manchen Türmen teilweise abgebrochen
    for (let i = 0; i < 8; i++) {
      if ((i + k) % 3 === 0 && k !== 4) continue;
      const a = (i / 8) * Math.PI * 2;
      addBox(b, [x + Math.cos(a) * r * 0.9, h + 0.025, z + Math.sin(a) * r * 0.9], [r * 0.4, 0.05, r * 0.3], -a, 0, 36);
    }
    if (k === 4) addLathe(b, 4, 10, (t) => [x, h + 0.05 + t * 0.2, z], (t) => { const rr = r * 1.1 * (1 - t) + 0.003; return [rr, rr]; }, 37, (t) => [0.8, t, 0.0]);
    addBox(b, [x + r * 0.95, h * 0.6, z], [0.01, 0.04, 0.02], 0, 0, 38);
  });
  // Mauern zwischen den Türmen, oben ausgebrochen
  const walls = [[0, 1], [1, 2], [2, 3], [3, 0]];
  walls.forEach(([a, c], k) => {
    const [x0, z0] = towers[a], [x1, z1] = towers[c];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const h = 0.18 + 0.1 * Math.abs(Math.sin(i * 2.7 + k)) - (k === 2 && i > 2 ? 0.12 : 0);
      const x = lerp(x0, x1, f), z = lerp(z0, z1, f);
      addBox(b, [x, h / 2, z], [Math.hypot(x1 - x0, z1 - z0) / n + 0.01, h, 0.06], Math.atan2(-(z1 - z0), x1 - x0), 0, 36);
    }
  });
  return b;
}

// Laternenpfahl (Nebeltal): Pfahl, Arm und eine warm leuchtende Laterne. Höhe ~1.
function buildLanternPostMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, 0.5, 0], [0.05, 1.0, 0.05], 0, 0.04, 31);
  addBox(b, [0.13, 0.95, 0], [0.28, 0.03, 0.03], 0, 0, 31);
  addBox(b, [0.25, 0.84, 0], [0.03, 0.14, 0.03], 0, 0, 31);
  addBox(b, [0.25, 0.72, 0], [0.11, 0.13, 0.11], 0, 0, 38);
  addBox(b, [0.25, 0.80, 0], [0.13, 0.025, 0.13], 0, 0, 31);
  return b;
}

// Kuppeltempel (Himmelsinseln): achteckiger Sockel, Säulenkranz, Rundbau mit leuchtenden Fenstern, Kuppel mit Kristall. Höhe ~1.
function buildTempleMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 2, 8, (t) => [0, t * 0.08, 0], () => [0.62, 0.62], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 2, 8, (t) => [0, 0.08 + t * 0.05, 0], () => [0.54, 0.54], 36, () => [0.9, 0.0, 0.0]);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    addLathe(b, 3, 8, (t) => [Math.cos(a) * 0.46, 0.13 + t * 0.4, Math.sin(a) * 0.46], (t) => [0.032 - t * 0.006, 0.032 - t * 0.006], 36, () => [0.85, 0.0, 0.0]);
  }
  addLathe(b, 2, 16, (t) => [0, 0.53 + t * 0.05, 0], () => [0.52, 0.52], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 4, 16, (t) => [0, 0.13 + t * 0.42, 0], () => [0.34, 0.34], 36, () => [0.8, 0.0, 0.0]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    addBox(b, [Math.cos(a) * 0.345, 0.32, Math.sin(a) * 0.345], [0.012, 0.2, 0.09], -a, 0, 38);
  }
  addLathe(b, 10, 20, (t) => [0, 0.58 + Math.sin(t * Math.PI * 0.5) * 0.3, 0], (t) => { const r = Math.cos(t * Math.PI * 0.5) * 0.4 + 0.004; return [r, r]; }, 36, (t) => [0.95, t, 0.0]);
  addLathe(b, 3, 8, (t) => [0, 0.87 + t * 0.06, 0], () => [0.05, 0.05], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 6, 6, (t) => [0, 0.93 + t * 0.16, 0], (t) => { const r = Math.sin(t * Math.PI) * 0.045 + 0.002; return [r, r]; }, 35, () => [1.0, 1.0, 0.0]);
  return b;
}

// Kathedrale (Himmelsinseln): Langhaus mit Spitzbogenfenstern, fünf Spitztürme unterschiedlicher Höhe. Höhe ~1.
function buildCathedralMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, 0.16, 0], [0.32, 0.32, 0.7], 0, 0, 36);
  // Satteldach aus zwei schrägen Platten
  addBox(b, [0.085, 0.37, 0], [0.2, 0.02, 0.72], 0, -0.7, 37);
  addBox(b, [-0.085, 0.37, 0], [0.2, 0.02, 0.72], 0, 0.7, 37);
  for (let k = 0; k < 4; k++) {
    for (const sx of [-1, 1]) addBox(b, [sx * 0.162, 0.17, -0.24 + k * 0.16], [0.01, 0.16, 0.05], 0, 0, 38);
  }
  addBox(b, [0, 0.2, -0.352], [0.1, 0.2, 0.01], 0, 0, 38);
  const spire = (x, z, h, r) => {
    addLathe(b, 6, 8, (t) => [x, t * h * 0.68, z], (t) => { const rr = r * (1.0 - t * 0.15); return [rr, rr]; }, 36, (t) => [0.6 + 0.4 * t, 0.0, 0.0]);
    addLathe(b, 2, 8, (t) => [x, h * 0.68 + t * 0.02, z], () => [r * 1.3, r * 1.3], 36, () => [0.9, 0.0, 0.0]);
    addBox(b, [x, h * 0.5, z - r * 0.98], [r * 0.5, h * 0.12, 0.008], 0, 0, 38);
    addLathe(b, 6, 8, (t) => [x, h * 0.7 + t * h * 0.3, z], (t) => { const rr = r * 1.2 * Math.pow(1.0 - t, 1.6) + 0.002; return [rr, rr]; }, 37, (t) => [0.9, t, 0.0]);
  };
  spire(0, -0.42, 1.0, 0.075);
  spire(-0.15, -0.34, 0.78, 0.06);
  spire(0.15, -0.34, 0.82, 0.06);
  spire(-0.13, 0.36, 0.6, 0.05);
  spire(0.13, 0.36, 0.55, 0.05);
  return b;
}

// Satteldach als Prisma (First entlang z), Fußpunkt-Mitte c
function addPrismRoof(b, c, w, h, d, rotY, matId) {
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const tr = (x, y, z) => [c[0] + x * cy + z * sy, c[1] + y, c[2] - x * sy + z * cy];
  const hw = w / 2, hd = d / 2;
  const quad = (a, b2, c2, d2, n) => {
    const base = b.positions.length / 3;
    const nn = [n[0] * cy + n[2] * sy, n[1], -n[0] * sy + n[2] * cy];
    [a, b2, c2, d2].forEach((p, k) => { const q = tr(...p); b.pushVertex(q[0], q[1], q[2], nn[0], nn[1], nn[2], k & 1, k >> 1, 0.9, 0.0, 0.0, matId); });
    b.pushQuad(base, base + 1, base + 3, base + 2);
  };
  const sl = Math.hypot(hw, h);
  quad([-hw, 0, -hd], [-hw, 0, hd], [0, h, -hd], [0, h, hd], [-h / sl, hw / sl, 0]);
  quad([hw, 0, hd], [hw, 0, -hd], [0, h, hd], [0, h, -hd], [h / sl, hw / sl, 0]);
  for (const z of [-hd, hd]) {
    const base = b.positions.length / 3;
    const n = tr(0, 0, Math.sign(z)); const nn = [n[0] - c[0], 0, n[2] - c[2]];
    [[-hw, 0, z], [hw, 0, z], [0, h, z]].forEach((p) => { const q = tr(...p); b.pushVertex(q[0], q[1], q[2], nn[0], nn[1], nn[2], 0.5, 0.5, 0.9, 0.0, 0.0, 36); });
    b.pushTri(base, base + 1, base + 2);
  }
}

// Totholzbaum (Nebelwald): krummer, kahler Stamm mit wenigen knorrigen Ästen. Höhe 1.
function buildDeadTreeMesh() {
  const b = createGeometryBuilder();
  const trunk = (t) => [Math.sin(t * 3.1) * 0.06 + t * t * 0.08, t, Math.cos(t * 2.3) * 0.04];
  addLathe(b, 14, 8, trunk, (t) => { const r = lerp(0.045, 0.01, t) * (1.0 + 1.5 * Math.pow(1.0 - t, 6.0)); return [r, r * 0.9]; }, 31, (t) => [0.35 + 0.6 * t, 0.0, t * 0.15]);
  for (let k = 0; k < 6; k++) {
    const t0 = 0.4 + k * 0.09;
    const o = trunk(t0);
    const a = k * 2.4 + 0.5, len = 0.32 - k * 0.03;
    addLathe(b, 6, 5, (t) => [o[0] + Math.cos(a) * t * len + Math.sin(t * 6.0 + k) * 0.02, o[1] + t * len * (0.25 + 0.15 * Math.sin(k)) - t * t * 0.05, o[2] + Math.sin(a) * t * len],
      (t) => { const r = lerp(0.014, 0.003, t); return [r, r]; }, 31, (t) => [0.6, 0.0, 0.1 + t * 0.3]);
  }
  return b;
}

// Gotisches Schloss (Nebelwald), sauber zusammengesetzt: Sockel, Ringmauer mit Zinnen, vier Ecktürme an den
// Mauerecken (einer zerbrochen, ohne Dach), Palas mit steilem Dach, hoher Hauptturm, Kapelle mit Dachreiter,
// dürre Spitzen und wenige kalt leuchtende Fenster. Grundfläche ~1 x 0.7, Höhe ~1.2.
function buildGothicCastleMesh() {
  const b = createGeometryBuilder();
  const W = 0.46, D = 0.32;                       // halbe Breite und Tiefe des Mauerrings
  addBox(b, [0, -0.2, 0], [W * 2 + 0.16, 0.42, D * 2 + 0.16], 0, 0, 36);   // Sockel bis in den Felsen
  // Ringmauer mit Zinnen und Wehrgang
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
    addBox(b, [(x0 + x1) / 2, 0.11, (z0 + z1) / 2], [len, 0.22, 0.05], ang, 0, 36);
    const n = Math.floor(len / 0.06);
    for (let k = 0; k < n; k += 2) {
      const f = (k + 0.5) / n;
      addBox(b, [lerp(x0, x1, f), 0.245, lerp(z0, z1, f)], [0.03, 0.05, 0.05], ang, 0, 36);
    }
  };
  wall(-W, -D, W, -D); wall(W, -D, W, D); wall(W, D, -W, D); wall(-W, D, -W, -D);
  // Ecktürme genau auf den Mauerecken
  const tower = (x, z, h, r, roof, broken) => {
    addLathe(b, 6, 8, (t) => [x, -0.05 + t * (h + 0.05), z], (t) => { const rr = r * (1.06 - t * 0.12); return [rr, rr]; }, 36, (t) => [0.5 + 0.5 * t, 0.0, 0.0]);
    if (broken) {
      // ausgebrochene Krone: unregelmäßige Mauerreste
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, hh = 0.03 + 0.08 * Math.abs(Math.sin(k * 2.3));
        if (k % 3 === 1) continue;
        addBox(b, [x + Math.cos(a) * r * 0.85, h + hh / 2, z + Math.sin(a) * r * 0.85], [r * 0.55, hh, r * 0.3], -a, 0, 36);
      }
      return;
    }
    addLathe(b, 2, 8, (t) => [x, h + t * 0.03, z], () => [r * 1.22, r * 1.22], 36, () => [0.9, 0.0, 0.0]);
    if (roof) {
      addLathe(b, 7, 8, (t) => [x, h + 0.03 + t * roof, z], (t) => { const rr = r * 1.3 * Math.pow(1.0 - t, 1.6) + 0.002; return [rr, rr]; }, 37, (t) => [0.8, 0.0, 0.0]);
      addLathe(b, 3, 4, (t) => [x, h + 0.03 + roof + t * 0.06, z], () => [0.004, 0.004], 37, () => [0.8, 0.0, 0.0]);   // dürre Spitze
    }
  };
  tower(-W, -D, 0.42, 0.075, 0.32, false);
  tower(W, -D, 0.38, 0.07, 0.28, false);
  tower(-W, D, 0.36, 0.07, 0.26, false);
  tower(W, D, 0.3, 0.075, 0, true);
  // Palas mit steilem Satteldach (First entlang x) und Giebel
  addBox(b, [-0.05, 0.19, -0.08], [0.46, 0.38, 0.26], 0, 0, 36);
  addPrismRoof(b, [-0.05, 0.38, -0.08], 0.3, 0.26, 0.5, Math.PI / 2, 37);
  for (let k = 0; k < 4; k++) addBox(b, [-0.22 + k * 0.11, 0.08, -0.215], [0.03, 0.16, 0.03], 0, 0, 36);   // Strebepfeiler, stehen auf dem Boden
  // Hauptturm, hinten am Palas angesetzt
  tower(0.12, 0.0, 0.78, 0.085, 0.42, false);
  // Kapelle mit Dachreiter
  addBox(b, [-0.24, 0.13, 0.17], [0.2, 0.26, 0.16], 0, 0, 36);
  addPrismRoof(b, [-0.24, 0.26, 0.17], 0.18, 0.2, 0.22, Math.PI / 2, 37);
  addLathe(b, 5, 6, (t) => [-0.24, 0.43 + t * 0.14, 0.17], (t) => { const rr = 0.025 * (1 - t) + 0.002; return [rr, rr]; }, 37, () => [0.8, 0.0, 0.0]);
  // wenige kalt leuchtende Fenster (Spitzbögen), einer im Hauptturm
  addBox(b, [0.02, 0.24, -0.212], [0.035, 0.09, 0.004], 0, 0, 38, 2.0);
  addBox(b, [0.12 - 0.087, 0.6, 0.0], [0.004, 0.07, 0.025], 0, 0, 38, 2.0);
  addBox(b, [-0.24, 0.15, 0.252], [0.03, 0.08, 0.004], 0, 0, 38, 2.0);
  return b;
}

// Festung auf dem zweiten Schwebefelsen: Bergfried mit Dach, runder Mauerring mit Zinnen, vier Rundtürme mit Kegeldächern. Höhe ~1.
function buildFortressMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 2, 16, (t) => [0, -0.35 + t * 0.37, 0], () => [0.56, 0.56], 36, () => [0.9, 0.0, 0.0]);
  addBox(b, [0, 0.25, 0], [0.3, 0.5, 0.3], 0.3, 0, 36);
  addPrismRoof(b, [0, 0.5, 0], 0.32, 0.2, 0.32, 0.3, 37);
  const R = 0.48;
  for (let k = 0; k < 16; k++) {
    const a0 = (k / 16) * Math.PI * 2, a1 = ((k + 1) / 16) * Math.PI * 2, am = (a0 + a1) / 2;
    addBox(b, [Math.cos(am) * R, 0.1, Math.sin(am) * R], [0.2, 0.2, 0.05], -am + Math.PI / 2, 0, 36);
    addBox(b, [Math.cos(am) * R, 0.225, Math.sin(am) * R], [0.06, 0.05, 0.05], -am + Math.PI / 2, 0, 36);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    addLathe(b, 4, 10, (t) => [x, t * 0.42, z], () => [0.08, 0.08], 36, () => [0.8, 0.0, 0.0]);
    addLathe(b, 5, 10, (t) => [x, 0.42 + t * 0.25, z], (t) => { const r = 0.1 * (1 - t) + 0.002; return [r, r]; }, 37, (t) => [0.9, t, 0.0]);
    addBox(b, [x * 1.17, 0.3, z * 1.17], [0.02, 0.05, 0.02], -a, 0, 38);
  }
  return b;
}

// Tempelruine auf dem dritten Schwebefelsen: Stufensockel, zwei Säulenreihen (teils gebrochen) mit Gebälkresten,
// eine Mauer mit Bogenfenster, umgestürzte Säulentrommeln. Grundfläche ~1 x 0.7.
function buildRuinSiteMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, -0.15, 0], [1.08, 0.42, 0.78], 0, 0, 36);
  addBox(b, [0, 0.03, 0], [1.0, 0.06, 0.7], 0, 0, 36);
  addBox(b, [0, 0.08, 0], [0.9, 0.05, 0.6], 0, 0, 36);
  addBox(b, [0, 0.12, 0], [0.8, 0.04, 0.5], 0, 0, 36);
  const colH = [0.48, 0.48, 0.3, 0.48, 0.12, 0.48];
  const colH2 = [0.48, 0.2, 0.48, 0.48, 0.48, 0.07];
  [[-0.2, colH], [0.2, colH2]].forEach(([z, hs]) => {
    hs.forEach((h, k) => {
      const x = -0.35 + k * 0.14;
      addLathe(b, 4, 10, (t) => [x, 0.14 + t * h, z], (t) => { const r = 0.035 * (1.0 - t * 0.12); return [r, r]; }, 36, () => [0.85, 0.0, 0.0]);
      addBox(b, [x, 0.15, z], [0.08, 0.02, 0.08], 0, 0, 36);
      if (h > 0.4) addBox(b, [x, 0.14 + h + 0.015, z], [0.085, 0.03, 0.085], 0, 0, 36);
    });
    // Gebälk nur über benachbarten, vollständigen Säulen
    for (let k = 0; k < hs.length - 1; k++) {
      if (hs[k] > 0.4 && hs[k + 1] > 0.4) addBox(b, [-0.35 + (k + 0.5) * 0.14, 0.14 + 0.48 + 0.05, z], [0.15, 0.05, 0.08], 0, 0, 36);
    }
  });
  // Rückwand mit Bogenfenster, oben ausgebrochen
  addBox(b, [0.43, 0.3, -0.13], [0.06, 0.36, 0.14], 0, 0, 36);
  addBox(b, [0.43, 0.22, 0.13], [0.06, 0.2, 0.14], 0, 0, 36);
  addBox(b, [0.43, 0.16, 0.0], [0.06, 0.08, 0.12], 0, 0, 36);
  for (let k = 0; k < 5; k++) {
    if (k === 4) continue;
    const a = Math.PI * (k + 0.5) / 5;
    addBox(b, [0.43, 0.36 + Math.sin(a) * 0.08, Math.cos(a) * 0.08], [0.06, 0.04, 0.05], 0, 0, 36);
  }
  // umgestürzte Säulentrommeln und Quader
  [[-0.1, 0.0, 0.9], [0.05, 0.05, 2.2], [-0.4, 0.3, 0.3]].forEach(([x, z, r]) => {
    addLathe(b, 2, 10, (t) => [x + Math.cos(r) * (t - 0.5) * 0.12, 0.17, z + Math.sin(r) * (t - 0.5) * 0.12], () => [0.034, 0.034], 36, () => [0.8, 0.0, 0.0]);
  });
  addBox(b, [0.3, 0.17, 0.3], [0.1, 0.06, 0.07], 0.7, 0.2, 36);
  return b;
}

// Pilz-Torbogen (Pilzwald): zwei geschwungene Stiele von beiden Ufern treffen sich über dem Fluss unter einem großen Hut,
// vom Hutrand hängen Leuchtranken. x von -1 bis 1, Höhe ~1.2.
function buildMushroomArchMesh() {
  const b = createGeometryBuilder();
  for (const s of [-1, 1]) {
    addLathe(b, 18, 12, (t) => [s * Math.cos(t * Math.PI * 0.5) * 0.95, Math.sin(t * Math.PI * 0.5) * 1.0, Math.sin(t * 3.0) * 0.05],
      (t) => { const r = 0.07 + 0.06 * Math.pow(1.0 - t, 2.0); return [r, r]; }, 32, (t) => [0.5 + 0.5 * t, 0.0, 0.0]);
  }
  const capR = 0.75, secs = 32;
  let base = b.positions.length / 3;
  for (let i = 0; i <= 10; i++) {
    const f = i / 10, r = f * capR;
    for (let j = 0; j <= secs; j++) {
      const a = (j / secs) * Math.PI * 2;
      b.pushVertex(Math.cos(a) * r, 1.0 + 0.2 * (1.0 - f * f) - (f > 0.85 ? (f - 0.85) * 0.5 : 0), Math.sin(a) * r * 0.8, 0, 1, 0, j / secs, f, 0.95, 1.0, 0.0, 32);
    }
  }
  for (let i = 0; i < 10; i++) for (let j = 0; j < secs; j++) { const a = base + i * (secs + 1) + j; b.pushQuad(a, a + 1, a + secs + 2, a + secs + 1); }
  base = b.positions.length / 3;
  for (let i = 0; i <= 4; i++) {
    const f = 1.0 - i / 4, r = 0.08 + f * (capR - 0.08);
    for (let j = 0; j <= secs; j++) {
      const a = (j / secs) * Math.PI * 2;
      b.pushVertex(Math.cos(a) * r, 0.97 + 0.08 * (1.0 - f) - (f > 0.85 ? (f - 0.85) * 0.5 : 0), Math.sin(a) * r * 0.8, 0, -1, 0, j / secs, f, 0.7, 2.0, 0.0, 32);
    }
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < secs; j++) { const a = base + i * (secs + 1) + j; b.pushQuad(a, a + 1, a + secs + 2, a + secs + 1); }
  for (let v = 0; v < 22; v++) {
    const a = (v / 22) * Math.PI * 2 + hash2(v, 1.0) * 0.2, r = capR * (0.6 + hash2(v, 2.0) * 0.35);
    const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r * 0.8, y0 = 0.96 - (r > capR * 0.85 ? 0.06 : 0);
    const len = 0.15 + hash2(v, 3.0) * 0.35, w = 0.006;
    const start = b.positions.length / 3;
    for (let s2 = 0; s2 <= 8; s2++) {
      const t = s2 / 8;
      b.pushVertex(x0 - w, y0 - t * len, z0, 0, 0, 1, 0, t * len * 30.0, 0.9, t, 1.0 + t * 0.6, 14);
      b.pushVertex(x0 + w, y0 - t * len, z0, 0, 0, 1, 1, t * len * 30.0, 0.9, t, 1.0 + t * 0.6, 14);
    }
    for (let s2 = 0; s2 < 8; s2++) { const q = start + s2 * 2; b.pushQuad(q, q + 1, q + 3, q + 2); }
  }
  return b;
}

// gerader Tentakel für die Peitschen-Szene: verjüngt sich zur Spitze, Saugnäpfe auf einer Seite. Höhe 1.
function buildWhipTentacleMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 48, 18, (t) => [0, t, 0], (t) => { const r = 0.1 * Math.pow(1.0 - t, 0.85) + 0.005; return [r, r]; }, 34, (t) => [0.5 + 0.5 * t, 1.0, t]);
  return b;
}

// umgestürzter, bemooster Baumstamm mit abgebrochenen Aststümpfen und Wurzelteller. Länge 1 (entlang x).
function buildFallenLogMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 12, 10, (t) => [t - 0.5, 0.06 + Math.sin(t * 3.0) * 0.01, Math.sin(t * 2.0) * 0.02],
    (t) => { const r = 0.07 * (1.0 - t * 0.35) * (1.0 + 0.1 * Math.sin(t * 17.0)); return [r, r]; }, 31, () => [0.7, 0.0, 0.0]);
  for (let k = 0; k < 4; k++) {
    const x = -0.3 + k * 0.2, a = k * 2.1;
    addLathe(b, 3, 5, (t) => [x + t * 0.04, 0.08 + Math.cos(a) * t * 0.12, Math.sin(a) * t * 0.12], (t) => { const r = 0.016 * (1 - t * 0.5); return [r, r]; }, 31, () => [0.6, 0.0, 0.0]);
  }
  // Wurzelteller am dicken Ende
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    addLathe(b, 4, 5, (t) => [-0.5 - t * 0.04, 0.07 + Math.cos(a) * t * 0.14, Math.sin(a) * t * 0.14], (t) => { const r = 0.02 * (1 - t * 0.6); return [r, r]; }, 31, () => [0.5, 0.0, 0.0]);
  }
  return b;
}

// dunkler Busch aus mehreren Nadelballen (Unterholz im Nebelwald). Höhe ~1.
function buildBushMesh() {
  const b = createGeometryBuilder();
  for (let k = 0; k < 6; k++) {
    const a = k * 2.4, r = 0.18 + (k % 3) * 0.08;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 0.3 + (k % 2) * 0.2, rr = 0.25 + (k % 3) * 0.06;
    addLathe(b, 6, 8, (t) => [cx, cy - rr * 0.8 + t * rr * 1.6, cz], (t) => { const q = Math.sin(t * Math.PI) * rr + 0.01; const j = 1.0 + 0.15 * Math.sin(t * 9.0 + k); return [q * j, q * j]; },
      30, (t) => [0.5 + 0.5 * t, 0.0, t * 0.3]);
  }
  return b;
}

// Kristallzitadelle (Schwebefelsen): Sockel, gedrehte Turmspitze mit Perlen, Rippenbögen, kleine Kuppeln, Kristall an der Spitze. Höhe ~1.
function buildCrystalCitadelMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 2, 16, (t) => [0, -0.25 + t * 0.27, 0], () => [0.42, 0.42], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 2, 16, (t) => [0, 0.02 + t * 0.04, 0], () => [0.34, 0.34], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 30, 10, (t) => [Math.sin(t * 9.0) * 0.012, 0.06 + t * 0.86, Math.cos(t * 9.0) * 0.012],
    (t) => { const r = 0.06 * (1.0 - t * 0.8) * (1.0 + 0.3 * Math.pow(Math.max(0, Math.sin(t * 28.0)), 4.0)); return [r, r]; }, 36, (t) => [0.6 + 0.4 * t, t, 0.0]);
  addLathe(b, 6, 8, (t) => [0, 0.92 + t * 0.12, 0], (t) => { const r = Math.sin(t * Math.PI) * 0.035 + 0.002; return [r, r * 0.7]; }, 35, () => [1.0, 1.0, 0.0]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    addLathe(b, 12, 6, (t) => { const r = 0.3 * (1.0 - t * 0.85); return [Math.cos(a) * r, 0.06 + Math.sin(t * Math.PI * 0.55) * 0.6, Math.sin(a) * r]; },
      (t) => { const r = 0.016 * (1.0 - t * 0.7); return [r, r]; }, 36, () => [0.8, 0.0, 0.0]);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    addLathe(b, 6, 10, (t) => [Math.cos(a) * 0.22, 0.06 + Math.sin(t * Math.PI * 0.5) * 0.08, Math.sin(a) * 0.22], (t) => { const r = Math.cos(t * Math.PI * 0.5) * 0.08 + 0.002; return [r, r]; }, 37, (t) => [0.9, t, 0.0]);
  }
  for (let k = 0; k < 4; k++) addBox(b, [Math.cos(k * 1.57) * 0.05, 0.3 + k * 0.12, Math.sin(k * 1.57) * 0.05], [0.006, 0.04, 0.006], 0, 0, 38, 2.0);
  return b;
}

// Monolithring (Schwebefelsen): schlanke, teils gebrochene Steinnadeln im Kreis mit leuchtenden Zeichen,
// darüber schwebt ein gebrochener Ring. Grundfläche ~1, Höhe ~1.
function buildMonolithRingMesh() {
  const b = createGeometryBuilder();
  addLathe(b, 2, 12, (t) => [0, -0.25 + t * 0.27, 0], () => [0.5, 0.5], 36, () => [0.9, 0.0, 0.0]);
  const hs = [0.75, 0.6, 0.3, 0.72, 0.65, 0.18, 0.7, 0.55, 0.4];
  hs.forEach((h, k) => {
    const a = (k / hs.length) * Math.PI * 2, x = Math.cos(a) * 0.4, z = Math.sin(a) * 0.4;
    const lean = (k % 3 === 2 ? 0.12 : 0.03);
    addLathe(b, 6, 4, (t) => [x + Math.cos(a) * lean * t, t * h, z + Math.sin(a) * lean * t], (t) => { const r = 0.045 * (1.0 - t * 0.55); return [r, r * 0.6]; }, 36, (t) => [0.6 + 0.4 * t, 0.0, 0.0]);
    if (h > 0.5) addBox(b, [x * 0.9, h * 0.6, z * 0.9], [0.008, h * 0.35, 0.008], -a, 0, 38, 2.0);
  });
  addLathe(b, 4, 8, (t) => [0, 0.02 + t * 0.1, 0], (t) => [0.09, 0.07], 36, () => [0.8, 0.0, 0.0]);
  addLathe(b, 26, 6, (t) => { const a = t * Math.PI * 1.35 + 0.3; return [Math.cos(a) * 0.34, 0.95 + Math.sin(t * 4.0) * 0.02, Math.sin(a) * 0.34]; },
    () => [0.022, 0.022], 36, () => [0.9, 0.0, 0.0]);
  addLathe(b, 6, 6, (t) => { const a = Math.PI * 1.75 + t * 0.5; return [Math.cos(a) * 0.36, 0.9, Math.sin(a) * 0.36]; }, () => [0.02, 0.02], 36, () => [0.9, 0.0, 0.0]);
  return b;
}
