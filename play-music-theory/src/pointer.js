// Zeigereingabe — ein Codepfad für Maus, Stift und Finger.
//
// Pointer Events statt getrennter Maus-/Touch-Behandlung: sonst hat man zwei
// Implementierungen, von denen eine immer die schlechtere ist. Druck kommt vom
// Stift, wo es ihn gibt; sonst wird er aus der Zeichengeschwindigkeit
// geschätzt — schnell gezogen ist leiser, langsam ist voller.

import { nextId } from './state.js';
import { simplify, strokesAt, clamp } from './strokes.js';
import { BRUSH_BY_ID } from './config.js';

export function attachPointer({ canvas, paper, store, getScene, onPreview, onView, requestRender }) {
  const viewChanged = () => { onView?.(); requestRender(); };
  const active = new Map();      // pointerId → Punktdaten
  let drawing = null;            // { stroke, lastRow }
  let erasing = null;            // Set von entfernten IDs
  let gesture = null;            // Zwei-Finger-Geste
  let lastMoveTime = 0;
  let lastPoint = null;
  let baseStrokes = null;

  const pressureOf = (ev, dt, dist) => {
    if (ev.pointerType === 'pen' && ev.pressure > 0) return clamp(ev.pressure * 1.25, 0.15, 1);
    if (ev.pointerType === 'touch') return 0.9;
    if (!dt || !dist) return 0.85;
    const speed = dist / dt;                 // CSS-Pixel pro ms
    return clamp(1.05 - speed * 0.22, 0.35, 1);
  };

  function begin(ev) {
    const s = getScene();
    const p = paper.toPaper(ev.clientX, ev.clientY);
    if (!p.inside || p.onGutter) return false;

    baseStrokes = store.state.strokes;

    if (s.tool === 'eraser') {
      erasing = new Set();
      eraseAt(p);
      return true;
    }

    const pressure = pressureOf(ev, 0, 0);
    drawing = {
      stroke: {
        id: nextId(),
        pen: s.pen,
        brush: s.brush,
        points: [{ t: p.t, y: p.y, p: pressure }],
      },
      lastRow: null,
      anchor: { t: p.t, y: p.y, p: pressure },
    };
    lastPoint = { x: ev.clientX, y: ev.clientY };
    lastMoveTime = ev.timeStamp;
    paper.setLive(drawing.stroke);
    preview(p);
    requestRender();
    return true;
  }

  function extend(ev) {
    const s = getScene();
    const p = paper.toPaper(ev.clientX, ev.clientY);

    if (erasing) { eraseAt(p); return; }
    if (!drawing) return;

    const dt = Math.max(1, ev.timeStamp - lastMoveTime);
    const dist = lastPoint ? Math.hypot(ev.clientX - lastPoint.x, ev.clientY - lastPoint.y) : 0;
    const pressure = pressureOf(ev, dt, dist);
    lastMoveTime = ev.timeStamp;
    lastPoint = { x: ev.clientX, y: ev.clientY };

    if (s.tool === 'line') {
      // Gerade: immer nur Anfang und aktueller Punkt. Mit Shift rastet sie
      // waagerecht oder senkrecht ein — waagerecht ist ein gehaltener Ton,
      // senkrecht ein Akkord, beides braucht man ständig.
      let t = p.t, y = p.y;
      if (ev.shiftKey) {
        const dT = Math.abs(t - drawing.anchor.t) * paper.pxPerBeat();
        const dY = Math.abs(y - drawing.anchor.y) * paper.height;
        if (dT > dY) y = drawing.anchor.y; else t = drawing.anchor.t;
      }
      drawing.stroke.points = [drawing.anchor, { t, y, p: pressure }];
    } else {
      const pts = drawing.stroke.points;
      const last = pts[pts.length - 1];
      const minT = 0.012;
      const minY = 0.004;
      if (Math.abs(p.t - last.t) >= minT || Math.abs(p.y - last.y) >= minY) {
        pts.push({ t: p.t, y: p.y, p: pressure });
      } else {
        last.p = (last.p + pressure) / 2;
      }
    }
    preview(p);
    paper.setLive(drawing.stroke);
    requestRender();
  }

  function finish() {
    if (erasing) {
      erasing = null;
      if (store.state.strokes !== baseStrokes) {
        const kept = store.state.strokes;
        store.previewStrokes(baseStrokes);
        store.commitStrokes(kept, 'Radieren');
      }
      return;
    }
    if (!drawing) return;
    const stroke = drawing.stroke;
    drawing = null;
    paper.setLive(null);

    const s = getScene();
    stroke.points = simplify(stroke.points, 1 / (s.stepsPerBeat * 3), 0.25 / s.ladder.length);
    if (stroke.points.length === 1 || spans(stroke) > 0) {
      store.commitStrokes([...baseStrokes, stroke], 'Strich');
    }
    requestRender();
  }

  function spans(stroke) {
    const p = stroke.points;
    let d = 0;
    for (let i = 0; i + 1 < p.length; i += 1) d += Math.abs(p[i + 1].t - p[i].t) + Math.abs(p[i + 1].y - p[i].y);
    return d;
  }

  function eraseAt(p) {
    const s = getScene();
    const brush = BRUSH_BY_ID[s.brush] ?? BRUSH_BY_ID.med;
    const rt = (1 / s.stepsPerBeat) * (0.7 + brush.width);
    const ry = (1 / s.ladder.length) * (0.9 + brush.width * 1.4);
    const hits = strokesAt(store.state.strokes, p.t, p.y, rt, ry);
    if (!hits.length) return;
    for (const id of hits) erasing.add(id);
    store.previewStrokes(store.state.strokes.filter((x) => !erasing.has(x.id)));
    requestRender();
  }

  /** Beim Zeichnen den Ton hören, aber nur beim Zeilenwechsel — sonst
   *  prasselt es. */
  function preview(p) {
    if (!drawing) return;
    const s = getScene();
    const row = clamp(Math.round(p.y * (s.ladder.length - 1)), 0, s.ladder.length - 1);
    if (row === drawing.lastRow) return;
    drawing.lastRow = row;
    onPreview?.(s.ladder[row].midi, s.pen);
  }

  // ── Zwei Finger: Zoom und Verschieben ─────────────────────────────────────
  function gestureUpdate() {
    const pts = [...active.values()];
    if (pts.length < 2) return;
    const [a, b] = pts;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = (a.x + b.x) / 2;
    if (!gesture) { gesture = { dist, mid }; return; }
    if (gesture.dist > 8) paper.zoomAt(dist / gesture.dist, mid);
    paper.panBy((gesture.mid - mid) / paper.pxPerBeat());
    gesture = { dist, mid };
    viewChanged();
  }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (active.size === 2) {
      // Zweiter Finger: laufenden Strich verwerfen, das war eine Geste.
      if (drawing) { drawing = null; paper.setLive(null); }
      if (erasing) { erasing = null; store.previewStrokes(baseStrokes); }
      gesture = null;
      gestureUpdate();
      requestRender();
      return;
    }
    if (active.size > 2) return;
    if (begin(ev)) canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (active.size >= 2) { gestureUpdate(); return; }
    // Bei schnellen Bewegungen liefert der Browser Zwischenpunkte nach — die
    // machen aus einer eckigen Linie eine runde.
    const events = ev.getCoalescedEvents?.() ?? [ev];
    for (const e of events) extend(e.clientX !== undefined ? e : ev);
    ev.preventDefault();
  });

  const end = (ev) => {
    active.delete(ev.pointerId);
    if (active.size < 2) gesture = null;
    if (active.size === 0) finish();
    try { canvas.releasePointerCapture(ev.pointerId); } catch { /* egal */ }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', (ev) => { active.delete(ev.pointerId); });

  // ── Mausrad ───────────────────────────────────────────────────────────────
  canvas.addEventListener('wheel', (ev) => {
    if (ev.ctrlKey || ev.metaKey) {
      paper.zoomAt(Math.exp(-ev.deltaY * 0.0022), ev.clientX);
    } else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      paper.panBy(ev.deltaX / paper.pxPerBeat());
    } else if (paper.view.zoom > 1) {
      paper.panBy(ev.deltaY / paper.pxPerBeat());
    } else {
      return;   // nichts zu tun: Seite darf scrollen
    }
    ev.preventDefault();
    viewChanged();
  }, { passive: false });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  return {
    get busy() { return !!(drawing || erasing); },
    cancel() {
      if (drawing) { drawing = null; paper.setLive(null); }
      if (erasing) { erasing = null; if (baseStrokes) store.previewStrokes(baseStrokes); }
      active.clear();
      requestRender();
    },
  };
}
