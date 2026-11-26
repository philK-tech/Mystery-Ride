// boat.js: Das Boot (Modell aus assets/boat.glb, beim Build eingebettet)
// Das Modell ist entlang z ausgerichtet, y zeigt nach oben, Länge 2 Einheiten.
// Es wird im Hintergrund entpackt; bis es fertig ist, fährt die Kamera ohne Boot.
const BOAT_SCALE = [2.9, 2.5, 4.2]; // länger gestreckt, damit der Bug weiter weg und niedriger im Bild ist
const BOAT_WATERLINE = -0.47;   // Höhe der Wasserlinie im Modell
const BOAT_SEAT = [0.17, -0.23, 0.55]; // Augenposition im Modell: Höhe der Bordwand, seitlich, hinterer Sitz
const boat = { mesh: null, tex: null, model: Mat4.create() };

(async () => {
  try {
    if (typeof DecompressionStream === "undefined") return;
    const bytes = Uint8Array.from(atob(__ASSET__("boat-mesh")), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buf = await new Response(stream).arrayBuffer();
    const head = new Float32Array(buf, 0, 6);
    const counts = new Uint32Array(buf, 24, 2);
    const n = counts[0], ni = counts[1];
    const qp = new Uint16Array(buf, 32, n * 3);
    const qu = new Uint16Array(buf, 32 + n * 6, n * 2);
    const qi = new Uint16Array(buf, 32 + n * 10, ni);

    const b = createGeometryBuilder();
    for (let i = 0; i < n; i++) {
      const p = [0, 1, 2].map((k) => head[k] + (qp[i * 3 + k] / 65535) * (head[3 + k] - head[k]));
      // Abdunklung im Rumpfinneren und am Kiel
      const ao = clamp01(0.45 + (p[1] + 0.64) * 0.9);
      b.pushVertex(p[0], p[1], p[2], 0, 1, 0, qu[i * 2] / 65535, qu[i * 2 + 1] / 65535, ao, 0.0, 0.0, 20);
    }
    b.indices = Array.from(qi);
    b.computeSmoothNormals();
    boat.mesh = uploadStaticMesh(gl, b);

    const img = new Image();
    img.src = "data:image/jpeg;base64," + __ASSET__("boat-texture");
    await img.decode();
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const aniso = gl.getExtension("EXT_texture_filter_anisotropic");
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    boat.tex = tex;
  } catch (e) {
    console.warn("Boot konnte nicht geladen werden:", e);
  }
})();

// Stellt das Boot an Position (x, z) auf die Wasseroberfläche, mit Kurs yaw und leichtem Schaukeln.
// Gibt die Augenposition in Weltkoordinaten in eyeOut zurück.
function placeBoat(x, z, yaw, t, eyeOut) {
  // Schütteln durch die Tentakel-Szene (sceneShake aus creatures.js, 0..1)
  const sh = typeof sceneShake === "number" ? sceneShake : 0.0;
  const pitch = Math.sin(t * 0.9) * 0.025 + Math.sin(t * 2.3) * 0.008 + Math.sin(t * 11.0) * 0.03 * sh;
  const rock = typeof sceneRock === "number" ? sceneRock : 0.0;
  const roll = Math.sin(t * 0.7 + 1.0) * 0.035 + Math.sin(t * 1.9) * 0.01 + Math.sin(t * 8.3 + 1.0) * 0.07 * sh + rock * 0.12;
  const y = -BOAT_WATERLINE * BOAT_SCALE[1] + Math.sin(t * 1.3) * 0.04;
  Mat4.compose(boat.model, [x, y, z], yaw, pitch, roll, BOAT_SCALE);
  const m = boat.model;
  const [sx, sy, sz] = BOAT_SEAT;
  eyeOut[0] = m[0] * sx + m[4] * sy + m[8] * sz + m[12];
  eyeOut[1] = m[1] * sx + m[5] * sy + m[9] * sz + m[13] + 1.2;
  eyeOut[2] = m[2] * sx + m[6] * sy + m[10] * sz + m[14];
  return roll;
}
