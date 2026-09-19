// Alles, was DOM ist. main.js sagt was passieren soll, dieses Modul weiß wie
// es aussieht — und kennt umgekehrt weder Audio noch Zeichenlogik.

import { PENS, QUANTIZE_OPTIONS, BAR_OPTIONS, BRUSH_SIZES, LIMITS } from './config.js';
import { PITCH_CLASSES, SCALES, SCALE_BY_ID, noteNameWithOctave } from './theory.js';
import { GALLERY } from './gallery.js';

const $ = (id) => document.getElementById(id);

const TOOLS = [
  { id: 'pen',    label: 'Stift',    key: 'B', icon: 'M3 21l3.6-.8L20 6.8a2 2 0 0 0 0-2.8l-.9-.9a2 2 0 0 0-2.8 0L2.9 16.5z' },
  { id: 'line',   label: 'Gerade',   key: 'L', icon: 'M3.5 20.5 20.5 3.5l1.4 1.4L4.9 21.9z' },
  { id: 'eraser', label: 'Radierer', key: 'E', icon: 'M8.6 20.5 3.2 15a2 2 0 0 1 0-2.9l8.3-8.3a2 2 0 0 1 2.9 0l5.4 5.4a2 2 0 0 1 0 2.9l-8.4 8.4zm2.9-2.1 6.9-6.9-4-4-6.9 6.9z' },
];

const SHORTCUTS = [
  ['Leertaste', 'Abspielen / Anhalten'],
  ['1 – 4', 'Stift wählen'],
  ['B / L / E', 'Stift · Gerade · Radierer'],
  ['Strg + Z', 'Rückgängig'],
  ['Strg + ⇧ + Z', 'Wiederholen'],
  ['◀ ▶ ▲ ▼', 'Cursor im Raster bewegen'],
  ['Eingabe', 'Ton setzen oder entfernen'],
  ['⇧ + ◀ ▶', 'Ton verlängern / kürzen'],
  ['Alt + Pfeil', 'Ganzer Schlag / Oktave'],
  ['Entf', 'Am Cursor löschen'],
  ['M', 'Metronom'],
  ['T', 'Tempo klopfen'],
  ['R', 'An den Anfang'],
  ['[ und ]', 'Tempo ± 2'],
  ['+ / − / 0', 'Zoom rein · raus · zurück'],
  ['G / X', 'Galerie · Export'],
  ['⇧ + C', 'Blatt leeren'],
  ['Esc', 'Cursor aus, Dialog zu'],
  ['?', 'Diese Liste'],
];

export function createUI({ actions }) {
  // ── Stifte ────────────────────────────────────────────────────────────
  const pensEl = $('pens');
  for (const pen of PENS) {
    const b = document.createElement('button');
    b.className = 'pen';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.pen = pen.id;
    b.style.setProperty('--pen-color', pen.color);
    b.title = `${pen.label} — ${pen.hint}`;
    b.innerHTML = `<span class="pen-dot" aria-hidden="true"></span>
      <span><span class="pen-name">${pen.label}</span><span class="pen-hint">${pen.hint}</span></span>`;
    b.addEventListener('click', () => actions.setPen(pen.id));
    pensEl.append(b);
  }

  // ── Werkzeuge ─────────────────────────────────────────────────────────
  const toolsEl = $('tools');
  for (const tool of TOOLS) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.tool = tool.id;
    b.title = `${tool.label} · ${tool.key}`;
    b.innerHTML = `<svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="${tool.icon}"/></svg><span>${tool.label}</span>`;
    b.addEventListener('click', () => actions.setTool(tool.id));
    toolsEl.append(b);
  }

  // ── Strichstärken ─────────────────────────────────────────────────────
  const brushEl = $('brushes');
  for (const br of BRUSH_SIZES) {
    const b = document.createElement('button');
    b.className = 'seg-btn';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.setAttribute('aria-label', `Strichstärke ${br.label}`);
    b.dataset.brush = br.id;
    b.title = `Strichstärke ${br.label}`;
    const px = 5 + br.width * 8;
    b.innerHTML = `<span class="brush-dot" style="width:${px}px;height:${px}px"></span>`;
    b.addEventListener('click', () => actions.setBrush(br.id));
    brushEl.append(b);
  }

  // ── Auswahlfelder ─────────────────────────────────────────────────────
  const rootEl = $('root');
  PITCH_CLASSES.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = p.sharp === p.flat ? p.sharp : `${p.sharp} / ${p.flat}`;
    rootEl.append(o);
  });

  const scaleEl = $('scale');
  for (const s of SCALES) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.label;
    scaleEl.append(o);
  }

  const barsEl = $('bars');
  for (const n of BAR_OPTIONS) {
    const o = document.createElement('option');
    o.value = String(n);
    o.textContent = `${n}`;
    barsEl.append(o);
  }

  const quantEl = $('quantize');
  for (const q of QUANTIZE_OPTIONS) {
    const o = document.createElement('option');
    o.value = q.id;
    o.textContent = q.label;
    quantEl.append(o);
  }

  // ── Galerie ───────────────────────────────────────────────────────────
  const galleryEl = $('galleryList');
  for (const item of GALLERY) {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';
    const sc = SCALE_BY_ID[item.settings.scale];
    const rootName = PITCH_CLASSES[item.settings.root].sharp;
    card.innerHTML = `
      <canvas class="card-thumb" width="320" height="108" aria-hidden="true"></canvas>
      <strong>${item.title}</strong>
      <span class="card-text">${item.blurb}</span>
      <span class="card-meta">${rootName} ${sc.label} · ${item.settings.bpm} BPM · ${item.settings.bars} Takte</span>`;
    card.addEventListener('click', () => actions.loadGallery(item.id));
    galleryEl.append(card);
    drawThumb(card.querySelector('canvas'), item);
  }

  // ── Tastenkürzel ──────────────────────────────────────────────────────
  const shortcutEl = $('shortcutList');
  for (const [keys, what] of SHORTCUTS) {
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `<span>${what}</span><kbd>${keys}</kbd>`;
    shortcutEl.append(row);
  }

  // ── Bindings ──────────────────────────────────────────────────────────
  const els = {
    play: $('btnPlay'), rewind: $('btnRewind'), metro: $('btnMetro'),
    bpm: $('bpm'), bpmOut: $('bpmOut'), tap: $('btnTap'),
    undo: $('btnUndo'), redo: $('btnRedo'),
    gallery: $('btnGallery'), export: $('btnExport'), settings: $('btnSettings'), help: $('btnHelp'),
    root: rootEl, scale: scaleEl, scaleHint: $('scaleHint'),
    lowOctave: $('lowOctave'), lowOut: $('lowOut'), octaves: $('octaves'), octOut: $('octOut'),
    bars: barsEl, beatsPerBar: $('beatsPerBar'), quantize: quantEl,
    swing: $('swing'), swingOut: $('swingOut'), volume: $('volume'), volOut: $('volOut'),
    clear: $('btnClear'), fit: $('btnFit'),
    panel: $('panel'), panelGrip: $('panelGrip'),
    badgeLoop: $('badgeLoop'), badgeNotes: $('badgeNotes'), badgeZoom: $('badgeZoom'),
    hint: $('stageHint'), live: $('live'), toast: $('toast'),
    boot: $('boot'), bootStatus: $('bootStatus'),
    dlgGallery: $('dlgGallery'), dlgExport: $('dlgExport'), dlgSettings: $('dlgSettings'), dlgHelp: $('dlgHelp'),
    repeats: $('repeats'), exportStatus: $('exportStatus'),
    expWav: $('expWav'), expMidi: $('expMidi'), expPng: $('expPng'), expJson: $('expJson'),
    btnImport: $('btnImport'), fileImport: $('fileImport'),
    theme: $('theme'), contrast: $('contrast'), showLabels: $('showLabels'),
    btnMidi: $('btnMidi'), midiStatus: $('midiStatus'),
    btnForget: $('btnForget'), storageStatus: $('storageStatus'),
    offlineStatus: $('offlineStatus'), installRow: $('installRow'), btnInstall: $('btnInstall'),
    app: $('app'),
  };

  els.play.addEventListener('click', actions.togglePlay);
  els.rewind.addEventListener('click', actions.rewind);
  els.metro.addEventListener('click', actions.toggleMetronome);
  els.tap.addEventListener('click', actions.tapTempo);
  els.undo.addEventListener('click', actions.undo);
  els.redo.addEventListener('click', actions.redo);
  els.gallery.addEventListener('click', () => els.dlgGallery.showModal());
  els.export.addEventListener('click', () => els.dlgExport.showModal());
  els.settings.addEventListener('click', () => els.dlgSettings.showModal());
  els.help.addEventListener('click', () => els.dlgHelp.showModal());
  els.clear.addEventListener('click', actions.clearAll);
  els.fit.addEventListener('click', actions.fitView);
  $('btnGallery2').addEventListener('click', () => els.dlgGallery.showModal());
  $('btnExport2').addEventListener('click', () => els.dlgExport.showModal());
  $('btnTap2').addEventListener('click', actions.tapTempo);
  $('btnHelp2').addEventListener('click', () => els.dlgHelp.showModal());

  els.bpm.addEventListener('input', () => actions.set({ bpm: Number(els.bpm.value) }));
  els.root.addEventListener('change', () => actions.set({ root: Number(els.root.value) }));
  els.scale.addEventListener('change', () => actions.set({ scale: els.scale.value }));
  els.lowOctave.addEventListener('input', () => actions.set({ lowOctave: Number(els.lowOctave.value) }));
  els.octaves.addEventListener('input', () => actions.set({ octaves: Number(els.octaves.value) }));
  els.bars.addEventListener('change', () => actions.set({ bars: Number(els.bars.value) }));
  els.beatsPerBar.addEventListener('change', () => actions.set({ beatsPerBar: Number(els.beatsPerBar.value) }));
  els.quantize.addEventListener('change', () => actions.set({ quantize: els.quantize.value }));
  els.swing.addEventListener('input', () => actions.set({ swing: Number(els.swing.value) / 100 }));
  els.volume.addEventListener('input', () => actions.set({ volume: Number(els.volume.value) / 100 }));
  els.theme.addEventListener('change', () => actions.set({ theme: els.theme.value }));
  els.contrast.addEventListener('change', () => actions.set({ contrast: els.contrast.value }));
  els.showLabels.addEventListener('change', () => actions.set({ showLabels: els.showLabels.checked }));

  els.panelGrip.addEventListener('click', () => {
    const open = els.panel.classList.toggle('is-open');
    els.panelGrip.setAttribute('aria-expanded', String(open));
    actions.relayout();
  });

  // Auf dem Telefon liegen Galerie und Export nicht in der Kopfleiste —
  // dann übernimmt das Zahnrad per Langdruck. Einfacher: beide Dialoge
  // bekommen zusätzliche Auslöser in den Einstellungen.
  let toastTimer = null;

  const ui = {
    els,

    toast(message, kind = 'info') {
      els.toast.textContent = message;
      els.toast.classList.toggle('is-error', kind === 'error');
      els.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { els.toast.hidden = true; }, kind === 'error' ? 5200 : 2400);
    },

    announce(message) {
      // Zwischen zwei gleichen Texten braucht es eine Leerung, sonst liest
      // der Screenreader die Wiederholung nicht vor.
      els.live.textContent = '';
      requestAnimationFrame(() => { els.live.textContent = message; });
    },

    boot(message) { els.bootStatus.textContent = message; },
    bootDone() {
      els.app.hidden = false;
      els.boot.classList.add('is-done');
      setTimeout(() => els.boot.remove(), 420);
    },
    bootFail(message) {
      els.boot.classList.add('boot-error');
      els.bootStatus.textContent = message;
    },

    /** Zustand → Oberfläche. Wird nach jeder Änderung aufgerufen. */
    sync(s, extra) {
      setChecked(pensEl, 'pen', s.pen);
      setChecked(toolsEl, 'tool', s.tool);
      setChecked(brushEl, 'brush', s.brush);
      document.body.dataset.tool = s.tool;

      els.bpm.value = String(s.bpm);
      els.bpmOut.innerHTML = `${s.bpm}<small>BPM</small>`;
      els.root.value = String(s.root);
      els.scale.value = s.scale;
      els.bars.value = String(s.bars);
      els.beatsPerBar.value = String(s.beatsPerBar);
      els.quantize.value = s.quantize;
      els.lowOctave.value = String(s.lowOctave);
      els.octaves.value = String(s.octaves);
      els.swing.value = String(Math.round(s.swing * 100));
      els.volume.value = String(Math.round(s.volume * 100));
      els.theme.value = s.theme;
      els.contrast.value = s.contrast;
      els.showLabels.checked = s.showLabels;

      els.lowOut.textContent = noteNameWithOctave((s.lowOctave + 1) * 12 + s.root, s.root);
      els.octOut.textContent = String(s.octaves);
      els.swingOut.textContent = s.swing ? `${Math.round(s.swing * 100)} %` : 'aus';
      els.volOut.textContent = `${Math.round(s.volume * 100)} %`;
      els.scaleHint.textContent = `${SCALE_BY_ID[s.scale]?.mood ?? ''} — ${extra.rows} Zeilen, ${extra.lowNote} bis ${extra.highNote}.`;

      els.metro.setAttribute('aria-pressed', String(s.metronome));
      els.play.setAttribute('aria-pressed', String(extra.playing));
      els.play.setAttribute('aria-label', extra.playing ? 'Anhalten' : 'Abspielen');
      els.undo.disabled = !extra.canUndo;
      els.redo.disabled = !extra.canRedo;
      els.clear.disabled = !s.strokes.length;

      els.badgeLoop.textContent = `${s.bars} Takt${s.bars === 1 ? '' : 'e'} · ${s.beatsPerBar}/4`;
      els.badgeNotes.textContent = `${extra.noteCount} ${extra.noteCount === 1 ? 'Ton' : 'Töne'}`;
      const zoomed = extra.zoom > 1.01;
      els.badgeZoom.hidden = !zoomed;
      if (zoomed) els.badgeZoom.textContent = `${Math.round(extra.zoom * 100)} %`;

      els.hint.hidden = s.strokes.length > 0;

      const heavy = s.strokes.length > LIMITS.maxStrokes * 0.9;
      els.badgeNotes.style.color = heavy ? 'var(--danger)' : '';
      els.badgeNotes.title = heavy
        ? `${s.strokes.length} Striche — ab hier wird das Zeichnen auf langsameren Geräten zäh.`
        : `${s.strokes.length} Strich${s.strokes.length === 1 ? '' : 'e'}`;
    },

    closeDialogs() {
      for (const d of [els.dlgGallery, els.dlgExport, els.dlgSettings, els.dlgHelp]) {
        if (d.open) d.close();
      }
    },

    openGallery() { els.dlgGallery.showModal(); },
    openExport() { els.dlgExport.showModal(); },
    openHelp() { els.dlgHelp.showModal(); },
  };

  return ui;
}

function setChecked(container, attr, value) {
  for (const el of container.children) {
    el.setAttribute('aria-checked', String(el.dataset[attr] === value));
  }
}

/** Kleine Vorschau für die Galerie-Karten — dieselbe Form wie auf dem Blatt. */
function drawThumb(canvas, item) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const strokes = item.build();
  const beats = item.settings.bars * item.settings.beatsPerBar;
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    const pen = PENS.find((p) => p.id === s.pen) ?? PENS[0];
    ctx.strokeStyle = pen.color;
    ctx.fillStyle = pen.color;
    ctx.lineWidth = 3;
    if (s.points.length < 2) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = (p.t / beats) * W;
      const y = (1 - p.y) * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
