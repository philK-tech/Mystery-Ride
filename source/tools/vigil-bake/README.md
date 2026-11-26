# vigil-bake: Figuren aus "The Ninth Vigil" für Alienworld backen

`vigil-kit/` enthält Held, Monster und Verliesteile aus "The Ninth Vigil" (MIT, iamlukethedev), lauffähig ohne die Spiel-Engine (siehe `vigil-kit/README.md`).
`vigil-kit/bake.html` backt Figuren mit three.js in das Format VFG1 (Aufbau im Kopf von `bake.html`), `bake.js` steuert das per Playwright.
Alienworld spielt die gebackenen Dateien ohne three.js ab (`src/figures.js`).

## Neu backen

```
cd source/tools/vigil-bake/vigil-kit && python3 -m http.server 8765 &
cd .. && node bake.js http://localhost:8765/bake.html <Ordner mit three@0.170.0 (npm pack three@0.170.0)> ../../assets/figures
```

Welche Figuren und Clips gebacken werden, steht in `FIGS` in `bake.js`. Danach `node build.mjs`.
