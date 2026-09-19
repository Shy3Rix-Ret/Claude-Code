// Offline-Rendering für den Export. Derselbe Stimmen-Code, derselbe Signalweg,
// nur schneller als Echtzeit — was man exportiert, ist was man gehört hat.

import { createEngine } from './engine.js';
import { swingBeat } from '../strokes.js';

export async function renderLoop({ notes, bpm, loopBeats, stepsPerBeat, swing, triplet, repeats = 1, volume = 0.85, sampleRate = 44100, tail = 3 }) {
  const secPerBeat = 60 / bpm;
  const seconds = loopBeats * secPerBeat * repeats + tail;
  const Ctor = globalThis.OfflineAudioContext ?? globalThis.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('Dieser Browser kann keine Audiodatei erzeugen.');

  const ctx = new Ctor(2, Math.ceil(seconds * sampleRate), sampleRate);
  // Im Offline-Rendering gibt es keine CPU-Not: Stimmenbegrenzung aus, sonst
  // fehlten in der Datei Töne, die man live sehr wohl gehört hat.
  const engine = createEngine(ctx, { volume, limitVoices: false });

  for (let rep = 0; rep < repeats; rep += 1) {
    const base = rep * loopBeats * secPerBeat;
    for (const n of notes) {
      const s = swingBeat(n.startBeat, stepsPerBeat, swing, triplet);
      const e = swingBeat(n.startBeat + n.durBeats, stepsPerBeat, swing, triplet);
      engine.note({
        midi: n.midi,
        pen: n.pen,
        when: base + s * secPerBeat + 0.02,
        dur: Math.max(0.05, (e - s) * secPerBeat),
        velocity: n.velocity,
      });
    }
  }

  return ctx.startRendering();
}
