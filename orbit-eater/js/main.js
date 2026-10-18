/**
 * ORBIT EATER — Einstieg.
 *
 * Verdrahtet Simulation, Renderer, Audio, Eingabe und Interface und treibt
 * die Hauptschleife: Physik im festen Takt (SIM.hz) mit Akkumulator,
 * Darstellung so oft der Bildschirm will, dazwischen interpoliert.
 *
 * Zustände:  menu → play ⇄ pause
 *                    play → dead (Zeitlupe) → over → play | menu
 */
import { SIM, BODY, STAGES } from './config.js';
import { Emitter, clamp, damp } from './utils.js';
import { KIND } from './entities.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AdminConsole } from './admin.js';
import { storage } from './storage.js';

const STEP = 1 / SIM.hz;
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const canvas = document.getElementById('stage');
const events = new Emitter();
const game = new Game(events);
const renderer = new Renderer(canvas, events);
const audio = new AudioEngine();
const input = new Input(canvas);
renderer.camera.reduceMotion = reduceMotion;

let state = 'menu';
let acc = 0;
let last = performance.now();
let timeScale = 1;
let adminTime = 1;          // Zeitfaktor aus der Admin-Konsole (/zeit)
let warpScale = 1;
let warpTime = 0;
let deathTimer = 0;
let lastStats = null;
let debug = params.has('debug');
let prevSling = false;
const perf = { frame: 16, sim: 0, draw: 0, slowFor: 0 };

const ui = new UI({
  play: name => startGame(name),
  restart: () => startGame(ui.playerName()),
  resume: () => resume(),
  pause: () => pause(),
  menu: () => toMenu(),
  mute: () => toggleMute(),
  volume: v => {
    audio.unlock();
    audio.setVolume(v);
    ui.setAudio(audio.muted, audio.volume);
  },
  click: () => audio.ui('tick'),
  console: () => admin.open('/'),
});

const admin = new AdminConsole({
  game, renderer, ui, audio,
  isPlaying: () => state === 'play',
  setTimeScale: v => { adminTime = v; },
  getTimeScale: () => adminTime,
  toggleDebug,
});

function toggleDebug() {
  debug = !debug;
  if (!debug) ui.debug(null);
  return debug;
}

ui.buildStages((stage, size) => renderer.stageThumbnail(stage, size));
ui.setMode(input.mode);
ui.setAudio(audio.muted, audio.volume);
ui.showRecord(loadBest());
ui.show('start');
document.getElementById('meta-count').textContent = String(game.bodies.length);

input.handlers = {
  pause: () => (state === 'pause' ? resume() : pause()),
  mute: () => toggleMute(),
  confirm: () => {
    if (state === 'menu' || state === 'over') startGame(ui.playerName());
    else if (state === 'play') admin.open('/');
  },
  console: () => {
    if (state !== 'play') return false;
    admin.open('/');
    return true;
  },
  debug: () => toggleDebug(),
  mode: m => ui.setMode(m),
};
input.bindButton(document.getElementById('btn-sling'), v => { input.slingButton = v; });
input.bindButton(document.getElementById('btn-boost'), v => { input.boostButton = v; });

// Audio darf erst nach einer Nutzergeste starten.
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock, { passive: true });
window.addEventListener('keydown', unlock);

// --- Zustandswechsel -------------------------------------------------------

function startGame(name) {
  audio.unlock();
  audio.ui('confirm');
  if (game.player && game.player.alive) game.despawnPlayer();
  game.spawnPlayer(name);
  // Wirken noch Zeitlupe, Zoom oder eingefrorene Bots, zählt auch diese Runde nicht.
  game.cheated = admin.globalEffectsActive();
  ui.setAdmin(game.cheated);
  admin.close();
  state = 'play';
  timeScale = 1;
  warpTime = 0;
  input.reset();
  ui.resetHud();
  ui.resetHints();
  ui.show(null);
  ui.hint('move');
  setTimeout(() => { if (state === 'play') ui.hint('rules'); }, 5200);
  audio.setDuck(1);
}

function pause() {
  if (state !== 'play') return;
  admin.close();
  state = 'pause';
  input.reset();
  audio.setDuck(0.35);
  ui.show('pause');
}

function resume() {
  if (state !== 'pause') return;
  state = 'play';
  last = performance.now();
  audio.setDuck(1);
  ui.show(null);
}

function toMenu() {
  admin.close();
  if (game.player && game.player.alive) game.despawnPlayer();
  state = 'menu';
  audio.setDuck(1);
  ui.resetHints();
  ui.showRecord(loadBest());
  ui.show('start');
}

function toggleMute() {
  audio.unlock();
  audio.toggleMute();
  ui.setAudio(audio.muted, audio.volume);
}

/** Zeitlupe/Hitstop: kurz verlangsamen, dann weich zurück auf 1. */
function warp(scale, duration) {
  if (reduceMotion) return;
  warpScale = Math.min(warpScale, scale);
  warpTime = Math.max(warpTime, duration);
}

/**
 * Persönlicher Rekord. Rekorde aus der ersten Version (5 Stufen) werden auf
 * die heutigen 19 Stufen umgerechnet, damit dort nicht plötzlich "Lavamond"
 * statt "Gasriese" steht.
 */
function loadBest() {
  const best = storage.get('best', null);
  if (best && best.v !== 2) {
    best.stage = [0, 1, 5, 8, 12][best.stage] ?? 0;
    best.v = 2;
    storage.set('best', best);
  }
  return best;
}

function onPlayerDeath(e) {
  const p = e.body;
  state = 'dead';
  deathTimer = 1.6;
  warp(0.3, 0.9);
  audio.death();
  ui.flashDamage();
  ui.resetHints();
  ui.show('dead');

  const best = loadBest();
  const run = {
    cause: e.cause,
    killer: e.killer ? e.killer.name : null,
    killerMass: e.killer ? e.killer.mass : 0,
    mass: Math.max(0, p.mass),
    maxMass: p.maxMass,
    stage: p.maxStage,
    kills: p.kills,
    time: p.diedAt - p.bornAt,
    cheated: game.cheated,
  };
  run.isNewBest = !run.cheated && (!best || run.maxMass > best.mass);
  if (run.isNewBest) {
    storage.set('best', { v: 2, mass: Math.round(run.maxMass), stage: run.stage, kills: run.kills, time: run.time, date: Date.now() });
  }
  run.best = best;
  lastStats = run;
}

// --- Spielereignisse → Ton und Meldungen ---------------------------------------

events.on('eat', e => {
  if (!e.eater.isPlayer) return;
  if (e.kind === KIND.DUST) audio.eat(e.combo);
  else if (e.kind === KIND.ASTEROID) audio.eatChunk(e.combo);
  else { audio.eatComet(); ui.feed(['Komet geschnappt · ', `+${Math.round(e.gain)}`], 'self'); }
});

events.on('eatBody', e => {
  audio.gulp(e.victim.x, e.victim.y, e.eater.isPlayer);
  if (e.eater.isPlayer) {
    warp(0.2, 0.07);
    ui.feed(['Du hast ', e.victim.name, ` verschlungen · +${Math.round(e.gain)}`], 'good');
  }
});

events.on('death', e => {
  const b = e.body;
  if (b.isPlayer) {
    onPlayerDeath(e);
    return;
  }
  if (e.cause === 'shot') audio.explosion(b.x, b.y, b.r / 60);
  if (e.killer && e.killer.isPlayer && e.cause === 'shot') {
    warp(0.2, 0.08);
    ui.feed(['Volltreffer: ', b.name, ' zerlegt'], 'good');
  } else if (e.cause === 'blackhole' && renderer.near(b.x, b.y, 300)) {
    ui.feed(['', b.name, ' wurde spaghettifiziert'], 'bad');
  }
});

events.on('evolve', e => {
  if (!e.body.isPlayer) return;
  const s = STAGES[e.stage];
  audio.evolve(e.stage);
  if (e.first) ui.toast(`Stufe ${e.stage + 1} von ${STAGES.length}`, s.name, s.line);
  else ui.feed(['Wieder ', s.name], 'self');
});

events.on('devolve', e => {
  if (e.body.isPlayer) ui.feed(['Zurückgestuft: ', STAGES[e.stage].name], 'bad');
});

events.on('capture', e => {
  if (!e.body.isPlayer) return;
  audio.capture();
  ui.hint('orbit');
});

events.on('slingRelease', e => { if (e.body.isPlayer) audio.slingRelease(e.power); });
events.on('shot', e => audio.shot(e.body.isPlayer, e.debris.x, e.debris.y));

events.on('hit', e => {
  if (e.target.isPlayer) {
    audio.hurt();
    ui.flashDamage();
  } else {
    audio.hit(e.x, e.y, e.owner && e.owner.isPlayer);
  }
});

events.on('bump', e => audio.bump(e.x, e.y, e.speed));

events.on('bhSpawn', h => {
  audio.holeSpawn(h.x, h.y);
  const p = game.player;
  if (state === 'play' && p && p.alive) {
    const d = Math.hypot(h.x - p.x, h.y - p.y);
    ui.feed(['Gravitationsanomalie: ', 'Schwarzes Loch', ` entsteht · ${Math.round(d / 100) * 100} AE entfernt`], 'bad');
  }
});

events.on('bhCollapse', h => audio.holeCollapse(h.x, h.y));

events.on('comboEnd', e => {
  if (state !== 'play') return;
  audio.comboEnd(e.count);
  if (e.count >= 8) ui.feed([`Kombo ×${e.count} · `, `+${Math.round(e.gained)}`], 'self');
});

// --- Hauptschleife -------------------------------------------------------------

function controlPlayer() {
  const p = game.player;
  if (state !== 'play' || !p || !p.alive) return;
  const cam = renderer.camera;
  const z = cam.scale;
  const w = renderer.w, h = renderer.h;
  const sx = (p.x - cam.x) * z + w / 2;
  const sy = (p.y - cam.y) * z + h / 2;
  const c = input.control(sx, sy, p.r * z, (x, y) => ({ x: cam.x + (x - w / 2) / z, y: cam.y + (y - h / 2) / z }));
  game.setPlayerControl(c);

  // Klick ohne Munition: kurz anzeigen, warum nichts passiert
  if (c.sling && !prevSling && p.orbiters.length === 0 && p.slingQueue.length === 0) {
    audio.denied();
    ui.denyOrbit();
  }
  prevSling = c.sling;

  // Kontext-Hinweise (nur solange sie noch nicht gezeigt wurden)
  const seen = ui.hintsSeen;
  if (!seen.has('boost') && p.mass > BODY.boostMinMass + 4) ui.hint('boost');
  if (!seen.has('drain') && p.drain > 0.3) ui.hint('drain');
  if (!seen.has('hole')) {
    for (const hole of game.blackHoles) {
      if (Math.hypot(hole.x - p.x, hole.y - p.y) < hole.pullR * 1.1) ui.hint('hole');
    }
  }
  if (!seen.has('comet')) {
    for (const d of game.debris) {
      if (d.kind === KIND.COMET && Math.hypot(d.x - p.x, d.y - p.y) < 700) { ui.hint('comet'); break; }
    }
  }
}

function frame(now) {
  const real = Math.min((now - last) / 1000, 0.25);   // nach Tab-Wechsel nicht nachholen
  last = now;

  // Zeitlupe weich ein- und ausblenden
  if (warpTime > 0) {
    warpTime -= real;
    timeScale = damp(timeScale, warpScale, 30, real);
    if (warpTime <= 0) warpScale = 1;
  } else {
    timeScale = damp(timeScale, 1, 6, real);
  }

  const t0 = performance.now();
  if (state !== 'pause') {
    acc += real * timeScale * adminTime;
    let steps = 0;
    while (acc >= STEP && steps < SIM.maxStepsPerFrame) {
      controlPlayer();
      game.update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === SIM.maxStepsPerFrame) acc = 0;
  }
  const t1 = performance.now();

  if (state === 'dead') {
    deathTimer -= real;
    if (deathTimer <= 0) {
      state = 'over';
      ui.showGameOver(lastStats);
    }
  }

  const mode = state === 'menu' ? 'menu' : state === 'dead' || state === 'over' ? 'dead' : 'play';
  renderer.render(game, state === 'pause' ? 1 : clamp(acc / STEP, 0, 1), real, {
    mode,
    timeScale: state === 'pause' ? 0 : timeScale,
    input: state === 'play' && input.mode === 'touch' ? input : null,
    labels: state === 'play' || state === 'pause' || state === 'dead',
  });
  const t2 = performance.now();

  // Spawns bevorzugt außerhalb dessen, was die Kamera zeigt
  const v = renderer.view;
  game.focus.x = v.cx;
  game.focus.y = v.cy;
  game.focus.r = Math.hypot(v.x1 - v.x0, v.y1 - v.y0) / 2;

  const p = game.player && game.player.alive && state === 'play' ? game.player : null;
  let hole = 0;
  for (const hb of game.blackHoles) {
    const d = Math.hypot(hb.x - v.cx, hb.y - v.cy);
    hole = Math.max(hole, clamp(1 - d / (hb.pullR * 1.5), 0, 1) * hb.strength);
  }
  audio.update({
    boosting: !!(p && p.boosting),
    charge: p ? p.slingCharge : 0,
    hole,
    stage: p ? p.stage : 1,
    listenerX: v.cx,
    listenerY: v.cy,
  });
  if (state === 'play' || state === 'pause') ui.update(game, real, v);
  else ui.updateHints(real);

  measure(real, t1 - t0, t2 - t1);
  requestAnimationFrame(frame);
}

/**
 * Leistungswächter: Bleibt die Bildrate über Sekunden zu niedrig, wird die
 * Renderauflösung gesenkt — sonst nichts. Spielgefühl vor Schärfe.
 */
function measure(real, sim, draw) {
  perf.frame = perf.frame * 0.95 + real * 1000 * 0.05;
  perf.sim = perf.sim * 0.95 + sim * 0.05;
  perf.draw = perf.draw * 0.95 + draw * 0.05;
  if (perf.frame > 24 && renderer.maxDpr > 1) {
    perf.slowFor += real;
    if (perf.slowFor > 3) {
      renderer.setMaxDpr(Math.max(1, renderer.maxDpr - 0.5));
      perf.slowFor = 0;
    }
  } else {
    perf.slowFor = Math.max(0, perf.slowFor - real);
  }
  if (debug) {
    const n = { dust: game.counts.dust, ast: game.counts.asteroid, comet: game.counts.comet };
    ui.debug(
      `${(1000 / perf.frame).toFixed(0)} fps · Frame ${perf.frame.toFixed(1)} ms · Sim ${perf.sim.toFixed(2)} ms · Render ${perf.draw.toFixed(2)} ms\n` +
      `Körper ${game.bodies.length} · Staub ${n.dust} · Asteroiden ${n.ast} · Kometen ${n.comet} · Löcher ${game.blackHoles.length} · ` +
      `Partikel ${renderer.fx.active.length} · DPR ${renderer.dpr}`,
    );
  }
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

if (debug) window.__OE = { game, renderer, audio, input, ui, get state() { return state; } };
window.__oeBooted = true;
requestAnimationFrame(t => {
  last = t;
  requestAnimationFrame(frame);
});
