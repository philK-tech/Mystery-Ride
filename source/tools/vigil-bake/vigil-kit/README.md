# Vigil Kit (geprüft)

Held, sieben Monster und Verliesteile aus „The Ninth Vigil“ (MIT, iamlukethedev) für eigene three.js-Szenen, ohne die Spiel-Engine. Getestet mit three.js 0.170.0.

## Starten

ES-Module laufen nicht per Doppelklick (file://). Im Ordner einen kleinen Webserver starten:

```
python3 -m http.server 8000
```

Dann `http://localhost:8000/showcase.html` öffnen. Varianten: `?only=hero`, `?only=boss`, `?only=hellhound`, `?clip=roar`, `?gait=1`. Doppelklick spielt bei allen Figuren die nächste Animation.

## Benutzung

```js
import { VigilStandaloneFactory } from './VigilAssets.js';
const vigil = new VigilStandaloneFactory(renderer, scene, { tier: 'low' });   // 'low' = 512er Texturen

const hero = vigil.createHero();               scene.add(hero.root);
const boss = vigil.createCreature('boss');     scene.add(boss.root);
boss.play('roar');                              // Clipnamen: boss.clipNames
hero.attack();                                  // Kombo attack1 bis attack3, außerdem hero.play('heavy' | 'cast')

// pro Bild
vigil.tick(dt, elapsed);
hero.update(dt, elapsed);
boss.update(dt, elapsed);

// Verliesteile aus dem Kit: liefern Geometrien je Material, buildPieceGroup macht daraus eine Gruppe
scene.add(vigil.buildPieceGroup(vigil.kit.sarcophagus(0)));
const mats = vigil.createDungeonMaterials();    // stone, floor, iron, wood, bone, crag, ember
```

Arten: `skeleton`, `ghoul`, `cultist`, `hellhound`, `brute`, `wraith`, `boss`.
Typische Clips der Monster: `idle`, `walk`, `run`, `alert`, `look`, `roar`, `hit`, `death`, dazu je nach Art Angriffe, `cast`, `summon`.
Umriss einer Figur in Weltkoordinaten: `figur.box()` (liefert `THREE.Box3`). Nicht `new THREE.Box3().setFromObject(figur.root)` verwenden: Die Haut ist in Rig-Koordinaten gebunden, ihr Kasten liegt deshalb am Weltursprung.
Positionieren und drehen über `figur.root.position` und `figur.root.rotation.y`. Größe über `createCreature(name, { scale })`.

Kit-Teile (Auswahl): `wallPanel`, `pier`, `portal`, `vaultWeb`, `ribArch`, `slab`, `column`, `columnBroken`, `stair`, `altar`, `sarcophagus`, `rubble`, `bones`, `sconce`, `brazier`, `flame`, `chain`, `portcullis`, `doorLeaf`, `obelisk`.

## Was gegenüber dem ursprünglichen Paket korrigiert ist

1. `createHero().update` benutzte `this.host`, das dort nicht existiert.
2. `createHero` las `clips.action`, das Original liefert `clips.actions`.
3. Der Held wird wie im Original über einen Halter mit fester Einheitsmatrix gebunden, sonst wird seine Bewegung doppelt angewendet.
4. `createCreature` übergab ganze Slot-Objekte an `MonsterMaterials.make`. Jetzt wie in `Bestiary.js`: Rezept des Slots, Farbe, Metall, Rauheit und Leuchten aus der Artbeschreibung. Größe nach Artvorgabe.
5. Der Host hat jetzt `get()` (der Umhang fragt nach Gelände und Wind) und `bus`.
6. Neu: `box()` an jeder Figur liefert den Umriss aus den Knochen.
7. Texturen kommen aus dem originalen `AssetForge` mit dem vollständigen Generator (`core/texgen/`), nicht mehr aus einfachem Rauschen.

Alle übrigen Module sind unverändert aus dem Originalspiel.
