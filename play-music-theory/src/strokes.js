// Von der Linie zur Note.
//
// Ein Strich ist eine Polylinie in musikalischen Koordinaten: t in Schlägen,
// y als Höhe von 0 (unten) bis 1 (oben). Beides ist bewusst NICHT in Pixeln
// und nicht in Rasterzellen gespeichert:
//
//   • t in Schlägen  → Quantisierung darf sich ändern, ohne die Zeichnung
//                      anzufassen.
//   • y normalisiert → wer die Skala wechselt, behält exakt dieselbe Form und
//                      bekommt dieselbe Melodie in der neuen Tonart. Genau das
//                      ist der Reiz des Instruments.
//
// Die Abtastung macht nebenbei etwas, das ein naives "ein Punkt = eine Note"
// nie hinbekommt: ein senkrechter Strich trifft mehrere Zeilen im selben
// Schritt und wird zum Akkord, ein waagerechter wird zu EINER gehaltenen Note
// statt zu zwanzig Wiederholungen.

import { BRUSH_BY_ID, LIMITS } from './config.js';

/** Feinheit der Abtastung in Rasterzellen. Kleiner = genauer, teurer. */
const SAMPLE_STEP = 0.34;

/**
 * @returns {Array<{startBeat,durBeats,midi,pen,velocity,row,step,steps,strokeId}>}
 *          nach startBeat sortiert.
 */
export function strokesToNotes({ strokes, ladder, totalBeats, stepsPerBeat }) {
  const rows = ladder.length;
  const totalSteps = Math.round(totalBeats * stepsPerBeat);
  if (!rows || !totalSteps) return [];

  const notes = [];

  for (const stroke of strokes) {
    const brush = BRUSH_BY_ID[stroke.brush] ?? BRUSH_BY_ID.med;
    // Map: row → Map(step → {vel, n})
    const byRow = new Map();

    const put = (step, row, vel) => {
      if (step < 0 || step >= totalSteps || row < 0 || row >= rows) return;
      let lane = byRow.get(row);
      if (!lane) { lane = new Map(); byRow.set(row, lane); }
      const cell = lane.get(step);
      if (cell) { cell.vel += vel; cell.n += 1; }
      else lane.set(step, { vel, n: 1 });
    };

    const pts = stroke.points;
    if (pts.length === 1) {
      const p = pts[0];
      put(Math.floor(p.t * stepsPerBeat), rowAt(p.y, rows), p.p);
    }

    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      // Segmentlänge in Zellen — davon hängt ab, wie fein wir abtasten.
      const dStep = (b.t - a.t) * stepsPerBeat;
      const dRow = (b.y - a.y) * (rows - 1);
      const len = Math.hypot(dStep, dRow);
      const n = Math.max(1, Math.ceil(len / SAMPLE_STEP));
      for (let k = 0; k <= n; k += 1) {
        const u = k / n;
        const t = a.t + (b.t - a.t) * u;
        const y = a.y + (b.y - a.y) * u;
        const p = a.p + (b.p - a.p) * u;
        put(Math.floor(t * stepsPerBeat), rowAt(y, rows), p);
      }
    }

    // Zusammenhängende Schritte derselben Zeile verschmelzen zu einer Note.
    for (const [row, lane] of byRow) {
      const steps = [...lane.keys()].sort((x, y) => x - y);
      let runStart = steps[0];
      let prev = steps[0];
      let velSum = 0;
      let velN = 0;

      const flush = (endStepInclusive) => {
        const count = endStepInclusive - runStart + 1;
        const avg = velN ? velSum / velN : 0.8;
        notes.push({
          strokeId: stroke.id,
          pen: stroke.pen,
          row,
          midi: ladder[row].midi,
          step: runStart,
          steps: count,
          startBeat: runStart / stepsPerBeat,
          durBeats: count / stepsPerBeat,
          velocity: clamp(avg * brush.velocity, 0.08, 1),
        });
      };

      for (const s of steps) {
        if (s > prev + 1) { flush(prev); runStart = s; velSum = 0; velN = 0; }
        const cell = lane.get(s);
        velSum += cell.vel / cell.n;
        velN += 1;
        prev = s;
      }
      flush(prev);
    }
  }

  notes.sort((a, b) => a.startBeat - b.startBeat || a.midi - b.midi);
  return notes;
}

function rowAt(y, rows) {
  return clamp(Math.round(y * (rows - 1)), 0, rows - 1);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Swing verschiebt jeden zweiten Schritt nach hinten. Bewusst erst hier und
 * nicht beim Zeichnen: so bleibt das Raster ehrlich und Swing lässt sich
 * während des Abspielens drehen.
 */
export function swingBeat(beat, stepsPerBeat, swing, triplet) {
  if (!swing || triplet) return beat;
  const pairLen = 2 / stepsPerBeat;           // ein Paar aus zwei Schritten
  const pairIndex = Math.floor(beat / pairLen);
  const within = beat - pairIndex * pairLen;
  const half = pairLen / 2;
  const shifted = swing * half;               // um so viel wandert die Mitte
  if (within <= half) {
    // erste Hälfte wird gedehnt
    return pairIndex * pairLen + (within / half) * (half + shifted);
  }
  // zweite Hälfte wird gestaucht
  const u = (within - half) / half;
  return pairIndex * pairLen + half + shifted + u * (half - shifted);
}

/** Welche Striche liegen nahe genug an (t,y), um vom Radierer erfasst zu werden? */
export function strokesAt(strokes, t, y, radiusT, radiusY) {
  const hits = [];
  for (const stroke of strokes) {
    if (nearStroke(stroke, t, y, radiusT, radiusY)) hits.push(stroke.id);
  }
  return hits;
}

function nearStroke(stroke, t, y, rt, ry) {
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[i + 1] ?? a;
    // Abstand zum Segment, in normalisierten Einheiten gemessen, damit
    // Zeit- und Höhenachse gleich "schwer" wiegen.
    const ax = a.t / rt, ay = a.y / ry;
    const bx = b.t / rt, by = b.y / ry;
    const px = t / rt, py = y / ry;
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const len2 = vx * vx + vy * vy;
    const u = len2 > 0 ? clamp((wx * vx + wy * vy) / len2, 0, 1) : 0;
    const dx = wx - vx * u, dy = wy - vy * u;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

/** Punkte ausdünnen: Zeigergeräte liefern deutlich mehr, als man braucht. */
export function simplify(points, tolT, tolY) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const last = out[out.length - 1];
    const p = points[i];
    if (Math.abs(p.t - last.t) >= tolT || Math.abs(p.y - last.y) >= tolY) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out.length > LIMITS.maxPointsPerStroke
    ? out.filter((_, i) => i % 2 === 0)
    : out;
}

export function strokeBounds(stroke) {
  let t0 = Infinity, t1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of stroke.points) {
    if (p.t < t0) t0 = p.t;
    if (p.t > t1) t1 = p.t;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { t0, t1, y0, y1 };
}
