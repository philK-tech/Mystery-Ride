// shaders.js: GLSL-Shader und Programmerstellung
// --- Shaders ---
// Gemeinsamer GLSL-Code: Rauschen, leuchtende Punktmuster, Himmel und Nebel.
// Wird vor die Fragment-Shader gehängt, die ihn brauchen.
// Zonen: Anteile von Nebeltal, Pilzwald und Himmelsinseln an einer Stelle z (wie zoneWeights in math.js)
const GLSL_ZONE = `
const float LOOP_LEN = ` + LOOP_LENGTH.toFixed(1) + `;
const float ZONE_FADE = ` + ZONE_FADE.toFixed(1) + `;

// Anteile der drei Zonen an der Stelle z (wie zoneWeights in math.js)
vec3 zoneWeights(float z) {
  float u = mod(-z, LOOP_LEN) / LOOP_LEN * 3.0;
  float tw = ZONE_FADE / LOOP_LEN * 3.0;
  vec3 w;
  for (int k = 0; k < 3; k++) {
    float fk = float(k), acc = 0.0;
    for (int s = -1; s <= 1; s++) {
      float uu = u + float(s) * 3.0;
      acc += smoothstep(fk - tw, fk + tw, uu) - smoothstep(fk + 1.0 - tw, fk + 1.0 + tw, uu);
    }
    w[k] = clamp(acc, 0.0, 1.0);
  }
  return w / max(w.x + w.y + w.z, 1e-3);
}
`;

const GLSL_COMMON = `
// Anteile der Zonen für die Kamera (Himmel, Nebelfarbe), vom Programm gesetzt
uniform vec3 uZoneW;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
vec3 furHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.04;
    a *= 0.5;
  }
  return v;
}

// Leuchtpunkte: in jeder Zelle eines Gitters sitzt mit Wahrscheinlichkeit 'keep' ein runder Punkt.
// Werden die Punkte kleiner als ein Pixel, wird statt dessen ihr Mittelwert gezeigt (kein Flimmern).
// .x = Helligkeit, .y = Zufallswert der Zelle (für Farbvariation)
vec2 dotField(vec2 p, float r, float keep) {
  vec2 c = floor(p);
  vec2 f = fract(p);
  float h = hash21(c);
  vec2 o = vec2(hash21(c + 17.1), hash21(c + 31.7)) * 0.5 + 0.25;
  float rr = r * (0.55 + 0.9 * hash21(c + 5.3));
  float d = length(f - o);
  float on = step(1.0 - keep, h);
  float dotv = on * smoothstep(rr, rr * 0.2, d);
  float fw = length(fwidth(p));
  float avg = keep * 3.14159 * r * r * 0.45;
  return vec2(mix(dotv, avg, smoothstep(r * 0.6, r * 2.2, fw)), hash21(c + 9.7));
}

// Farbe der Biolumineszenz: überwiegend Türkis und Blau, selten Violett
vec3 bioColor(float h) {
  vec3 c = mix(vec3(0.05, 0.75, 1.0), vec3(0.10, 0.35, 1.0), smoothstep(0.35, 0.75, h));
  return mix(c, vec3(0.75, 0.25, 1.0), step(0.9, h));
}

const vec3 GIANT_DIR = vec3(-0.337, 0.379, -0.862);
const vec3 MOON_DIR = vec3(-0.43, 0.55, -0.72);
` + GLSL_ZONE + `
// Sonnenrichtungen und Lichtfarben der Tagzonen
const vec3 SUN_A = vec3(` + MOON_A.map((v) => v.toFixed(4)).join(', ') + `);   // gelber Mond hinter dem Schloss (Nebelwald)
const vec3 SUN_C = vec3(0.45, 0.72, -0.53);

// Bergkämme für die gemalten Hintergründe: Höhe über dem Horizont je Blickwinkel
float ridge(float az, float freq, float seed, float sharp) {
  float h = 0.0, a = 0.5, f = freq;
  for (int i = 0; i < 5; i++) {
    float n = vnoise(vec2(az * f + seed, seed * 1.7));
    n = 1.0 - abs(n * 2.0 - 1.0);
    h += a * pow(n, sharp);
    a *= 0.5;
    f *= 2.1;
  }
  return h;
}

// Zone 1, Nebelwald: Nacht, schwere Wolkendecke, fahler Mond, dunkle Bergkämme
vec3 skyA(vec3 dir, float t) {
  float el = dir.y;
  float az = atan(dir.x, -dir.z);
  vec3 zen = vec3(0.012, 0.014, 0.022), hor = vec3(0.07, 0.08, 0.10);
  vec3 sky = mix(hor, zen, pow(clamp(el, 0.0, 1.0), 0.5));
  // Mond mit Hof
  float md = max(dot(dir, SUN_A), 0.0);
  float ma = acos(clamp(md, -1.0, 1.0));
  float moon = smoothstep(0.052, 0.048, ma);
  float crater = fbm(dir.xy * 160.0 + dir.z * 90.0);
  sky += vec3(0.75, 0.48, 0.14) * moon * (0.55 + 0.25 * crater) + vec3(0.12, 0.07, 0.02) * pow(md, 400.0) + vec3(0.03, 0.02, 0.008) * pow(md, 20.0);
  // schwere Wolken, am Rand vom Mond angeleuchtet
  vec2 cp = dir.xz / (el + 0.15) * 1.3 + vec2(t * 0.006, t * 0.002);
  float c1 = fbm(cp * 1.2), c2 = fbm(cp * 2.7 + 5.0);
  float cl = smoothstep(0.35, 0.7, c1 * 0.7 + c2 * 0.3);
  vec3 cloudCol = mix(vec3(0.03, 0.035, 0.045), vec3(0.22, 0.2, 0.17), pow(md, 6.0) * (1.0 - cl * 0.5) + c2 * 0.12);
  // vor dem Mond nur dünne Wolkenschleier
  sky = mix(sky, cloudCol, cl * smoothstep(-0.02, 0.12, el) * (1.0 - 0.75 * smoothstep(0.985, 0.999, md)));
  // Bergkämme in zwei Schichten
  float hFar = 0.04 + ridge(az * 0.9, 1.6, 3.0, 3.0) * 0.18;
  if (el < hFar) sky = mix(vec3(0.05, 0.055, 0.07), hor, 0.4 + 0.4 * smoothstep(hFar, 0.0, el));
  float hNear = 0.02 + ridge(az * 1.3, 1.1, 9.0, 1.2) * 0.06 + pow(vnoise(vec2(az * 160.0, 3.0)), 3.0) * 0.03;
  if (el < hNear) sky = mix(vec3(0.015, 0.018, 0.024), hor, 0.25);
  return sky;
}

// Zone 2, Pilzwald: Sternennacht mit Gasriese, zwei Monden und Milchstraße
vec3 skyB(vec3 dir, float t) {
  float elev = clamp(dir.y, 0.0, 1.0);
  float g = max(dot(dir, GIANT_DIR), 0.0);
  vec3 haze = vec3(0.010, 0.026, 0.055) + vec3(0.020, 0.055, 0.10) * pow(g, 6.0);
  vec3 sky = mix(haze, vec3(0.002, 0.005, 0.016), pow(elev, 0.5));

  vec3 bandN = normalize(vec3(0.5, 0.25, 0.83));
  float band = exp(-pow(dot(dir, bandN) * 4.5, 2.0));
  float neb = fbm(dir.xz * 5.0 / (dir.y + 0.4) + 3.0);
  sky += vec3(0.020, 0.030, 0.060) * band * (0.4 + neb) * smoothstep(0.02, 0.3, elev);

  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 180.0 : 420.0;
    vec3 sp = dir * sc;
    vec3 cell = floor(sp);
    float h = hash31(cell);
    float thresh = k == 0 ? 0.985 : 0.965;
    if (h > thresh) {
      vec3 o = vec3(hash31(cell + 3.1), hash31(cell + 7.7), hash31(cell + 1.9)) * 0.6 + 0.2;
      float d = length(fract(sp) - o);
      float tw = 0.6 + 0.4 * sin(t * (1.5 + h * 3.0) + h * 80.0);
      float bright = (h - thresh) / (1.0 - thresh);
      vec3 sc2 = mix(vec3(0.7, 0.85, 1.0), vec3(1.0, 0.9, 0.8), hash31(cell + 5.0));
      sky += sc2 * smoothstep(0.32, 0.0, d) * tw * (k == 0 ? 2.5 : 0.9) * bright * smoothstep(0.03, 0.2, elev);
    }
  }

  float cosA = dot(dir, GIANT_DIR);
  float ang = acos(clamp(cosA, -1.0, 1.0));
  float R = 0.22;
  if (ang < R * 1.25) {
    vec3 ax = normalize(cross(GIANT_DIR, vec3(0.0, 1.0, 0.0)));
    vec3 ay = cross(ax, GIANT_DIR);
    vec2 q = vec2(dot(dir, ax), dot(dir, ay)) / R;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 n = vec3(q, sqrt(1.0 - r2));
      float lat = n.y * 0.92 + n.x * 0.25;
      float turb = fbm(vec2(lat * 9.0, n.x * 3.0) + vec2(t * 0.004, 0.0));
      float bands = 0.5 + 0.5 * sin(lat * 26.0 + turb * 4.5);
      vec3 col = mix(vec3(0.03, 0.10, 0.24), vec3(0.14, 0.38, 0.58), bands);
      col = mix(col, vec3(0.45, 0.70, 0.85), smoothstep(0.75, 0.95, turb) * 0.35);
      float spot = exp(-dot(q - vec2(0.3, -0.25), q - vec2(0.3, -0.25)) * 60.0);
      col = mix(col, vec3(0.6, 0.85, 1.0), spot * 0.6);
      float lit = smoothstep(-0.25, 0.6, dot(n, normalize(vec3(0.75, 0.35, 0.55))));
      float limb = pow(n.z, 0.35);
      sky = mix(sky, col * (0.04 + 0.6 * lit) * limb * 0.8, smoothstep(1.0, 0.985, r2));
    }
    float rim = exp(-abs(sqrt(r2) - 1.0) * 18.0) * smoothstep(-0.3, 0.6, q.x * 0.7 + q.y * 0.3);
    sky += vec3(0.15, 0.4, 0.8) * rim * 0.5;
  }
  sky += vec3(0.04, 0.10, 0.2) * pow(max(cosA, 0.0), 40.0) * 0.6;

  vec3 m1Dir = normalize(vec3(-0.62, 0.30, -0.72));
  float m1 = smoothstep(0.016, 0.012, acos(clamp(dot(dir, m1Dir), -1.0, 1.0)));
  sky += vec3(0.75, 0.88, 1.0) * m1 * 2.2 + vec3(0.1, 0.2, 0.35) * pow(max(dot(dir, m1Dir), 0.0), 800.0);
  vec3 m2Dir = normalize(vec3(-0.12, 0.52, -0.84));
  float m2 = smoothstep(0.010, 0.007, acos(clamp(dot(dir, m2Dir), -1.0, 1.0)));
  sky += vec3(0.9, 0.82, 1.0) * m2 * 1.8;
  // flache, dunkle Hügel am Horizont
  float az = atan(dir.x, -dir.z);
  float hh = 0.015 + ridge(az, 1.4, 21.0, 0.8) * 0.05;
  if (dir.y < hh) sky = vec3(0.004, 0.010, 0.022);
  return sky;
}

// Zone 3, Himmelsinseln: heller Tag, Quellwolken, Polarlicht-Schlieren, Felsnadeln, ferne schwebende Inseln
vec3 skyC(vec3 dir, float t) {
  float el = dir.y;
  float az = atan(dir.x, -dir.z);
  vec3 zen = vec3(0.10, 0.26, 0.68), hor = vec3(0.62, 0.70, 0.95);
  vec3 sky = mix(hor, zen, pow(clamp(el, 0.0, 1.0), 0.6));
  float sd = max(dot(dir, SUN_C), 0.0);
  sky += vec3(1.0, 0.9, 0.7) * (pow(sd, 6.0) * 0.35 + pow(sd, 600.0) * 8.0);
  // Schlieren in Rosa und Violett quer über den Himmel
  vec3 sn = normalize(vec3(0.55, -0.35, 0.75));
  float sv = dot(dir, sn);
  float streak = exp(-sv * sv * 40.0) * (0.5 + fbm(vec2(dot(dir, vec3(0.8, 0.5, -0.3)) * 6.0, sv * 30.0 + t * 0.01)));
  sky += mix(vec3(0.9, 0.5, 0.9), vec3(0.6, 0.6, 1.0), smoothstep(-0.2, 0.2, sv)) * streak * 0.55 * smoothstep(0.02, 0.3, el);
  // Quellwolken
  vec2 cp = dir.xz / (el + 0.15) * 1.1 + vec2(t * 0.006, 0.0);
  float c1 = fbm(cp);
  float cl = smoothstep(0.5, 0.75, c1);
  vec3 cloudCol = mix(vec3(0.75, 0.78, 0.92), vec3(1.05, 1.0, 1.0), smoothstep(0.55, 0.85, fbm(cp + 0.08)));
  sky = mix(sky, cloudCol, cl * 0.85 * smoothstep(0.0, 0.1, el));
  // ferne schwebende Inseln als Silhouetten
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(fi * 1.31 - 2.8 + sin(fi * 7.0) * 0.3, 0.12 + fract(fi * 0.618) * 0.18);
    vec2 d = vec2(az - c.x, el - c.y);
    float w = 0.05 + fract(fi * 0.37) * 0.06;
    float top = smoothstep(0.012, 0.0, d.y - 0.008 * vnoise(vec2(d.x * 90.0, fi)));
    float body = smoothstep(0.0, -0.002, d.y) * smoothstep(w, w * 0.6, abs(d.x) + (-d.y) * 1.6);
    float isl = top * body * step(-w * 0.9, d.y);
    sky = mix(sky, mix(vec3(0.42, 0.42, 0.62), hor, 0.35), isl * step(abs(d.x), w));
  }
  // Felsnadeln am Horizont, dahinter eine zweite, blassere Reihe
  float hFar = 0.03 + ridge(az * 1.1, 2.2, 41.0, 4.0) * 0.20;
  if (el < hFar) sky = mix(vec3(0.45, 0.45, 0.70), hor, 0.45);
  float hNear = 0.02 + ridge(az * 0.8, 1.6, 57.0, 2.5) * 0.12;
  if (el < hNear) sky = mix(vec3(0.38, 0.34, 0.50), hor, 0.25 + 0.3 * smoothstep(hNear, 0.0, el));
  return sky;
}

vec3 skyColor(vec3 dir, float t) {
  vec3 c = vec3(0.0);
  if (uZoneW.x > 0.001) c += skyA(dir, t) * uZoneW.x;
  if (uZoneW.y > 0.001) c += skyB(dir, t) * uZoneW.y;
  if (uZoneW.z > 0.001) c += skyC(dir, t) * uZoneW.z;
  return c;
}

// Dunst am Horizont der jeweiligen Zone (für den Nebel)
vec3 skyHaze(vec3 dir) {
  float g = max(dot(dir, GIANT_DIR), 0.0);
  vec3 hb = vec3(0.010, 0.026, 0.055) + vec3(0.020, 0.055, 0.10) * pow(g, 6.0);
  vec3 ha = vec3(0.028, 0.032, 0.04) + vec3(0.03, 0.025, 0.015) * pow(max(dot(dir, SUN_A), 0.0), 8.0);
  vec3 hc = vec3(0.42, 0.5, 0.72);
  return ha * uZoneW.x + hb * uZoneW.y + hc * uZoneW.z;
}

// Höhennebel: dicht über dem Wasser und am Boden, dünn in der Höhe, mit treibenden Schwaden.
// Im Nebeltal deutlich dichter, auf den Himmelsinseln klarer.
vec3 applyFog(vec3 col, vec3 wp, vec3 camPos, float t) {
  vec3 d = wp - camPos;
  float dist = length(d);
  vec3 dir = d / max(dist, 1e-3);
  float fall = 0.075;
  float h0 = camPos.y;
  float dy = d.y;
  float k = abs(dy) > 0.01 ? (1.0 - exp(-fall * dy)) / (fall * dy) : 1.0;
  float swirl = 0.55 + 0.9 * vnoise(wp.xz * 0.045 + vec2(t * 0.03, -t * 0.02));
  // Dichte nach der Zone der Kamera; der Nebelwald ist auch von außen gesehen eine dichte Nebelwand
  float zoneDens = uZoneW.x * 1.3 + uZoneW.y + uZoneW.z * 0.12;
  vec3 fw = zoneWeights(wp.z);
  zoneDens = max(zoneDens, fw.x * 6.0 * (1.0 - uZoneW.x));
  // die offene Ebene verschwindet vom Pilzwald aus im Nachtdunst (die Schwebefelsen tauchen erst später auf)
  zoneDens = max(zoneDens, fw.z * 5.0 * uZoneW.y);
  // Nebelschwaden im Nebelwald: in Bänden am Boden, mit deutlichen Lücken dazwischen
  float wisp = smoothstep(0.42, 0.75, fbm(wp.xz * 0.035 + vec2(t * 0.025, t * 0.01)));
  float ground = exp(-max(wp.y, 0.0) * 0.45) * wisp;
  zoneDens += fw.x * uZoneW.x * ground * 9.0;
  float dens = 0.0105 * zoneDens * exp(-fall * (h0 - 0.5)) * swirl;
  float f = 1.0 - exp(-dens * max(dist - 4.0, 0.0) * k);
  vec3 fc = skyHaze(dir) + vec3(0.0, 0.020, 0.028) * exp(-max(wp.y, 0.0) * 0.25) * uZoneW.y;
  // der Nebelwald ist von der Ebene aus eine graue, nicht leuchtende Wand
  fc = mix(fc, vec3(0.2, 0.22, 0.26), fw.x * (1.0 - uZoneW.x) * (1.0 - uZoneW.y));
  return mix(col, fc, clamp(f, 0.0, 0.97));
}
`;

const VS_WORLD = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aExtra;
layout(location = 4) in float aMatId;

layout(location = 5) in vec4 aInstCol0;
layout(location = 6) in vec4 aInstCol1;
layout(location = 7) in vec4 aInstCol2;
layout(location = 8) in vec4 aInstCol3;
layout(location = 9) in vec4 aInstTint;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec4 uTint;
uniform float uTime;
uniform float uInstanced;
uniform vec3 uOffset;
uniform vec4 uAnim;
uniform vec2 uShell;   // Fellschichten: x = Höhe der Schicht 0..1, y = Haarlänge (Modelleinheiten), 0 = aus

out vec3 vWorldPos;
out vec3 vLocalPos;
out vec3 vObjPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vExtra;
out vec4 vTint;
out float vMatId;
out float vSeed;

void main() {
  mat4 modelMat = uModel;
  vec4 tint = uTint;
  if (uInstanced > 0.5) {
    modelMat = mat4(aInstCol0, aInstCol1, aInstCol2, aInstCol3);
    tint = aInstTint;
  }

  vec3 p = aPos;
  int matId = int(aMatId + 0.5);
  vec3 origin = modelMat[3].xyz;

  // Wind in Blättern, Ranken und Lianen
  if (matId == 6 || matId == 7 || matId == 8 || matId == 10 || matId == 12 || matId == 13 || matId == 14 || matId == 16) {
    float phase = origin.x * 0.37 + origin.z * 0.29 + uTime * 1.1;
    float amt = aExtra.z * 0.06;
    if (matId == 12) amt = 0.08 + aUv.y * 0.14;
    if (matId == 14 || matId == 16) amt = (aExtra.z - 1.0) * (matId == 16 ? 0.05 : 0.09);
    p.x += sin(phase + aPos.y * 2.0) * amt;
    p.z += cos(phase * 0.83 + 1.1 + aPos.y * 1.7) * amt * 0.75;
  }

  vec3 nrm = aNormal;
  if (matId == 21) {
    // Gleiter: Flügelschlag, außen stärker
    // Flügelschlag als Welle von innen nach außen (uAnim.z: schneller > 0, langsamer < 0)
    float ph = uTime * 3.4 * (1.0 + uAnim.z) + uAnim.x - aExtra.z * 1.3;
    float flap = sin(ph) * 0.6 + sin(uTime * 1.1 + uAnim.x) * 0.15;
    p.y += flap * pow(aExtra.z, 1.3) * 0.75;
  } else if (matId == 22) {
    // Springfisch: Körperwelle wie bei echten Fischen (nach dem Schwimmer-Modell aus procedural-animals, MIT):
    // die Welle läuft vom Kopf zum Schwanz, ihre Weite wächst nach hinten stark an, und der Kopf pendelt
    // leicht gegen den Schwanzschlag. Die Brustflossen rudern.
    float u = clamp(aExtra.z / 1.2, 0.0, 1.0);
    float ph = uTime * 11.0 + uAnim.x;
    float env = 0.11 * exp(2.6 * (u - 1.0)) + 0.01;
    p.x += env * sin(ph - u * 5.5) - 0.025 * sin(ph) * (1.0 - u);
    if (abs(aPos.x) > 0.075 && aPos.y < -0.03 && aPos.z < 0.0) p.y += 0.035 * sin(ph * 0.6) * (abs(aPos.x) - 0.075) * 8.0;
  } else if (matId == 34 && uAnim.y > 0.0) {
    // Tentakel in der Szene, jeder mit eigener Bewegung:
    // uAnim.x Phase, uAnim.y Stärke, uAnim.z Tempo, uAnim.w Stil (Nachkomma = Anteil Spiralbewegung, ganzzahlig = Einrollen der Spitze)
    float hgt = aExtra.z, w = hgt * hgt;
    float ph = uTime * 4.0 * uAnim.z + uAnim.x;
    float coil = fract(uAnim.w), curl = floor(uAnim.w) * 0.5;
    vec2 whip = vec2(sin(ph - hgt * 4.0) * 0.34, cos(ph - hgt * 3.5) * 0.12);
    vec2 spiral = vec2(sin(ph * 0.8 - hgt * 7.0), cos(ph * 0.8 - hgt * 7.0)) * 0.2;
    vec2 off = mix(whip, spiral, coil) * uAnim.y * w;
    p.x += off.x;
    p.z += off.y;
    // Einrollen: die Spitze krümmt sich zusammen und öffnet sich wieder
    float k = curl * (0.6 + 0.4 * sin(ph * 0.5 + 1.0)) * smoothstep(0.45, 1.0, hgt);
    p.x -= k * 0.35;
    p.y -= k * k * 0.25;
    // Muskelzucken: leichtes Pulsieren der Dicke
    p.xz *= 1.0 + 0.06 * sin(uTime * 9.0 * uAnim.z + uAnim.x * 3.0 - hgt * 12.0) * (1.0 - hgt);
  } else if (matId == 34) {
    // Tentakel: schwingt langsam, die Spitze stärker als der Ansatz
    float ph = origin.x * 0.31 + origin.z * 0.17;
    float w = aExtra.z * aExtra.z;
    p.x += (sin(uTime * 0.55 + ph) * 0.22 + sin(uTime * 1.3 + ph * 2.0) * 0.06) * w;
    p.z += cos(uTime * 0.45 + ph * 1.3) * 0.18 * w;
    p.y -= (1.0 - cos(uTime * 0.5 + ph)) * 0.04 * w;
  } else if (matId == 23 || matId == 24) {
    // Vierbeiner: diagonaler Trab (uAnim.y = Tempo 0..1), Schulter und Hüfte wippen versetzt,
    // im Stehen leichtes Atmen. Beim Wolf dreht sich der Kopf (uAnim.w heben/senken, uAnim.z zur Seite).
    float ph = uTime * 5.2 + uAnim.x;
    float run = uAnim.y;
    float swing = sin(ph) * 0.32 * run;
    // Fuß hebt sich im Vorschwung, statt nur zu pendeln
    float lift = max(0.0, cos(ph) * sign(aExtra.z)) * abs(aExtra.z) * 0.12 * run;
    p.z += swing * aExtra.z;
    p.y += lift;
    float front = smoothstep(0.1, -0.3, p.z);
    p.y += (sin(ph * 2.0) * 0.018 * front + sin(ph * 2.0 + 1.6) * 0.018 * (1.0 - front)) * run;
    p.x += sin(ph) * 0.01 * run;
    p.y += sin(uTime * 1.4 + uAnim.x) * 0.006 * smoothstep(0.3, 0.6, p.y);
    if (matId == 24 && aExtra.y > 0.5 && aExtra.y < 1.5) {
      // Ohren anlegen, sobald der Kopf zum Heulen gehoben wird: um den Ohransatz nach hinten klappen
      float earBack = smoothstep(0.25, 0.7, uAnim.w) * 1.15;
      vec3 ep = vec3(sign(p.x) * 0.065, 0.9, -0.62);
      vec3 r = p - ep;
      float c = cos(earBack), s = sin(earBack);
      p = ep + vec3(r.x * (1.0 - earBack * 0.3), r.y * c - r.z * s, r.y * s + r.z * c);
    }
    if (matId == 24) {
      vec3 pivot = vec3(0.0, 0.72, -0.4);
      vec3 r = p - pivot;
      vec3 rn = nrm;
      float c = cos(uAnim.w), s = sin(uAnim.w);
      r = vec3(r.x, r.y * c - r.z * s, r.y * s + r.z * c);
      rn = vec3(rn.x, rn.y * c - rn.z * s, rn.y * s + rn.z * c);
      float cy = cos(uAnim.z), sy = sin(uAnim.z);
      r = vec3(r.x * cy + r.z * sy, r.y, -r.x * sy + r.z * cy);
      rn = vec3(rn.x * cy + rn.z * sy, rn.y, -rn.x * sy + rn.z * cy);
      p = pivot + r;
      nrm = rn;
    }
    if (uShell.y > 0.0) {
      // Fellschicht: entlang der Normale nach außen, Haare fallen zur Spitze hin nach hinten und unten.
      // Kurz an Schnauze und unteren Beinen, lang an Nacken, Brust und Schwanz, keins auf den Augen.
      float h = uShell.x;
      float len = uShell.y * (aExtra.y > 1.5 ? 0.0 : aExtra.y > 0.5 ? 0.25 : 1.0);
      len *= mix(0.15, 1.0, smoothstep(0.3, 0.55, aPos.y));
      if (matId == 24) len *= mix(1.5, 0.5, smoothstep(-0.55, -0.85, aPos.z));
      len *= 1.0 + 0.8 * smoothstep(0.55, 0.9, aPos.z);
      p += nrm * h * len * 0.8 + vec3(0.0, -0.5, 0.85) * h * h * len * 1.1;
    }
  }

  vec4 wp = modelMat * vec4(p, 1.0);
  vLocalPos = wp.xyz;
  vObjPos = aPos;
  vWorldPos = wp.xyz + uOffset;
  vNormal = normalize(mat3(modelMat) * nrm);
  vUv = aUv;
  vExtra = aExtra;
  vTint = tint;
  vMatId = aMatId;
  vSeed = fract(origin.x * 0.137 + origin.z * 0.071);
  gl_Position = uViewProj * vec4(vWorldPos, 1.0);
}`;

const FS_OPAQUE = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vLocalPos;
in vec3 vObjPos;
uniform vec2 uShell;
in vec3 vNormal;
in vec2 vUv;
in vec3 vExtra;
in vec4 vTint;
in float vMatId;
in float vSeed;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uRidePos;
uniform float uClip;
uniform sampler2D uReflTex;
uniform sampler2D uBoatTex;
uniform vec4 uBoat;      // x, z, Kurswinkel, 1 = Boot vorhanden
uniform vec2 uBoatScale; // Skalierung des Bootsmodells in x und z
uniform vec2 uScreen;
` + GLSL_COMMON + `

void main() {
  int matId = int(vMatId + 0.5);
  if (uClip > 0.5 && vWorldPos.y < -0.03) discard;

  if (matId == 99) {
    vec3 dir = normalize(vWorldPos - uCamPos);
    fragColor = vec4(skyColor(dir, uTime), 1.0);
    return;
  }

  vec3 lp = vLocalPos;
  float t = uTime;
  // Zone dieser Stelle: bestimmt Licht, Farben und wie stark die Biolumineszenz leuchtet
  vec3 zw = zoneWeights(vWorldPos.z);
  float emScale = dot(zw, vec3(0.3, 1.0, 0.07));
  // Reaktion auf das vorbeifahrende Boot: alles Leuchtende in der Nähe flammt auf
  float rideD = length((vWorldPos - uRidePos) * vec3(1.0, 0.6, 1.0));
  float react = 1.0 + 2.2 * exp(-rideD * 0.16) * (0.75 + 0.25 * sin(t * 3.0 - rideD * 0.8));
  if (matId >= 20) react = 1.0;
  // langsame Lichtwellen, die durch den Wald laufen
  float wave = 0.75 + 0.35 * sin(lp.z * 0.09 + lp.x * 0.05 + t * 0.9);

  if (matId == 1) {
    // Fluss: dunkler Spiegel mit Reflexionen, treibendem Plankton und leuchtendem Ufersaum
    // Im Inneren des Boots gibt es kein Wasser (der Rumpfboden liegt unter der Wasserlinie)
    if (uBoat.w > 0.5) {
      vec2 d = vWorldPos.xz - uBoat.xy;
      float sy = sin(uBoat.z), cy = cos(uBoat.z);
      float bz = dot(d, vec2(sy, cy)) / uBoatScale.y;
      float bx = dot(d, vec2(cy, -sy)) / uBoatScale.x;
      if (abs(bz) < 0.82 && abs(bx) < 0.28 * (1.0 - bz * bz)) discard;
    }
    vec2 q = lp.xz;
    vec2 flow = vec2(0.0, t * 0.55);
    float e = 0.15;
    float h0 = vnoise(q * 0.9 + flow) * 0.6 + vnoise(q * 2.3 + flow * 1.7 + 4.0) * 0.3 + vnoise(q * 6.0 + flow * 2.5) * 0.1;
    float hx = vnoise((q + vec2(e, 0.0)) * 0.9 + flow) * 0.6 + vnoise((q + vec2(e, 0.0)) * 2.3 + flow * 1.7 + 4.0) * 0.3 + vnoise((q + vec2(e, 0.0)) * 6.0 + flow * 2.5) * 0.1;
    float hz = vnoise((q + vec2(0.0, e)) * 0.9 + flow) * 0.6 + vnoise((q + vec2(0.0, e)) * 2.3 + flow * 1.7 + 4.0) * 0.3 + vnoise((q + vec2(0.0, e)) * 6.0 + flow * 2.5) * 0.1;
    vec3 N = normalize(vec3(-(hx - h0) / e * 0.22, 1.0, -(hz - h0) / e * 0.22));
    vec3 V = normalize(uCamPos - vWorldPos);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec2 suv = gl_FragCoord.xy / uScreen + N.xz * vec2(0.035, 0.05);
    vec3 refl = texture(uReflTex, clamp(suv, vec2(0.001), vec2(0.999))).rgb;
    vec3 deep = zw.x * vec3(0.004, 0.006, 0.009) + zw.y * vec3(0.002, 0.010, 0.016) + zw.z * vec3(0.02, 0.07, 0.09);
    vec3 col = mix(deep, refl, 0.35 + 0.6 * fres);

    // Plankton, das mit der Strömung treibt
    vec2 pd = dotField(q * 1.4 + vec2(0.0, t * 0.8), 0.1, 0.12);
    col += bioColor(pd.y * 0.7) * pd.x * (0.8 + 0.6 * sin(t * 2.0 + pd.y * 40.0)) * 0.8 * react * emScale;
    // Ufersaum
    float shore = vExtra.x;
    float foam = smoothstep(0.25, 0.95, shore) * (0.5 + 0.5 * vnoise(q * 3.0 + flow * 2.0));
    col += vec3(0.05, 0.55, 0.75) * foam * 0.18 * wave * react * emScale;
    col += vec3(0.6, 0.65, 0.7) * foam * 0.08 * (zw.x + zw.z);
    // Glanz von Mond bzw. Sonne
    col += vec3(0.4, 0.6, 0.9) * pow(max(dot(N, normalize(MOON_DIR + V)), 0.0), 220.0) * 1.5 * zw.y;
    col += vec3(0.6, 0.7, 0.85) * pow(max(dot(N, normalize(SUN_A + V)), 0.0), 220.0) * 2.0 * zw.x;
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(N, normalize(SUN_C + V)), 0.0), 300.0) * 8.0 * zw.z;
    col = applyFog(col, vWorldPos, uCamPos, t);
    fragColor = vec4(clamp(col, vec3(0.0), vec3(30.0)), 1.0);
    return;
  }

  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vWorldPos);
  float ao = vExtra.x;
  float glowMask = vExtra.y;

  // Feine Oberflächenstruktur aus Rauschen (Triplanar)
  vec3 bl = abs(N);
  bl /= max(bl.x + bl.y + bl.z, 0.001);
  float nXY = fbm(lp.xy * 1.3), nXZ = fbm(lp.xz * 1.3), nYZ = fbm(lp.yz * 1.3);
  float tex = nYZ * bl.x + nXZ * bl.y + nXY * bl.z;
  float fine = fbm(lp.xz * 5.1 + lp.yy * 3.7);

  vec3 base = vec3(0.02);     // Farbe in der Nachtzone (dort sehr dunkel, das Leuchten dominiert)
  vec3 albA = vec3(-1.0);     // Farbe bei Dämmerlicht (Nebeltal), -1 = aus base ableiten
  vec3 albC = vec3(-1.0);     // Farbe bei Tageslicht (Himmelsinseln)
  vec3 emissive = vec3(0.0);
  bool foliage = false;
  float rough = 0.6;
  float shellA = 1.0;
  float wet = 0.0;

  if (matId == 0) {
    // Waldboden: Moos mit Leuchtpunkten, nasser Fels am Wasser
    float moss = smoothstep(0.25, 0.75, N.y) * smoothstep(-0.4, 0.2, lp.y);
    vec3 rock = vec3(0.012, 0.016, 0.026) * (0.6 + 0.8 * fine);
    vec3 mossCol = mix(vec3(0.010, 0.030, 0.026), vec3(0.020, 0.055, 0.040), tex);
    base = mix(rock, mossCol, moss);
    wet = 1.0 - smoothstep(-0.2, 0.6, lp.y);
    float patchM = smoothstep(0.38, 0.68, fbm(lp.xz * 0.22 + 7.0));
    vec2 d1 = dotField(lp.xz * 2.4, 0.16, 0.45);
    vec2 d2 = dotField(lp.xz * 7.0 + 3.0, 0.2, 0.35);
    float dots = (d1.x * 1.2 + d2.x * 0.7) * patchM * moss * (0.25 + glowMask);
    emissive += bioColor(d1.y) * dots * 1.6;
    // flächiges Moosleuchten unter dichten Stellen
    emissive += vec3(0.0, 0.05, 0.06) * patchM * moss * glowMask * 0.6;
    float tufts = fbm(lp.xz * 0.9 + 4.0);
    albA = mix(vec3(0.12, 0.12, 0.13) * (0.7 + 0.6 * fine), mix(vec3(0.07, 0.09, 0.05), vec3(0.11, 0.10, 0.07), tufts) * (0.7 + 0.6 * tex), moss);
    // Gras mit Wellen, die der Wind über die Ebene treibt
    float windWave = 0.82 + 0.18 * sin(dot(lp.xz, vec2(0.12, 0.07)) - t * 1.4 + fbm(lp.xz * 0.05) * 4.0);
    albC = mix(vec3(0.32, 0.26, 0.18) * (0.7 + 0.6 * fine), mix(vec3(0.12, 0.30, 0.05), vec3(0.30, 0.36, 0.08), smoothstep(0.55, 0.8, tufts)) * (0.75 + 0.5 * tex) * windWave, moss);
    albA *= 1.0 - wet * 0.5;
    albC *= 1.0 - wet * 0.5;
  } else if (matId == 2) {
    // Fels: dunkler Schiefer mit Schichtung, Moospolster oben, Flechtenpunkte
    float strata = 0.5 + 0.5 * sin(lp.y * 3.6 + tex * 5.0 + fine * 1.5);
    base = mix(vec3(0.010, 0.014, 0.024), vec3(0.030, 0.040, 0.058), strata * tex) * vTint.rgb;
    float moss = smoothstep(0.45, 0.85, N.y + (fine - 0.5) * 0.4);
    base = mix(base, vec3(0.012, 0.040, 0.035) * (0.7 + 0.6 * fine), moss);
    vec2 dp = abs(N.y) > 0.6 ? lp.xz : (abs(N.x) > abs(N.z) ? lp.zy : lp.xy);
    vec2 d1 = dotField(dp * 3.0, 0.17, 0.3);
    float lichen = smoothstep(0.45, 0.7, fbm(dp * 0.5 + 2.0));
    emissive += bioColor(d1.y) * d1.x * (moss * 1.4 + lichen * 0.5) * 1.3;
    emissive += vec3(0.05, 0.4, 0.6) * glowMask * smoothstep(0.62, 0.8, fine) * 0.25;
    wet = 1.0 - smoothstep(0.0, 2.0, lp.y);
    vec3 stone = vec3(0.24, 0.22, 0.28) * (0.65 + 0.7 * strata * tex);
    albA = mix(stone, vec3(0.40, 0.33, 0.08) * (0.7 + 0.6 * fine), moss);
    albC = mix(vec3(0.42, 0.32, 0.22) * (0.8 + 0.4 * tex) * (0.85 + 0.15 * strata), vec3(0.14, 0.32, 0.06), moss);
  } else if (matId == 5 || matId == 31) {
    // Rinde (Dschungel- und Nadelbäume)
    float rr = 0.5 + 0.5 * sin(vUv.x * 50.0 + fbm(vec2(vUv.x * 8.0, lp.y * 1.5)) * 6.0);
    base = mix(vec3(0.012, 0.010, 0.018), vec3(0.035, 0.030, 0.045), rr * (0.5 + tex));
    albA = albC = vec3(0.14, 0.09, 0.07) * (0.5 + 0.9 * rr);
    if (matId == 5) {
      vec2 d1 = dotField(vec2(vUv.x * 16.0, vUv.y * 9.0 + vSeed * 10.0), 0.24, 0.5);
      float band = smoothstep(0.3, 0.7, sin(vUv.y * 1.6 + vUv.x * 3.14159 + vSeed * 6.0) * 0.5 + 0.5);
      float lower = 1.0 - smoothstep(0.5, 3.5, vUv.y);
      emissive += mix(vTint.rgb, bioColor(d1.y), 0.5) * d1.x * (band * 0.8 + lower * 0.6) * 2.0;
    }
    rough = 0.8;
  } else if (matId == 30) {
    // Nadelbaum: dunkle Nadelschichten, Spitzen etwas heller
    float tips = smoothstep(0.6, 1.0, vUv.y);
    float n = fbm(vec2(vUv.x * 30.0, vUv.y * 6.0) + vSeed * 9.0);
    base = vec3(0.006, 0.020, 0.018) * (0.6 + n);
    albA = mix(vec3(0.03, 0.05, 0.045), vec3(0.06, 0.09, 0.08), tips) * (0.6 + 0.8 * n);
    albC = mix(vec3(0.05, 0.14, 0.05), vec3(0.14, 0.24, 0.08), tips) * (0.6 + 0.8 * n);
    emissive += vec3(0.1, 0.6, 0.8) * tips * smoothstep(0.75, 0.9, n) * 0.3;
    foliage = true;
  } else if (matId == 32) {
    // Riesenpilz: blauvioletter Hut mit dunklen Flecken, Stiel und Unterseite mit orange leuchtenden Flecken
    float part = vExtra.y;  // 0 Stiel, 1 Hutoberseite, 2 Unterseite
    vec2 sp = vUv * vec2(9.0, 5.0) + vSeed * 7.0;
    vec2 d1 = dotField(sp, 0.32, 0.55);
    vec3 cap = mix(vec3(0.16, 0.16, 0.42), vec3(0.28, 0.30, 0.62), tex) * (1.0 - 0.45 * d1.x);
    vec3 stem = mix(vec3(0.18, 0.15, 0.40), vec3(0.32, 0.30, 0.62), vUv.y * tex);
    vec3 gill = mix(vec3(0.16, 0.12, 0.34), vec3(0.24, 0.16, 0.40), 0.5 + 0.5 * sin(vUv.x * 200.0));
    vec3 c = part < 0.5 ? stem : part < 1.5 ? cap : gill;
    base = c * 0.14;
    albA = albC = c;
    // Leuchtflecken am Stiel und vereinzelt auf der Unterseite, dazu ein schwacher Schein am Hutrand
    vec2 d2 = dotField(sp * 1.3 + 3.0, 0.3, 0.22);
    float glowSpots = part < 0.5 ? d1.x : part > 1.5 ? d2.x : 0.0;
    float rimGlow = part > 1.5 ? smoothstep(0.7, 1.0, vUv.y) * 0.12 : 0.0;
    emissive += vTint.rgb * glowSpots * 2.4 + vTint.rgb * rimGlow * 1.5;
    emissive *= 1.0 / max(emScale, 0.3);
  } else if (matId == 33) {
    // Rundkronen-Baum: weiche, gebauschte Krone in Grün mit gelben Lichtern
    float n = fbm(lp.xz * 0.6 + lp.y * 0.4);
    float lit = smoothstep(0.2, 0.9, N.y * 0.5 + 0.5);
    base = vec3(0.01, 0.03, 0.02);
    vec3 g = mix(vec3(0.10, 0.26, 0.05), vec3(0.30, 0.38, 0.08), smoothstep(0.45, 0.75, n + vSeed * 0.2));
    albA = albC = g * (0.75 + 0.5 * lit);
    foliage = true;
  } else if (matId == 99999) {
    // (nicht mehr verwendet)
    float ridges = 0.5 + 0.5 * sin(vUv.x * 55.0 + fbm(vec2(vUv.x * 8.0, vUv.y * 2.0)) * 6.0);
    base = mix(vec3(0.012, 0.010, 0.018), vec3(0.035, 0.030, 0.045), ridges * (0.5 + tex));
    vec2 d1 = dotField(vec2(vUv.x * 16.0, vUv.y * 9.0 + vSeed * 10.0), 0.24, 0.5);
    float band = smoothstep(0.3, 0.7, sin(vUv.y * 1.6 + vUv.x * 3.14159 + vSeed * 6.0) * 0.5 + 0.5);
    float lower = 1.0 - smoothstep(0.5, 3.5, vUv.y);
    emissive += mix(vTint.rgb, bioColor(d1.y), 0.5) * d1.x * (band * 0.8 + lower * 0.6) * 2.0;
    rough = 0.8;
  } else if (matId == 6) {
    // Blätterdach: dunkle Blätter, Unterseite mit leuchtenden Punkten und Blattrand
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float midrib = exp(-abs(vUv.x - 0.5) * 30.0);
    base = mix(vec3(0.008, 0.030, 0.030), vec3(0.020, 0.060, 0.050), vUv.y * tex);
    vec2 d1 = dotField(vec2(vUv.x * 6.0, vUv.y * 14.0 + vSeed * 20.0), 0.22, 0.35);
    float under = smoothstep(0.2, -0.4, N.y) * 0.7 + 0.3;
    emissive += vTint.rgb * (d1.x * 1.3 * under + midrib * 0.12 + smoothstep(0.12, 0.0, edge) * 0.25) * smoothstep(0.1, 0.5, vUv.y);
    wet = 0.5;
    foliage = true;
  } else if (matId == 14 || matId == 16) {
    // Lianen: leuchtende Perlen entlang der Ranke, zur Spitze hin heller
    float beads = smoothstep(0.8, 0.98, sin(vUv.y * 1.3) * 0.5 + 0.5);
    float tip = vExtra.y;
    vec3 c = matId == 16 ? vec3(0.1, 0.8, 1.0) : mix(vTint.rgb, vec3(0.1, 0.8, 1.0), 0.4);
    base = vec3(0.01, 0.03, 0.03);
    emissive += c * (0.03 + beads * 0.35 + tip * tip * 0.9);
  } else if (matId == 7) {
    // Farne: Mittelrippe und Blattrand leuchten
    float midrib = exp(-abs(vUv.x - 0.5) * 18.0);
    float edge = exp(-min(vUv.x, 1.0 - vUv.x) * 16.0);
    base = vec3(0.010, 0.040, 0.036);
    emissive += vTint.rgb * (midrib * 0.9 + edge * 0.5) * (0.3 + 0.7 * vUv.y) * (0.3 + glowMask);
    foliage = true;
  } else if (matId == 8) {
    base = vec3(0.01, 0.035, 0.035);
    emissive += vTint.rgb * glowMask * glowMask * 1.3;
    foliage = true;
  } else if (matId == 9) {
    base = vec3(0.02, 0.05, 0.08);
    float rings = 0.6 + 0.4 * sin(vUv.y * 30.0);
    emissive += vTint.rgb * (0.12 + glowMask * 0.8 * rings);
  } else if (matId == 10) {
    // goldene Blüten
    base = vec3(0.05, 0.02, 0.02);
    emissive += vTint.rgb * (0.2 + glowMask * 1.4);
  } else if (matId == 11) {
    // Pilze: gepunkteter Hut, Lamellen leuchten
    vec2 d1 = dotField(vUv * vec2(14.0, 6.0), 0.25, 0.6);
    base = vec3(0.03, 0.02, 0.05) * (0.6 + tex);
    emissive += vTint.rgb * (glowMask * 0.08 + d1.x * 1.2 + smoothstep(0.2, -0.6, N.y) * 0.6);
  } else if (matId == 12) {
    // schwebende Quallen
    base = vec3(0.02, 0.04, 0.07);
    float fres2 = pow(1.0 - abs(dot(N, V)), 2.0);
    emissive += vTint.rgb * (0.15 + glowMask * 0.6 + fres2 * 0.9);
  } else if (matId == 13) {
    // Großblättrige Pflanzen: Adern und Ränder leuchten
    float mid = exp(-abs(vUv.x - 0.5) * 26.0);
    float lat = abs(fract((vUv.y - abs(vUv.x - 0.5) * 0.9) * 9.0) - 0.5);
    float veins = smoothstep(0.06, 0.0, lat) * smoothstep(0.02, 0.1, abs(vUv.x - 0.5));
    float edge = exp(-min(vUv.x, 1.0 - vUv.x) * 22.0);
    base = mix(vec3(0.006, 0.030, 0.034), vec3(0.016, 0.060, 0.055), tex);
    float on = vUv.y < 0.0 ? 0.15 : 1.0;
    emissive += vTint.rgb * (mid * 1.0 + veins * 0.55 + edge * 0.45) * on * (0.4 + 0.6 * smoothstep(0.0, 0.4, vUv.y));
    wet = 0.6;
    foliage = true;
  } else if (matId == 34) {
    // Tentakel: dunkel glänzende Haut mit Querfalten, an der Innenseite zwei versetzte Reihen
    // ringförmiger Saugnäpfe, die zur Spitze hin kleiner werden; leuchtende Spitze
    float r = 0.1 * pow(max(1.0 - vUv.y, 0.0), 0.85) + 0.005;           // Radius wie im Mesh
    float arc = (vUv.x - 0.5) * 6.28318 * r;                            // Bogenlänge um die Innenseite
    float sy = -log(max(1.0 - 0.93 * vUv.y, 0.02)) / 0.93 / 0.034;      // Abstand der Näpfe schrumpft zur Spitze
    float cell = floor(sy);
    float dd = 0.034 * (1.0 - 0.93 * vUv.y);                            // Napfgröße an dieser Stelle
    float sh = mod(cell, 2.0) < 1.0 ? 0.0 : 0.5;                        // Reihen versetzt
    float lx = arc / dd + sh;
    vec2 q = vec2(fract(lx) - 0.5, fract(sy) - 0.5);
    float rs = 0.36 + 0.07 * hash21(vec2(cell, floor(lx)));
    float dist = length(q);
    float onSide = smoothstep(2.3, 1.7, abs(arc / dd)) * step(vUv.y, 0.97);
    float rim = smoothstep(rs, rs - 0.07, dist) * smoothstep(rs * 0.45, rs * 0.7, dist) * onSide;
    float cup = smoothstep(rs * 0.55, rs * 0.25, dist) * onSide;
    float pore = smoothstep(rs * 0.18, 0.0, dist) * onSide;
    float folds = 0.5 + 0.5 * sin(vUv.y * 140.0 + tex * 4.0);
    float back = 1.0 - smoothstep(0.0, 0.8, onSide);
    vec3 skin = mix(vec3(0.02, 0.015, 0.035), vec3(0.07, 0.03, 0.08), tex) * (0.75 + 0.35 * folds * back);
    vec3 belly = vec3(0.10, 0.05, 0.09);
    base = mix(skin, belly, onSide * 0.6);
    base = mix(base, vec3(0.16, 0.09, 0.13), rim);
    base = mix(base, vec3(0.01, 0.005, 0.012), cup);
    albA = albC = base * 6.0;
    // Flecken auf dem Rücken, die Näpfe leuchten am Rand und tief im Inneren
    float spots = smoothstep(0.7, 0.76, fbm(vec2(vUv.x * 14.0, vUv.y * 70.0))) * back;
    base *= 1.0 - spots * 0.5;
    emissive += vTint.rgb * (rim * 0.9 + pore * 1.6 + spots * 0.06 + smoothstep(0.88, 1.0, vUv.y) * 1.5 + 0.02);
    wet = 0.95;
  } else if (matId == 35) {
    // Glaskugel: Rand leuchtet, im Inneren ein pulsierender Kern
    float fres2 = pow(1.0 - abs(dot(N, V)), 2.5);
    float core = pow(max(dot(N, V), 0.0), 6.0);
    base = vec3(0.02, 0.03, 0.06);
    albA = albC = vec3(0.1, 0.12, 0.2);
    emissive += vTint.rgb * (fres2 * 1.4 + core * (0.8 + 0.4 * sin(t * 1.5 + vSeed * 20.0)) + 0.08);
    wet = 1.0;
  } else if (matId == 36) {
    // Mauerwerk (Ruinen, Türme): Steinblöcke, oben bemoost; Farbe aus der Instanz (weiß bis dunkelgrau)
    vec3 q = lp * vec3(1.0, 2.6, 1.0);
    float row = floor(q.y);
    vec2 bp = vec2((abs(N.x) > abs(N.z) ? q.z : q.x) * 1.3 + row * 0.5, q.y);
    vec2 f = fract(bp);
    float joint = smoothstep(0.0, 0.06, f.x) * smoothstep(1.0, 0.94, f.x) * smoothstep(0.0, 0.08, f.y) * smoothstep(1.0, 0.92, f.y);
    if (abs(N.y) > 0.7) joint = 1.0;
    float blockVar = 0.85 + 0.3 * hash21(floor(bp) + vSeed * 13.0);
    vec3 stone = vTint.rgb * blockVar * (0.55 + 0.45 * joint) * (0.8 + 0.4 * tex);
    if (vTint.r < 0.5) {
      // Gruselschloss: Quader- und Plattenstein nach dem Steinmaterial aus "The Ninth Vigil" (MIT):
      // leicht verzogene Blöcke im Verband, je Block eigene Höhe, Tönung und Verwitterung,
      // ausgebrochene helle Kanten, eingesunkene Fugen, Feuchtigkeit unter den Lagerfugen, großflächig fleckig.
      float hgt, mortar, spall, damp = 0.0, tone, wear;
      if (abs(N.y) < 0.7) {
        vec2 wq = bp + (vec2(vnoise(lp.xz * 0.7 + lp.y * 0.4), vnoise(lp.zy * 0.7 + 3.1)) - 0.5) * vec2(0.09, 0.06);
        vec2 cell = floor(wq), f = fract(wq);
        float bH = hash21(cell + 1.7) * 2.0 - 1.0, bW = hash21(cell + 9.1);
        tone = hash21(cell + 5.3) * 2.0 - 1.0;
        float chip = fbm(wq * vec2(5.0, 8.0) + cell * 1.3);
        float dU = min(f.x, 1.0 - f.x) / 0.055, dV = min(f.y, 1.0 - f.y) / 0.085;
        float dj = min(dU, dV) - (chip - 0.45) * 1.7;
        mortar = 1.0 - smoothstep(0.0, 1.0, dj);
        float bevel = 1.0 - smoothstep(0.5, 3.4, dj);
        spall = clamp(bevel * (1.0 - mortar) * smoothstep(0.55, 0.85, chip) * 1.5 * (0.45 + 0.75 * bW), 0.0, 1.0);
        wear = bW;
        // Feuchte läuft unter jeder Lagerfuge herab, in Schlieren
        float run = smoothstep(0.42, 0.8, vnoise(vec2(wq.x * 9.0, lp.y * 0.6)));
        damp = clamp(run * exp(-(1.0 - f.y) * 2.6) * (0.4 + 0.6 * bW) * 1.4, 0.0, 1.0);
        hgt = bH * 0.05 - mortar * 0.1 - bevel * 0.025 - spall * 0.03;
      } else {
        // Bodenplatten: unregelmäßige, verlegte Steine (Zellen), Fugen voll Schmutz
        vec2 g = lp.xz * 1.1;
        vec2 gi = floor(g), gf = fract(g);
        float f1 = 9.0, f2 = 9.0; vec2 cid = gi;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 o = vec2(x, y), c = gi + o;
          vec2 r = o + 0.15 + 0.7 * vec2(hash21(c + 3.3), hash21(c + 7.7)) - gf;
          float dd = dot(r, r);
          if (dd < f1) { f2 = f1; f1 = dd; cid = c; } else if (dd < f2) f2 = dd;
        }
        float edge = sqrt(f2) - sqrt(f1);
        tone = hash21(cid + 5.3) * 2.0 - 1.0;
        wear = hash21(cid + 9.1);
        mortar = 1.0 - smoothstep(0.03, 0.12, edge);
        spall = 0.0;
        hgt = smoothstep(0.0, 0.3, edge) * 0.06 - mortar * 0.04;
      }
      // großflächig: ausgebleichte trockene und dunkle feuchte Zonen
      float mz = fbm(lp.xy * 0.09 + lp.zz * 0.07);
      float bleach = clamp((mz - 0.52) * 6.0, 0.0, 1.0), shade = clamp((0.48 - mz) * 6.0, 0.0, 1.0);
      vec3 sc = vTint.rgb * (1.0 + tone * 0.28 + (fine - 0.5) * 0.25) * (1.0 + bleach * 0.25 - shade * 0.35);
      sc *= 1.0 - 0.35 * smoothstep(0.3, 0.6, fine) * wear * 0.6;              // Narben und Poren
      sc = mix(sc, vTint.rgb * 0.45, mortar);                                    // tiefe Fugen
      sc = mix(sc, vTint.rgb * vec3(1.7, 1.7, 1.8), spall);                       // frische Bruchkanten
      sc = mix(sc, sc * vec3(0.45, 0.55, 0.47), damp);                            // feucht, leicht grünlich
      stone = sc;
      // Relief aus der Höhe über Bildschirmableitungen (Bump Mapping), Blöcke ~0,4 m
      vec3 dpx = dFdx(vWorldPos), dpy = dFdy(vWorldPos);
      float hx = dFdx(hgt), hy = dFdy(hgt);
      vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
      float det = dot(dpx, r1);
      vec3 gradH = sign(det) * (hx * r1 + hy * r2);
      N = normalize(abs(det) * N - gradH * 0.45);
      wet = max(wet, damp * 0.6);
      ao *= 1.0 - mortar * 0.5;
    }
    float moss = smoothstep(0.55, 0.85, N.y + (fine - 0.5) * 0.5);
    vec3 mossC = zw.y > 0.5 ? vec3(0.04, 0.10, 0.08) : vec3(0.22, 0.30, 0.08);
    albA = albC = mix(stone, mossC, moss * 0.85);
    base = albA * 0.14;
    vec2 d1 = dotField(lp.xz * 3.0 + lp.y, 0.2, 0.35);
    emissive += bioColor(d1.y) * d1.x * moss * 1.2;
  } else if (matId == 37) {
    // Turmdach: Kupfergrün, zur Spitze golden
    vec3 roof = vTint.r < 0.5 ? vec3(0.05, 0.05, 0.065) : mix(vec3(0.16, 0.24, 0.42), vec3(0.75, 0.55, 0.18), smoothstep(0.8, 0.98, glowMask));
    albA = albC = roof;
    base = roof * 0.14;
    wet = 0.7;
  } else if (matId == 38) {
    // warmes Laternen- und Fensterlicht, leuchtet in allen Zonen gleich stark
    base = vec3(0.2, 0.12, 0.05);
    albA = albC = vec3(0.6, 0.45, 0.25);
    float flick = 0.85 + 0.15 * sin(t * 9.0 + vSeed * 40.0) * sin(t * 5.3 + vSeed * 11.0);
    vec3 lightCol = glowMask > 1.5 ? vec3(0.45, 0.65, 1.0) * (0.8 + 2.5 * zw.z) : vec3(1.0, 0.55, 0.18) * 3.0;
    emissive += lightCol * flick / max(emScale, 0.3);
  } else if (matId == 20) {
    // Boot: Holz aus der Textur, die türkisen Einlagen leuchten
    vec3 tc = texture(uBoatTex, vUv).rgb;
    vec3 lin = pow(tc, vec3(2.2));
    base = lin * 2.2;
    albA = albC = lin * 0.9;
    float cyan = smoothstep(0.06, 0.22, min(tc.g, tc.b) - tc.r);
    emissive += vec3(0.1, 0.85, 1.0) * cyan * 2.5 * (0.85 + 0.15 * sin(t * 1.3 + vUv.y * 20.0));
    // Widerschein der leuchtenden Umgebung auf dem Holz
    emissive += lin * vec3(0.30, 0.55, 0.62) * (0.55 + 0.45 * N.y);
    wet = 0.45;
  } else if (matId == 21) {
    // Gleiter: dunkle Haut, leuchtende Flügelkanten und Punkte
    float edge = smoothstep(0.82, 1.0, vUv.y) + smoothstep(0.9, 1.0, vUv.x);
    vec2 d1 = dotField(vUv * vec2(10.0, 4.0), 0.25, 0.55);
    base = vec3(0.02, 0.02, 0.05);
    if (vTint.a < 0.5) {
      // Fledermaus und Manta: dunkle Haut, die Flughaut leuchtet im Gegenlicht durch
      base = vTint.rgb * 0.15;
      albA = albC = vTint.rgb;
      float membrane, bones = 0.0;
      if (vExtra.y > 0.25) {
        // Fledermausflügel (uv: x = Spannweite, y = Tiefe): Arm an der Vorderkante, vier Finger vom Handgelenk
        vec2 w = vec2(0.42, 0.0);
        float dB = min(vUv.y, segDist(vUv, vec2(0.0, 0.0), w));
        dB = min(dB, segDist(vUv, w, vec2(1.0, 0.0)));
        dB = min(dB, segDist(vUv, w, vec2(0.86, 1.0)));
        dB = min(dB, segDist(vUv, w, vec2(0.64, 1.0)));
        dB = min(dB, segDist(vUv, w, vec2(0.38, 1.0)));
        bones = smoothstep(0.035, 0.012, dB);
        float veins = smoothstep(0.012, 0.0, abs(fract(fbm(vUv * vec2(8.0, 5.0)) * 5.0) - 0.5) - 0.48);
        membrane = (1.0 - bones) * (0.75 - 0.35 * veins) * (0.3 + 0.7 * vUv.y * vUv.y);
        albA = albC = mix(vTint.rgb, vec3(0.005), bones);
      } else {
        // Manta: die äußeren Schwingen sind dünn
        membrane = smoothstep(0.55, 1.0, vExtra.z) * 0.6;
      }
      vec3 L = normalize(SUN_A * zw.x + SUN_C * zw.z + MOON_DIR * zw.y);
      float back = pow(max(dot(-V, L), 0.0), 3.0);
      vec3 lightC = vec3(1.0, 0.72, 0.3) * zw.x * 0.35 + vec3(1.0, 0.6, 0.45) * zw.z * 0.5 + vec3(0.3, 0.5, 0.9) * zw.y * 0.3;
      vec3 skinC = vec3(0.55, 0.12, 0.06);   // Blut in der Flughaut färbt das Licht rötlich
      emissive += lightC * skinC * membrane * (back * back * 1.2 + 0.02) / max(emScale, 0.3);
    } else {
      emissive += vTint.rgb * (edge * 1.4 + d1.x * 1.6 * glowMask + 0.05);
    }
  } else if (matId == 22) {
    // Leuchtfisch: dunkler Rücken, heller Bauch, Schuppenmuster, leuchtende Seitenlinie mit Pulsen, glühende Flossenränder
    float up = smoothstep(-0.6, 0.8, N.y);
    // überlappende Schuppen: Reihen versetzt, der runde Rand zeigt zum Schwanz
    vec2 sc = vec2(vUv.x * 70.0, vUv.y * 34.0);
    sc.x += mod(floor(sc.y), 2.0) * 0.5;
    vec2 fsc = fract(sc) - vec2(0.5, 0.0);
    float scale = smoothstep(0.4, 0.52, length(vec2(fsc.x, fsc.y * 1.15)));
    // Schillern: Farbe wechselt mit dem Blickwinkel
    float fres3 = pow(1.0 - abs(dot(N, V)), 2.0);
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fres3 * 1.3 + vUv.y * 0.6 + vec3(0.0, 0.33, 0.67)));
    base = mix(vec3(0.05, 0.06, 0.09), vec3(0.01, 0.02, 0.05), up) * (0.75 + 0.35 * scale);
    albA = albC = mix(vec3(0.45, 0.5, 0.55), vec3(0.08, 0.12, 0.2), up) * (0.75 + 0.35 * scale);
    float side = exp(-pow((vUv.x - 0.25) * 14.0, 2.0)) + exp(-pow((vUv.x - 0.75) * 14.0, 2.0));
    float pulse = 0.6 + 0.4 * sin(vUv.y * 30.0 - t * 8.0);
    albA += irid * 0.12 * (1.0 - scale) * (1.0 - up * 0.5); albC += irid * 0.12 * (1.0 - scale);
    emissive += vTint.rgb * (side * 1.8 * pulse + scale * 0.12 + 0.05) + irid * vTint.rgb * fres3 * 0.25;
    emissive += vTint.rgb * min(glowMask, 1.0) * 1.2;
    emissive += vec3(1.0, 0.9, 0.6) * step(2.0, glowMask) * 3.0;
    wet = 1.0;
  } else if (matId == 40) {
    // gebackene Figur (figures.js): Grundfarbe aus dem Vertex (sRGB), Leuchtmaske in vUv.x, Färbung über uTint
    vec3 c = pow(max(vExtra, vec3(0.0)), vec3(2.2)) * vTint.rgb;
    base = c * 0.35;
    albA = albC = c;
    ao = 1.0;
    emissive += c * vUv.x * 1.5 / max(emScale, 0.3);
    rough = 0.65;
  } else if (matId == 23 || matId == 24) {
    if (uShell.y > 0.0) {
      // Fellschicht: einzelne Haare (Worley-Punkte im Ruheraum des Modells, damit sie bei jeder Pose am Körper haften).
      // Nach oben laufen die Haare zu Büscheln zusammen, so entstehen Strähnen mit dunklen Lücken.
      float h = uShell.x;
      vec3 q = vObjPos * 70.0;
      vec3 cq = floor(q / 5.0);
      vec3 cc = (cq + 0.5 + (furHash(cq) - 0.5) * 0.8) * 5.0;
      float clumpLen = 0.55 + 0.45 * furHash(cq + 7.0).x;
      q = mix(q, cc, h * h * 0.55);
      vec3 ci = floor(q);
      float dmin = 9.0, len = 1.0;
      for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec3 c = ci + vec3(x, y, z);
        vec3 r = furHash(c);
        float dd = length(q - c - r);
        if (dd < dmin) { dmin = dd; len = 0.5 + 0.5 * r.z; }
      }
      float rad = 0.6 * (1.0 - h * 0.75);
      float cover = smoothstep(rad, rad * 0.55, dmin) * step(h, len * clumpLen + 0.02);
      if (cover < 0.05) discard;
      shellA = cover;
    }
    // Wolf: fast schwarzer Schemen, nur ein feiner Saum in der Farbe des Nebels, Augen glühen
    float rimW = pow(1.0 - abs(dot(N, V)), 3.0);
    base = vec3(0.008, 0.008, 0.012);
    albA = albC = vec3(0.012, 0.011, 0.015) * (0.8 + 0.4 * fine);
    if (vTint.a < 0.5) {
      // Herdentier: Fellfarbe aus der Instanz
      albA = albC = vTint.rgb * (0.8 + 0.4 * fine);
      base = vTint.rgb * 0.1;
      // Rücken dunkler als der Bauch, Haarspitzen heller als der Ansatz
      albA *= mix(1.25, 0.8, smoothstep(-0.4, 0.7, N.y));
      albC = albA;
    } else {
      emissive += (skyHaze(-V) * 0.6 + vec3(0.12, 0.14, 0.18)) * rimW * 0.5 * (uShell.y > 0.0 ? 0.6 + uShell.x : 1.0);
      emissive += vTint.rgb * step(2.0, glowMask) * 12.0;
    }
    if (uShell.y > 0.0) {
      // Ansatz im Schatten der anderen Haare, Spitzen etwas heller
      float hs = uShell.x;
      albA *= mix(0.45, 1.2, hs); albC *= mix(0.45, 1.2, hs); ao *= mix(0.5, 1.0, hs);
    }
    emissive /= max(emScale, 0.3);
  }

  // Pflanzen in den Tagzonen: Blattfarbe statt der dunklen Nachtfarbe
  if (foliage && albA.x < 0.0) {
    float n = fbm(lp.xz * 0.5 + vSeed * 3.0);
    albA = vec3(0.05, 0.13, 0.06) * (0.7 + 0.6 * tex);
    albC = mix(vec3(0.12, 0.30, 0.06), vec3(0.32, 0.34, 0.08), step(0.72, vSeed)) * (0.7 + 0.6 * n);
  }
  if (albA.x < 0.0) albA = base * 7.0;
  if (albC.x < 0.0) albC = base * 7.0;

  float hemi = N.y * 0.5 + 0.5;
  vec3 col = vec3(0.0);
  // Licht: überwiegend das der Zone, in der die Kamera gerade ist. Sonst würden ferne Inseln
  // im Tageslicht mitten in der Nacht des Pilzwalds hell aufleuchten.
  zw = mix(zw, uZoneW, 0.8);
  float specPow = mix(18.0, 90.0, wet);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  if (zw.y > 0.001) {
    // Nacht: kühles Licht des Gasriesen, Widerschein des leuchtenden Bodens
    float nDotL = max(dot(N, MOON_DIR), 0.0);
    vec3 ambient = mix(vec3(0.010, 0.030, 0.035), vec3(0.018, 0.036, 0.070), hemi) * ao;
    vec3 moon = vec3(0.16, 0.26, 0.45) * nDotL * ao;
    float spec = pow(max(dot(N, normalize(MOON_DIR + V)), 0.0), specPow) * (0.04 + wet * 0.5);
    vec3 c = base * (ambient + moon) * 2.2 + vec3(0.25, 0.45, 0.8) * spec * ao + vec3(0.05, 0.12, 0.22) * rim * 0.12 * ao;
    col += c * zw.y;
  }
  float wrap = foliage ? 0.45 : 0.0;
  if (zw.x > 0.001) {
    // Nebelwald: fahles, kaltes Mondlicht, sehr wenig Himmelslicht
    float ndl = max((dot(N, SUN_A) + wrap) / (1.0 + wrap), 0.0);
    vec3 amb = mix(vec3(0.018, 0.02, 0.025), vec3(0.05, 0.06, 0.08), hemi) * ao;
    float spec = pow(max(dot(N, normalize(SUN_A + V)), 0.0), specPow) * (0.02 + wet * 0.35);
    vec3 c = albA * (amb + vec3(0.38, 0.38, 0.42) * ndl * mix(1.0, ao, 0.5)) + vec3(0.6, 0.6, 0.6) * spec * ao * 0.6;
    c += vec3(0.12, 0.14, 0.18) * rim * 0.08 * ao;
    col += c * zw.x;
  }
  if (zw.z > 0.001) {
    // Tag: hohe, helle Sonne, blaues Himmelslicht
    float ndl = max((dot(N, SUN_C) + wrap) / (1.0 + wrap), 0.0);
    vec3 amb = mix(vec3(0.15, 0.14, 0.09), vec3(0.36, 0.46, 0.72), hemi) * ao;
    float spec = pow(max(dot(N, normalize(SUN_C + V)), 0.0), specPow) * (0.02 + wet * 0.35);
    vec3 c = albC * (amb + vec3(1.35, 1.25, 1.05) * 2.0 * ndl * mix(1.0, ao, 0.5)) + vec3(1.2, 1.1, 1.0) * spec * ao;
    col += c * zw.z;
  }
  col += emissive * emScale * wave * react * (0.85 + 0.15 * sin(t * 1.7 + vSeed * 30.0));
  col = applyFog(col, vWorldPos, uCamPos, t);
  fragColor = vec4(clamp(col, vec3(0.0), vec3(30.0)), shellA);
}`;

const VS_FX = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec3 aExtra;
layout(location = 4) in float aMatId;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec4 uTint;
uniform vec3 uOffset;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec3 vExtra;
out vec4 vTint;
out float vMatId;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  wp.xyz += uOffset;
  vWorldPos = wp.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUv = aUv;
  vExtra = aExtra;
  vTint = uTint;
  vMatId = aMatId;
  gl_Position = uViewProj * wp;
}`;

const FS_FX = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec3 vExtra;
in vec4 vTint;
in float vMatId;

out vec4 fragColor;

uniform float uTime;
uniform vec3 uCamPos;
` + GLSL_COMMON + `

void main() {
  int matId = int(vMatId + 0.5);
  float d = length(vWorldPos - uCamPos);
  float distFade = exp(-max(d - 25.0, 0.0) * 0.012);
  vec3 zw = zoneWeights(vWorldPos.z);

  if (matId == 4) {
    // Wasserfall aus feinen Strähnen
    float edgeFade = vExtra.x;
    float layerBoost = vExtra.y;
    float warp = (vnoise(vec2(vUv.x * 7.0, vUv.y * 2.5 - uTime * 2.4)) - 0.5) * 0.18;
    float s1 = vnoise(vec2((vUv.x + warp) * 26.0, vUv.y * 4.5 - uTime * 4.8));
    float s2 = vnoise(vec2((vUv.x - warp * 0.7) * 52.0 + 4.3, vUv.y * 8.0 - uTime * 7.6));
    float filaments = pow(clamp(s1 * 0.55 + s2 * 0.45, 0.0, 1.0), 2.2);
    float vNorm = clamp(vUv.y / 3.0, 0.0, 1.0);
    float crest = (1.0 - smoothstep(0.0, 0.12, vNorm)) * 0.4;
    float splash = smoothstep(0.8, 1.0, vNorm) * 0.8;
    vec3 waterCol = mix(vec3(0.06, 0.40, 0.75), vec3(0.65, 0.92, 1.0), clamp(filaments * 1.3 + splash * 0.5, 0.0, 1.0));
    // am Tag und in der Dämmerung weißes Wasser statt türkisem Leuchten
    waterCol = mix(waterCol, mix(vec3(0.75, 0.68, 0.85), vec3(1.4, 1.45, 1.5), zw.z / max(zw.x + zw.z, 1e-3)), zw.x + zw.z);
    float alpha = edgeFade * (0.12 + 0.6 * filaments + crest + splash) * distFade;
    fragColor = vec4(waterCol * layerBoost * alpha * 0.9, alpha);
  } else if (matId == 15) {
    // Ringwellen im Becken unter dem Wasserfall
    float distR = 1.0 - vExtra.x;
    float rings = 0.5 + 0.5 * sin(distR * 28.0 - uTime * 5.2);
    float ringLine = pow(rings, 4.0) * smoothstep(0.0, 0.18, distR) * smoothstep(1.0, 0.25, distR);
    float coreMist = exp(-distR * 4.5) * 0.5;
    vec3 col = mix(vec3(0.10, 0.65, 0.9), vec3(0.6, 0.9, 1.0), coreMist);
    float alpha = (ringLine * 0.4 + coreMist) * distFade * vTint.a;
    fragColor = vec4(col * alpha, alpha);
  } else {
    // dünne Lichtstrahlen des Gasriesen durch das Blätterdach
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCamPos - vWorldPos);
    float viewFade = pow(abs(dot(N, V)), 2.0);
    float verticalFade = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159) * smoothstep(0.0, 0.4, vUv.y);
    float shimmer = 0.6 + 0.4 * vnoise(vec2(vUv.x * 10.0 + uTime * 0.15, vUv.y * 3.0 - uTime * 0.1));
    float alpha = viewFade * verticalFade * shimmer * 0.035 * distFade * (zw.x * 3.0 + zw.y) * vTint.a;
    vec3 shaftCol = mix(vTint.rgb, vec3(1.0, 0.65, 0.5), zw.x);
    fragColor = vec4(shaftCol * alpha, alpha);
  }
}`;

// Glühwürmchen und schwebende Samen um die Kamera herum
const VS_PARTICLES = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aSeed;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;

uniform mat4 uViewProj;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uRidePos;
uniform float uPixelRatio;
uniform float uLoop;

out vec3 vColor;
out float vAlpha;
` + GLSL_ZONE + `
float riverX(float z) {
  float k = 6.2831853 / uLoop;
  return sin(z * k * 2.0) * 7.5 + cos(z * k) * 4.2 + sin(z * k * 3.0 + 1.3) * 1.6;
}

void main() {
  float t = uTime * (0.25 + aSeed.z * 0.35) + aSeed.x * 37.0;
  float zWrap = mod(aSeed.y * 140.0 - uTime * (0.6 + aSeed.z * 1.2), 140.0);
  float z = uRidePos.z + 20.0 - zWrap;
  float spread = 2.0 + aSeed.z * 12.0;
  float x = riverX(z) + (fract(aSeed.x * 7.31) * 2.0 - 1.0) * spread + sin(t * 1.3 + aSeed.x * 20.0) * 1.2;
  float y = 0.5 + fract(aSeed.x * 13.7) * 7.0 + sin(t * 0.9) * 0.5;

  vec4 wp = vec4(x, y, z, 1.0);
  float dist = length(wp.xyz - uCamPos);
  float fade = exp(-max(dist - 10.0, 0.0) * 0.03) * smoothstep(0.5, 3.0, dist);
  float blink = smoothstep(0.2, 0.9, sin(uTime * (0.8 + aSeed.z) + aSeed.y * 80.0) * 0.5 + 0.5);

  vec3 zw = zoneWeights(z);
  // im Nebeltal blasse Schwebeteilchen statt Glühwürmchen, auf den Himmelsinseln kaum etwas
  vColor = mix(aColor, vec3(0.9, 0.8, 0.95) * 0.4, zw.x);
  vAlpha = fade * (0.15 + 0.85 * blink) * dot(zw, vec3(0.0, 1.0, 0.1));
  gl_Position = uViewProj * wp;
  gl_PointSize = clamp((aSize * uPixelRatio * 22.0) / max(dist, 1.5), 1.0, 10.0);
}`;

const FS_PARTICLES = `#version 300 es
precision highp float;

in vec3 vColor;
in float vAlpha;
out vec4 fragColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0);
  fragColor = vec4(vColor * core * vAlpha * 3.0, 0.0);
}`;

// Leuchtpunkte am Waldboden (fest platziert, pulsieren und reagieren auf das Boot)
const VS_GLOWDOTS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aColor;
layout(location = 2) in float aSize;

uniform mat4 uViewProj;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uRidePos;
uniform vec3 uOffset;
uniform float uPixelRatio;
uniform float uMirror;

out vec3 vColor;
` + GLSL_ZONE + `
void main() {
  vec3 wp = aPos + uOffset;
  if (uMirror > 0.5 && wp.y < 0.0) wp.y = -1000.0;
  float dist = length(wp - uCamPos);
  float rideD = length((wp - uRidePos) * vec3(1.0, 0.6, 1.0));
  float react = 1.0 + 1.0 * exp(-rideD * 0.18);
  float seed = fract(aPos.x * 0.731 + aPos.z * 0.317);
  float pulse = 0.55 + 0.45 * sin(uTime * (0.7 + seed * 1.3) + seed * 50.0 + aPos.z * 0.08);
  float fade = exp(-max(dist - 20.0, 0.0) * 0.025);
  vColor = aColor * pulse * react * fade * dot(zoneWeights(aPos.z), vec3(0.25, 1.0, 0.0));
  gl_Position = uViewProj * vec4(wp, 1.0);
  gl_PointSize = clamp(aSize * uPixelRatio * 7.0 / max(dist, 1.0), 1.0, 5.0);
}`;

const FS_GLOWDOTS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  fragColor = vec4(vColor * exp(-r2 * 4.0) * 0.35, 0.0);
}`;

// weiche Staubwolken (normale Alpha-Mischung, nicht additiv): Position, Größe, Deckkraft je Punkt
const VS_DUST = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aPosSize;
layout(location = 1) in float aAlpha;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform float uPixelRatio;
uniform float uViewH;
out float vAlpha;
void main() {
  float dist = length(aPosSize.xyz - uCamPos);
  vAlpha = aAlpha;
  gl_Position = uViewProj * vec4(aPosSize.xyz, 1.0);
  gl_PointSize = clamp(aPosSize.w * uViewH / max(dist, 1.0), 1.0, 256.0);
}`;

const FS_DUST = `#version 300 es
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uFade;
out vec4 fragColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = (1.0 - r2) * (1.0 - r2) * vAlpha * uFade;
  fragColor = vec4(uColor * a, a);
}`;

const VS_QUAD = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Bloom, Schritt 1: Verkleinern (13 Abtastungen); beim ersten Schritt mit weicher Schwelle
const FS_BLOOM_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uPrefilter;
uniform float uThreshold;

vec3 s(vec2 o) { return texture(uTex, vUv + o * uTexel).rgb; }

void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (uPrefilter > 0.5) {
    // ungültige Werte (NaN/Inf) dürfen nicht in den Bloom geraten
    if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
    col = min(col, vec3(12.0));
    float br = max(col.r, max(col.g, col.b));
    float thr = uThreshold, knee = thr * 0.7;
    float soft = clamp(br - thr + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    col *= max(soft, br - thr) / max(br, 1e-4);
  }
  fragColor = vec4(col, 1.0);
}`;

// Bloom, Schritt 2: Vergrößern mit Zeltfilter, wird additiv auf die größere Stufe gelegt
const FS_BLOOM_UP = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uWeight;

vec3 s(vec2 o) { return texture(uTex, vUv + o * uTexel).rgb; }

void main() {
  vec3 col = s(vec2(0.0)) * 4.0;
  col += (s(vec2(-1.0, 0.0)) + s(vec2(1.0, 0.0)) + s(vec2(0.0, -1.0)) + s(vec2(0.0, 1.0))) * 2.0;
  col += s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
  fragColor = vec4(col / 16.0 * uWeight, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSceneTex;
uniform sampler2D uBloomTex;
uniform sampler2D uRayTex;   // verkleinerte helle Bildteile (Bloom-Stufe) als Quelle der Lichtstrahlen
uniform float uTime;
uniform vec2 uScreen;
uniform float uExposure;
uniform vec2 uRayUV;         // Bildschirmposition von Mond bzw. Sonne
uniform float uRayW;         // Stärke der Strahlen (0 = aus)
uniform vec3 uRayCol;
uniform float uGrain;
uniform float uHorizon;      // Bildschirmhöhe des Horizonts (0..1)
uniform float uHeat;         // Stärke des Hitzeflimmerns (Ebene)

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
// Interleaved Gradient Noise: räumliches Rauschen ohne Muster (gegen Streifen beim Abtasten)
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 c = vUv - 0.5;
  float r2 = dot(c, c);
  // Farbsäume wie bei einem Objektiv: in der Bildmitte null, zum Rand hin wachsend (nach The Ninth Vigil)
  vec2 ca = c * r2 * 0.012;
  // Hitzeflimmern: ein schmales Band knapp unter dem Horizont (dort liegt die ferne Ebene) wabert leicht
  vec2 uv0 = vUv;
  if (uHeat > 0.01) {
    float band = smoothstep(uHorizon - 0.2, uHorizon - 0.03, vUv.y) * (1.0 - smoothstep(uHorizon - 0.01, uHorizon + 0.03, vUv.y));
    float wob = sin(vUv.y * 260.0 - uTime * 5.0 + sin(vUv.x * 37.0 + uTime * 1.7) * 2.5) + 0.5 * sin(vUv.y * 530.0 + vUv.x * 60.0 - uTime * 8.0);
    uv0 += vec2(wob * 0.0011, wob * 0.0006) * band * uHeat;
  }
  vec3 sceneCol = vec3(texture(uSceneTex, uv0 + ca).r, texture(uSceneTex, uv0).g, texture(uSceneTex, uv0 - ca).b);
  if (any(isnan(sceneCol))) sceneCol = vec3(0.0);
  vec3 bloom = texture(uBloomTex, vUv).rgb;
  vec3 hdr = sceneCol + bloom * 0.55;

  // Lichtstrahlen: von jedem Pixel zur Lichtquelle hin die hellen Bildteile aufsammeln und abklingen lassen.
  // Dunkle Silhouetten (Bäume, Türme) unterbrechen die Strahlen von selbst.
  if (uRayW > 0.001) {
    const int N = 28;
    vec2 delta = (vUv - uRayUV) * (0.9 / float(N));
    vec2 uv = vUv - delta * ign(gl_FragCoord.xy);
    float decay = 1.0, sum = 0.0;
    for (int i = 0; i < N; i++) {
      uv -= delta;
      vec3 sCol = texture(uRayTex, uv).rgb;
      sum += max(dot(sCol, vec3(0.3, 0.5, 0.2)) - 0.02, 0.0) * decay;
      decay *= 0.965;
    }
    float fall = exp(-length((vUv - uRayUV) * vec2(uScreen.x / uScreen.y, 1.0)) * 1.6);
    hdr += uRayCol * min(sum / float(N) * uRayW * fall, 0.6);
  }

  hdr *= uExposure;
  // kühle Schatten, leicht türkise Mitten
  float lum = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
  hdr = mix(hdr, hdr * vec3(0.85, 1.0, 1.15), smoothstep(0.2, 0.0, lum) * 0.5);
  vec3 ldr = aces(hdr);
  ldr = pow(ldr, vec3(1.0 / 2.2));
  ldr *= 1.0 - r2 * 0.55;
  // Filmkorn: einfarbig, in den Mitten am stärksten, in tiefem Schwarz und hellen Lichtern schwach
  float l2 = dot(ldr, vec3(0.299, 0.587, 0.114));
  float g = ign(gl_FragCoord.xy + vec2(fract(uTime * 7.31), fract(uTime * 3.17)) * 211.0) - 0.5;
  ldr += g * uGrain * smoothstep(0.0, 0.12, l2) * (1.0 - smoothstep(0.6, 1.0, l2));
  // Dithering gegen Farbstufen in den dunklen Verläufen
  float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  ldr += (n - 0.5) / 255.0;
  fragColor = vec4(ldr, 1.0);
}`;

function compileShader(glCtx, type, src) {
  const sh = glCtx.createShader(type);
  glCtx.shaderSource(sh, src);
  glCtx.compileShader(sh);
  if (!glCtx.getShaderParameter(sh, glCtx.COMPILE_STATUS)) {
    const log = glCtx.getShaderInfoLog(sh);
    glCtx.deleteShader(sh);
    throw new Error("Shader-Fehler: " + log);
  }
  return sh;
}

function createProgram(glCtx, vsSrc, fsSrc) {
  const vs = compileShader(glCtx, glCtx.VERTEX_SHADER, vsSrc);
  const fs = compileShader(glCtx, glCtx.FRAGMENT_SHADER, fsSrc);
  const prog = glCtx.createProgram();
  glCtx.attachShader(prog, vs);
  glCtx.attachShader(prog, fs);
  glCtx.linkProgram(prog);
  if (!glCtx.getProgramParameter(prog, glCtx.LINK_STATUS)) {
    const log = glCtx.getProgramInfoLog(prog);
    glCtx.deleteProgram(prog);
    throw new Error("Program-Link-Fehler: " + log);
  }
  // Uniform-Positionen einmal abfragen und am Programm merken
  const u = {};
  const n = glCtx.getProgramParameter(prog, glCtx.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = glCtx.getActiveUniform(prog, i).name.replace(/\[0\]$/, "");
    u[name] = glCtx.getUniformLocation(prog, name);
  }
  return { prog, u };
}

let progOpaque, progFx, progParticles, progGlowDots, progDust, progBloomDown, progBloomUp, progComposite;
try {
  progOpaque = createProgram(gl, VS_WORLD, FS_OPAQUE);
  progFx = createProgram(gl, VS_FX, FS_FX);
  progParticles = createProgram(gl, VS_PARTICLES, FS_PARTICLES);
  progGlowDots = createProgram(gl, VS_GLOWDOTS, FS_GLOWDOTS);
  progDust = createProgram(gl, VS_DUST, FS_DUST);
  progBloomDown = createProgram(gl, VS_QUAD, FS_BLOOM_DOWN);
  progBloomUp = createProgram(gl, VS_QUAD, FS_BLOOM_UP);
  progComposite = createProgram(gl, VS_QUAD, FS_COMPOSITE);
} catch (e) {
  showError(e.message);
  return;
}
