/**
 * Entry point: owns the clock, wires the interface to the simulation, and
 * keeps a save in local storage.
 *
 * The simulation is a pure step function — one call per business day — so the
 * clock here is nothing more than an accumulator over animation frames. That
 * also means a background tab cannot fast-forward the economy: the elapsed
 * time per frame is capped.
 */

import { createGame, tickDay } from './economy.js';
import { createUI } from './ui.js';
import { save, load, clearSave } from './save.js';

/* Seconds of real time per simulated day, per speed step. */
const SPEEDS = [Infinity, 2.4, 1.1, 0.45];

const host = document.getElementById('app');
const startScreen = document.getElementById('start');

let game = null;
let speed = 1;
let acc = 0;
let last = 0;
let ui = null;

const api = {
  game: () => game,
  getSpeed: () => speed,
  setSpeed: (v) => { speed = Math.max(0, Math.min(3, v | 0)); },
  save: () => (game ? save(game) : false),
  newGame: () => {
    clearSave();
    game = createGame();
    speed = 1;
    acc = 0;
    ui.render(game);
    ui.toast('Neue Kette, 25.000 € Startkapital.');
  },
};

function begin(loaded) {
  game = loaded || createGame();
  ui = ui || createUI(host, api);
  startScreen.hidden = true;
  host.hidden = false;
  ui.render(game);
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.5); // a hidden tab must not fast-forward
  last = now;
  if (!game || game.over || speed === 0) return;

  acc += dt;
  const per = SPEEDS[speed];
  let ticked = false;
  // At most a handful of days per frame, so a slow machine stays responsive.
  for (let i = 0; i < 4 && acc >= per; i++) {
    acc -= per;
    tickDay(game);
    ticked = true;
  }
  if (ticked) {
    ui.render(game);
    if (game.day % 10 === 0) save(game);
    if (game.over) { speed = 0; save(game); }
  }
}

/* ------------------------------------------------------------- start-up */

const existing = load();
document.getElementById('continue').hidden = !existing;
if (existing) {
  document.getElementById('continue').textContent =
    `Weiterspielen — Tag ${existing.day}`;
}

document.getElementById('continue').addEventListener('click', () => begin(existing));
document.getElementById('fresh').addEventListener('click', () => { clearSave(); begin(null); });

document.addEventListener('keydown', (ev) => {
  if (!game || ev.target.matches('input, textarea')) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    speed = speed === 0 ? 1 : 0;
    ui.render(game);
  } else if (ev.key >= '1' && ev.key <= '3') {
    speed = Number(ev.key);
    ui.render(game);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game) save(game);
  last = performance.now();
});

window.addEventListener('beforeunload', () => { if (game) save(game); });
window.addEventListener('resize', () => { if (game && ui) ui.render(game); });
