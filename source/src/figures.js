// figures.js: gebackene, animierte Figuren (Held und Monster aus "The Ninth Vigil", MIT, iamlukethedev)
// Die Figuren werden einmalig mit tools/vigil-bake aus dem Vigil-Kit gebacken (Format VFG1, siehe dort)
// und hier ohne three.js abgespielt: Skinning im Vertex-Shader, Licht und Nebel aus FS_OPAQUE (Material 40).
//
// Benutzung (z. B. in creatures.js oder einer Szene):
//   const f = spawnFigure('skeleton', { x, y, z, yaw, scale: 1 });   // gibt sofort ein Objekt zurück
//   f.play('alert', 0.25);       // Clip mit Überblendzeit in Sekunden; nicht schleifende Clips bleiben am Ende stehen
//   f.x = ...; f.yaw = ...; f.visible = false;
//   f.clipNames                  // verfügbare Clips, sobald die Figur geladen ist (f.ready)
//   removeFigure(f);
// Die Uhr läuft über updateFigures(dt) in main.js, gezeichnet wird in drawFigures(...) innerhalb von drawScene.

const FIGURE_ASSETS = {
  skeleton: () => __ASSET__("fig-skeleton"),
  cultist: () => __ASSET__("fig-cultist"),
  wraith: () => __ASSET__("fig-wraith"),
  boss: () => __ASSET__("fig-boss"),
  hellhound: () => __ASSET__("fig-hellhound"),
  hero: () => __ASSET__("fig-hero"),
};

const VS_SKIN = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;       // 0..1, quantisiert zwischen uQMin und uQMin + uQSize
layout(location = 1) in vec3 aNormal;
layout(location = 3) in vec4 aColor;     // sRGB-Grundfarbe, Alpha = Leuchtmaske
layout(location = 6) in uvec4 aJoints;
layout(location = 7) in vec4 aWeights;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uOffset;
uniform vec4 uTint;
uniform vec3 uQMin;
uniform vec3 uQSize;
uniform vec4 uBones[96];                 // bis 32 Knochen, je 3 Zeilen einer 3x4-Matrix

out vec3 vWorldPos;
out vec3 vLocalPos;
out vec3 vObjPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vExtra;
out vec4 vTint;
out float vMatId;
out float vSeed;

mat4 boneMat(uint i) {
  vec4 r0 = uBones[i * 3u], r1 = uBones[i * 3u + 1u], r2 = uBones[i * 3u + 2u];
  return mat4(vec4(r0.x, r1.x, r2.x, 0.0), vec4(r0.y, r1.y, r2.y, 0.0), vec4(r0.z, r1.z, r2.z, 0.0), vec4(r0.w, r1.w, r2.w, 1.0));
}

void main() {
  vec3 p = uQMin + aPos * uQSize;
  mat4 skin = boneMat(aJoints.x) * aWeights.x + boneMat(aJoints.y) * aWeights.y
            + boneMat(aJoints.z) * aWeights.z + boneMat(aJoints.w) * aWeights.w;
  vec4 sp = skin * vec4(p, 1.0);
  vec3 sn = mat3(skin) * aNormal;
  vec4 wp = uModel * sp;
  vLocalPos = wp.xyz;
  vObjPos = p;
  vWorldPos = wp.xyz + uOffset;
  vNormal = normalize(mat3(uModel) * sn);
  vUv = vec2(aColor.a, 0.0);
  vExtra = aColor.rgb;
  vTint = uTint;
  vMatId = 40.0;
  vSeed = fract(uModel[3].x * 0.137 + uModel[3].z * 0.071);
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}`;

let progSkin = null;
const figureData = new Map();     // Name -> { vao, count, idx32, head, clips } oder Promise
const figureInstances = [];

function parseVfg(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 86 || u8[1] !== 70 || u8[2] !== 71 || u8[3] !== 49) throw new Error("kein VFG1");
  const jl = new DataView(buf).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  const base = 8 + Math.ceil(jl / 4) * 4;
  const sec = (s) => buf.slice(base + head.sections[s][0], base + head.sections[s][0] + head.sections[s][1]);
  const clips = {};
  for (const c of head.clips) {
    const n = c.frames * head.bones * 12;
    const half = new Uint16Array(buf, base + c.off, n);
    const f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = halfToFloat(half[i]);
    clips[c.name] = { fps: c.fps, frames: c.frames, loop: c.loop, data: f, dur: (c.frames - (c.loop ? 0 : 1)) / c.fps };
  }
  return { head, pos: sec("pos"), nrm: sec("nrm"), col: sec("col"), skin: sec("skin"), idx: sec("idx"), clips };
}

function halfToFloat(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
}

function uploadFigure(d) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
  buf(d.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 6, 0);
  buf(d.nrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.BYTE, true, 4, 0);
  buf(d.col); gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 4, 0);
  buf(d.skin);
  gl.enableVertexAttribArray(6); gl.vertexAttribIPointer(6, 4, gl.UNSIGNED_BYTE, 8, 0);
  gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 4, gl.UNSIGNED_BYTE, true, 8, 4);
  // nicht benutzte Eingänge auf feste Werte, damit nichts aus anderen Puffern gelesen wird
  for (const loc of [2, 4, 5, 8, 9]) gl.disableVertexAttribArray(loc);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const h = d.head;
  return {
    vao, count: h.ni, idx32: h.idx32, head: h, clips: d.clips,
    qmin: h.bmin, qsize: [h.bmax[0] - h.bmin[0], h.bmax[1] - h.bmin[1], h.bmax[2] - h.bmin[2]],
  };
}

function loadFigure(name) {
  if (figureData.has(name)) return figureData.get(name);
  const p = (async () => {
    if (typeof DecompressionStream === "undefined") throw new Error("DecompressionStream fehlt");
    const bytes = Uint8Array.from(atob(FIGURE_ASSETS[name]()), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    const fig = uploadFigure(parseVfg(buf));
    figureData.set(name, fig);
    return fig;
  })();
  p.catch((e) => console.warn("Figur " + name + " konnte nicht geladen werden:", e));
  figureData.set(name, p);
  return p;
}

// Eine Figur in der Welt. Animation: aktueller Clip mit Zeit, dazu der vorherige Clip zum Überblenden.
function spawnFigure(name, o = {}) {
  const f = {
    name, x: o.x || 0, y: o.y || 0, z: o.z || 0, yaw: o.yaw || 0, scale: o.scale || 1,
    tint: o.tint || [1, 1, 1, 1], visible: o.visible !== false, ready: false, fig: null,
    clip: o.clip || "idle", t: 0, prev: null, pt: 0, fade: 0, fadeDur: 0, speed: 1,
    clipNames: [], bones: new Float32Array(96 * 4),
    play(clip, fade = 0.2, speed = 1) {
      if (this.fig && !this.fig.clips[clip]) return false;
      if (clip === this.clip && this.fade >= this.fadeDur) { this.speed = speed; return true; }
      this.prev = this.clip; this.pt = this.t; this.clip = clip; this.t = 0;
      this.fade = 0; this.fadeDur = Math.max(0.0001, fade); this.speed = speed;
      return true;
    },
    clipDone() { const c = this.fig && this.fig.clips[this.clip]; return !!c && !c.loop && this.t >= c.dur; },
  };
  loadFigure(name).then((fig) => { f.fig = fig; f.ready = true; f.clipNames = Object.keys(fig.clips); if (!fig.clips[f.clip]) f.clip = f.clipNames[0]; });
  figureInstances.push(f);
  return f;
}

function removeFigure(f) {
  const i = figureInstances.indexOf(f);
  if (i >= 0) figureInstances.splice(i, 1);
}

// Knochenmatrizen eines Clips zur Zeit t in out (3 vec4 je Knochen), gewichtet mit w addieren
function sampleClip(fig, clipName, t, w, out) {
  const c = fig.clips[clipName];
  if (!c) return;
  const B = fig.head.bones, n = c.frames;
  let ft = t * c.fps;
  if (c.loop) ft = ((ft % n) + n) % n; else ft = Math.min(Math.max(ft, 0), n - 1);
  const f0 = Math.floor(ft), f1 = c.loop ? (f0 + 1) % n : Math.min(f0 + 1, n - 1), a = ft - f0;
  const d = c.data, o0 = f0 * B * 12, o1 = f1 * B * 12;
  for (let i = 0; i < B * 12; i++) out[i] += (d[o0 + i] * (1 - a) + d[o1 + i] * a) * w;
}

function updateFigures(dt) {
  for (const f of figureInstances) {
    f.t += dt * f.speed;
    if (f.prev) f.pt += dt;
    if (f.fade < f.fadeDur) f.fade += dt;
    if (!f.fig) continue;
    f.bones.fill(0);
    const k = f.prev ? Math.min(1, f.fade / f.fadeDur) : 1;
    sampleClip(f.fig, f.clip, f.t, k, f.bones);
    if (f.prev && k < 1) sampleClip(f.fig, f.prev, f.pt, 1 - k, f.bones);
    else f.prev = null;
  }
}

const _figModel = new Float32Array(16);
// innerhalb von drawScene aufrufen; übernimmt dieselben Szenen-Uniforms wie progOpaque
function drawFigures(pass, vp, cam) {
  if (!figureInstances.length) return;
  if (!progSkin) progSkin = createProgram(gl, VS_SKIN, FS_OPAQUE);
  const u = progSkin.u;
  gl.useProgram(progSkin.prog);
  gl.uniform3fv(u.uZoneW, camZone);
  gl.uniformMatrix4fv(u.uViewProj, false, vp);
  gl.uniform1f(u.uTime, state.time);
  gl.uniform3fv(u.uCamPos, cam);
  gl.uniform3fv(u.uRidePos, ridePos);
  gl.uniform4f(u.uBoat, ridePos[0], ridePos[2], boatHeading, 0.0);
  gl.uniform1f(u.uClip, pass.reflect ? 1.0 : 0.0);
  gl.uniform2f(u.uScreen, canvas.width, canvas.height);
  gl.uniform3f(u.uOffset, 0, 0, 0);
  for (const f of figureInstances) {
    if (!f.visible || !f.fig) continue;
    Mat4.compose(_figModel, [f.x, f.y, f.z], f.yaw, 0, 0, [f.scale, f.scale, f.scale]);
    gl.uniformMatrix4fv(u.uModel, false, _figModel);
    gl.uniform4fv(u.uTint, f.tint);
    gl.uniform3fv(u.uQMin, f.fig.qmin);
    gl.uniform3fv(u.uQSize, f.fig.qsize);
    gl.uniform4fv(u.uBones, f.bones);
    gl.bindVertexArray(f.fig.vao);
    gl.drawElements(gl.TRIANGLES, f.fig.count, f.fig.idx32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }
  gl.bindVertexArray(null);
  gl.useProgram(progOpaque.prog);
}
