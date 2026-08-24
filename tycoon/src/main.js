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
import { createWorld } from './world.js';
import { save, load, clearSave } from './save.js';
import { productById } from './data.js';
import { clamp, price } from './util.js';

/* Seconds of real time per simulated day, per speed step. */
const SPEEDS = [Infinity, 2.4, 1.1, 0.45];

/* The scene runs a day of its own, 14 seconds from morning light to night.
   Tying the sun to the tick would strobe at triple speed, where a business day
   is over in under half a second. The crowd on screen still reflects today's
   real numbers — only the clock on the wall is its own. */
const VISUAL_DAY = 14;

const host = document.getElementById('app');
const startScreen = document.getElementById('start');

let game = null;
let speed = 1;
let acc = 0;
let last = 0;
let ui = null;
let world = null;
let dayFrac = 0.12;

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
    world.clear();
    ui.render(game);
    ui.toast('Neue Kette, 25.000 € Startkapital.');
  },
};

function begin(loaded) {
  game = loaded || createGame();
  ui = ui || createUI(host, api);
  world = world || createWorld(document.getElementById('world'));
  // Opt-in handle for measuring the scene from the outside (?debug).
  if (location.search.includes('debug')) window.__kiosk = { world, frame: () => worldFrame(game), game: () => game };
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
  if (!game) return;

  const running = !game.over && speed !== 0;
  if (running) dayFrac = (dayFrac + dt / VISUAL_DAY) % 1;

  // The street keeps drawing while paused — frozen, with the pause card over it.
  const f = worldFrame(game);
  if (f) {
    if (running) world.update(dt, f);
    world.draw(f);
  }

  if (!running) return;

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

/* -------------------------------------------------------------- die welt
 *
 * Translates a day of the simulation into rates the scene can act on. Nothing
 * here invents a number: the crowd is the district's footfall, the share that
 * stops is the share that bought, and the counter serves at the ratio the
 * kitchen actually managed.
 */

function worldFrame(g) {
  const loc = g.locations.find((l) => l.id === ui.ui.loc) || g.locations[0];
  if (!loc) return null;
  const s = loc.stats;
  const footfall = s ? s.footfall : loc.footfall;
  // Arrivals are what the district *wanted* to buy — including the guests the
  // counter never got to. Whether they leave with food is the serve ratio's
  // business, and that is what makes a queue visible.
  const wanted = s ? s.unitsWanted * 0.62 : 0;
  const served = s ? s.units * 0.62 : 0;

  const passRate = clamp(footfall / 175, 0.5, 4.2);         // Passanten pro Sekunde
  const stopRate = clamp(wanted / Math.max(1, footfall), 0, 0.8);
  const serveRate = passRate * stopRate * (s ? s.serveRatio : 1);
  const ticket = served > 0 ? s.revenue / served : 0;

  const active = Object.keys(loc.products)
    .filter((id) => loc.products[id] && g.unlocked.has(id))
    .map((id) => ({ name: productById[id].name, price: price(g.prices[id] * loc.priceLevel) }));

  const mods = g.modifiers.filter((m) => !m.locationId || m.locationId === loc.id);
  const month = Math.floor(g.day / 30) % 12;
  const winter = month === 11 || month === 0 || month === 1;
  const wet = mods.some((m) => m.id === 'regen');

  return {
    loc,
    staffCount: loc.staff.length,
    upgrades: loc.upgrades,
    quality: loc.quality,
    competition: loc.competition,
    menu: active,
    passRate,
    stopRate,
    serveRate,
    ticket,
    ticketText: `+${price(ticket)}`,
    item: true,
    dayFraction: dayFrac,
    month,
    rain: wet && !winter,
    snow: wet && winter,
    heat: mods.some((m) => m.id === 'hitze'),
    paused: speed === 0 || !!g.over,
  };
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
