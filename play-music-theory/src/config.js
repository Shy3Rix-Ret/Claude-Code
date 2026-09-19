// Jede Stellschraube an einem Ort. Wer etwas am Gefühl der App ändern will,
// findet es hier — nicht verstreut über zwölf Module.

/** Die vier Stifte. Farbe und Klang sind dasselbe Ding: man wählt keinen
 *  Klang aus einer Liste, man greift zu einem Stift. */
export const PENS = [
  {
    id: 'softkeys',
    label: 'SoftKeys',
    hint: 'Weiches E-Piano, trägt Melodien',
    color: '#5ac8fa',
    glow: 'rgba(90,200,250,0.55)',
    midiProgram: 4,   // Electric Piano 1
    reverb: 0.22,
  },
  {
    id: 'marimba',
    label: 'Marimba',
    hint: 'Holzig, kurz, perkussiv',
    color: '#ffb340',
    glow: 'rgba(255,179,64,0.55)',
    midiProgram: 12,  // Marimba
    reverb: 0.16,
  },
  {
    id: 'warm',
    label: 'Warm Synth',
    hint: 'Breite Flächen und Bässe',
    color: '#c47dff',
    glow: 'rgba(196,125,255,0.5)',
    midiProgram: 89,  // Pad 2 (warm)
    reverb: 0.4,
  },
  {
    id: 'bells',
    label: 'Glocken',
    hint: 'Hell, glasig, langer Nachklang',
    color: '#5ee7a8',
    glow: 'rgba(94,231,168,0.55)',
    midiProgram: 14,  // Tubular Bells
    reverb: 0.55,
  },
];

export const PEN_BY_ID = Object.fromEntries(PENS.map((p) => [p.id, p]));

/** Quantisierung: in wie viele Schritte ein Viertel zerfällt.
 *  Das ist gleichzeitig die Rasterbreite — was man sieht, ist was man hört. */
export const QUANTIZE_OPTIONS = [
  { id: '1/4',   label: '1/4',       perBeat: 1,  triplet: false },
  { id: '1/8',   label: '1/8',       perBeat: 2,  triplet: false },
  { id: '1/8T',  label: '1/8 Trio.', perBeat: 3,  triplet: true  },
  { id: '1/16',  label: '1/16',      perBeat: 4,  triplet: false },
  { id: '1/16T', label: '1/16 Trio.',perBeat: 6,  triplet: true  },
  { id: '1/32',  label: '1/32',      perBeat: 8,  triplet: false },
];

export const QUANTIZE_BY_ID = Object.fromEntries(QUANTIZE_OPTIONS.map((q) => [q.id, q]));

export const BAR_OPTIONS = [1, 2, 4, 8, 16, 32];

export const BRUSH_SIZES = [
  { id: 'fine',  label: 'Fein',   width: 0.30, velocity: 0.72 },
  { id: 'med',   label: 'Mittel', width: 0.52, velocity: 0.85 },
  { id: 'bold',  label: 'Kräftig',width: 0.78, velocity: 1.0  },
];

export const BRUSH_BY_ID = Object.fromEntries(BRUSH_SIZES.map((b) => [b.id, b]));

export const LIMITS = {
  bpmMin: 40,
  bpmMax: 240,
  octavesMin: 1,
  octavesMax: 5,
  lowOctaveMin: 1,
  lowOctaveMax: 6,
  swingMax: 0.72,
  maxStrokes: 900,        // jenseits davon wird auch ein starkes Handy langsam
  maxPointsPerStroke: 4000,
  historyDepth: 120,
};

export const AUDIO = {
  lookaheadMs: 25,        // wie oft der Scheduler nachsieht
  scheduleAheadSec: 0.14, // wie weit er vorausplant
  masterGain: 0.85,
  reverbSeconds: 2.8,
  maxVoices: 48,          // Stimmenbegrenzung, sonst zerreißt es bei dichten Bildern
  noteMinSec: 0.06,
};

/** Standardzustand eines frischen Blattes. */
export const DEFAULTS = {
  bpm: 96,
  bars: 4,
  beatsPerBar: 4,
  quantize: '1/8',
  swing: 0,
  root: 0,               // C
  scale: 'majorPent',
  lowOctave: 3,
  octaves: 3,
  pen: 'softkeys',
  tool: 'pen',           // pen | line | eraser
  brush: 'med',
  metronome: false,
  theme: 'system',   // das Gerät entscheidet, bis jemand etwas anderes wählt
  contrast: 'normal',
  showLabels: true,
  volume: 0.8,
};
