/**
 * Datenmodell der Welt.
 *
 *   Body       Spieler und Bots. Identische Klasse, identische Physik —
 *              Bots "drücken" dieselben Knöpfe wie der Mensch.
 *   Debris     Staub, Asteroiden, Kometen. Durchläuft Zustände:
 *              FREE → ORBIT → PROJECTILE → (FREE) … → CONSUMED.
 *              Wird gepoolt, weil ständig Staub entsteht und vergeht.
 *   BlackHole  Gefahrenzone mit Lebenszyklus (entsteht, wirkt, kollabiert).
 */
import { BODY, ORBIT, STAGES, STAGE_DOWN, ASTEROID, BLACK_HOLE } from './config.js';
import { TAU, random, randRange } from './utils.js';

export const KIND = Object.freeze({ DUST: 0, ASTEROID: 1, COMET: 2 });
export const STATE = Object.freeze({ FREE: 0, ORBIT: 1, PROJECTILE: 2, CONSUMED: 3 });

// --- Abgeleitete Größen ---------------------------------------------------------

export const radiusForMass = m => BODY.radiusK * Math.sqrt(Math.max(m, 0));
export const debrisRadius = m => ASTEROID.radiusK * Math.sqrt(Math.max(m, 0.2));

/** Größere Körper sind langsamer — die klassische .io-Abwägung. */
export const maxSpeed = m =>
  BODY.speedBase * Math.pow(Math.max(m, 1) / BODY.speedRefMass, BODY.speedExp);

export const steerRate = m =>
  BODY.steerRate * Math.pow(Math.max(m, 1) / BODY.speedRefMass, BODY.steerExp);

export const gravityRadius = b => b.r * BODY.gravityMul + BODY.gravityAdd;

export const maxOrbiters = m =>
  Math.min(ORBIT.maxCap, Math.floor(ORBIT.maxBase + Math.sqrt(m) * ORBIT.maxPerSqrtMass));

/** Stufe zur Masse, mit Hysterese nach unten (siehe STAGE_DOWN). */
export function stageFor(mass, current = 0) {
  let s = current;
  while (s + 1 < STAGES.length && mass >= STAGES[s + 1].min) s++;
  while (s > 0 && mass < STAGES[s].min * STAGE_DOWN) s--;
  return s;
}

/** Kann `a` den Körper `b` fressen? */
export const canEat = (a, b) => b.mass < a.mass * BODY.eatRatio;

// --- Body ---------------------------------------------------------------------

export class Body {
  constructor(id, name, isPlayer = false) {
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.alive = true;
    this.removed = false;

    // Bewegung (px/py = Position des letzten Ticks, für interpolierte Darstellung)
    this.x = 0; this.y = 0;
    this.px = 0; this.py = 0;
    this.vx = 0; this.vy = 0;

    this.mass = BODY.startMass;
    this.r = radiusForMass(this.mass);
    this.stage = 0;
    this.maxStage = 0;

    // Aussehen
    this.seed = (random() * 0x7fffffff) | 0;
    this.spinDir = random() < 0.5 ? -1 : 1;     // Drehsinn von Körper und Orbitern
    this.angle = random() * TAU;
    this.pAngle = this.angle;
    this.spin = randRange(0.12, 0.3) * this.spinDir;
    this.surface = random();                    // Scroll-Position der Oberflächentextur (0..1)
    this.pulse = 0;                             // kurzer "Schluck" beim Fressen
    this.hitFlash = 0;
    this.spawnT = 0;                            // 0 → 1 beim Materialisieren

    // Steuerung — wird vom Input (Spieler) oder vom Bot-Gehirn gesetzt
    this.dirX = 1; this.dirY = 0;
    this.throttle = 0;
    this.wantBoost = false;
    this.boosting = false;
    this.boostDrop = 0;
    this.slingHeld = false;
    this.slingCharge = 0;
    this.slingPower = 0;
    this.slingQueue = [];
    this.slingTimer = 0;
    this.aimX = 0; this.aimY = 0;

    this.orbiters = [];
    this.shield = 0;
    this.drain = 0;      // aktueller Massenverlust durch Reibung (pro Sekunde), fürs HUD

    // Admin-Konsole
    this.god = false;
    this.speedMul = 1;

    // Tod
    this.consumer = null;
    this.consumeT = 0;
    this.cx0 = 0; this.cy0 = 0;
    this.cause = null;
    this.killer = null;

    // Statistik
    this.kills = 0;
    this.maxMass = this.mass;
    this.bornAt = 0;
    this.diedAt = 0;
    this.lastHitBy = null;

    this.brain = null;   // nur Bots
    this.art = null;     // vom Renderer befüllter Textur-Cache
  }

  setMass(m) {
    this.mass = m;
    this.r = radiusForMass(m);
    this.stage = stageFor(m, 0);
    this.maxStage = this.stage;
    this.maxMass = m;
  }

  place(x, y) {
    this.x = this.px = x;
    this.y = this.py = y;
  }
}

// --- Debris ---------------------------------------------------------------------

export class Debris {
  constructor() {
    this.reset();
  }

  reset() {
    this.kind = KIND.DUST;
    this.state = STATE.FREE;
    this.dead = false;
    this.x = 0; this.y = 0; this.px = 0; this.py = 0;
    this.vx = 0; this.vy = 0;
    this.driftX = 0; this.driftY = 0;
    this.mass = 1;
    this.r = 3;
    this.angle = 0; this.pAngle = 0; this.spin = 0;
    this.variant = 0;
    this.color = 0;
    this.age = 0;
    this.reward = 0;

    // Umlaufbahn
    this.owner = null;
    this.orbitA = 0;
    this.orbitGap = 0;
    this.captureGap = 0;
    this.orbitSpeed = 0;
    this.orbitBlend = 1;

    // Projektil
    this.life = 0;
    this.power = 0;

    // "Diesen Körper eine Weile ignorieren" (Boost-Staub, eigene Projektile, Trefferstaub)
    this.immuneTo = null;
    this.immuneTimer = 0;

    // Wird gerade gefressen
    this.consumer = null;
    this.consumeT = 0;
    this.cx0 = 0; this.cy0 = 0;
    return this;
  }

  place(x, y) {
    this.x = this.px = x;
    this.y = this.py = y;
  }
}

/** Objekt-Pool: vermeidet, dass bei Dauer-Spawns ständig der GC anspringt. */
export class DebrisPool {
  constructor(prefill = 0) {
    this.free = [];
    for (let i = 0; i < prefill; i++) this.free.push(new Debris());
  }

  acquire() {
    return (this.free.pop() || new Debris()).reset();
  }

  release(d) {
    d.owner = null;
    d.consumer = null;
    d.immuneTo = null;
    this.free.push(d);
  }
}

// --- Schwarzes Loch -----------------------------------------------------------------

export class BlackHole {
  constructor(x, y) {
    this.x = this.px = x;
    this.y = this.py = y;
    const a = random() * TAU;
    this.vx = Math.cos(a) * BLACK_HOLE.drift;
    this.vy = Math.sin(a) * BLACK_HOLE.drift;
    this.r0 = randRange(BLACK_HOLE.radiusMin, BLACK_HOLE.radiusMax);
    this.r = this.r0;
    this.pullR = this.r * BLACK_HOLE.pullMul;
    this.age = 0;
    this.life = randRange(BLACK_HOLE.lifeMin, BLACK_HOLE.lifeMax);
    this.strength = 0;
    this.spin = random() * TAU;
    this.swallowed = 0;
    this.dead = false;
  }
}
