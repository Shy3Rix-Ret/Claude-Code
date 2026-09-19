// Das Blatt.
//
// Drei Ebenen, jede mit eigenem Anlass zum Neuzeichnen:
//   1. Raster    — nur bei Größe, Zoom, Tonart, Quantisierung
//   2. Striche   — nur wenn sich die Zeichnung ändert
//   3. Overlay   — jedes Bild: Abspielkopf, aufleuchtende Noten, Cursor
//
// Auf einem Telefon ist das der Unterschied zwischen flüssig und zäh: beim
// Zeichnen wird pro Bild nur die dritte Ebene plus der laufende Strich neu
// gemalt, nicht vierhundert alte Linien.

import { PEN_BY_ID, BRUSH_BY_ID } from './config.js';
import { clamp } from './strokes.js';

const GUTTER_WIDE = 52;
const GUTTER_NARROW = 34;

export function createPaper({ canvas, getScene }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const gridLayer = document.createElement('canvas');
  const strokeLayer = document.createElement('canvas');
  const gridCtx = gridLayer.getContext('2d');
  const strokeCtx = strokeLayer.getContext('2d');

  let dpr = 1;
  let W = 0, H = 0;              // CSS-Pixel des Zeichenbereichs (ohne Gutter)
  let gutter = GUTTER_WIDE;
  let gridDirty = true;
  let strokesDirty = true;
  let view = { zoom: 1, panBeat: 0 };
  let playBeat = 0;
  let cursor = null;             // Tastatur-Cursor { step, row }
  let liveStroke = null;
  let flashes = [];              // { row, step, steps, pen, t0 }

  const theme = () => getScene().theme;

  function pxPerBeat() {
    const s = getScene();
    return (W * view.zoom) / Math.max(s.totalBeats, 0.001);
  }

  function rowHeight() {
    const s = getScene();
    return H / Math.max(s.ladder.length, 1);
  }

  function maxPan() {
    const s = getScene();
    return Math.max(0, s.totalBeats - W / pxPerBeat());
  }

  function clampView() {
    view.zoom = clamp(view.zoom, 1, 12);
    view.panBeat = clamp(view.panBeat, 0, maxPan());
  }

  // ── Koordinaten ───────────────────────────────────────────────────────────
  function toPaper(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left - gutter;
    const y = clientY - r.top;
    const s = getScene();
    return {
      t: clamp(view.panBeat + x / pxPerBeat(), 0, s.totalBeats),
      y: clamp(1 - y / H, 0, 1),
      inside: x >= -2 && x <= W + 2 && y >= 0 && y <= H,
      onGutter: x < 0,
    };
  }

  function toScreen(t, y) {
    return { x: gutter + (t - view.panBeat) * pxPerBeat(), y: (1 - y) * H };
  }

  function rowToY(row) {
    const s = getScene();
    return H - (row + 0.5) * (H / s.ladder.length);
  }

  // ── Größe ─────────────────────────────────────────────────────────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cw = Math.max(1, Math.floor(rect.width));
    const chh = Math.max(1, Math.floor(rect.height));
    gutter = cw < 520 ? GUTTER_NARROW : GUTTER_WIDE;
    W = Math.max(1, cw - gutter);
    H = chh;

    for (const c of [canvas, gridLayer, strokeLayer]) {
      c.width = Math.floor(cw * dpr);
      c.height = Math.floor(chh * dpr);
    }
    for (const c of [ctx, gridCtx, strokeCtx]) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    clampView();
    gridDirty = strokesDirty = true;
  }

  // ── Raster ────────────────────────────────────────────────────────────────
  function drawGrid() {
    const s = getScene();
    const c = gridCtx;
    const pal = s.palette;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, gridLayer.width, gridLayer.height);

    // Hintergrund mit einem Hauch Tiefe: unten etwas dunkler, oben offener.
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, pal.paperTop);
    bg.addColorStop(1, pal.paperBottom);
    c.fillStyle = bg;
    c.fillRect(0, 0, gutter + W, H);

    const rows = s.ladder.length;
    const rh = H / rows;
    const ppb = pxPerBeat();
    const stepBeat = 1 / s.stepsPerBeat;

    // Waagerechte Bahnen. Jede zweite Oktave bekommt einen Hauch Füllung,
    // damit man beim schnellen Blick weiß, wo man ist.
    for (let r = 0; r < rows; r += 1) {
      const row = s.ladder[r];
      const y = H - (r + 1) * rh;
      if (row.isRoot) {
        c.fillStyle = pal.rootBand;
        c.fillRect(gutter, y, W, rh);
      } else if (row.isFifth) {
        c.fillStyle = pal.fifthBand;
        c.fillRect(gutter, y, W, rh);
      }
      c.strokeStyle = row.isRoot ? pal.rootLine : pal.rowLine;
      c.lineWidth = row.isRoot ? 1.2 : 1;
      c.beginPath();
      c.moveTo(gutter, Math.round(y) + 0.5);
      c.lineTo(gutter + W, Math.round(y) + 0.5);
      c.stroke();
    }

    // Senkrechte Linien: Schritt, Schlag, Takt — drei Stärken.
    const firstBeat = Math.floor(view.panBeat / stepBeat) * stepBeat;
    const lastBeat = view.panBeat + W / ppb + stepBeat;
    for (let b = firstBeat; b <= lastBeat + 1e-9; b += stepBeat) {
      const x = gutter + (b - view.panBeat) * ppb;
      if (x < gutter - 1 || x > gutter + W + 1) continue;
      const isBeat = Math.abs(b - Math.round(b)) < 1e-6;
      const isBar = isBeat && Math.round(b) % s.beatsPerBar === 0;
      if (!isBeat && ppb * stepBeat < 7) continue;   // zu eng: Schrittlinien weglassen
      c.strokeStyle = isBar ? pal.barLine : isBeat ? pal.beatLine : pal.stepLine;
      c.lineWidth = isBar ? 1.4 : 1;
      c.beginPath();
      c.moveTo(Math.round(x) + 0.5, 0);
      c.lineTo(Math.round(x) + 0.5, H);
      c.stroke();

      if (isBar && ppb * s.beatsPerBar > 46) {
        c.fillStyle = pal.barLabel;
        c.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        c.textAlign = 'left';
        c.textBaseline = 'top';
        c.fillText(String(Math.round(b / s.beatsPerBar) + 1), x + 4, 4);
      }
    }

    // Gutter mit Tonnamen.
    c.fillStyle = pal.gutter;
    c.fillRect(0, 0, gutter, H);
    c.strokeStyle = pal.gutterEdge;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(gutter - 0.5, 0);
    c.lineTo(gutter - 0.5, H);
    c.stroke();

    if (s.showLabels) {
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      // Von oben nach unten, also wächst y. Der Abstand ist y - lastY —
      // andersherum fällt jede Beschriftung außer den Grundtönen weg.
      const minGap = 11;
      let lastY = -Infinity;
      for (let r = rows - 1; r >= 0; r -= 1) {
        const row = s.ladder[r];
        const y = rowToY(r);
        if (y - lastY < minGap && !row.isRoot) continue;
        // Bei sehr engen Rastern nur noch die Grundtöne beschriften.
        if (rh < 13 && !row.isRoot) continue;
        lastY = y;
        c.fillStyle = row.isRoot ? pal.labelStrong : pal.label;
        c.font = row.isRoot
          ? '700 10px ui-monospace, SFMono-Regular, Menlo, monospace'
          : '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        c.fillText(row.isRoot ? row.full : row.name, gutter - 7, y);
      }
    }
    gridDirty = false;
  }

  // ── Striche ───────────────────────────────────────────────────────────────
  function strokePath(c, stroke, alpha = 1) {
    const s = getScene();
    const pen = PEN_BY_ID[stroke.pen] ?? PEN_BY_ID.softkeys;
    const brush = BRUSH_BY_ID[stroke.brush] ?? BRUSH_BY_ID.med;
    const rh = H / s.ladder.length;
    // An die Zeilenhöhe gekoppelt, aber gedeckelt: ohne Deckel wird ein Strich
    // bei drei Oktaven Pentatonik fingerdick und verdeckt das Raster.
    const base = Math.min(Math.max(2.5, rh * brush.width * 0.78), 22);
    const pts = stroke.points;
    if (!pts.length) return;

    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = alpha;

    if (pts.length === 1) {
      const p = toScreen(pts[0].t, pts[0].y);
      c.fillStyle = pen.color;
      c.beginPath();
      c.arc(p.x, p.y, base * 0.6 * (0.6 + pts[0].p * 0.4), 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      return;
    }

    // Druckabhängige Breite: in kurzen Segmenten zeichnen, sonst ließe sich
    // die Stärke nicht entlang des Strichs ändern.
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = toScreen(pts[i].t, pts[i].y);
      const b = toScreen(pts[i + 1].t, pts[i + 1].y);
      const w = base * (0.55 + ((pts[i].p + pts[i + 1].p) / 2) * 0.65);
      c.strokeStyle = pen.color;
      c.lineWidth = w;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  function drawStrokes() {
    const s = getScene();
    const c = strokeCtx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, strokeLayer.width, strokeLayer.height);
    c.save();
    c.beginPath();
    c.rect(gutter, 0, W, H);
    c.clip();

    // Glühen als zweiter, unscharfer Durchgang. shadowBlur pro Segment wäre
    // auf dem Telefon zu teuer, deshalb einmal weich darunter, einmal scharf
    // darüber.
    if (!s.reducedMotion && s.contrast !== 'high') {
      c.globalCompositeOperation = 'lighter';
      c.filter = 'blur(6px)';
      for (const stroke of s.strokes) strokePath(c, stroke, 0.5);
      c.filter = 'none';
      c.globalCompositeOperation = 'source-over';
    }
    for (const stroke of s.strokes) strokePath(c, stroke, 1);
    c.restore();
    strokesDirty = false;
  }

  // ── Overlay ───────────────────────────────────────────────────────────────
  function drawOverlay(now) {
    const s = getScene();
    const pal = s.palette;
    const ppb = pxPerBeat();

    // Aufleuchtende Noten
    flashes = flashes.filter((f) => now - f.t0 < 420);
    const rh = H / s.ladder.length;
    for (const f of flashes) {
      const age = (now - f.t0) / 420;
      const pen = PEN_BY_ID[f.pen] ?? PEN_BY_ID.softkeys;
      const x = gutter + (f.startBeat - view.panBeat) * ppb;
      const w = Math.max(4, f.durBeats * ppb);
      const y = H - (f.row + 1) * rh;
      ctx.globalAlpha = (1 - age) * 0.55;
      ctx.fillStyle = pen.color;
      roundRect(ctx, x, y + 1, w, rh - 2, Math.min(4, rh / 2));
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Abspielkopf mit kurzem Nachzieher
    if (s.playing || playBeat > 0) {
      const x = gutter + (playBeat - view.panBeat) * ppb;
      if (x >= gutter - 40 && x <= gutter + W + 4) {
        const trail = ctx.createLinearGradient(x - 56, 0, x, 0);
        trail.addColorStop(0, 'rgba(255,255,255,0)');
        trail.addColorStop(1, pal.playheadTrail);
        ctx.fillStyle = trail;
        ctx.fillRect(Math.max(gutter, x - 56), 0, Math.min(56, x - gutter), H);
        ctx.strokeStyle = pal.playhead;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
    }

    // Tastatur-Cursor (§ Barrierefreiheit): die App ist ohne Maus bedienbar.
    if (cursor) {
      const x = gutter + (cursor.step / s.stepsPerBeat - view.panBeat) * ppb;
      const w = Math.max(6, ppb / s.stepsPerBeat);
      const y = H - (cursor.row + 1) * rh;
      ctx.save();
      ctx.strokeStyle = pal.cursor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      roundRect(ctx, x + 1, y + 1, w - 2, rh - 2, 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function render(now = performance.now()) {
    if (!W || !H) return;
    if (gridDirty) drawGrid();
    if (strokesDirty) drawStrokes();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(gridLayer, 0, 0, gridLayer.width / dpr, gridLayer.height / dpr);
    ctx.drawImage(strokeLayer, 0, 0, strokeLayer.width / dpr, strokeLayer.height / dpr);

    if (liveStroke) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(gutter, 0, W, H);
      ctx.clip();
      strokePath(ctx, liveStroke, 1);
      ctx.restore();
    }
    drawOverlay(now);
  }

  return {
    resize,
    render,
    toPaper,
    toScreen,
    get gutter() { return gutter; },
    get width() { return W; },
    get height() { return H; },
    get view() { return { ...view }; },
    pxPerBeat,
    rowHeight,
    maxPan,

    setView(next) {
      view = { ...view, ...next };
      clampView();
      gridDirty = strokesDirty = true;
    },
    /** Zoomt so, dass der Punkt unter dem Finger stehen bleibt. */
    zoomAt(factor, anchorClientX) {
      const before = toPaper(anchorClientX, 0).t;
      view.zoom = clamp(view.zoom * factor, 1, 12);
      clampView();
      const after = toPaper(anchorClientX, 0).t;
      view.panBeat = clamp(view.panBeat + (before - after), 0, maxPan());
      gridDirty = strokesDirty = true;
    },
    panBy(beats) {
      view.panBeat = clamp(view.panBeat + beats, 0, maxPan());
      gridDirty = strokesDirty = true;
    },

    invalidateGrid() { gridDirty = true; },
    invalidateStrokes() { strokesDirty = true; },
    setLive(stroke) { liveStroke = stroke; },
    setPlayhead(beat) { playBeat = beat; },
    setCursor(c) { cursor = c; },
    flash(note, now) {
      flashes.push({ ...note, t0: now });
      if (flashes.length > 120) flashes.splice(0, flashes.length - 120);
    },
    rowToY,
    hasFlashes() { return flashes.length > 0; },
    /** Für den PNG-Export: das fertige Bild ohne Overlay. */
    composite() {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const c = out.getContext('2d');
      if (gridDirty) drawGrid();
      if (strokesDirty) drawStrokes();
      c.drawImage(gridLayer, 0, 0);
      c.drawImage(strokeLayer, 0, 0);
      return out;
    },
  };
}
