/**
 * Die Spielwelt und ihre Regeln.
 *
 * Läuft im festen Takt (SIM.hz) und kennt weder DOM noch Canvas. Alles, was
 * für Darstellung, Ton oder HUD interessant ist, wird über `events` gemeldet:
 *
 *   eat          { eater, kind, gain, x, y, color, combo }   (Payload wird wiederverwendet!)
 *   eatBody      { eater, victim, gain }
 *   capture      { body, debris }
 *   absorb       { body, debris }
 *   death        { body, cause: 'eaten' | 'blackhole' | 'shot', killer, hole }
 *   evolve       { body, stage, prev, first }
 *   devolve      { body, stage, prev }
 *   slingStart   body
 *   slingRelease { body, count, power }
 *   shot         { body, debris }
 *   hit          { target, owner, damage, x, y }
 *   shieldHit    { target, x, y }
 *   bump         { a, b, speed, x, y }
 *   boostStart / boostEnd   body
 *   bhSpawn / bhCollapse    hole
 *   bhDrain      { body, hole, amount }
 *   comboEnd     { count, gained }
 *   playerSpawn  body
 *   spawn        body
 */
import { WORLD, BODY, ORBIT, SLING, DUST, ASTEROID, COMET, BLACK_HOLE, BOTS, COMBO } from './config.js';
import {
  TAU, clamp, lerp, invLerp, damp, smoothstep, easeOutCubic, easeInCubic, angleDiff,
  random, randRange, randInt, gaussian, chance,
} from './utils.js';
import {
  KIND, STATE, Body, BlackHole, DebrisPool,
  radiusForMass, debrisRadius, gravityRadius, maxOrbiters, stageFor, canEat, maxSpeed,
} from './entities.js';
import { steerBody, integrate, containCircle, spiralPull, gravitate, bounceBodies } from './physics.js';
import { SpatialHash } from './spatial-hash.js';
import { BotBrain, updateBot } from './ai.js';
import { NamePool } from './names.js';

const KIND_KEY = ['dust', 'asteroid', 'comet'];
const DEATH_TIME = { eaten: BODY.consumeTime, blackhole: 0.9, shot: 0.12 };

export class Game {
  constructor(events) {
    this.events = events;
    this.grid = new SpatialHash(WORLD.gridCell, WORLD.radius + 600);
    this.pool = new DebrisPool(DUST.count + ASTEROID.count + 100);
    this.names = new NamePool();

    this.bodies = [];
    this.debris = [];
    this.blackHoles = [];
    this.player = null;

    this.time = 0;
    this.difficulty = 0;
    this.freezeBots = false;   // Admin: Bots anhalten
    this.cheated = false;      // Admin-Befehle in dieser Runde → kein Rekord
    this.playerAggro = 1;
    this.counts = { dust: 0, asteroid: 0, comet: 0 };
    this.combo = { count: 0, timer: 0, gained: 0 };

    this.dustTimer = 0;
    this.asteroidTimer = 0;
    this.cometTimer = COMET.firstDelay;
    this.bhTimer = BLACK_HOLE.firstDelay;
    this.respawnAt = [];

    /** Was die Kamera gerade sieht — Bots und Staub spawnen bevorzugt außerhalb. */
    this.focus = { x: 0, y: 0, r: 0 };

    this.nextId = 1;
    this._q = [];
    this._eat = { eater: null, kind: 0, gain: 0, x: 0, y: 0, color: 0, combo: 0 };

    this.populate();
  }

  // =====================================================================
  // Aufbau
  // =====================================================================

  populate() {
    while (this.counts.dust < DUST.count) this.spawnDustCluster(false);
    for (let i = 0; i < ASTEROID.count; i++) this.spawnAsteroid(false);
    for (let i = 0; i < BOTS.count; i++) this.spawnBot();
  }

  /** Spawnt den Spieler an der ruhigsten Stelle, die sich finden lässt. */
  spawnPlayer(name) {
    const b = new Body(this.nextId++, name, true);
    b.setMass(BODY.startMass);
    const p = this.findSpawnPoint(b, false, 48);
    b.place(p.x, p.y);
    b.shield = BODY.spawnShield;
    b.bornAt = this.time;
    this.player = b;
    this.bodies.push(b);
    this.combo.count = 0;
    this.combo.timer = 0;
    this.combo.gained = 0;
    this.events.emit('playerSpawn', b);
    return b;
  }

  /** Entfernt den Spieler ohne Todesanimation (zurück ins Menü). */
  despawnPlayer() {
    const p = this.player;
    if (!p) return;
    if (p.alive) {
      this.releaseOrbiters(p);
      p.alive = false;
    }
    p.removed = true;
    this.player = null;
  }

  spawnBot() {
    const b = new Body(this.nextId++, this.names.take(), false);
    b.setMass(this.sampleBotMass());
    const p = this.findSpawnPoint(b, true);
    b.place(p.x, p.y);
    b.bornAt = this.time;
    b.brain = new BotBrain();
    this.bodies.push(b);
    this.events.emit('spawn', b);
    return b;
  }

  sampleBotMass() {
    const p = this.player;
    if (p && p.alive && chance(BOTS.nearPlayerChance)) {
      return clamp(p.mass * Math.exp(gaussian() * 0.55), 15, 1800);
    }
    let t = random();
    for (const band of BOTS.massBands) {
      if (t < band.w) return randRange(band.min, band.max);
      t -= band.w;
    }
    return 30;
  }

  /**
   * Sucht unter mehreren Zufallspunkten den mit dem meisten Abstand zu
   * Fressfeinden und Schwarzen Löchern. Optional außerhalb des Kamerabilds,
   * damit Bots nicht sichtbar aus dem Nichts auftauchen.
   */
  findSpawnPoint(b, avoidFocus, tries = 24) {
    let bestX = 0, bestY = 0, bestScore = -Infinity;
    const R = WORLD.radius * 0.88 - b.r;
    for (let i = 0; i < tries; i++) {
      const a = random() * TAU, rr = Math.sqrt(random()) * R;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      let threat = 1500;
      for (const o of this.bodies) {
        if (!o.alive || !canEat(o, b)) continue;
        const gap = Math.hypot(o.x - x, o.y - y) - o.r - b.r - gravityRadius(o) * 0.5;
        if (gap < threat) threat = gap;
      }
      let hole = 2500;
      for (const h of this.blackHoles) {
        const dd = Math.hypot(h.x - x, h.y - y) - h.pullR;
        if (dd < hole) hole = dd;
      }
      let score = Math.min(threat, 1500) + Math.min(hole, 2500) * 0.6;
      const f = this.focus;
      if (avoidFocus && f.r > 0 && Math.hypot(x - f.x, y - f.y) < f.r + b.r + 100) score -= 4000;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
    return { x: bestX, y: bestY };
  }

  randomPoint(maxR, avoidFocus) {
    const f = this.focus;
    let x = 0, y = 0;
    for (let i = 0; i < 8; i++) {
      const a = random() * TAU, r = Math.sqrt(random()) * maxR;
      x = Math.cos(a) * r;
      y = Math.sin(a) * r;
      if (!avoidFocus || f.r <= 0 || Math.hypot(x - f.x, y - f.y) > f.r) break;
    }
    return { x, y };
  }

  spawnDust(x, y) {
    const d = this.pool.acquire();
    d.kind = KIND.DUST;
    d.mass = DUST.mass;
    d.r = DUST.radius * randRange(0.75, 1.2);
    d.place(x, y);
    d.driftX = gaussian() * DUST.drift;
    d.driftY = gaussian() * DUST.drift;
    d.vx = d.driftX;
    d.vy = d.driftY;
    d.color = randInt(0, 3);
    d.variant = randInt(0, 7);
    this.debris.push(d);
    this.counts.dust++;
    return d;
  }

  spawnDustCluster(avoidFocus) {
    const c = this.randomPoint(WORLD.radius * 0.97, avoidFocus);
    const n = randInt(DUST.clusterMin, DUST.clusterMax);
    const lim = WORLD.radius - 10;
    for (let i = 0; i < n && this.counts.dust < DUST.count; i++) {
      let x = c.x + gaussian() * DUST.clusterSpread;
      let y = c.y + gaussian() * DUST.clusterSpread;
      const d = Math.hypot(x, y);
      if (d > lim) { x *= lim / d; y *= lim / d; }
      this.spawnDust(x, y);
    }
  }

  spawnAsteroid(avoidFocus, mass = randRange(ASTEROID.massMin, ASTEROID.massMax)) {
    const p = this.randomPoint(WORLD.radius * 0.95, avoidFocus);
    const d = this.pool.acquire();
    d.kind = KIND.ASTEROID;
    d.mass = mass;
    d.r = debrisRadius(mass);
    d.place(p.x, p.y);
    const a = random() * TAU, s = random() * ASTEROID.drift;
    d.driftX = d.vx = Math.cos(a) * s;
    d.driftY = d.vy = Math.sin(a) * s;
    d.angle = random() * TAU;
    d.spin = randRange(-1.2, 1.2);
    d.variant = randInt(0, ASTEROID.variants - 1);
    this.debris.push(d);
    this.counts.asteroid++;
    return d;
  }

  /** Kometen kommen von außerhalb und kreuzen die Arena — schnell, wertvoll, flüchtig. */
  spawnComet() {
    const a = random() * TAU;
    const R = WORLD.radius + 120;
    const x = Math.cos(a) * R, y = Math.sin(a) * R;
    const ta = random() * TAU, tr = Math.sqrt(random()) * WORLD.radius * 0.55;
    const dx = Math.cos(ta) * tr - x, dy = Math.sin(ta) * tr - y;
    const len = Math.hypot(dx, dy);
    const sp = randRange(COMET.speedMin, COMET.speedMax);
    const d = this.pool.acquire();
    d.kind = KIND.COMET;
    d.mass = COMET.mass;
    d.r = COMET.radius;
    d.reward = COMET.reward;
    d.place(x, y);
    d.vx = (dx / len) * sp;
    d.vy = (dy / len) * sp;
    d.angle = Math.atan2(d.vy, d.vx);
    d.color = randInt(0, 1);
    this.debris.push(d);
    this.counts.comet++;
    this.events.emit('cometSpawn', d);
  }

  spawnBlackHole() {
    const p = this.player && this.player.alive ? this.player : null;
    for (let i = 0; i < 30; i++) {
      const a = random() * TAU, r = Math.sqrt(random()) * WORLD.radius * 0.75;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (p && Math.hypot(x - p.x, y - p.y) < BLACK_HOLE.safeSpawnDist + p.r) continue;
      if (this.blackHoles.some(h => Math.hypot(h.x - x, h.y - y) < 1800)) continue;
      const h = new BlackHole(x, y);
      this.blackHoles.push(h);
      this.events.emit('bhSpawn', h);
      return h;
    }
    return null;
  }

  // =====================================================================
  // Steuerung von außen
  // =====================================================================

  setPlayerControl(c) {
    const p = this.player;
    if (!p || !p.alive) return;
    p.dirX = c.dirX;
    p.dirY = c.dirY;
    p.throttle = c.throttle;
    p.wantBoost = c.boost;
    p.slingHeld = c.sling;
    p.aimX = c.aimX;
    p.aimY = c.aimY;
  }

  // =====================================================================
  // Tick
  // =====================================================================

  update(dt) {
    this.time += dt;
    this.snapshot();
    this.updateDifficulty();

    for (const b of this.bodies) {
      if (!b.alive || !b.brain) continue;
      if (this.freezeBots) {
        b.throttle = 0;
        b.wantBoost = false;
        b.slingHeld = false;
      } else {
        updateBot(this, b, dt);
      }
    }
    for (const b of this.bodies) this.updateBody(b, dt);
    this.updateBlackHoles(dt);

    // Nur freie Trümmer brauchen Nachbarschaftsabfragen.
    this.grid.clear();
    for (const d of this.debris) if (d.state === STATE.FREE && !d.dead) this.grid.insert(d);

    this.updateWells(dt);
    this.updateBlackHolePull(dt);
    this.updateBodyCollisions(dt);
    this.updateDebris(dt);
    this.updateCombo(dt);
    this.updateSpawning(dt);
    this.cleanup();
  }

  /** Positionen des letzten Ticks merken — der Renderer interpoliert dazwischen. */
  snapshot() {
    for (const b of this.bodies) { b.px = b.x; b.py = b.y; b.pAngle = b.angle; }
    for (const d of this.debris) { d.px = d.x; d.py = d.y; d.pAngle = d.angle; }
    for (const h of this.blackHoles) { h.px = h.x; h.py = h.y; }
  }

  /**
   * Je größer der Spieler, desto präziser und mutiger werden die Bots.
   * In den ersten Sekunden nach dem Spawn jagen sie ihn kaum — wer neu ist,
   * soll erst verstehen, bevor er gefressen wird.
   */
  updateDifficulty() {
    const p = this.player;
    if (p && p.alive) {
      this.difficulty = invLerp(BODY.startMass, BOTS.fullDifficultyMass, p.mass);
      const grace = Math.min(1, 0.25 + (this.time - p.bornAt) / BOTS.graceTime);
      this.playerAggro = lerp(BOTS.playerAggroMin, 1, this.difficulty) * grace;
    } else {
      this.difficulty = 0.8;
      this.playerAggro = 1;
    }
  }

  // --- Körper ------------------------------------------------------------

  updateBody(b, dt) {
    if (!b.alive) {
      this.updateDyingBody(b, dt);
      return;
    }
    b.spawnT = Math.min(1, b.spawnT + dt / BODY.spawnFade);
    if (b.shield > 0) b.shield = Math.max(0, b.shield - dt);
    if (b.god) b.shield = Math.max(b.shield, 1);   // Admin: Dauerschild

    // Boost kostet Masse — die bleibt als Staubspur zurück (und andere fressen sie).
    const wasBoosting = b.boosting;
    b.boosting = b.wantBoost && b.mass > BODY.boostMinMass && b.throttle > 0.15;
    if (b.boosting) {
      const cost = Math.max(BODY.boostCostMin, b.mass * BODY.boostCostRate) * dt;
      b.mass -= cost;
      b.boostDrop += cost;
      while (b.boostDrop >= DUST.mass) {
        b.boostDrop -= DUST.mass;
        this.dropBoostDust(b);
      }
    }
    if (b.boosting !== wasBoosting) this.events.emit(b.boosting ? 'boostStart' : 'boostEnd', b);

    // Reibung: Große Körper verlieren in Bewegung langsam Masse, damit niemand
    // dauerhaft uneinholbar wird. Der Verlust wächst mit dem Tempo — wer stillsteht,
    // verliert nichts (Boost hat seine eigenen Kosten, deshalb höchstens Faktor 1).
    if (b.mass > BODY.decayStart) {
      const motion = Math.min(1, Math.hypot(b.vx, b.vy) / maxSpeed(b.mass));
      b.drain = (b.mass - BODY.decayStart) * BODY.decayRate * motion;
      b.mass -= b.drain * dt;
    } else {
      b.drain = 0;
    }

    this.updateSling(b, dt);
    steerBody(b, dt);
    integrate(b, dt);
    containCircle(b, b.r);

    // Obergrenze: sonst wird ein Körper größer als die Arena und die Randbegrenzung kippt
    if (b.mass > BODY.maxMass) b.mass = BODY.maxMass;
    b.r = damp(b.r, radiusForMass(b.mass), BODY.radiusEase, dt);
    b.angle += (b.spin / (1 + b.r / 60)) * dt;
    b.pulse = damp(b.pulse, 0, 8, dt);
    b.hitFlash = damp(b.hitFlash, 0, 5, dt);
    if (b.mass > b.maxMass) b.maxMass = b.mass;
    this.checkStage(b);
  }

  /** Einsaug-Animation: das Opfer gleitet ins Zentrum dessen, der es frisst. */
  updateDyingBody(b, dt) {
    b.consumeT += dt / (DEATH_TIME[b.cause] || 0.3);
    const c = b.consumer;
    if (c) {
      const t = easeInCubic(Math.min(1, b.consumeT));
      let ox = b.cx0, oy = b.cy0;
      if (b.cause === 'blackhole') {
        // Spaghettifizierung: auf einer Spirale in den Horizont
        const a = t * 3.2, cs = Math.cos(a), sn = Math.sin(a);
        ox = b.cx0 * cs - b.cy0 * sn;
        oy = b.cx0 * sn + b.cy0 * cs;
      }
      b.x = c.x + ox * (1 - t);
      b.y = c.y + oy * (1 - t);
    }
    if (b.consumeT >= 1) b.removed = true;
  }

  dropBoostDust(b) {
    const back = b.r + 5;
    const d = this.spawnDust(
      b.x - b.dirX * back + gaussian() * b.r * 0.25,
      b.y - b.dirY * back + gaussian() * b.r * 0.25,
    );
    d.vx = -b.dirX * 50 + gaussian() * 20 + b.vx * 0.2;
    d.vy = -b.dirY * 50 + gaussian() * 20 + b.vy * 0.2;
    d.immuneTo = b;
    d.immuneTimer = DUST.dropImmune;
    d.age = DUST.fadeIn;
  }

  checkStage(b) {
    const s = stageFor(b.mass, b.stage);
    if (s === b.stage) return;
    const prev = b.stage;
    b.stage = s;
    if (s > prev) {
      const first = s > b.maxStage;
      if (first) b.maxStage = s;
      this.events.emit('evolve', { body: b, stage: s, prev, first });
    } else {
      this.events.emit('devolve', { body: b, stage: s, prev });
    }
  }

  // --- Schleuder -------------------------------------------------------------

  updateSling(b, dt) {
    const busy = b.slingQueue.length > 0;
    if (b.slingHeld && !busy && b.orbiters.length > 0) {
      if (b.slingCharge === 0) this.events.emit('slingStart', b);
      b.slingCharge = Math.min(1, b.slingCharge + dt / SLING.chargeTime);
    } else if (!b.slingHeld && b.slingCharge > 0) {
      if (b.slingCharge >= SLING.minCharge && b.orbiters.length > 0) this.releaseSling(b);
      else this.events.emit('slingCancel', b);
      b.slingCharge = 0;
    } else if (b.slingCharge > 0 && b.orbiters.length === 0) {
      b.slingCharge = 0;
      this.events.emit('slingCancel', b);
    }

    // Salve: die Brocken verlassen die Bahn nacheinander, nicht alle auf einmal.
    if (busy) {
      b.slingTimer -= dt;
      while (b.slingTimer <= 0 && b.slingQueue.length) {
        const o = b.slingQueue.shift();
        if (!o.dead && o.state === STATE.ORBIT && o.owner === b) this.fireOrbiter(b, o);
        b.slingTimer += SLING.burstInterval;
      }
    }
  }

  releaseSling(b) {
    b.slingPower = b.slingCharge;
    // Wer am nächsten zur Zielrichtung steht, fliegt zuerst → saubere Salve
    const aim = Math.atan2(b.aimY - b.y, b.aimX - b.x);
    b.slingQueue = b.orbiters
      .slice()
      .sort((p, q) => Math.abs(angleDiff(p.orbitA, aim)) - Math.abs(angleDiff(q.orbitA, aim)));
    b.slingTimer = 0;
    this.events.emit('slingRelease', { body: b, count: b.slingQueue.length, power: b.slingPower });
  }

  fireOrbiter(b, o) {
    const i = b.orbiters.indexOf(o);
    if (i >= 0) b.orbiters.splice(i, 1);
    o.state = STATE.PROJECTILE;
    o.owner = b;
    o.life = SLING.life;
    o.power = b.slingPower;
    let ax = b.aimX - o.x, ay = b.aimY - o.y;
    if (Math.hypot(b.aimX - b.x, b.aimY - b.y) < b.r * 1.5) {
      ax = b.dirX;
      ay = b.dirY;
    }
    const a = Math.atan2(ay, ax) + gaussian() * SLING.spread;
    const sp = lerp(SLING.speedMin, SLING.speedMax, o.power);
    o.vx = Math.cos(a) * sp + b.vx * SLING.inheritVelocity;
    o.vy = Math.sin(a) * sp + b.vy * SLING.inheritVelocity;
    this.events.emit('shot', { body: b, debris: o });
  }

  // --- Gravitationsbrunnen: Fressen, Einfangen, Ablenken ---------------------

  updateWells(dt) {
    const q = this._q;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const Rg = gravityRadius(b);
      const Rg2 = Rg * Rg;
      let free = maxOrbiters(b.mass) - b.orbiters.length;
      this.grid.query(b.x, b.y, Rg, q);

      for (let i = 0; i < q.length; i++) {
        const d = q[i];
        if (d.dead || d.state !== STATE.FREE) continue;    // schon von einem anderen Körper erwischt
        if (d.immuneTo === b) continue;
        const dx = b.x - d.x, dy = b.y - d.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > Rg2) continue;
        const dist = Math.sqrt(dist2) || 0.01;

        // Berührung → fressen
        if (dist < b.r + d.r * 0.4 && (d.kind === KIND.COMET || canEat(b, d))) {
          this.eatDebris(b, d);
          continue;
        }

        if (d.kind === KIND.DUST) {
          spiralPull(d, b.x, b.y, b.vx, b.vy, dist, Rg, Rg * DUST.pullFactor, DUST.swirl, b.spinDir, DUST.response, dt);
        } else if (d.kind === KIND.ASTEROID) {
          if (free > 0 && b.mass >= d.mass * ORBIT.captureRatio) {
            this.capture(b, d, dist);
            free--;
          } else if (canEat(b, d)) {
            spiralPull(d, b.x, b.y, b.vx, b.vy, dist, Rg, Rg * ASTEROID.pullFactor, 0.15, b.spinDir, 3, dt);
          }
        } else {
          // Komet: echte Gravitation → Swing-by-Bahnen
          const soft = b.r * 1.6;
          gravitate(d, b.x, b.y, dist, (COMET.gravity * b.mass) / Math.max(dist2, soft * soft), dt);
        }
      }
    }
  }

  capture(b, d, dist) {
    d.state = STATE.ORBIT;
    d.owner = b;
    d.orbitA = Math.atan2(d.y - b.y, d.x - b.x);
    d.captureGap = Math.max(ORBIT.minGap, dist - b.r - d.r);
    const depth = gravityRadius(b) - b.r;
    d.orbitGap = Math.max(ORBIT.minGap, randRange(ORBIT.gapMin, ORBIT.gapMax) * depth);
    const bonus = Math.min(ORBIT.speedBonusMax, Math.sqrt(b.mass) * ORBIT.speedPerSqrtMass);
    d.orbitSpeed = (ORBIT.speed + bonus) * randRange(0.85, 1.15);
    d.orbitBlend = 0;
    d.spin = randRange(-2.5, 2.5);
    b.orbiters.push(d);
    this.events.emit('capture', { body: b, debris: d });
  }

  eatDebris(b, d) {
    const base = d.kind === KIND.COMET ? d.reward : d.mass;
    const gain = base * this.comboFor(b);
    b.mass += gain;
    if (b.isPlayer) this.combo.gained += gain;
    b.pulse = Math.min(1, b.pulse + (d.kind === KIND.DUST ? 0.06 : 0.4));
    const e = this._eat;
    e.eater = b; e.kind = d.kind; e.gain = gain; e.x = d.x; e.y = d.y; e.color = d.color;
    e.combo = b.isPlayer ? this.combo.count : 0;
    if (d.kind === KIND.DUST) d.dead = true;
    else this.consume(d, b);
    this.events.emit('eat', e);
  }

  consume(d, consumer) {
    d.state = STATE.CONSUMED;
    d.consumer = consumer;
    d.consumeT = 0;
    d.cx0 = d.x;
    d.cy0 = d.y;
  }

  // --- Schwarze Löcher ---------------------------------------------------------

  updateBlackHoles(dt) {
    this.bhTimer -= dt;
    if (this.bhTimer <= 0) {
      if (this.blackHoles.length < BLACK_HOLE.max) this.spawnBlackHole();
      this.bhTimer = randRange(BLACK_HOLE.intervalMin, BLACK_HOLE.intervalMax);
    }
    const lim = WORLD.radius * 0.8;
    for (const h of this.blackHoles) {
      h.age += dt;
      if (h.age < BLACK_HOLE.formTime) h.strength = smoothstep(0, BLACK_HOLE.formTime, h.age);
      else if (h.age > h.life - BLACK_HOLE.collapseTime) h.strength = 1 - smoothstep(h.life - BLACK_HOLE.collapseTime, h.life, h.age);
      else h.strength = 1;

      integrate(h, dt);
      const d = Math.hypot(h.x, h.y);
      if (d > lim) {
        const nx = h.x / d, ny = h.y / d;
        const vn = h.vx * nx + h.vy * ny;
        if (vn > 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
      }
      h.r = Math.min(BLACK_HOLE.maxRadius, h.r0 + h.swallowed * BLACK_HOLE.growthPerMass);
      h.pullR = h.r * BLACK_HOLE.pullMul;
      h.spin += dt;

      if (h.age >= h.life) {
        h.dead = true;
        this.collapseBlackHole(h);
      }
    }
  }

  /** Am Lebensende verdampft das Loch und spuckt etwas Staub aus. */
  collapseBlackHole(h) {
    for (let i = 0; i < BLACK_HOLE.collapseDust; i++) {
      const a = random() * TAU, s = randRange(150, 420);
      const d = this.spawnDust(h.x + Math.cos(a) * h.r * 0.5, h.y + Math.sin(a) * h.r * 0.5);
      d.vx = Math.cos(a) * s;
      d.vy = Math.sin(a) * s;
      d.age = DUST.fadeIn;
    }
    this.events.emit('bhCollapse', h);
  }

  updateBlackHolePull(dt) {
    const q = this._q;
    for (const h of this.blackHoles) {
      if (h.dead || h.strength <= 0.01) continue;
      const P = h.pullR, s = h.strength;

      // Trümmer: Akkretionsspirale
      this.grid.query(h.x, h.y, P, q);
      for (let i = 0; i < q.length; i++) {
        const d = q[i];
        if (d.dead || d.state !== STATE.FREE) continue;
        const dx = h.x - d.x, dy = h.y - d.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > P * P) continue;
        const dist = Math.sqrt(d2) || 0.01;
        if (dist < h.r * 0.85) {
          h.swallowed += d.mass;
          this.consume(d, h);
          continue;
        }
        if (d.kind === KIND.COMET) {
          const t = 1 - dist / P;
          gravitate(d, h.x, h.y, dist, BLACK_HOLE.pullAccel * 1.5 * s * t * t, dt);
        } else {
          spiralPull(d, h.x, h.y, h.vx, h.vy, dist, P, P * 0.35 * s, 1.3, 1, 2.5, dt);
        }
      }

      // Körper: Sog, Massenverlust am Horizont, Tod
      for (const b of this.bodies) {
        if (!b.alive) continue;
        const dx = h.x - b.x, dy = h.y - b.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (s > 0.5 && dist < h.r * 0.75 + b.r * 0.2) {
          this.killBody(b, 'blackhole', null, h);
          continue;
        }
        const edge = dist - b.r;
        if (b.god) continue;
        if (s > 0.5 && edge < h.r * 0.5) {
          const loss = b.mass * BLACK_HOLE.drainRate * s * dt;
          b.mass -= loss;
          h.swallowed += loss;
          b.hitFlash = Math.max(b.hitFlash, 0.6);
          this.events.emit('bhDrain', { body: b, hole: h, amount: loss });
          if (b.mass < BODY.minMass) {
            this.killBody(b, 'blackhole', null, h);
            continue;
          }
        }
        const reach = Math.max(1, edge);
        if (reach < P) {
          const t = 1 - reach / P;
          const a = BLACK_HOLE.pullAccel * s * t * t;
          const nx = dx / dist, ny = dy / dist;
          // leicht tangential → man wird auf eine Spirale gezogen, nicht nur geradeaus
          b.vx += (nx - ny * 0.18) * a * dt;
          b.vy += (ny + nx * 0.18) * a * dt;
        }
      }
    }
  }

  // --- Körper gegen Körper ------------------------------------------------------

  updateBodyCollisions(dt) {
    const bs = this.bodies;
    const n = bs.length;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (!b.alive || !a.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy;
        const big = a.mass >= b.mass ? a : b;
        const small = big === a ? b : a;
        const eatable = canEat(big, small) && small.shield <= 0;

        // Sog: Wer gefressen werden kann, wird im Gravitationsbrunnen sanft angezogen.
        if (eatable) {
          const Rg = gravityRadius(big);
          const reach = Rg + small.r;
          if (dist2 < reach * reach) {
            const dist = Math.sqrt(dist2) || 0.01;
            const t = 1 - Math.max(0, dist - big.r) / Rg;
            const pull = BODY.bodyPull * t;
            const sx = big === a ? -dx : dx, sy = big === a ? -dy : dy;   // von small zu big
            small.vx += (sx / dist) * pull * dt;
            small.vy += (sy / dist) * pull * dt;
          }
        }

        const rs = a.r + b.r;
        if (dist2 >= rs * rs) continue;
        const dist = Math.sqrt(dist2) || 0.01;

        if (eatable) {
          if (dist < big.r + small.r * BODY.eatReach) this.eatBody(big, small);
        } else {
          const speed = bounceBodies(a, b, dx, dy, dist);
          if (speed > 60) {
            this.events.emit('bump', {
              a, b, speed,
              x: a.x + (dx / dist) * a.r,
              y: a.y + (dy / dist) * a.r,
            });
          }
        }
      }
    }
  }

  eatBody(eater, victim) {
    const gain = victim.mass * BODY.eatEfficiency * this.comboFor(eater);
    eater.mass += gain;
    if (eater.isPlayer) this.combo.gained += gain;
    eater.pulse = 1;
    this.events.emit('eatBody', { eater, victim, gain });
    this.killBody(victim, 'eaten', eater);
  }

  killBody(b, cause, killer = null, hole = null) {
    if (!b.alive || b.god) return;
    b.alive = false;
    b.cause = cause;
    b.killer = killer;
    b.diedAt = this.time;
    b.boosting = false;
    b.slingHeld = false;
    b.slingCharge = 0;
    b.slingQueue.length = 0;
    this.releaseOrbiters(b);

    b.consumer = cause === 'eaten' ? killer : cause === 'blackhole' ? hole : null;
    b.consumeT = 0;
    if (b.consumer) {
      b.cx0 = b.x - b.consumer.x;
      b.cy0 = b.y - b.consumer.y;
    }
    if (cause === 'shot') this.shatter(b);
    if (killer && killer !== b) killer.kills++;

    this.events.emit('death', { body: b, cause, killer, hole });
    if (!b.isPlayer) this.respawnAt.push(this.time + randRange(BOTS.respawnMin, BOTS.respawnMax));
  }

  /** Zerschossene Körper zerfallen in Staub und ein paar Brocken. */
  shatter(b) {
    const n = Math.min(40, Math.floor((b.mass * 0.6) / DUST.mass));
    for (let i = 0; i < n; i++) {
      const a = random() * TAU, s = randRange(60, 260);
      const d = this.spawnDust(b.x + Math.cos(a) * b.r * 0.6, b.y + Math.sin(a) * b.r * 0.6);
      d.vx = Math.cos(a) * s + b.vx * 0.5;
      d.vy = Math.sin(a) * s + b.vy * 0.5;
      d.age = DUST.fadeIn;
    }
    const chunks = Math.min(4, Math.floor(b.mass / 30));
    for (let i = 0; i < chunks; i++) {
      const d = this.spawnAsteroid(false, randRange(3, 6));
      const a = random() * TAU, s = randRange(80, 200);
      d.place(b.x + Math.cos(a) * b.r * 0.5, b.y + Math.sin(a) * b.r * 0.5);
      d.vx = Math.cos(a) * s;
      d.vy = Math.sin(a) * s;
    }
  }

  releaseOrbiters(b) {
    for (const d of b.orbiters) this.freeDebris(d, 60);
    b.orbiters.length = 0;
    b.slingQueue.length = 0;
  }

  /** Zurück in den freien Flug — behält seine Bahngeschwindigkeit plus etwas Schwung nach außen. */
  freeDebris(d, push = 0) {
    const o = d.owner;
    if (o && push) {
      const dx = d.x - o.x, dy = d.y - o.y, dist = Math.hypot(dx, dy) || 1;
      d.vx += (dx / dist) * push;
      d.vy += (dy / dist) * push;
    }
    d.state = STATE.FREE;
    d.owner = null;
    d.orbitBlend = 1;
    d.driftX = gaussian() * ASTEROID.drift * 0.5;
    d.driftY = gaussian() * ASTEROID.drift * 0.5;
  }

  absorbOrbiter(b, d) {
    const i = b.orbiters.indexOf(d);
    if (i >= 0) b.orbiters.splice(i, 1);
    b.mass += d.mass;
    d.dead = true;
    this.events.emit('absorb', { body: b, debris: d });
  }

  // --- Trümmer -------------------------------------------------------------------

  updateDebris(dt) {
    const list = this.debris;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.dead) continue;
      d.age += dt;
      if (d.immuneTimer > 0) {
        d.immuneTimer -= dt;
        if (d.immuneTimer <= 0) d.immuneTo = null;
      }
      switch (d.state) {
        case STATE.FREE: this.updateFree(d, dt); break;
        case STATE.ORBIT: this.updateOrbiter(d, dt); break;
        case STATE.PROJECTILE: this.updateProjectile(d, dt); break;
        case STATE.CONSUMED: this.updateConsumed(d, dt); break;
      }
    }
  }

  updateFree(d, dt) {
    if (d.kind === KIND.COMET) {
      integrate(d, dt);
      d.angle = Math.atan2(d.vy, d.vx);
      const out = WORLD.radius + 260;
      if (d.age > 2 && d.x * d.x + d.y * d.y > out * out) d.dead = true;
      return;
    }
    const drag = d.kind === KIND.DUST ? DUST.drag : ASTEROID.drag;
    const k = 1 - Math.exp(-drag * dt);
    d.vx += (d.driftX - d.vx) * k;
    d.vy += (d.driftY - d.vy) * k;
    integrate(d, dt);
    d.angle += d.spin * dt;
    containCircle(d, d.r, 0.6);
  }

  /**
   * Umlaufbahn: kinematisch, aber mit weichem Einschwenken (orbitBlend) und
   * langsamem Absinken. Jeder Orbiter gibt laufend Masse an seinen Körper ab
   * (Akkretion) — bis er ganz geschluckt ist oder verschossen wird.
   */
  updateOrbiter(d, dt) {
    const b = d.owner;
    if (!b || !b.alive) {
      this.freeDebris(d);
      return;
    }
    d.orbitBlend = Math.min(1, d.orbitBlend + dt / ORBIT.blendTime);
    const e = easeOutCubic(d.orbitBlend);

    const take = Math.min(d.mass, ORBIT.accretionRate * dt);
    d.mass -= take;
    b.mass += take;
    d.r = debrisRadius(d.mass);

    d.orbitGap = Math.max(ORBIT.minGap, d.orbitGap * Math.exp(-ORBIT.decay * dt));
    const gap = lerp(d.captureGap, d.orbitGap, e) + b.slingCharge * SLING.tension;
    const R = b.r + d.r + gap;
    const w = (d.orbitSpeed / R) * (1 + b.slingCharge * SLING.spinBoost) * b.spinDir * (0.3 + 0.7 * e);
    d.orbitA += w * dt;

    const nx = b.x + Math.cos(d.orbitA) * R;
    const ny = b.y + Math.sin(d.orbitA) * R;
    d.vx = (nx - d.x) / dt;
    d.vy = (ny - d.y) / dt;
    d.x = nx;
    d.y = ny;
    d.angle += d.spin * dt;

    if (d.mass <= ORBIT.absorbMass) this.absorbOrbiter(b, d);
  }

  updateProjectile(d, dt) {
    const k = Math.exp(-SLING.drag * dt);
    d.vx *= k;
    d.vy *= k;

    for (const h of this.blackHoles) {
      if (h.strength <= 0.01) continue;
      const dist = Math.hypot(h.x - d.x, h.y - d.y) || 0.01;
      if (dist < h.r * 0.85) {
        h.swallowed += d.mass;
        this.consume(d, h);
        return;
      }
      if (dist < h.pullR) {
        const t = 1 - dist / h.pullR;
        gravitate(d, h.x, h.y, dist, BLACK_HOLE.pullAccel * h.strength * t * t, dt);
      }
    }

    integrate(d, dt);
    d.angle += d.spin * 3 * dt;
    d.life -= dt;

    for (const b of this.bodies) {
      if (!b.alive || b === d.owner) continue;
      const dx = b.x - d.x, dy = b.y - d.y, rr = b.r + d.r;
      if (dx * dx + dy * dy < rr * rr) {
        this.projectileHit(d, b);
        return;
      }
    }

    const outside = d.x * d.x + d.y * d.y > (WORLD.radius - d.r) ** 2;
    if (d.life <= 0 || outside) {
      d.immuneTo = d.owner;
      d.immuneTimer = SLING.immuneTime;
      d.state = STATE.FREE;
      d.owner = null;
      d.driftX = d.vx * 0.05;
      d.driftY = d.vy * 0.05;
      if (outside) containCircle(d, d.r, 0.4);
    }
  }

  updateConsumed(d, dt) {
    d.consumeT += dt / 0.18;
    const c = d.consumer;
    if (c) {
      const t = easeInCubic(Math.min(1, d.consumeT));
      d.x = lerp(d.cx0, c.x, t);
      d.y = lerp(d.cy0, c.y, t);
    }
    if (d.consumeT >= 1) d.dead = true;
  }

  projectileHit(p, b) {
    p.dead = true;
    if (b.shield > 0) {
      this.events.emit('shieldHit', { target: b, x: p.x, y: p.y });
      return;
    }
    const damage = Math.min(b.mass, p.mass * SLING.damagePerMass * (0.55 + 0.45 * p.power));
    b.mass -= damage;
    b.hitFlash = 1;
    b.lastHitBy = p.owner;

    const sp = Math.hypot(p.vx, p.vy) || 1;
    const kb = (SLING.knockback * p.mass) / Math.max(b.mass, BODY.minMass);
    b.vx += (p.vx / sp) * kb;
    b.vy += (p.vy / sp) * kb;

    // Herausgeschlagene Masse fliegt als Staub weg — für den Schützen zum Einsammeln.
    const n = Math.min(SLING.sprayMax, Math.floor((damage * SLING.sprayFraction) / DUST.mass));
    const base = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < n; i++) {
      const a = base + gaussian() * 0.7, s = randRange(110, 280);
      const d = this.spawnDust(b.x + Math.cos(a) * (b.r + 3), b.y + Math.sin(a) * (b.r + 3));
      d.vx = Math.cos(a) * s + b.vx * 0.3;
      d.vy = Math.sin(a) * s + b.vy * 0.3;
      d.immuneTo = b;
      d.immuneTimer = 1;
      d.age = DUST.fadeIn;
    }
    this.events.emit('hit', { target: b, owner: p.owner, damage, x: p.x, y: p.y });
    if (b.mass < BODY.minMass) this.killBody(b, 'shot', p.owner);
  }

  // --- Kombo ---------------------------------------------------------------------

  comboFor(b) {
    if (!b.isPlayer) return 1;
    const c = this.combo;
    c.count++;
    c.timer = COMBO.window;
    return 1 + Math.min(c.count - 1, COMBO.maxSteps) * COMBO.step;
  }

  updateCombo(dt) {
    const c = this.combo;
    if (c.count === 0) return;
    c.timer -= dt;
    if (c.timer <= 0 || !this.player || !this.player.alive) {
      if (c.count >= COMBO.showFrom) this.events.emit('comboEnd', { count: c.count, gained: c.gained });
      c.count = 0;
      c.gained = 0;
      c.timer = 0;
    }
  }

  // --- Nachschub ----------------------------------------------------------------------

  updateSpawning(dt) {
    this.dustTimer -= dt;
    if (this.dustTimer <= 0 && this.counts.dust < DUST.count - DUST.clusterMax) {
      this.spawnDustCluster(true);
      this.dustTimer = 1 / DUST.clustersPerSecond;
    }
    this.asteroidTimer -= dt;
    if (this.asteroidTimer <= 0 && this.counts.asteroid < ASTEROID.count) {
      this.spawnAsteroid(true);
      this.asteroidTimer = 1 / ASTEROID.spawnPerSecond;
    }
    this.cometTimer -= dt;
    if (this.cometTimer <= 0) {
      if (this.counts.comet < COMET.max) this.spawnComet();
      this.cometTimer = randRange(COMET.intervalMin, COMET.intervalMax);
    }
    for (let i = this.respawnAt.length - 1; i >= 0; i--) {
      if (this.time >= this.respawnAt[i]) {
        this.respawnAt.splice(i, 1);
        this.spawnBot();
      }
    }
  }

  cleanup() {
    const list = this.debris;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (!d.dead) continue;
      this.counts[KIND_KEY[d.kind]]--;
      list[i] = list[list.length - 1];
      list.pop();
      this.pool.release(d);
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (!b.removed) continue;
      this.bodies.splice(i, 1);
      if (!b.isPlayer) this.names.release(b.name);
    }
    if (this.blackHoles.some(h => h.dead)) this.blackHoles = this.blackHoles.filter(h => !h.dead);
  }

  // --- Abfragen für UI/Renderer ----------------------------------------------------------

  /** Rangliste: alle lebenden Körper nach Masse. */
  ranking() {
    return this.bodies.filter(b => b.alive).sort((a, b) => b.mass - a.mass);
  }
}
