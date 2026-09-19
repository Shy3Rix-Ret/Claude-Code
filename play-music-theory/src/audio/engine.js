// Der Signalweg. Absichtlich klein gehalten:
//
//   Stimme ─┬─────────────────────────► Dry ─┐
//           └─ Send ─► Hall (Convolver) ─────┴─► Summe ─► Limiter ─► Ausgang
//
// Der Hall ist eine im Code erzeugte Impulsantwort. Eine geladene .wav wäre
// besser — und würde genau das kaputtmachen, was die App ausmacht: dass sie
// offline und ohne eine einzige Netzwerkanfrage funktioniert.

import { AUDIO, PEN_BY_ID } from '../config.js';
import { playVoice, playClick } from './voices.js';

/** Exponentiell abfallendes Rauschen mit leicht dekorreliertem Stereobild. */
export function makeImpulse(ctx, seconds = AUDIO.reverbSeconds) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    // Etwas Vorlauf, damit der Hall nicht im selben Moment einsetzt wie der Ton.
    const preDelay = Math.floor(ctx.sampleRate * 0.012);
    for (let i = 0; i < len; i += 1) {
      if (i < preDelay) { d[i] = 0; continue; }
      const u = (i - preDelay) / (len - preDelay);
      const decay = Math.pow(1 - u, 2.6);
      // Die ersten 80 ms etwas körniger: das liest das Ohr als Raumgröße.
      const early = u < 0.03 ? 1 + Math.sin(u * 900 + ch) * 0.5 : 1;
      d[i] = (Math.random() * 2 - 1) * decay * early;
    }
  }
  return buf;
}

export function createEngine(ctx, { volume = AUDIO.masterGain, limitVoices = true } = {}) {
  const master = ctx.createGain();
  master.gain.value = volume;

  // Ein Kompressor mit hoher Ratio als Schutz: dichte Zeichnungen erzeugen
  // gern dreißig gleichzeitige Töne, und das soll nicht zerren.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;

  const sum = ctx.createGain();
  const dry = ctx.createGain();
  const verb = ctx.createConvolver();
  const verbReturn = ctx.createGain();
  verbReturn.gain.value = 0.9;
  verb.buffer = makeImpulse(ctx);

  // Hall ohne Tiefbass klingt aufgeräumter.
  const verbCut = ctx.createBiquadFilter();
  verbCut.type = 'highpass';
  verbCut.frequency.value = 260;

  dry.connect(sum);
  verb.connect(verbCut).connect(verbReturn).connect(sum);
  sum.connect(limiter).connect(master).connect(ctx.destination);

  // Pro Stift ein eigener Send-Regler: Glocken dürfen schwimmen, Marimba nicht.
  const sends = new Map();
  for (const [id, pen] of Object.entries(PEN_BY_ID)) {
    const input = ctx.createGain();
    const toVerb = ctx.createGain();
    toVerb.gain.value = pen.reverb;
    input.connect(dry);
    input.connect(toVerb).connect(verb);
    sends.set(id, input);
  }

  const active = [];   // { end } — nur zur Stimmenbegrenzung
  let dropped = 0;

  function prune(now) {
    let w = 0;
    for (let i = 0; i < active.length; i += 1) {
      if (active[i].end > now) active[w++] = active[i];
    }
    active.length = w;
  }

  return {
    ctx,
    master,
    get droppedVoices() { return dropped; },

    setVolume(v, ramp = 0.05) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(v, now, ramp);
    },

    /** @returns true, wenn die Note tatsächlich geplant wurde. */
    note({ midi, pen, when, dur, velocity }) {
      if (limitVoices) {
        prune(when);
        if (active.length >= AUDIO.maxVoices) { dropped += 1; return false; }
      }
      const out = sends.get(pen) ?? sends.get('softkeys');
      const v = playVoice(ctx, out, pen, {
        midi, t0: when, dur: Math.max(dur, AUDIO.noteMinSec), velocity,
      });
      const entry = { end: v.end };
      active.push(entry);
      disposeAfter(ctx, v, entry, active);
      return true;
    },

    click(when, accent) {
      const v = playClick(ctx, dry, when, accent);
      disposeAfter(ctx, v, null, null);
    },

    /** Kurzer Ton beim Zeichnen/MIDI-Spielen, ohne den Scheduler zu behelligen. */
    ping({ midi, pen, velocity = 0.8, dur = 0.24 }) {
      this.note({ midi, pen, when: ctx.currentTime + 0.005, dur, velocity });
    },

    dispose() {
      try { master.disconnect(); } catch { /* egal */ }
    },
  };
}

function disposeAfter(ctx, voice, entry, list) {
  const nodes = voice.cleanup ?? [];
  const last = nodes.find((n) => typeof n.onended !== 'undefined' && n.start);
  const kill = () => {
    for (const n of nodes) { try { n.disconnect(); } catch { /* egal */ } }
    if (entry && list) {
      const i = list.indexOf(entry);
      if (i >= 0) list.splice(i, 1);
    }
  };
  if (last) last.onended = kill;
}
