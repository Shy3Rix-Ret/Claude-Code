// Tastatur — Kürzel und, wichtiger, ein vollwertiger Zeichenmodus ohne Maus.
//
// Die Zusammenfassung vermerkt unter Barrierefreiheit schlicht: nichts
// vorhanden, die App setzt Sehen und Zeigen voraus. Ein Raster aus Tönen ist
// aber genau die Art Oberfläche, die sich mit Pfeiltasten hervorragend
// bedienen lässt — man muss es nur einbauen. Der Cursor liest sich selbst vor,
// jede Zelle sagt ihren Ton an.

import { nextId } from './state.js';
import { clamp } from './strokes.js';
import { LIMITS } from './config.js';

export function attachKeyboard({ store, paper, getScene, actions, announce, requestRender }) {
  let cursor = null;   // { step, row }
  let lastPlaced = null;

  function ensureCursor() {
    const s = getScene();
    if (!cursor) {
      cursor = { step: 0, row: Math.floor(s.ladder.length / 2) };
      paper.setCursor(cursor);
      announce('Raster-Cursor an. Pfeiltasten bewegen, Eingabetaste setzt einen Ton, Entf löscht.');
    }
    return cursor;
  }

  function clampCursor() {
    const s = getScene();
    cursor.step = clamp(cursor.step, 0, s.totalSteps - 1);
    cursor.row = clamp(cursor.row, 0, s.ladder.length - 1);
    // Cursor darf nicht aus dem sichtbaren Ausschnitt laufen.
    const beat = cursor.step / s.stepsPerBeat;
    const v = paper.view;
    const visible = paper.width / paper.pxPerBeat();
    if (beat < v.panBeat) paper.setView({ panBeat: beat });
    else if (beat > v.panBeat + visible - 0.5) paper.setView({ panBeat: beat - visible + 0.5 });
  }

  function describe() {
    const s = getScene();
    const row = s.ladder[cursor.row];
    const beat = cursor.step / s.stepsPerBeat;
    const bar = Math.floor(beat / s.beatsPerBar) + 1;
    const inBar = (beat % s.beatsPerBar) + 1;
    announce(`${row.full}, Takt ${bar}, Schlag ${fmt(inBar)}`);
  }

  const fmt = (n) => (Math.abs(n - Math.round(n)) < 0.01 ? String(Math.round(n)) : n.toFixed(2).replace('.', ','));

  function cellY(row) {
    const s = getScene();
    return s.ladder.length > 1 ? row / (s.ladder.length - 1) : 0.5;
  }

  function placeAtCursor() {
    const s = getScene();
    const t = cursor.step / s.stepsPerBeat;
    const y = cellY(cursor.row);
    const existing = store.state.strokes.filter((st) => coversCell(st, s, cursor));
    if (existing.length) {
      const ids = new Set(existing.map((x) => x.id));
      store.commitStrokes(store.state.strokes.filter((x) => !ids.has(x.id)), 'Ton entfernt');
      announce(`${s.ladder[cursor.row].full} entfernt`);
      lastPlaced = null;
    } else {
      const stroke = {
        id: nextId(),
        pen: s.pen,
        brush: s.brush,
        points: [{ t, y, p: 0.9 }, { t: t + 0.4 / s.stepsPerBeat, y, p: 0.9 }],
      };
      store.commitStrokes([...store.state.strokes, stroke], 'Ton gesetzt');
      lastPlaced = stroke.id;
      actions.preview(s.ladder[cursor.row].midi, s.pen);
      announce(`${s.ladder[cursor.row].full} gesetzt`);
    }
    requestRender();
  }

  /** Letzten gesetzten Ton verlängern oder kürzen. */
  function resize(deltaSteps) {
    const s = getScene();
    const strokes = store.state.strokes;
    const i = strokes.findIndex((x) => x.id === lastPlaced);
    if (i < 0) return false;
    const st = strokes[i];
    const start = st.points[0].t;
    const endT = st.points[st.points.length - 1].t + deltaSteps / s.stepsPerBeat;
    const minEnd = start + 0.4 / s.stepsPerBeat;
    const next = [...strokes];
    next[i] = {
      ...st,
      points: [st.points[0], { ...st.points[st.points.length - 1], t: clamp(Math.max(endT, minEnd), 0, s.totalBeats) }],
    };
    store.commitStrokes(next, 'Länge geändert');
    const steps = Math.max(1, Math.round((next[i].points[1].t - start) * s.stepsPerBeat));
    announce(`Länge ${steps} Schritt${steps === 1 ? '' : 'e'}`);
    requestRender();
    return true;
  }

  function coversCell(stroke, s, cur) {
    const t0 = cur.step / s.stepsPerBeat;
    const t1 = (cur.step + 1) / s.stepsPerBeat;
    const rowSpan = 0.5 / Math.max(1, s.ladder.length - 1);
    const y = cellY(cur.row);
    for (let i = 0; i < stroke.points.length; i += 1) {
      const a = stroke.points[i];
      const b = stroke.points[i + 1] ?? a;
      const lo = Math.min(a.t, b.t), hi = Math.max(a.t, b.t);
      if (hi < t0 - 1e-6 || lo > t1 + 1e-6) continue;
      const yLo = Math.min(a.y, b.y) - rowSpan, yHi = Math.max(a.y, b.y) + rowSpan;
      if (y >= yLo && y <= yHi) return true;
    }
    return false;
  }

  function onKey(ev) {
    const tag = ev.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) {
      if (ev.key === 'Escape') ev.target.blur();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    const s = getScene();

    if (mod && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) actions.redo(); else actions.undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); actions.redo(); return; }
    if (mod && ev.key.toLowerCase() === 's') { ev.preventDefault(); actions.saveProject(); return; }
    if (mod) return;   // andere Systemkürzel in Ruhe lassen

    switch (ev.key) {
      case ' ':
        ev.preventDefault();
        actions.togglePlay();
        return;
      case 'Escape':
        if (cursor) { cursor = null; paper.setCursor(null); announce('Raster-Cursor aus'); requestRender(); }
        actions.closeDialogs();
        return;
      case 'Enter':
        ev.preventDefault();
        ensureCursor();
        clampCursor();
        placeAtCursor();
        return;
      case 'Delete':
      case 'Backspace': {
        if (!cursor) return;
        ev.preventDefault();
        const hits = store.state.strokes.filter((st) => coversCell(st, s, cursor));
        if (!hits.length) { announce('Hier ist nichts'); return; }
        const ids = new Set(hits.map((x) => x.id));
        store.commitStrokes(store.state.strokes.filter((x) => !ids.has(x.id)), 'Gelöscht');
        announce(`${hits.length} Strich${hits.length === 1 ? '' : 'e'} gelöscht`);
        requestRender();
        return;
      }
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        ev.preventDefault();
        ensureCursor();
        if (ev.shiftKey && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft')) {
          if (resize(ev.key === 'ArrowRight' ? 1 : -1)) return;
        }
        const big = ev.altKey ? s.stepsPerBeat : 1;
        if (ev.key === 'ArrowLeft') cursor.step -= big;
        if (ev.key === 'ArrowRight') cursor.step += big;
        if (ev.key === 'ArrowUp') cursor.row += ev.altKey ? s.scaleSteps : 1;
        if (ev.key === 'ArrowDown') cursor.row -= ev.altKey ? s.scaleSteps : 1;
        clampCursor();
        paper.setCursor(cursor);
        describe();
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') actions.preview(s.ladder[cursor.row].midi, s.pen);
        requestRender();
        return;
      }
      case 'Home':
        if (cursor) { ensureCursor(); cursor.step = 0; clampCursor(); paper.setCursor(cursor); describe(); requestRender(); }
        else actions.rewind();
        return;
      case 'End':
        if (cursor) { ensureCursor(); cursor.step = s.totalSteps - 1; clampCursor(); paper.setCursor(cursor); describe(); requestRender(); }
        return;
      case '?':
        actions.help();
        return;
      default: break;
    }

    const k = ev.key.toLowerCase();
    if (k >= '1' && k <= '4') { actions.selectPen(Number(k) - 1); return; }
    switch (k) {
      case 'b': case 'p': actions.selectTool('pen'); break;
      case 'l': actions.selectTool('line'); break;
      case 'e': actions.selectTool('eraser'); break;
      case 'm': actions.toggleMetronome(); break;
      case 'r': actions.rewind(); break;
      case 'g': actions.gallery(); break;
      case 'x': actions.exportDialog(); break;
      case 'c': if (ev.shiftKey) actions.clearAll(); break;
      case '[': actions.nudgeBpm(-2); break;
      case ']': actions.nudgeBpm(2); break;
      case '+': case '=': paper.zoomAt(1.25, window.innerWidth / 2); actions.viewChanged(); break;
      case '-': case '_': paper.zoomAt(0.8, window.innerWidth / 2); actions.viewChanged(); break;
      case '0': paper.setView({ zoom: 1, panBeat: 0 }); actions.viewChanged(); break;
      case 't': actions.tapTempo(); break;
      default: break;
    }
  }

  window.addEventListener('keydown', onKey);

  return {
    get cursor() { return cursor; },
    clearCursor() { cursor = null; paper.setCursor(null); },
    detach() { window.removeEventListener('keydown', onKey); },
  };
}

export { LIMITS };
