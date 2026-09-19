// Beispiele. Nicht als abgetippte Punktlisten, sondern als kleine Generatoren —
// so bleiben sie lesbar, und man sieht, welche Geste welche Musik ergibt.
//
// Jedes Beispiel bringt seine eigenen Einstellungen mit: dasselbe Bild in
// einer anderen Tonart ist ein anderes Stück.

import { nextId } from './state.js';

const pt = (t, y, p = 0.85) => ({ t, y, p });

function stroke(pen, points, brush = 'med') {
  return { id: nextId(), pen, brush, points };
}

/** Eine Kurve aus einer Funktion y(t) abtasten. */
function curve(pen, t0, t1, fn, { steps = 48, brush = 'med', pressure = null } = {}) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const t = t0 + (t1 - t0) * u;
    pts.push(pt(t, clamp01(fn(u, t)), pressure ? pressure(u) : 0.85));
  }
  return stroke(pen, pts, brush);
}

/** Ein Punkt: kurzer Anschlag. */
function dot(pen, t, y, brush = 'med', p = 0.9) {
  return stroke(pen, [pt(t, y, p), pt(t + 0.02, y, p)], brush);
}

/** Senkrechter Strich = Akkord über den überstrichenen Bereich. */
function chord(pen, t, yLow, yHigh, brush = 'med') {
  return stroke(pen, [pt(t, yLow, 0.8), pt(t + 0.03, yHigh, 0.8)], brush);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const GALLERY = [
  {
    id: 'daydream',
    title: 'Tagtraum',
    blurb: 'Lange Bögen, die sich überlagern. Nichts passiert schnell.',
    settings: { bpm: 74, bars: 4, beatsPerBar: 4, quantize: '1/8', swing: 0, root: 5, scale: 'majorPent', lowOctave: 3, octaves: 3 },
    build: () => [
      curve('softkeys', 0, 7.5, (u) => 0.46 + Math.sin(u * Math.PI) * 0.26),
      curve('softkeys', 8, 15.5, (u) => 0.58 + Math.sin(u * Math.PI * 1.2) * 0.2),
      curve('warm', 0, 15.5, (u) => 0.16 + u * 0.1, { steps: 24, brush: 'bold' }),
      dot('bells', 3.5, 0.86, 'fine'),
      dot('bells', 7.5, 0.92, 'fine'),
      dot('bells', 11.5, 0.8, 'fine'),
      dot('bells', 15, 0.95, 'fine'),
    ],
  },
  {
    id: 'rainfall',
    title: 'Regenfall',
    blurb: 'Einzelne Tropfen von oben, ein Bass, der sie auffängt.',
    settings: { bpm: 108, bars: 4, beatsPerBar: 4, quantize: '1/16', swing: 0, root: 9, scale: 'minorPent', lowOctave: 3, octaves: 3 },
    build: () => {
      const out = [];
      // Pseudozufall mit fester Folge: das Beispiel sieht jedes Mal gleich aus.
      let seed = 7;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 26; i += 1) {
        const t = Math.round(rnd() * 63) / 4;
        const y = 0.55 + rnd() * 0.42;
        out.push(dot('marimba', t, y, rnd() > 0.7 ? 'bold' : 'fine', 0.5 + rnd() * 0.5));
      }
      out.push(curve('warm', 0, 15.5, (u) => 0.1 + Math.sin(u * Math.PI * 2) * 0.05, { steps: 32, brush: 'bold' }));
      out.push(dot('bells', 6, 0.97, 'fine'));
      out.push(dot('bells', 14, 0.93, 'fine'));
      return out;
    },
  },
  {
    id: 'sunrise',
    title: 'Sonnenaufgang',
    blurb: 'Eine einzige Linie von unten nach oben. Mehr braucht es nicht.',
    settings: { bpm: 92, bars: 4, beatsPerBar: 4, quantize: '1/8', swing: 0, root: 2, scale: 'lydian', lowOctave: 2, octaves: 4 },
    build: () => [
      curve('softkeys', 0, 14, (u) => Math.pow(u, 0.8) * 0.92 + 0.04, { steps: 60, pressure: (u) => 0.4 + u * 0.6 }),
      curve('warm', 0, 15.5, (u) => 0.06 + Math.pow(u, 1.6) * 0.2, { steps: 30, brush: 'bold' }),
      chord('bells', 14.2, 0.62, 0.98, 'fine'),
    ],
  },
  {
    id: 'heartbeat',
    title: 'Herzschlag',
    blurb: 'Zwei tiefe Schläge pro Takt, darüber ein Puls. Gut zum Weiterbauen.',
    settings: { bpm: 84, bars: 2, beatsPerBar: 4, quantize: '1/8', swing: 0.2, root: 0, scale: 'minor', lowOctave: 2, octaves: 3 },
    build: () => {
      const out = [];
      for (let bar = 0; bar < 2; bar += 1) {
        const b = bar * 4;
        out.push(dot('warm', b, 0.05, 'bold', 1));
        out.push(dot('warm', b + 0.5, 0.05, 'med', 0.6));
        out.push(dot('warm', b + 2, 0.12, 'bold', 0.9));
      }
      for (let i = 0; i < 8; i += 1) out.push(dot('marimba', i, 0.5 + (i % 4 === 0 ? 0.12 : 0), 'fine', i % 2 ? 0.45 : 0.8));
      out.push(curve('softkeys', 2.5, 5.5, (u) => 0.62 + Math.sin(u * Math.PI) * 0.16));
      return out;
    },
  },
  {
    id: 'staircase',
    title: 'Treppe',
    blurb: 'Gerade Stufen. Zeigt am deutlichsten, wie das Raster Töne rastert.',
    settings: { bpm: 126, bars: 2, beatsPerBar: 4, quantize: '1/16', swing: 0.34, root: 7, scale: 'mixolydian', lowOctave: 3, octaves: 2 },
    build: () => {
      const out = [];
      const steps = 8;
      for (let i = 0; i < steps; i += 1) {
        const y = i / (steps - 1) * 0.8 + 0.1;
        out.push(stroke('marimba', [pt(i, y, 0.9), pt(i + 0.85, y, 0.9)]));
      }
      out.push(stroke('warm', [pt(0, 0.08, 0.9), pt(7.9, 0.08, 0.9)], 'bold'));
      return out;
    },
  },
  {
    id: 'aurora',
    title: 'Nordlicht',
    blurb: 'Langsame Wellen, die nie ganz zusammenfallen.',
    settings: { bpm: 62, bars: 8, beatsPerBar: 4, quantize: '1/4', swing: 0, root: 4, scale: 'hirajoshi', lowOctave: 3, octaves: 3 },
    build: () => [
      curve('warm', 0, 31, (u) => 0.3 + Math.sin(u * Math.PI * 2) * 0.22, { steps: 90, brush: 'bold' }),
      curve('warm', 0, 31, (u) => 0.42 + Math.sin(u * Math.PI * 2.6 + 1.1) * 0.2, { steps: 90 }),
      curve('bells', 4, 28, (u) => 0.78 + Math.sin(u * Math.PI * 4) * 0.14, { steps: 40, brush: 'fine', pressure: () => 0.55 }),
      curve('softkeys', 8, 24, (u) => 0.56 + Math.cos(u * Math.PI * 1.5) * 0.14, { steps: 40 }),
    ],
  },
];

export function loadGalleryItem(item) {
  return { ...item.settings, title: item.title, strokes: item.build() };
}
