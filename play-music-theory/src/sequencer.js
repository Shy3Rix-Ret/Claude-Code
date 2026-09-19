// Die Uhr.
//
// setInterval ist für Musik unbrauchbar: der Browser verzögert Timer um zig
// Millisekunden, und das hört man sofort. Also der übliche und einzig richtige
// Aufbau — ein grober Timer sieht regelmäßig nach, welche Noten im nächsten
// Fenster fällig sind, und plant sie mit exakten Zeitstempeln in die
// Audio-Hardware ein. Die Darstellung liest ihre Position danach direkt aus
// der Audio-Uhr, nicht aus einem Frame-Zähler.

import { AUDIO } from './config.js';
import { swingBeat } from './strokes.js';

export function createSequencer({ engine, getPlan }) {
  const { ctx } = engine;
  let timer = null;
  let playing = false;

  let anchorTime = 0;    // Audio-Zeit, zu der anchorBeat galt
  let anchorBeat = 0;    // musikalische Position an diesem Zeitpunkt
  let secPerBeat = 60 / 96;
  let cursor = 0;        // bis hierhin wurde geplant (absolute Schläge)
  let lastClickStep = -1;
  const onTick = new Set();

  function beatToTime(beat) {
    return anchorTime + (beat - anchorBeat) * secPerBeat;
  }

  function timeToBeat(time) {
    return anchorBeat + (time - anchorTime) / secPerBeat;
  }

  /** Tempo ändern, ohne dass die Schleife springt: der aktuelle Punkt wird
   *  zum neuen Ankerpunkt. Genau das fehlte laut Bewertungen. */
  function setBpm(bpm) {
    const now = ctx.currentTime;
    if (playing) {
      anchorBeat = timeToBeat(now);
      anchorTime = now;
    }
    secPerBeat = 60 / bpm;
  }

  function schedule() {
    const plan = getPlan();
    const { notes, loopBeats, stepsPerBeat, swing, triplet, metronome, beatsPerBar } = plan;
    if (!loopBeats) return;

    const horizon = ctx.currentTime + AUDIO.scheduleAheadSec;
    const untilBeat = timeToBeat(horizon);

    // Fenster von cursor bis untilBeat abarbeiten, Schleife für Schleife.
    let guard = 0;
    while (cursor < untilBeat && guard < 2000) {
      guard += 1;
      const loopIndex = Math.floor(cursor / loopBeats);
      const loopStart = loopIndex * loopBeats;
      const localFrom = cursor - loopStart;
      const localTo = Math.min(loopBeats, untilBeat - loopStart);

      for (const n of notes) {
        if (n.startBeat < localFrom || n.startBeat >= localTo) continue;
        const sStart = swingBeat(n.startBeat, stepsPerBeat, swing, triplet);
        const sEnd = swingBeat(n.startBeat + n.durBeats, stepsPerBeat, swing, triplet);
        const when = beatToTime(loopStart + sStart);
        if (when < ctx.currentTime - 0.02) continue;
        engine.note({
          midi: n.midi,
          pen: n.pen,
          when,
          dur: Math.max(0.05, (sEnd - sStart) * secPerBeat),
          velocity: n.velocity,
        });
      }

      if (metronome) {
        const first = Math.ceil(localFrom - 1e-9);
        for (let b = first; b < localTo; b += 1) {
          const step = loopStart + b;
          if (step === lastClickStep) continue;
          lastClickStep = step;
          engine.click(beatToTime(step), b % beatsPerBar === 0);
        }
      }

      if (localTo >= loopBeats) cursor = loopStart + loopBeats;
      else { cursor = loopStart + localTo; break; }
    }

    for (const fn of onTick) fn();
  }

  return {
    get playing() { return playing; },

    /** Position innerhalb der Schleife, in Schlägen — für den Abspielkopf. */
    position(loopBeats) {
      if (!loopBeats) return 0;
      const b = playing ? timeToBeat(ctx.currentTime) : anchorBeat;
      const m = b % loopBeats;
      return m < 0 ? m + loopBeats : m;
    },

    start(fromBeat = null) {
      if (playing) return;
      playing = true;
      anchorBeat = fromBeat ?? anchorBeat;
      anchorTime = ctx.currentTime + 0.06;   // kleiner Vorlauf gegen Aussetzer
      cursor = anchorBeat;
      lastClickStep = -1;
      schedule();
      timer = setInterval(schedule, AUDIO.lookaheadMs);
    },

    stop() {
      if (playing) {
        // Position festhalten, sonst springt der Abspielkopf beim Anhalten
        // auf den Anfang zurück und man verliert die Stelle.
        anchorBeat = timeToBeat(ctx.currentTime);
        anchorTime = ctx.currentTime;
      }
      playing = false;
      clearInterval(timer);
      timer = null;
    },

    rewind() {
      anchorBeat = 0;
      anchorTime = ctx.currentTime;
      cursor = 0;
      lastClickStep = -1;
    },

    setBpm,

    /** Nach einer Änderung an Zeichnung oder Raster: den bereits geplanten
     *  Vorlauf verwerfen, damit das Neue sofort greift. */
    reflow() {
      if (!playing) return;
      cursor = timeToBeat(ctx.currentTime);
    },

    onTick(fn) { onTick.add(fn); return () => onTick.delete(fn); },
  };
}
