// gates.js: Fallgatter am Verlies-Eingang (z = -160) und Flügeltor am Ausgang (z = -240)
// Starre Teile mit Material 40 (e0..e2 = Farbe, u = Leuchten). Keine Objektallokationen pro Bild.

const _G_Z_ENTRY = -160.0;
const _G_Z_EXIT = -240.0;

const _G_TINT_NORM = [1.0, 1.0, 1.0, 1.0];
const _G_M_ARCH_IN = Mat4.create();
const _G_M_ARCH_OUT = Mat4.create();
const _G_M_PORTCULLIS = Mat4.create();
const _G_M_DOOR_L = Mat4.create();
const _G_M_DOOR_R = Mat4.create();
const _G_M_TMP = Mat4.create();

const _G_POS = [0, 0, 0];
const _G_ONE = [1, 1, 1];

const _gates = {
  inited: false,
  archMesh: null,
  portcullisMesh: null,
  doorLMesh: null,
  doorRMesh: null,
  hwIn: 4.5,
  hwOut: 4.5,
  // Bewegungszustände
  portY: 0.0,           // 0 = geschlossen, > 0 = angehoben
  portPhase: "closed",  // "closed" | "opening" | "open" | "falling"
  portTimer: 0.0,
  portVel: 0.0,
  portCuedUp: false,
  portCuedSlam: false,
  doorAngle: 0.0,       // 0 = geschlossen, ~1.54 rad (88.2°) = offen nach -z
  doorCued: false
};

function _gBox(b, c, size, rotY, rotZ, col, glow = 0.0) {
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

function _buildVaultGateMeshes(hw) {
  const stoneDark = [0.16, 0.17, 0.21];
  const stoneTrim = [0.22, 0.23, 0.27];
  const ironDark = [0.16, 0.16, 0.18];
  const ironRust = [0.30, 0.17, 0.10];
  const woodCol = [0.24, 0.15, 0.09];
  const woodDark = [0.18, 0.11, 0.07];
  const gapGlow = [0.22, 0.88, 0.85];

  // 1. Torbogen (vaultGate): Öffnung halbe Weite hw, Laibung bis y = 6.2, Rundbogen Scheitel y = 9.7, Tiefe z = -2.1 .. +2.1
  const archB = createGeometryBuilder();
  const depth = 4.2;
  const wallThick = 2.4;
  // Seitliche Pfeiler bis y = 6.2
  _gBox(archB, [-(hw + wallThick * 0.5), 3.1, 0], [wallThick, 6.6, depth], 0, 0, stoneDark);
  _gBox(archB, [ (hw + wallThick * 0.5), 3.1, 0], [wallThick, 6.6, depth], 0, 0, stoneDark);
  // Kapitelle & Sockel
  _gBox(archB, [-(hw + 0.18), 6.1, 0], [0.55, 0.36, depth + 0.28], 0, 0, stoneTrim);
  _gBox(archB, [ (hw + 0.18), 6.1, 0], [0.55, 0.36, depth + 0.28], 0, 0, stoneTrim);
  _gBox(archB, [-(hw + 0.12), 0.3, 0], [0.45, 0.8, depth + 0.22], 0, 0, stoneTrim);
  _gBox(archB, [ (hw + 0.12), 0.3, 0], [0.45, 0.8, depth + 0.22], 0, 0, stoneTrim);

  // Rundbogen-Keilsteine (Ellipsenbogen: Halbachsen rx = hw, ry = 9.7 - 6.2 = 3.5)
  const rx = hw;
  const ry = 3.5;
  const segs = 18;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI;
    const a1 = ((i + 1) / segs) * Math.PI;
    const am = 0.5 * (a0 + a1);
    const x0 = Math.cos(a0) * (rx + 0.55), y0 = 6.2 + Math.sin(a0) * (ry + 0.55);
    const x1 = Math.cos(a1) * (rx + 0.55), y1 = 6.2 + Math.sin(a1) * (ry + 0.55);
    const segLen = Math.hypot(x1 - x0, y1 - y0) + 0.12;
    const xm = Math.cos(am) * (rx + 0.65);
    const ym = 6.2 + Math.sin(am) * (ry + 0.65);
    const rotZ = am - Math.PI * 0.5;
    const isKey = i === 8 || i === 9;
    _gBox(archB, [xm, ym, 0], [segLen, isKey ? 1.55 : 1.35, isKey ? depth + 0.22 : depth + 0.08], 0, rotZ, isKey ? stoneTrim : stoneDark);
  }
  // Oberer Torsturz / Zinnenabschluss (nimmt das hochgezogene Gatter auf)
  _gBox(archB, [0, 10.65, 0], [(hw + wallThick) * 2.0, 1.9, depth], 0, 0, stoneDark);
  _gBox(archB, [0, 11.65, 0], [(hw + wallThick) * 2.0 + 0.3, 0.28, depth + 0.3], 0, 0, stoneTrim);
  // Führungsnut innen für das Fallgatter
  _gBox(archB, [-(hw - 0.04), 4.8, -0.18], [0.16, 9.6, 0.12], 0, 0, ironDark);
  _gBox(archB, [-(hw - 0.04), 4.8,  0.18], [0.16, 9.6, 0.12], 0, 0, ironDark);
  _gBox(archB, [ (hw - 0.04), 4.8, -0.18], [0.16, 9.6, 0.12], 0, 0, ironDark);
  _gBox(archB, [ (hw - 0.04), 4.8,  0.18], [0.16, 9.6, 0.12], 0, 0, ironDark);
  archB.computeFacetedNormals();

  // 2. Fallgatter (Spitzenunterkante im geschlossenen Zustand bei y = -0.15 im Wasser)
  const portB = createGeometryBuilder();
  const barSpacing = 0.52;
  const nBars = Math.max(7, Math.floor((hw * 2.0 - 0.3) / barSpacing));
  const spanW = (nBars - 1) * barSpacing;
  const barBot = 0.25;
  const barTop = 6.45;
  const barH = barTop - barBot;
  for (let i = 0; i < nBars; i++) {
    const bx = -spanW * 0.5 + i * barSpacing;
    // Senkrechter Eisenstab
    _gBox(portB, [bx, barBot + barH * 0.5, 0], [0.11, barH, 0.11], 0, 0, i % 3 === 0 ? ironRust : ironDark);
    // Spitze unten (Unterkante bei y = -0.15)
    _gBox(portB, [bx, 0.12, 0], [0.13, 0.26, 0.13], 0, 0, ironDark);
    _gBox(portB, [bx, -0.04, 0], [0.08, 0.18, 0.08], Math.PI * 0.25, 0, ironRust);
    _gBox(portB, [bx, -0.11, 0], [0.04, 0.08, 0.04], Math.PI * 0.25, 0, ironDark);
  }
  // 4 waagerechte Riegel mit Nieten
  const railYs = [0.65, 2.25, 3.85, 5.45];
  for (let r = 0; r < railYs.length; r++) {
    const ryPos = railYs[r];
    _gBox(portB, [0, ryPos, 0], [hw * 1.98, 0.18, 0.18], 0, 0, r % 2 === 0 ? ironDark : ironRust);
    for (let i = 0; i < nBars; i++) {
      const bx = -spanW * 0.5 + i * barSpacing;
      _gBox(portB, [bx, ryPos, 0.10], [0.07, 0.07, 0.04], 0, 0, ironRust);
      _gBox(portB, [bx, ryPos, -0.10], [0.07, 0.07, 0.04], 0, 0, ironRust);
    }
  }
  portB.computeFacetedNormals();

  // 3. Flügeltor (2 Flügel, Scharnier außen bei +-hw, schwingt nach außen in -z auf)
  const buildLeaf = (sideSign) => {
    // sideSign = -1: Scharnier bei x = 0 (im lokalen Koordinatensystem), Blatt erstreckt sich nach +x bis hw
    // sideSign = +1: Scharnier bei x = 0, Blatt erstreckt sich nach -x bis -hw
    const leafB = createGeometryBuilder();
    const leafW = hw - 0.03;
    const leafH = 6.25;
    const plankCount = 6;
    const pw = leafW / plankCount;
    for (let p = 0; p < plankCount; p++) {
      const px = -sideSign * (p + 0.5) * pw;
      const col = p % 2 === 0 ? woodCol : woodDark;
      _gBox(leafB, [px, leafH * 0.5 - 0.1, 0], [pw * 0.96, leafH, 0.22], 0, 0, col);
    }
    // Oberer Bogenaufsatz des Torflügels (damit er geschlossen den Rundbogen teilweise füllt)
    const archSteps = 6;
    for (let s = 0; s < archSteps; s++) {
      const u = (s + 0.5) / archSteps;
      const distFromHinge = u * leafW;
      const dxCenter = hw - distFromHinge; // Abstand von der Tormitte
      const archTop = 6.15 + Math.sqrt(Math.max(0.0, 1.0 - Math.min(1.0, (dxCenter / hw) * (dxCenter / hw)))) * 3.45;
      const hSeg = Math.max(0.1, archTop - 6.1);
      const px = -sideSign * distFromHinge;
      _gBox(leafB, [px, 6.1 + hSeg * 0.5, 0], [leafW / archSteps * 0.98, hSeg, 0.20], 0, 0, s % 2 === 0 ? woodDark : woodCol);
    }
    // 3 schwere Eisenbeschläge quer + Nieten + Scharnierbänder
    const strapYs = [1.0, 3.1, 5.2];
    for (let k = 0; k < strapYs.length; k++) {
      const sy = strapYs[k];
      _gBox(leafB, [-sideSign * leafW * 0.48, sy, 0.12], [leafW * 0.92, 0.16, 0.05], 0, 0, ironDark);
      _gBox(leafB, [-sideSign * leafW * 0.48, sy, -0.12], [leafW * 0.92, 0.16, 0.05], 0, 0, ironDark);
      // Scharnierrolle außen
      _gBox(leafB, [0, sy, 0], [0.18, 0.28, 0.28], 0, 0, ironRust);
      for (let n = 1; n <= 5; n++) {
        const nx = -sideSign * (n / 5.5) * leafW;
        _gBox(leafB, [nx, sy, 0.15], [0.06, 0.06, 0.03], 0, 0, ironRust);
      }
    }
    // Ringgriff innen (nahe der Tormitte)
    const handleX = -sideSign * (leafW - 0.55);
    _gBox(leafB, [handleX, 2.35, 0.14], [0.24, 0.24, 0.05], 0, 0, ironRust);
    _gBox(leafB, [handleX, 2.18, 0.18], [0.22, 0.05, 0.05], 0, 0, ironDark);
    _gBox(leafB, [handleX, 1.98, 0.18], [0.22, 0.05, 0.05], 0, 0, ironDark);
    _gBox(leafB, [handleX - 0.09, 2.08, 0.18], [0.05, 0.22, 0.05], 0, 0, ironDark);
    _gBox(leafB, [handleX + 0.09, 2.08, 0.18], [0.05, 0.22, 0.05], 0, 0, ironDark);

    // Leuchtsaum an der inneren Spaltkante (türkis-violettes Licht vom Pilzwald)
    const edgeX = -sideSign * (leafW + 0.01);
    _gBox(leafB, [edgeX, 3.1, 0], [0.03, 6.2, 0.23], 0, 0, gapGlow, 1.0);
    leafB.computeFacetedNormals();
    return leafB;
  };

  return {
    archMesh: uploadStaticMesh(gl, archB),
    portcullisMesh: uploadStaticMesh(gl, portB),
    doorLMesh: uploadStaticMesh(gl, buildLeaf(-1)),
    doorRMesh: uploadStaticMesh(gl, buildLeaf(1))
  };
}

function _initVaultGates() {
  if (_gates.inited) return;
  _gates.inited = true;

  const hwIn = 0.52 * (riverHalfWidth(_G_Z_ENTRY) + 2.6);
  const hwOut = 0.52 * (riverHalfWidth(_G_Z_EXIT) + 2.6);
  _gates.hwIn = hwIn;
  _gates.hwOut = hwOut;

  // Beide Torbögen nutzen dieselbe Geometrie (Skalierung auf hwOut am Ausgang, um PI gedreht)
  const built = _buildVaultGateMeshes(hwIn);
  _gates.archMesh = built.archMesh;
  _gates.portcullisMesh = built.portcullisMesh;
  _gates.doorLMesh = built.doorLMesh;
  _gates.doorRMesh = built.doorRMesh;

  // Statische Torbogen-Matrizen
  const yawIn = -Math.atan(riverSlopeX(_G_Z_ENTRY));
  _G_POS[0] = riverCenterX(_G_Z_ENTRY);
  _G_POS[1] = 0.0;
  _G_POS[2] = _G_Z_ENTRY;
  _G_ONE[0] = 1.0; _G_ONE[1] = 1.0; _G_ONE[2] = 1.0;
  Mat4.compose(_G_M_ARCH_IN, _G_POS, yawIn, 0, 0, _G_ONE);

  const yawOut = -Math.atan(riverSlopeX(_G_Z_EXIT)) + Math.PI;
  _G_POS[0] = riverCenterX(_G_Z_EXIT);
  _G_POS[1] = 0.0;
  _G_POS[2] = _G_Z_EXIT;
  _G_ONE[0] = hwOut / hwIn; _G_ONE[1] = 1.0; _G_ONE[2] = 1.0;
  Mat4.compose(_G_M_ARCH_OUT, _G_POS, yawOut, 0, 0, _G_ONE);
  _G_ONE[0] = 1.0; _G_ONE[1] = 1.0; _G_ONE[2] = 1.0;
}

function updateVaultGates(ctx) {
  _initVaultGates();
  const { dt, aheadDist, cue, light } = ctx;
  const stepDt = Math.max(0.0, Math.min(0.1, dt || 0));

  // --- 1. Fallgatter bei z = -160 ---
  // Bug liegt etwa 2.5 m vor der Kamera: aheadDist(_G_Z_ENTRY) ist Kameraabstand zum Tor.
  // Wenn Bug 6 m vor Gatter ist -> Kamera bei ca. 8.5 m Abstand (wir heben noch früher an, damit es sicher >= 4.5 m ist).
  const distIn = aheadDist(_G_Z_ENTRY); // > 0 vor dem Gatter, < 0 dahinter
  if (distIn > 30.0) {
    _gates.portPhase = "closed";
    _gates.portY = 0.0;
    _gates.portTimer = 0.0;
    _gates.portVel = 0.0;
    _gates.portCuedUp = false;
    _gates.portCuedSlam = false;
  } else if (distIn <= 30.0 && distIn >= -15.0) {
    if (_gates.portPhase === "closed") {
      _gates.portPhase = "opening";
      _gates.portTimer = 0.0;
      if (!_gates.portCuedUp) {
        _gates.portCuedUp = true;
        cue("chainRattle", 0.0);
      }
    }
    if (_gates.portPhase === "opening") {
      _gates.portTimer += stepDt;
      // Ruckendes Hochziehen mit 2 kurzen Halten über 2.4 s auf Endhöhe 5.4 m
      // (Bei normaler Bootsfahrt ~5-7 m/s braucht das Boot von 30 m auf 8.5 m ca. 3.0-4.0 s -> bei 6 m Bugabstand voll offen bei 5.4 m!)
      const u = clamp01(_gates.portTimer / 2.3);
      // Stufen-Kurve mit kurzen Haltepunkten bei u = 0.32 und u = 0.68
      let liftU = u;
      if (u < 0.28) {
        liftU = (u / 0.28) * 0.34;
      } else if (u < 0.36) {
        liftU = 0.34; // kurzer Halt 1
      } else if (u < 0.64) {
        liftU = 0.34 + ((u - 0.36) / 0.28) * 0.36;
      } else if (u < 0.72) {
        liftU = 0.70; // kurzer Halt 2
      } else {
        liftU = 0.70 + ((u - 0.72) / 0.28) * 0.30;
      }
      // Sicherheits-Untergrenze abhängig von distIn, falls Boot sehr schnell fährt:
      // Bei distIn = 8.5 m (Bug 6 m vor Gatter) mindestens y = 4.95 m (Spitzenunterkante 4.95 - 0.15 = 4.80 m > 4.5 m)
      const distGuard = clamp01((28.0 - distIn) / 18.0);
      const effU = Math.max(liftU, distGuard);
      _gates.portY = effU * 5.4;
      if (effU >= 0.999) {
        _gates.portPhase = "open";
        _gates.portY = 5.4;
      }
    }
  } else {
    // distIn < -15.0: Boot ist 15 m hinter dem Gatter -> harter Fall
    if (_gates.portPhase !== "closed") {
      _gates.portPhase = "falling";
      _gates.portVel += 26.0 * stepDt;
      _gates.portY -= _gates.portVel * stepDt;
      if (_gates.portY <= 0.0) {
        _gates.portY = 0.0;
        _gates.portVel = 0.0;
        _gates.portPhase = "closed";
        if (!_gates.portCuedSlam) {
          _gates.portCuedSlam = true;
          cue("gateSlam", 0.0);
        }
      }
    }
  }

  // Matrix des Fallgatters aktualisieren
  _G_POS[0] = 0.0;
  _G_POS[1] = _gates.portY;
  _G_POS[2] = 0.0;
  _G_ONE[0] = 1.0; _G_ONE[1] = 1.0; _G_ONE[2] = 1.0;
  Mat4.compose(_G_M_TMP, _G_POS, 0, 0, 0, _G_ONE);
  Mat4.multiply(_G_M_PORTCULLIS, _G_M_ARCH_IN, _G_M_TMP);

  // --- 2. Flügeltor bei z = -240 ---
  // Öffnet ab 25 m Abstand, bei 10 m Abstand ganz offen (88° = 1.536 rad >= 85° = 1.4835 rad)
  const distOut = aheadDist(_G_Z_EXIT);
  const maxOpenAngle = 1.536; // 88.0°
  if (distOut > 25.0) {
    _gates.doorAngle = 0.0;
    _gates.doorCued = false;
  } else if (distOut >= 10.0) {
    if (!_gates.doorCued) {
      _gates.doorCued = true;
      cue("doorCreak", 0.0);
    }
    const u = clamp01((25.0 - distOut) / 15.0);
    const su = u * u * (3.0 - 2.0 * u);
    _gates.doorAngle = su * maxOpenAngle;
  } else {
    _gates.doorAngle = maxOpenAngle;
  }

  // Türkis-violettes Licht vom Pilzwald durch den Spalt und die Öffnung
  const cxOut = riverCenterX(_G_Z_EXIT);
  const openFrac = _gates.doorAngle / maxOpenAngle;
  const lightIntensity = 0.65 + openFrac * 1.45;
  light(cxOut, 1.35, _G_Z_EXIT + 0.5, [0.22 * lightIntensity, 0.85 * lightIntensity, 0.95 * lightIntensity], 6.5 + openFrac * 6.0);
  light(cxOut, 0.45, _G_Z_EXIT + 2.8, [0.38 * lightIntensity, 0.52 * lightIntensity, 1.0 * lightIntensity], 4.5 + openFrac * 4.5);

  // Flügelmatrizen (im Raum von _G_M_ARCH_OUT, welches um +PI gedreht ist: lokal -z zeigt in Welt -z!)
  // Scharnier links (in Tor-Koordinaten bei x = -hwIn, Blatt zeigt nach +x): Drehung um +doorAngle schwingt +x nach -z (außen)
  _G_POS[0] = -_gates.hwIn;
  _G_POS[1] = 0.0;
  _G_POS[2] = 0.0;
  Mat4.compose(_G_M_TMP, _G_POS, -_gates.doorAngle, 0, 0, _G_ONE);   // Vorzeichen geprüft: Flügel schwingen in den Pilzwald
  Mat4.multiply(_G_M_DOOR_L, _G_M_ARCH_OUT, _G_M_TMP);

  // Scharnier rechts (in Tor-Koordinaten bei x = +hwIn, Blatt zeigt nach -x): Drehung um -doorAngle schwingt -x nach -z (außen)
  _G_POS[0] = _gates.hwIn;
  _G_POS[1] = 0.0;
  _G_POS[2] = 0.0;
  Mat4.compose(_G_M_TMP, _G_POS, _gates.doorAngle, 0, 0, _G_ONE);
  Mat4.multiply(_G_M_DOOR_R, _G_M_ARCH_OUT, _G_M_TMP);
}

function collectVaultGateDraws(take) {
  if (!_gates.inited) return;

  // Die Torbögen selbst stehen schon in der Welt (vaultGate in world.js), hier nur Gatter und Flügel
  let d = take(_gates.portcullisMesh, _G_TINT_NORM);
  if (!d) return;
  d.model.set(_G_M_PORTCULLIS);

  d = take(_gates.doorLMesh, _G_TINT_NORM);
  if (!d) return;
  d.model.set(_G_M_DOOR_L);

  d = take(_gates.doorRMesh, _G_TINT_NORM);
  if (!d) return;
  d.model.set(_G_M_DOOR_R);
}