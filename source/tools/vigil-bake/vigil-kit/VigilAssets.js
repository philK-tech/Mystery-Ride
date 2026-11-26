import * as THREE from 'three';
import { createStandaloneHost } from './core/StandaloneHost.js';
import { makeRand } from './core/Rand.js';

import { buildHeroRig } from './hero/Skeleton.js';
import { CharacterMesh } from './hero/CharacterMesh.js';
import { HeroAnimGraph } from './hero/AnimGraph.js';
import { buildHeroClips, COMBO } from './hero/HeroClips.js';
import { Cloak } from './hero/Cloak.js';

import { SPECIES, SPECIES_LIST, resolveSpecies } from './monsters/Species.js';
import { MonsterMaterials } from './monsters/MonsterMaterials.js';
import { AnimGraph } from './monsters/AnimKit.js';

import { Kit } from './world/dungeon/Pieces.js';
import { SPEC } from './world/dungeon/Spec.js';

/**
 * Figuren und Verliesteile aus "The Ninth Vigil" (MIT, iamlukethedev) ohne die Spiel-Engine.
 * Aufbau nach dem Vorbild von chars/Hero.js und chars/Bestiary.js des Originals.
 *
 *   const vigil = new VigilStandaloneFactory(renderer, scene);
 *   const hero = vigil.createHero();          scene.add(hero.root);
 *   const ghoul = vigil.createCreature('ghoul');  scene.add(ghoul.root);
 *   // pro Bild: hero.update(dt, elapsed); ghoul.update(dt, elapsed);
 */
const METAL = {
  metal: 0.86, brass: 0.72,
  bone: 0.02, boneOld: 0.02, basalt: 0.0, stone: 0.0,
  flesh: 0.0, rot: 0.0, charred: 0.03, cloth: 0.0, hide: 0.02, ember: 0.12,
};

/**
 * Weltumriss einer Figur aus ihren Knochen. Box3().setFromObject(root) taugt dafür nicht:
 * Die Haut wird in Rig-Koordinaten gebunden (beim Helden über einen Halter mit Einheitsmatrix),
 * ihr Begrenzungskasten liegt deshalb am Weltursprung statt an der Figur.
 */
const _bp = new THREE.Vector3();
function boxFromBones(bones, root, pad, out) {
  root.updateMatrixWorld(true);
  out.makeEmpty();
  for (const b of bones) { if (b) { b.getWorldPosition(_bp); out.expandByPoint(_bp); } }
  if (out.isEmpty()) { root.getWorldPosition(_bp); out.setFromCenterAndSize(_bp, new THREE.Vector3(0.6, 1.8, 0.6)); }
  out.min.x -= pad; out.min.z -= pad; out.max.x += pad; out.max.z += pad; out.max.y += pad * 0.5;
  return out;
}

function fitToSpec(def, geometry) {
  const spec = Number.isFinite(def?.height) ? def.height : 0;
  const pos = geometry?.attributes?.position;
  if (!spec || !pos) return 1;
  let top = 0;
  const arr = pos.array;
  for (let i = 1; i < arr.length; i += 3) if (arr[i] > top) top = arr[i];
  if (!(top > 0.2)) return 1;
  return Math.min(1.22, Math.max(1, spec / top));
}

export class VigilStandaloneFactory {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {{seed?:number, tier?:'low'|'med'|'ultra'}} [opts]
   */
  constructor(renderer, scene, opts = {}) {
    const seed = opts.seed ?? 0x90716;
    this.host = createStandaloneHost(renderer, scene, opts);
    this.monsterMats = new MonsterMaterials(this.host);
    this._built = new Map();
    this.kit = new Kit(makeRand(seed));
  }

  /** Uhr der Module (Umhang, Materialien) einmal pro Bild weiterstellen. */
  tick(dt, elapsed) {
    const c = this.host.clock;
    c.dt = dt; c.elapsed = elapsed; c.frame++;
  }

  /**
   * Held: fünf Skinned Meshes (Haut, Stoff, Leder, Stahl, Gold), Großschwert, simulierter Umhang,
   * Bewegung und Aktionen (attack1-3, heavy, cast, hitFront ...).
   */
  createHero(opts = {}) {
    const host = this.host;
    const rig = buildHeroRig();
    const root = new THREE.Group();
    root.name = 'VigilHero';
    root.add(rig.root);
    /* Die Haut wird in Rig-Koordinaten gebunden. Wie im Original hängt sie an einem Halter mit
       fester Einheitsmatrix, sonst würde die Bewegung des Helden doppelt angewendet. */
    const holder = new THREE.Object3D();
    holder.matrixAutoUpdate = false;
    holder.matrixWorldAutoUpdate = false;
    root.add(holder);

    const charMesh = new CharacterMesh(host, rig, { seed: opts.seed ?? 20791 });
    const meshes = charMesh.build();
    for (const m of meshes) holder.add(m);

    const clips = buildHeroClips();
    const graph = new HeroAnimGraph(rig, clips.base, clips.actions, { baseStart: 'locomotion' });

    root.userData.box = (out = new THREE.Box3()) => boxFromBones(rig.bones, root, 0.25, out);
    const cloak = new Cloak(host, rig, charMesh.cloakAnchors);
    const cm = cloak.build();
    if (cm) holder.add(cm);

    const ctx = { moveW: 0, gait: 0, turn: 0, armDamp: 0, elapsed: 0, dt: 1 / 60, seed: 0.37 };
    let combo = 0;
    let started = false;

    return {
      root, rig, meshes, graph, cloak, clips,
      /** Weltumriss aus den Knochen (statt Box3().setFromObject, siehe boxFromBones) */
      box(out = new THREE.Box3()) { return boxFromBones(rig.bones, root, 0.25, out); },
      /** Gangart: 0 = stehen, 1 = gehen, 2 = laufen */
      setGait(g) { ctx.gait = g; ctx.moveW = g > 0.05 ? 1 : 0; graph.locoRate = 0.6 + g * 0.5; },
      play(name, fade = 0.11) {
        if (clips.actions[name]) return graph.playAction(name, { fade, restart: true });
        return graph.playBase(name, { fade, restart: true });
      },
      attack() { return graph.playAction(COMBO[combo++ % COMBO.length], { fade: 0.08, restart: true }); },
      update(dt, elapsed) {
        ctx.elapsed = elapsed; ctx.dt = dt;
        graph.update(dt, ctx);
        root.updateMatrixWorld(true);
        if (!started) { cloak.reset(); started = true; }
        else cloak.update(dt);
      },
    };
  }

  /** 'skeleton' | 'ghoul' | 'cultist' | 'hellhound' | 'brute' | 'wraith' | 'boss' */
  createCreature(speciesName = 'skeleton', opts = {}) {
    const key = resolveSpecies ? resolveSpecies(speciesName) : speciesName;
    const def = SPECIES[key];
    if (!def) throw new Error(`Unbekannte Art: ${speciesName}`);

    let built = this._built.get(key);
    if (!built) {
      const { rig, geometry, slots } = def.build(opts.buildSeed ?? 1337);
      built = { rig, geometry, slots, clips: def.clips(), fit: fitToSpec(def, geometry) };
      this._built.set(key, built);
    }

    const root = new THREE.Group();
    root.name = `VigilCreature_${key}`;
    const inst = built.rig.instantiate();
    root.add(inst.root);

    const materials = built.slots.map((slot) => {
      const cfg = def.slotMat?.[slot.name] ?? {};
      const mat = this.monsterMats.make(slot.recipe, {
        tint: cfg.tint ?? 0xffffff,
        transparent: !!cfg.transparent,
        depthWrite: cfg.depthWrite ?? !cfg.transparent,
        opacity: 1,
        ghost: cfg.ghost ?? 0,
        yMin: 0,
        height: def.height * 1.05,
        dissolveEdge: def.dissolveEdge,
        dissolveScale: def.dissolveScale ?? 9,
        auraColor: def.rim ?? 0x93a8c6,
        flashColor: 0xfff3e2,
        side: cfg.transparent ? THREE.DoubleSide : THREE.FrontSide,
      });
      mat.name = `${key}:${slot.name}`;
      mat.metalnessMap = null;
      mat.aoMap = null;
      mat.metalness = cfg.metal ?? METAL[slot.recipe] ?? 0.02;
      if (cfg.rough !== undefined) mat.roughness = cfg.rough;
      const u = mat.userData.monU;
      if (u) {
        if (cfg.emiss !== undefined) u.uMonEmissColor.value.set(cfg.emiss).multiplyScalar(cfg.emissI ?? 1);
        if (cfg.fade) u.uMonFade.value.set(cfg.fade[0], cfg.fade[1]);
      }
      return mat;
    });

    const mesh = new THREE.SkinnedMesh(built.geometry, materials);
    mesh.name = `creature_${key}`;
    mesh.frustumCulled = false;
    mesh.castShadow = !def.noShadow;
    mesh.receiveShadow = true;
    root.add(mesh);
    mesh.bind(inst.skeleton, new THREE.Matrix4());

    root.scale.setScalar(built.fit * (opts.scale ?? 1));
    root.userData.box = (out = new THREE.Box3()) => boxFromBones(inst.bones, root, 0.3 * root.scale.x, out);

    const anim = new AnimGraph(built.rig, built.clips, { start: 'idle', fallback: 'idle' });
    const ctx = { gait: 0, elapsed: 0, seed: opts.seed ?? 0, hitDir: { x: 0, z: 1 }, t: 0, phase: 0 };

    return {
      root, mesh, def, anim, bones: inst.bones, byName: inst.byName,
      clipNames: Object.keys(built.clips),
      /** Weltumriss aus den Knochen (statt Box3().setFromObject, siehe boxFromBones) */
      box(out = new THREE.Box3()) { return boxFromBones(inst.bones, root, 0.3 * root.scale.x, out); },
      /** Clip abspielen, z. B. 'idle', 'walk', 'run', 'alert', 'roar', 'summon', 'cast', 'death' */
      play(name, fade = 0.14) { return anim.play(name, { fade, restart: true }); },
      setGait(g) { ctx.gait = g; },
      update(dt, elapsed) {
        ctx.elapsed = elapsed; ctx.t = elapsed;
        anim.update(dt, inst.bones, ctx);
      },
    };
  }

  /** Gemeinsame Materialien für die Verliesteile, aus dem echten Texturgenerator. */
  createDungeonMaterials() {
    const a = this.host.assets;
    return {
      stone: a.material({ kind: 'stone', tiling: SPEC.uv.wall, tint: 0xc8d0de, roughness: 0.84 }),
      floor: a.material({ kind: 'cobble', tiling: SPEC.uv.floor, tint: 0x9aa4b4, roughness: 0.80 }),
      iron: a.material({ kind: 'metal', tiling: SPEC.uv.iron, tint: 0x454b54, metalness: 0.84, roughness: 0.42 }),
      wood: a.material({ kind: 'wood', tiling: SPEC.uv.wood, tint: 0x5c3f28, roughness: 0.86 }),
      bone: a.material({ kind: 'bone', tiling: SPEC.uv.bone, tint: 0xd9ceba, roughness: 0.62 }),
      crag: a.material({ kind: 'stone', tiling: SPEC.uv.rock, tint: 0x38404d, roughness: 0.94 }),
      ember: new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: new THREE.Color(0xff7c24), emissiveIntensity: 3.2, roughness: 0.4 }),
    };
  }

  /** Verwandelt ein Bauteil aus dem Kit ({ stone, iron, wood, bone, ember, floor, crag }) in eine Gruppe. */
  buildPieceGroup(pieceDict, materials = null) {
    const mats = materials ?? (this._dmats ??= this.createDungeonMaterials());
    const group = new THREE.Group();
    for (const [slot, geo] of Object.entries(pieceDict)) {
      if (!geo || !geo.isBufferGeometry) continue;
      const mesh = new THREE.Mesh(geo, mats[slot] ?? mats.stone);
      mesh.castShadow = slot !== 'ember';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

export { SPECIES_LIST, SPEC };
