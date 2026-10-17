/**
 * Partikelsystem mit Objekt-Pool.
 *
 * Alle Partikel werden einmal angelegt und danach nur recycelt — bei
 * Explosionen mit Hunderten Funken entsteht so kein Garbage. Ist der Pool
 * erschöpft, wird der älteste aktive Partikel überschrieben.
 *
 * Größen sind Welt-Einheiten, mit einer Mindestgröße in Bildschirmpixeln,
 * damit Effekte auch weit herausgezoomt sichtbar bleiben.
 */
import { TAU } from './utils.js';

export const PT = Object.freeze({ SPARK: 0, GLOW: 1, RING: 2, CHUNK: 3 });

class Particle {
  constructor() {
    this.type = 0;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.life = 0; this.max = 1;
    this.size = 1; this.size2 = 1;
    this.drag = 0;
    this.color = '#fff';
    this.sprite = null;
    this.rot = 0; this.vr = 0;
    this.alpha = 1;
  }
}

export class Particles {
  constructor(capacity) {
    this.capacity = capacity;
    this.pool = Array.from({ length: capacity }, () => new Particle());
    this.active = [];
    this.oldest = 0;
  }

  spawn(type, x, y, vx, vy, life, size, color, sprite = null) {
    let p = this.pool.pop();
    if (!p) {
      // Pool leer: den ältesten aktiven Partikel wiederverwenden
      this.oldest = (this.oldest + 1) % this.active.length;
      p = this.active[this.oldest];
    } else {
      this.active.push(p);
    }
    p.type = type;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = p.max = life;
    p.size = size;
    p.size2 = size;
    p.drag = 1.5;
    p.color = color;
    p.sprite = sprite;
    p.rot = Math.random() * TAU;
    p.vr = 0;
    p.alpha = 1;
    return p;
  }

  /** Ring, der sich von r0 auf r1 ausdehnt und dabei verblasst. */
  ring(x, y, r0, r1, life, color, alpha = 1) {
    const p = this.spawn(PT.RING, x, y, 0, 0, life, r0, color);
    p.size2 = r1;
    p.alpha = alpha;
    return p;
  }

  /** Funkenregen in alle Richtungen. */
  burst(x, y, n, speedMin, speedMax, life, size, color, drag = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      const p = this.spawn(PT.SPARK, x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size, color);
      p.drag = drag;
    }
  }

  clear() {
    for (const p of this.active) this.pool.push(p);
    this.active.length = 0;
  }

  update(dt) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) {
        list[i] = list[list.length - 1];
        list.pop();
        this.pool.push(p);
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  /**
   * Zeichnet in Welt-Koordinaten (Transform ist bereits gesetzt).
   * `z` ist der Zoom, `v` der sichtbare Ausschnitt für Culling.
   */
  draw(ctx, z, v) {
    const list = this.active;
    const px = 1 / z;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let lastStroke = '';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const m = p.size2 + 40 * px;
      if (p.x < v.x0 - m || p.x > v.x1 + m || p.y < v.y0 - m || p.y > v.y1 + m) continue;
      const t = 1 - p.life / p.max;           // 0 → 1 über die Lebenszeit
      const fade = 1 - t;
      switch (p.type) {
        case PT.SPARK: {
          const w = Math.max(p.size, 1.4 * px);
          ctx.globalAlpha = fade * p.alpha;
          if (p.color !== lastStroke) { ctx.strokeStyle = p.color; lastStroke = p.color; }
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
          ctx.stroke();
          break;
        }
        case PT.GLOW: {
          const s = Math.max(p.size, 3 * px) * (0.4 + 0.6 * fade);
          ctx.globalAlpha = fade * p.alpha;
          ctx.drawImage(p.sprite, p.x - s, p.y - s, s * 2, s * 2);
          break;
        }
        case PT.RING: {
          const e = 1 - (1 - t) ** 3;
          const r = p.size + (p.size2 - p.size) * e;
          ctx.globalAlpha = fade * fade * p.alpha;
          if (p.color !== lastStroke) { ctx.strokeStyle = p.color; lastStroke = p.color; }
          ctx.lineWidth = (0.6 + 2.4 * fade) * px;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case PT.CHUNK: {
          const s = Math.max(p.size, 2 * px);
          ctx.globalAlpha = Math.min(1, fade * 1.6) * p.alpha;
          ctx.globalCompositeOperation = 'source-over';
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(p.sprite, -s, -s, s * 2, s * 2);
          ctx.restore();
          ctx.globalCompositeOperation = 'lighter';
          break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
