// Backt Figuren aus vigil-kit/bake.html in VFG1-Dateien. Aufruf: node bake.js <url> <three-Ordner> <ausgabe-Ordner>
const { chromium } = require('playwright');
const fs = require('fs');
const FIGS = {
  skeleton: ['idle', 'alert', 'look', 'summon', 'roar', 'death', 'walk'],
  cultist: ['idle', 'summon', 'cast', 'alert'],
  wraith: ['idle', 'run', 'roar'],
  boss: ['idle', 'roar', 'attack', 'hit', 'death'],
  hellhound: ['idle', 'run', 'look', 'roar'],
  hero: ['idle', 'attack1', 'attack2', 'attack3', 'heavy', 'death'],
};
(async () => {
  const [url, three, out] = process.argv.slice(2);
  const only = process.env.ONLY ? process.env.ONLY.split(',') : Object.keys(FIGS);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.route(/three@0\.170\.0\/(.*)$/, (r) => { const m = /three@0\.170\.0\/(.*)$/.exec(r.request().url()); r.fulfill({ path: three + '/' + m[1], contentType: 'application/javascript' }); });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  p.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  for (const name of only) {
    const r = await p.evaluate(([n, c]) => window.__bake(n, c, 15), [name, FIGS[name]]);
    fs.writeFileSync(`${out}/${name}.vfg`, Buffer.from(r.b64, 'base64'));
    console.log(name, (r.bytes / 1024).toFixed(0) + ' KB', 'n=' + r.head.n, 'bones=' + r.head.bones, 'h=' + r.head.height.toFixed(2),
      r.head.clips.map((c) => `${c.name}:${c.frames}`).join(' '));
  }
  await b.close();
})();
