/**
 * Renderer: zeichnet die Welt auf ein Canvas 2D.
 *
 * Reihenfolge eines Frames
 *   1. Hintergrund   Nebel + 3 Sternebenen mit Parallaxe + "Hero"-Sterne
 *   2. Welt          Polarraster, Arenarand mit Gradskala, Schwarze Löcher (hinten),
 *                    Staub, Gravitationsringe/Auren, Trümmer, Körper,
 *                    Orbiter/Projektile, Schwarze Löcher (vorne), Partikel
 *   3. Bildschirm    Namensschilder, schwebende Zahlen, Touch-Joystick
 *
 * Alle Positionen werden zwischen letztem und aktuellem Physik-Tick
 * interpoliert (alpha), damit die Bewegung bei jeder Bildrate flüssig ist.
 *
 * Kugeln: Die Oberfläche wird in senkrechte Streifen zerlegt, deren Breite
 * dem Sinus der geografischen Länge folgt. Dadurch läuft die Textur am
 * Rand zusammen — der Körper wirkt wie eine sich drehende Kugel, nicht wie
 * eine scrollende Scheibe.
 */
import { WORLD, CAMERA, RENDER, PALETTE, DUST, BLACK_HOLE, STAGES } from './config.js';
import { TAU, clamp, lerp, rgba, fmt, easeOutBack, easeInCubic, random, valueNoise } from './utils.js';
import { KIND, STATE, gravityRadius, canEat } from './entities.js';
import { Camera } from './camera.js';
import { Particles, PT } from './particles.js';
import {
  STRIP_H, makeCanvas, buildBodyArt, buildAsteroidSprites, glowSprite, dustSprite, auraSprite,
  buildBlackHoleDisk, buildStarTile, buildNebulaTile, buildHatchTile,
} from './sprites.js';

const FONT_DISPLAY = '"Bahnschrift", "DIN Alternate", "DIN Condensed", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif';
const FONT_MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", "Segoe UI Mono", "JetBrains Mono", Menlo, Consolas, monospace';

const COLOR = {
  self: PALETTE.amber,
  threat: PALETTE.threat,
  prey: PALETTE.prey,
  neutral: PALETTE.paper,
};
const LABEL = {
  self: '#ffc773',
  threat: '#ff8f84',
  prey: '#aef5bd',
  neutral: 'rgba(236,230,214,0.72)',
};

export class Renderer {
  constructor(canvas, events) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = new Camera();
    this.fx = new Particles(RENDER.particles);
    this.texts = [];
    this.view = { x0: 0, y0: 0, x1: 0, y1: 0, cx: 0, cy: 0, z: 1 };
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.maxDpr = RENDER.maxDpr;
    this.time = 0;
    this.artBudget = 0;
    this.artCache = new Map();
    this.zoomMul = 1;          // Admin-Konsole: /zoom
    this.player = null;
    this.attract = null;
    this.attractT = 0;
    this.trailAcc = 0;
    this.sorted = [];
    this.wa = 1; this.wtx = 0; this.wty = 0;   // aktuelle Welt-Transformation

    this.buildAssets();
    this.resize();
    if (events) this.bind(events);
  }

  buildAssets() {
    const ctx = this.ctx;
    this.asteroidSprites = buildAsteroidSprites();
    this.dustSprites = PALETTE.dust.map(dustSprite);
    this.bhDisk = buildBlackHoleDisk();
    this.starLayers = [
      { tile: buildStarTile(1024, 420, 11, { pow: 3, rMin: 0.5, rMax: 1.1, aMin: 0.14, aMax: 0.5 }), factor: 0.05 },
      { tile: buildStarTile(1024, 140, 23, { pow: 2.5, rMin: 0.6, rMax: 1.3, aMin: 0.22, aMax: 0.65 }), factor: 0.12 },
      { tile: buildStarTile(1024, 40, 37, { pow: 2, rMin: 0.9, rMax: 1.7, aMin: 0.3, aMax: 0.8 }), factor: 0.24 },
    ];
    for (const l of this.starLayers) l.pattern = ctx.createPattern(l.tile, 'repeat');
    this.nebula = ctx.createPattern(buildNebulaTile(256, 5), 'repeat');
    this.hatch = ctx.createPattern(buildHatchTile(), 'repeat');
    this.heroStars = Array.from({ length: 16 }, () => ({
      x: random() * 3000,
      y: random() * 3000,
      s: 0.6 + random() * 0.9,
      ph: random() * TAU,
      col: random() < 0.3 ? '#cfe0ff' : random() < 0.5 ? '#ffe2b8' : '#ffffff',
    }));
    this.shade = makeShade(ctx);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = window.innerWidth, h = window.innerHeight;
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  setMaxDpr(v) {
    this.maxDpr = v;
    this.resize();
  }

  // =====================================================================
  // Frame
  // =====================================================================

  /**
   * @param game   Spielwelt
   * @param alpha  Interpolationsfaktor zwischen letztem und aktuellem Tick
   * @param dt     echte Frame-Zeit (s)
   * @param view   { mode: 'menu'|'play'|'dead', timeScale, input, labels }
   */
  render(game, alpha, dt, view) {
    const ctx = this.ctx;
    this.time += dt;
    this.artBudget = 1;
    this.player = game.player && game.player.alive ? game.player : null;

    this.updateCamera(game, alpha, dt, view);
    const simDt = dt * view.timeScale;
    this.fx.update(simDt);
    this.updateTexts(simDt);
    this.emitContinuous(game, alpha, simDt);

    const cam = this.camera;
    const z = cam.scale;
    const cx = cam.x - cam.sx / z, cy = cam.y - cam.sy / z;
    const { w, h, dpr } = this;
    const v = this.view;
    v.x0 = cx - w / 2 / z; v.x1 = cx + w / 2 / z;
    v.y0 = cy - h / 2 / z; v.y1 = cy + h / 2 / z;
    v.cx = cx; v.cy = cy; v.z = z;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, w, h);
    this.drawBackdrop(cx, cy, z);

    this.wa = dpr * z;
    this.wtx = dpr * (w / 2 - cx * z);
    this.wty = dpr * (h / 2 - cy * z);
    this.setWorld();

    this.drawGrid(z);
    this.drawBoundary(z);
    for (const hole of game.blackHoles) this.drawBlackHoleBack(hole, alpha, z);
    this.drawDust(game, alpha, z);
    this.drawWells(game, alpha, z);
    this.drawLooseDebris(game, alpha, z);
    this.drawBodies(game, alpha, z);
    this.drawOrbitersAndShots(game, alpha, z);
    for (const hole of game.blackHoles) this.drawBlackHoleFront(hole, alpha, z);
    this.fx.draw(ctx, z, v);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (view.labels) this.drawLabels(game, alpha, z, cx, cy);
    this.drawTexts(z, cx, cy);
    if (view.input) this.drawJoystick(view.input);
    this.prewarm(game);
  }

  setWorld() {
    this.ctx.setTransform(this.wa, 0, 0, this.wa, this.wtx, this.wty);
  }

  /** Setzt eine Transformation für ein einzelnes Objekt — ohne save()/restore(). */
  place(x, y, rot, scale = 1) {
    const k = this.wa * scale;
    const c = Math.cos(rot) * k, s = Math.sin(rot) * k;
    this.ctx.setTransform(c, s, -s, c, this.wtx + this.wa * x, this.wty + this.wa * y);
  }

  inView(x, y, r) {
    const v = this.view;
    return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
  }

  /** Wie verhält sich ein Körper zum Spieler? Entscheidet Farbe von Aura, Ring und Name. */
  relation(b) {
    const p = this.player;
    if (!p) return 'neutral';
    if (b === p) return 'self';
    if (canEat(b, p)) return 'threat';
    if (canEat(p, b)) return 'prey';
    return 'neutral';
  }

  /**
   * Textur eines Körpers für seine aktuelle Stufe. Fehlt sie noch, wird sie
   * gebaut — höchstens eine pro Frame (ein Planet kostet ~20 ms). Bis dahin
   * bleibt das Aussehen der vorigen Stufe stehen.
   */
  artFor(b) {
    let art = this.artCache.get(b.seed * 8 + b.stage);
    if (!art && this.artBudget > 0) {
      this.artBudget--;
      art = this.buildArt(b.seed, b.stage);
    }
    if (art) b.art = art;
    return b.art;
  }

  buildArt(seed, stage) {
    const art = buildBodyArt(seed, stage);
    this.artCache.set(seed * 8 + stage, art);
    if (this.artCache.size > 96) this.artCache.delete(this.artCache.keys().next().value);
    return art;
  }

  /**
   * Nutzt ein ungenutztes Frame-Budget, um Texturen vorab zu bauen: erst die
   * aktuelle Stufe aller Körper, dann die nächste Stufe, sobald ein Körper
   * kurz davor ist. So steht beim Evolutions-Moment alles bereit — kein Ruckler.
   */
  prewarm(game) {
    if (this.artBudget <= 0) return;
    const p = game.player && game.player.alive ? game.player : null;
    const list = p ? [p, ...game.bodies] : game.bodies;
    for (const b of list) {
      if (!b.alive) continue;
      for (let s = b.stage; s <= b.stage + 1 && s < STAGES.length; s++) {
        if (s > b.stage && b.mass < STAGES[s].min * 0.82) continue;
        if (this.artCache.has(b.seed * 8 + s)) continue;
        this.buildArt(b.seed, s);
        this.artBudget--;
        return;
      }
    }
  }

  // =====================================================================
  // Kamera
  // =====================================================================

  updateCamera(game, alpha, dt, view) {
    const cam = this.camera;
    const p = game.player;
    if (view.mode === 'play' && p && p.alive) {
      const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
      const tz = Camera.zoomFor(p.r, this.w, this.h) * (p.boosting ? 0.93 : 1) * this.zoomMul;
      cam.follow(x + p.vx * CAMERA.lead, y + p.vy * CAMERA.lead, tz, dt);
    } else if (view.mode === 'dead' && p) {
      // Kurz zeigen, wer einen gefressen hat
      const k = p.killer && p.killer.alive ? p.killer : p;
      cam.follow(k.x, k.y, Camera.zoomFor(Math.max(k.r, p.r), this.w, this.h) * 0.8, dt, 2.5, 1.2);
    } else {
      this.updateAttract(game, dt);
    }
    cam.update(dt);
  }

  /** Menü: Die Kamera begleitet abwechselnd einen interessanten Bot. */
  updateAttract(game, dt) {
    this.attractT -= dt;
    const a = this.attract;
    if (!a || !a.alive || this.attractT <= 0) {
      const pool = game.bodies.filter(b => b.alive && b.mass > 70 && b.mass < 1500);
      const list = pool.length ? pool : game.bodies.filter(b => b.alive);
      const next = list[Math.floor(random() * list.length)] || null;
      const first = !this.attract;
      this.attract = next;
      this.attractT = 14;
      if (next && first) this.camera.jump(next.x, next.y, Camera.zoomFor(next.r, this.w, this.h) * 0.55);
    }
    const b = this.attract;
    if (!b) return;
    const z = Camera.zoomFor(b.r, this.w, this.h) * 0.55;
    // Ziel leicht nach links versetzen: links liegt das Menü
    const offset = this.w > 760 ? (this.w * 0.16) / z : 0;
    this.camera.follow(b.x - offset, b.y, z, dt, 0.9, 0.6);
  }

  // =====================================================================
  // Hintergrund
  // =====================================================================

  drawBackdrop(cx, cy, z) {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const k = Math.sqrt(z);

    // Nebel — sehr langsame Parallaxe, stark vergrößert (weich)
    {
      const s = 4.6;
      const ox = w / 2 - cx * 0.025 * k, oy = h / 2 - cy * 0.025 * k;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      ctx.globalAlpha = 0.42;
      ctx.fillStyle = this.nebula;
      ctx.fillRect(-ox / s, -oy / s, w / s, h / s);
    }

    // Drei Sternebenen: je näher, desto schneller und desto mehr Zoom
    ctx.globalAlpha = 1;
    for (const L of this.starLayers) {
      const s = Math.pow(z, L.factor);
      const tile = 1024 * s;
      let ox = (w / 2 - cx * L.factor * k) % tile;
      let oy = (h / 2 - cy * L.factor * k) % tile;
      if (ox > 0) ox -= tile;
      if (oy > 0) oy -= tile;
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
      ctx.fillStyle = L.pattern;
      ctx.fillRect(0, 0, (w - ox) / s + 2, (h - oy) / s + 2);
    }

    // Einzelne helle Sterne mit Beugungsspikes (wie auf Teleskopaufnahmen)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const f = 0.16 * k, P = 3000;
    for (const st of this.heroStars) {
      let x = (st.x - cx * f) % P, y = (st.y - cy * f) % P;
      if (x < 0) x += P;
      if (y < 0) y += P;
      if (x > w + 20 || y > h + 20) continue;
      const tw = 0.65 + 0.35 * Math.sin(this.time * 1.3 + st.ph);
      const len = 7 + 9 * st.s * tw;
      ctx.globalAlpha = 0.55 * tw;
      ctx.drawImage(glowSprite(st.col, 32), x - 5 * st.s, y - 5 * st.s, 10 * st.s, 10 * st.s);
      ctx.strokeStyle = st.col;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.35 * tw;
      ctx.beginPath();
      ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Polares Koordinatennetz — die Arena als Sternkarte. */
  drawGrid(z) {
    const ctx = this.ctx, v = this.view, px = 1 / z;
    const R = WORLD.radius;
    const halfDiag = Math.hypot(v.x1 - v.x0, v.y1 - v.y0) / 2;
    const dc = Math.hypot(v.cx, v.cy);
    ctx.lineWidth = px;
    ctx.strokeStyle = 'rgba(236,230,214,0.05)';
    ctx.beginPath();
    for (let r = 1000; r < R; r += 1000) {
      if (Math.abs(dc - r) > halfDiag) continue;
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, TAU);
    }
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, c = Math.cos(a), s = Math.sin(a);
      ctx.moveTo(c * 260, s * 260);
      ctx.lineTo(c * R, s * R);
    }
    ctx.stroke();

    // Ringbeschriftung (nur wenn gut lesbar)
    if (z > 0.18) {
      ctx.fillStyle = 'rgba(236,230,214,0.16)';
      ctx.font = `${10 * px}px ${FONT_MONO}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (let r = 1000; r < R; r += 1000) {
        for (const a of [-Math.PI / 4, (3 * Math.PI) / 4]) {
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (!this.inView(x, y, 60 * px)) continue;
          ctx.fillText(`${fmt(r)} AE`, x + 6 * px, y - 4 * px);
        }
      }
    }
  }

  /** Arenarand: Leuchtring, Gradskala, schraffierter Außenbereich. */
  drawBoundary(z) {
    const ctx = this.ctx, v = this.view, R = WORLD.radius, px = 1 / z;
    const fx = Math.max(Math.abs(v.x0), Math.abs(v.x1)), fy = Math.max(Math.abs(v.y0), Math.abs(v.y1));
    if (Math.hypot(fx, fy) < R - 40 * px) return;     // Rand liegt komplett außerhalb des Bildes

    ctx.beginPath();
    ctx.rect(v.x0 - 50 * px, v.y0 - 50 * px, v.x1 - v.x0 + 100 * px, v.y1 - v.y0 + 100 * px);
    ctx.arc(0, 0, R, 0, TAU, true);
    ctx.fillStyle = 'rgba(2,3,6,0.62)';
    ctx.fill();
    if (this.hatch.setTransform) this.hatch.setTransform(new DOMMatrix([px, 0, 0, px, 0, 0]));
    ctx.fillStyle = this.hatch;
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    for (const [lw, a] of [[26, 0.035], [10, 0.07], [3.5, 0.2]]) {
      ctx.lineWidth = lw * px;
      ctx.strokeStyle = rgba(PALETTE.teal, a);
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = 'rgba(214,244,244,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.stroke();

    // Gradskala nach innen
    const step = R * (TAU / 360) * z > 4 ? 1 : 5;
    ctx.strokeStyle = 'rgba(214,244,244,0.5)';
    ctx.lineWidth = px;
    ctx.beginPath();
    for (let d = 0; d < 360; d += step) {
      const a = (d / 180) * Math.PI - Math.PI / 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      if (!this.inView(x, y, 40 * px)) continue;
      const len = (d % 10 === 0 ? 22 : d % 5 === 0 ? 12 : 6) * px;
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(a) * len, y - Math.sin(a) * len);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(214,244,244,0.55)';
    ctx.font = `${10 * px}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 10) {
      const a = (d / 180) * Math.PI - Math.PI / 2;
      const x = Math.cos(a) * (R - 40 * px), y = Math.sin(a) * (R - 40 * px);
      if (!this.inView(x, y, 30 * px)) continue;
      ctx.fillText(`${String(d).padStart(3, '0')}°`, x, y);
    }
  }

  // =====================================================================
  // Welt
  // =====================================================================

  drawDust(game, alpha, z) {
    const ctx = this.ctx, v = this.view, t = this.time;
    const minS = 3.4 / z;
    ctx.globalCompositeOperation = 'lighter';
    for (const d of game.debris) {
      if (d.kind !== KIND.DUST) continue;
      const x = d.px + (d.x - d.px) * alpha, y = d.py + (d.y - d.py) * alpha;
      if (x < v.x0 - 12 || x > v.x1 + 12 || y < v.y0 - 12 || y > v.y1 + 12) continue;
      let s = Math.max(d.r * 2.3, minS) * (0.9 + 0.1 * Math.sin(t * 3.1 + d.variant * 2.3));
      let a = 0.8 + 0.2 * Math.sin(t * 2.6 + d.variant * 1.9 + d.x * 0.01);
      if (d.age < DUST.fadeIn) {
        const f = d.age / DUST.fadeIn;
        a *= f;
        s *= 0.4 + 0.6 * f;
      }
      ctx.globalAlpha = a;
      ctx.drawImage(this.dustSprites[d.color], x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Gravitationsradius als Haarlinie + farbige Aura (rot = Gefahr, grün = Beute). */
  drawWells(game, alpha, z) {
    const ctx = this.ctx, px = 1 / z;
    for (const b of game.bodies) {
      if (!b.alive) continue;
      const x = lerp(b.px, b.x, alpha), y = lerp(b.py, b.y, alpha);
      const Rg = gravityRadius(b);
      if (!this.inView(x, y, Rg + 4 * px)) continue;
      const rel = this.relation(b);
      const fade = b.spawnT;

      if (rel === 'threat' || rel === 'prey') {
        // Saum direkt am Rand (Sprite-Innenradius 0.55 → s = r / 0.55), Gefahr pulsiert
        const pulse = rel === 'threat' ? 0.8 + 0.2 * Math.sin(this.time * 5 + b.id) : 1;
        const s = (b.r + 1.5 / z) / 0.55;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (rel === 'threat' ? 0.85 : 0.6) * pulse * fade;
        ctx.drawImage(auraSprite(COLOR[rel]), x - s, y - s, s * 2, s * 2);
        ctx.globalCompositeOperation = 'source-over';
      }

      const ringA = { self: 0.34, threat: 0.32, prey: 0.24, neutral: 0.08 }[rel];
      ctx.globalAlpha = ringA * fade;
      ctx.strokeStyle = COLOR[rel];
      ctx.lineWidth = px;
      if (rel === 'self') {
        // Spieler: Ring mit wandernden Teilstrichen, wie eine Messskala
        ctx.beginPath();
        ctx.arc(x, y, Rg, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        const n = 36, rot = this.time * 0.15 * b.spinDir;
        for (let i = 0; i < n; i++) {
          const a = rot + (i / n) * TAU, len = (i % 3 === 0 ? 7 : 3.5) * px;
          ctx.moveTo(x + Math.cos(a) * Rg, y + Math.sin(a) * Rg);
          ctx.lineTo(x + Math.cos(a) * (Rg - len), y + Math.sin(a) * (Rg - len));
        }
        ctx.stroke();
      } else {
        // Nicht nur Farbe: Gefahr = durchgezogen, Beute = gestrichelt, neutral = gepunktet
        if (rel === 'prey') ctx.setLineDash([10 * px, 6 * px]);
        else if (rel === 'neutral') ctx.setLineDash([3 * px, 7 * px]);
        if (rel === 'threat') ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.arc(x, y, Rg, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawLooseDebris(game, alpha, z) {
    const ctx = this.ctx;
    for (const d of game.debris) {
      if (d.kind === KIND.DUST || d.state === STATE.ORBIT || d.state === STATE.PROJECTILE) continue;
      const x = d.px + (d.x - d.px) * alpha, y = d.py + (d.y - d.py) * alpha;
      if (d.kind === KIND.COMET) {
        if (this.inView(x, y, 300)) this.drawComet(d, x, y, z);
        continue;
      }
      if (!this.inView(x, y, d.r * 1.5)) continue;
      const s = d.state === STATE.CONSUMED ? 1 - easeInCubic(Math.min(1, d.consumeT)) : 1;
      const rot = d.pAngle + (d.angle - d.pAngle) * alpha;
      this.place(x, y, rot, s);
      const hs = d.r * 1.2;
      ctx.drawImage(this.asteroidSprites[d.variant], -hs, -hs, hs * 2, hs * 2);
    }
    this.setWorld();
  }

  drawComet(d, x, y, z) {
    const ctx = this.ctx;
    const sp = Math.hypot(d.vx, d.vy) || 1;
    const dx = -d.vx / sp, dy = -d.vy / sp;
    const len = 80 + sp * 0.34;
    const wh = d.r * 1.6;
    ctx.globalCompositeOperation = 'lighter';

    // Ionenschweif: gerade, kühl
    let g = ctx.createLinearGradient(x, y, x + dx * len, y + dy * len);
    g.addColorStop(0, 'rgba(150,225,255,0.6)');
    g.addColorStop(1, 'rgba(150,225,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - dy * wh, y + dx * wh);
    ctx.lineTo(x + dx * len, y + dy * len);
    ctx.lineTo(x + dy * wh, y - dx * wh);
    ctx.fill();

    // Staubschweif: breiter, warm, leicht gekrümmt
    const l2 = len * 0.7, bend = (d.color ? 1 : -1) * l2 * 0.22;
    g = ctx.createLinearGradient(x, y, x + dx * l2, y + dy * l2);
    g.addColorStop(0, 'rgba(255,215,160,0.35)');
    g.addColorStop(1, 'rgba(255,215,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - dy * wh * 1.2, y + dx * wh * 1.2);
    ctx.quadraticCurveTo(x + dx * l2 * 0.5 - dy * bend, y + dy * l2 * 0.5 + dx * bend, x + dx * l2 - dy * bend * 1.6, y + dy * l2 + dx * bend * 1.6);
    ctx.lineTo(x + dy * wh * 1.2, y - dx * wh * 1.2);
    ctx.fill();

    const s = d.r * 5;
    ctx.drawImage(glowSprite('#bfefff'), x - s, y - s, s * 2, s * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, d.r * 0.75, 0, TAU);
    ctx.fill();
  }

  drawBodies(game, alpha, z) {
    const ctx = this.ctx, px = 1 / z;
    const list = this.sorted;
    list.length = 0;
    for (const b of game.bodies) {
      if (b.removed || (!b.alive && b.cause === 'shot')) continue;
      list.push(b);
    }
    list.sort((a, b) => a.mass - b.mass);

    for (const b of list) {
      const x = lerp(b.px, b.x, alpha), y = lerp(b.py, b.y, alpha);
      if (!this.inView(x, y, b.r * ((b.art && b.art.reach) || 3.4))) continue;
      let scale = 1 + b.pulse * 0.07;
      let stretch = 0;
      if (!b.alive) {
        const t = Math.min(1, b.consumeT);
        scale *= 1 - easeInCubic(t);
        if (b.cause === 'blackhole') stretch = t;
      } else if (b.spawnT < 1) {
        scale *= Math.max(0.01, easeOutBack(b.spawnT));
      }
      if (scale <= 0.02) continue;
      const r = b.r * scale;
      const rot = lerp(b.pAngle, b.angle, alpha);
      const art = this.artFor(b);

      if (stretch > 0 && b.consumer) {
        // Spaghettifizierung: in Richtung Loch gestreckt
        const a = Math.atan2(b.consumer.y - y, b.consumer.x - x);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.scale(1 + stretch * 1.8, 1 - stretch * 0.6);
        ctx.rotate(-a);
        this.drawBody(ctx, art, 0, 0, r, rot, this.shade, z, b.surface);
        ctx.restore();
      } else {
        this.drawBody(ctx, art, x, y, r, rot, this.shade, z, b.surface);
      }

      if (!b.alive) continue;

      // Treffer-Blitz
      if (b.hitFlash > 0.02) {
        const s = r * 1.5;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = b.hitFlash * 0.7;
        ctx.drawImage(glowSprite(b.isPlayer ? PALETTE.threat : '#ffffff'), x - s, y - s, s * 2, s * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      // Spawn-Schild: gestrichelter, rotierender Ring
      if (b.shield > 0) {
        ctx.globalAlpha = Math.min(1, b.shield) * 0.85;
        ctx.strokeStyle = PALETTE.amber;
        ctx.lineWidth = 1.5 * px;
        ctx.setLineDash([5 * px, 5 * px]);
        ctx.lineDashOffset = -this.time * 30 * px;
        ctx.beginPath();
        ctx.arc(x, y, r + 7 * px, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // Schleuder-Ladung
      if (b.slingCharge > 0) {
        const col = b.isPlayer ? PALETTE.amber : PALETTE.paper;
        const rr = r + 11 * px;
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.18;
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.95;
        ctx.beginPath();
        ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + b.slingCharge * TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * Zeichnet einen Himmelskörper. Wird auch für die Stufen-Vorschau im
   * Startbildschirm verwendet (eigener Kontext, eigener Schattierungsverlauf).
   */
  drawBody(ctx, art, x, y, r, rot, shade, z, phase0 = 0) {
    if (!art) {
      ctx.fillStyle = '#4a4640';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      return;
    }
    switch (art.kind) {
      case 'rock': this.drawRock(ctx, art, x, y, r, rot, shade); return;
      case 'pulsar': this.drawPulsar(ctx, art, x, y, r, z, phase0); return;
      case 'hole':
      case 'quasar': this.drawHoleBody(ctx, art, x, y, r, z); return;
      case 'galaxy': this.drawGalaxy(ctx, art, x, y, r); return;
    }

    const t = this.time;
    const slices = clamp(Math.round((r * z) / 5), 1, 16);
    const ov = 0.7 / z;

    // Schein hinter dem Körper (Lava, Glut)
    if (art.glow) {
      const s = r * art.glowSize;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = art.glowAlpha * (0.85 + 0.15 * Math.sin(t * 1.7 + art.flare));
      ctx.drawImage(glowSprite(art.glow, 128), x - s, y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (art.kind === 'star') this.drawCorona(ctx, art, x, y, r);
    if (art.ring) this.drawRingHalf(ctx, art.ring, x, y, r, false);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    const phase = phase0 + t * art.rate;
    drawSphere(ctx, art.surface, x, y, r, phase, slices, ov);
    if (art.clouds) drawSphere(ctx, art.clouds, x, y, r, phase * (art.cloudRate || 1.35) + 0.37, slices, 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r, r);
    if (art.kind === 'star') {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,0.22)');
      g.addColorStop(0.62, 'rgba(255,255,255,0)');
      g.addColorStop(1, rgba(art.edge, 0.7));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = shade;
    }
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    // Leuchtschicht nach der Schattierung: Lava glüht auch auf der Nachtseite
    if (art.emissive) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.78 + 0.22 * Math.sin(t * 2.3 + art.flare);
      drawSphere(ctx, art.emissive, x, y, r, phase, slices, 0);
    }
    ctx.restore();

    if (art.atmo) {
      // Atmosphäre: dünner, leuchtender Saum
      const outer = art.atmoSize || 1.13;
      const g = ctx.createRadialGradient(x, y, r * 0.94, x, y, r * outer);
      g.addColorStop(0, rgba(art.atmo, 0));
      g.addColorStop(0.3, rgba(art.atmo, 0.38));
      g.addColorStop(1, rgba(art.atmo, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * outer, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (art.kind === 'star') {
      const s = r * 1.2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(glowSprite(art.core, 128), x - s, y - s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (art.ring) this.drawRingHalf(ctx, art.ring, x, y, r, true);
  }

  drawRock(ctx, art, x, y, r, rot, shade) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    const s = art.shape;
    ctx.moveTo(s[0] * r, s[1] * r);
    for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i] * r, s[i + 1] * r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(art.surface, -r * 1.05, -r * 1.05, r * 2.1, r * 2.1);
    ctx.rotate(-rot);
    ctx.scale(r, r);
    ctx.fillStyle = shade;
    ctx.fillRect(-1.2, -1.2, 2.4, 2.4);
    ctx.restore();
  }

  /** Korona und Strahlen eines Sterns — Größe und Strahlenzahl je Sterntyp. */
  drawCorona(ctx, art, x, y, r) {
    const t = this.time;
    const pulse = 1 + 0.05 * Math.sin(t * 2 + art.flare);
    ctx.globalCompositeOperation = 'lighter';
    let s = r * art.coronaMul * pulse;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glowSprite(art.corona, 128), x - s, y - s, s * 2, s * 2);
    s = r * 1.75;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(glowSprite(art.corona, 128), x - s, y - s, s * 2, s * 2);
    if (art.rays > 0) {
      const n = art.rays;
      const reach = 1.35 + (art.coronaMul - 3.4) * 0.25;
      ctx.globalAlpha = art.rayAlpha;
      ctx.fillStyle = art.corona;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = art.flare + t * 0.03 + (i / n) * TAU;
        const len = r * (reach + 0.9 * valueNoise(t * 0.5 + i * 3.1, i, 5));
        const wdt = 0.045;
        ctx.moveTo(x + Math.cos(a - wdt) * r * 0.9, y + Math.sin(a - wdt) * r * 0.9);
        ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
        ctx.lineTo(x + Math.cos(a + wdt) * r * 0.9, y + Math.sin(a + wdt) * r * 0.9);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Pulsar: Magnetfeldlinien, gleißender Kern und zwei rotierende Lichtkegel. */
  drawPulsar(ctx, art, x, y, r, z, phase0) {
    const t = this.time;
    const a = art.axis + (t / art.period) * TAU;
    const ax = Math.cos(a), ay = Math.sin(a);
    const flash = Math.abs(Math.sin(a * 2)) ** 6;

    ctx.globalCompositeOperation = 'lighter';
    let s = r * (2.6 + flash);
    ctx.globalAlpha = 0.3 + flash * 0.25;
    ctx.drawImage(glowSprite(art.beam, 128), x - s, y - s, s * 2, s * 2);

    // Dipolfeld: Schleifen von Pol zu Pol auf beiden Seiten der Magnetachse
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = art.beam;
    ctx.lineWidth = Math.max(1.2 / z, r * 0.03);
    for (const k of [1.2, 1.9, 2.8]) {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x - ay * side * r * k * 0.8, y + ax * side * r * k * 0.8, r * k * 1.15, r * k * 0.85, a, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Kern
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.clip();
    drawSphere(ctx, art.surface, x, y, r, phase0 + t * art.rate, clamp(Math.round((r * z) / 5), 1, 16), 0.7 / z);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.7, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(120,170,255,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();

    // Lichtkegel entlang der Magnetachse
    ctx.globalCompositeOperation = 'lighter';
    const len = r * 7;
    for (const dir of [1, -1]) {
      const bx = ax * dir, by = ay * dir;
      const px = -by, py = bx;
      const grad = ctx.createLinearGradient(x, y, x + bx * len, y + by * len);
      grad.addColorStop(0, `rgba(230,245,255,${0.5 + flash * 0.3})`);
      grad.addColorStop(0.35, 'rgba(160,215,255,0.22)');
      grad.addColorStop(1, 'rgba(160,215,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(x + px * r * 0.25, y + py * r * 0.25);
      ctx.lineTo(x + bx * len + px * r * 0.9, y + by * len + py * r * 0.9);
      ctx.lineTo(x + bx * len - px * r * 0.9, y + by * len - py * r * 0.9);
      ctx.lineTo(x - px * r * 0.25, y - py * r * 0.25);
      ctx.fill();
    }
    s = r * 1.4;
    ctx.globalAlpha = 0.3 + flash * 0.35;
    ctx.drawImage(glowSprite('#ffffff', 64), x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Spieler als Schwarzes Loch (bzw. Quasar mit Jets): Schatten, Scheibe, Horizont, Photonenring. */
  drawHoleBody(ctx, art, x, y, r, z) {
    const t = this.time;
    const hr = r * 0.62;
    const spin = t * 0.7 * art.spinDir;
    const quasar = art.kind === 'quasar';

    const shadow = ctx.createRadialGradient(x, y, hr, x, y, hr * 4.5);
    shadow.addColorStop(0, 'rgba(0,0,0,0.85)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(x, y, hr * 4.5, 0, TAU);
    ctx.fill();

    this.diskHalf(ctx, x, y, hr * 3.4, art.rot, art.tilt, spin, quasar ? 1 : 0.85, false);
    if (quasar) this.drawJets(ctx, art, x, y, r, hr);

    // Halo vor dem Horizont zeichnen: Ein radialer Verlauf füllt auch das Innere
    // seines Startkreises — der schwarze Horizont muss danach darüber.
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y, hr * 0.98, x, y, hr * 1.75);
    halo.addColorStop(0, quasar ? 'rgba(220,240,255,0.85)' : 'rgba(255,214,160,0.75)');
    halo.addColorStop(0.18, quasar ? 'rgba(140,190,255,0.35)' : 'rgba(255,150,70,0.32)');
    halo.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, hr * 1.75, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, hr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,236,205,0.9)';
    ctx.lineWidth = Math.max(1.5 / z, hr * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, hr * 1.02, 0, TAU);
    ctx.stroke();

    this.diskHalf(ctx, x, y, hr * 3.4, art.rot, art.tilt, spin, 1, true);
  }

  /** Relativistische Jets eines Quasars — senkrecht zur Scheibe, flackernd. */
  drawJets(ctx, art, x, y, r, hr) {
    const flicker = 0.8 + 0.2 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3);
    const len = r * 8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(art.rot);
    ctx.globalCompositeOperation = 'lighter';
    for (const side of [-1, 1]) {
      const g = ctx.createLinearGradient(0, side * hr * 0.4, 0, side * len);
      g.addColorStop(0, `rgba(235,245,255,${0.95 * flicker})`);
      g.addColorStop(0.25, `rgba(150,200,255,${0.5 * flicker})`);
      g.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-hr * 0.22, side * hr * 0.4);
      ctx.lineTo(-hr * 0.5, side * len);
      ctx.lineTo(hr * 0.5, side * len);
      ctx.lineTo(hr * 0.22, side * hr * 0.4);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.7 * flicker})`;
      ctx.beginPath();
      ctx.moveTo(-hr * 0.06, side * hr * 0.4);
      ctx.lineTo(0, side * len * 0.7);
      ctx.lineTo(hr * 0.06, side * hr * 0.4);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Galaxie: gekippte, langsam rotierende Spiralscheibe mit hellem Kern. */
  drawGalaxy(ctx, art, x, y, r) {
    const s = r * 1.6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(art.rot0);
    ctx.scale(1, art.tilt);
    ctx.rotate(this.time * art.spin);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(art.sprite, -s, -s, s * 2, s * 2);
    ctx.restore();
    const c = r * 0.55;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(glowSprite('#ffe8c0', 128), x - c, y - c, c * 2, c * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Eine Hälfte einer gekippten Akkretionsscheibe (hinten oder vorne). */
  diskHalf(ctx, x, y, R, rot, tilt, spin, alpha, front) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(1, tilt);
    ctx.beginPath();
    ctx.rect(-R, front ? 0 : -R, R * 2, R);
    ctx.clip();
    ctx.rotate(spin);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.bhDisk, -R, -R, R * 2, R * 2);
    ctx.restore();
  }

  /** Ringe: erst die hintere Hälfte, dann der Planet, dann die vordere. */
  drawRingHalf(ctx, ring, x, y, r, front) {
    const R = r * ring.outer;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ring.rot);
    ctx.scale(1, ring.tilt);
    ctx.beginPath();
    ctx.rect(-R, front ? 0 : -R, R * 2, R);
    ctx.clip();
    ctx.drawImage(ring.canvas, -R, -R, R * 2, R * 2);
    ctx.restore();
  }

  drawOrbitersAndShots(game, alpha, z) {
    const ctx = this.ctx, px = 1 / z;

    // Bahnen der eigenen Orbiter als feine Linien — der Spieler als kleines Planetarium
    const p = this.player;
    if (p && p.orbiters.length) {
      const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha);
      ctx.strokeStyle = PALETTE.amber;
      ctx.lineWidth = px;
      ctx.globalAlpha = 0.1 + p.slingCharge * 0.25;
      ctx.beginPath();
      for (const o of p.orbiters) {
        const ox = o.px + (o.x - o.px) * alpha, oy = o.py + (o.y - o.py) * alpha;
        const R = Math.hypot(ox - x, oy - y);
        ctx.moveTo(x + R, y);
        ctx.arc(x, y, R, 0, TAU);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (const d of game.debris) {
      if (d.state !== STATE.ORBIT && d.state !== STATE.PROJECTILE) continue;
      const x = d.px + (d.x - d.px) * alpha, y = d.py + (d.y - d.py) * alpha;
      if (!this.inView(x, y, 120)) continue;
      const owner = d.owner;
      if (d.state === STATE.PROJECTILE) {
        let col = PALETTE.paper;
        if (owner && owner.isPlayer) col = PALETTE.amber;
        else if (this.player && owner) {
          // fliegt auf mich zu? dann rot
          const tx = this.player.x - x, ty = this.player.y - y;
          if (tx * d.vx + ty * d.vy > 0) col = PALETTE.threat;
        }
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = col;
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(d.r * 0.9, 2 * px);
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.moveTo(x - d.vx * 0.06, y - d.vy * 0.06);
        ctx.lineTo(x, y);
        ctx.stroke();
        const g = d.r * 3;
        ctx.globalAlpha = 0.6;
        ctx.drawImage(glowSprite(col), x - g, y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      } else if (owner && owner.slingCharge > 0) {
        const g = d.r * (2 + owner.slingCharge * 2);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25 + owner.slingCharge * 0.4;
        ctx.drawImage(glowSprite(owner.isPlayer ? PALETTE.amber : PALETTE.paper), x - g, y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      const rot = d.pAngle + (d.angle - d.pAngle) * alpha;
      const s = d.orbitBlend < 1 ? 0.8 + 0.2 * d.orbitBlend : 1;
      this.place(x, y, rot, s);
      const hs = d.r * 1.2;
      ctx.drawImage(this.asteroidSprites[d.variant], -hs, -hs, hs * 2, hs * 2);
      this.setWorld();
    }
  }

  drawBlackHoleBack(h, alpha, z) {
    const ctx = this.ctx, px = 1 / z;
    const x = lerp(h.px, h.x, alpha), y = lerp(h.py, h.y, alpha);
    if (!this.inView(x, y, h.pullR)) return;
    const s = h.strength;
    const r = h.r * (0.25 + 0.75 * s);

    // Gefahrenzone: rot gestrichelter Sogradius
    ctx.globalAlpha = 0.22 * s;
    ctx.strokeStyle = PALETTE.threat;
    ctx.lineWidth = px;
    ctx.setLineDash([8 * px, 10 * px]);
    ctx.lineDashOffset = this.time * 24 * px;
    ctx.beginPath();
    ctx.arc(x, y, h.pullR, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Gravitationslinse: der Hintergrund dunkelt zur Mitte hin ab
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(x, y, r, x, y, r * 6);
    g.addColorStop(0, `rgba(0,0,0,${0.9 * s})`);
    g.addColorStop(0.4, `rgba(0,0,0,${0.45 * s})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 6, 0, TAU);
    ctx.fill();

    this.drawDisk(h, x, y, r, false);
  }

  drawBlackHoleFront(h, alpha, z) {
    const ctx = this.ctx, px = 1 / z;
    const x = lerp(h.px, h.x, alpha), y = lerp(h.py, h.y, alpha);
    if (!this.inView(x, y, h.r * 4)) return;
    const s = h.strength;
    const flicker = h.age > h.life - BLACK_HOLE.collapseTime ? 0.7 + 0.3 * Math.sin(this.time * 40) : 1;
    const r = h.r * (0.25 + 0.75 * s);

    // Halo des gekrümmten Lichts rund um den Schatten
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, r * 0.98, x, y, r * 1.75);
    g.addColorStop(0, `rgba(255,214,160,${0.75 * s * flicker})`);
    g.addColorStop(0.18, `rgba(255,150,70,${0.32 * s * flicker})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.75, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Ereignishorizont
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,236,205,${0.9 * s})`;
    ctx.lineWidth = Math.max(1.5 * px, r * 0.04);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.02, 0, TAU);
    ctx.stroke();

    this.drawDisk(h, x, y, r, true);
  }

  /** Akkretionsscheibe eines Gefahren-Lochs, gekippt; rotiert in der gestauchten Ebene. */
  drawDisk(h, x, y, r, front) {
    this.diskHalf(this.ctx, x, y, r * 3.3, -0.32 + (h.r0 % 1) * 0.3, 0.3, h.spin * 0.7, h.strength * (front ? 1 : 0.8), front);
  }

  // =====================================================================
  // Bildschirm-Ebene
  // =====================================================================

  drawLabels(game, alpha, z, cx, cy) {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    for (const b of game.bodies) {
      if (!b.alive || b.spawnT < 0.6) continue;
      const sr = b.r * z;
      if (sr < RENDER.nameMinScreenR && !b.isPlayer) continue;
      const sx = (lerp(b.px, b.x, alpha) - cx) * z + w / 2;
      const sy = (lerp(b.py, b.y, alpha) - cy) * z + h / 2;
      if (sx < -150 || sx > w + 150 || sy < -60 || sy > h + 60) continue;
      const rel = this.relation(b);
      const name = b.upperName || (b.upperName = b.name.toLocaleUpperCase('de-DE'));
      const y0 = sy + sr * ((b.art && b.art.extent) || 1) + 8;
      ctx.font = `600 11px ${FONT_DISPLAY}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,7,11,0.8)';
      ctx.strokeText(name, sx, y0);
      ctx.fillStyle = LABEL[rel];
      ctx.fillText(name, sx, y0);
      if (!b.isPlayer) {
        ctx.font = `500 10px ${FONT_MONO}`;
        const m = fmt(b.mass);
        ctx.strokeText(m, sx, y0 + 14);
        ctx.fillStyle = 'rgba(236,230,214,0.45)';
        ctx.fillText(m, sx, y0 + 14);
      }
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  /** Schwebende Zahlen ("+24") — in Bildschirmpixeln, damit sie immer gleich groß sind. */
  floatText(x, y, text, color, size = 16) {
    if (this.texts.length > 24) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: 1.1, max: 1.1 });
  }

  updateTexts(dt) {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  drawTexts(z, cx, cy) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = 1 - t.life / t.max;
      const sx = (t.x - cx) * z + this.w / 2;
      const sy = (t.y - cy) * z + this.h / 2 - 18 - k * 34;
      const pop = k < 0.12 ? 0.7 + (k / 0.12) * 0.4 : 1.1 - Math.min(0.1, (k - 0.12));
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `700 ${Math.round(t.size * pop)}px ${FONT_DISPLAY}`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,7,11,0.7)';
      ctx.strokeText(t.text, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  drawJoystick(input) {
    const s = input.stick;
    if (!s.active) return;
    const ctx = this.ctx;
    const dx = s.x - s.ox, dy = s.y - s.oy;
    const len = Math.hypot(dx, dy);
    const max = input.stickRadius;
    const k = len > max ? max / len : 1;
    ctx.strokeStyle = 'rgba(236,230,214,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.ox, s.oy, max, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba(PALETTE.amber, 0.4);
    ctx.beginPath();
    ctx.arc(s.ox + dx * k, s.oy + dy * k, 20, 0, TAU);
    ctx.fill();
  }

  // =====================================================================
  // Effekte
  // =====================================================================

  near(x, y, m = 200) {
    return this.inView(x, y, m);
  }

  /** Effekte, die nicht an Ereignisse gebunden sind: Boost-Spur, entstehende Schwarze Löcher. */
  emitContinuous(game, alpha, dt) {
    if (dt <= 0) return;
    const fx = this.fx;
    this.trailAcc += dt * 50;
    const n = Math.floor(this.trailAcc);
    this.trailAcc -= n;
    if (n > 0) {
      for (const b of game.bodies) {
        if (!b.alive || !b.boosting || !this.near(b.x, b.y, b.r * 2)) continue;
        const col = b.isPlayer ? PALETTE.amber : (b.art && b.art.tint) || PALETTE.paper;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(-b.dirY, -b.dirX) + (random() - 0.5) * 0.9;
          const bx = b.x + Math.cos(a) * b.r * 0.9, by = b.y + Math.sin(a) * b.r * 0.9;
          const p = fx.spawn(PT.GLOW, bx, by, Math.cos(a) * 60, Math.sin(a) * 60, 0.55, b.r * 0.3, col, glowSprite(col));
          p.alpha = 0.55;
        }
      }
    }
    for (const h of game.blackHoles) {
      if (!this.near(h.x, h.y, h.pullR)) continue;
      const forming = h.age < BLACK_HOLE.formTime;
      if (random() < dt * (forming ? 40 : 8)) {
        const a = random() * TAU, d = h.r * (forming ? 6 : 3.5);
        const sx = h.x + Math.cos(a) * d, sy = h.y + Math.sin(a) * d;
        const sp = forming ? 380 : 160;
        const p = fx.spawn(PT.SPARK, sx, sy, -Math.cos(a) * sp + -Math.sin(a) * sp * 0.6, -Math.sin(a) * sp + Math.cos(a) * sp * 0.6, 0.6, 1.6, forming ? '#ffd9a8' : '#ff9a4a');
        p.drag = 0.4;
      }
    }
  }

  bind(ev) {
    ev.on('eat', e => {
      if (!this.near(e.x, e.y)) return;
      const b = e.eater;
      if (e.kind === KIND.DUST) {
        if (!b.isPlayer) return;
        const col = PALETTE.dust[e.color];
        const p = this.fx.spawn(PT.GLOW, e.x, e.y, (b.x - e.x) * 2, (b.y - e.y) * 2, 0.25, 6, col, glowSprite(col));
        p.alpha = 0.8;
        return;
      }
      const col = e.kind === KIND.COMET ? '#bfefff' : '#e9dccb';
      this.fx.burst(e.x, e.y, e.kind === KIND.COMET ? 20 : 8, 60, e.kind === KIND.COMET ? 340 : 180, 0.45, 1.6, col);
      this.fx.ring(e.x, e.y, 4, e.kind === KIND.COMET ? 70 : 30, 0.5, col, 0.8);
      if (b.isPlayer && e.gain >= 4) this.floatText(e.x, e.y, `+${Math.round(e.gain)}`, e.kind === KIND.COMET ? '#bfefff' : '#ffc773', e.kind === KIND.COMET ? 20 : 15);
    });

    ev.on('eatBody', e => {
      const v = e.victim, b = e.eater;
      if (!this.near(v.x, v.y, v.r * 3)) return;
      const tint = (v.art && v.art.tint) || PALETTE.paper;
      this.fx.ring(v.x, v.y, v.r, v.r * 3 + 40, 0.7, tint, 0.9);
      this.fx.burst(v.x, v.y, 26, 80, 320 + v.r * 2, 0.6, 2, tint);
      if (b.isPlayer) {
        this.floatText(v.x, v.y, `+${fmt(e.gain)}`, '#ffc773', 22);
        this.camera.shake(0.22 + Math.min(0.35, v.mass / b.mass));
      } else if (this.player) {
        this.camera.shake(0.12 * this.proximity(v.x, v.y));
      }
    });

    ev.on('death', e => {
      const b = e.body;
      if (!this.near(b.x, b.y, b.r * 4)) return;
      const tint = (b.art && b.art.tint) || PALETTE.paper;
      if (e.cause === 'shot') {
        this.fx.burst(b.x, b.y, 50, 120, 420 + b.r * 3, 0.9, 2.2, tint);
        this.fx.burst(b.x, b.y, 18, 60, 200, 1.1, 2.6, '#fff1d6');
        this.fx.ring(b.x, b.y, b.r, b.r * 4 + 80, 0.9, '#fff1d6', 1);
        for (let i = 0; i < 8; i++) {
          const a = random() * TAU, s = 80 + random() * 260;
          const c = this.fx.spawn(PT.CHUNK, b.x, b.y, Math.cos(a) * s, Math.sin(a) * s, 1.4, b.r * (0.12 + random() * 0.12), '', this.asteroidSprites[i % this.asteroidSprites.length]);
          c.vr = (random() - 0.5) * 8;
          c.drag = 1.2;
        }
        this.camera.shake(b.isPlayer ? 0.9 : 0.4 * this.proximity(b.x, b.y));
      } else if (e.cause === 'blackhole') {
        this.fx.burst(b.x, b.y, 30, 40, 200, 0.8, 1.8, '#ffb070');
        if (e.hole) this.fx.ring(e.hole.x, e.hole.y, e.hole.r * 4, e.hole.r, 0.8, '#ffd9a8', 0.9);
        this.camera.shake(b.isPlayer ? 0.8 : 0.25 * this.proximity(b.x, b.y));
      }
      if (b.isPlayer) {
        this.fx.ring(b.x, b.y, b.r, b.r * 6 + 200, 1.2, '#ffffff', 1);
        this.fx.burst(b.x, b.y, 60, 100, 500, 1.2, 2.4, PALETTE.amber);
      }
    });

    ev.on('evolve', e => {
      const b = e.body;
      if (!this.near(b.x, b.y, b.r * 3)) return;
      const col = b.isPlayer ? PALETTE.amber : PALETTE.paper;
      this.fx.ring(b.x, b.y, b.r, b.r * 3.5 + 60, 1, col, 1);
      this.fx.ring(b.x, b.y, b.r, b.r * 2.2 + 30, 0.7, '#ffffff', 0.7);
      this.fx.burst(b.x, b.y, b.isPlayer ? 40 : 14, 100, 380, 0.9, 2, col);
      if (b.isPlayer) {
        this.camera.kick(0.07);
        this.camera.shake(0.3);
      }
    });

    ev.on('hit', e => {
      if (!this.near(e.x, e.y)) return;
      const t = e.target;
      const tint = (t.art && t.art.tint) || PALETTE.paper;
      this.fx.burst(e.x, e.y, 12, 80, 300, 0.45, 1.8, tint);
      this.fx.ring(e.x, e.y, 3, 26 + t.r * 0.4, 0.4, '#ffffff', 0.7);
      if (t.isPlayer) {
        this.camera.shake(0.32);
        this.floatText(e.x, e.y, `−${Math.round(e.damage)}`, LABEL.threat, 16);
      } else if (e.owner && e.owner.isPlayer) {
        this.camera.shake(0.07);
        this.floatText(e.x, e.y, `−${Math.round(e.damage)}`, PALETTE.paper, 14);
      }
    });

    ev.on('shieldHit', e => {
      if (this.near(e.x, e.y)) this.fx.ring(e.x, e.y, 4, 30, 0.4, PALETTE.amber, 0.8);
    });

    ev.on('bump', e => {
      if (!this.near(e.x, e.y)) return;
      this.fx.burst(e.x, e.y, 6, 40, 160 + e.speed * 0.4, 0.35, 1.4, '#e9dccb');
      if (e.a.isPlayer || e.b.isPlayer) this.camera.shake(Math.min(0.25, e.speed / 900));
    });

    ev.on('capture', e => {
      if (e.body.isPlayer) this.fx.ring(e.debris.x, e.debris.y, 2, 20, 0.45, PALETTE.amber, 0.8);
    });

    ev.on('shot', e => {
      const d = e.debris;
      if (this.near(d.x, d.y)) {
        this.fx.burst(d.x, d.y, 3, 40, 160, 0.25, 1.4, e.body.isPlayer ? PALETTE.amber : PALETTE.paper);
      }
    });

    ev.on('slingRelease', e => {
      if (e.body.isPlayer) this.camera.shake(0.08 + e.power * 0.12);
    });

    ev.on('bhSpawn', h => {
      if (this.near(h.x, h.y, h.pullR)) this.fx.ring(h.x, h.y, h.pullR * 0.6, h.r, 1.2, '#ffd9a8', 0.8);
    });

    ev.on('bhCollapse', h => {
      if (!this.near(h.x, h.y, h.pullR)) return;
      this.fx.ring(h.x, h.y, h.r, h.pullR * 0.8, 1.4, '#ffe6c4', 1);
      this.fx.ring(h.x, h.y, h.r, h.pullR * 0.4, 0.9, '#ffffff', 1);
      this.fx.burst(h.x, h.y, 60, 120, 600, 1.2, 2.2, '#ffcf9a');
      this.camera.shake(0.4 * this.proximity(h.x, h.y));
    });

    ev.on('bhDrain', e => {
      if (random() > 0.35 || !this.near(e.body.x, e.body.y)) return;
      const b = e.body, h = e.hole;
      const a = Math.atan2(h.y - b.y, h.x - b.x) + (random() - 0.5) * 0.8;
      const sx = b.x + Math.cos(a) * b.r, sy = b.y + Math.sin(a) * b.r;
      this.fx.spawn(PT.SPARK, sx, sy, (h.x - sx) * 2.4, (h.y - sy) * 2.4, 0.4, 2, '#ffb070');
    });
  }

  /** 1 direkt beim Spieler, 0 am Bildrand oder weiter weg. */
  proximity(x, y) {
    const p = this.player;
    if (!p) return 0;
    const v = this.view;
    const half = Math.max(v.x1 - v.x0, v.y1 - v.y0) / 2;
    return clamp(1 - Math.hypot(x - p.x, y - p.y) / half, 0, 1);
  }

  // =====================================================================
  // Vorschau-Bilder für den Startbildschirm
  // =====================================================================

  stageThumbnail(stage, size, seed = 4242) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = makeCanvas(size * dpr, size * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const art = buildBodyArt(seed + stage, stage);
    const r = size * (art.thumb || 0.34);
    this.drawBody(ctx, art, size / 2, size / 2, r, 0.4, makeShade(ctx), 2);
    // Ränder weich ausblenden, damit Korona und Ringe nicht an der Canvas-Kante abreißen
    const m = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size / 2);
    m.addColorStop(0, 'rgba(0,0,0,1)');
    m.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = m;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    return c;
  }
}

/** Schattierung einer Kugel als Einheitsverlauf (Licht von links oben). */
function makeShade(ctx) {
  const g = ctx.createRadialGradient(-0.42, -0.48, 0.02, -0.08, -0.08, 1.22);
  g.addColorStop(0, 'rgba(255,250,235,0.22)');
  g.addColorStop(0.32, 'rgba(255,250,235,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.1)');
  g.addColorStop(0.84, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0.9)');
  return g;
}

/**
 * Projiziert das sichtbare Fenster eines Kugelstreifens auf eine Kugel:
 * Streifen gleicher Längen-Breite werden auf sin-verteilte Bildschirm-
 * streifen gelegt. `ov` überlappt die Streifen minimal gegen Haarrisse.
 */
function drawSphere(ctx, tex, x, y, r, phase, n, ov) {
  const H = STRIP_H, W = H * 2;
  const off = (((phase % 1) + 1) % 1) * W;
  const uw = H / n;
  let xa = -r;
  for (let i = 0; i < n; i++) {
    const xb = Math.sin(-Math.PI / 2 + (Math.PI * (i + 1)) / n) * r;
    ctx.drawImage(tex, off + i * uw, 0, uw, H, x + xa - ov * 0.5, y - r, xb - xa + ov, r * 2);
    xa = xb;
  }
}
