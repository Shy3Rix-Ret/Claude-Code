/**
 * The 2D world: the street in front of the branch you are looking at.
 *
 * Everything on screen comes out of the simulation rather than being decorative
 * filler. Passers-by arrive at the rate the district actually delivers today,
 * the share of them that stops is the share that buys, the counter serves at
 * the speed your staff manage, and whoever finds the queue full walks off —
 * which is exactly what the "verlorene Gäste" figure counts. The sky follows
 * the day, the weather follows the events, and the shop front is built from
 * the upgrades you bought.
 *
 * The scene is a faithful *sample*, not a census: at triple speed a day lasts
 * under half a second, so drawing all 500 pedestrians would be a smear. Rates
 * are scaled and capped; proportions are honest.
 */

import { QUALITY_TIERS } from './data.js';
import { makeRng, clamp, lerp } from './util.js';

/* The scene is anchored to its *width*, at a fixed number of scene units per
   CSS pixel: a pedestrian is the same size on a phone and on a desktop, a wider
   stage simply shows more street, and whatever height is left over becomes sky.
   Anchoring to the height instead would make a wide stage a thousand units
   across, and nobody would ever walk far enough to reach the counter. */
const UNIT = 1.35;
const DESIGN_MIN = 430;
const DESIGN_MAX = 1000;
const MAX_AGENTS = 70;

/* Filled in by resize(), in scene units. */
let VH = 340;            // visible height
let GROUND = 228;        // where the pavement begins
let KERB = 292;          // where the road begins

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/* Sky keyframes across the trading day, from 5 a.m. to 10 p.m. */
const SKY = [
  { t: 0.00, top: '#141a33', bot: '#c8703c', sun: '#f7c26b', light: 0.35 },
  { t: 0.14, top: '#3f6ea8', bot: '#cfd9dd', sun: '#ffe6ae', light: 0.9 },
  { t: 0.45, top: '#4f8ec4', bot: '#d7e6ee', sun: '#fff3d0', light: 1.0 },
  { t: 0.72, top: '#6d7fb4', bot: '#f0ab63', sun: '#ffd08a', light: 0.85 },
  { t: 0.87, top: '#2a2b4c', bot: '#c9663f', sun: '#ff9a5a', light: 0.45 },
  { t: 1.00, top: '#0b0e1c', bot: '#1b2036', sun: '#cfd8ff', light: 0.12 },
];

const COATS = ['#c9553f', '#3f6f8e', '#8a6bb0', '#4f7f5a', '#c98a3a', '#8d8f96', '#b2557e', '#3f5f9e'];
const SKIN = ['#e8c39a', '#c78d5e', '#8a5a3b', '#f0d3b4', '#5f3b28'];

/* ------------------------------------------------------------------ farbe */

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hex(a); const B = hex(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
/** Layout follows the viewport, so the horizon is recomputed every frame. */
function layout(cw, ch) {
  const design = Math.round(clamp(cw / UNIT, DESIGN_MIN, DESIGN_MAX));
  const scale = cw / design;
  VH = clamp(ch / scale, 210, 470);
  KERB = VH - 34;         // road
  GROUND = KERB - 58;     // pavement
  return { design, scale };
}

function skyAt(f) {
  let i = 0;
  while (i < SKY.length - 2 && f > SKY[i + 1].t) i++;
  const a = SKY[i]; const b = SKY[i + 1];
  const t = clamp((f - a.t) / (b.t - a.t || 1), 0, 1);
  return {
    top: mix(a.top, b.top, t),
    bot: mix(a.bot, b.bot, t),
    sun: mix(a.sun, b.sun, t),
    light: lerp(a.light, b.light, t),
  };
}

/* --------------------------------------------------------------- aufbau */

/** Each district gets its own skyline, palette and props, derived from its id
 *  so the same place always looks the same. */
function buildScene(loc, width) {
  const rng = makeRng([...loc.id].reduce((a, c) => a + c.charCodeAt(0) * 31, 7));
  const kindStyle = {
    Kiosk:        { facade: '#6b4f3a', awning: ['#c9553f', '#f0e0cc'], w: 268, h: 158 },
    Imbiss:       { facade: '#5c5240', awning: ['#d08a2c', '#2f2a24'], w: 292, h: 168 },
    'Café':       { facade: '#4a5a52', awning: ['#3f6f5a', '#e8dcc4'], w: 280, h: 172 },
    'Food-Court': { facade: '#57565f', awning: ['#4f6f9e', '#e2e6ee'], w: 320, h: 186 },
    Franchise:    { facade: '#5a4550', awning: ['#8a3f56', '#f0dcc8'], w: 330, h: 192 },
  }[loc.kind] || { facade: '#6b4f3a', awning: ['#c9553f', '#f0e0cc'], w: 268, h: 158 };

  const towers = [];
  let x = -40;
  while (x < width + 60) {
    const w = rng.range(34, 78);
    towers.push({
      x, w,
      h: rng.range(60, 190),
      hue: rng.range(0, 1),
      rows: Math.floor(rng.range(3, 8)),
      cols: Math.max(2, Math.floor(w / 18)),
      lit: rng() * 0.5 + 0.2,
    });
    x += w + rng.range(4, 14);
  }

  return {
    ...kindStyle,
    towers,
    rng: rng(),
    lampX: [width * 0.18, width * 0.82],
    treeX: width * 0.13,
    binX: width * 0.88,
  };
}

/* ------------------------------------------------------------------ welt */

export function createWorld(canvas) {
  const ctx = canvas.getContext('2d');
  let scene = null;
  let locId = null;
  let width = 600;

  const agents = [];
  const cars = [];
  const drops = [];   // floating "+2,40 €" receipts
  const drips = [];   // rain / snow
  const queue = [];
  let spawnAcc = 0;
  let serveAcc = 0;
  let carAcc = 6;
  let t = 0;
  let lastServed = 0;
  let balked = 0;

  const rng = makeRng(99);

  let scale = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return false;
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const l = layout(cw, ch);
    scale = l.scale * dpr;
    if (l.design !== width) {
      width = l.design;
      scene = null;   // the skyline is built for a given width
    }
    return true;
  }

  function counterX() { return width / 2 + 62; }

  /* ---------------------------------------------------------- agenten */

  function spawn(f) {
    if (agents.length >= MAX_AGENTS) return;
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = rng.chance(0.32) ? 0 : 1;
    agents.push({
      x: dir > 0 ? -20 : width + 20,
      dir,
      lane,
      speed: rng.range(26, 40) * (lane ? 1 : 0.85),
      phase: rng.range(0, 6.3),
      coat: rng.pick(COATS),
      skin: rng.pick(SKIN),
      hat: rng.chance(0.22),
      bag: rng.chance(0.3),
      state: 'pass',
      wantsToBuy: lane === 1 && rng() < f.stopRate * 1.35,
      slot: -1,
      hold: 0,
      item: null,
      mood: 0,
    });
  }

  function laneY(a) { return a.lane ? GROUND + 48 : GROUND + 16; }
  function laneScale(a) { return a.lane ? 1 : 0.72; }

  function updateAgents(dt, f) {
    const cx = counterX();
    const queueCap = 6;

    for (let i = agents.length - 1; i >= 0; i--) {
      const a = agents[i];
      a.phase += dt * a.speed * 0.22;

      if (a.state === 'pass') {
        a.x += a.dir * a.speed * dt;
        // Reached the shop and wants something?
        if (a.wantsToBuy && Math.abs(a.x - (cx - 52)) < 14) {
          if (queue.length < queueCap) {
            a.state = 'approach';
            a.slot = queue.length;
            queue.push(a);
          } else {
            a.state = 'balk';
            a.mood = -1;
            balked++;
          }
        }
        if (a.x < -40 || a.x > width + 40) agents.splice(i, 1);
      } else if (a.state === 'approach' || a.state === 'queue') {
        const target = cx - 32 - a.slot * 18;
        const d = target - a.x;
        if (Math.abs(d) < 1.5) {
          a.x = target;
          a.state = 'queue';
        } else {
          a.x += Math.sign(d) * Math.min(Math.abs(d), a.speed * dt);
          a.dir = Math.sign(d) || 1;
        }
        // Standing in a queue that never moves wears thin.
        a.mood = clamp(a.mood - dt * 0.02 * (a.slot + 1), -1, 0);
      } else if (a.state === 'served' || a.state === 'balk') {
        a.hold -= dt;
        if (a.hold <= 0) {
          a.x += a.dir * a.speed * dt;
          if (a.x < -40 || a.x > width + 40) agents.splice(i, 1);
        }
      }
    }

    /* The counter works through the queue at the rate the kitchen manages.
       An idle counter banks at most one order's worth of readiness — otherwise
       a quiet morning would let it serve a whole afternoon in one frame, and
       no queue would ever form. */
    serveAcc += dt * f.serveRate;
    if (!queue.length || queue[0].state !== 'queue') serveAcc = Math.min(serveAcc, 1);
    while (serveAcc >= 1 && queue.length && queue[0].state === 'queue') {
      serveAcc -= 1;
      const a = queue.shift();
      a.state = 'served';
      a.hold = 0.35;
      a.dir = rng.chance(0.5) ? 1 : -1;
      a.item = f.item;
      a.mood = 1;
      lastServed = t;
      queue.forEach((q, i) => { q.slot = i; q.state = 'approach'; });
      if (f.ticket > 0) {
        drops.push({ x: a.x, y: laneY(a) - 30, life: 1.6, text: f.ticketText });
      }
    }
  }

  /* ------------------------------------------------------------ update */

  function update(dt, f) {
    if (!scene || locId !== f.loc.id) {
      const fresh = !scene && locId === f.loc.id;
      scene = buildScene(f.loc, width);
      if (fresh) { locId = f.loc.id; return; }   // resize only: keep the crowd
      locId = f.loc.id;
      agents.length = 0;
      queue.length = 0;
      drops.length = 0;
    }
    t += dt;

    spawnAcc += dt * f.passRate;
    while (spawnAcc >= 1) { spawnAcc -= 1; spawn(f); }

    updateAgents(dt, f);

    for (let i = drops.length - 1; i >= 0; i--) {
      drops[i].life -= dt;
      drops[i].y -= dt * 16;
      if (drops[i].life <= 0) drops.splice(i, 1);
    }

    carAcc -= dt;
    if (carAcc <= 0 && cars.length < 3) {
      carAcc = rng.range(4, 13);
      const dir = rng.chance(0.5) ? 1 : -1;
      cars.push({
        x: dir > 0 ? -80 : width + 80, dir,
        speed: rng.range(70, 120),
        color: rng.pick(['#8d3f36', '#2f4f6f', '#5a5f66', '#7a6a4a', '#39473c']),
        bus: rng.chance(0.22),
      });
    }
    for (let i = cars.length - 1; i >= 0; i--) {
      cars[i].x += cars[i].dir * cars[i].speed * dt;
      if (cars[i].x < -140 || cars[i].x > width + 140) cars.splice(i, 1);
    }

    // Precipitation is a particle pool that only fills when the weather says so.
    const want = f.rain ? 150 : f.snow ? 90 : 0;
    while (drips.length < want) {
      drips.push({
        x: rng.range(-20, width + 20), y: rng.range(-VH, VH),
        v: f.snow ? rng.range(18, 34) : rng.range(320, 460),
        drift: f.snow ? rng.range(-12, 12) : -30,
        len: rng.range(6, 13),
      });
    }
    if (drips.length > want) drips.length = want;
    for (const d of drips) {
      d.y += d.v * dt;
      d.x += d.drift * dt;
      if (d.y > KERB + 40) { d.y = -10; d.x = rng.range(-20, width + 20); }
    }
  }

  /* -------------------------------------------------------------- draw */

  function draw(f) {
    if (!resize() || !scene) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, VH);

    const sky = skyAt(f.dayFraction);
    const night = 1 - sky.light;

    drawSky(sky, f);
    drawSkyline(sky, night);
    drawStreet(sky, night, f);
    drawShop(sky, night, f);
    for (const a of agents) if (!a.lane) drawPerson(a, f, night);
    drawProps(night, f);
    for (const a of agents) if (a.lane) drawPerson(a, f, night);
    drawCars(night);
    drawWeather(f);
    drawOverlay(f, night);
  }

  function drawSky(sky, f) {
    const g = ctx.createLinearGradient(0, 0, 0, KERB);
    g.addColorStop(0, sky.top);
    g.addColorStop(1, sky.bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, KERB);

    // Sun or moon on a shallow arc across the day.
    const ang = Math.PI * clamp(f.dayFraction, 0, 1);
    const x = width * (0.08 + 0.84 * f.dayFraction);
    const y = Math.max(16, GROUND - 40 - Math.sin(ang) * Math.min(150, GROUND * 0.62));
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = sky.sun;
    ctx.beginPath();
    ctx.arc(x, y, f.dayFraction > 0.9 ? 9 : 13, 0, 6.284);
    ctx.fill();
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    ctx.arc(x, y, 34, 0, 6.284);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (f.dayFraction > 0.85) {
      const a = (f.dayFraction - 0.85) / 0.15;
      ctx.fillStyle = `rgba(255,255,255,${a * 0.7})`;
      const r = makeRng(4);
      for (let i = 0; i < 40; i++) {
        ctx.fillRect(r.range(0, width), r.range(0, Math.max(40, GROUND - 90)), 1.2, 1.2);
      }
    }
  }

  function drawSkyline(sky, night) {
    const room = Math.max(40, GROUND - 12);
    for (const b of scene.towers) {
      const bh = Math.min(b.h, room);
      const y = GROUND - bh;
      ctx.fillStyle = mix('#2a2f42', sky.bot, 0.20 + (1 - night) * 0.34);
      ctx.fillRect(b.x, y, b.w, bh);
      // Windows: a few lit, more of them after dark.
      const r = makeRng(Math.round(b.x * 13 + b.h));
      for (let ry = 0; ry < b.rows; ry++) {
        for (let cx2 = 0; cx2 < b.cols; cx2++) {
          const on = r() < b.lit * (0.25 + night * 1.1);
          ctx.fillStyle = on ? `rgba(255,214,140,${0.25 + night * 0.6})` : 'rgba(20,22,32,0.35)';
          ctx.fillRect(b.x + 6 + cx2 * ((b.w - 10) / b.cols), y + 10 + ry * ((bh - 16) / b.rows), 5, 6);
        }
      }
    }
  }

  function drawStreet(sky, night, f) {
    // Haze where the street meets the buildings — cheap, effective depth.
    const haze = ctx.createLinearGradient(0, GROUND - 70, 0, GROUND);
    haze.addColorStop(0, 'rgba(0,0,0,0)');
    haze.addColorStop(1, `rgba(${night > 0.5 ? '18,20,32' : '220,228,238'},${0.10 + (1 - night) * 0.18})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, GROUND - 70, width, 70);

    // Pavement.
    ctx.fillStyle = mix('#b8ae9c', '#2b2b33', 0.25 + night * 0.55);
    ctx.fillRect(0, GROUND, width, KERB - GROUND);
    ctx.strokeStyle = `rgba(0,0,0,${0.10 + night * 0.1})`;
    ctx.lineWidth = 1;
    for (let x = -20; x < width + 40; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND);
      ctx.lineTo(x - 10, KERB);
      ctx.stroke();
    }
    if (f.snow) {
      ctx.fillStyle = 'rgba(236,240,248,0.75)';
      ctx.fillRect(0, GROUND, width, 6);
    }

    // Kerb and road.
    ctx.fillStyle = mix('#8d8676', '#23232a', 0.3 + night * 0.5);
    ctx.fillRect(0, KERB - 4, width, 4);
    ctx.fillStyle = mix('#3f3f47', '#141419', 0.3 + night * 0.5);
    ctx.fillRect(0, KERB, width, VH - KERB);
    ctx.strokeStyle = `rgba(230,220,180,${0.35 - night * 0.1})`;
    ctx.setLineDash([16, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, KERB + 17);
    ctx.lineTo(width, KERB + 17);
    ctx.stroke();
    ctx.setLineDash([]);

    if (f.rain) {
      ctx.fillStyle = 'rgba(120,150,180,0.18)';
      for (let i = 0; i < 6; i++) {
        const px = (i * 137) % width;
        ctx.beginPath();
        ctx.ellipse(px, KERB - 8, 22, 3, 0, 0, 6.284);
        ctx.fill();
      }
    }
  }

  function drawShop(sky, night, f) {
    const cx = width / 2;
    const w = scene.w;
    const h = Math.min(scene.h, GROUND - 8);
    const x0 = cx - w / 2;
    const y0 = GROUND - h;
    const warm = 0.35 + night * 0.65;

    // Building.
    ctx.fillStyle = mix(scene.facade, '#1a1a20', night * 0.45);
    ctx.fillRect(x0, y0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x0, y0, 6, h);

    // Serving window with a warm interior.
    const winW = w * 0.44;
    const winX = cx - winW / 2 + 58;
    const winY = y0 + h * 0.34;
    const winH = h * 0.38;
    const gi = ctx.createLinearGradient(0, winY, 0, winY + winH);
    gi.addColorStop(0, mix('#3a2f24', '#f2c877', warm * 0.75));
    gi.addColorStop(1, mix('#241d16', '#c98f3f', warm * 0.6));
    ctx.fillStyle = gi;
    ctx.fillRect(winX, winY, winW, winH);

    // Staff behind the counter, one figure per person, gently working.
    const staff = Math.min(f.staffCount, 4);
    for (let i = 0; i < staff; i++) {
      const sx = winX + 16 + i * (winW - 26) / Math.max(1, staff);
      const bob = Math.sin(t * 3 + i * 1.7) * 1.5;
      const base = winY + winH - 6;
      ctx.fillStyle = 'rgba(238,232,220,0.92)';           // Schürze
      ctx.beginPath();
      ctx.roundRect(sx - 6, base - 26 + bob, 12, 22, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,48,38,0.75)';              // Gurt
      ctx.fillRect(sx - 6, base - 15 + bob, 12, 2.5);
      ctx.fillStyle = '#d9ae82';                          // Kopf
      ctx.beginPath();
      ctx.arc(sx, base - 31 + bob, 5, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = 'rgba(250,248,244,0.95)';           // Kochmütze
      ctx.fillRect(sx - 5.4, base - 38 + bob, 10.8, 4);
    }

    // Window frame, so the opening reads as a serving hatch.
    ctx.strokeStyle = mix('#3f2f22', '#12100f', night * 0.5);
    ctx.lineWidth = 4;
    ctx.strokeRect(winX - 2, winY - 2, winW + 4, winH + 4);

    // Side door.
    const dW = 30;
    const dX = x0 + w - dW - 12;
    const dY = GROUND - 62;
    ctx.fillStyle = mix('#4a3626', '#171317', night * 0.5);
    ctx.fillRect(dX, dY, dW, 62);
    ctx.fillStyle = mix('#7d6a52', '#2a2028', 0.2 + night * 0.5);
    ctx.fillRect(dX + 4, dY + 6, dW - 8, 18);
    ctx.fillStyle = 'rgba(232,161,58,0.8)';
    ctx.fillRect(dX + dW - 9, dY + 34, 3, 3);

    // Warm light thrown onto the pavement once it gets dark.
    if (night > 0.25) {
      const spillTop = winY + winH + 8;
      const a = (night - 0.25) * 0.5;
      const sp = ctx.createLinearGradient(0, spillTop, 0, GROUND + 54);
      sp.addColorStop(0, `rgba(255,203,124,${0.30 * a * 2})`);
      sp.addColorStop(1, 'rgba(255,203,124,0)');
      ctx.fillStyle = sp;
      ctx.beginPath();
      ctx.moveTo(winX, spillTop);
      ctx.lineTo(winX + winW, spillTop);
      ctx.lineTo(winX + winW + 46, GROUND + 54);
      ctx.lineTo(winX - 46, GROUND + 54);
      ctx.closePath();
      ctx.fill();
    }

    // Plinth, so the front does not float on the pavement.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x0 - 3, GROUND - 9, w + 6, 9);

    // Bulb over the counter.
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(winX + winW / 2, winY);
    ctx.lineTo(winX + winW / 2, winY + 12);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,226,168,${0.55 + night * 0.45})`;
    ctx.beginPath();
    ctx.arc(winX + winW / 2, winY + 14, 3.4, 0, 6.284);
    ctx.fill();

    // Counter ledge.
    ctx.fillStyle = mix('#d8cdb8', '#2a2622', 0.2 + night * 0.5);
    ctx.fillRect(winX - 6, winY + winH, winW + 12, 7);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(winX - 6, winY + winH + 7, winW + 12, 3);

    // Awning.
    const aw = w * 0.72;
    const ax = cx - aw / 2 + 12;
    const ay = winY - 16;
    const stripes = 7;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = mix(scene.awning[i % 2], '#15151b', night * 0.4);
      ctx.beginPath();
      ctx.moveTo(ax + (i * aw) / stripes, ay);
      ctx.lineTo(ax + ((i + 1) * aw) / stripes, ay);
      ctx.lineTo(ax + ((i + 1) * aw) / stripes - 6, ay + 16);
      ctx.lineTo(ax + (i * aw) / stripes - 6, ay + 16);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(ax - 6, ay + 16, aw, 10);

    // Sign board. Lit properly only if the neon upgrade is in.
    const neon = f.upgrades.has('leuchtwerbung');
    const flicker = neon ? 0.82 + Math.sin(t * 9) * 0.06 + Math.sin(t * 2.3) * 0.1 : 0;
    ctx.fillStyle = mix('#1d1a16', '#0f0d0b', 0.4);
    ctx.fillRect(x0 + 10, y0 + 8, w - 20, 22);
    if (neon) {
      ctx.shadowColor = `rgba(232,161,58,${0.7 * flicker * (0.4 + night)})`;
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = neon
      ? `rgba(247,193,106,${0.75 + flicker * 0.25})`
      : mix('#cdbfa4', '#6d6455', 0.3 + night * 0.4);
    ctx.font = `700 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.loc.name.toUpperCase(), cx, y0 + 20, w - 26);
    ctx.shadowBlur = 0;

    // Chalkboard on the facade, in whatever room is left beside the window.
    const bx = x0 + 14;
    const bw2 = Math.min(112, winX - 14 - bx);
    const bh2 = 74;
    const by = winY - 4;
    if (bw2 >= 62) {
    ctx.fillStyle = mix('#6b5334', '#221a12', night * 0.5);
    ctx.fillRect(bx - 3, by - 3, bw2 + 6, bh2 + 6);
    ctx.fillStyle = mix('#26302b', '#101614', 0.25 + night * 0.4);
    ctx.fillRect(bx, by, bw2, bh2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 9px ${MONO}`;
    ctx.fillStyle = `rgba(236,229,216,${0.5 + night * 0.3})`;
    ctx.fillText('KARTE', bx + 7, by + 14);
    ctx.font = `9px ${MONO}`;
    f.menu.slice(0, 3).forEach((m, i) => {
      const ly = by + 32 + i * 14;
      ctx.fillStyle = `rgba(240,232,214,${0.62 + night * 0.25})`;
      const room = Math.floor((bw2 - 42) / 5.4);
      ctx.fillText(m.name.length > room ? `${m.name.slice(0, room - 1)}.` : m.name, bx + 7, ly);
      ctx.textAlign = 'right';
      ctx.fillStyle = `rgba(232,161,58,${0.8 + night * 0.2})`;
      ctx.fillText(m.price.replace(' €', ''), bx + bw2 - 7, ly);
      ctx.textAlign = 'left';
    });
    }

    // Quality tells: crates and herbs up top, bin bags down at the bottom.
    if (f.quality >= 4) {
      ctx.fillStyle = mix('#4f6f4a', '#1c2a1c', night * 0.5);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x0 - 12 + i * 7, GROUND - 8 - Math.sin(i) * 3, 5, 0, 6.284);
        ctx.fill();
      }
      ctx.fillStyle = mix('#7a5a3a', '#241a12', night * 0.5);
      ctx.fillRect(x0 - 18, GROUND - 6, 22, 6);
    }
    if (f.quality <= 2) {
      ctx.fillStyle = mix('#3a3a40', '#15151a', night * 0.4);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(x0 - 14 + i * 13, GROUND - 6, 8, 7, 0, 0, 6.284);
        ctx.fill();
      }
    }

    // Terrace tables, if bought.
    if (f.upgrades.has('terrasse')) {
      for (let i = 0; i < 2; i++) {
        const tx = x0 - 70 + i * 34;
        ctx.strokeStyle = mix('#6b5a44', '#20191a', night * 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, GROUND + 26);
        ctx.lineTo(tx, GROUND + 8);
        ctx.stroke();
        ctx.fillStyle = mix('#8d7a5e', '#241d18', night * 0.5);
        ctx.fillRect(tx - 11, GROUND + 4, 22, 4);
      }
    }

    // Ordering terminal, if bought.
    if (f.upgrades.has('terminal')) {
      ctx.fillStyle = mix('#2f3238', '#131418', night * 0.4);
      ctx.fillRect(cx + w / 2 - 6, GROUND - 34, 13, 34);
      ctx.fillStyle = `rgba(120,200,255,${0.35 + night * 0.5})`;
      ctx.fillRect(cx + w / 2 - 4, GROUND - 31, 9, 12);
    }

    // The competitor across the way shows up once it is really taking custom.
    if (f.competition > 0.08) {
      const rx = width - 62;
      ctx.globalAlpha = clamp(0.35 + f.competition * 2, 0, 0.9);
      ctx.fillStyle = mix('#4a4048', '#141218', 0.3 + night * 0.4);
      ctx.fillRect(rx, GROUND - 78, 58, 78);
      ctx.fillStyle = `rgba(226,114,95,${0.5 + night * 0.4})`;
      ctx.fillRect(rx + 6, GROUND - 72, 46, 12);
      ctx.fillStyle = mix('#e8d9b8', '#3a2f28', 0.2 + night * 0.5);
      ctx.fillRect(rx + 10, GROUND - 46, 38, 24);
      ctx.globalAlpha = 1;
    }
  }

  function drawProps(night, f) {
    // Street lamps, on after dusk.
    for (const lx of scene.lampX) {
      ctx.strokeStyle = mix('#5a5348', '#1b1a1e', 0.3 + night * 0.4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      const lampTop = Math.max(18, GROUND - 88);
      ctx.moveTo(lx, GROUND + 40);
      ctx.lineTo(lx, lampTop);
      ctx.stroke();
      ctx.fillStyle = night > 0.35
        ? `rgba(255,222,150,${0.5 + night * 0.5})`
        : 'rgba(120,116,104,0.8)';
      ctx.beginPath();
      ctx.ellipse(lx, Math.max(16, GROUND - 90), 9, 5.5, 0, 0, 6.284);
      ctx.fill();
      if (night > 0.35) {
        const lampY = Math.max(20, GROUND - 86);
        const g = ctx.createRadialGradient(lx, lampY, 2, lx, lampY, 90);
        g.addColorStop(0, `rgba(255,214,140,${0.20 * night})`);
        g.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(lx, lampY, 90, 0, 6.284);
        ctx.fill();
      }
    }

    // A tree that knows what month it is.
    const tx = scene.treeX;
    ctx.fillStyle = mix('#4a3a2c', '#191418', night * 0.5);
    ctx.fillRect(tx - 4, GROUND - 46, 8, 52);
    const leaf = f.snow ? null
      : f.month >= 2 && f.month <= 4 ? '#7fae5c'
        : f.month >= 5 && f.month <= 7 ? '#4f8a44'
          : f.month >= 8 && f.month <= 9 ? '#c08a34' : '#6b6a4a';
    if (leaf) {
      ctx.fillStyle = mix(leaf, '#16181c', night * 0.55);
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(tx - 12 + i * 9, GROUND - 54 - (i % 2) * 8, 13, 0, 6.284);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = mix('#4a3a2c', '#191418', night * 0.5);
      ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(tx, GROUND - 46);
        ctx.lineTo(tx + i * 16, GROUND - 68);
        ctx.stroke();
      }
    }

    // Bin.
    const bx2 = scene.binX;
    ctx.fillStyle = mix('#5c564c', '#1d1c20', 0.25 + night * 0.45);
    ctx.beginPath();
    ctx.moveTo(bx2, GROUND + 40);
    ctx.lineTo(bx2 + 2.5, GROUND + 14);
    ctx.lineTo(bx2 + 15.5, GROUND + 14);
    ctx.lineTo(bx2 + 18, GROUND + 40);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mix('#6d675c', '#26252a', 0.25 + night * 0.45);
    ctx.fillRect(bx2 - 1, GROUND + 10, 20, 4);
  }

  function drawPerson(a, f, night) {
    const y = laneY(a);
    const sc = laneScale(a);
    const walking = a.state === 'pass' || a.state === 'approach'
      || ((a.state === 'served' || a.state === 'balk') && a.hold <= 0);
    const step = walking ? Math.sin(a.phase) : 0;
    const bob = walking ? Math.abs(Math.cos(a.phase)) * 1.2 : 0;
    const h = 38 * sc;
    const top = y - h - bob;

    ctx.save();
    ctx.translate(a.x, 0);
    ctx.globalAlpha = a.lane ? 1 : 0.82;

    // Shadow.
    ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - night * 0.5)})`;
    ctx.beginPath();
    ctx.ellipse(0, y + 1, 6 * sc, 2 * sc, 0, 0, 6.284);
    ctx.fill();

    // Legs.
    ctx.strokeStyle = mix('#2f2a2a', '#14131a', night * 0.5);
    ctx.lineWidth = 3.2 * sc;
    ctx.beginPath();
    ctx.moveTo(0, y - h * 0.42);
    ctx.lineTo(step * 4 * sc, y);
    ctx.moveTo(0, y - h * 0.42);
    ctx.lineTo(-step * 4 * sc, y);
    ctx.stroke();

    // Body.
    ctx.fillStyle = mix(a.coat, '#16151d', night * 0.45);
    const bw = 13 * sc;
    ctx.beginPath();
    ctx.roundRect(-bw / 2, top + 10 * sc, bw, h * 0.55, 4 * sc);
    ctx.fill();

    // Head.
    ctx.fillStyle = mix(a.skin, '#1a1620', night * 0.4);
    ctx.beginPath();
    ctx.arc(0, top + 6 * sc, 6 * sc, 0, 6.284);
    ctx.fill();
    if (a.hat) {
      ctx.fillStyle = mix('#2a2730', '#111015', night * 0.4);
      ctx.fillRect(-6.4 * sc, top + 1 * sc, 12.8 * sc, 3.4 * sc);
    }

    // What they are carrying: a bag on the way in, food on the way out.
    if (a.state === 'served') {
      ctx.fillStyle = '#e8a13a';
      ctx.fillRect(bw / 2, top + 17 * sc, 7 * sc, 7 * sc);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(bw / 2 + 1.4 * sc, top + 15.6 * sc, 4.2 * sc, 2.2 * sc);
    } else if (a.bag) {
      ctx.fillStyle = mix('#6b5a44', '#1a1620', night * 0.4);
      ctx.fillRect(bw / 2, top + 18 * sc, 5.5 * sc, 8 * sc);
    }

    // Mood: a spark for a happy customer, a puff for a lost one.
    if (a.state === 'served' && a.hold > 0) {
      ctx.fillStyle = 'rgba(111,207,141,0.9)';
      ctx.font = `${12 * sc}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('✓', 0, top - 4 * sc);
    } else if (a.state === 'balk') {
      ctx.fillStyle = 'rgba(226,114,95,0.9)';
      ctx.font = `${12 * sc}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('✕', 0, top - 4 * sc);
    } else if (a.state === 'queue' && a.mood < -0.35) {
      ctx.fillStyle = `rgba(230,195,74,${0.4 + Math.abs(a.mood) * 0.5})`;
      ctx.font = `${12 * sc}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('…', 0, top - 4 * sc);
    }

    // An umbrella, because it is raining.
    if (f.rain && a.lane) {
      ctx.strokeStyle = 'rgba(230,225,215,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, top - 2, 13 * sc, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, top - 2);
      ctx.lineTo(0, top + 10);
      ctx.stroke();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawCars(night) {
    for (const c of cars) {
      const y = KERB + (c.dir > 0 ? 17 : 4);
      const w = c.bus ? 78 : 50;
      const h = c.bus ? 15 : 13;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(c.x + w / 2, y + h + 2, w * 0.5, 2.5, 0, 0, 6.284);
      ctx.fill();
      ctx.fillStyle = mix(c.color, '#141218', night * 0.4);
      ctx.beginPath();
      ctx.roundRect(c.x, y, w, h, 4);
      ctx.fill();
      ctx.fillStyle = `rgba(190,215,235,${0.5 - night * 0.2})`;
      ctx.fillRect(c.x + w * 0.18, y + 3, w * 0.28, h * 0.42);
      ctx.fillStyle = '#1b1a1e';
      ctx.beginPath();
      ctx.arc(c.x + w * 0.22, y + h, 3.4, 0, 6.284);
      ctx.arc(c.x + w * 0.78, y + h, 3.4, 0, 6.284);
      ctx.fill();
      if (night > 0.4) {
        ctx.fillStyle = 'rgba(255,230,170,0.5)';
        ctx.beginPath();
        ctx.arc(c.dir > 0 ? c.x + w : c.x, y + h * 0.6, 3, 0, 6.284);
        ctx.fill();
      }
    }
  }

  function drawWeather(f) {
    if (f.rain) {
      ctx.strokeStyle = 'rgba(180,205,230,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drips) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - 2, d.y + d.len);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(60,80,110,0.16)';
      ctx.fillRect(0, 0, width, VH);
    } else if (f.snow) {
      ctx.fillStyle = 'rgba(240,246,255,0.8)';
      for (const d of drips) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.5, 0, 6.284);
        ctx.fill();
      }
    }
    if (f.heat) {
      ctx.fillStyle = 'rgba(255,170,60,0.10)';
      ctx.fillRect(0, 0, width, VH);
      ctx.strokeStyle = 'rgba(255,220,160,0.10)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const yy = GROUND - 6 - i * 4;
        ctx.beginPath();
        for (let x = 0; x < width; x += 8) {
          ctx.lineTo(x, yy + Math.sin(x * 0.08 + t * 2 + i) * 1.6);
        }
        ctx.stroke();
      }
    }

    // Money floating up from the counter.
    for (const d of drops) {
      ctx.globalAlpha = clamp(d.life, 0, 1);
      ctx.fillStyle = '#6fcf8d';
      ctx.font = `600 10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(d.text, d.x, d.y);
      ctx.globalAlpha = 1;
    }

    // A soft vignette holds the scene together.
    const v = ctx.createRadialGradient(width / 2, VH * 0.45, VH * 0.4, width / 2, VH * 0.45, VH * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, width, VH);
  }

  function drawOverlay(f, night) {
    const hour = 5 + f.dayFraction * 17;
    const clock = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(8, 8, 92, 18);
    ctx.fillStyle = 'rgba(236,229,216,0.9)';
    ctx.fillText(`${clock}  ${f.loc.name}`, 13, 21);

    // Queue read-out, because it is the number the player acts on.
    const qtxt = `Schlange ${queue.length}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(width - 8 - 78, 8, 78, 18);
    ctx.fillStyle = queue.length >= 6 ? '#e2725f' : 'rgba(236,229,216,0.9)';
    ctx.fillText(qtxt, width - 13, 21);

    if (f.paused) {
      ctx.fillStyle = 'rgba(10,9,8,0.45)';
      ctx.fillRect(0, 0, width, VH);
      ctx.textAlign = 'center';
      ctx.font = `700 15px ${MONO}`;
      ctx.fillStyle = 'rgba(232,161,58,0.9)';
      ctx.fillText('PAUSE', width / 2, VH / 2);
    }
  }

  return {
    update,
    draw,
    /** Reset when the player starts over. */
    clear() { agents.length = 0; queue.length = 0; drops.length = 0; scene = null; locId = null; },
    debugAgents: () => ({
      width, counter: counterX(), trigger: counterX() - 52,
      buyers: agents.filter((a) => a.wantsToBuy).map((a) => ({ x: Math.round(a.x), dir: a.dir, st: a.state })),
    }),
    stats: () => ({
      queue: queue.length, balked, lastServed,
      agents: agents.length,
      buyers: agents.filter((a) => a.wantsToBuy).length,
      states: agents.reduce((m, a) => ({ ...m, [a.state]: (m[a.state] || 0) + 1 }), {}),
    }),
  };
}
