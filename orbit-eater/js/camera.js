/**
 * Kamera: weiches Folgen, automatischer Zoom nach Größe, Screen Shake.
 *
 * Shake funktioniert über "Trauma" (0..1): Ereignisse addieren Trauma, es
 * klingt linear ab, die Auslenkung wächst mit Trauma². Das Rauschen ist
 * glatt (kein Zufall pro Frame) — wirkt wie ein Ruck, nicht wie Flimmern.
 */
import { CAMERA, BODY } from './config.js';
import { clamp, damp, valueNoise } from './utils.js';
import { radiusForMass } from './entities.js';

const R0 = radiusForMass(BODY.startMass);

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 0.5;
    this.trauma = 0;
    this.sx = 0;
    this.sy = 0;
    this.punch = 0;       // kurzer Zoom-Impuls (Evolution)
    this.t = 0;
    this.reduceMotion = false;
  }

  /** Bildschirmgröße → Maßstab. Geometrisches Mittel, damit Hoch- und Querformat ähnlich viel zeigen. */
  static viewScale(w, h) {
    return clamp(Math.sqrt(w * h) / 1200, 0.55, 1.6);
  }

  /** Zielzoom für einen Körper mit Radius r: er wächst auf dem Schirm langsamer als in der Welt. */
  static zoomFor(r, w, h) {
    const screenR = CAMERA.baseScreenR * Camera.viewScale(w, h) * Math.pow(r / R0, CAMERA.growthExp);
    return clamp(screenR / r, CAMERA.minZoom, CAMERA.maxZoom);
  }

  follow(tx, ty, tz, dt, rate = CAMERA.followRate, zoomRate = CAMERA.zoomRate) {
    this.x = damp(this.x, tx, rate, dt);
    this.y = damp(this.y, ty, rate, dt);
    // Zoom logarithmisch annähern — gleichmäßig wirkendes Rein/Raus
    this.zoom = Math.exp(damp(Math.log(this.zoom), Math.log(tz), zoomRate, dt));
  }

  jump(x, y, z) {
    this.x = x;
    this.y = y;
    if (z) this.zoom = z;
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount * (this.reduceMotion ? 0.25 : 1));
  }

  kick(amount) {
    if (!this.reduceMotion) this.punch = Math.max(this.punch, amount);
  }

  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - CAMERA.shakeDecay * dt);
    const s = this.trauma * this.trauma * CAMERA.shakeMax;
    this.sx = (valueNoise(this.t * 22, 0.5, 11) - 0.5) * 2 * s;
    this.sy = (valueNoise(this.t * 22, 7.5, 23) - 0.5) * 2 * s;
    this.punch = damp(this.punch, 0, 5, dt);
  }

  get scale() {
    return this.zoom * (1 + this.punch);
  }
}
