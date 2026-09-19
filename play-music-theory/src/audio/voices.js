// Vier Instrumente, komplett im Code erzeugt. Kein einziges Sample — die App
// lädt nichts nach und klingt offline genau wie online (§ Technisches).
//
// Jede Stimme bekommt den AudioContext übergeben, statt sich einen zu greifen.
// Das ist der Grund, warum der WAV-Export exakt dasselbe rendert, was man
// hört: derselbe Code läuft dort auf einem OfflineAudioContext.

import { midiToFreq } from '../theory.js';

/** Sanfter Anschlag ohne Knacken: nie hart auf 0 springen. */
const FLOOR = 0.0001;

function ampEnv(param, t0, dur, { attack, decay, sustain, release }, peak) {
  const a = Math.max(0.001, attack);
  const holdEnd = t0 + Math.max(dur, a + 0.01);
  param.setValueAtTime(FLOOR, t0);
  param.exponentialRampToValueAtTime(Math.max(peak, FLOOR), t0 + a);
  param.exponentialRampToValueAtTime(Math.max(peak * sustain, FLOOR), t0 + a + decay);
  param.setValueAtTime(Math.max(peak * sustain, FLOOR), holdEnd);
  param.exponentialRampToValueAtTime(FLOOR, holdEnd + release);
  return holdEnd + release;
}

/** Perkussiv: ein Anschlag, danach nur noch Abklingen. Die gezeichnete Länge
 *  begrenzt den Ton, verlängert ihn aber nicht. */
function hitEnv(param, t0, decay, peak, maxLen) {
  const end = t0 + Math.min(decay, maxLen);
  param.setValueAtTime(FLOOR, t0);
  param.linearRampToValueAtTime(peak, t0 + 0.002);
  param.exponentialRampToValueAtTime(FLOOR, end);
  return end;
}

function osc(ctx, type, freq, t0) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  return o;
}

function gain(ctx, value = 0) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

let sharedNoise = new WeakMap();
function noiseBuffer(ctx) {
  let buf = sharedNoise.get(ctx);
  if (buf) return buf;
  buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  sharedNoise.set(ctx, buf);
  return buf;
}

// ── SoftKeys ────────────────────────────────────────────────────────────────
// Ein Rhodes ist im Kern 2:1-FM: ein Sinus moduliert einen Sinus eine Oktave
// tiefer, der Modulationsindex fällt schnell ab. Das gibt den glockigen
// Anschlag, der sofort in einen weichen Ton übergeht.
function softkeys(ctx, out, { freq, t0, dur, velocity }) {
  const amp = gain(ctx);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.setValueAtTime(Math.min(freq * 9 + 900, 9000), t0);
  tone.frequency.exponentialRampToValueAtTime(Math.min(freq * 4 + 500, 6000), t0 + 0.4);
  tone.Q.value = 0.6;

  const carrier = osc(ctx, 'sine', freq, t0);
  const mod = osc(ctx, 'sine', freq * 2, t0);
  const modIdx = gain(ctx, 0);
  modIdx.gain.setValueAtTime(freq * (1.8 + velocity * 2.4), t0);
  modIdx.gain.exponentialRampToValueAtTime(freq * 0.18, t0 + 0.28);
  mod.connect(modIdx).connect(carrier.frequency);

  // Körper: leicht verstimmtes Dreieck darunter
  const body = osc(ctx, 'triangle', freq * 0.999, t0);
  const bodyGain = gain(ctx, 0.28);

  carrier.connect(amp);
  body.connect(bodyGain).connect(amp);
  amp.connect(tone).connect(out);

  const end = ampEnv(amp.gain, t0, dur, {
    attack: 0.006, decay: 0.55, sustain: 0.22, release: 0.38,
  }, 0.5 * velocity);

  carrier.start(t0); mod.start(t0); body.start(t0);
  carrier.stop(end + 0.05); mod.stop(end + 0.05); body.stop(end + 0.05);
  return { end, cleanup: [carrier, mod, body, amp, tone, modIdx, bodyGain] };
}

// ── Marimba ─────────────────────────────────────────────────────────────────
// Eine Marimbastab ist inharmonisch gestimmt: die Obertöne liegen etwa bei
// 4× und 10× — daher das Holzige. Hohe Töne klingen kürzer aus als tiefe.
function marimba(ctx, out, { freq, t0, dur, velocity }) {
  const amp = gain(ctx, 1);
  amp.connect(out);
  const nodes = [amp];
  const baseDecay = 1.5 * Math.pow(220 / Math.max(freq, 60), 0.45);
  const maxLen = dur + baseDecay;

  const partials = [
    { mult: 1,    level: 1.0,  decay: baseDecay },
    { mult: 3.93, level: 0.34, decay: baseDecay * 0.32 },
    { mult: 9.6,  level: 0.12, decay: baseDecay * 0.14 },
  ];
  let end = t0;
  for (const p of partials) {
    const f = freq * p.mult;
    if (f > ctx.sampleRate * 0.45) continue;
    const o = osc(ctx, 'sine', f, t0);
    const g = gain(ctx, 0);
    o.connect(g).connect(amp);
    const e = hitEnv(g.gain, t0, p.decay, 0.42 * p.level * velocity, maxLen);
    end = Math.max(end, e);
    o.start(t0); o.stop(e + 0.03);
    nodes.push(o, g);
  }

  // Der Schlägel selbst: ein kurzer gefilterter Rauschimpuls.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.playbackRate.value = 1;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(freq * 4.5, 7000);
  bp.Q.value = 1.2;
  const ng = gain(ctx, 0);
  src.connect(bp).connect(ng).connect(amp);
  hitEnv(ng.gain, t0, 0.028, 0.16 * velocity, 0.05);
  src.start(t0, Math.random() * 0.4);
  src.stop(t0 + 0.06);
  nodes.push(src, bp, ng);

  return { end, cleanup: nodes };
}

// ── Warm Synth ──────────────────────────────────────────────────────────────
// Zwei verstimmte Sägezähne durch ein Filter mit eigener Hüllkurve. Der Sub
// darunter hält Bassfiguren zusammen, ohne zu dröhnen.
function warm(ctx, out, { freq, t0, dur, velocity }) {
  const amp = gain(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 3.2;
  const fBase = Math.min(freq * 2.2 + 220, 1400);
  const fPeak = Math.min(freq * 7 + 900, 6200);
  filter.frequency.setValueAtTime(fBase, t0);
  filter.frequency.linearRampToValueAtTime(fPeak * (0.5 + velocity * 0.5), t0 + 0.12);
  filter.frequency.exponentialRampToValueAtTime(Math.max(fBase * 1.2, 200), t0 + 0.12 + Math.max(dur, 0.4));

  const a = osc(ctx, 'sawtooth', freq, t0);
  const b = osc(ctx, 'sawtooth', freq, t0);
  a.detune.value = -6.5;
  b.detune.value = 6.5;
  const sub = osc(ctx, 'sine', freq / 2, t0);
  const subG = gain(ctx, 0.3);

  // Langsame Schwebung: hält die Fläche in Bewegung.
  const lfo = osc(ctx, 'sine', 0.24 + Math.random() * 0.12, t0);
  const lfoG = gain(ctx, 4.5);
  lfo.connect(lfoG).connect(b.detune);

  const mixA = gain(ctx, 0.42);
  const mixB = gain(ctx, 0.42);
  a.connect(mixA).connect(filter);
  b.connect(mixB).connect(filter);
  sub.connect(subG).connect(filter);
  filter.connect(amp).connect(out);

  const end = ampEnv(amp.gain, t0, dur, {
    attack: 0.055, decay: 0.3, sustain: 0.62, release: 0.5,
  }, 0.34 * velocity);

  for (const n of [a, b, sub, lfo]) { n.start(t0); n.stop(end + 0.05); }
  return { end, cleanup: [a, b, sub, lfo, lfoG, mixA, mixB, subG, filter, amp] };
}

// ── Glocken ─────────────────────────────────────────────────────────────────
// FM mit einem krummen Verhältnis (3.51:1). Krumm ist hier der Punkt: ganze
// Zahlen klingen nach Orgel, krumme nach Metall.
function bells(ctx, out, { freq, t0, dur, velocity }) {
  const amp = gain(ctx, 1);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = Math.min(freq * 0.7, 900);
  amp.connect(hp).connect(out);

  const decay = 2.6 * Math.pow(330 / Math.max(freq, 80), 0.3);
  const maxLen = dur + decay;

  const carrier = osc(ctx, 'sine', freq, t0);
  const mod = osc(ctx, 'sine', freq * 3.51, t0);
  const modIdx = gain(ctx, 0);
  modIdx.gain.setValueAtTime(freq * (3 + velocity * 5), t0);
  modIdx.gain.exponentialRampToValueAtTime(freq * 0.05, t0 + Math.min(1.4, maxLen));
  mod.connect(modIdx).connect(carrier.frequency);

  const cg = gain(ctx, 0);
  carrier.connect(cg).connect(amp);
  const end = hitEnv(cg.gain, t0, decay, 0.3 * velocity, maxLen);

  // Zweiter, leiserer Teilton macht den Anschlag glasig.
  const strike = osc(ctx, 'sine', freq * 2.76, t0);
  const sg = gain(ctx, 0);
  strike.connect(sg).connect(amp);
  hitEnv(sg.gain, t0, Math.min(decay * 0.35, maxLen), 0.12 * velocity, maxLen);

  carrier.start(t0); mod.start(t0); strike.start(t0);
  carrier.stop(end + 0.05); mod.stop(end + 0.05); strike.stop(end + 0.05);
  return { end, cleanup: [carrier, mod, modIdx, strike, cg, sg, amp, hp] };
}

const VOICES = { softkeys, marimba, warm, bells };

export function playVoice(ctx, out, penId, { midi, t0, dur, velocity }) {
  const fn = VOICES[penId] ?? softkeys;
  return fn(ctx, out, {
    freq: midiToFreq(midi),
    t0,
    dur: Math.max(dur, 0.02),
    velocity: Math.max(0.05, Math.min(1, velocity)),
  });
}

/** Metronom. Der Eins-Klick liegt höher — man hört den Taktanfang, ohne
 *  mitzuzählen. */
export function playClick(ctx, out, t0, accent) {
  const o = osc(ctx, 'square', accent ? 1760 : 1174, t0);
  const g = gain(ctx, 0);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  o.connect(g).connect(lp).connect(out);
  g.gain.setValueAtTime(FLOOR, t0);
  g.gain.linearRampToValueAtTime(accent ? 0.16 : 0.1, t0 + 0.001);
  g.gain.exponentialRampToValueAtTime(FLOOR, t0 + 0.035);
  o.start(t0);
  o.stop(t0 + 0.05);
  return { end: t0 + 0.05, cleanup: [o, g, lp] };
}

export { noiseBuffer };
