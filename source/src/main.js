// main.js: Zustand, Steuerung und Render-Loop
// --- State & Controls ---
const state = {
  running: true,
  time: 0.0,
  travelDist: 0.0,
  lastFrame: performance.now()
};
// Testhilfe: index.html#t=30 startet 30 Sekunden in der Fahrt, #t=14&s=8 zusätzlich 8 Sekunden in die nächste Szene
let debugSceneT = 0;
let snapFrames = location.hash ? 6 : 0;
{
  const m = /t=([\d.]+)/.exec(location.hash);
  if (m) { state.time = +m[1]; state.travelDist = +m[1] * 4.6; }
  const ms = /s=([\d.]+)/.exec(location.hash);
  if (ms) debugSceneT = +ms[1];
}

function toggleRun() {
  state.running = !state.running;
  btnToggle.textContent = state.running ? "Stop" : "Start";
  state.lastFrame = performance.now();
}

// Testhilfe: #figs stellt alle gebackenen Figuren nebeneinander vor die Startposition, #figs&clip=roar spielt einen Clip
if (/figs/.test(location.hash)) {
  const clip = (/clip=(\w+)/.exec(location.hash) || [0, "idle"])[1];
  ["hero", "skeleton", "cultist", "wraith", "hellhound", "boss"].forEach((n, i) => {
    const f = spawnFigure(n, { x: riverCenterX(-12) + (i - 2.5) * 2.4, y: 0.0, z: -12 - (n === "boss" ? 2 : 0), yaw: 0 });
    const tryPlay = () => (f.ready ? f.play(clip, 0) || f.play("idle", 0) : setTimeout(tryPlay, 100));
    tryPlay();
  });
}

btnToggle.addEventListener("click", toggleRun);
btnAudio.addEventListener("click", () => setAudio(!audioEnabled));
// Browser erlauben Ton erst nach einer Bedienung: beim ersten Tippen oder Klicken einschalten,
// sofern man den Ton nicht selbst schon geschaltet hat
// iOS zählt nur Loslassen bzw. Klick als Freigabe, daher mehrere Ereignisse
const AUTO_EVENTS = ["pointerup", "touchend", "click", "keydown"];
const audioAutoStart = (e) => {
  if (e.target === btnAudio || e.key === "m" || e.key === "M") return;
  if (!audioUserSet && !audioEnabled) setAudio(true, false);
  else if (audioEnabled) unlockAudio();
  // erst aufhören, wenn der Kontext wirklich läuft
  if (audioCtx && audioCtx.state === "running") AUTO_EVENTS.forEach((n) => window.removeEventListener(n, audioAutoStart, true));
};
AUTO_EVENTS.forEach((n) => window.addEventListener(n, audioAutoStart, true));
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    toggleRun();
  } else if (e.key === "m" || e.key === "M") {
    setAudio(!audioEnabled);
  }
});

// Selbst umsehen: Maus ziehen oder mit dem Finger wischen. Nach kurzer Zeit übernimmt wieder der automatische Blick.
const look = { yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0, idle: 99 };
canvas.addEventListener("pointerdown", (e) => {
  look.dragging = true;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!look.dragging) return;
  const k = 2.6 / Math.max(window.innerWidth, window.innerHeight);
  look.yaw = Math.max(-2.6, Math.min(2.6, look.yaw + (e.clientX - look.lastX) * k));
  look.pitch = Math.max(-0.7, Math.min(0.9, look.pitch + (e.clientY - look.lastY) * k));
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  look.idle = 0;
});
const endDrag = () => { look.dragging = false; };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

const ZONE_NAMES = ["Finsterer Nebelwald", "Wald der Riesenpilze", "Ebene der Schwebefelsen"];
function updateChapterLabel(w) {
  const k = w[0] >= w[1] && w[0] >= w[2] ? 0 : w[1] >= w[2] ? 1 : 2;
  if (chapterEl.textContent !== ZONE_NAMES[k]) chapterEl.textContent = ZONE_NAMES[k];
}

// --- Render Loop ---
const FAR = 300.0;       // Sichtweite
const BEHIND = 30.0;     // was hinter der Kamera noch gezeichnet wird (seitlich im Bild)
const viewMat = Mat4.create();
const projMat = Mat4.create();
const viewProjMat = Mat4.create();
const reflViewProj = Mat4.create();
const mirrorMat = Mat4.create();
mirrorMat[5] = -1;
const identityMat = Mat4.create();
const tempModelMat = Mat4.create();
const camEye = [0, 2.2, 0];
const camZone = [1, 0, 0];
// Belichtung und Bloom-Schwelle je Zone: Dämmerung, Nacht, Tag
const zoneMix = (a, b, c) => camZone[0] * a + camZone[1] * b + camZone[2] * c;
const ridePos = [0, 0, 0];
let boatHeading = 0;
const gaze = { yaw: 0, pitch: 0.05 };
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// feste Blickziele entlang der Strecke: Wasserfälle und die nahen schwebenden Berge
const staticPois = [];
const camTarget = [0, 2.4, -14];
const camMirror = [0, -2.2, 0];
const offsetVec = [0, 0, 0];
const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.0);

// Die Welt existiert dreimal hintereinander (Versatz +L, 0, -L).
// Für jede Kopie wird nur der Abschnitt gezeichnet, der in Sichtweite liegt.
const copies = [LOOP_LENGTH, 0.0, -LOOP_LENGTH].map((o) => ({ o, zMin: 0, zMax: 0, on: false }));
function updateCopies(camZ) {
  for (const c of copies) {
    c.zMin = Math.max(camZ - FAR - c.o, -LOOP_LENGTH - 20.0);
    c.zMax = Math.min(camZ + BEHIND - c.o, 20.0);
    c.on = c.zMin < c.zMax;
  }
}

world.waterfalls.forEach((wf) => staticPois.push({ x: wf.x, y: wf.isSkyFall ? wf.y * 0.6 : wf.y * 0.5, z: wf.z, w: wf.isSkyFall ? 0.9 : 0.8, sky: wf.isSkyFall }));
world.floatingPeaks.forEach((pk) => { if (pk.fall) staticPois.push({ x: pk.x, y: pk.y, z: pk.z, w: 0.7, sky: true }); });

// Puffer für die Staubwolken (wird jedes Bild neu befüllt)
const dustVao = gl.createVertexArray();
const dustBuf = gl.createBuffer();
gl.bindVertexArray(dustVao);
gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
gl.bufferData(gl.ARRAY_BUFFER, dustData.byteLength, gl.DYNAMIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
gl.enableVertexAttribArray(1);
gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
gl.bindVertexArray(null);
let viewH = 1.0;

function drawScene(pass) {
  // pass.reflect: Spiegelbild für den Fluss (gespiegelte Kamera, alles unter Wasser verworfen)
  const vp = pass.reflect ? reflViewProj : viewProjMat;
  const cam = pass.reflect ? camMirror : camEye;
  const u = progOpaque.u;

  gl.useProgram(progOpaque.prog);
  gl.uniform3fv(u.uZoneW, camZone);
  gl.uniformMatrix4fv(u.uViewProj, false, vp);
  gl.uniform1f(u.uTime, state.time);
  gl.uniform3fv(u.uCamPos, cam);
  gl.uniform3fv(u.uRidePos, ridePos);
  gl.uniform4f(u.uAnim, 0, 0, 0, 0);
  gl.uniform1i(u.uBoatTex, 1);
  gl.uniform4f(u.uBoat, ridePos[0], ridePos[2], boatHeading, boat.mesh ? 1.0 : 0.0);
  gl.uniform2f(u.uBoatScale, BOAT_SCALE[0], BOAT_SCALE[2]);
  gl.uniform1f(u.uClip, pass.reflect ? 1.0 : 0.0);
  gl.uniform2f(u.uScreen, canvas.width, canvas.height);
  gl.uniform1i(u.uReflTex, 0);
  const setModel = (mat, tint, instanced) => {
    gl.uniformMatrix4fv(u.uModel, false, mat);
    gl.uniform4fv(u.uTint, tint);
    gl.uniform1f(u.uInstanced, instanced);
  };
  const setOffset = (o) => { offsetVec[2] = o; gl.uniform3fv(u.uOffset, offsetVec); };

  // Himmel, um die Kamera zentriert
  gl.depthMask(false);
  setOffset(0);
  Mat4.compose(tempModelMat, cam, 0, 0, 0, [1, 1, 1]);
  setModel(tempModelMat, [1, 1, 1, 1], 0.0);
  gl.bindVertexArray(world.skyDomeMesh.vao);
  gl.drawElements(gl.TRIANGLES, world.skyDomeMesh.indexCount, gl.UNSIGNED_INT, 0);
  gl.depthMask(true);

  for (const c of copies) {
    if (!c.on) continue;
    setOffset(c.o);
    const near = (z, r) => z + r > c.zMin && z - r < c.zMax;

    setModel(identityMat, [1, 1, 1, 1], 0.0);
    gl.bindVertexArray(world.valleyMesh.vao);
    gl.drawElements(gl.TRIANGLES, world.valleyMesh.indexCount, gl.UNSIGNED_INT, 0);
    if (!pass.reflect) {
      gl.bindVertexArray(world.waterMesh.vao);
      gl.drawElements(gl.TRIANGLES, world.waterMesh.indexCount, gl.UNSIGNED_INT, 0);
    }


    gl.bindVertexArray(world.cliffHousingMesh.vao);
    for (const ch of world.bankCliffHousings) {
      if (!near(ch.z, 6)) continue;
      Mat4.compose(tempModelMat, [ch.x, ch.y, ch.z], ch.rotY, 0, 0, [ch.sx, ch.sy, ch.sz]);
      setModel(tempModelMat, [0.88, 0.98, 1.14, 1], 0.0);
      gl.drawElements(gl.TRIANGLES, world.cliffHousingMesh.indexCount, gl.UNSIGNED_INT, 0);
    }

    world.floatingPeaks.forEach((pk, idx) => {
      const mm = world.mountainMeshes[pk.variant || 0];
      gl.bindVertexArray(mm.vao);
      if (!near(pk.z, pk.sx + 20)) return;
      if (pk.model) tempModelMat.set(pk.model);
      else Mat4.compose(tempModelMat, [pk.x, pk.y, pk.z], pk.rot || 0, 0, 0, [pk.sx, pk.sy, pk.sz]);
      setModel(tempModelMat, [0.92, 1.0, 1.15, 1], 0.0);
      gl.drawElements(gl.TRIANGLES, mm.indexCount, gl.UNSIGNED_INT, 0);
    });

    setModel(identityMat, [1, 1, 1, 1], 1.0);
    for (const grp of world.instGroups) drawInstancedRange(gl, grp, c.zMin, c.zMax);
  }

  // Tiere und Boot liegen schon in Kamerakoordinaten der aktuellen Runde
  setOffset(0);
  for (const cd of creatureDraws) {
    setModel(cd.model, cd.tint, 0.0);
    gl.uniform4fv(u.uAnim, cd.anim);
    gl.bindVertexArray(cd.mesh.vao);
    gl.drawElements(gl.TRIANGLES, cd.mesh.indexCount, gl.UNSIGNED_INT, 0);
  }
  // Fell: dieselben Tiere noch einmal als Schichten nach außen (Shell-Technik). Die Haare sind ausgestanzt,
  // ihre Ränder werden über die Kantenglättung (Alpha to Coverage) weich
  if (!pass.reflect) {
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    for (const cd of creatureDraws) {
      if (!cd.fur) continue;
      setModel(cd.model, cd.tint, 0.0);
      gl.uniform4fv(u.uAnim, cd.anim);
      gl.bindVertexArray(cd.mesh.vao);
      for (let i = 1; i <= cd.shells; i++) {
        gl.uniform2f(u.uShell, i / cd.shells, cd.fur);
        gl.drawElements(gl.TRIANGLES, cd.mesh.indexCount, gl.UNSIGNED_INT, 0);
      }
    }
    gl.uniform2f(u.uShell, 0, 0);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
  }
  gl.uniform4f(u.uAnim, 0, 0, 0, 0);
  // gebackene Figuren (figures.js) mit eigenem Skinning-Shader
  drawFigures(pass, vp, cam);
  if (boat.mesh && boat.tex) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, boat.tex);
    gl.uniform1i(u.uBoatTex, 1);
    gl.activeTexture(gl.TEXTURE0);
    setModel(boat.model, [1, 1, 1, 1], 0.0);
    gl.bindVertexArray(boat.mesh.vao);
    gl.drawElements(gl.TRIANGLES, boat.mesh.indexCount, gl.UNSIGNED_INT, 0);
  }

  // Leuchtende Effekte, additiv
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.depthMask(false);

  const fu = progFx.u;
  gl.useProgram(progFx.prog);
  gl.uniform3fv(fu.uZoneW, camZone);
  gl.uniformMatrix4fv(fu.uViewProj, false, vp);
  gl.uniform1f(fu.uTime, state.time);
  gl.uniform3fv(fu.uCamPos, cam);
  for (const c of copies) {
    if (!c.on) continue;
    offsetVec[2] = c.o;
    gl.uniform3fv(fu.uOffset, offsetVec);
    const near = (z, r) => z + r > c.zMin && z - r < c.zMax;

    gl.bindVertexArray(world.waterfallMesh.vao);
    for (const wf of world.waterfalls) {
      if (!near(wf.z, 10)) continue;
      let y = wf.y, sy = wf.sy;
      if (wf.isSkyFall) {
        sy = Math.max(0.5, wf.sy);
      }
      Mat4.compose(tempModelMat, [wf.x, y, wf.z], wf.rotY, 0, 0, [wf.sx, sy, wf.sz]);
      gl.uniformMatrix4fv(fu.uModel, false, tempModelMat);
      gl.uniform4f(fu.uTint, 0.35, 0.92, 1.0, 1.0);
      gl.drawElements(gl.TRIANGLES, world.waterfallMesh.indexCount, gl.UNSIGNED_INT, 0);
    }

    if (!pass.reflect) {
      gl.bindVertexArray(world.plungeRippleMesh.vao);
      for (const rp of world.plungeRipples) {
        if (!near(rp.z, 5)) continue;
        Mat4.compose(tempModelMat, [rp.x, rp.y, rp.z], 0, 0, 0, [rp.sx, 1.0, rp.sz]);
        gl.uniformMatrix4fv(fu.uModel, false, tempModelMat);
        gl.uniform4f(fu.uTint, 0.3, 0.92, 1.0, 1.0);
        gl.drawElements(gl.TRIANGLES, world.plungeRippleMesh.indexCount, gl.UNSIGNED_INT, 0);
      }
      for (const r of rippleDraws) {
        if (c.o !== 0) continue;
        Mat4.compose(tempModelMat, [r.x, 0.03, r.z], 0, 0, 0, [1.6, 1.0, 1.6]);
        gl.uniformMatrix4fv(fu.uModel, false, tempModelMat);
        gl.uniform4f(fu.uTint, 1, 1, 1, Math.max(0, Math.min(1, r.a)));
        gl.drawElements(gl.TRIANGLES, world.plungeRippleMesh.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(world.shaftMesh.vao);
      for (const sh of world.lightShafts) {
        if (!near(sh.z, 8)) continue;
        gl.uniformMatrix4fv(fu.uModel, false, sh.model);
        gl.uniform4fv(fu.uTint, sh.color);
        gl.drawElements(gl.TRIANGLES, world.shaftMesh.indexCount, gl.UNSIGNED_INT, 0);
      }
    }
  }

  // Leuchtpunkte am Boden
  const du = progGlowDots.u;
  gl.useProgram(progGlowDots.prog);
  gl.uniformMatrix4fv(du.uViewProj, false, vp);
  gl.uniform1f(du.uTime, state.time);
  gl.uniform3fv(du.uCamPos, cam);
  gl.uniform3fv(du.uRidePos, ridePos);
  gl.uniform1f(du.uPixelRatio, pixelRatio * (pass.reflect ? 0.5 : 1.0));
  gl.uniform1f(du.uMirror, pass.reflect ? 1.0 : 0.0);
  gl.bindVertexArray(world.dotVao);
  for (const c of copies) {
    if (!c.on) continue;
    offsetVec[2] = c.o;
    gl.uniform3fv(du.uOffset, offsetVec);
    const first = lowerIndex(world.dotZ, c.zMax);
    const last = lowerIndex(world.dotZ, c.zMin);
    if (last > first) gl.drawArrays(gl.POINTS, first, last - first);
  }

  // Glühwürmchen
  const pu = progParticles.u;
  gl.useProgram(progParticles.prog);
  gl.uniformMatrix4fv(pu.uViewProj, false, vp);
  gl.uniform1f(pu.uTime, state.time);
  gl.uniform3fv(pu.uCamPos, cam);
  gl.uniform3fv(pu.uRidePos, ridePos);
  gl.uniform1f(pu.uLoop, LOOP_LENGTH);
  gl.uniform1f(pu.uPixelRatio, pixelRatio * (pass.reflect ? 0.5 : 1.0));
  gl.bindVertexArray(world.particleVao);
  gl.drawArrays(gl.POINTS, 0, world.particleCount);

  // Wolkenschleier unter den Schwebefelsen
  // farbiger Nebel über den Pilzhüten, nur im Pilzwald
  if (!pass.reflect && camZone[1] > 0.02) {
    const su = progDust.u;
    gl.useProgram(progDust.prog);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(su.uViewProj, false, vp);
    gl.uniform3fv(su.uCamPos, cam);
    gl.uniform1f(su.uViewH, viewH);
    gl.uniform1f(su.uFade, camZone[1]);
    gl.bindVertexArray(world.mistVao);
    gl.uniform3f(su.uColor, 0.55, 0.18, 0.85);
    gl.drawArrays(gl.POINTS, 0, world.mistViolet);
    gl.uniform3f(su.uColor, 0.08, 0.55, 0.7);
    gl.drawArrays(gl.POINTS, world.mistViolet, world.mistTeal);
  }
  // nur in der offenen Ebene, beim Übergang ausgeblendet (sonst leuchten sie weiß in die Nacht des Pilzwalds)
  if (!pass.reflect && world.cloudCount > 0 && camZone[2] > 0.02) {
    const su = progDust.u;
    gl.useProgram(progDust.prog);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(su.uViewProj, false, vp);
    gl.uniform3fv(su.uCamPos, cam);
    gl.uniform1f(su.uViewH, viewH);
    gl.uniform3f(su.uColor, 0.95, 0.96, 1.0);
    gl.uniform1f(su.uFade, camZone[2]);
    gl.bindVertexArray(world.cloudVao);
    gl.drawArrays(gl.POINTS, 0, world.cloudCount);
  }
  // Staubwolken mit normaler Mischung (verdecken, statt aufzuhellen)
  if (!pass.reflect && dustCount > 0) {
    const su = progDust.u;
    gl.useProgram(progDust.prog);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(su.uViewProj, false, vp);
    gl.uniform3fv(su.uCamPos, cam);
    gl.uniform1f(su.uViewH, viewH);
    gl.uniform3f(su.uColor, 0.42, 0.33, 0.21);
    gl.uniform1f(su.uFade, 1.0);
    gl.bindVertexArray(dustVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dustData.subarray(0, dustCount * 5));
    gl.drawArrays(gl.POINTS, 0, dustCount);
  }

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function fullscreenPass(fbo, w, h) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, w, h);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// Szenen (siehe SCENES in world.js): Boot bremst ab, Kamera richtet sich fest auf das Geschehen
const scene = { idx: -1, t: 0, lap: -1, done: SCENES.map(() => false), speed: 1.0, zoom: 0.0 };
function updateScene(dt) {
  const lap = Math.floor(state.travelDist / LOOP_LENGTH);
  if (lap !== scene.lap) { scene.lap = lap; scene.done.fill(false); }
  const zNow = -(((state.travelDist % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH);
  if (scene.idx < 0) {
    SCENES.forEach((sc, i) => {
      if (scene.idx >= 0 || scene.done[i]) return;
      const d = aheadDist(zNow, sc.z);
      if (d > 0 && d < sc.trigger) { scene.idx = i; scene.t = debugSceneT; scene.done[i] = true; debugSceneT = 0; }
    });
  } else {
    scene.t += dt;
    if (scene.t > SCENES[scene.idx].dur) scene.idx = -1;
  }
  const slow = scene.idx >= 0 && scene.t < SCENES[scene.idx].dur - 1.5;
  scene.speed += ((slow ? SCENES[scene.idx].slow : 1.0) - scene.speed) * (1.0 - Math.exp(-dt * 1.2));
  // langsames Heranzoomen während der Szene
  const zoomTarget = slow && scene.t > 1.0 ? SCENES[scene.idx].zoom : 0.0;
  scene.zoom += (zoomTarget - scene.zoom) * (1.0 - Math.exp(-dt * (snapFrames > 0 ? 50.0 : zoomTarget < scene.zoom ? 1.6 : 0.7)));
}

function render(now) {
  const dt = Math.min((now - state.lastFrame) * 0.001, 0.05);
  state.lastFrame = now;
  if (state.running) {
    state.time += dt;
    updateScene(dt);
    state.travelDist += dt * 4.6 * scene.speed;
  }

  const zMod = ((state.travelDist % LOOP_LENGTH) + LOOP_LENGTH) % LOOP_LENGTH;
  const zCur = -zMod;
  zoneWeights(zCur, camZone);
  updateChapterLabel(camZone);

  // Boot folgt dem Fluss, pendelt leicht hin und her
  const t = state.time;
  const bx = riverCenterX(zCur) + Math.sin(t * 0.21) * 0.9;
  const heading = Math.atan2(riverSlopeX(zCur - 3.0) + Math.cos(t * 0.21) * 0.04, 1.0);
  placeBoat(bx, zCur, heading, t, camEye);
  boatHeading = heading;
  // kurzes Ducken der Kamera (Fledermausschwarm), wirkt nach dem Aufruf der Tiere im nächsten Bild
  ridePos[0] = bx; ridePos[1] = 1.2; ridePos[2] = zCur;
  updateCreatures(zCur, t, scene.idx, scene.t, camEye);
  updateFigures(dt);
  updateAudio(camZone, sceneGrowl);

  // Blick: sanftes Umherschauen, dazu Hinwenden zu Tieren und Sehenswürdigkeiten
  // im Nebelwald bleibt der Blick zwischen den Szenen in der Mitte (Wasserfall rechts, Wolf links, Schloss rechts)
  let tYaw = (Math.sin(t * 0.11) * 0.55 + Math.sin(t * 0.27 + 1.3) * 0.25 + 0.12) * (1.0 - camZone[0] * 0.85);
  let tPitch = 0.06 + Math.sin(t * 0.15 + 0.5) * 0.08;
  let best = null, bestScore = 0;
  const consider = (p) => {
    const dx = p.x - camEye[0], dy = p.y - camEye[1], dz = p.z - camEye[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 4 || dist > 75) return;
    const rel = wrapAngle(Math.atan2(-dx, -dz) - heading);
    if (Math.abs(rel) > 1.5) return;
    const score = p.w / (1.0 + dist * 0.04) * (1.0 - Math.abs(rel) * 0.3);
    if (score > bestScore) { bestScore = score; best = { rel, pitch: Math.atan2(dy, dist) }; }
  };
  pois.forEach(consider);
  for (const p of staticPois) {
    const d = aheadDist(zCur, p.z);
    // kurzer Blick: nur in einem schmalen Fenster vor dem Wasserfall bzw. Felsen
    if (d > 9 && d < (p.sky ? 80 : 30)) consider({ x: p.x, y: p.y, z: zCur - d, w: p.w });
  }
  if (best) {
    tYaw = best.rel;
    tPitch = Math.max(-0.35, Math.min(0.75, best.pitch));
  }
  // während einer Szene: Blick fest auf das Geschehen
  if (sceneFocusOn) {
    const dx = sceneFocus[0] - camEye[0], dy = sceneFocus[1] - camEye[1], dz = sceneFocus[2] - camEye[2];
    // höchstens etwa 75 Grad zur Seite, sonst käme das Boot ins Bild
    tYaw = Math.max(-1.3, Math.min(1.3, wrapAngle(Math.atan2(-dx, -dz) - heading)));
    tPitch = Math.max(-0.4, Math.min(0.9, Math.atan2(dy, Math.hypot(dx, dz))));
  }
  // bei Testsprüngen (#t=...) rastet der Blick in den ersten Bildern sofort ein
  // nach einer Szene schwenkt der Blick zügig wieder nach vorn
  if (sceneFocusOn) gaze.release = 3.0; else gaze.release = Math.max(0, (gaze.release || 0) - dt);
  const rate = sceneFocusOn ? 2.2 : gaze.release > 0 ? 2.0 : best ? 1.3 : 0.6;
  const ease = snapFrames-- > 0 ? 1.0 : 1.0 - Math.exp(-dt * rate);
  gaze.yaw += wrapAngle(tYaw - gaze.yaw) * ease;
  gaze.pitch += (tPitch - gaze.pitch) * ease;
  // eigener Blick klingt nach 2,5 Sekunden ohne Bewegung wieder ab
  look.idle += dt;
  if (!look.dragging && look.idle > 2.5) {
    const k = 1.0 - Math.exp(-dt * 0.8);
    look.yaw -= look.yaw * k;
    look.pitch -= look.pitch * k;
  }
  const yaw = heading + gaze.yaw + look.yaw;
  camEye[1] -= sceneDuck * 0.5;
  // Aufstehen (+0.55) und ein kleiner Schritt nach hinten im Boot (weiter ginge nicht, dort steht die Heckschnecke)
  camEye[0] += Math.sin(heading) * sceneStand * 0.55;
  camEye[1] += sceneStand * 0.55;
  camEye[2] += Math.cos(heading) * sceneStand * 0.55;
  const pitch = Math.max(-0.8, Math.min(1.0, gaze.pitch + look.pitch - sceneDuck * 0.12 - sceneStand * 0.32));
  camTarget[0] = camEye[0] - Math.sin(yaw) * Math.cos(pitch) * 10.0;
  camTarget[1] = camEye[1] + Math.sin(pitch) * 10.0;
  camTarget[2] = camEye[2] - Math.cos(yaw) * Math.cos(pitch) * 10.0;
  camMirror[0] = camEye[0];
  camMirror[1] = -camEye[1];
  camMirror[2] = camEye[2];

  const aspect = canvas.width / Math.max(canvas.height, 1);
  const fovDeg = ((aspect < 1 ? 74 : 62) - 26 * scene.zoom);
  viewH = canvas.height / (2.0 * Math.tan((fovDeg * Math.PI) / 360));
  Mat4.perspective(projMat, (fovDeg * Math.PI) / 180, aspect, 0.1, FAR + 40.0);
  Mat4.lookAt(viewMat, camEye, camTarget, [0, 1, 0]);
  Mat4.multiply(viewProjMat, projMat, viewMat);
  Mat4.multiply(reflViewProj, viewProjMat, mirrorMat);
  updateCopies(zCur);

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(zoneMix(0.07, 0.010, 0.58), zoneMix(0.08, 0.026, 0.66), zoneMix(0.10, 0.055, 0.9), 1.0);

  // 1. Spiegelbild für den Fluss
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.reflFbo);
  gl.viewport(0, 0, rt.rw, rt.rh);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawScene({ reflect: true });

  // 2. Szene (mit Kantenglättung), danach auflösen
  gl.bindFramebuffer(gl.FRAMEBUFFER, rt.msFbo);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, rt.reflTex);
  drawScene({ reflect: false });
  if (rt.msFbo !== rt.sceneFbo) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rt.msFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rt.sceneFbo);
    gl.blitFramebuffer(0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  gl.disable(gl.DEPTH_TEST);

  // 3. Bloom: verkleinern ...
  gl.useProgram(progBloomDown.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(progBloomDown.u.uTex, 0);
  let srcTex = rt.sceneTex, srcW = canvas.width, srcH = canvas.height;
  rt.bloom.forEach((lv, i) => {
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform2f(progBloomDown.u.uTexel, 1.0 / srcW, 1.0 / srcH);
    gl.uniform1f(progBloomDown.u.uPrefilter, i === 0 ? 1.0 : 0.0);
    gl.uniform1f(progBloomDown.u.uThreshold, zoneMix(0.3, 0.35, 1.6));
    fullscreenPass(lv.fbo, lv.w, lv.h);
    srcTex = lv.tex; srcW = lv.w; srcH = lv.h;
  });
  // ... und schrittweise wieder vergrößern, jede Stufe additiv auf die nächstgrößere
  gl.useProgram(progBloomUp.prog);
  gl.uniform1i(progBloomUp.u.uTex, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = rt.bloom.length - 1; i > 0; i--) {
    const src = rt.bloom[i], dst = rt.bloom[i - 1];
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform2f(progBloomUp.u.uTexel, 1.0 / src.w, 1.0 / src.h);
    gl.uniform1f(progBloomUp.u.uWeight, 0.9);
    fullscreenPass(dst.fbo, dst.w, dst.h);
  }
  gl.disable(gl.BLEND);

  // 4. Zusammensetzen, Tonemapping, Vignette
  gl.useProgram(progComposite.prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, rt.sceneTex);
  gl.uniform1i(progComposite.u.uSceneTex, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, rt.bloom[0].tex);
  gl.uniform1i(progComposite.u.uBloomTex, 1);
  gl.uniform1f(progComposite.u.uTime, state.time);
  gl.uniform2f(progComposite.u.uScreen, canvas.width, canvas.height);
  gl.uniform1f(progComposite.u.uExposure, zoneMix(1.5, 1.6, 0.8));
  // Lichtstrahlen: im Nebelwald vom gelben Mond, auf der Ebene schwächer von der Sonne
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, rt.bloom[Math.min(1, rt.bloom.length - 1)].tex);
  gl.uniform1i(progComposite.u.uRayTex, 2);
  {
    const L = camZone[2] > camZone[0] ? SUN_C_DIR : MOON_A;
    const p = [camEye[0] + L[0] * 1000, camEye[1] + L[1] * 1000, camEye[2] + L[2] * 1000, 1];
    const m = viewProjMat;
    const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    let w = 0;
    if (cw > 0) {
      const sx = cx / cw * 0.5 + 0.5, sy = cy / cw * 0.5 + 0.5;
      // ausblenden, wenn die Quelle weit außerhalb des Bildes liegt
      const off = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
      w = Math.max(0, 1 - Math.max(0, off - 0.5) / 0.5);
      gl.uniform2f(progComposite.u.uRayUV, sx, sy);
    }
    w *= camZone[2] * 0.8; // nur die Sonne über der Ebene (im Nebelwald wirkte der Mond sonst wie eine Sonne)
    gl.uniform1f(progComposite.u.uRayW, w);
    gl.uniform3fv(progComposite.u.uRayCol, camZone[2] > camZone[0] ? [1.0, 0.92, 0.75] : [0.95, 0.8, 0.5]);
  }
  gl.uniform1f(progComposite.u.uGrain, zoneMix(0.05, 0.035, 0.02));
  // Hitzeflimmern über der fernen Ebene: Bildschirmhöhe des Horizonts in Blickrichtung
  {
    const fx = camTarget[0] - camEye[0], fz = camTarget[2] - camEye[2], fl = Math.hypot(fx, fz) || 1;
    const p = [camEye[0] + fx / fl * 2000, camEye[1], camEye[2] + fz / fl * 2000];
    const m = viewProjMat;
    const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    gl.uniform1f(progComposite.u.uHorizon, cw > 0 ? cy / cw * 0.5 + 0.5 : -1);
    gl.uniform1f(progComposite.u.uHeat, camZone[2]);
  }
  fullscreenPass(null, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0);

  gl.bindVertexArray(null);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
