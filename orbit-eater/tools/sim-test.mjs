/**
 * Headless-Test der Simulation — ohne Browser, ohne Abhängigkeiten.
 *
 *   node tools/sim-test.mjs [seed] [minuten]
 *
 * Lässt die Welt im festen Takt laufen, steuert den Spieler per Autopilot
 * (dieselbe KI wie die Bots) und prüft dabei laufend Invarianten:
 * keine NaN-Werte, konsistente Zähler, saubere Orbit-Besitzverhältnisse.
 * Am Ende: Tick-Zeit, Fortschritt des Spielers, Ereignisstatistik.
 * Exit-Code 1, wenn eine Invariante verletzt wurde.
 */
import { performance } from 'node:perf_hooks';
import { Game } from '../js/game.js';
import { BotBrain } from '../js/ai.js';
import { Emitter, setSeed, fmtTime } from '../js/utils.js';
import { SIM, STAGES, BOTS, WORLD } from '../js/config.js';
import { KIND, STATE } from '../js/entities.js';

const seed = Number(process.argv[2] ?? 1);
const minutes = Number(process.argv[3] ?? 6);
setSeed(seed);

const events = new Emitter();
const tally = {};
for (const t of ['eat', 'eatBody', 'capture', 'absorb', 'death', 'evolve', 'shot', 'hit', 'bump', 'bhSpawn', 'bhCollapse', 'comboEnd']) {
  tally[t] = 0;
  events.on(t, () => tally[t]++);
}
const deathCauses = { eaten: 0, blackhole: 0, shot: 0 };
events.on('death', e => deathCauses[e.cause]++);

const game = new Game(events);
const dt = 1 / SIM.hz;

// --- Autopilot-Spieler -----------------------------------------------------
const runs = [];
let run = null;
function spawn() {
  const p = game.spawnPlayer('Autopilot');
  p.brain = new BotBrain();          // ab jetzt steuert ihn die Bot-KI
  run = { start: game.time, stageAt: [0], maxMass: p.mass, kills: 0, end: null, cause: null };
  runs.push(run);
}
events.on('evolve', e => {
  if (e.body.isPlayer && e.first) run.stageAt[e.stage] = game.time - run.start;
});
events.on('death', e => {
  if (e.body.isPlayer) {
    run.end = game.time - run.start;
    run.cause = e.cause + (e.killer ? ` (${e.killer.name}, ${Math.round(e.killer.mass)})` : '');
    run.maxMass = e.body.maxMass;
    run.kills = e.body.kills;
    respawnPlayerAt = game.time + 2;
  }
});
let respawnPlayerAt = Infinity;

// --- Invarianten ------------------------------------------------------------
const errors = [];
function fail(msg) {
  if (errors.length < 20) errors.push(`[${game.time.toFixed(2)}s] ${msg}`);
}
function bad(v) { return !Number.isFinite(v); }

function check() {
  const counts = { dust: 0, asteroid: 0, comet: 0 };
  for (const d of game.debris) {
    if (d.dead) continue;
    counts[['dust', 'asteroid', 'comet'][d.kind]]++;
    if (bad(d.x) || bad(d.y) || bad(d.vx) || bad(d.vy) || bad(d.mass)) fail(`NaN in Debris kind=${d.kind} state=${d.state}`);
    if (d.state === STATE.ORBIT) {
      if (!d.owner) fail('Orbiter ohne Besitzer');
      else if (!d.owner.orbiters.includes(d)) fail('Orbiter fehlt in owner.orbiters');
    }
    if (d.state === STATE.FREE && Math.hypot(d.x, d.y) > WORLD.radius + 500 && d.kind !== KIND.COMET) fail('Trümmer weit außerhalb der Arena');
  }
  for (const k of Object.keys(counts)) {
    // Gezählt wird beim Entfernen — tote, noch nicht aufgeräumte Objekte gibt es nach cleanup() nicht.
    if (counts[k] !== game.counts[k]) fail(`Zähler ${k}: ${game.counts[k]} ≠ ${counts[k]}`);
  }
  for (const b of game.bodies) {
    if (bad(b.x) || bad(b.y) || bad(b.vx) || bad(b.vy) || bad(b.mass) || bad(b.r)) fail(`NaN in Body ${b.name}`);
    if (b.alive && b.mass <= 0) fail(`Masse <= 0 bei ${b.name}`);
    for (const o of b.orbiters) if (o.owner !== b || o.state !== STATE.ORBIT || o.dead) fail(`inkonsistenter Orbiter bei ${b.name}`);
  }
  const bots = game.bodies.filter(b => !b.isPlayer && !b.removed).length;
  const alive = game.bodies.filter(b => !b.isPlayer && b.alive).length;
  if (alive + game.respawnAt.length > BOTS.count) fail(`zu viele Bots: ${alive} + ${game.respawnAt.length} Respawns`);
  if (bots === 0) fail('keine Bots mehr');
}

// --- Lauf --------------------------------------------------------------------
spawn();
const ticks = Math.round(minutes * 60 * SIM.hz);
let worst = 0, total = 0;
const massSamples = [];
for (let i = 0; i < ticks; i++) {
  if (!game.player.alive && game.time >= respawnPlayerAt) {
    respawnPlayerAt = Infinity;
    spawn();
  }
  const t0 = performance.now();
  game.update(dt);
  const t = performance.now() - t0;
  total += t;
  if (i > 60 && t > worst) worst = t;
  if (i % SIM.hz === 0) check();
  if (i % (SIM.hz * 30) === 0) {
    const masses = game.bodies.filter(b => b.alive && !b.isPlayer).map(b => b.mass).sort((a, b) => b - a);
    massSamples.push(`${fmtTime(game.time)}  Bots: max ${Math.round(masses[0])}, median ${Math.round(masses[masses.length >> 1])}  · Staub ${game.counts.dust} · Asteroiden ${game.counts.asteroid} · Löcher ${game.blackHoles.length}`);
  }
}

// --- Bericht -------------------------------------------------------------------
const stageName = i => STAGES[i].name;
console.log(`\nORBIT EATER · Simulationstest · Seed ${seed} · ${minutes} min Spielzeit`);
console.log(`Tick: Ø ${(total / ticks).toFixed(3)} ms, Spitze ${worst.toFixed(2)} ms (Budget bei 60 Hz: 16,7 ms)\n`);
console.log('Weltzustand alle 30 s:');
for (const l of massSamples) console.log('  ' + l);
console.log('\nAutopilot-Läufe:');
for (const r of runs) {
  const stages = r.stageAt.map((t, i) => (t === undefined ? null : `${stageName(i)} ${fmtTime(t)}`)).filter(Boolean).join(' → ');
  console.log(`  ${r.end === null ? 'läuft' : 'tot nach ' + fmtTime(r.end)} · max. Masse ${Math.round(r.maxMass)} · Kills ${r.kills} · ${stages}${r.cause ? ' · ' + r.cause : ''}`);
}
console.log('\nEreignisse:', JSON.stringify(tally));
console.log('Todesursachen:', JSON.stringify(deathCauses));

if (errors.length) {
  console.log('\nFEHLER:');
  for (const e of errors) console.log('  ' + e);
  process.exit(1);
}
console.log('\nAlle Invarianten erfüllt.');
