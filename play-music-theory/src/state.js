// Ein Zustand, ein Abonnement-Mechanismus, eine History.
//
// Striche sind unveränderlich: jede Änderung ersetzt das Array. Dadurch ist ein
// History-Eintrag nur eine Liste von Referenzen und kostet fast nichts —
// Undo/Redo ohne Sonderbehandlung pro Werkzeug (§ Schwächen: "Keine Undo-/
// Redo-Funktionen").

import { DEFAULTS, LIMITS } from './config.js';

let uid = 0;
export const nextId = () => `s${(uid += 1)}_${Date.now().toString(36)}`;

export function createStore() {
  const listeners = new Map();   // key → Set<fn>
  let data = {
    ...DEFAULTS,
    strokes: [],
    title: 'Ohne Titel',
  };

  const past = [];
  const future = [];
  let batching = null;

  function emit(keys) {
    const fired = new Set();
    for (const key of keys) {
      for (const fn of listeners.get(key) ?? []) fired.add(fn);
    }
    for (const fn of listeners.get('*') ?? []) fired.add(fn);
    for (const fn of fired) fn(data);
  }

  return {
    get state() { return data; },

    /** on('bpm', fn) oder on(['bpm','bars'], fn) oder on('*', fn) */
    on(keys, fn) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) {
        if (!listeners.has(k)) listeners.set(k, new Set());
        listeners.get(k).add(fn);
      }
      return () => { for (const k of list) listeners.get(k)?.delete(fn); };
    },

    /** Einstellung ändern. Nicht undo-fähig — Undo gehört der Zeichnung. */
    set(patch) {
      const keys = [];
      for (const [k, v] of Object.entries(patch)) {
        if (data[k] !== v) { keys.push(k); }
      }
      if (!keys.length) return;
      data = { ...data, ...patch };
      emit(keys);
    },

    /** Zeichnung ersetzen und den vorherigen Stand auf den Stapel legen. */
    commitStrokes(strokes, label = 'Änderung') {
      if (strokes === data.strokes) return;
      past.push({ strokes: data.strokes, label });
      if (past.length > LIMITS.historyDepth) past.shift();
      future.length = 0;
      data = { ...data, strokes };
      emit(['strokes', 'history']);
    },

    /** Zeichnung ändern ohne History-Eintrag (laufender Strich). */
    previewStrokes(strokes) {
      data = { ...data, strokes };
      emit(['strokes']);
    },

    undo() {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ strokes: data.strokes, label: entry.label });
      data = { ...data, strokes: entry.strokes };
      emit(['strokes', 'history']);
      return entry.label;
    },

    redo() {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ strokes: data.strokes, label: entry.label });
      data = { ...data, strokes: entry.strokes };
      emit(['strokes', 'history']);
      return entry.label;
    },

    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },

    /** Beim Laden eines Projekts: History verwerfen, sonst kann man in ein
     *  fremdes Bild "zurück"-gehen. */
    load(next) {
      past.length = 0;
      future.length = 0;
      data = { ...DEFAULTS, ...next };
      emit(Object.keys(data));
    },

    snapshot() {
      const { strokes, ...rest } = data;
      return { ...rest, strokes: strokes.map(serializeStroke) };
    },
  };
}

export function serializeStroke(s) {
  // Punkte auf drei Nachkommastellen runden: das spart im localStorage und in
  // exportierten Dateien grob die Hälfte, ohne dass man es sieht oder hört.
  return {
    i: s.id,
    p: s.pen,
    b: s.brush,
    d: s.points.flatMap((pt) => [r3(pt.t), r3(pt.y), r2(pt.p)]),
  };
}

export function deserializeStroke(raw) {
  const points = [];
  for (let i = 0; i + 2 < raw.d.length; i += 3) {
    points.push({ t: raw.d[i], y: raw.d[i + 1], p: raw.d[i + 2] });
  }
  return { id: raw.i ?? nextId(), pen: raw.p, brush: raw.b ?? 'med', points };
}

const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;
