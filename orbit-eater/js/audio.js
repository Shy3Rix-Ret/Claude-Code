/**
 * Sounddesign — vollständig in Echtzeit synthetisiert (Web Audio API).
 *
 * Signalfluss
 *   Einzelklänge ─┬─► sfx ─────┐
 *                 └─► Hall ────┤
 *   Ambient-Drone ──► amb ─────┼─► master ─► Kompressor ─► Ausgang
 *   Boost/Schleuder/Loch ──────┘   (Schleifen, laufen dauerhaft, Pegel moduliert)
 *
 * Fress-Sounds steigen mit der Kombo eine pentatonische Leiter hinauf —
 * schnelles Fressen klingt dadurch wie eine kleine Melodie statt wie Lärm.
 * Ereignisse anderer Körper werden nach Entfernung leiser und im Stereobild
 * verortet.
 */
import { AUDIO, GALAXY_STAGE } from './config.js';
import { clamp } from './utils.js';
import { storage } from './storage.js';

const PENTATONIC = [0, 2, 4, 7, 9];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const EPS = 0.0001;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = clamp(Number(storage.get('volume', AUDIO.volume)) || 0, 0, 1);
    this.muted = !!storage.get('muted', false);
    this.duck = 1;
    this.lastEat = 0;
    this.lastShot = 0;
    this.listener = { x: 0, y: 0 };
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Muss aus einer Nutzergeste heraus aufgerufen werden (Autoplay-Regeln der Browser). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.build(new AC());
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  build(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.targetMaster();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);

    this.amb = ctx.createGain();
    this.amb.gain.value = 0;
    this.amb.connect(this.master);
    this.amb.gain.setTargetAtTime(0.55, ctx.currentTime, 1.5);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.reverb.connect(wet);
    wet.connect(this.master);

    this.noise = this.makeNoise(2);
    this.buildAmbient();
    this.buildLoops();
  }

  // --- Bausteine ------------------------------------------------------------

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Synthetischer Raum: Stereo-Rauschen mit exponentiellem Abklingen. */
  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  noiseSource(loop) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  /** Tiefer, langsam atmender Grundton — der Raum zwischen den Sternen. */
  buildAmbient() {
    const ctx = this.ctx;
    const lp = this.filter('lowpass', 200, 0.8);
    const out = this.gain(0.3);
    lp.connect(out);
    out.connect(this.amb);
    for (const [f, type, g] of [[55, 'sawtooth', 0.2], [82.6, 'sawtooth', 0.11], [27.5, 'sine', 0.55], [110.2, 'triangle', 0.05]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = this.gain(g);
      o.connect(og);
      og.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const depth = this.gain(80);
    lfo.connect(depth);
    depth.connect(lp.frequency);
    lfo.start();

    const shimmer = this.noiseSource(true);
    const bp = this.filter('bandpass', 3400, 0.9);
    const sg = this.gain(0.01);
    shimmer.connect(bp);
    bp.connect(sg);
    sg.connect(this.amb);
    shimmer.start();
    this.ambFilter = lp;
  }

  /** Dauerschleifen, deren Pegel pro Frame nachgeführt werden. */
  buildLoops() {
    const ctx = this.ctx;

    // Boost: gefiltertes Rauschen
    const bn = this.noiseSource(true);
    this.boostFilter = this.filter('bandpass', 700, 1.1);
    this.boostGain = this.gain(0);
    bn.connect(this.boostFilter);
    this.boostFilter.connect(this.boostGain);
    this.boostGain.connect(this.sfx);
    bn.start();

    // Schleuder laden: steigender Ton mit Vibrato
    this.slingOsc = ctx.createOscillator();
    this.slingOsc.type = 'sawtooth';
    this.slingOsc.frequency.value = 120;
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vibDepth = this.gain(5);
    vib.connect(vibDepth);
    vibDepth.connect(this.slingOsc.frequency);
    this.slingFilter = this.filter('lowpass', 700, 2);
    this.slingGain = this.gain(0);
    this.slingOsc.connect(this.slingFilter);
    this.slingFilter.connect(this.slingGain);
    this.slingGain.connect(this.sfx);
    this.slingOsc.start();
    vib.start();

    // Nähe eines Schwarzen Lochs: tiefes Dröhnen
    this.holeGain = this.gain(0);
    for (const f of [34, 51.5]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.holeGain);
      o.start();
    }
    const hn = this.noiseSource(true);
    const hl = this.filter('lowpass', 140, 1);
    const hg = this.gain(0.5);
    hn.connect(hl);
    hl.connect(hg);
    hg.connect(this.holeGain);
    hn.start();
    this.holeGain.connect(this.amb);
  }

  // --- Einzelklänge ----------------------------------------------------------

  tone({ freq, end = 0, type = 'sine', dur = 0.15, gain = 0.2, attack = 0.004, when = 0, send = 0, pan = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (end) o.frequency.exponentialRampToValueAtTime(end, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.001), t0 + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    o.connect(g);
    this.route(g, send, pan);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  hiss({ dur = 0.2, gain = 0.2, type = 'lowpass', freq = 1000, end = 0, q = 0.8, attack = 0.003, when = 0, send = 0, pan = 0 }) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const s = this.noiseSource(false);
    const f = this.filter(type, freq, q);
    if (end) f.frequency.exponentialRampToValueAtTime(end, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.001), t0 + attack);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + dur);
    s.connect(f);
    f.connect(g);
    this.route(g, send, pan);
    s.start(t0, Math.random() * 1.5);
    s.stop(t0 + dur + 0.05);
  }

  route(node, send, pan) {
    let out = node;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      out = p;
    }
    out.connect(this.sfx);
    if (send) {
      const s = this.gain(send);
      out.connect(s);
      s.connect(this.reverb);
    }
  }

  /** Lautstärke und Stereoposition eines Ereignisses relativ zum Zuhörer. */
  spatial(x, y) {
    const dx = x - this.listener.x, dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const k = clamp(1 - d / AUDIO.hearRange, 0, 1);
    return { k: k * k, pan: clamp(dx / (AUDIO.hearRange * 0.6), -0.8, 0.8) };
  }

  // --- Spielklänge --------------------------------------------------------------

  eat(combo) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastEat < AUDIO.eatMinGap) return;
    this.lastEat = now;
    const i = Math.min(Math.max(combo - 1, 0), 14);
    const note = PENTATONIC[i % 5] + 12 * Math.floor(i / 5);
    const f = 392 * 2 ** (note / 12);
    this.tone({ freq: f, end: f * 1.015, dur: 0.13, gain: 0.08, send: 0.12 });
    this.tone({ freq: f * 2, type: 'triangle', dur: 0.07, gain: 0.022 });
  }

  eatChunk(combo) {
    if (!this.ready) return;
    this.tone({ freq: 240, end: 120, dur: 0.14, gain: 0.14 });
    this.hiss({ dur: 0.06, gain: 0.1, freq: 900 });
    this.lastEat = 0;
    this.eat(combo);
  }

  eatComet() {
    if (!this.ready) return;
    [880, 1175, 1568, 2093].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.4, gain: 0.06, when: i * 0.045, send: 0.45 }));
  }

  gulp(x, y, mine) {
    if (!this.ready) return;
    const s = mine ? { k: 1, pan: 0 } : this.spatial(x, y);
    if (s.k < 0.02) return;
    this.tone({ freq: 190, end: 46, dur: 0.38, gain: 0.34 * s.k, pan: s.pan });
    this.hiss({ dur: 0.26, gain: 0.18 * s.k, freq: 700, end: 120, pan: s.pan });
    if (mine) {
      this.tone({ freq: 196, type: 'triangle', dur: 0.6, gain: 0.07, when: 0.05, send: 0.5 });
      this.tone({ freq: 294, type: 'triangle', dur: 0.6, gain: 0.05, when: 0.09, send: 0.5 });
    }
  }

  capture() {
    if (!this.ready) return;
    this.tone({ freq: 1320, end: 1760, dur: 0.08, gain: 0.03, send: 0.35 });
  }

  slingRelease(power) {
    if (!this.ready) return;
    this.hiss({ dur: 0.24, gain: 0.22 + power * 0.1, type: 'bandpass', freq: 3200, end: 420, q: 1.4 });
    this.tone({ freq: 560, end: 140, type: 'triangle', dur: 0.22, gain: 0.11 });
  }

  shot(mine, x, y) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.02) return;
    this.lastShot = now;
    const s = mine ? { k: 1, pan: 0 } : this.spatial(x, y);
    if (s.k < 0.05) return;
    this.tone({ freq: 980, end: 320, type: 'triangle', dur: 0.06, gain: 0.035 * s.k, pan: s.pan });
  }

  denied() {
    if (!this.ready) return;
    this.tone({ freq: 220, end: 180, type: 'square', dur: 0.06, gain: 0.025 });
    this.tone({ freq: 220, end: 180, type: 'square', dur: 0.06, gain: 0.025, when: 0.09 });
  }

  hit(x, y, mine) {
    if (!this.ready) return;
    const s = mine ? { k: 1, pan: 0 } : this.spatial(x, y);
    if (s.k < 0.03) return;
    this.hiss({ dur: 0.12, gain: 0.22 * s.k, freq: 1000, end: 220, pan: s.pan });
    this.tone({ freq: 130, end: 60, dur: 0.16, gain: 0.2 * s.k, pan: s.pan });
  }

  hurt() {
    if (!this.ready) return;
    this.hiss({ dur: 0.18, gain: 0.3, freq: 1600, end: 180 });
    this.tone({ freq: 95, end: 42, type: 'triangle', dur: 0.26, gain: 0.32 });
  }

  bump(x, y, speed) {
    if (!this.ready) return;
    const s = this.spatial(x, y);
    if (s.k < 0.05) return;
    const k = s.k * clamp(speed / 400, 0.3, 1);
    this.tone({ freq: 150, end: 85, dur: 0.12, gain: 0.14 * k, pan: s.pan });
    this.hiss({ dur: 0.05, gain: 0.08 * k, freq: 600, pan: s.pan });
  }

  evolve(stage) {
    if (!this.ready) return;
    // Jede Stufe klingt einen Ton höher (Dur-Tonleiter über drei Oktaven). In der
    // Galaxie-Ära wiederholt sich die oberste Oktave — sonst fiept Stufe 69 nur noch.
    const step = stage < 21 ? stage : 14 + ((stage - 14) % 7);
    const root = 110 * 2 ** ((MAJOR[step % 7] + 12 * Math.floor(step / 7)) / 12);
    [0, 4, 7, 11, 14, 19].forEach((n, i) =>
      this.tone({ freq: root * 2 ** (n / 12), type: 'triangle', dur: 1.3, gain: 0.07, attack: 0.01, when: i * 0.07, send: 0.65 }));
    this.tone({ freq: root / 2, dur: 1.6, gain: 0.16, attack: 0.35, send: 0.3 });
  }

  explosion(x, y, size) {
    if (!this.ready) return;
    const s = this.spatial(x, y);
    if (s.k < 0.03) return;
    const k = s.k * clamp(size, 0.3, 1);
    this.hiss({ dur: 0.9, gain: 0.32 * k, freq: 2400, end: 70, send: 0.4, pan: s.pan });
    this.tone({ freq: 120, end: 32, dur: 0.8, gain: 0.3 * k, pan: s.pan });
  }

  death() {
    if (!this.ready) return;
    this.hiss({ dur: 1.7, gain: 0.45, freq: 3000, end: 55, send: 0.6 });
    this.tone({ freq: 110, end: 26, dur: 1.5, gain: 0.42 });
    [220, 261.6, 329.6].forEach((f, i) =>
      this.tone({ freq: f / 2, type: 'triangle', dur: 2.2, gain: 0.05, attack: 0.2, when: 0.5 + i * 0.12, send: 0.7 }));
  }

  holeSpawn(x, y) {
    if (!this.ready) return;
    const s = this.spatial(x, y);
    const k = Math.max(0.25, s.k);
    this.tone({ freq: 28, end: 62, dur: 3, gain: 0.22 * k, attack: 1.2, pan: s.pan });
    this.hiss({ dur: 2.6, gain: 0.08 * k, freq: 200, end: 1200, attack: 1.4, send: 0.5, pan: s.pan });
  }

  holeCollapse(x, y) {
    if (!this.ready) return;
    const s = this.spatial(x, y);
    const k = Math.max(0.2, s.k);
    this.hiss({ dur: 1.4, gain: 0.3 * k, freq: 4000, end: 60, send: 0.6, pan: s.pan });
    this.tone({ freq: 70, end: 24, dur: 1.2, gain: 0.3 * k, pan: s.pan });
  }

  comboEnd(count) {
    if (!this.ready || count < 8) return;
    this.tone({ freq: 1568, type: 'triangle', dur: 0.25, gain: 0.04, send: 0.5 });
    this.tone({ freq: 2093, type: 'triangle', dur: 0.35, gain: 0.04, when: 0.07, send: 0.5 });
  }

  ui(kind = 'tick') {
    if (!this.ready) return;
    if (kind === 'confirm') {
      this.tone({ freq: 660, end: 990, type: 'triangle', dur: 0.12, gain: 0.06, send: 0.3 });
    } else {
      this.tone({ freq: 1500, dur: 0.03, gain: 0.025 });
    }
  }

  // --- Dauerklänge -----------------------------------------------------------------

  /**
   * Pro Frame: Boost-Rauschen, Ladeton, Schwarzloch-Dröhnen, Ambient-Filter.
   * @param state { boosting, charge, hole (0..1), stage, listenerX, listenerY }
   */
  update(state) {
    this.listener.x = state.listenerX;
    this.listener.y = state.listenerY;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.duck > 0.5;
    this.boostGain.gain.setTargetAtTime(on && state.boosting ? 0.2 : 0, t, 0.06);
    this.boostFilter.frequency.setTargetAtTime(state.boosting ? 1300 : 700, t, 0.25);
    const c = on ? state.charge : 0;
    this.slingGain.gain.setTargetAtTime(c > 0 ? 0.035 + c * 0.05 : 0, t, 0.04);
    this.slingOsc.frequency.setTargetAtTime(110 + c * 340, t, 0.05);
    this.slingFilter.frequency.setTargetAtTime(500 + c * 2200, t, 0.05);
    this.holeGain.gain.setTargetAtTime(on ? state.hole * state.hole * 0.5 : 0, t, 0.3);
    this.ambFilter.frequency.setTargetAtTime(170 + Math.min(1, state.stage / GALAXY_STAGE) * 220, t, 2);
  }

  // --- Lautstärke -------------------------------------------------------------------

  targetMaster() {
    return this.muted ? 0 : this.volume * this.duck;
  }

  applyMaster() {
    if (this.ctx) this.master.gain.setTargetAtTime(this.targetMaster(), this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.volume > 0 && this.muted) this.muted = false;
    storage.set('volume', this.volume);
    storage.set('muted', this.muted);
    this.applyMaster();
  }

  toggleMute() {
    this.muted = !this.muted;
    storage.set('muted', this.muted);
    this.applyMaster();
    return this.muted;
  }

  /** Pausenmenü: Klang gedämpft, Schleifen aus. */
  setDuck(v) {
    this.duck = v;
    this.applyMaster();
  }
}
