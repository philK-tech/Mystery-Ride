// audio.js: Klangkulisse, Musik und Geräusche (Web Audio, alles synthetisch erzeugt)
// Aufbau: Musik und Atmosphäre je Zone auf eigenem Bus, Überblendung nach den Zonengewichten.
// Alles läuft über einen gemeinsamen Hall (Convolver mit erzeugter Impulsantwort) und einen Kompressor.
// Die Szenen lösen über sfx(name, pan) Geräusche aus (siehe creatures.js).
let audioCtx = null, masterGain = null, audioEnabled = false, audioUserSet = false;
let reverbIn = null, sfxBus = null, noiseBuf = null;
const zoneBus = [null, null, null];
let tentacleGrowl = null, riverGain = null;

function makeNoiseBuffer(sec, brown) {
  const n = Math.floor(audioCtx.sampleRate * sec);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.025 * w) / 1.025; d[i] = last * 3.2; } else d[i] = w;
  }
  return buf;
}

function makeImpulse(sec, decay) {
  const n = Math.floor(audioCtx.sampleRate * sec);
  const buf = audioCtx.createBuffer(2, n, audioCtx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

// Dauerrauschen mit Filter (Wind, Fluss); gibt den Gain-Knoten zurück
function noiseLoop(dest, type, freq, q, gain, brown, lfoRate, lfoDepth) {
  const src = audioCtx.createBufferSource();
  src.buffer = brown ? makeNoiseBuffer(4, true) : noiseBuf;
  src.loop = true;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = audioCtx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = audioCtx.createGain();
  g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(dest);
  if (lfoRate) {
    // Böen: langsames Schwanken von Lautstärke und Filter
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = lfoRate;
    const lg = audioCtx.createGain(); lg.gain.value = gain * lfoDepth;
    const lf = audioCtx.createGain(); lf.gain.value = freq * 0.5 * lfoDepth;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.connect(lf); lf.connect(f.frequency);
    lfo.start();
  }
  src.start();
  return g;
}

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Flächenklang: mehrere verstimmte Oszillatoren durch einen Tiefpass, langsames Ein- und Ausblenden
function padNote(dest, m, when, dur, opt) {
  const g = audioCtx.createGain();
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = opt.cut; lp.Q.value = 0.7;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(opt.vol, when + opt.att);
  g.gain.setValueAtTime(opt.vol, when + dur - opt.rel * 0.3);
  g.gain.linearRampToValueAtTime(0, when + dur + opt.rel);
  lp.connect(g); g.connect(dest);
  for (const det of opt.detune) {
    const o = audioCtx.createOscillator();
    o.type = opt.wave;
    o.frequency.value = midi(m);
    o.detune.value = det;
    o.connect(lp);
    o.start(when); o.stop(when + dur + opt.rel + 0.1);
  }
}

// Glocken- oder Flötenton mit Abklingen
function bellNote(dest, m, when, vol, decay, wave, vib) {
  const o = audioCtx.createOscillator();
  o.type = wave;
  o.frequency.value = midi(m);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + (vib ? 0.25 : 0.01));
  g.gain.exponentialRampToValueAtTime(0.0005, when + decay);
  o.connect(g); g.connect(dest);
  if (vib) {
    const v = audioCtx.createOscillator(); v.frequency.value = 5.0;
    const vg = audioCtx.createGain(); vg.gain.value = 4;
    v.connect(vg); vg.connect(o.detune); v.start(when); v.stop(when + decay);
  } else {
    // leiser Oberton für den Glockencharakter
    const o2 = audioCtx.createOscillator(); o2.frequency.value = midi(m) * 2.76;
    const g2 = audioCtx.createGain();
    g2.gain.setValueAtTime(vol * 0.25, when); g2.gain.exponentialRampToValueAtTime(0.0003, when + decay * 0.4);
    o2.connect(g2); g2.connect(dest); o2.start(when); o2.stop(when + decay);
  }
  o.start(when); o.stop(when + decay + 0.05);
}

// Musik je Zone: Akkordfolge (MIDI-Noten), Tonleiter für die Melodie, Klangfarbe
const ZONE_MUSIC = [
  { // Nebelwald: d-Moll, tief und dunkel, vereinzelte Spieluhrtöne
    chords: [[38, 50, 53, 57], [34, 50, 53, 58], [31, 50, 55, 58], [33, 49, 52, 57]],
    scale: [62, 65, 67, 69, 70, 74, 77], chordLen: 9.0, notesPer: 3, noteVol: 0.05, noteDecay: 4.5, noteWave: "sine", vib: false,
    pad: { wave: "sawtooth", detune: [-7, 6], cut: 520, vol: 0.022, att: 3.5, rel: 4.0 }
  },
  { // Pilzwald: schwebend, lydisch, Glockenarpeggien
    chords: [[41, 53, 57, 60, 64], [39, 51, 55, 58, 62], [44, 56, 60, 63, 67], [41, 53, 59, 64, 69]],
    scale: [72, 74, 76, 79, 81, 83, 84, 88], chordLen: 7.0, notesPer: 7, noteVol: 0.035, noteDecay: 3.2, noteWave: "triangle", vib: false,
    pad: { wave: "triangle", detune: [-9, 0, 8], cut: 1400, vol: 0.02, att: 2.5, rel: 3.0 }
  },
  { // Ebene: weit und hell, C-Dur und a-Moll, Flötenmelodie
    chords: [[36, 48, 55, 64, 67], [33, 48, 52, 57, 59], [29, 45, 53, 57, 60], [31, 47, 55, 62, 64]],
    scale: [67, 69, 72, 74, 76, 79, 81], chordLen: 8.0, notesPer: 4, noteVol: 0.045, noteDecay: 2.6, noteWave: "sine", vib: true,
    pad: { wave: "sawtooth", detune: [-5, 5], cut: 1800, vol: 0.016, att: 3.0, rel: 3.5 }
  }
];
const musicState = [{ next: 0, idx: 0 }, { next: 0, idx: 0 }, { next: 0, idx: 0 }];
const zoneLevel = [1, 0, 0];

function scheduleMusic() {
  if (!audioCtx || !audioEnabled) return;
  const now = audioCtx.currentTime;
  ZONE_MUSIC.forEach((z, zi) => {
    const ms = musicState[zi];
    if (ms.next < now) ms.next = now + 0.1;
    if (ms.next > now + 1.0) return;
    // stille Zonen nicht spielen (spart Rechenzeit), aber im Takt bleiben
    if (zoneLevel[zi] > 0.01) {
      const ch = z.chords[ms.idx % z.chords.length];
      for (const m of ch) padNote(zoneBus[zi], m, ms.next, z.chordLen, z.pad);
      // Bassnote eine Oktave tiefer, sehr leise
      padNote(zoneBus[zi], ch[0] - 12 + (zi === 0 ? 12 : 0), ms.next, z.chordLen, { ...z.pad, vol: z.pad.vol * 0.8, cut: 300 });
      // Melodietöne verstreut im Akkord, bevorzugt Akkordtöne
      for (let k = 0; k < z.notesPer; k++) {
        if (Math.random() < 0.35) continue;
        const when = ms.next + (k / z.notesPer) * z.chordLen + Math.random() * 0.4;
        let m = z.scale[Math.floor(Math.random() * z.scale.length)];
        if (Math.random() < 0.5) m = ch[1 + Math.floor(Math.random() * (ch.length - 1))] + 12 * (zi === 2 ? 1 : 2);
        bellNote(zoneBus[zi], m, when, z.noteVol * (0.6 + Math.random() * 0.4), z.noteDecay, z.noteWave, z.vib);
      }
    }
    ms.next += z.chordLen;
    ms.idx++;
  });
}

function initAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
  noiseBuf = makeNoiseBuffer(3, false);
  const comp = audioCtx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 4;
  comp.connect(audioCtx.destination);
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.0;
  masterGain.connect(comp);

  const conv = audioCtx.createConvolver();
  conv.buffer = makeImpulse(3.8, 2.6);
  const wet = audioCtx.createGain(); wet.gain.value = 0.55;
  reverbIn = audioCtx.createGain();
  reverbIn.connect(conv); conv.connect(wet); wet.connect(masterGain);

  for (let i = 0; i < 3; i++) {
    const g = audioCtx.createGain();
    g.gain.value = zoneLevel[i];
    g.connect(masterGain);
    g.connect(reverbIn);
    zoneBus[i] = g;
  }
  sfxBus = audioCtx.createGain();
  sfxBus.gain.value = 1.0;
  sfxBus.connect(masterGain);
  const sfxVerb = audioCtx.createGain(); sfxVerb.gain.value = 0.35;
  sfxBus.connect(sfxVerb); sfxVerb.connect(reverbIn);

  // Fluss: leises Plätschern in allen Zonen
  riverGain = noiseLoop(masterGain, "bandpass", 420, 0.65, 0.1, true, 0.13, 0.4);
  // Atmosphäre je Zone: kalter Wind im Nebelwald, Summen im Pilzwald, offener Wind über der Ebene
  noiseLoop(zoneBus[0], "lowpass", 380, 0.8, 0.12, true, 0.07, 0.7);
  noiseLoop(zoneBus[0], "bandpass", 1900, 6.0, 0.006, false, 0.05, 0.9); // feines Pfeifen in den Wipfeln
  const hum = audioCtx.createOscillator(); hum.frequency.value = 55; hum.type = "triangle";
  const humG = audioCtx.createGain(); humG.gain.value = 0.02;
  const humL = audioCtx.createOscillator(); humL.frequency.value = 0.3;
  const humLG = audioCtx.createGain(); humLG.gain.value = 0.012;
  humL.connect(humLG); humLG.connect(humG.gain);
  hum.connect(humG); humG.connect(zoneBus[1]); hum.start(); humL.start();
  noiseLoop(zoneBus[1], "highpass", 5000, 0.7, 0.008, false, 0.2, 0.8);
  noiseLoop(zoneBus[2], "bandpass", 700, 0.5, 0.11, true, 0.05, 0.8);

  // Grollen der Tentakel (Lautstärke folgt der Szene)
  const gr = audioCtx.createOscillator(); gr.type = "sawtooth"; gr.frequency.value = 38;
  const grL = audioCtx.createOscillator(); grL.frequency.value = 2.0;
  const grLG = audioCtx.createGain(); grLG.gain.value = 6;
  grL.connect(grLG); grLG.connect(gr.frequency);
  const grF = audioCtx.createBiquadFilter(); grF.type = "lowpass"; grF.frequency.value = 160;
  tentacleGrowl = audioCtx.createGain(); tentacleGrowl.gain.value = 0;
  gr.connect(grF); grF.connect(tentacleGrowl); tentacleGrowl.connect(sfxBus);
  gr.start(); grL.start();

  setInterval(scheduleMusic, 250);
  scheduleAmbientCalls();
}

// vereinzelte Tierrufe aus der Ferne, passend zur Zone (Eule, Pilzgezwitscher, Raubvogel)
function scheduleAmbientCalls() {
  setTimeout(() => {
    if (audioCtx && audioEnabled) {
      const zi = zoneLevel.indexOf(Math.max(...zoneLevel));
      const pan = Math.random() * 1.6 - 0.8;
      if (zi === 0) sfx("owl", pan); else if (zi === 1) sfx("chirp", pan); else sfx("hawk", pan);
    }
    scheduleAmbientCalls();
  }, 9000 + Math.random() * 12000);
}

// iPhone/iPad: Web Audio schweigt, solange der Stummschalter aktiv ist, und startet nur direkt in einer Bedienung.
// Abhilfe: Wiedergabe-Modus anmelden (neuere iOS) bzw. ein stummes HTML-Audio im Kreis abspielen (ältere iOS),
// dazu ein kurzer stummer Puffer, der den Kontext im Tipp-Ereignis freischaltet.
let silentEl = null;
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) {}
  if (!silentEl) {
    const n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    silentEl = document.createElement("audio");
    silentEl.setAttribute("playsinline", "");
    silentEl.loop = true;
    silentEl.src = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  }
  const pr = silentEl.play();
  if (pr && pr.catch) pr.catch(() => {});
  if (audioCtx) {
    const src = audioCtx.createBufferSource();
    src.buffer = audioCtx.createBuffer(1, 1, 22050);
    src.connect(audioCtx.destination);
    src.start(0);
    if (audioCtx.state !== "running") audioCtx.resume();
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && audioEnabled && audioCtx && audioCtx.state !== "running") audioCtx.resume();
});

function setAudio(enabled, byUser = true) {
  if (byUser) audioUserSet = true;
  audioEnabled = enabled;
  if (enabled) {
    initAudio();
    unlockAudio();
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.4);
    btnAudio.textContent = "Ton An";
    btnAudio.classList.remove("muted");
  } else {
    if (masterGain && audioCtx) masterGain.gain.setTargetAtTime(0.0, audioCtx.currentTime, 0.15);
    if (silentEl) silentEl.pause();
    btnAudio.textContent = "Ton Aus";
    btnAudio.classList.add("muted");
  }
}

// pro Bild aus main.js: Zonen überblenden, Tentakelgrollen nachführen
function updateAudio(zoneW, growl) {
  for (let i = 0; i < 3; i++) zoneLevel[i] = zoneW[i];
  if (!audioCtx || !audioEnabled) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < 3; i++) zoneBus[i].gain.setTargetAtTime(zoneW[i] * (1.0 - growl * 0.6), now, 0.5);
  tentacleGrowl.gain.setTargetAtTime(growl * 0.12, now, 0.2);
}

// --- Geräusche ---
function sfxOut(pan, vol) {
  const g = audioCtx.createGain(); g.gain.value = vol;
  if (audioCtx.createStereoPanner) {
    const p = audioCtx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p); p.connect(sfxBus);
    return { g, p };
  }
  g.connect(sfxBus);
  return { g, p: null };
}
function noiseHit(dest, when, dur, type, f0, f1, q, vol, att) {
  const s = audioCtx.createBufferSource(); s.buffer = noiseBuf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = audioCtx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, when); f.frequency.exponentialRampToValueAtTime(f1, when + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol, when + (att || 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(when, Math.random() * 2); s.stop(when + dur + 0.05);
}
function toneSweep(dest, when, dur, wave, f0, f1, vol) {
  const o = audioCtx.createOscillator(); o.type = wave;
  o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(vol, when + dur * 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g); g.connect(dest); o.start(when); o.stop(when + dur + 0.05);
}

function sfx(name, pan = 0) {
  if (!audioCtx || !audioEnabled) return;
  const now = audioCtx.currentTime;
  if (name === "batsFlutter") {
    // Schwarm steigt auf: viele schnelle, leise Flügelschläge und hohe Pieptöne
    const o = sfxOut(pan, 0.5);
    for (let i = 0; i < 70; i++) noiseHit(o.g, now + Math.random() * 3.5, 0.05, "bandpass", 1800, 900, 1.5, 0.05 + Math.random() * 0.05);
    for (let i = 0; i < 12; i++) toneSweep(o.g, now + Math.random() * 3.5, 0.06, "sine", 5200 + Math.random() * 1500, 3800, 0.012);
  } else if (name === "batsRush") {
    // Schwarm rauscht knapp über den Kopf: anschwellendes Flattern, Zischen von vorn nach hinten
    const o = sfxOut(0, 1.0);
    for (let i = 0; i < 140; i++) {
      const w = now + Math.pow(Math.random(), 0.6) * 1.8;
      noiseHit(o.g, w, 0.04 + Math.random() * 0.03, "bandpass", 2200, 700, 1.2, 0.06 + Math.random() * 0.08);
    }
    noiseHit(o.g, now + 0.4, 1.6, "bandpass", 600, 3000, 0.8, 0.35, 0.9);
    for (let i = 0; i < 18; i++) toneSweep(o.g, now + Math.random() * 1.6, 0.07, "sine", 6000 + Math.random() * 2000, 4200, 0.02);
  } else if (name === "splashOut" || name === "splashIn") {
    // Fisch: hellen Spritzer, beim Eintauchen ein dumpfes "Plopp"
    const o = sfxOut(pan, 0.9);
    noiseHit(o.g, now, 0.5, "highpass", 2500, 900, 0.7, 0.25, 0.005);
    noiseHit(o.g, now + 0.05, 0.8, "bandpass", 1200, 300, 1.0, 0.18, 0.02);
    if (name === "splashIn") toneSweep(o.g, now, 0.18, "sine", 420, 120, 0.25);
    for (let i = 0; i < 8; i++) noiseHit(o.g, now + 0.25 + Math.random() * 0.8, 0.06, "bandpass", 3500, 2000, 3.0, 0.03);
  } else if (name === "tentacleRise") {
    // Tentakel bricht durch die Oberfläche: schwerer Schwall, tiefes Rauschen
    const o = sfxOut(pan, 1.0);
    noiseHit(o.g, now, 1.8, "lowpass", 1800, 200, 0.7, 0.5, 0.03);
    noiseHit(o.g, now + 0.1, 1.2, "highpass", 3000, 1200, 0.7, 0.18, 0.02);
    toneSweep(o.g, now, 1.2, "sine", 90, 40, 0.35);
    for (let i = 0; i < 14; i++) noiseHit(o.g, now + 0.6 + Math.random() * 1.6, 0.08, "bandpass", 2600, 1500, 2.0, 0.05);
  } else if (name === "tentacleSlap") {
    // Peitschenschlag: kurzes Zischen, dann klatschendes Wasser
    const o = sfxOut(pan, 0.7);
    noiseHit(o.g, now, 0.25, "bandpass", 900, 3500, 1.5, 0.12, 0.2);
    noiseHit(o.g, now + 0.22, 0.45, "lowpass", 2500, 300, 0.8, 0.35, 0.005);
    toneSweep(o.g, now + 0.22, 0.2, "sine", 140, 60, 0.25);
  } else if (name === "herd") {
    // Herde in der Ferne: dumpfes Hufgetrappel, das an- und abschwillt, darüber Staubrauschen
    const o = sfxOut(pan, 0.8);
    const dur = 10.0;
    noiseHit(o.g, now, dur, "lowpass", 400, 250, 0.6, 0.12, 3.0);
    for (let i = 0; i < 160; i++) {
      const u = Math.random(), w = now + u * dur;
      const env = Math.sin(u * Math.PI);
      toneSweep(o.g, w, 0.12, "sine", 90 + Math.random() * 40, 45, 0.06 * env + 0.005);
    }
    for (let i = 0; i < 3; i++) toneSweep(o.g, now + 2 + i * 2.7 + Math.random(), 0.9, "sawtooth", 260 + Math.random() * 60, 170, 0.012);
  } else if (name === "mantaCall") {
    // tiefer, walartiger Ruf der Mantas aus der Ferne
    const o = sfxOut(pan, 0.8);
    for (const det of [0, 1.5]) {
      const ox = audioCtx.createOscillator(); ox.type = "sine";
      ox.frequency.setValueAtTime(180 + det, now); ox.frequency.linearRampToValueAtTime(240 + det, now + 1.2);
      ox.frequency.linearRampToValueAtTime(150 + det, now + 3.0);
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.09, now + 0.8); g.gain.linearRampToValueAtTime(0, now + 3.2);
      ox.connect(g); g.connect(o.g); ox.start(now); ox.stop(now + 3.3);
    }
  } else if (name === "mantaPass") {
    // Manta gleitet vorbei: Luftrauschen wandert von links nach rechts hinter das Boot
    const o = sfxOut(-0.8, 1.0);
    if (o.p) { o.p.pan.setValueAtTime(-0.8, now); o.p.pan.linearRampToValueAtTime(0.9, now + 3.0); }
    noiseHit(o.g, now, 3.2, "bandpass", 350, 900, 0.9, 0.3, 1.4);
    noiseHit(o.g, now + 0.8, 2.0, "lowpass", 300, 150, 0.7, 0.2, 0.8);
  } else if (name === "owl") {
    const o = sfxOut(pan, 0.5);
    for (let i = 0; i < 2; i++) toneSweep(o.g, now + i * 0.55, 0.42, "sine", 420, 360, 0.05);
  } else if (name === "chirp") {
    const o = sfxOut(pan, 0.5);
    for (let i = 0; i < 5; i++) toneSweep(o.g, now + i * 0.11, 0.09, "sine", 2400 + i * 300, 3600 + i * 200, 0.02);
  } else if (name === "hawk") {
    const o = sfxOut(pan, 0.5);
    toneSweep(o.g, now, 1.1, "triangle", 1900, 1300, 0.03);
  }
}

// Wolfsgeheul: zwei leicht verstimmte Töne, die auf- und absteigen, mit Vibrato und Echo
function playHowl() {
  if (!audioCtx || !audioEnabled) return;
  const now = audioCtx.currentTime;
  const out = audioCtx.createGain();
  out.gain.setValueAtTime(0.0, now);
  out.gain.linearRampToValueAtTime(0.16, now + 0.4);
  out.gain.setValueAtTime(0.16, now + 2.2);
  out.gain.linearRampToValueAtTime(0.0, now + 3.4);
  const lp = audioCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  const echo = audioCtx.createDelay(1.0);
  echo.delayTime.value = 0.42;
  const fb = audioCtx.createGain();
  fb.gain.value = 0.35;
  out.connect(lp);
  lp.connect(masterGain);
  lp.connect(reverbIn);
  lp.connect(echo);
  echo.connect(fb);
  fb.connect(echo);
  echo.connect(masterGain);
  const vib = audioCtx.createOscillator();
  vib.frequency.value = 5.5;
  const vibGain = audioCtx.createGain();
  vibGain.gain.value = 9;
  vib.connect(vibGain);
  for (const det of [0, 7]) {
    const o = audioCtx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(330 + det, now);
    o.frequency.exponentialRampToValueAtTime(560 + det, now + 0.9);
    o.frequency.setValueAtTime(560 + det, now + 2.0);
    o.frequency.exponentialRampToValueAtTime(380 + det, now + 3.4);
    vibGain.connect(o.frequency);
    o.connect(out);
    o.start(now);
    o.stop(now + 3.6);
  }
  vib.start(now);
  vib.stop(now + 3.6);
}
