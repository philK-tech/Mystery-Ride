# Alienworld: Aufbau für Mitarbeitende

Alienworld ist eine prozedurale Bootsfahrt in WebGL2 ohne Bibliotheken. Alles entsteht im Code; die fertige Seite ist eine einzige Datei `index.html`.

## Bauen und testen

- Quellen liegen in `source/src/`. `node source/build.mjs` hängt die Dateien in fester Reihenfolge zu einem Skript zusammen und schreibt `index.html`.
  Reihenfolge (`FILES` in `build.mjs`): `setup, math, geometry, meshes, sdfmesh, shaders, world, renderer, boat, creatures, figures, audio, main`.
  Alle Dateien teilen sich einen gemeinsamen Gültigkeitsbereich (kein `import`/`export`). Eine Funktion aus `math.js` ist in `world.js` einfach verfügbar.
- Binäre Daten (Boot, gebackene Figuren) bettet der Build über `__ASSET__("name")` als gzip+base64 ein, siehe `ASSETS` in `build.mjs`.
- Öffnen: `index.html` direkt im Browser (kein Server nötig).
- Testsprung: `index.html#t=54` startet 54 s in der Fahrt, `#t=54&s=4` zusätzlich 4 s in die nächste Szene. Der Blick rastet in den ersten Bildern sofort ein.
- `#figs` stellt alle gebackenen Figuren vor die Startposition, `#figs&clip=roar` spielt dort einen Clip.
- Shaderfehler erscheinen in einem roten Banner.

## Welt und Koordinaten

- Das Boot fährt entlang −z. `state.travelDist` ist die gefahrene Strecke, die aktuelle Position `zCur = −(travelDist mod LOOP_LENGTH)`.
- Die Strecke ist eine Schleife der Länge `LOOP_LENGTH = 480` (`math.js`). Die Welt wird bei −L, 0 und +L dreimal gezeichnet (`updateCopies`), damit der Übergang nahtlos ist.
- Der Fluss schlängelt sich: `riverCenterX(z)`, `riverHalfWidth(z)` (etwa 5,6 bis 8,8). Gelände: `terrainHeight(x, z)`. Wasser liegt bei y = 0.
- Zonen (je 160 Einheiten, weiche Übergänge von ±14):
  - A „Finsterer Nebelwald“: z 0 bis −160, Nacht, Mond `SUN_A`/`MOON_A`, Schloss `CASTLE` bei z −150 rechts
  - B „Wald der Riesenpilze“: z −160 bis −320, Biolumineszenz
  - C „Ebene der Schwebefelsen“: z −320 bis −480, Tag
  - `zoneWeights(z)` gibt es identisch in JS (`math.js`) und GLSL (`GLSL_ZONE` in `shaders.js`). `camZone` ist die Gewichtung an der Kamera, `zoneMix(a, b, c)` mischt Werte danach (Belichtung, Bloom-Schwelle).

## Rendern (main.js, renderer.js, shaders.js)

- Pipeline: HDR-Ziel RGBA16F mit 4x MSAA, Spiegelung des Flusses in halber Auflösung, Bloom-Kette, Abschluss mit ACES, Filmkorn, Vignette und Farbsäumen (`FS_COMPOSITE`).
- `drawScene(pass)` zeichnet alles Opake mit dem Programm `progOpaque` (`VS_WORLD` + `FS_OPAQUE`). `pass.reflect` ist der Spiegeldurchgang.
- Statische Meshes: `createGeometryBuilder()` (Positionen, Normalen, UV, `extra` vec3, `matId`) → `uploadStaticMesh()`. Instanzen: `pushInst(gruppe, pos, rotY, ..., scale, tint)` in `world.js`, gezeichnet nach z sortiert.
- Material wählt `FS_OPAQUE` über `matId` (Vertexattribut). Wichtige IDs: 0 Gelände, 2 Fels, 30 Kiefer, 32 Riesenpilz, 34 Tentakel, 36 Mauerwerk (dunkle Tönung = Schlossstein mit Quadern und Fugen), 37 Dach, 38 Lichter, 40 gebackene Figur.
- Licht ist je Zone im Fragment-Shader festgelegt (Abschnitt „Licht“ am Ende von `FS_OPAQUE`). Punktlichter gibt es nicht; Leuchten entsteht über `emissive` plus Bloom.
- Nebel: `applyFog(col, worldPos, camPos, t)` in `GLSL_COMMON`.

## Szenen (world.js, creatures.js, main.js)

- `SCENES` in `world.js`: `{ type, z, side, dur, trigger, slow, zoom }`. Eine Szene startet, wenn das Boot noch `trigger` Einheiten vor `z` ist. Sie dauert `dur` Sekunden Echtzeit; das Boot fährt dabei mit dem Faktor `slow`, `zoom` verengt den Bildwinkel.
- `updateCreatures(camZ, t, sceneIdx, sceneT, cam)` in `creatures.js` baut pro Bild die Tiere jeder Szene. Hilfen darin:
  - `focus(x, y, z)` richtet die Kamera fest auf einen Punkt.
  - `cue(sc, st, name, at, pan)` spielt ein Geräusch einmal, wenn die Szenenzeit `at` erreicht.
  - Globale Effekte: `sceneDuck` (ducken 0..1), `sceneShake`, `sceneRock`, `sceneStand`, `sceneGrowl`.
  - `ease(t, t0, t1)` weiche Rampe.
- Kamera: automatischer Blick mit kurzen Blicken auf Sehenswürdigkeiten (`staticPois`), während einer Szene fest auf `sceneFocus`. Eigenes Umsehen per Ziehen.

## Gebackene Figuren (figures.js)

Held und Monster aus „The Ninth Vigil“ (MIT), gebacken mit `source/tools/vigil-bake`. Verfügbar: `hero`, `skeleton`, `cultist`, `wraith`, `hellhound`, `boss`.

```js
const f = spawnFigure('skeleton', { x, y, z, yaw, scale: 1 });  // sofort nutzbar, lädt im Hintergrund
f.play('alert', 0.25);   // Clip, Überblendzeit in s. Nicht schleifende Clips bleiben am Ende stehen.
f.clipDone();            // true, wenn ein nicht schleifender Clip fertig ist
f.x = ...; f.y = ...; f.z = ...; f.yaw = ...; f.visible = false; f.tint = [r, g, b, 1];
removeFigure(f);
```

- yaw 0 heißt: Figur schaut nach +z, also dem ankommenden Boot entgegen. Größen (Meter): Held 1,85, Skelett 1,87, Kultist 1,79, Wraith 2,04, Gluthund 1,05, Boss 4,26.
- Gebackene Clips:
  - hero: idle, attack1, attack2, attack3, heavy, death
  - skeleton: idle, alert, look, summon, roar, death, walk
  - cultist: idle, summon, cast, alert
  - wraith: idle, run, roar
  - boss: idle, roar, attack, hit, death
  - hellhound: idle, run, look, roar
  Weitere Clips lassen sich in `tools/vigil-bake/bake.js` ergänzen und neu backen.
- Die Figuren werden mit Alienworlds Licht, Nebel und Spiegelung gezeichnet (Material 40). Die Grundfarbe steckt im Vertex, `tint` färbt sie zusätzlich (z. B. grünlich im Ritual).
- Figuren immer einmalig erzeugen (z. B. beim ersten Aufruf der Szene) und danach nur Position, Clip und `visible` ändern.

## Ton (audio.js)

Alles synthetisch über Web Audio. Musik je Zone (`ZONE_MUSIC`), Atmosphäre je Zone, Geräusche über `sfx(name, pan)`. Neue Geräusche: einen Zweig in `sfx` ergänzen und in der Szene per `cue` auslösen.

## Regeln

- Keine externen Bibliotheken, kein three.js in Alienworld.
- Sparsam mit Lichtquellen und Leuchten; Stimmung über Nebel, Silhouetten und wenige Lichtpunkte.
- Jede Änderung mit `node source/build.mjs` bauen und per Testsprung prüfen.
