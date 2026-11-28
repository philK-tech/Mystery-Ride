# Mystery Ride

Ableger von [Alienworld](https://github.com/philK-tech/Alienworld): dieselbe prozedurale Bootsfahrt in WebGL2 durch Nebelwald, Pilzwald und offene Ebene. Neu ist ein Verlies unter dem Schloss zwischen Nebelwald und Pilzwald, mit Fallgatter und Flügeltor, Geräuschen und animierten Figuren. Das Ergebnis ist eine einzelne HTML-Datei ohne Abhängigkeiten.

## Ausprobieren

`index.html` im Browser öffnen. Testsprünge: `index.html#t=54` (Zeit in der Fahrt), `#t=54&s=4` (dazu Sekunde in der Szene), `#figs` (Figurenvorschau).

## Aufbau

- Bauen: `node source/build.mjs` schreibt `index.html`, dafür reicht Node.js 18 oder neuer.
- Aufbau und Reihenfolge der Dateien: `docs/ARCHITEKTUR.md`
- Verlies und Szenen: `source/src/vault.js`, Tore: `source/src/gates.js`
- Prozedurale Figuren mit IK und Federn: `source/src/procfig.js`
- Gebackene Figuren abspielen: `source/src/figures.js`, Dateien in `source/assets/figures/`, neu backen nach `source/tools/vigil-bake/README.md`

## Lizenz

MIT, siehe `LICENSE`, einschließlich des selbst erstellten Bootsmodells. Ausnahme:

- `source/tools/vigil-bake/vigil-kit/` und die daraus gebackenen Figuren in `source/assets/figures/` stammen aus „The Ninth Vigil“ (github.com/iamlukethedev/The-Ninth-Vigil, MIT, Copyright (c) 2026 iamlukethedev, Lizenztext in `vigil-kit/LICENSE`).
