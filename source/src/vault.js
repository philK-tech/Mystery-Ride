// vault.js: Verlies-Szenen (z = -160 bis -240), Laufsteg, Nische, Podest und Figurensteuerung
// Entwurf von Gemini; eingebaut und korrigiert (Wraith über statt durch das Boot, Duellanten einander zugewandt,
// Kultist vor dem Altar, Skelett erst bei der Beschwörung sichtbar, Wandlücken so breit wie Nische und Podest)

const VAULT_STONE_TINT = [0.14, 0.15, 0.19, 1.0];
const VAULT_ALTAR_TINT = [0.18, 0.20, 0.24, 1.0];
const VAULT_RITUAL_GREEN = [0.35, 1.0, 0.55, 1.0];
const VAULT_NORMAL_TINT = [1.0, 1.0, 1.0, 1.0];

const VAULT_SCENES = [
  { type: "vaultGuard",  z: -172, side: -1, dur: 11.0, trigger: 13.0, slow: 0.14, zoom: 0.25 },
  { type: "vaultRitual", z: -190, side:  1, dur: 11.5, trigger: 14.5, slow: 0.14, zoom: 0.30 },
  { type: "vaultWraith", z: -206, side:  1, dur: 9.0,  trigger: 16.0, slow: 0.12, zoom: 0.20 },
  { type: "vaultDuel",   z: -226, side: -1, dur: 14.0, trigger: 14.0, slow: 0.12, zoom: 0.35 }
];

// Nische (rechts) und Podest (links): Breite = Lücke in den Seitenwänden (Wandabschnitte alle 4 m, je 4,4 m lang)
const VAULT_RIT = { z: -190.0, w: 11.6 };
const VAULT_DUEL = { z: -226.0, w: 12.4 };

// Feste Lichter an Altar (Szene 2) und Podest (Szene 4)
const VAULT_LIGHTS = (() => {
  const zRit = VAULT_RIT.z, xRit = riverCenterX(zRit) + (riverHalfWidth(zRit) + 4.2);
  const zDuel = VAULT_DUEL.z, xDuel = riverCenterX(zDuel) - (riverHalfWidth(zDuel) + 6.5);
  return [
    { x: xRit, y: 2.5, z: zRit, color: [0.35, 0.95, 0.55], radius: 7.5, flicker: true },
    { x: xDuel, y: 4.2, z: zDuel - 3.5, color: [1.0, 0.62, 0.24], radius: 10.0, flicker: true },
    { x: xDuel, y: 4.2, z: zDuel + 3.5, color: [1.0, 0.62, 0.24], radius: 10.0, flicker: true }
  ];
})();

// Wandlücken in vaultWalls für Nische (rechts) und Podest (links)
function vaultWallGap(z, side) {
  if (side > 0 && z <= -185.0 && z >= -195.0) return true;   // Abschnitte -186, -190, -194
  if (side < 0 && z <= -221.0 && z >= -231.0) return true;   // Abschnitte -222, -226, -230
  return false;
}

// --- Prozedurale Bauteile für Laufsteg, Nische/Altar und Duell-Podest ---
function buildVaultWalkwayMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, -0.10, 0], [1.0, 0.20, 1.0], 0, 0, 36, 0.0);
  addBox(b, [0, -0.01, 0], [1.02, 0.03, 1.02], 0, 0, 36, 0.15);
  b.computeFacetedNormals();
  return b;
}

function buildVaultAltarMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, 0.12, 0], [0.95, 0.24, 0.95], 0, 0, 36, 0.0);
  addBox(b, [0, 0.55, 0], [0.62, 0.65, 0.52], 0, 0, 36, 0.1);
  addBox(b, [0, 0.94, 0], [0.74, 0.14, 0.64], 0, 0, 36, 0.25);
  addBox(b, [0, 1.06, -0.20], [0.12, 0.10, 0.12], 0, 0, 38, 0.0);
  addBox(b, [0, 1.06,  0.20], [0.12, 0.10, 0.12], 0, 0, 38, 0.0);
  b.computeFacetedNormals();
  return b;
}

// Kammer: x -0.5..0.5 (Breite), y 0..1, z -0.5..0.5 (Tiefe, Rückwand bei -z), vorne offen
function buildVaultChamberMesh() {
  const b = createGeometryBuilder();
  addBox(b, [0, 0.10, 0], [1.0, 0.20, 1.0], 0, 0, 36, 0.0);
  addBox(b, [0, 0.50, -0.46], [1.0, 1.0, 0.08], 0, 0, 36, 0.0);
  addBox(b, [-0.46, 0.50, 0], [0.08, 1.0, 1.0], 0, 0, 36, 0.0);
  addBox(b, [ 0.46, 0.50, 0], [0.08, 1.0, 1.0], 0, 0, 36, 0.0);
  addBox(b, [0, 0.96, 0], [1.0, 0.08, 1.0], 0, 0, 36, 0.0);
  b.computeFacetedNormals();
  return b;
}

const VAULT_PROP_GROUPS = [
  ["vaultWalkway", buildVaultWalkwayMesh, 3.0],
  ["vaultAltar",   buildVaultAltarMesh,   2.0],
  ["vaultChamber", buildVaultChamberMesh, 7.0]
];

function placeVaultProps(pushInst) {
  // Laufsteg beidseitig zwischen Kaimauer (+0,71) und Wand (+1,60), Oberkante y = 1,05
  for (let z = -158.0; z >= -242.0; z -= 4.0) {
    const cx = riverCenterX(z), hw = riverHalfWidth(z), slope = -Math.atan(riverSlopeX(z));
    for (const side of [-1, 1]) pushInst("vaultWalkway", [cx + side * (hw + 1.155), 1.05, z], slope, 0, 0, [0.95, 1.0, 4.32], VAULT_STONE_TINT);
  }
  // Nische mit Altar (rechts): 4,2 m tief, 6,2 m hoch, Boden auf 1,05
  {
    const z = VAULT_RIT.z, cx = riverCenterX(z), hw = riverHalfWidth(z), D = 4.6, H = 9.0;
    pushInst("vaultChamber", [cx + (hw + 1.4 + D * 0.5), 1.05 - 0.20 * H, z], -Math.PI * 0.5, 0, 0, [VAULT_RIT.w, H, D], VAULT_STONE_TINT);
    pushInst("vaultAltar", [cx + (hw + 4.4), 1.05, z], -Math.PI * 0.5, 0, 0, [1.5, 1.15, 1.6], VAULT_ALTAR_TINT);
  }
  // Podest für das Duell (links): 7 m tief, 6,8 m hoch, Boden auf 1,4
  {
    const z = VAULT_DUEL.z, cx = riverCenterX(z), hw = riverHalfWidth(z), D = 7.0, H = 9.5;
    pushInst("vaultChamber", [cx - (hw + 1.2 + D * 0.5), 1.4 - 0.20 * H, z], Math.PI * 0.5, 0, 0, [VAULT_DUEL.w, H, D], VAULT_STONE_TINT);
  }
}

// --- Figuren (genau einmal beim ersten updateVault-Aufruf erzeugt) ---
const _vault = { inited: false, figs: null };
const _vx = (z, side, off) => riverCenterX(z) + side * (riverHalfWidth(z) + off);

function _initVaultFigures() {
  if (_vault.inited) return;
  _vault.inited = true;
  const hidden = { tint: VAULT_NORMAL_TINT, clip: "idle", visible: false, scale: 1.0 };
  const zR = VAULT_RIT.z, zD = VAULT_DUEL.z;
  _vault.figs = {
    // Szene 1: zwei Skelette links auf dem Steg, mit Blick zum Fluss (yaw PI/2 = +x)
    skelGuardA: spawnFigure("skeleton", { ...hidden, x: _vx(-171, -1, 1.15), y: 1.05, z: -171, yaw: Math.PI * 0.5 }),
    skelGuardB: spawnFigure("skeleton", { ...hidden, x: _vx(-177, -1, 1.15), y: 1.05, z: -177, yaw: Math.PI * 0.5 }),
    // Szene 2: Kultist rechts vor dem Altar mit Blick zum Fluss, davor steigt ein Skelett auf
    cultist: spawnFigure("cultist", { ...hidden, x: _vx(zR, 1, 3.1), y: 1.05, z: zR, yaw: -Math.PI * 0.5 }),
    skelRitual: spawnFigure("skeleton", { ...hidden, x: _vx(zR, 1, 1.7), y: -1.8, z: zR, yaw: -Math.PI * 0.5, clip: "summon" }),
    // Szene 3: Wraith über dem Wasser
    wraith: spawnFigure("wraith", { ...hidden, x: riverCenterX(-208), y: 0.3, z: -208, yaw: 0.0, clip: "run" }),
    // Szene 4: Held und Boss stehen sich längs gegenüber (halb zum Fluss gedreht), der Gluthund kauert vorn am Rand
    // vom Boot aus (es kommt von +z) liegt der vordere Teil der Kammer hinter ihrer Seitenwand, deshalb stehen alle im hinteren Teil
    hero: spawnFigure("hero", { ...hidden, x: _vx(zD, -1, 2.7), y: 1.4, z: zD - 0.8, yaw: Math.atan2(-2.0, -3.0) }),
    boss: spawnFigure("boss", { ...hidden, x: _vx(zD, -1, 4.7), y: 1.4, z: zD - 3.8, yaw: Math.atan2(2.0, 3.0) }),
    hellhound: spawnFigure("hellhound", { ...hidden, x: _vx(zD, -1, 2.2), y: 1.4, z: zD - 4.4, yaw: Math.PI * 0.3 })
  };
}

function _setClipOnce(fig, key, clip, blend = 0.2, speed = 1.0) {
  if (fig._curClipKey !== key) {
    fig._curClipKey = key;
    fig.play(clip, blend, speed);
  }
}

function updateVault(ctx) {
  _initVaultFigures();
  const { cam, t, scene, st, aheadDist, focus, duck, cue, light } = ctx;
  const f = _vault.figs;
  const inRange = (z) => { const d = aheadDist(z); return d <= 60.0 && d >= -20.0; };

  // --- Szene 1: Wache der Toten (z ≈ -172, links) ---
  {
    f.skelGuardA.visible = inRange(-171.0);
    f.skelGuardB.visible = inRange(-177.0);
    if (scene === "vaultGuard") {
      if (st < 2.2) {
        _setClipOnce(f.skelGuardA, "g1_alert", "alert", 0.2);
        cue("boneRattle", 0.3, -0.65);
      } else if (st < 5.0) {
        _setClipOnce(f.skelGuardA, "g1_look", "look", 0.25);
        f.skelGuardA.yaw = Math.atan2(cam[0] - f.skelGuardA.x, cam[2] - f.skelGuardA.z);
      } else {
        _setClipOnce(f.skelGuardA, "g1_walk", "walk", 0.25, 1.05);
        const z = -171.0 - Math.min(1.0, (st - 5.0) / 6.0) * 2.2;
        f.skelGuardA.z = z;
        f.skelGuardA.x = _vx(z, -1, 1.15);
        f.skelGuardA.yaw = Math.PI * 0.85;   // geht Richtung Ausgang (-z), leicht zum Fluss gedreht
        cue("footstepStone", 5.2, -0.6);
      }
      if (st >= 8.2) { _setClipOnce(f.skelGuardB, "g2_roar", "roar", 0.2); cue("skeletonRoar", 8.3, -0.75); }
      else _setClipOnce(f.skelGuardB, "g2_idle", "idle", 0.2);
      focus(f.skelGuardA.x + 0.6, 2.05, f.skelGuardA.z);
    } else if (aheadDist(-172) > 13.0) {
      // vor der Szene: beide stehen reglos
      f.skelGuardA.z = -171.0; f.skelGuardA.x = _vx(-171, -1, 1.15); f.skelGuardA.yaw = Math.PI * 0.5;
      _setClipOnce(f.skelGuardA, "g1_idle", "idle", 0.3);
      _setClipOnce(f.skelGuardB, "g2_idle", "idle", 0.3);
    }
  }

  // --- Szene 2: Das Ritual (z ≈ -190, rechts) ---
  {
    const zR = VAULT_RIT.z;
    f.cultist.visible = inRange(zR);
    if (scene === "vaultRitual") {
      const pulse = 0.85 + 0.15 * Math.sin(t * 7.0);
      if (st < 2.2) {
        _setClipOnce(f.cultist, "r_idle", "idle", 0.2);
        f.cultist.tint = VAULT_NORMAL_TINT;
        f.skelRitual.visible = false;
      } else if (st < 7.2) {
        _setClipOnce(f.cultist, "r_summon", "summon", 0.25);
        f.cultist.tint = VAULT_RITUAL_GREEN;
        cue("chant", 2.3, 0.7);
        const u = Math.max(0.0, Math.min(1.0, (st - 2.6) / 3.2));
        f.skelRitual.visible = st > 2.6;
        f.skelRitual.y = -1.8 + u * u * (3.0 - 2.0 * u) * 2.85;
        _setClipOnce(f.skelRitual, "r_skel_rise", "summon", 0.2, 0.65);
        cue("boneRattle", 3.0, 0.65);
        light(f.skelRitual.x, 1.9, zR, [0.25 * 3, 1.0 * 3, 0.5 * 3 * pulse], 8.5);
      } else {
        if (st < 8.6) { _setClipOnce(f.cultist, "r_cast", "cast", 0.2); cue("ritualBurst", 7.3, 0.75); }
        else _setClipOnce(f.cultist, "r_alert", "alert", 0.25);
        f.cultist.tint = VAULT_NORMAL_TINT;
        f.skelRitual.visible = true;
        f.skelRitual.y = 1.05;
        if (f.skelRitual.clipDone()) _setClipOnce(f.skelRitual, "r_skel_idle", "idle", 0.25);
        light(f.skelRitual.x, 1.8, zR, [0.2 * 2, 0.85 * 2, 0.45 * 2 * pulse], 6.0);
      }
      focus(f.skelRitual.x, 2.0, zR);
    } else if (aheadDist(zR) > 14.5) {
      // vor der Szene: Kultist steht still, das Skelett liegt noch unter dem Boden
      f.cultist.tint = VAULT_NORMAL_TINT;
      _setClipOnce(f.cultist, "r_idle0", "idle", 0.3);
      f.skelRitual.visible = false;
      f.skelRitual.y = -1.8;
    } else {
      // nach der Szene: das Skelett bleibt stehen
      f.skelRitual.visible = inRange(zR);
      f.skelRitual.y = 1.05;
    }
  }

  // --- Szene 3: Der Wraith (z ≈ -206): kommt über das Wasser, kreischt vor dem Bug, zieht über das Boot hinweg ---
  {
    f.wraith.visible = scene === "vaultWraith";
    if (scene === "vaultWraith") {
      const zStart = -208.0, zRoar = cam[2] - 4.5;
      if (st < 4.2) {
        const u = st / 4.2;
        const zW = lerp(zStart, zRoar, u * u * (3.0 - 2.0 * u));
        f.wraith.z = zW;
        f.wraith.x = riverCenterX(zW) + Math.sin(st * 1.4) * 0.8;
        f.wraith.y = 0.3 + Math.sin(st * 3.0) * 0.08;
        f.wraith.yaw = 0.0;
        _setClipOnce(f.wraith, "w_run", "run", 0.2, 1.1);
        light(f.wraith.x, 1.2, f.wraith.z, [0.35, 0.6, 0.9], 6.0);
      } else if (st < 5.7) {
        f.wraith.z = zRoar;
        f.wraith.x = riverCenterX(zRoar);
        f.wraith.y = 0.35 + (st - 4.2) * 0.5;   // richtet sich beim Kreischen auf
        f.wraith.yaw = 0.0;
        _setClipOnce(f.wraith, "w_roar", "roar", 0.15);
        cue("wraithShriek", 4.25, 0.0);
        duck(0.25);
        light(f.wraith.x, 1.8, f.wraith.z, [0.6, 1.0, 1.4], 9.0);
      } else {
        // steigt schnell auf Kopfhöhe (Füße 2,3 m, Kamera geduckt bei 1,7 m) und zieht nach hinten über das Boot
        const u = Math.min(1.0, (st - 5.7) / 2.2);
        const zW = lerp(zRoar, cam[2] + 8.0, u);
        f.wraith.z = zW;
        f.wraith.x = riverCenterX(zW);
        f.wraith.y = 1.1 + 1.2 * Math.min(1.0, u * 3.0);
        f.wraith.yaw = 0.0;
        f.wraith.visible = u < 1.0;
        _setClipOnce(f.wraith, "w_pass", "run", 0.2, 1.25);
        cue("wraithWhoosh", 5.8, 0.0);
        duck(Math.min(1.0, 0.25 + Math.sin(Math.min(u * 1.4, 1.0) * Math.PI) * 0.75));
        light(f.wraith.x, f.wraith.y + 0.8, f.wraith.z, [0.4, 0.7, 1.0], 7.0);
      }
      if (st < 6.2) focus(f.wraith.x, f.wraith.y + 1.2, f.wraith.z);
    }
  }

  // --- Szene 4: Das Duell (z ≈ -226, links auf dem Podest) ---
  {
    const zD = VAULT_DUEL.z;
    f.hero.visible = f.boss.visible = inRange(zD);
    f.hellhound.visible = inRange(zD) && f.hellhound.z > -238.5;
    const flash = (fig, k) => light(fig.x + 0.6, 2.6, fig.z, [1.0 * k, 0.75 * k, 0.35 * k], 6.5);
    if (scene === "vaultDuel") {
      if (st < 2.0) {
        _setClipOnce(f.boss, "d_boss_roar", "roar", 0.2);
        _setClipOnce(f.hero, "d_hero_idle1", "idle", 0.2);
        _setClipOnce(f.hellhound, "d_dog_look", "look", 0.2);
        cue("bossRoar", 0.2, -0.75);
      } else if (st < 3.0) {
        _setClipOnce(f.hero, "d_hero_a1", "attack1", 0.12);
        _setClipOnce(f.boss, "d_boss_hit1", "hit", 0.12);
        cue("swordClash", 2.25, -0.7);
        if (st < 2.5) flash(f.boss, 3);
      } else if (st < 4.2) {
        _setClipOnce(f.hero, "d_hero_a2", "attack2", 0.12);
        _setClipOnce(f.boss, "d_boss_atk1", "attack", 0.15);
        cue("swordClash", 3.2, -0.7);
        if (st < 3.5) flash(f.hero, 3);
      } else if (st < 5.5) {
        _setClipOnce(f.hero, "d_hero_a3", "attack3", 0.12);
        _setClipOnce(f.boss, "d_boss_hit2", "hit", 0.12);
        cue("swordClash", 4.45, -0.7);
        if (st < 4.8) flash(f.boss, 3);
      } else if (st < 7.2) {
        _setClipOnce(f.hero, "d_hero_h1", "heavy", 0.12);
        _setClipOnce(f.boss, "d_boss_hit3", "hit", 0.12);
        cue("swordClash", 5.8, -0.75);
        if (st < 6.2) flash(f.boss, 4);
      } else if (st < 8.3) {
        _setClipOnce(f.hero, "d_hero_idle2", "idle", 0.2);
        _setClipOnce(f.boss, "d_boss_atk2", "attack", 0.15);
        cue("bossRoar", 7.3, -0.75);
      } else if (st < 9.6) {
        _setClipOnce(f.hero, "d_hero_h2", "heavy", 0.12);
        _setClipOnce(f.boss, "d_boss_hit4", "hit", 0.12);
        cue("swordClash", 8.6, -0.75);
        if (st < 9.0) flash(f.boss, 4);
      } else {
        _setClipOnce(f.boss, "d_boss_death", "death", 0.15);
        _setClipOnce(f.hero, "d_hero_stand", "idle", 0.25);
        _setClipOnce(f.hellhound, "d_dog_run", "run", 0.15, 1.35);
        cue("bossFall", 9.75, -0.75);
        cue("hellhoundWhine", 9.85, -0.65);
        // Gluthund springt vom Podest auf den Steg und rennt Richtung Ausgang
        const z = Math.max(-239.0, zD - 4.4 - Math.max(0.0, st - 9.6) * 4.0);
        const k = Math.min(1.0, Math.max(0.0, (st - 9.6) / 0.8));
        f.hellhound.z = z;
        f.hellhound.x = _vx(z, -1, lerp(2.2, 1.15, k));
        f.hellhound.y = lerp(1.4, 1.05, k);
        f.hellhound.yaw = Math.PI;
      }
      focus(lerp(f.hero.x, f.boss.x, 0.5) + 0.3, 2.8, lerp(f.hero.z, f.boss.z, 0.5));
    } else if (aheadDist(zD) > 14.0) {
      // vor der Szene
      f.hellhound.z = zD - 4.4; f.hellhound.x = _vx(zD, -1, 2.2); f.hellhound.y = 1.4; f.hellhound.yaw = Math.PI * 0.3;
      _setClipOnce(f.boss, "d_boss_idle0", "idle", 0.3);
      _setClipOnce(f.hero, "d_hero_idle0", "idle", 0.3);
      _setClipOnce(f.hellhound, "d_dog_idle0", "idle", 0.3);
    }
    // nach der Szene bleibt alles, wie es ist: der Boss liegt, der Held steht, der Hund ist fort
  }
}
