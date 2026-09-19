// Standard MIDI File, Format 1 — ein Track pro Instrument, damit sich die
// Datei in einer DAW sofort sinnvoll aufteilt.

const TPQ = 480;   // Ticks pro Viertel

function vlq(value) {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  return bytes;
}

function chunk(id, bytes) {
  const out = [];
  for (const ch of id) out.push(ch.charCodeAt(0));
  out.push((bytes.length >> 24) & 0xff, (bytes.length >> 16) & 0xff,
           (bytes.length >> 8) & 0xff, bytes.length & 0xff);
  return out.concat(bytes);
}

function textEvent(type, str) {
  const bytes = [...new TextEncoder().encode(str)];
  return [0x00, 0xff, type, ...vlq(bytes.length), ...bytes];
}

/**
 * @param {object} o
 * @param {Array} o.notes        Noten mit startBeat/durBeats/midi/pen/velocity
 * @param {Map|object} o.programs  penId → GM-Programmnummer
 * @param {number} o.bpm
 * @param {number} o.beatsPerBar
 * @param {number} o.loopBeats
 * @param {number} o.repeats
 * @param {(beat:number)=>number} o.warp  Swing-Abbildung
 */
export function encodeMidi({ notes, programs, bpm, beatsPerBar, loopBeats, repeats = 1, warp = (b) => b, title = 'play_music_theory' }) {
  const pens = [...new Set(notes.map((n) => n.pen))];
  const tracks = [];

  // ── Track 0: Tempo, Taktart, Name ──
  const microsPerQuarter = Math.round(60000000 / bpm);
  const meta = [
    ...textEvent(0x03, title),
    0x00, 0xff, 0x51, 0x03,
    (microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff,
    0x00, 0xff, 0x58, 0x04, beatsPerBar, 2, 24, 8,   // n/4
    0x00, 0xff, 0x2f, 0x00,
  ];
  tracks.push(chunk('MTrk', meta));

  // ── Ein Track je Stift ──
  pens.forEach((pen, index) => {
    const channel = index % 16 === 9 ? 10 % 16 : index % 16;  // Kanal 10 ist Schlagzeug
    const events = [];
    for (let rep = 0; rep < repeats; rep += 1) {
      const offset = rep * loopBeats;
      for (const n of notes) {
        if (n.pen !== pen) continue;
        const on = Math.round((offset + warp(n.startBeat)) * TPQ);
        const off = Math.round((offset + warp(n.startBeat + n.durBeats)) * TPQ);
        const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 110) + 10));
        events.push({ tick: on,  bytes: [0x90 | channel, n.midi, vel] });
        events.push({ tick: Math.max(off, on + 12), bytes: [0x80 | channel, n.midi, 0x40] });
      }
    }
    // Note-Off vor Note-On bei gleichem Tick, sonst schneidet sich eine
    // wiederholte Tonhöhe selbst ab.
    events.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));

    const bytes = [...textEvent(0x03, penLabel(pen))];
    const program = (programs?.[pen] ?? programs?.get?.(pen) ?? 0);
    bytes.push(0x00, 0xc0 | channel, program & 0x7f);

    let last = 0;
    for (const e of events) {
      bytes.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
      last = e.tick;
    }
    bytes.push(0x00, 0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', bytes));
  });

  const header = chunk('MThd', [
    0, 1,                                   // Format 1
    (tracks.length >> 8) & 0xff, tracks.length & 0xff,
    (TPQ >> 8) & 0xff, TPQ & 0xff,
  ]);

  const all = header.concat(...tracks);
  return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
}

function penLabel(pen) {
  return { softkeys: 'SoftKeys', marimba: 'Marimba', warm: 'Warm Synth', bells: 'Glocken' }[pen] ?? pen;
}
