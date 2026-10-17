/**
 * Bot-KI: Steering-Verhalten plus ein einfaches Bewertungssystem.
 *
 * Alle paar Zehntelsekunden (Reaktionszeit, je Bot verschieden) schaut sich
 * ein Bot um — nur so weit, wie ein Spieler seiner Größe sehen würde:
 *
 *   Bedrohungen   größere Körper, Schwarze Löcher, Arenarand → Fluchtvektor
 *   Gelegenheiten kleinere Körper, Kometen, Asteroiden, Staubwolken → Score
 *
 * Das beste Ziel wird angesteuert, der Fluchtvektor je nach Gefahr
 * beigemischt. Danach dreht der Bot mit begrenzter Wendigkeit in die neue
 * Richtung — genau wie der Spieler, über dieselbe Body-Schnittstelle.
 * Kein Bot sieht durch Wände, keiner zielt perfekt: Zielfehler und
 * Reaktionszeit hängen vom Können ab.
 */
import { BODY, BOTS, SLING, WORLD, COMET, ORBIT } from './config.js';
import { TAU, clamp, lerp, angleDiff, random, randRange, gaussian, chance } from './utils.js';
import { KIND, STATE, Body, maxSpeed, gravityRadius, canEat, maxOrbiters } from './entities.js';

const scratch = [];

export class BotBrain {
  constructor() {
    // Persönlichkeit
    this.aggression = randRange(0.7, 1.45);
    this.caution = randRange(0.5, 1.25);
    this.skill = randRange(0.45, 1);
    this.reaction = randRange(BOTS.thinkMin, BOTS.thinkMax);

    this.thinkTimer = random() * 0.3;
    this.heading = random() * TAU;
    this.goalX = Math.cos(this.heading);
    this.goalY = Math.sin(this.heading);
    this.wander = this.heading;
    this.target = null;
    this.danger = 0;
    this.boostTimer = 0;

    this.slingTarget = null;
    this.slingGoal = 0;
    this.slingCooldown = randRange(2, 6);
    this.aimErrX = 0;
    this.aimErrY = 0;
  }
}

/** Pro Tick: Richtung nachführen, Boost und Schleuder bedienen. */
export function updateBot(game, b, dt) {
  const br = b.brain;
  br.thinkTimer -= dt;
  if (br.thinkTimer <= 0) {
    think(game, b, br);
    br.thinkTimer += br.reaction * randRange(0.8, 1.25);
  }

  // Begrenzte Wendigkeit — Bots wenden nicht auf der Stelle.
  const goalA = Math.atan2(br.goalY, br.goalX);
  const maxTurn = BOTS.turnRate * (0.6 + 0.6 * br.skill) * dt;
  br.heading += clamp(angleDiff(br.heading, goalA), -maxTurn, maxTurn);
  b.dirX = Math.cos(br.heading);
  b.dirY = Math.sin(br.heading);
  b.throttle = 1;

  br.boostTimer -= dt;
  b.wantBoost = br.boostTimer > 0;

  br.slingCooldown -= dt;
  const t = br.slingTarget;
  if (b.slingHeld) {
    if (!t || !t.alive || b.orbiters.length === 0 || br.danger > 0.8) {
      b.slingHeld = false;           // abbrechen (bzw. bei Gefahr sofort feuern)
      br.slingCooldown = randRange(1, 3);
    } else {
      aimAt(b, t, br);
      if (b.slingCharge >= br.slingGoal) {
        b.slingHeld = false;         // loslassen → game.js feuert die Salve
        br.slingCooldown = randRange(3, 7) / br.aggression;
      }
    }
  } else if (b.slingQueue.length && t && t.alive) {
    aimAt(b, t, br);                 // während der Salve weiter nachzielen
  }
}

/** Zielt auf die vorausberechnete Position — gute Bots halten vor, schlechte daneben. */
function aimAt(b, t, br) {
  const dist = Math.hypot(t.x - b.x, t.y - b.y);
  const speed = lerp(SLING.speedMin, SLING.speedMax, Math.max(0.4, b.slingCharge));
  const lead = (dist / speed) * br.skill;
  b.aimX = t.x + t.vx * lead + br.aimErrX;
  b.aimY = t.y + t.vy * lead + br.aimErrY;
}

function think(game, b, br) {
  const V = BOTS.viewBase + b.r * BOTS.viewPerRadius;
  const skill = br.skill * lerp(BOTS.skillMinScale, 1, game.difficulty);

  let fleeX = 0, fleeY = 0, danger = 0;
  let best = null, bestScore = 0, bestX = 0, bestY = 0, bestDist = 0;

  // --- 1) Andere Körper: Bedrohung oder Beute? ---------------------------
  for (const o of game.bodies) {
    if (o === b || !o.alive) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > V + o.r) continue;
    const gap = Math.max(1, d - o.r - b.r);

    if (canEat(o, b)) {
      const range = BOTS.threatRange + gravityRadius(o) * 0.6 + o.r;
      if (gap < range) {
        let w = 1 - gap / range;
        w = Math.pow(w, 1.5);
        const approach = -(o.vx * dx + o.vy * dy) / d;   // kommt er auf mich zu?
        if (approach > 30) w *= 1.4;
        w *= br.caution;
        fleeX -= (dx / d) * w;
        fleeY -= (dy / d) * w;
        if (w > danger) danger = w;
      }
    } else if (canEat(b, o) && o.shield <= 0) {
      let s = ((100 * o.mass) / (gap + 120)) * br.aggression;
      s *= clamp(maxSpeed(b.mass) / maxSpeed(o.mass), 0.45, 1.2);   // flinke Beute lohnt weniger
      if (o.isPlayer) s *= game.playerAggro;
      if (o === br.target) s *= 1.3;                                 // Hysterese gegen Zappeln
      if (s > bestScore) {
        bestScore = s; best = o; bestX = o.x; bestY = o.y; bestDist = d;
      }
    }
  }

  // --- 2) Schwarze Löcher -----------------------------------------------------
  for (const h of game.blackHoles) {
    const dx = h.x - b.x, dy = h.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const range = h.pullR * (0.7 + 0.5 * br.caution) * Math.max(0.3, h.strength) + b.r;
    if (d < range) {
      let w = 1 - d / range;
      w = w * w * 3.2 * br.caution;
      fleeX -= (dx / d) * w;
      fleeY -= (dy / d) * w;
      if (w > danger) danger = w;
    }
  }

  // --- 3) Arenarand ---------------------------------------------------------------
  const dc = Math.hypot(b.x, b.y) || 1;
  const zone = 380 + b.r;
  if (dc > WORLD.radius - zone) {
    const w = ((dc - (WORLD.radius - zone)) / zone) ** 2 * 2.5;
    fleeX -= (b.x / dc) * w;
    fleeY -= (b.y / dc) * w;
  }

  // --- 4) Trümmer in Sichtweite ---------------------------------------------------
  const q = game.grid.query(b.x, b.y, V * 0.55, scratch);
  let dustX = 0, dustY = 0, dustW = 0;
  const canCapture = b.orbiters.length < maxOrbiters(b.mass);
  for (let i = 0; i < q.length; i++) {
    const d = q[i];
    if (d.dead || d.state !== STATE.FREE || d.immuneTo === b) continue;
    const dx = d.x - b.x, dy = d.y - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (d.kind === KIND.DUST) {
      const w = 100 / (dist + 60);
      dustX += (dx / dist) * w;
      dustY += (dy / dist) * w;
      dustW += w;
      continue;
    }
    let s;
    if (d.kind === KIND.COMET) {
      const closing = -(d.vx * dx + d.vy * dy) / dist;
      s = ((100 * COMET.reward) / (dist + 100)) * (closing > 0 ? 1.3 : 0.5) * br.aggression;
    } else {
      if (!canEat(b, d)) continue;
      const ammo = canCapture && b.mass >= d.mass * ORBIT.captureRatio ? 1.6 : 1;
      s = ((100 * d.mass * ammo) / (dist + 80)) * 0.9;
    }
    if (s > bestScore) {
      bestScore = s; best = d; bestX = d.x; bestY = d.y; bestDist = dist;
    }
  }

  // --- 5) Entscheidung → Wunschrichtung ---------------------------------------------
  let gx, gy;
  if (best && bestScore >= dustW) {
    gx = bestX - b.x;
    gy = bestY - b.y;
  } else if (dustW > 0) {
    best = null;
    gx = dustX;
    gy = dustY;
  } else {
    best = null;
    br.wander += gaussian() * 0.5;
    gx = Math.cos(br.wander) - (b.x / WORLD.radius) * 0.8;
    gy = Math.sin(br.wander) - (b.y / WORLD.radius) * 0.8;
  }
  let gl = Math.hypot(gx, gy) || 1;
  gx /= gl;
  gy /= gl;

  const fl = Math.hypot(fleeX, fleeY);
  if (fl > 0.001) {
    // Liegt das Ziel in Richtung der Gefahr, wiegt die Flucht schwerer.
    const toward = -(gx * fleeX + gy * fleeY) / fl;
    const f = Math.min(1, danger * 1.6 + Math.max(0, toward) * danger * 1.2);
    gx = gx * (1 - f) + (fleeX / fl) * f * 1.4;
    gy = gy * (1 - f) + (fleeY / fl) * f * 1.4;
    gl = Math.hypot(gx, gy) || 1;
    gx /= gl;
    gy /= gl;
  }

  // Während die Schleuder lädt, auf das Ziel zuhalten (Zielrichtung = Flugrichtung, wie beim Spieler).
  if (b.slingHeld && br.slingTarget && br.slingTarget.alive && danger < 0.6) {
    const t = br.slingTarget;
    const tl = Math.hypot(t.x - b.x, t.y - b.y) || 1;
    gx = (t.x - b.x) / tl;
    gy = (t.y - b.y) / tl;
  }

  const err = gaussian() * (1 - skill) * 0.35;
  const ga = Math.atan2(gy, gx) + err;
  br.goalX = Math.cos(ga);
  br.goalY = Math.sin(ga);
  br.target = best;
  br.danger = danger;

  // --- 6) Boost ------------------------------------------------------------------------
  if (br.boostTimer <= 0 && b.mass > BODY.boostMinMass * 1.4) {
    if (danger > 0.5 && chance(skill * 0.8)) {
      br.boostTimer = randRange(0.4, 1.1);
    } else if (best instanceof Body && bestDist - best.r - b.r < b.r + 110 && chance(br.aggression * skill * 0.35)) {
      br.boostTimer = randRange(0.3, 0.6);
    } else if (best && best.kind === KIND.COMET && bestDist < 420 && chance(0.3)) {
      br.boostTimer = 0.4;
    }
  }

  // --- 7) Schleuder planen -----------------------------------------------------------------
  if (!b.slingHeld && b.slingQueue.length === 0 && br.slingCooldown <= 0
      && b.orbiters.length >= BOTS.slingMinOrbiters && danger < 0.6) {
    let tgt = best instanceof Body && bestDist < BOTS.slingRange ? best : null;
    if (!tgt) {
      // Ein Rivale ähnlicher Größe in Reichweite? Den kann man anschießen.
      let nd = BOTS.slingRange;
      for (const o of game.bodies) {
        if (o === b || !o.alive || o.shield > 0 || canEat(o, b)) continue;
        if (o.mass < b.mass * 0.35) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < nd) { nd = d; tgt = o; }
      }
    }
    const p = tgt ? br.aggression * 0.5 * (tgt.isPlayer ? game.playerAggro : 1) : 0;
    if (tgt && chance(p)) {
      b.slingHeld = true;
      br.slingTarget = tgt;
      br.slingGoal = randRange(0.45, 1);
      const miss = (1 - skill) * 90;
      br.aimErrX = gaussian() * miss;
      br.aimErrY = gaussian() * miss;
      aimAt(b, tgt, br);
    } else {
      br.slingCooldown = randRange(0.6, 1.6);
    }
  }
}
