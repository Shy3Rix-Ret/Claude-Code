/**
 * Ambient sound, synthesised.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ AMBIENT-SOUND-TRIGGER                                                │
 * │                                                                      │
 * │ Browsers will not start audio without a gesture, so the whole engine  │
 * │ is built on the click that starts the scene: `Ambience.start()` is    │
 * │ the trigger, and it is called exactly once, from that click.          │
 * │                                                                      │
 * │ There is no audio file in this project on purpose — nothing here is   │
 * │ loaded over the network. If you would rather use one, this is the     │
 * │ place, and it is a three-line change:                                 │
 * │                                                                      │
 * │   const el = new Audio('assets/station-ambience.ogg');                │
 * │   el.loop = true; el.volume = 0.35;                                   │
 * │   el.play();            // inside start(), i.e. still in the gesture  │
 * │                                                                      │
 * │ Everything below can then be deleted. It is only here because a       │
 * │ station that has been empty for forty years should not be silent, and │
 * │ shipping a file was not an option.                                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * What it plays: a low hull drone, a draught through the broken windows whose
 * level follows how much of the hall is open to the star, occasional metallic
 * groans as the structure moves, and water finding its way down. Headphones
 * help; most of this lives below what a laptop speaker reproduces.
 */

import { AUDIO } from './config.js';
import { makeRng, clamp, lerp } from './util.js';

export class Ambience {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.rng = makeRng(0x4f21a);
    this._nextGroan = 6;
    this._nextDrip = 2;
  }

  /** The trigger. Must be called from inside a user gesture. */
  async start() {
    if (this.ctx) return this.ready;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;

    try {
      this.ctx = new AC();
    } catch {
      return false;
    }

    /* iOS inside an iframe does not reject resume() — it simply never settles.
     * A start that waits on that never arrives, so give it a deadline. */
    if (this.ctx.state === 'suspended') {
      await Promise.race([
        this.ctx.resume().catch(() => {}),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }

    try {
      this._build();
      this.ready = true;
    } catch {
      this.ready = false;
    }
    return this.ready;
  }

  _noiseBuffer(seconds = 4) {
    const { ctx } = this;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // Slightly pink: a one-pole filter on white. Flat white is too bright
      // for something that is meant to sound like air, not like a hiss.
      const w = this.rng() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      d[i] = last * 3.6;
    }
    return buf;
  }

  _build() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(AUDIO.master, now + 4.0);

    this.noise = this._noiseBuffer(5);

    /* ---- the hull. Three near-unison partials, slowly beating ---- */
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.5;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 220;
    droneFilter.Q.value = 0.6;
    this.droneFilter = droneFilter;
    this.droneGain.connect(droneFilter).connect(this.master);

    for (const [mult, gain, drift] of [[1, 0.55, 0.017], [1.5, 0.2, 0.023], [2.005, 0.11, 0.031]]) {
      const osc = ctx.createOscillator();
      osc.type = mult === 1 ? 'sine' : 'triangle';
      osc.frequency.value = AUDIO.droneHz * mult;

      const g = ctx.createGain();
      g.gain.value = gain;

      // Slow amplitude drift, so the drone never sits still.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = drift;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = gain * 0.5;
      lfo.connect(lfoGain).connect(g.gain);
      lfo.start();

      osc.connect(g).connect(this.droneGain);
      osc.start();
    }

    /* ---- the draught through the windows ---- */
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;

    const airBand = ctx.createBiquadFilter();
    airBand.type = 'bandpass';
    airBand.frequency.value = 640;
    airBand.Q.value = 0.55;

    this.airGain = ctx.createGain();
    this.airGain.gain.value = AUDIO.hissLevel;
    air.connect(airBand).connect(this.airGain).connect(this.master);
    air.start();

    // Gusts: a very slow LFO on top of the steady level.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.043;
    const gustGain = ctx.createGain();
    gustGain.gain.value = AUDIO.hissLevel * 0.75;
    gust.connect(gustGain).connect(this.airGain.gain);
    gust.start();

    /* ---- a very quiet mains hum, because something still has power ---- */
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 130;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.016;
    hum.connect(humFilter).connect(humGain).connect(this.master);
    hum.start();
    this.humGain = humGain;
  }

  /* ------------------------------------------------------------- events */

  /** Metal moving against metal, a long way off. */
  _groan() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 2.2 + this.rng() * 3.4;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.4 + this.rng() * 0.3;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    const f0 = 55 + this.rng() * 70;
    band.frequency.setValueAtTime(f0, t);
    band.frequency.exponentialRampToValueAtTime(f0 * (1.6 + this.rng()), t + dur);
    band.Q.value = 11 + this.rng() * 9;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10 + this.rng() * 0.10, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const pan = ctx.createStereoPanner?.();
    src.connect(band).connect(g);
    if (pan) {
      pan.pan.value = this.rng() * 2 - 1;
      g.connect(pan).connect(this.master);
    } else {
      g.connect(this.master);
    }

    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /** Water, arriving somewhere it should not. */
  _drip() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f = 700 + this.rng() * 1500;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.14);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035 + this.rng() * 0.03, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    const pan = ctx.createStereoPanner?.();
    osc.connect(g);
    if (pan) {
      pan.pan.value = this.rng() * 1.6 - 0.8;
      g.connect(pan).connect(this.master);
    } else {
      g.connect(this.master);
    }

    osc.start(t);
    osc.stop(t + 0.3);
  }

  /* ------------------------------------------------------------- update */

  update(dt, sun, player) {
    if (!this.ready || this.muted) return;

    /* The draught is louder when the hall is open to the star — not because
     * light makes wind, but because that is when the player is looking at the
     * hole it comes through, and the two want to agree. */
    const openness = 0.55 + sun.daylight * 0.75;
    this.airGain.gain.value = lerp(this.airGain.gain.value, AUDIO.hissLevel * openness, 0.02);
    this.droneFilter.frequency.value = lerp(
      this.droneFilter.frequency.value, 160 + sun.daylight * 190, 0.02);

    // Faster breathing when the player is moving; a room feels different when
    // you are crossing it.
    const effort = clamp((player?.speedFelt ?? 0) / 6, 0, 1);
    this.master.gain.value = lerp(this.master.gain.value, AUDIO.master * (1 + effort * 0.12), 0.05);

    this._nextGroan -= dt;
    if (this._nextGroan <= 0) {
      this._groan();
      const [a, b] = AUDIO.groanEvery;
      this._nextGroan = a + this.rng() * (b - a);
    }

    this._nextDrip -= dt;
    if (this._nextDrip <= 0) {
      this._drip();
      const [a, b] = AUDIO.dripEvery;
      this._nextDrip = a + this.rng() * (b - a);
    }
  }

  toggleMute() {
    if (!this.ready) return false;
    this.muted = !this.muted;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : AUDIO.master, now, 0.25);
    return this.muted;
  }
}
