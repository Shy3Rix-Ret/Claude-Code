// Tonvorrat. Das Raster ist keine Klaviatur, sondern eine Leiter aus genau den
// Tönen, die in der gewählten Tonart erlaubt sind — deshalb klingt alles, was
// man zeichnet, erst einmal richtig (§ "Skalen und Tonart").

export const PITCH_CLASSES = [
  { pc: 0,  sharp: 'C',  flat: 'C'  },
  { pc: 1,  sharp: 'C♯', flat: 'D♭' },
  { pc: 2,  sharp: 'D',  flat: 'D'  },
  { pc: 3,  sharp: 'D♯', flat: 'E♭' },
  { pc: 4,  sharp: 'E',  flat: 'E'  },
  { pc: 5,  sharp: 'F',  flat: 'F'  },
  { pc: 6,  sharp: 'F♯', flat: 'G♭' },
  { pc: 7,  sharp: 'G',  flat: 'G'  },
  { pc: 8,  sharp: 'G♯', flat: 'A♭' },
  { pc: 9,  sharp: 'A',  flat: 'A'  },
  { pc: 10, sharp: 'A♯', flat: 'B♭' },
  { pc: 11, sharp: 'B',  flat: 'B'  },
];

/** Skalen als Halbtonabstände zum Grundton. Reihenfolge = Reihenfolge im Menü. */
export const SCALES = [
  { id: 'majorPent', label: 'Dur-Pentatonik',  steps: [0, 2, 4, 7, 9],            mood: 'offen, nichts klingt falsch' },
  { id: 'minorPent', label: 'Moll-Pentatonik', steps: [0, 3, 5, 7, 10],           mood: 'erdig, bluesnah' },
  { id: 'major',     label: 'Dur (Ionisch)',   steps: [0, 2, 4, 5, 7, 9, 11],     mood: 'hell, vertraut' },
  { id: 'minor',     label: 'Moll (Äolisch)',  steps: [0, 2, 3, 5, 7, 8, 10],     mood: 'ernst' },
  { id: 'dorian',    label: 'Dorisch',         steps: [0, 2, 3, 5, 7, 9, 10],     mood: 'moll mit heller Sexte' },
  { id: 'phrygian',  label: 'Phrygisch',       steps: [0, 1, 3, 5, 7, 8, 10],     mood: 'spanisch, dunkel' },
  { id: 'lydian',    label: 'Lydisch',         steps: [0, 2, 4, 6, 7, 9, 11],     mood: 'schwebend' },
  { id: 'mixolydian',label: 'Mixolydisch',     steps: [0, 2, 4, 5, 7, 9, 10],     mood: 'rockig' },
  { id: 'harmMinor', label: 'Harmonisch Moll', steps: [0, 2, 3, 5, 7, 8, 11],     mood: 'dramatisch' },
  { id: 'blues',     label: 'Blues',           steps: [0, 3, 5, 6, 7, 10],        mood: 'rau' },
  { id: 'hirajoshi', label: 'Hirajoshi',       steps: [0, 2, 3, 7, 8],            mood: 'japanisch, karg' },
  { id: 'wholeTone', label: 'Ganzton',         steps: [0, 2, 4, 6, 8, 10],        mood: 'traumlos schwebend' },
  { id: 'chromatic', label: 'Chromatisch',     steps: [0,1,2,3,4,5,6,7,8,9,10,11],mood: 'alles erlaubt' },
];

export const SCALE_BY_ID = Object.fromEntries(SCALES.map((s) => [s.id, s]));

/** Tonarten, die man konventionell mit ♭ schreibt. Rein kosmetisch, aber der
 *  Unterschied zwischen "A♯" und "B♭" ist genau das, woran man merkt, ob
 *  jemand nachgedacht hat. */
const FLAT_ROOTS = new Set([1, 3, 5, 8, 10]);

export function noteName(midi, root = 0) {
  const pc = ((midi % 12) + 12) % 12;
  const useFlat = FLAT_ROOTS.has(root);
  return PITCH_CLASSES[pc][useFlat ? 'flat' : 'sharp'];
}

export function noteNameWithOctave(midi, root = 0) {
  return `${noteName(midi, root)}${Math.floor(midi / 12) - 1}`;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Baut die Tonleiter des Rasters: Zeile 0 ist der tiefste Ton.
 * Oben wird der Grundton noch einmal angehängt, damit die Oktave sichtbar
 * geschlossen ist — ein Raster, das mitten in der Skala aufhört, fühlt sich
 * abgeschnitten an.
 */
export function buildLadder({ root, scale, lowOctave, octaves }) {
  const def = SCALE_BY_ID[scale] ?? SCALE_BY_ID.major;
  const rows = [];
  for (let o = 0; o < octaves; o += 1) {
    for (let i = 0; i < def.steps.length; i += 1) {
      const midi = (lowOctave + 1 + o) * 12 + root + def.steps[i];
      rows.push({
        midi,
        degree: i,
        isRoot: def.steps[i] === 0,
        isFifth: def.steps[i] === 7,
        name: noteName(midi, root),
        full: noteNameWithOctave(midi, root),
      });
    }
  }
  const topMidi = (lowOctave + 1 + octaves) * 12 + root;
  rows.push({
    midi: topMidi,
    degree: 0,
    isRoot: true,
    isFifth: false,
    name: noteName(topMidi, root),
    full: noteNameWithOctave(topMidi, root),
  });
  return rows;
}

/** Wie viele Zeilen ein Ladder mit diesen Einstellungen hätte — ohne ihn zu bauen. */
export function ladderSize({ scale, octaves }) {
  const def = SCALE_BY_ID[scale] ?? SCALE_BY_ID.major;
  return def.steps.length * octaves + 1;
}
