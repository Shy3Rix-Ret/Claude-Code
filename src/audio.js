/**
 * Everything you hear.
 *
 * §3.4 — no score for 90% of the runtime, only diegetic sound: your own
 * breathing, the water, and low rumbles you cannot place. All of it is
 * synthesised at runtime, so the level ships zero audio files and the whole
 * experience is one page with nothing to download.
 *
 * Binaural positioning is mandatory (§3.4): the watcher clicks go through HRTF
 * panners tied to the real listener orientation, so on headphones they land
 * somewhere specific behind you and on a phone speaker they mostly do not.
 *
 * The infrasound bed for the thing in the deep sits at 31–58 Hz — nearly
 * inaudible through a phone speaker, physical through headphones. That gap is
 * intentional (§3.4).
 */

import { lerp, saturate } from './util.js';

function makeNoiseBuffer(ctx, seconds, pink) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) { d[i] = w; continue; }
      // Paul Kellet's pink filter — warmer, less hissy, reads as "water".
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

/** Procedural impulse response — a wide, dark space with no walls in reach. */
function makeReverbIR(ctx, seconds, decay, darkness) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const w = (Math.random() * 2 - 1) * env;
      lp += (w - lp) * darkness;   // one-pole lowpass, kills the sparkle
      d[i] = lp;
    }
  }
  return buf;
}

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.ctx = null;
    this.enabled = true;
    this._pendingCold = false;
    this.masterTarget = 1;
  }

  async start() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return false; }

    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    /* iOS does not reject resume() when it will not grant audio — inside an
     * embedded frame the promise simply stays pending forever. Anything that
     * awaits it never continues, so it gets a hard deadline and we carry on
     * without sound if it misses. unlockOnGesture() picks it up later if the
     * browser changes its mind. */
    try {
      await Promise.race([
        ctx.resume(),
        new Promise((r) => setTimeout(r, 700)),
      ]);
    } catch { /* refused outright — the level runs silent */ }

    /* ---------------- master chain ---------------- */
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 26;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.32;

    // The submersion filter everything passes through (§4, Act 3).
    this.subFilter = ctx.createBiquadFilter();
    this.subFilter.type = 'lowpass';
    this.subFilter.frequency.value = 20000;
    this.subFilter.Q.value = 0.7;

    this.subShelf = ctx.createBiquadFilter();
    this.subShelf.type = 'highshelf';
    this.subShelf.frequency.value = 1400;
    this.subShelf.gain.value = 0;

    this.master.connect(this.subFilter);
    this.subFilter.connect(this.subShelf);
    this.subShelf.connect(this.comp);
    this.comp.connect(ctx.destination);

    /* ---------------- reverb send ---------------- */
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeReverbIR(ctx, 3.4, 2.6, 0.16);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.55;
    this.convolver.connect(this.reverbGain);
    this.reverbGain.connect(this.master);

    this.sendBus = ctx.createGain();
    this.sendBus.gain.value = 1;
    this.sendBus.connect(this.convolver);

    /* ---------------- shared sources ---------------- */
    this.pink = makeNoiseBuffer(ctx, 6, true);
    this.white = makeNoiseBuffer(ctx, 4, false);

    this._buildAmbience();
    this._buildBreath();
    this._buildRumble();
    this._buildColdOpen();

    /* ---------------- listener ---------------- */
    this.listener = ctx.listener;

    this.ready = true;
    this._breathNext = ctx.currentTime + 0.4;
    this._heartNext = ctx.currentTime + 1;
    this._dropNext = ctx.currentTime + 2;
    this._groanNext = ctx.currentTime + 40;
    this.breathRate = 2.1;      // seconds per full cycle — starts hurried (§2.2)
    this.breathGain = 0.0;
    this.heartGain = 0;
    this.heartRate = 1.15;

    this.master.gain.setTargetAtTime(1, ctx.currentTime, 0.4);

    this.unlockOnGesture();

    // The cold open may have been requested while the graph was still being
    // built. Play it if it is still roughly in sync with the picture (§2.1);
    // arriving late is worse than not arriving.
    if (this._pendingCold) {
      const late = performance.now() - this._pendingColdAt;
      this._pendingCold = false;
      if (late < 2500) this.playColdOpen();
    }
    return true;
  }

  /**
   * Some browsers only grant audio on a later gesture than the first one, and
   * a tab returning from the background can leave the context suspended. Keep
   * trying quietly until it runs, then stop listening.
   */
  unlockOnGesture() {
    if (!this.ctx || this._unlockBound) return;
    this._unlockBound = true;

    const tryResume = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'running') { detach(); return; }
      this.ctx.resume().then(() => {
        if (this.ctx.state === 'running') detach();
      }).catch(() => { /* still not allowed; try again next time */ });
    };
    const events = ['pointerdown', 'touchstart', 'keydown'];
    const detach = () => {
      for (const e of events) window.removeEventListener(e, tryResume);
      this._unlockBound = false;
    };
    for (const e of events) window.addEventListener(e, tryResume, { passive: true });
  }

  /* ------------------------------------------------------------ ambience */

  _loopSource(buffer, gainValue, destination) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gainValue;
    src.connect(g);
    g.connect(destination);
    src.start(this.ctx.currentTime + Math.random() * 0.3);
    return { src, gain: g };
  }

  _buildAmbience() {
    const ctx = this.ctx;

    /* --- water against your face: pink noise, heavily shaped --- */
    this.waterBus = ctx.createGain();
    this.waterBus.gain.value = 0.0;
    this.waterBus.connect(this.master);
    this.waterBus.connect(this.sendBus);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 110;
    lp.connect(hp); hp.connect(this.waterBus);
    this.waterLap = this._loopSource(this.pink, 0.55, lp);
    this.waterFilter = lp;

    // Slow swell in the lapping so it never sits still.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.084;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.30;
    lfo.connect(lfoGain);
    lfoGain.connect(this.waterLap.gain.gain);
    lfo.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.031;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 180;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(lp.frequency);
    lfo2.start();

    /* --- the empty air over the water: a very dark bed --- */
    this.airBus = ctx.createGain();
    this.airBus.gain.value = 0.0;
    this.airBus.connect(this.master);
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass'; airLp.frequency.value = 240;
    airLp.connect(this.airBus);
    this._loopSource(this.pink, 0.24, airLp);
  }

  _buildBreath() {
    const ctx = this.ctx;
    this.breathBus = ctx.createGain();
    this.breathBus.gain.value = 0.0;
    this.breathBus.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.22;
    this.breathBus.connect(send);
    send.connect(this.sendBus);
  }

  /** One breath: filtered noise with a moving formant, in or out. */
  _breath(inhale, intensity, when) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    // Random offset so no two breaths are the same noise.
    const offset = Math.random() * (this.white.duration - 1.5);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = inhale ? 1.5 : 1.1;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;

    const g = ctx.createGain();
    g.gain.value = 0.0001;

    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(this.breathBus);

    const dur = inhale ? 0.62 + intensity * 0.30 : 0.85 + intensity * 0.35;
    const peak = (inhale ? 0.42 : 0.30) * (0.5 + intensity * 0.8);

    // Inhales climb in pitch, exhales fall away.
    const f0 = inhale ? 380 : 620;
    const f1 = inhale ? 900 : 260;
    bp.frequency.setValueAtTime(f0, when);
    bp.frequency.exponentialRampToValueAtTime(f1, when + dur);

    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + dur * (inhale ? 0.45 : 0.22));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    src.start(when, offset, dur + 0.1);
    src.stop(when + dur + 0.1);
    src.onended = () => { try { g.disconnect(); bp.disconnect(); lp.disconnect(); } catch { /* already gone */ } };
  }

  _buildRumble() {
    const ctx = this.ctx;
    this.rumbleBus = ctx.createGain();
    this.rumbleBus.gain.value = 0.0;
    this.rumbleBus.connect(this.master);

    // §3.4 — 31 to 58 Hz. Under a phone speaker's floor, felt on headphones.
    this.rumbleOscs = [];
    for (const [f, amp, detune] of [[31, 0.55, 0.021], [43.5, 0.34, 0.013], [58, 0.20, 0.031]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = amp;
      // A slow wander in pitch so it never becomes a note.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = detune;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.045;
      lfo.connect(lg); lg.connect(o.frequency);
      lfo.start();
      o.connect(g); g.connect(this.rumbleBus);
      o.start();
      this.rumbleOscs.push({ o, g });
    }

    // Heartbeat bus (Act 3).
    this.heartBus = ctx.createGain();
    this.heartBus.gain.value = 1;
    this.heartBus.connect(this.master);
  }

  _thump(when, gain, freq = 54) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.9, when);
    o.frequency.exponentialRampToValueAtTime(freq * 0.62, when + 0.13);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.30);
    o.connect(g); g.connect(this.heartBus);
    o.start(when); o.stop(when + 0.34);
    o.onended = () => { try { g.disconnect(); } catch { /* already gone */ } };
  }

  /* ----------------------------------------------------------- cold open */

  _buildColdOpen() {
    const ctx = this.ctx;
    this.coldBus = ctx.createGain();
    this.coldBus.gain.value = 0.0001;
    this.coldBus.connect(this.master);

    const send = ctx.createGain();
    send.gain.value = 0.85;
    this.coldBus.connect(send);
    send.connect(this.sendBus);

    // Everything from before is heard through a wall of water.
    this.coldLp = ctx.createBiquadFilter();
    this.coldLp.type = 'lowpass';
    this.coldLp.frequency.value = 900;
    this.coldLp.Q.value = 0.9;
    this.coldLp.connect(this.coldBus);

    // Room tone.
    this._loopSource(this.pink, 0.30, this.coldLp);

    // Voices: detuned saws through a wandering bandpass. Never words.
    this.coldVoices = [];
    for (const base of [172, 208, 253]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = base;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 4.5;
      const g = ctx.createGain();
      g.gain.value = 0.0;

      // Mumble envelope — an LFO with an irrational ratio to the others.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.7 + Math.random() * 1.9;
      const lg = ctx.createGain();
      lg.gain.value = 0.028;
      lfo.connect(lg); lg.connect(g.gain);
      lfo.start();

      const flfo = ctx.createOscillator();
      flfo.frequency.value = 0.19 + Math.random() * 0.4;
      const flg = ctx.createGain();
      flg.gain.value = 260;
      flfo.connect(flg); flg.connect(bp.frequency);
      flfo.start();

      o.connect(bp); bp.connect(g); g.connect(this.coldLp);
      o.start();
      this.coldVoices.push({ o, g });
    }
  }

  /** §2.1 — 13.5s of a remembered room, then something takes you. */
  playColdOpen() {
    if (!this.ready) {
      this._pendingCold = true;
      this._pendingColdAt = performance.now();
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime;

    this.coldBus.gain.setValueAtTime(0.0001, t);
    this.coldBus.gain.exponentialRampToValueAtTime(0.85, t + 2.2);

    // Water splashing in the remembered place.
    for (let i = 0; i < 16; i++) {
      this._splash(t + 0.8 + Math.random() * 11.5, 0.10 + Math.random() * 0.16, this.coldLp);
    }

    const cut = t + 13.5;
    // Pulled under: the whole memory closes to a lowpass and vanishes.
    this.coldLp.frequency.setValueAtTime(900, cut - 0.35);
    this.coldLp.frequency.exponentialRampToValueAtTime(90, cut + 0.05);
    this.coldBus.gain.setValueAtTime(0.85, cut - 0.05);
    this.coldBus.gain.exponentialRampToValueAtTime(0.0001, cut + 0.09);

    // The grab itself: a descending whoosh and one heavy impact.
    this._whoosh(cut - 0.30, 0.55);
    this._thump(cut, 0.55, 42);

    // §2.1 — then 1.5 seconds of absolutely nothing.
    this.reverbGain.gain.setValueAtTime(0.55, cut);
    this.reverbGain.gain.linearRampToValueAtTime(0.0, cut + 0.14);
    this.reverbGain.gain.setValueAtTime(0.0, cut + 1.5);
    this.reverbGain.gain.linearRampToValueAtTime(0.42, cut + 3.0);

    for (const v of this.coldVoices) {
      v.o.frequency.setValueAtTime(v.o.frequency.value, cut - 0.2);
      v.o.frequency.exponentialRampToValueAtTime(40, cut + 0.15);
    }
  }

  _splash(when, gain, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800 + Math.random() * 2200, when);
    bp.frequency.exponentialRampToValueAtTime(400, when + 0.22);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
    src.connect(bp); bp.connect(g); g.connect(dest);
    src.start(when, Math.random() * 3, 0.3);
    src.stop(when + 0.3);
    src.onended = () => { try { g.disconnect(); bp.disconnect(); } catch { /* gone */ } };
  }

  _whoosh(when, gain) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, when);
    lp.frequency.exponentialRampToValueAtTime(120, when + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.62);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(when, Math.random() * 3, 0.7);
    src.stop(when + 0.7);
    src.onended = () => { try { g.disconnect(); lp.disconnect(); } catch { /* gone */ } };
  }

  /* --------------------------------------------------------- the watchers */

  /**
   * §3.4 — a very quiet, high click, HRTF-panned to the watcher's actual
   * position. Never quite locatable, always somewhere you are not looking.
   */
  watcherClick(worldPos, camera) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;

    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.3;
    if (panner.positionX) {
      panner.positionX.value = worldPos.x;
      panner.positionY.value = worldPos.y;
      panner.positionZ.value = worldPos.z;
    } else {
      panner.setPosition(worldPos.x, worldPos.y, worldPos.z);
    }

    const count = 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const when = t + i * (0.045 + Math.random() * 0.09);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 2600 + Math.random() * 3600;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = o.frequency.value;
      bp.Q.value = 9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.05, when + 0.0016);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.012 + Math.random() * 0.02);
      o.connect(bp); bp.connect(g); g.connect(panner);
      o.start(when); o.stop(when + 0.05);
      o.onended = () => { try { g.disconnect(); bp.disconnect(); } catch { /* gone */ } };
    }

    panner.connect(this.master);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    panner.connect(send);
    send.connect(this.sendBus);
    setTimeout(() => { try { panner.disconnect(); send.disconnect(); } catch { /* gone */ } }, 1400);
  }

  /** A long, unplaceable groan from a long way down. */
  groan(intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.1;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const start = 88 + Math.random() * 60;
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(start * 0.33, t + 5.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 5.5);
    lp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10 * intensity, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6.0);
    o.connect(lp); lp.connect(g);
    g.connect(this.master); g.connect(this.sendBus);
    o.start(t); o.stop(t + 6.2);
    o.onended = () => { try { g.disconnect(); lp.disconnect(); } catch { /* gone */ } };
  }

  /* ------------------------------------------------------------- act five */

  doorHandle() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // Wet metal, seized with corrosion, giving way.
    for (let i = 0; i < 5; i++) {
      const when = t + i * 0.055 + Math.random() * 0.02;
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 2400;
      bp.Q.value = 14;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.10, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(when, Math.random() * 3, 0.15); src.stop(when + 0.15);
    }
    this._thump(t + 0.34, 0.26, 70);
  }

  doorOpen() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // A long hinge shriek, and water letting go of the frame.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(210, t);
    o.frequency.linearRampToValueAtTime(430, t + 1.7);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 12;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    o.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.sendBus);
    o.start(t); o.stop(t + 2.2);

    for (let i = 0; i < 9; i++) this._splash(t + 0.2 + Math.random() * 1.8, 0.05 + Math.random() * 0.09, this.master);
    this._whoosh(t + 1.2, 0.30);
  }

  /** §4, Act 5 — the sound of somewhere with a floor. */
  playEnding() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.25;

    this.setUnderwater(0, 0.2);
    this.masterTarget = 1;

    // Kill the ocean.
    for (const bus of [this.waterBus, this.airBus, this.rumbleBus, this.breathBus]) {
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.18);
    }
    this.reverbGain.gain.setTargetAtTime(0.10, ctx.currentTime, 0.3);

    /* --- fluorescent tube hum: mains harmonics plus a dying ballast --- */
    const hum = ctx.createGain();
    hum.gain.setValueAtTime(0.0001, t);
    hum.gain.exponentialRampToValueAtTime(0.16, t + 1.1);
    hum.connect(this.master);
    this.endHum = hum;

    for (const [f, a] of [[50, 0.55], [100, 0.32], [150, 0.18], [200, 0.08], [4300, 0.030]]) {
      const o = ctx.createOscillator();
      o.type = f > 1000 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a * 0.25;
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass'; bp.frequency.value = f > 1000 ? 9000 : 420;
      o.connect(bp); bp.connect(g); g.connect(hum);
      o.start(t);
      // A tube that is about to go.
      if (f === 100) {
        const flick = ctx.createOscillator();
        flick.type = 'square';
        flick.frequency.value = 0.23;
        const fg = ctx.createGain();
        fg.gain.value = a * 0.09;
        flick.connect(fg); fg.connect(g.gain);
        flick.start(t);
      }
    }

    /* --- footsteps on dry concrete --- */
    for (let i = 0; i < 7; i++) {
      const when = t + 1.9 + i * (0.58 + Math.random() * 0.06);
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, when);
      bp.frequency.exponentialRampToValueAtTime(320, when + 0.12);
      bp.Q.value = 1.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.11 - i * 0.008, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.16);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      const send = ctx.createGain(); send.gain.value = 0.30;
      g.connect(send); send.connect(this.sendBus);
      src.start(when, Math.random() * 3, 0.2); src.stop(when + 0.2);
      this._thump(when, 0.05, 96);
    }
  }

  /* ---------------------------------------------------------------- state */

  setUnderwater(amount, time = 0.6) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // §4 Act 3 — the muffling as your ears go under.
    const target = lerp(19000, 340, saturate(amount));
    this.subFilter.frequency.setTargetAtTime(target, t, time);
    this.subShelf.gain.setTargetAtTime(lerp(0, -16, saturate(amount)), t, time);
    this.reverbGain.gain.setTargetAtTime(lerp(0.42, 0.95, saturate(amount)), t, time);
  }

  fadeOut(seconds = 2) {
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, seconds / 3);
  }

  setMasterMuted(muted) {
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(muted ? 0.0001 : this.masterTarget, this.ctx.currentTime, 0.25);
  }

  /** Called every frame with the current world state. */
  update(dt, state, camera, leviathanProximity = 0) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    /* --- listener follows the camera, which is what makes HRTF work --- */
    const l = this.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, now, 0.02);
      l.positionY.setTargetAtTime(p.y, now, 0.02);
      l.positionZ.setTargetAtTime(p.z, now, 0.02);
      l.forwardX.setTargetAtTime(fx, now, 0.02);
      l.forwardY.setTargetAtTime(fy, now, 0.02);
      l.forwardZ.setTargetAtTime(fz, now, 0.02);
      l.upX.setTargetAtTime(ux, now, 0.02);
      l.upY.setTargetAtTime(uy, now, 0.02);
      l.upZ.setTargetAtTime(uz, now, 0.02);
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }

    /* --- bus levels follow the act --- */
    const sub = state.submersion;
    this.waterBus.gain.setTargetAtTime(lerp(0.34, 0.10, sub) * state.ambienceLevel, now, 0.4);
    this.airBus.gain.setTargetAtTime(lerp(0.18, 0.02, sub) * state.ambienceLevel, now, 0.5);
    this.breathBus.gain.setTargetAtTime(this.breathGain, now, 0.4);
    this.rumbleBus.gain.setTargetAtTime(
      state.rumbleLevel + leviathanProximity * 0.85, now, 0.6,
    );

    /* --- breathing --- */
    if (this.breathGain > 0.001) {
      while (this._breathNext < now + 0.5) {
        const cycle = this.breathRate;
        const intensity = state.breathIntensity ?? 0.4;
        this._breath(true, intensity, this._breathNext);
        this._breath(false, intensity, this._breathNext + cycle * 0.46);
        this._breathNext += cycle * (0.94 + Math.random() * 0.16);
      }
    } else {
      this._breathNext = Math.max(this._breathNext, now);
    }

    /* --- heartbeat (Act 3) --- */
    if (this.heartGain > 0.002) {
      while (this._heartNext < now + 0.4) {
        this._thump(this._heartNext, this.heartGain * 0.55, 52);
        this._thump(this._heartNext + 0.20, this.heartGain * 0.34, 46);
        this._heartNext += this.heartRate;
      }
    } else {
      this._heartNext = Math.max(this._heartNext, now);
    }

    /* --- the odd drip or lap right by your ear --- */
    if (state.ambienceLevel > 0.05 && now > this._dropNext) {
      this._splash(now + 0.05, 0.02 + Math.random() * 0.045, this.waterFilter);
      this._dropNext = now + 1.6 + Math.random() * 6.5;
    }

    /* --- distant groans, more often as the level goes on --- */
    if (now > this._groanNext && state.groansEnabled) {
      this.groan(0.6 + Math.random() * 0.7);
      this._groanNext = now + 34 + Math.random() * 66;
    }
  }

  dispose() {
    if (!this.ctx) return;
    try { this.ctx.close(); } catch { /* already closed */ }
    this.ready = false;
  }
}
