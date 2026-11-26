import * as THREE from 'three';
import { makeRand } from './Rand.js';
import { AssetForge } from './AssetForge.js';

/**
 * Minimaler Ersatz für die Engine von "The Ninth Vigil" (MIT), gerade genug für
 * AssetForge (den echten Texturgenerator), CharacterMesh, Cloak und MonsterMaterials.
 *
 * Im Unterschied zur früheren Fassung:
 *  - Texturen kommen aus dem originalen AssetForge mit allen Materialarten
 *    (Stein, Pflaster, Metall, Platte, Stoff, Leder, Knochen ...), nicht aus Rauschen.
 *  - `get(name)` existiert (Cloak fragt nach 'terrain' und 'weather'); es liefert null.
 *  - `bus` existiert, falls ein Modul Ereignisse sendet.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {{seed?:number, tier?:'low'|'med'|'ultra'}} [opts]  tier steuert die Texturgröße (512 / 1024)
 */
export function createStandaloneHost(renderer, scene, opts = {}) {
  const seed = opts.seed ?? 0x90716;
  const host = {
    renderer,
    scene,
    scenario: opts.scenario ?? 'crypt',
    quality: { tier: opts.tier ?? 'low' },
    clock: { dt: 1 / 60, elapsed: 0, frame: 0 },
    bus: { emit() {}, on() {}, off() {} },
    get() { return null; },
    freshRand(s = 1) { return makeRand((seed ^ s) >>> 0); },
  };
  // AssetForge trägt sich im Konstruktor selbst als host.assets ein
  new AssetForge(host);
  return host;
}
