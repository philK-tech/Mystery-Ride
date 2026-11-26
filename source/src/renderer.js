// renderer.js: Fullscreen-Quad, Render-Targets und Canvas-Größe
// Fullscreen quad for post-processing
const quadVao = gl.createVertexArray();
gl.bindVertexArray(quadVao);
const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

// HDR, wenn der Browser in Fließkomma-Texturen rendern kann, sonst 8 Bit
const hdrOk = !!gl.getExtension("EXT_color_buffer_float");
const COLOR_FMT = hdrOk ? gl.RGBA16F : gl.RGBA8;
const COLOR_TYPE = hdrOk ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
const MSAA = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
const BLOOM_LEVELS = 6;

function makeColorTex(w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, COLOR_FMT, w, h, 0, gl.RGBA, COLOR_TYPE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
function makeFbo(tex, depthRb) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
  return fbo;
}
function makeDepth(w, h, samples) {
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  else gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  return rb;
}

// rt.msFbo: Szene mit Kantenglättung, wird in rt.sceneTex aufgelöst
// rt.reflTex: Spiegelbild für den Fluss in halber Auflösung
// rt.bloom: Kette immer kleinerer Texturen für den Bloom
let rt = null;
let rtWidth = 0, rtHeight = 0;

function ensureRenderTargets(w, h) {
  if (w === rtWidth && h === rtHeight) return;
  rtWidth = w;
  rtHeight = h;
  if (rt) {
    rt.textures.forEach((t) => gl.deleteTexture(t));
    rt.renderbuffers.forEach((r) => gl.deleteRenderbuffer(r));
    rt.fbos.forEach((f) => gl.deleteFramebuffer(f));
  }
  const textures = [], renderbuffers = [], fbos = [];

  const sceneTex = makeColorTex(w, h);
  const sceneFbo = makeFbo(sceneTex, null);
  let msFbo = sceneFbo;
  if (MSAA > 1) {
    const msColor = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, MSAA, COLOR_FMT, w, h);
    const msDepth = makeDepth(w, h, MSAA);
    msFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
    renderbuffers.push(msColor, msDepth);
    fbos.push(msFbo);
  } else {
    const depth = makeDepth(w, h, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    renderbuffers.push(depth);
  }
  textures.push(sceneTex);
  fbos.push(sceneFbo);

  const rw = Math.max(1, w >> 1), rh = Math.max(1, h >> 1);
  const reflTex = makeColorTex(rw, rh);
  const reflDepth = makeDepth(rw, rh, 0);
  const reflFbo = makeFbo(reflTex, reflDepth);
  textures.push(reflTex);
  renderbuffers.push(reflDepth);
  fbos.push(reflFbo);

  const bloom = [];
  let bw = w, bh = h;
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    bw = Math.max(1, bw >> 1);
    bh = Math.max(1, bh >> 1);
    const tex = makeColorTex(bw, bh);
    const fbo = makeFbo(tex, null);
    textures.push(tex);
    fbos.push(fbo);
    bloom.push({ tex, fbo, w: bw, h: bh });
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  rt = { sceneTex, sceneFbo, msFbo, reflTex, reflFbo, rw, rh, bloom, textures, renderbuffers, fbos };
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.0);
  const w = Math.max(320, Math.floor(window.innerWidth * dpr));
  const h = Math.max(200, Math.floor(window.innerHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ensureRenderTargets(canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
