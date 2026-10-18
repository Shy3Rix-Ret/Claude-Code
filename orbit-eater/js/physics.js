/**
 * Physik-Bausteine. Reine Funktionen auf Entities — welche Regel wann greift,
 * entscheidet game.js.
 *
 * Ansatz:
 *  - Körper steuern mit Trägheit: die Geschwindigkeit nähert sich exponentiell
 *    der Wunschgeschwindigkeit an. Äußere Kräfte (Schwarze Löcher, Sog) werden
 *    einfach addiert und ergeben so eine natürliche Drift.
 *  - Staub im Gravitationsbrunnen wird nicht stumpf angezogen, sondern auf eine
 *    Einfallspirale gelenkt (radial + tangential). Das liest sich wie Gravitation,
 *    ist aber stabil — kein Überschießen, keine Explosionen bei kleinem Abstand.
 *  - Kometen bekommen echte 1/r²-Beschleunigung, damit ihre Bahnen sichtbar
 *    abgelenkt werden ("Swing-by").
 *  - Eingefangene Brocken laufen kinematisch auf Kreisbahnen (siehe game.js).
 */
import { BODY, WORLD } from './config.js';
import { maxSpeed, steerRate } from './entities.js';

/** Wunschrichtung × Gas → Zielgeschwindigkeit, weich angenähert. */
export function steerBody(b, dt) {
  const boost = b.boosting ? BODY.boostMul : 1;
  const vmax = maxSpeed(b.mass) * boost * b.throttle * b.speedMul;
  const k = 1 - Math.exp(-steerRate(b.mass) * (b.boosting ? 1.5 : 1) * dt);
  b.vx += (b.dirX * vmax - b.vx) * k;
  b.vy += (b.dirY * vmax - b.vy) * k;
}

export function integrate(e, dt) {
  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

/**
 * Hält einen Kreis innerhalb der Arena. Nach außen gerichtete Geschwindigkeit
 * wird reflektiert und gedämpft. Gibt true zurück, wenn die Wand berührt wurde.
 */
export function containCircle(e, radius, bounce = WORLD.wallBounce) {
  const limit = WORLD.radius - radius;
  const d2 = e.x * e.x + e.y * e.y;
  if (d2 <= limit * limit) return false;
  const d = Math.sqrt(d2);
  const nx = e.x / d, ny = e.y / d;
  e.x = nx * limit;
  e.y = ny * limit;
  const vn = e.vx * nx + e.vy * ny;
  if (vn > 0) {
    e.vx -= nx * vn * (1 + bounce);
    e.vy -= ny * vn * (1 + bounce);
  }
  return true;
}

/**
 * Lenkt ein Objekt auf eine Einfallspirale um ein Zentrum.
 *
 * @param e        Objekt mit x/y/vx/vy
 * @param cx, cy   Zentrum
 * @param cvx, cvy Eigengeschwindigkeit des Zentrums (Objekte "fliegen mit")
 * @param dist     bereits berechneter Abstand
 * @param wellR    Radius des Brunnens
 * @param inward   Einfallgeschwindigkeit am Rand
 * @param swirl    tangentialer Anteil (0 = gerade Linie)
 * @param spinDir  Drehsinn (+1/−1)
 * @param response wie schnell das Objekt der Spirale folgt (1/s)
 */
export function spiralPull(e, cx, cy, cvx, cvy, dist, wellR, inward, swirl, spinDir, response, dt) {
  const nx = (cx - e.x) / dist;
  const ny = (cy - e.y) / dist;
  const t = 1 - dist / wellR;                       // 0 am Rand, 1 im Zentrum
  const vin = inward * (0.3 + t * 1.4);
  const vt = vin * swirl * (1 - t * 0.6) * spinDir;
  const tx = cvx + nx * vin - ny * vt;
  const ty = cvy + ny * vin + nx * vt;
  const k = 1 - Math.exp(-response * (0.35 + t) * dt);
  e.vx += (tx - e.vx) * k;
  e.vy += (ty - e.vy) * k;
}

/** Schwerkraft im klassischen Sinn: a = G·M / r², weich begrenzt. */
export function gravitate(e, cx, cy, dist, accelAtDist, dt) {
  e.vx += ((cx - e.x) / dist) * accelAtDist * dt;
  e.vy += ((cy - e.y) / dist) * accelAtDist * dt;
}

/**
 * Elastischer Stoß zweier Körper ähnlicher Masse.
 * Trennt die Überlappung massegewichtet und garantiert eine Mindest-
 * Trenngeschwindigkeit, damit sich ein Abprallen auch nach Abprallen anfühlt
 * (die Steuerung würde einen weichen Stoß sofort wieder schlucken).
 * Gibt die Aufprallgeschwindigkeit zurück (0, wenn sie sich schon trennen).
 */
export function bounceBodies(a, b, dx, dy, dist) {
  const nx = dx / dist, ny = dy / dist;
  const overlap = a.r + b.r - dist;
  const total = a.mass + b.mass;
  a.x -= nx * overlap * (b.mass / total);
  a.y -= ny * overlap * (b.mass / total);
  b.x += nx * overlap * (a.mass / total);
  b.y += ny * overlap * (a.mass / total);

  const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;   // > 0: trennen sich
  if (rv >= BODY.bounceMinSpeed) return 0;
  const target = Math.max(BODY.bounceMinSpeed, -rv * BODY.bounce);
  const dv = target - rv;
  const ia = 1 / a.mass, ib = 1 / b.mass, sum = ia + ib;
  a.vx -= nx * dv * (ia / sum);
  a.vy -= ny * dv * (ia / sum);
  b.vx += nx * dv * (ib / sum);
  b.vy += ny * dv * (ib / sum);
  return Math.max(0, -rv);
}
