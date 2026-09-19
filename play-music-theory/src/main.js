// Bootstrap und Verdrahtung. Hier weiß jedes Modul vom anderen — sonst nirgends.

import { LIMITS, PEN_BY_ID, PENS, QUANTIZE_BY_ID, AUDIO } from './config.js';
import { buildLadder, SCALE_BY_ID } from './theory.js';
import { createStore, nextId } from './state.js';
import { strokesToNotes, swingBeat, clamp } from './strokes.js';
import { createPaper } from './paper.js';
import { attachPointer } from './pointer.js';
import { attachKeyboard } from './keyboard.js';
import { createEngine } from './audio/engine.js';
import { createSequencer } from './sequencer.js';
import { renderLoop } from './audio/render.js';
import { encodeWav } from './export/wav.js';
import { encodeMidi } from './export/midi.js';
import { createUI } from './ui.js';
import { GALLERY, loadGalleryItem } from './gallery.js';
import { saveSession, loadSession, clearSession, toFile, fromFile } from './storage.js';
import { createMidiInput } from './midiin.js';

const store = createStore();
let ui, paper, engine = null, sequencer = null, pointerCtl = null;
let scene = null;
let notes = [];
let notesDirty = true;
let needsRender = true;
let rafId = null;
let installPrompt = null;
let palette = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Abgeleiteter Zustand ────────────────────────────────────────────────────
// Was Zeichnung und Darstellung brauchen, aber nicht selbst ausrechnen sollen.
function rebuildScene() {
  const s = store.state;
  const q = QUANTIZE_BY_ID[s.quantize] ?? QUANTIZE_BY_ID['1/8'];
  const ladder = buildLadder({ root: s.root, scale: s.scale, lowOctave: s.lowOctave, octaves: s.octaves });
  const totalBeats = s.bars * s.beatsPerBar;
  scene = {
    ...s,
    ladder,
    stepsPerBeat: q.perBeat,
    triplet: q.triplet,
    totalBeats,
    totalSteps: Math.round(totalBeats * q.perBeat),
    scaleSteps: SCALE_BY_ID[s.scale]?.steps.length ?? 7,
    playing: sequencer?.playing ?? false,
    reducedMotion,
    palette: palette ?? (palette = readPalette()),
  };
  notesDirty = true;
  return scene;
}

const getScene = () => scene;

function getNotes() {
  if (notesDirty) {
    notes = strokesToNotes({
      strokes: scene.strokes,
      ladder: scene.ladder,
      totalBeats: scene.totalBeats,
      stepsPerBeat: scene.stepsPerBeat,
    });
    notesDirty = false;
  }
  return notes;
}

/** Die Canvas-Farben kommen aus demselben Stylesheet wie alles andere —
 *  so bleibt ein Themenwechsel eine Sache und nicht zwei. */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  return {
    paperTop: v('--paper-top', '#0f131b'),
    paperBottom: v('--paper-bottom', '#0a0d13'),
    gutter: v('--gutter', '#0c1017'),
    gutterEdge: v('--gutter-edge', '#232b3a'),
    rowLine: v('--row-line', '#1a2130'),
    rootLine: v('--root-line', '#35445f'),
    rootBand: v('--root-band', 'rgba(90,200,250,.045)'),
    fifthBand: v('--fifth-band', 'rgba(255,255,255,.014)'),
    stepLine: v('--step-line', '#141a25'),
    beatLine: v('--beat-line', '#1e2634'),
    barLine: v('--bar-line', '#384660'),
    barLabel: v('--bar-label', '#56617b'),
    label: v('--label', '#6f7a92'),
    labelStrong: v('--label-strong', '#b9c4da'),
    playhead: v('--playhead', 'rgba(255,255,255,.92)'),
    playheadTrail: v('--playhead-trail', 'rgba(120,200,255,.12)'),
    cursor: v('--cursor', '#ffd479'),
  };
}

function applyTheme() {
  const s = store.state;
  const resolved = s.theme === 'system'
    ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : s.theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.contrast = s.contrast;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolved === 'light' ? '#ffffff' : '#0b0d12');
  // Die Canvas-Farben stehen im selben Stylesheet. Einmal auslesen und merken:
  // getComputedStyle bei jedem Strich wäre auf dem Telefon spürbar.
  palette = readPalette();
}

// ── Audio ───────────────────────────────────────────────────────────────────
// Erst auf eine echte Geste hin. Vorher lehnt jeder Browser ab, und auf iOS im
// iframe bleibt resume() unter Umständen für immer offen — darum eine Frist
// statt eines nackten await.
async function ensureAudio() {
  if (engine) {
    if (engine.ctx.state === 'suspended') await withTimeout(engine.ctx.resume(), 900);
    return engine;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) { ui.toast('Dieser Browser kann keinen Ton erzeugen.', 'error'); return null; }
  const ctx = new Ctor({ latencyHint: 'interactive' });
  engine = createEngine(ctx, { volume: store.state.volume * AUDIO.masterGain });
  await withTimeout(ctx.resume(), 900);

  sequencer = createSequencer({
    engine,
    getPlan: () => ({
      notes: getNotes(),
      loopBeats: scene.totalBeats,
      stepsPerBeat: scene.stepsPerBeat,
      swing: scene.swing,
      triplet: scene.triplet,
      metronome: scene.metronome,
      beatsPerBar: scene.beatsPerBar,
    }),
  });
  sequencer.setBpm(store.state.bpm);
  return engine;
}

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => null),
    new Promise((res) => setTimeout(res, ms)),
  ]);
}

// ── Bildschleife ────────────────────────────────────────────────────────────
function requestRender() {
  needsRender = true;
  if (rafId == null) rafId = requestAnimationFrame(frame);
}

let lastFlashBeat = -1;

function frame(now) {
  rafId = null;
  const playing = sequencer?.playing ?? false;

  if (playing) {
    const beat = sequencer.position(scene.totalBeats);
    paper.setPlayhead(beat);

    // Noten aufleuchten lassen, sobald der Abspielkopf sie erreicht.
    if (!reducedMotion) {
      const from = lastFlashBeat;
      const wrapped = beat < from;
      for (const n of getNotes()) {
        const s = swingBeat(n.startBeat, scene.stepsPerBeat, scene.swing, scene.triplet);
        const hit = wrapped ? (s >= from || s <= beat) : (s > from && s <= beat);
        if (hit) paper.flash({ row: n.row, startBeat: s, durBeats: n.durBeats, pen: n.pen }, now);
      }
    }
    lastFlashBeat = beat;
    needsRender = true;
  }

  if (playing) checkVoiceDrops();

  if (needsRender) {
    paper.render(now);
    needsRender = false;
  }
  if (playing || paper.hasFlashes?.()) rafId = requestAnimationFrame(frame);
}

// Die Stimmenbegrenzung schützt vor Zerren, lässt dabei aber Töne weg. Das
// einmal zu sagen ist ehrlicher, als den Nutzer rätseln zu lassen, warum sein
// dichtes Bild dünner klingt, als es aussieht.
let dropWarned = false;
function checkVoiceDrops() {
  if (dropWarned || !engine || engine.droppedVoices < 24) return;
  dropWarned = true;
  ui.toast('Sehr viele Töne gleichzeitig — einige werden weggelassen.');
}

function ensureLoop() {
  if (rafId == null) rafId = requestAnimationFrame(frame);
}

// ── Aktionen ────────────────────────────────────────────────────────────────
const tapTimes = [];

const actions = {
  set(patch) {
    const before = store.state;
    store.set(patch);
    const s = store.state;

    if ('theme' in patch || 'contrast' in patch) applyTheme();
    if ('volume' in patch && engine) engine.setVolume(s.volume * AUDIO.masterGain);
    if ('bpm' in patch && sequencer) sequencer.setBpm(s.bpm);

    rebuildScene();
    if ('bars' in patch || 'beatsPerBar' in patch) {
      // Schleife wurde kürzer: was draußen liegt, würde stumm bleiben.
      trimToLoop();
    }
    paper.invalidateGrid();
    paper.invalidateStrokes();
    if (before.bars !== s.bars || before.beatsPerBar !== s.beatsPerBar) paper.setView({ zoom: paper.view.zoom, panBeat: 0 });
    sequencer?.reflow();
    sync();
    requestRender();
  },

  setPen(id) { actions.set({ pen: id }); ui.announce(`Stift: ${PEN_BY_ID[id].label}`); },
  setTool(id) { actions.set({ tool: id }); },
  setBrush(id) { actions.set({ brush: id }); },
  selectPen(i) { if (PENS[i]) actions.setPen(PENS[i].id); },
  selectTool(id) { actions.setTool(id); },

  async togglePlay() {
    const e = await ensureAudio();
    if (!e) return;
    if (sequencer.playing) {
      sequencer.stop();
      ui.announce('Angehalten');
    } else {
      lastFlashBeat = -1;
      sequencer.start();
      ui.announce('Läuft');
      ensureLoop();
    }
    rebuildScene();
    sync();
    requestRender();
  },

  rewind() {
    sequencer?.rewind();
    lastFlashBeat = -1;
    paper.setPlayhead(0);
    ui.announce('Am Anfang');
    requestRender();
  },

  async toggleMetronome() {
    await ensureAudio();
    actions.set({ metronome: !store.state.metronome });
    ui.announce(store.state.metronome ? 'Metronom an' : 'Metronom aus');
  },

  tapTempo() {
    const now = performance.now();
    while (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2200) tapTimes.length = 0;
    tapTimes.push(now);
    if (tapTimes.length > 5) tapTimes.shift();
    if (tapTimes.length < 2) { ui.toast('Weiterklopfen …'); return; }
    let sum = 0;
    for (let i = 1; i < tapTimes.length; i += 1) sum += tapTimes[i] - tapTimes[i - 1];
    const bpm = clamp(Math.round(60000 / (sum / (tapTimes.length - 1))), LIMITS.bpmMin, LIMITS.bpmMax);
    actions.set({ bpm });
    ui.toast(`${bpm} BPM`);
  },

  nudgeBpm(delta) {
    actions.set({ bpm: clamp(store.state.bpm + delta, LIMITS.bpmMin, LIMITS.bpmMax) });
    ui.announce(`${store.state.bpm} BPM`);
  },

  undo() {
    const label = store.undo();
    ui.announce(label ? `Rückgängig: ${label}` : 'Nichts zum Rückgängigmachen');
    afterStrokes();
  },
  redo() {
    const label = store.redo();
    ui.announce(label ? `Wiederholt: ${label}` : 'Nichts zum Wiederholen');
    afterStrokes();
  },

  clearAll() {
    if (!store.state.strokes.length) return;
    store.commitStrokes([], 'Blatt geleert');
    ui.toast('Blatt geleert — Strg+Z holt es zurück');
    afterStrokes();
  },

  fitView() { paper.setView({ zoom: 1, panBeat: 0 }); requestRender(); sync(); },
  /** Nach Zoom oder Verschieben: die Plakette zeigt sonst ewig 100 %.
   *  Billig, weil die Notenliste dabei aus dem Zwischenspeicher kommt. */
  viewChanged() { sync(); requestRender(); },
  relayout() { requestAnimationFrame(() => { paper.resize(); requestRender(); }); },

  preview(midi, pen) {
    if (!engine) return;   // vor der ersten Geste gibt es keinen Ton, das ist so
    engine.ping({ midi, pen, velocity: 0.7, dur: 0.3 });
  },

  loadGallery(id) {
    const item = GALLERY.find((x) => x.id === id);
    if (!item) return;
    store.load(loadGalleryItem(item));
    applyTheme();
    rebuildScene();
    paper.setView({ zoom: 1, panBeat: 0 });
    paper.invalidateGrid();
    paper.invalidateStrokes();
    sequencer?.setBpm(store.state.bpm);
    sequencer?.reflow();
    ui.closeDialogs();
    ui.toast(`„${item.title}" geladen`);
    ui.announce(`${item.title} geladen. ${item.blurb}`);
    sync();
    requestRender();
  },

  gallery() { ui.openGallery(); },
  exportDialog() { ui.openExport(); },
  help() { ui.openHelp(); },
  closeDialogs() { ui.closeDialogs(); },
  saveProject() { downloadProject(); },
};

function trimToLoop() {
  const max = scene.totalBeats;
  const kept = store.state.strokes.filter((s) => s.points.some((p) => p.t <= max));
  if (kept.length !== store.state.strokes.length) {
    store.commitStrokes(kept, 'Außerhalb der Schleife entfernt');
    ui.toast('Striche außerhalb der Schleife wurden entfernt');
  }
  notesDirty = true;
}

function afterStrokes() {
  notesDirty = true;
  paper.invalidateStrokes();
  sequencer?.reflow();
  sync();
  requestRender();
}

function sync() {
  const s = store.state;
  const list = getNotes();
  ui.sync(s, {
    playing: sequencer?.playing ?? false,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    noteCount: list.length,
    rows: scene.ladder.length,
    lowNote: scene.ladder[0].full,
    highNote: scene.ladder[scene.ladder.length - 1].full,
    zoom: paper.view.zoom,
  });
}

// ── Export ──────────────────────────────────────────────────────────────────
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function baseName() {
  const s = store.state;
  const safe = (s.title || 'skizze').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'skizze';
  return `pmt-${safe.toLowerCase()}-${s.bpm}bpm`;
}

function downloadProject() {
  download(toFile(store), `${baseName()}.pmt.json`);
  ui.toast('Projekt gesichert');
}

async function exportWav() {
  const list = getNotes();
  if (!list.length) { ui.toast('Das Blatt ist leer.', 'error'); return; }
  const repeats = Number(ui.els.repeats.value);
  ui.els.exportStatus.textContent = 'wird gerendert …';
  try {
    const buffer = await renderLoop({
      notes: list,
      bpm: store.state.bpm,
      loopBeats: scene.totalBeats,
      stepsPerBeat: scene.stepsPerBeat,
      swing: scene.swing,
      triplet: scene.triplet,
      repeats,
      volume: store.state.volume * AUDIO.masterGain,
    });
    download(encodeWav(buffer), `${baseName()}.wav`);
    const secs = Math.round(buffer.duration);
    ui.els.exportStatus.textContent = `WAV gespeichert — ${secs} Sekunden, ${buffer.sampleRate / 1000} kHz, Stereo.`;
  } catch (err) {
    ui.els.exportStatus.textContent = `Hat nicht geklappt: ${err.message}`;
    ui.toast('WAV-Export fehlgeschlagen', 'error');
  }
}

function exportMidi() {
  const list = getNotes();
  if (!list.length) { ui.toast('Das Blatt ist leer.', 'error'); return; }
  const repeats = Number(ui.els.repeats.value);
  const programs = Object.fromEntries(PENS.map((p) => [p.id, p.midiProgram]));
  const blob = encodeMidi({
    notes: list,
    programs,
    bpm: store.state.bpm,
    beatsPerBar: store.state.beatsPerBar,
    loopBeats: scene.totalBeats,
    repeats,
    warp: (b) => swingBeat(b, scene.stepsPerBeat, scene.swing, scene.triplet),
    title: store.state.title,
  });
  download(blob, `${baseName()}.mid`);
  const tracks = new Set(list.map((n) => n.pen)).size;
  ui.els.exportStatus.textContent = `MIDI gespeichert — ${list.length} Noten in ${tracks} Track${tracks === 1 ? '' : 's'}.`;
}

function exportPng() {
  const canvas = paper.composite();
  canvas.toBlob((blob) => {
    if (!blob) { ui.toast('PNG-Export fehlgeschlagen', 'error'); return; }
    download(blob, `${baseName()}.png`);
    ui.els.exportStatus.textContent = `Bild gespeichert — ${canvas.width} × ${canvas.height} Pixel.`;
  }, 'image/png');
}

// ── MIDI-Eingabe ────────────────────────────────────────────────────────────
const midi = createMidiInput({
  onNote({ midi: note, velocity, on }) {
    if (!on || !engine) return;
    const row = nearestRow(note);
    engine.ping({ midi: scene.ladder[row].midi, pen: store.state.pen, velocity: velocity || 0.8, dur: 0.4 });
    // Läuft die Schleife, landet das Gespielte im Blatt — damit ergänzt ein
    // Keyboard die Zeichnung, statt danebenzustehen.
    if (sequencer?.playing) {
      const beat = sequencer.position(scene.totalBeats);
      const step = Math.floor(beat * scene.stepsPerBeat);
      const t = step / scene.stepsPerBeat;
      const y = scene.ladder.length > 1 ? row / (scene.ladder.length - 1) : 0.5;
      store.commitStrokes([...store.state.strokes, {
        id: nextId(),
        pen: store.state.pen,
        brush: store.state.brush,
        points: [{ t, y, p: velocity || 0.8 }, { t: t + 0.5 / scene.stepsPerBeat, y, p: velocity || 0.8 }],
      }], 'MIDI-Ton');
      afterStrokes();
    }
  },
  onStatus({ ok, message }) {
    ui.els.midiStatus.textContent = message;
    ui.toast(message, ok ? 'info' : 'error');
  },
});

function nearestRow(note) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < scene.ladder.length; i += 1) {
    const d = Math.abs(scene.ladder[i].midi - note);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── Start ───────────────────────────────────────────────────────────────────
function boot() {
  ui = createUI({ actions });
  ui.boot('Oberfläche wird aufgebaut …');

  const restored = loadSession();
  if (restored) store.load(restored);
  applyTheme();
  rebuildScene();

  const canvas = document.getElementById('paper');
  paper = createPaper({ canvas, getScene });
  paper.resize();

  pointerCtl = attachPointer({
    canvas, paper, store, getScene,
    onPreview: (m, pen) => actions.preview(m, pen),
    onView: () => actions.viewChanged(),
    requestRender,
  });

  attachKeyboard({
    store, paper, getScene, actions,
    announce: (m) => ui.announce(m),
    requestRender,
  });

  // Ohne dieses rebuildScene() zeigt das Blatt nach einem Strich noch den
  // Stand davor: scene ist eine Momentaufnahme des Zustands, und commitStrokes
  // ersetzt das Array.
  store.on('strokes', () => {
    rebuildScene();
    paper.invalidateStrokes();
    requestRender();
    // Während einer laufenden Geste (Radierer über ein volles Blatt) wäre das
    // Neuberechnen aller Noten pro Zeigerbewegung der teuerste Teil. Der
    // Abschluss-Commit läuft ohnehin ohne Geste und holt alles nach.
    if (pointerCtl?.busy) return;
    sequencer?.reflow();
    sync();
    queueSave();
  });
  store.on('*', queueSave);

  // Größenänderung: Drehen des Telefons, Bottom-Sheet auf/zu, Fenster ziehen.
  const ro = new ResizeObserver(() => { paper.resize(); requestRender(); sync(); });
  ro.observe(canvas.parentElement);
  window.addEventListener('orientationchange', () => setTimeout(() => { paper.resize(); requestRender(); }, 260));
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (store.state.theme === 'system') { applyTheme(); rebuildScene(); paper.invalidateGrid(); paper.invalidateStrokes(); requestRender(); }
  });

  // Die erste Geste schaltet den Ton frei — egal welche.
  const unlock = () => { ensureAudio(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Export-Knöpfe
  ui.els.expWav.addEventListener('click', exportWav);
  ui.els.expMidi.addEventListener('click', exportMidi);
  ui.els.expPng.addEventListener('click', exportPng);
  ui.els.expJson.addEventListener('click', downloadProject);
  ui.els.btnImport.addEventListener('click', () => ui.els.fileImport.click());
  ui.els.fileImport.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      store.load(await fromFile(file));
      applyTheme(); rebuildScene();
      paper.invalidateGrid(); paper.invalidateStrokes();
      sequencer?.setBpm(store.state.bpm);
      ui.closeDialogs();
      ui.toast('Projekt geöffnet');
      sync(); requestRender();
    } catch (err) {
      ui.toast(err.message, 'error');
    }
    ev.target.value = '';
  });

  ui.els.btnMidi.addEventListener('click', () => midi.connect());
  ui.els.btnForget.addEventListener('click', () => {
    clearSession();
    ui.els.storageStatus.textContent = 'Gelöscht. Beim nächsten Start beginnt ein leeres Blatt.';
  });
  ui.els.btnInstall.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    ui.els.installRow.hidden = true;
    if (outcome === 'accepted') ui.toast('Installiert — läuft jetzt auch ohne Netz');
  });

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    ui.els.installRow.hidden = false;
  });

  // Ein halb gezeichneter Strich soll nicht verloren gehen, wenn das Telefon
  // zwischendurch woandershin schaltet.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveSession(store); }
  });
  window.addEventListener('pagehide', () => saveSession(store));

  registerServiceWorker();
  sync();
  requestRender();
  ui.bootDone();

  if (!restored || !store.state.strokes.length) {
    ui.announce('Leeres Blatt. Zeichne mit der Maus, dem Finger oder mit den Pfeiltasten.');
  }
}

let saveTimer = null;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSession(store), 700);
}

async function registerServiceWorker() {
  const status = document.getElementById('offlineStatus');
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
    if (status) status.textContent = location.protocol === 'file:'
      ? 'Direkt aus einer Datei geöffnet — dann gibt es keinen Offline-Speicher, die App läuft trotzdem vollständig.'
      : 'Dieser Browser kann die App nicht offline vorhalten.';
    return;
  }
  try {
    await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' });
    if (status) status.textContent = 'Bereit für offline — die App läuft auch ohne Verbindung weiter.';
  } catch (err) {
    if (status) status.textContent = `Offline-Speicher nicht eingerichtet: ${err.message}`;
  }
}

try {
  boot();
} catch (err) {
  const fail = window.__pmtFail;
  if (fail) fail(`Start fehlgeschlagen: ${err?.message ?? err}`);
  throw err;
}
