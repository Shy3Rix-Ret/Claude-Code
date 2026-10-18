/**
 * Galaxie-Ära: prozedurale Kunst für die Galaxie und die 50 Stufen danach.
 *
 * Jede Stufe ist ein echter Galaxientyp oder ein echtes Objekt (Andromeda,
 * Sombrero, Hoags Objekt, Bullet-Cluster, Laniakea …). Gebaut wird alles aus
 * wenigen Malwerkzeugen: Spiralarme, elliptisches Helligkeitsprofil,
 * irreguläre Sternwolken, Ringe, Gezeitenschweife, heißes Gas, Stromlinien
 * und das kosmische Netz.
 *
 * Das Ergebnis ist eine Liste von Ebenen, die der Renderer übereinanderlegt,
 * jede mit eigener Neigung, Drehung und Mischart. So legt die Sombrerogalaxie
 * ihr Staubband *vor* den Bulge, und der Ring einer Polarringgalaxie läuft
 * hinter der Scheibe durch und vorne wieder heraus.
 *
 *   Ebene   { img, size, tilt, rot, spin, phase, mode, alpha, half, dx, dy }
 *           size × r = halbe Kantenlänge; half −1/1 = nur hintere/vordere Hälfte;
 *           dx, dy × r = Versatz (Begleitgalaxien)
 *   Schein  { glow: '#hex', size, alpha, tilt, … } — weicher Lichtfleck (Bulge, Kern)
 *
 * Dazu optional `jets`, `flare` (Blazar-Blitz) und `logo` (die allerletzte Stufe).
 */
import { TAU, clamp, fbm, smoothstep } from './utils.js';
import { makeCanvas } from './canvas.js';

const SPRITE = 512;     // Kantenlänge im Spiel
const LITE = 160;       // Vorschaubilder im Startbildschirm: weniger Pixel, weniger Sterne

const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const WHITE = [255, 250, 240], CORE = [255, 240, 210], WARM = [255, 212, 160], GOLD = [255, 196, 120];
const BLUE = [165, 192, 255], ICE = [205, 222, 255], PINK = [255, 110, 170], RED = [255, 92, 66];
const DUST = [22, 11, 7], VIOLET = [150, 100, 255], XRAY = [185, 105, 255], TEAL = [110, 228, 236];
const AMBER = [255, 179, 71], OLD = [255, 222, 186];

function gaussOf(rng) {
  return () => {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  };
}

/** Malfläche mit Ursprung in der Mitte. R = halbe Kante, q = Anteil der Sterne. */
function surface(size, rng, q, seed) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  return { c, ctx, R: size / 2, rng, g: gaussOf(rng), q, seed, px: Math.max(0.55, size / SPRITE) };
}

/** Kleinere Malfläche für Begleiter und Haufenmitglieder. */
function sub(P, px, paint, q = P.q) {
  const s = surface(Math.max(16, Math.round(px)), P.rng, q, P.seed + 17);
  paint(s);
  return s.c;
}

/** Fertiges Bild in die Malfläche setzen (Position und Größe in R). */
function put(P, img, x, y, size, rot = 0, tilt = 1, alpha = 1) {
  const { ctx, R } = P;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.translate(x * R, y * R);
  ctx.rotate(rot);
  ctx.scale(1, tilt);
  const s = size * R;
  ctx.drawImage(img, -s, -s, s * 2, s * 2);
  ctx.restore();
}

function glow(P, x, y, r, col, a, mid = 0.3) {
  if (r <= 0) return;
  const { ctx } = P;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(mid, rgba(col, a * 0.32));
  g.addColorStop(1, rgba(col, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * Sterne streuen. `place(pt)` setzt die Position, `palette` ist [[Farbe, Anteil], …].
 * Pro Farbe wird fillStyle nur einmal gesetzt — tausende Farbwechsel wären teuer.
 */
function scatter(P, n, place, palette, size = [0.6, 1.7], alpha = [0.25, 0.9]) {
  const { ctx, rng } = P, pt = { x: 0, y: 0 };
  const total = Math.round(n * P.q);
  for (const [col, share] of palette) {
    ctx.fillStyle = rgba(col, 1);
    for (let i = 0, m = Math.round(total * share); i < m; i++) {
      place(pt);
      ctx.globalAlpha = alpha[0] + rng() * (alpha[1] - alpha[0]);
      const s = (size[0] + rng() * (size[1] - size[0])) * P.px;
      ctx.fillRect(pt.x - s / 2, pt.y - s / 2, s, s);
    }
  }
  ctx.globalAlpha = 1;
}

// --- Malwerkzeuge -------------------------------------------------------------------

/**
 * Spiralgalaxie: Scheibe, optional Balken, Arme als durchgehende Spiralen
 * (Grand Design) oder viele kurze Fetzen (flockig), Sternentstehungsgebiete,
 * Staubbahnen an der Innenkante und ein heller Kern.
 */
function spiral(P, o = {}) {
  const { ctx, R, rng, g } = P;
  const arms = o.arms ?? 2, twist = o.twist ?? 2.8, flocc = o.flocc ?? 0, bar = o.bar ?? 0;
  const r0 = Math.max(o.r0 ?? 0.06, bar * 0.9), r1 = o.r1 ?? 0.92;
  const armCol = o.arm ?? BLUE, warm = o.warm ?? WARM, coreCol = o.core ?? CORE;
  const phase = rng() * TAU;
  const at = (arm, t, off, pt) => {
    const a = phase + (arm * TAU) / arms + t * twist + off, rr = (r0 + t * (r1 - r0)) * R;
    pt.x = Math.cos(a) * rr;
    pt.y = Math.sin(a) * rr;
    return pt;
  };

  ctx.globalCompositeOperation = 'lighter';
  const dg = o.diskGlow ?? 1;
  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, R * r1);
  disk.addColorStop(0, rgba(coreCol, 0.85));
  disk.addColorStop(0.1, rgba(warm, 0.42));
  disk.addColorStop(0.32, rgba(armCol, 0.17 * dg));
  disk.addColorStop(0.72, rgba(armCol, 0.06 * dg));
  disk.addColorStop(1, rgba(armCol, 0));
  ctx.fillStyle = disk;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  if (bar > 0) {
    ctx.save();
    ctx.rotate(phase);
    ctx.scale(1, 0.24);
    glow(P, 0, 0, bar * R * 1.2, o.barCol ?? GOLD, 0.6, 0.5);
    ctx.restore();
    const c = Math.cos(phase), s = Math.sin(phase);
    scatter(P, 1500, p => {
      const t = g() * 0.5 * bar * R, w = g() * bar * R * 0.12;
      p.x = c * t - s * w;
      p.y = s * t + c * w;
    }, [[WARM, 0.6], [WHITE, 0.4]]);
  }

  const segs = [];
  if (flocc <= 0) {
    for (let arm = 0; arm < arms; arm++) segs.push({ arm, off: 0, t0: 0, t1: 1, w: o.weights ? o.weights[arm % o.weights.length] : 1 });
  } else {
    for (let i = 0, n = Math.round(12 + flocc * 34); i < n; i++) {
      const t0 = rng() * 0.85;
      segs.push({ arm: rng() * arms, off: g() * 0.25, t0, t1: Math.min(1, t0 + 0.08 + rng() * 0.24), w: 0.45 + rng() * 0.6 });
    }
  }
  const pt = { x: 0, y: 0 }, aw = o.armWidth ?? 1, haze = o.haze ?? 1;
  ctx.lineCap = 'round';
  for (const s of segs) {
    for (const [w, a, col] of [[0.2, 0.05, armCol], [0.09, 0.08, mix(armCol, WHITE, 0.4)], [0.035, 0.11, WHITE]]) {
      ctx.strokeStyle = rgba(col, a * s.w * haze);
      ctx.lineWidth = w * R * aw * (0.5 + s.w * 0.5);
      ctx.beginPath();
      for (let t = s.t0, k = 0; t <= s.t1 + 1e-6; t += 0.02, k++) {
        at(s.arm, t, s.off, pt);
        if (k === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }

  const N = o.stars ?? 8000, spread = o.spread ?? 0.22;
  const total = segs.reduce((sum, s) => sum + (s.t1 - s.t0) * s.w, 0);
  const pick = () => {
    let x = rng() * total;
    for (const s of segs) if ((x -= (s.t1 - s.t0) * s.w) <= 0) return s;
    return segs[segs.length - 1];
  };
  scatter(P, N * 0.72, p => {
    const s = pick();
    const t = s.t0 + (s.t1 - s.t0) * Math.pow(rng(), 0.85);
    at(s.arm, t, s.off + g() * spread * (1 - t * 0.5), p);
    const k = 1 + g() * 0.04;
    p.x *= k;
    p.y *= k;
  }, [[WHITE, 0.42], [armCol, 0.52], [PINK, 0.06]]);
  scatter(P, N * 0.28, p => {
    const rr = -Math.log(1 - rng() * 0.985) * R * (o.diskScale ?? 0.17), a = rng() * TAU;
    p.x = Math.cos(a) * rr;
    p.y = Math.sin(a) * rr;
  }, [[warm, 0.55], [WHITE, 0.45]]);

  for (let i = 0, n = Math.round((o.knots ?? 0.5) * 40 * Math.max(P.q, 0.4)); i < n; i++) {
    const s = pick();
    at(s.arm, s.t0 + (s.t1 - s.t0) * (0.15 + rng() * 0.85), s.off + g() * spread * 0.5, pt);
    glow(P, pt.x, pt.y, R * (0.012 + rng() * 0.022), rng() < 0.7 ? PINK : ICE, 0.55);
  }

  ctx.globalCompositeOperation = 'source-over';
  const dust = o.dust ?? 0.35;
  if (dust > 0) {
    ctx.strokeStyle = rgba(DUST, dust);
    ctx.lineWidth = R * 0.016;
    for (const s of segs) {
      if (s.t1 - s.t0 < 0.12) continue;
      ctx.beginPath();
      for (let t = Math.max(s.t0, 0.06), k = 0; t <= s.t1 * 0.9; t += 0.02, k++) {
        at(s.arm, t, s.off - 0.17, pt);
        if (k === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }
  }
  for (const rr of o.rings ?? []) {
    // Staubringe wie bei Andromeda oder das Band der Sombrerogalaxie
    ctx.strokeStyle = rgba(DUST, o.ringAlpha ?? 0.45);
    ctx.lineWidth = R * (o.ringWidth ?? 0.02);
    ctx.beginPath();
    ctx.arc(0, 0, rr * R, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  glow(P, 0, 0, R * (o.coreSize ?? 0.16), coreCol, 1, 0.4);
  return { at };
}

/**
 * Elliptisches Profil nach Sérsic: I(r) = exp(−b · ((r/rₑ)^(1/n) − 1)).
 * Die riesige Dynamik wird mit 1 − e^(−I·k) auf Deckkraft abgebildet.
 * `q` staucht die Form, `gcs` streut Kugelsternhaufen in den Halo.
 */
function elliptical(P, o = {}) {
  const { ctx, R, rng } = P;
  const ext = (o.extent ?? 0.95) * R, re = (o.re ?? 0.3) * R, n = o.n ?? 4, b = 2 * n - 0.33;
  const col = o.color ?? OLD, k = o.bright ?? 0.25, q = o.q ?? 1;
  ctx.save();
  ctx.scale(1, q);
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, ext);
  for (let i = 0; i <= 14; i++) {
    const f = i / 14, rr = Math.max(f * ext, 0.5);
    const I = Math.exp(-b * (Math.pow(rr / re, 1 / n) - 1));
    grad.addColorStop(f, rgba(mix(WHITE, col, Math.min(1, f * 2.2)), (1 - Math.exp(-I * k)) * (1 - smoothstep(0.75, 1, f))));
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, ext, 0, TAU);
  ctx.fill();
  scatter(P, o.stars ?? 2500, p => {
    const rr = ext * Math.pow(rng(), o.conc ?? 1.9), a = rng() * TAU;
    p.x = Math.cos(a) * rr;
    p.y = Math.sin(a) * rr;
  }, [[WARM, 0.5], [WHITE, 0.3], [[255, 170, 120], 0.2]], [0.5, 1.3], [0.15, 0.6]);
  ctx.restore();
  for (let i = 0, m = Math.round((o.gcs ?? 0) * Math.max(P.q, 0.3)); i < m; i++) {
    const rr = ext * (0.25 + 0.7 * Math.sqrt(rng())) * (o.gcSpread ?? 1), a = rng() * TAU;
    glow(P, Math.cos(a) * rr, Math.sin(a) * rr * (0.55 + 0.45 * q), R * 0.012 * (0.6 + rng()), [255, 236, 200], 0.9, 0.5);
  }
}

/** Irreguläre Galaxie: Sternwolken statt Arme, viel Sternentstehung, optional ein schiefer Balken. */
function irregular(P, o = {}) {
  const { ctx, R, rng, g } = P;
  const flat = o.flat ?? 0.7, spread = (o.spread ?? 0.5) * R, col = o.col ?? BLUE;
  ctx.globalCompositeOperation = 'lighter';
  glow(P, 0, 0, R * 0.85, col, 0.1 * (o.haze ?? 1), 0.4);
  const clumps = [];
  for (let i = 0; i < (o.clumps ?? 7); i++) {
    clumps.push({ x: clamp(g() * 0.6, -1, 1) * spread, y: clamp(g() * 0.6, -1, 1) * spread * flat, s: R * (0.06 + rng() * 0.14) });
  }
  if (o.bar) {
    const ba = rng() * TAU, bx = (o.barX ?? 0) * R, by = (o.barY ?? 0) * R, c = Math.cos(ba), s = Math.sin(ba);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(ba);
    ctx.scale(1, 0.3);
    glow(P, 0, 0, o.bar * R, [255, 226, 190], 0.5, 0.45);
    ctx.restore();
    scatter(P, 1400, p => {
      const t = g() * 0.45 * o.bar * R, w = g() * o.bar * R * 0.1;
      p.x = bx + c * t - s * w;
      p.y = by + s * t + c * w;
    }, [[WARM, 0.5], [WHITE, 0.5]]);
  }
  for (const c of clumps) glow(P, c.x, c.y, c.s * 1.8, col, 0.16, 0.35);
  let ci = 0;
  const stars = o.stars ?? 6000;
  scatter(P, stars, p => {
    const c = clumps[ci++ % clumps.length];
    p.x = c.x + g() * c.s;
    p.y = c.y + g() * c.s * flat;
  }, [[WHITE, 0.4], [ICE, 0.45], [PINK, 0.05], [WARM, 0.1]]);
  scatter(P, stars * 0.3, p => {
    p.x = g() * spread;
    p.y = g() * spread * flat;
  }, [[WHITE, 0.5], [WARM, 0.5]], [0.5, 1.2], [0.15, 0.5]);
  for (let i = 0, n = Math.round((o.nebulae ?? 6) * Math.max(P.q, 0.4)); i < n; i++) {
    const c = clumps[Math.floor(rng() * clumps.length)];
    glow(P, c.x + g() * c.s * 0.5, c.y + g() * c.s * 0.5 * flat, R * (0.02 + rng() * 0.04), PINK, 0.5);
  }
  if (o.nebula) {
    // ein großer Sternentstehungsnebel (Tarantelnebel)
    const [nx, ny, ns] = o.nebula;
    for (let i = 0; i < 6; i++) glow(P, (nx + g() * 0.03) * R, (ny + g() * 0.03) * R, ns * R * (0.5 + rng() * 0.6), i % 2 ? PINK : [255, 160, 205], 0.45);
    glow(P, nx * R, ny * R, ns * R * 0.25, WHITE, 0.9);
  }
}

/** Sternring mit Knoten (Hoag, Wagenrad, Polarring). */
function ring(P, o) {
  const { ctx, R, rng, g } = P;
  const rr = o.radius * R, w = (o.width ?? 0.06) * R, col = o.color ?? BLUE, haze = o.haze ?? 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = rgba(col, 0.1 * haze);
  ctx.lineWidth = w * 2.4;
  ctx.beginPath();
  ctx.arc(0, 0, rr, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = rgba(mix(col, WHITE, 0.3), 0.14 * haze);
  ctx.lineWidth = w;
  ctx.stroke();
  scatter(P, o.stars ?? 3000, p => {
    const a = rng() * TAU, r = rr + g() * w * 0.55;
    p.x = Math.cos(a) * r;
    p.y = Math.sin(a) * r;
  }, [[WHITE, 0.4], [col, 0.5], [PINK, 0.1]]);
  for (let i = 0, n = Math.round((o.knots ?? 20) * Math.max(P.q, 0.4)); i < n; i++) {
    const a = rng() * TAU, r = rr + g() * w * 0.3;
    glow(P, Math.cos(a) * r, Math.sin(a) * r, R * (0.012 + rng() * 0.025), rng() < 0.6 ? PINK : ICE, 0.6);
  }
}

/** Gezeitenschweif: Sterne entlang einer quadratischen Kurve, nach außen breiter. Koordinaten in R. */
function tail(P, x0, y0, cx, cy, x1, y1, o = {}) {
  const { ctx, R, rng, g } = P;
  const w = (o.width ?? 0.05) * R, col = o.color ?? BLUE;
  const X = [x0 * R, cx * R, x1 * R], Y = [y0 * R, cy * R, y1 * R];
  const bez = (t, a) => (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * a[1] + t * t * a[2];
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [lw, a] of [[3, 0.05], [1.4, 0.07]]) {
    ctx.strokeStyle = rgba(col, a * (o.haze ?? 1));
    ctx.lineWidth = w * lw;
    ctx.beginPath();
    ctx.moveTo(X[0], Y[0]);
    ctx.quadraticCurveTo(X[1], Y[1], X[2], Y[2]);
    ctx.stroke();
  }
  scatter(P, o.stars ?? 1400, p => {
    const t = Math.pow(rng(), o.taper ?? 0.8), s = w * (0.4 + t * 0.8);
    p.x = bez(t, X) + g() * s;
    p.y = bez(t, Y) + g() * s;
  }, [[WHITE, 0.4], [col, 0.55], [PINK, 0.05]]);
  for (let i = 0; i < (o.knots ?? 0); i++) {
    const t = 0.3 + rng() * 0.7;
    glow(P, bez(t, X) + g() * w * 0.4, bez(t, Y) + g() * w * 0.4, R * (0.01 + rng() * 0.018), rng() < 0.5 ? ICE : PINK, 0.6);
  }
}

/**
 * Diffuses Gas (Röntgengas eines Haufens, Radiokeulen, Dichtefelder) —
 * in niedriger Auflösung pro Pixel berechnet und weich hochskaliert.
 * blobs: [[x, y, Radius, Gewicht?], …] in Einheiten von R.
 */
function gas(P, blobs, col, strength, o = {}) {
  const N = P.q < 1 ? 48 : 112;
  const c = makeCanvas(N, N), g2 = c.getContext('2d'), img = g2.createImageData(N, N), d = img.data;
  const freq = o.freq ?? 3, seed = P.seed + (o.seed ?? 0);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1, v = ((y + 0.5) / N) * 2 - 1;
      let f = 0;
      for (const [bx, by, br, bw = 1] of blobs) f += bw * Math.exp(-((u - bx) ** 2 + (v - by) ** 2) / (br * br));
      f *= 0.45 + 0.9 * fbm(u * freq + 7, v * freq + 3, seed, 4);
      const i = (y * N + x) * 4;
      d[i] = col[0];
      d[i + 1] = col[1];
      d[i + 2] = col[2];
      d[i + 3] = 255 * clamp(f * strength, 0, 1) * (1 - smoothstep(0.86, 1, Math.hypot(u, v)));
    }
  }
  g2.putImageData(img, 0, 0);
  P.ctx.save();
  P.ctx.globalCompositeOperation = 'lighter';
  P.ctx.drawImage(c, -P.R, -P.R, P.R * 2, P.R * 2);
  P.ctx.restore();
}

/**
 * Kosmisches Netz: Knoten (Galaxienhaufen) und Filamente zu den nächsten
 * Nachbarn, Galaxien als Punkte entlang der Fäden. `hole` lässt die Mitte leer.
 */
function web(P, o = {}) {
  const { ctx, R, rng, g } = P;
  const n = o.nodes ?? 30, minD = (o.minDist ?? 0.14) * R, lim = (o.radius ?? 0.9) * R, hole = (o.hole ?? 0) * R;
  const nodes = [];
  for (let tries = 0; nodes.length < n && tries < n * 60; tries++) {
    const a = rng() * TAU, r = Math.sqrt(rng()) * lim;
    if (r < hole) continue;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (nodes.some(m => Math.hypot(m.x - x, m.y - y) < minD)) continue;
    nodes.push({ x, y, m: 0.4 + rng() ** 2 * 1.2 });
  }
  const seen = new Set(), links = [];
  nodes.forEach((A, i) => {
    const near = nodes.map((B, j) => [j, Math.hypot(B.x - A.x, B.y - A.y)]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]);
    for (const [j, d] of near.slice(0, o.k ?? 3)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (d > (o.maxLen ?? 0.6) * R || seen.has(key)) continue;
      seen.add(key);
      links.push([A, nodes[j], d]);
    }
  });
  const fil = o.color ?? VIOLET, node = o.node ?? GOLD, haze = o.haze ?? 1;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const [A, B, len] of links) {
    const mx = (A.x + B.x) / 2 + g() * len * 0.12, my = (A.y + B.y) / 2 + g() * len * 0.12;
    for (const [lw, a] of [[0.05, 0.05], [0.016, 0.1]]) {
      ctx.strokeStyle = rgba(fil, a * haze);
      ctx.lineWidth = lw * R * (o.width ?? 1);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.quadraticCurveTo(mx, my, B.x, B.y);
      ctx.stroke();
    }
    scatter(P, (len / R) * (o.dots ?? 500), p => {
      const t = rng(), u = 1 - t;
      p.x = u * u * A.x + 2 * u * t * mx + t * t * B.x + g() * R * 0.012;
      p.y = u * u * A.y + 2 * u * t * my + t * t * B.y + g() * R * 0.012;
    }, [[mix(fil, WHITE, 0.55), 0.6], [WHITE, 0.4]], [0.5, 1.4], [0.2, 0.75]);
  }
  for (const m of nodes) {
    glow(P, m.x, m.y, R * 0.05 * m.m * (o.nodeSize ?? 1), node, 0.55, 0.3);
    scatter(P, 60 * m.m * (o.nodeSize ?? 1), p => {
      p.x = m.x + g() * R * 0.018 * m.m * (o.nodeSize ?? 1);
      p.y = m.y + g() * R * 0.018 * m.m * (o.nodeSize ?? 1);
    }, [[WHITE, 0.5], [node, 0.5]], [0.6, 1.6], [0.4, 1]);
  }
  return nodes;
}

/** Stromlinien, die zu einem Attraktor fließen (Laniakea, Großer Attraktor). */
function flow(P, o = {}) {
  const { ctx, R, rng } = P;
  const ax = (o.ax ?? 0) * R, ay = (o.ay ?? 0) * R, col = o.color ?? ICE;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dots = [];
  for (let i = 0, lines = Math.round((o.lines ?? 80) * Math.max(P.q, 0.5)); i < lines; i++) {
    const a0 = rng() * TAU, r0 = (0.5 + rng() * 0.45) * R;
    let x = Math.cos(a0) * r0, y = Math.sin(a0) * r0;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 90; k++) {
      const dx = ax - x, dy = ay - y, d = Math.hypot(dx, dy);
      if (d < R * 0.03) break;
      const sw = (o.twist ?? 0) + (o.swirl ?? 0.6) * (fbm(x / R * 2 + 11, y / R * 2 + 5, P.seed, 3) - 0.5) * 2;
      const step = R * 0.016;
      x += (dx / d - (dy / d) * sw) * step;
      y += (dy / d + (dx / d) * sw) * step;
      ctx.lineTo(x, y);
      if (k % 9 === 4) dots.push(x, y);
    }
    ctx.strokeStyle = rgba(col, 0.13);
    ctx.lineWidth = R * 0.006;
    ctx.stroke();
  }
  ctx.fillStyle = rgba(WHITE, 1);
  for (let i = 0; i < dots.length; i += 2) {
    ctx.globalAlpha = 0.3 + rng() * 0.6;
    const s = (0.8 + rng() * 1.4) * P.px;
    ctx.fillRect(dots[i] - s / 2, dots[i + 1] - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

/** Kosmischer Mikrowellenhintergrund als Rand des Universums (kalt = blau, warm = orange). */
function cmb(P, inner, outer, o = {}) {
  const N = Math.round(clamp(P.R * 0.6, 32, P.q < 1 ? 64 : 160));
  const c = makeCanvas(N, N), g2 = c.getContext('2d'), img = g2.createImageData(N, N), d = img.data;
  const cold = o.cold ?? [40, 90, 210], mid = [250, 240, 225], hot = o.hot ?? [255, 120, 40], out = [0, 0, 0];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = ((x + 0.5) / N) * 2 - 1, v = ((y + 0.5) / N) * 2 - 1, r = Math.hypot(u, v);
      const i = (y * N + x) * 4;
      if (r < inner - 0.04 || r > outer) { d[i + 3] = 0; continue; }
      const n = fbm(u * 9 + 3, v * 9 + 1, P.seed + 5, 4);
      const t = clamp((n - 0.5) * 2.6, -1, 1);
      const m = t < 0 ? mix(mid, cold, -t) : mix(mid, hot, t);
      out[0] = m[0]; out[1] = m[1]; out[2] = m[2];
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = 255 * 0.8 * smoothstep(inner - 0.04, inner + 0.02, r) * (1 - smoothstep(outer - 0.02, outer, r));
    }
  }
  g2.putImageData(img, 0, 0);
  P.ctx.save();
  P.ctx.globalCompositeOperation = 'lighter';
  P.ctx.drawImage(c, -P.R, -P.R, P.R * 2, P.R * 2);
  P.ctx.restore();
}

/** Bogenförmige Schalen um eine Galaxie (Reste geschluckter Begleiter). */
function shells(P, radii, col = OLD, a0 = 0.14) {
  const { ctx, R, rng, g } = P;
  ctx.globalCompositeOperation = 'lighter';
  radii.forEach((rr, k) => {
    const side = (k % 2 ? 0 : Math.PI) + g() * 0.2, span = 0.7 + rng() * 0.4;
    ctx.strokeStyle = rgba(col, a0 * (1 - k * 0.1));
    ctx.lineWidth = R * 0.02;
    ctx.beginPath();
    ctx.arc(0, 0, rr * R, side - span, side + span);
    ctx.stroke();
    scatter(P, 260, p => {
      const a = side + (rng() * 2 - 1) * span, r = rr * R + g() * R * 0.008;
      p.x = Math.cos(a) * r;
      p.y = Math.sin(a) * r;
    }, [[OLD, 0.6], [WHITE, 0.4]], [0.5, 1.2], [0.2, 0.6]);
  });
}

/** Dunkler Fleck (Staub), der das Licht dahinter schluckt. */
function shadow(P, x, y, r, a, squash = 1, rot = 0) {
  const { ctx } = P;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(1, squash);
  glow(P, 0, 0, r, [10, 5, 3], a, 0.6);
  ctx.restore();
}

// --- Bausteine für Gruppen und Haufen -------------------------------------------------

const miniSpiral = (P, px, o = {}) => sub(P, px, s => spiral(s, { stars: 2600, knots: 0.4, ...o }));
const miniElliptical = (P, px, o = {}) => sub(P, px, s => elliptical(s, { stars: 400, ...o }));
const miniIrregular = (P, px, o = {}) => sub(P, px, s => irregular(s, { stars: 1600, ...o }));

/**
 * Ein Galaxienhaufen: wenige vorgerenderte Mitglieder, vielfach gedreht und
 * skaliert wiederverwendet — 70 eigene Galaxien wären zu teuer.
 */
function crowd(P, n, o = {}) {
  const { R, rng, g } = P;
  const px = R * 0.24;
  const ell = [0, 1, 2, 3].map(i => miniElliptical(P, px, { re: 0.22 + i * 0.05, n: 3 + i, bright: 0.5, color: mix(OLD, GOLD, i / 4), q: 1 - i * 0.12 }));
  const spi = [0, 1, 2].map(i => miniSpiral(P, px * 1.4, { arms: 2, twist: 2.5 + i, stars: 1300, bar: i === 1 ? 0.3 : 0, dust: 0.25 }));
  const cx = (o.cx ?? 0), cy = (o.cy ?? 0), spread = o.spread ?? 0.36;
  for (let i = 0; i < n; i++) {
    let x = g() * spread, y = g() * spread * (o.flat ?? 1);
    const d = Math.hypot(x, y);
    if (d > 0.85) { x *= 0.85 / d; y *= 0.85 / d; }
    const spiralType = rng() < (o.spirals ?? 0.25);
    const img = spiralType ? spi[i % spi.length] : ell[i % ell.length];
    const size = (0.025 + rng() ** 2 * 0.06) * (1.3 - Math.min(1, d / 0.9) * 0.5) * (o.scale ?? 1);
    put(P, img, cx + x, cy + y, size, rng() * TAU, spiralType ? 0.35 + rng() * 0.6 : 0.6 + rng() * 0.4);
  }
  // Intracluster-Licht: verstreute Sterne zwischen den Galaxien
  glow(P, cx * R, cy * R, R * spread * 1.3, o.icl ?? OLD, 0.12, 0.35);
}

// --- Fertige Kunst -------------------------------------------------------------------

const face = rng => 0.72 + rng() * 0.2;
const spinOf = (rng, base = 0.04) => (rng() < 0.5 ? -1 : 1) * base * (0.8 + rng() * 0.5);

function layer(img, size, o = {}) {
  return { img, size, tilt: 1, rot: 0, spin: 0, phase: 0, mode: 'lighter', alpha: 1, half: 0, dx: 0, dy: 0, ...o };
}

function shine(hex, size, alpha = 0.75, o = {}) {
  return { glow: hex, size, alpha, tilt: 1, rot: 0, dx: 0, dy: 0, ...o };
}

function finish(rng, layers, o = {}) {
  let reach = 1;
  for (const L of layers) reach = Math.max(reach, Math.hypot(L.dx, L.dy) + L.size);
  if (o.jets) reach = Math.max(reach, o.jets.len);
  if (o.logo) reach = Math.max(reach, o.logo.outer + 0.3);
  return {
    kind: 'galaxy', layers, tint: o.tint ?? '#cfd8ff', rot0: o.rot0 ?? rng() * TAU,
    jets: o.jets ?? null, flare: o.flare ?? null, logo: o.logo ?? null,
    extent: o.extent ?? 1.45, reach: reach + 0.15, thumb: o.thumb ?? clamp(0.5 / reach, 0.1, 0.32),
  };
}

/** Malfläche für eine Stufe (im Vorschaumodus kleiner und mit weniger Sternen). */
const canvasFor = (seed, rng, lite, scale = 1) => surface(Math.round((lite ? LITE : SPRITE) * scale), rng, lite ? 0.25 : 1, seed);

/** Dunkler Ring als eigene Ebene: das Staubband, das vor dem Bulge liegt. */
function laneSprite(seed, rng, lite, radius, width, alpha) {
  const L = canvasFor(seed, rng, lite);
  L.ctx.strokeStyle = rgba(DUST, alpha);
  L.ctx.lineWidth = width * L.R;
  L.ctx.beginPath();
  L.ctx.arc(0, 0, radius * L.R, 0, TAU);
  L.ctx.stroke();
  return L.c;
}

function haloSprite(seed, rng, lite, o) {
  const H = canvasFor(seed, rng, lite, 0.5);
  elliptical(H, o);
  return H.c;
}

/** Bauplan je Stufe: (seed, rng, lite) → art. Schlüssel wie in config.js. */
export const GALAXY_ART = {
  galaxy(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: rng() < 0.55 ? 2 : 3, twist: 2.4 + rng() * 1.2 });
    return finish(rng, [layer(P.c, 1.6, { tilt: face(rng), spin: spinOf(rng) }), shine('#ffe8c0', 0.55)], { thumb: 0.32 });
  },

  // --- Zwerge und Nachbarn -----------------------------------------------------------
  dwarf(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.45, n: 1, color: [232, 222, 206], bright: 0.14, stars: 5000, conc: 1.1, extent: 0.9 });
    return finish(rng, [layer(P.c, 1.35, { tilt: 0.75 + rng() * 0.2, spin: spinOf(rng, 0.01) })], { tint: '#e2d8c8' });
  },
  smc(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    irregular(P, { clumps: 6, spread: 0.6, flat: 0.55, bar: 0.32, barX: -0.08, nebulae: 5 });
    return finish(rng, [layer(P.c, 1.5, { tilt: 0.85, spin: spinOf(rng, 0.015) })], { tint: '#bcd2ff' });
  },
  lmc(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    irregular(P, { clumps: 8, spread: 0.65, flat: 0.75, bar: 0.48, barX: 0.05, barY: -0.06, nebula: [0.32, -0.22, 0.14], nebulae: 8 });
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.85, spin: spinOf(rng, 0.015) })], { tint: '#c4d4ff' });
  },
  m33(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 2.2, flocc: 0.55, knots: 1.5, dust: 0.12, coreSize: 0.08, arm: [160, 195, 255], diskGlow: 1.3, spread: 0.3 });
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.7, spin: spinOf(rng) }), shine('#fff0d8', 0.3, 0.5)]);
  },
  milkyway(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 4, twist: 2.1, bar: 0.24, weights: [1, 0.5], dust: 0.45, knots: 0.7, coreSize: 0.15 });
    const L = canvasFor(seed, rng, lite, 0.35), S = canvasFor(seed, rng, lite, 0.25);
    irregular(L, { clumps: 5, bar: 0.4, nebula: [0.3, -0.2, 0.18], stars: 2500 });
    irregular(S, { clumps: 4, flat: 0.55, stars: 1500 });
    return finish(rng, [
      layer(P.c, 1.6, { tilt: 0.85, spin: spinOf(rng) }), shine('#ffe6c0', 0.5, 0.7),
      layer(L.c, 0.26, { dx: 1.1, dy: 0.6, tilt: 0.8 }), layer(S.c, 0.16, { dx: 1.35, dy: 0.25, tilt: 0.8 }),
    ]);
  },

  // --- Spiralen ------------------------------------------------------------------------
  m63(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 3.6, flocc: 1, knots: 0.6, dust: 0.25, coreSize: 0.2, core: [255, 236, 190], warm: GOLD, arm: [190, 205, 255], diskScale: 0.22 });
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.55, spin: spinOf(rng) }), shine('#ffd890', 0.6, 0.8, { tilt: 0.7 })]);
  },
  m101(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 5, twist: 2.4, weights: [1, 0.7, 0.9, 0.55, 0.8], knots: 1.6, dust: 0.25, coreSize: 0.09, spread: 0.26 });
    return finish(rng, [layer(P.c, 1.7, { tilt: 0.93, spin: spinOf(rng) }), shine('#fff2dc', 0.32, 0.6)]);
  },
  m51(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    const { at } = spiral(P, { arms: 2, twist: 3.1, r1: 0.72, dust: 0.6, knots: 1.1, coreSize: 0.13 });
    const end = at(0, 1.18, 0, { x: 0, y: 0 }), mid = at(0, 0.95, 0.05, { x: 0, y: 0 });
    tail(P, mid.x / P.R, mid.y / P.R, (mid.x + end.x) / 2 / P.R, (mid.y + end.y) / 2 / P.R, end.x / P.R, end.y / P.R, { width: 0.03, stars: 500, haze: 0.8 });
    const comp = miniIrregular(P, P.R * 0.44, { clumps: 4, col: [255, 205, 150], nebulae: 0, stars: 1400 });
    put(P, comp, end.x / P.R, end.y / P.R, 0.2, rng() * TAU, 0.8);
    glow(P, end.x, end.y, P.R * 0.06, WARM, 0.6);
    return finish(rng, [layer(P.c, 1.7, { tilt: 0.9, spin: spinOf(rng, 0.03) }), shine('#ffe8c0', 0.45, 0.7)]);
  },
  m31(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 5, rings: [0.42, 0.6, 0.76], dust: 0.2, knots: 0.4, coreSize: 0.24, diskScale: 0.24, haze: 0.8 });
    const m32 = miniElliptical(P, P.R * 0.3, { re: 0.2, n: 2, bright: 0.5 });
    const m110 = miniElliptical(P, P.R * 0.6, { re: 0.4, n: 1, q: 0.6, bright: 0.2 });
    return finish(rng, [
      layer(P.c, 2.0, { tilt: 0.3, spin: spinOf(rng, 0.018) }), shine('#ffe6c0', 0.7, 0.85, { tilt: 0.6 }),
      layer(m32, 0.16, { dx: 0.18, dy: 0.42 }), layer(m110, 0.32, { dx: -0.45, dy: -0.75, rot: 0.6 }),
    ], { extent: 1.1 });
  },
  m64(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 4.5, dust: 0.2, knots: 0.15, coreSize: 0.22, haze: 0.6, diskScale: 0.25, arm: [200, 210, 240] });
    shadow(P, P.R * 0.12, 0, P.R * 0.24, 0.92, 0.55, 0.3);
    shadow(P, P.R * 0.16, P.R * 0.02, P.R * 0.12, 0.6, 0.5, 0.3);
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.55, spin: spinOf(rng, 0.015) }), shine('#ffe8c8', 0.4, 0.35)]);
  },
  m104(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 6, dust: 0, knots: 0.2, coreSize: 0.14, diskScale: 0.3, arm: [235, 225, 210], rings: [0.62], ringWidth: 0.12, ringAlpha: 0.8 });
    const halo = haloSprite(seed, rng, lite, { re: 0.3, n: 3, bright: 0.38, color: [255, 225, 190], gcs: 40 });
    const lane = laneSprite(seed, rng, lite, 0.62, 0.15, 0.95);
    const spin = spinOf(rng, 0.02);
    return finish(rng, [
      layer(halo, 1.05, { tilt: 0.72 }), layer(P.c, 1.75, { tilt: 0.3, spin }),
      shine('#fff1dc', 0.5, 0.7, { tilt: 0.8 }),
      layer(lane, 1.75, { tilt: 0.3, half: 1, mode: 'source-over' }),
    ], { extent: 0.9, tint: '#fff0dc' });
  },
  spindle(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 5, dust: 0, knots: 0.1, coreSize: 0.1, arm: [220, 225, 240], rings: [0.66], ringWidth: 0.03, ringAlpha: 0.8 });
    const halo = haloSprite(seed, rng, lite, { re: 0.3, n: 3, bright: 0.45, color: [255, 236, 214] });
    const lane = laneSprite(seed, rng, lite, 0.66, 0.035, 0.9);
    return finish(rng, [
      layer(halo, 0.8, { tilt: 0.65 }), layer(P.c, 1.9, { tilt: 0.085, spin: spinOf(rng, 0.02) }),
      shine('#fff3e2', 0.42, 0.8, { tilt: 0.7 }),
      layer(lane, 1.9, { tilt: 0.085, half: 1, mode: 'source-over' }),
    ], { extent: 0.8 });
  },

  // --- Balken, Linsen, Ringe -----------------------------------------------------------
  barred(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, bar: 0.45, twist: 2.5, r1: 0.95, dust: 0.5, knots: 0.9, coreSize: 0.1 });
    return finish(rng, [layer(P.c, 1.7, { tilt: 0.85, spin: spinOf(rng) }), shine('#ffe6c0', 0.4, 0.7)]);
  },
  lenticular(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.32, n: 1.2, bright: 0.3, color: [255, 220, 175], stars: 2500, extent: 0.92 });
    ring(P, { radius: 0.55, width: 0.08, color: [255, 215, 170], knots: 0, stars: 800, haze: 0.5 });
    return finish(rng, [layer(P.c, 1.5, { tilt: 0.42, spin: spinOf(rng, 0.01) }), shine('#ffe2b0', 0.55, 0.85, { tilt: 0.7 })]);
  },
  hoag(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.08, n: 3, extent: 0.26, bright: 0.6, color: [255, 205, 140], stars: 600 });
    ring(P, { radius: 0.72, width: 0.09, color: [150, 185, 255], knots: 30, stars: 4500 });
    // Durch die Lücke sieht man eine zweite, viel fernere Ringgalaxie. Wirklich.
    const far = sub(P, P.R * 0.16, s => {
      ring(s, { radius: 0.6, width: 0.15, color: [255, 160, 120], knots: 3, stars: 300 });
      elliptical(s, { re: 0.15, n: 2, extent: 0.3, bright: 0.5, stars: 50 });
    });
    put(P, far, 0.36, 0.12, 0.07, 0, 0.8);
    return finish(rng, [layer(P.c, 1.5, { tilt: 0.92, spin: spinOf(rng, 0.02) }), shine('#ffd9a0', 0.4, 0.6)]);
  },
  cartwheel(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    ring(P, { radius: 0.8, width: 0.08, color: [170, 190, 255], knots: 40, stars: 4000 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + P.g() * 0.08, b = a + 0.25;
      tail(P, Math.cos(a) * 0.3, Math.sin(a) * 0.3, Math.cos(b) * 0.55, Math.sin(b) * 0.55, Math.cos(a + 0.3) * 0.76, Math.sin(a + 0.3) * 0.76, { width: 0.012, stars: 150, haze: 0.5 });
    }
    ring(P, { radius: 0.27, width: 0.05, color: [255, 210, 160], knots: 0, stars: 900 });
    elliptical(P, { re: 0.06, extent: 0.2, bright: 0.5, color: [255, 200, 150], stars: 200 });
    const c1 = miniSpiral(P, P.R * 0.6, { arms: 2, twist: 3, stars: 900 });
    const c2 = miniElliptical(P, P.R * 0.4, { re: 0.3, n: 2, color: [255, 210, 160] });
    return finish(rng, [
      layer(P.c, 1.6, { tilt: 0.66, spin: spinOf(rng, 0.02) }),
      layer(c1, 0.3, { dx: 1.4, dy: 0.35, tilt: 0.7, rot: 1 }), layer(c2, 0.22, { dx: 1.15, dy: 0.9 }),
    ]);
  },
  polarring(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.25, n: 1.5, q: 0.32, bright: 0.45, color: [255, 215, 170], stars: 1500 });
    const Rg = canvasFor(seed, rng, lite);
    ring(Rg, { radius: 0.78, width: 0.12, color: [150, 185, 255], knots: 30, stars: 4500 });
    const rot = Math.PI / 2 + 0.12, spin = spinOf(rng, 0.03);
    return finish(rng, [
      layer(Rg.c, 1.7, { rot, tilt: 0.24, half: -1, spin }),
      layer(P.c, 1.2), shine('#ffe2b8', 0.4, 0.7, { tilt: 0.45 }),
      layer(Rg.c, 1.7, { rot, tilt: 0.24, half: 1, spin }),
    ]);
  },
  m82(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    P.ctx.save();
    P.ctx.scale(1, 0.2);
    P.ctx.globalCompositeOperation = 'lighter';
    glow(P, 0, 0, P.R * 0.72, [215, 222, 255], 0.55, 0.45);
    P.ctx.restore();
    irregular(P, { clumps: 16, spread: 0.75, flat: 0.12, nebulae: 12, haze: 0.6, col: [200, 210, 255], stars: 7000 });
    for (let i = 0; i < 9; i++) shadow(P, P.g() * P.R * 0.22, P.g() * P.R * 0.015, P.R * (0.03 + P.rng() * 0.05), 0.75, 0.4);
    // Der Superwind: rote Wasserstofffäden schießen senkrecht aus der Scheibe
    const O = canvasFor(seed, rng, lite);
    O.ctx.globalCompositeOperation = 'lighter';
    O.ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const side = i % 2 ? 1 : -1, x0 = O.g() * O.R * 0.1, x1 = x0 * 1.6 + O.g() * O.R * 0.12, y1 = side * O.R * (0.4 + O.rng() * 0.5);
      O.ctx.strokeStyle = rgba(i % 5 ? RED : [255, 150, 120], 0.05 + O.rng() * 0.06);
      O.ctx.lineWidth = O.R * (0.008 + O.rng() * 0.025);
      O.ctx.beginPath();
      O.ctx.moveTo(x0, 0);
      O.ctx.quadraticCurveTo(x0 + O.g() * O.R * 0.1, y1 * 0.5, x1, y1);
      O.ctx.stroke();
    }
    glow(O, 0, -O.R * 0.3, O.R * 0.3, RED, 0.18);
    glow(O, 0, O.R * 0.3, O.R * 0.3, RED, 0.18);
    return finish(rng, [layer(O.c, 1.6), layer(P.c, 1.6), shine('#fff0e0', 0.35, 0.7, { tilt: 0.4 })], { extent: 1.2, tint: '#ffd2c8' });
  },

  // --- Elliptische und aktive Galaxien ------------------------------------------------
  elliptical(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.3, n: 4, bright: 0.35, gcs: 50, stars: 2500 });
    return finish(rng, [layer(P.c, 1.4, { tilt: 0.62 + rng() * 0.15, spin: spinOf(rng, 0.006) }), shine('#ffe8cc', 0.5, 0.7, { tilt: 0.7 })], { tint: '#ffe8cc' });
  },
  shell(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.22, n: 4, bright: 0.35, extent: 0.7, gcs: 20, stars: 1800 });
    shells(P, [0.42, 0.54, 0.66, 0.78, 0.9]);
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.85, spin: spinOf(rng, 0.008) }), shine('#ffe8cc', 0.42, 0.6)], { tint: '#ffe8cc' });
  },
  cena(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.32, n: 4, bright: 0.38, color: [255, 220, 185], gcs: 40 });
    // Das verbogene Staubband der gefressenen Spiralgalaxie, mit jungen Sternen am Rand
    const lane = 0.35, { ctx, R } = P;
    ctx.save();
    ctx.rotate(lane);
    const path = off => {
      ctx.beginPath();
      for (let x = -0.62; x <= 0.62; x += 0.04) {
        const y = Math.sin(x * 4) * 0.045 + off;
        if (x === -0.62) ctx.moveTo(x * R, y * R);
        else ctx.lineTo(x * R, y * R);
      }
    };
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    for (const [w, a] of [[0.24, 0.4], [0.14, 0.6], [0.07, 0.7]]) {
      ctx.strokeStyle = rgba(DUST, a);
      ctx.lineWidth = w * R;
      path(0);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i++) {
      const x = (P.rng() * 2 - 1) * 0.55, side = i % 2 ? 1 : -1;
      glow(P, x * R, (Math.sin(x * 4) * 0.045 + side * 0.07) * R, R * (0.01 + P.rng() * 0.02), i % 3 ? PINK : ICE, 0.55);
    }
    ctx.restore();
    return finish(rng, [layer(P.c, 1.5)], {
      // Jets laufen entlang der lokalen y-Achse — also senkrecht zum Band, das entlang x liegt
      jets: { len: 2.8, width: 0.07, color: [150, 190, 255], sides: 2, rot: lane }, tint: '#ffe0c0',
    });
  },
  m87(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.4, n: 4, bright: 0.42, color: [255, 228, 200], gcs: 220, stars: 3000, extent: 0.98 });
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.92 }), shine('#fff4e6', 0.4, 0.8)], {
      jets: { len: 1.8, width: 0.045, color: [150, 190, 255], sides: 1, rot: rng() * TAU, knots: true }, tint: '#ffeedd',
    });
  },
  seyfert(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    spiral(P, { arms: 2, twist: 3, bar: 0.18, dust: 0.45, knots: 0.6, coreSize: 0.1 });
    return finish(rng, [layer(P.c, 1.6, { tilt: 0.8, spin: spinOf(rng) }), shine('#ffffff', 0.3, 0.9)], {
      flare: { color: '#eaf6ff', size: 0.55, spikes: 4, pulse: 0.15, rate: 2.2 },
    });
  },
  radio(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.3, n: 4, bright: 0.45, gcs: 15, stars: 1500 });
    // Radiokeulen in Falschfarben: Jets, die nach Hunderttausenden Lichtjahren aufplatzen
    const L = canvasFor(seed, rng, lite);
    L.ctx.globalCompositeOperation = 'lighter';
    L.ctx.strokeStyle = rgba([255, 190, 130], 0.5);
    L.ctx.lineWidth = L.R * 0.012;
    L.ctx.beginPath();
    L.ctx.moveTo(-L.R * 0.66, 0);
    L.ctx.lineTo(L.R * 0.66, 0);
    L.ctx.stroke();
    gas(L, [[-0.7, 0, 0.2], [0.7, 0, 0.2], [-0.82, 0.06, 0.12, 0.8], [0.84, -0.06, 0.12, 0.8]], [255, 105, 55], 1.5, { freq: 4 });
    gas(L, [[-0.86, 0.02, 0.07], [0.88, -0.02, 0.07]], [255, 220, 150], 1.6, { freq: 6, seed: 3 });
    return finish(rng, [layer(L.c, 3.4, { rot: rng() * TAU }), layer(P.c, 1.0, { tilt: 0.8 }), shine('#fff0dc', 0.35, 0.8)], { extent: 1.2, tint: '#ffc8a8' });
  },
  blazar(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.25, n: 4, bright: 0.3, stars: 1200 });
    return finish(rng, [layer(P.c, 1.1, { tilt: 0.9 })], {
      flare: { color: '#dff0ff', size: 1.3, spikes: 6, pulse: 0.45, rate: 5 }, tint: '#d6ecff', thumb: 0.2,
    });
  },

  // --- Wechselwirkungen ----------------------------------------------------------------
  pair(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    const a = miniSpiral(P, P.R, { arms: 2, twist: 3 }), b = miniSpiral(P, P.R, { arms: 2, twist: 2.4, bar: 0.25 });
    tail(P, -0.25, 0.08, 0, -0.12, 0.25, -0.1, { width: 0.03, stars: 400, haze: 0.6 });
    put(P, a, -0.42, 0.12, 0.5, rng() * TAU, 0.75);
    put(P, b, 0.44, -0.14, 0.45, rng() * TAU, 0.6);
    return finish(rng, [layer(P.c, 1.7, { spin: spinOf(rng, 0.01) })]);
  },
  mice(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    tail(P, -0.18, -0.2, -0.36, 0.32, -0.22, 0.94, { width: 0.05, stars: 1800, knots: 6 });
    tail(P, 0.2, 0.18, 0.42, -0.3, 0.3, -0.92, { width: 0.05, stars: 1800, knots: 6 });
    const a = miniSpiral(P, P.R * 0.6, { arms: 2, twist: 2.5, stars: 2000 }), b = miniSpiral(P, P.R * 0.6, { arms: 2, twist: 2.2, stars: 2000 });
    put(P, a, -0.18, -0.2, 0.3, rng() * TAU, 0.5);
    put(P, b, 0.2, 0.18, 0.28, rng() * TAU, 0.6);
    return finish(rng, [layer(P.c, 1.7, { spin: spinOf(rng, 0.008) })]);
  },
  tadpole(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    tail(P, -0.35, 0.05, 0.25, -0.28, 0.95, 0.05, { width: 0.055, stars: 2600, knots: 10, taper: 1 });
    glow(P, P.R * 0.22, -P.R * 0.12, P.R * 0.06, ICE, 0.7);
    put(P, miniSpiral(P, P.R * 0.8, { arms: 2, twist: 3, knots: 0.8 }), -0.42, 0.05, 0.38, rng() * TAU, 0.8);
    return finish(rng, [layer(P.c, 1.7, { spin: spinOf(rng, 0.006) })]);
  },
  antennae(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    tail(P, -0.12, -0.05, -0.8, -0.5, -0.55, 0.85, { width: 0.045, stars: 1800, knots: 4 });
    tail(P, 0.12, 0.08, 0.85, 0.4, 0.5, -0.85, { width: 0.045, stars: 1800, knots: 4 });
    const core = o => miniIrregular(P, P.R * 0.55, { clumps: 5, nebulae: 9, col: [255, 196, 175], ...o });
    put(P, core({}), -0.1, -0.06, 0.26, rng() * TAU);
    put(P, core({ clumps: 6 }), 0.1, 0.08, 0.24, rng() * TAU);
    shadow(P, 0, 0, P.R * 0.1, 0.6, 0.6, 0.5);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.006) })], { tint: '#ffd6c8' });
  },
  merger(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    irregular(P, { clumps: 10, spread: 0.8, flat: 0.8, nebulae: 14, col: [190, 200, 255] });
    glow(P, -P.R * 0.08, P.R * 0.03, P.R * 0.12, WARM, 0.9);
    glow(P, P.R * 0.1, -P.R * 0.04, P.R * 0.1, WARM, 0.9);
    for (let i = 0; i < 5; i++) shadow(P, P.g() * P.R * 0.2, P.g() * P.R * 0.2, P.R * (0.04 + P.rng() * 0.05), 0.6, 0.5, P.rng() * TAU);
    tail(P, 0, 0, -0.6, 0.2, -0.85, -0.3, { width: 0.04, stars: 900 });
    tail(P, 0, 0, 0.5, -0.4, 0.8, 0.35, { width: 0.04, stars: 900 });
    shells(P, [0.6, 0.75], [200, 210, 255], 0.1);
    return finish(rng, [layer(P.c, 1.7, { tilt: 0.85, spin: spinOf(rng, 0.01) }), shine('#ffe6c4', 0.35, 0.5)]);
  },

  // --- Riesen ------------------------------------------------------------------------
  cd(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    elliptical(P, { re: 0.2, n: 6, bright: 0.4, extent: 0.98, gcs: 120, color: [255, 220, 190] });
    const snack = miniElliptical(P, P.R * 0.2, { re: 0.3, n: 2, bright: 0.6 });
    for (let i = 0; i < 7; i++) {
      // Begleiter, die gerade gefressen werden: mit Schweif Richtung Zentrum
      const a = P.rng() * TAU, r = 0.45 + P.rng() * 0.4, x = Math.cos(a) * r, y = Math.sin(a) * r;
      tail(P, x, y, x * 0.8 + P.g() * 0.05, y * 0.8 + P.g() * 0.05, x * 0.55, y * 0.55, { width: 0.015, stars: 120, color: OLD });
      put(P, snack, x, y, 0.05 + P.rng() * 0.03, P.rng() * TAU, 0.8);
    }
    return finish(rng, [layer(P.c, 1.8, { tilt: 0.85, spin: spinOf(rng, 0.004) }), shine('#ffeedd', 0.45, 0.7)], { tint: '#ffe6cc' });
  },
  ic1101(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    glow(P, 0, 0, P.R * 0.98, [255, 200, 150], 0.14, 0.45);
    elliptical(P, { re: 0.35, n: 5, bright: 0.2, extent: 1, gcs: 160, color: [255, 214, 170], stars: 5000, conc: 1.4 });
    return finish(rng, [layer(P.c, 2.2, { tilt: 0.7, spin: spinOf(rng, 0.003) }), shine('#ffe6c8', 0.6, 0.8, { tilt: 0.75 })], { tint: '#ffe2c0', extent: 1.4 });
  },

  // --- Gruppen und Haufen ----------------------------------------------------------------
  localgroup(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    glow(P, 0, 0, P.R * 0.9, [140, 160, 255], 0.06, 0.4);
    const mw = miniSpiral(P, P.R * 0.8, { arms: 4, bar: 0.25, twist: 2.1, weights: [1, 0.5] });
    const m31 = miniSpiral(P, P.R * 0.9, { arms: 2, twist: 5, rings: [0.45, 0.65], coreSize: 0.22 });
    const m33 = miniSpiral(P, P.R * 0.4, { arms: 2, twist: 2.2, flocc: 0.6, knots: 1.2 });
    const dw = miniElliptical(P, P.R * 0.12, { re: 0.4, n: 1, bright: 0.3 });
    for (let i = 0; i < 26; i++) {
      const host = i % 2 ? [-0.42, 0.18] : [0.4, -0.22], a = P.rng() * TAU, r = 0.12 + P.rng() * 0.3;
      put(P, dw, host[0] + Math.cos(a) * r, host[1] + Math.sin(a) * r, 0.02 + P.rng() * 0.025, 0, 0.8);
    }
    put(P, mw, -0.42, 0.18, 0.36, rng() * TAU, 0.85);
    put(P, m31, 0.4, -0.22, 0.42, 0.7, 0.32);
    put(P, m33, 0.62, 0.38, 0.16, rng() * TAU, 0.7);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })]);
  },
  quintet(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    const { ctx, R } = P;
    // Die Stoßfront zwischen den Galaxien leuchtet (im Röntgen- und Infrarotlicht)
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [w, a] of [[0.1, 0.06], [0.04, 0.12]]) {
      ctx.strokeStyle = rgba(TEAL, a);
      ctx.lineWidth = w * R;
      ctx.beginPath();
      ctx.moveTo(0.22 * R, -0.55 * R);
      ctx.quadraticCurveTo(0.34 * R, -0.1 * R, 0.25 * R, 0.3 * R);
      ctx.stroke();
    }
    tail(P, 0.08, 0.12, -0.2, -0.2, -0.45, -0.45, { width: 0.04, stars: 700 });
    const big = miniSpiral(P, P.R * 0.9, { arms: 2, twist: 2, flocc: 0.5, arm: [150, 190, 255], knots: 1 });
    const s1 = miniSpiral(P, P.R * 0.6, { arms: 2, twist: 3, dust: 0.5 });
    const s2 = miniSpiral(P, P.R * 0.5, { arms: 2, twist: 3.5, bar: 0.3 });
    const e1 = miniElliptical(P, P.R * 0.4, { re: 0.3, n: 4, bright: 0.5 });
    put(P, big, -0.35, 0.35, 0.32, rng() * TAU, 0.7);
    put(P, s1, 0.15, -0.2, 0.21, rng() * TAU, 0.6);
    put(P, s2, 0.42, -0.02, 0.18, rng() * TAU, 0.5);
    put(P, e1, 0.06, 0.12, 0.15, 0, 0.8);
    put(P, e1, 0.55, -0.48, 0.12, 1, 0.7);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })]);
  },
  sextet(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    glow(P, 0, 0, P.R * 0.85, OLD, 0.12, 0.4);
    const e = [0, 1, 2].map(i => miniElliptical(P, P.R * 0.6, { re: 0.28, n: 2 + i, q: 0.5 + i * 0.2, bright: 0.55 }));
    const s = miniSpiral(P, P.R * 0.7, { arms: 2, twist: 3, stars: 1800 });
    const pos = [[-0.36, -0.16, 0.24], [0.04, -0.4, 0.22], [0.4, -0.04, 0.26], [-0.08, 0.28, 0.2], [0.3, 0.4, 0.17]];
    pos.forEach(([x, y, sz], i) => put(P, e[i % 3], x, y, sz, P.rng() * TAU, 0.8));
    put(P, s, -0.44, 0.4, 0.22, rng() * TAU, 0.9, 0.7);
    tail(P, -0.36, -0.16, 0, -0.1, 0.4, -0.04, { width: 0.04, stars: 500, color: OLD, haze: 0.6 });
    return finish(rng, [layer(P.c, 1.5, { spin: spinOf(rng, 0.006) })], { tint: '#ffe6cc' });
  },
  cluster(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0, 0, 0.55]], XRAY, 0.55);
    crowd(P, lite ? 24 : 40);
    put(P, miniElliptical(P, P.R * 0.6, { re: 0.25, n: 5, bright: 0.6 }), 0, 0, 0.18);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#e6d8ff' });
  },
  virgo(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0.05, 0, 0.5], [-0.3, 0.25, 0.25, 0.5]], [120, 140, 255], 0.5);
    crowd(P, lite ? 28 : 48, { spirals: 0.45, spread: 0.42 });
    // M87 in der Mitte — samt Jet
    put(P, miniElliptical(P, P.R * 0.6, { re: 0.3, n: 4, bright: 0.7, gcs: 30 }), 0.05, 0, 0.2);
    const { ctx, R } = P;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba([170, 205, 255], 0.55);
    ctx.lineWidth = R * 0.006;
    ctx.beginPath();
    ctx.moveTo(0.05 * R, 0);
    ctx.lineTo(0.17 * R, -0.07 * R);
    ctx.stroke();
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#d8e0ff' });
  },
  coma(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0, 0, 0.62]], XRAY, 0.7);
    crowd(P, lite ? 36 : 72, { spirals: 0.08, spread: 0.4 });
    const cd = miniElliptical(P, P.R * 0.6, { re: 0.25, n: 5, bright: 0.65, gcs: 20 });
    put(P, cd, -0.08, 0.02, 0.17);
    put(P, cd, 0.1, -0.03, 0.15, 1.2, 0.8);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#ffe6c8' });
  },
  lens(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0, 0, 0.45]], [140, 110, 255], 0.4);
    crowd(P, lite ? 22 : 36, { spread: 0.32 });
    put(P, miniElliptical(P, P.R * 0.5, { re: 0.25, n: 5, bright: 0.6 }), 0, 0, 0.15);
    // Gravitationsbögen: verzerrte Bilder einer Galaxie weit dahinter
    const { ctx, R } = P;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const r = (0.22 + P.rng() * 0.42) * R, a = P.rng() * TAU, len = 0.25 + P.rng() * 0.5;
      for (const [w, al] of [[0.022, 0.14], [0.008, 0.55]]) {
        ctx.strokeStyle = rgba(i % 3 ? ICE : [255, 200, 230], al);
        ctx.lineWidth = w * R;
        ctx.beginPath();
        ctx.arc(0, 0, r, a, a + len);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = rgba(ICE, 0.18);
    ctx.lineWidth = 0.006 * R;
    ctx.beginPath();
    ctx.arc(0, 0, 0.16 * R, 0, TAU);
    ctx.stroke();
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#dce4ff' });
  },
  bullet(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    // Blau: wo die Masse ist (Dunkle Materie). Pink: wo das Gas ist. Die beiden passen nicht zusammen.
    gas(P, [[-0.36, 0, 0.3], [0.4, 0.05, 0.22]], [70, 120, 255], 0.6, { seed: 1 });
    gas(P, [[-0.12, 0, 0.26], [0.18, 0.02, 0.14, 1.3]], [255, 90, 160], 1.1, { seed: 2 });
    crowd(P, lite ? 16 : 26, { cx: -0.36, spread: 0.18, scale: 0.9 });
    crowd(P, lite ? 10 : 16, { cx: 0.4, cy: 0.05, spread: 0.13, scale: 0.8 });
    const { ctx, R } = P;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba([255, 140, 200], 0.3);
    ctx.lineWidth = R * 0.01;
    ctx.beginPath();
    ctx.arc(0.08 * R, 0.02 * R, 0.2 * R, -0.9, 0.9);
    ctx.stroke();
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#ffc8e6' });
  },

  // --- Großräumige Struktur -------------------------------------------------------------
  supercluster(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    const nodes = web(P, { nodes: 12, minDist: 0.24, k: 3, maxLen: 0.7, dots: 900, color: [140, 150, 255], node: GOLD, nodeSize: 1.8 });
    gas(P, nodes.map(m => [m.x / P.R, m.y / P.R, 0.12, m.m]), GOLD, 0.6);
    const dot = miniElliptical(P, P.R * 0.1, { re: 0.4, n: 2, bright: 0.6 });
    for (const m of nodes) for (let i = 0; i < 9; i++) put(P, dot, m.x / P.R + P.g() * 0.05, m.y / P.R + P.g() * 0.05, 0.015 + P.rng() * 0.02);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#ffe4c0' });
  },
  laniakea(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[-0.1, 0.1, 0.35], [0.4, -0.3, 0.25, 0.6], [-0.5, -0.4, 0.25, 0.6], [0.3, 0.5, 0.2, 0.5]], [255, 150, 70], 0.55);
    gas(P, [[0.5, 0.1, 0.3], [-0.3, 0.6, 0.3], [-0.6, 0.1, 0.25]], [60, 100, 255], 0.35, { seed: 4 });
    flow(P, { ax: -0.12, ay: 0.08, lines: 90, swirl: 0.8, color: [235, 240, 255] });
    // Du bist hier.
    glow(P, 0.58 * P.R, 0.32 * P.R, P.R * 0.05, AMBER, 0.9);
    P.ctx.strokeStyle = rgba(AMBER, 0.9);
    P.ctx.lineWidth = P.R * 0.008;
    P.ctx.beginPath();
    P.ctx.arc(0.58 * P.R, 0.32 * P.R, P.R * 0.04, 0, TAU);
    P.ctx.stroke();
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })], { tint: '#f0e6ff' });
  },
  attractor(seed, rng, lite) {
    // The Great Attractor: Hunderte Galaxien strömen auf Spiralbahnen zum Norma-Haufen.
    // Genau davor liegt die Scheibe der Milchstraße und versperrt die Sicht.
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0, 0, 0.3, 1.4], [0.35, -0.2, 0.22, 0.6], [-0.3, 0.35, 0.25, 0.5], [-0.45, -0.3, 0.2, 0.4]], [255, 150, 70], 0.7);
    gas(P, [[0.55, 0.4, 0.3], [-0.6, 0.05, 0.25], [0.1, -0.65, 0.25]], [60, 100, 255], 0.35, { seed: 6 });
    flow(P, { lines: 150, twist: 0.55, swirl: 0.5, color: [235, 238, 255] });
    const infall = miniSpiral(P, P.R * 0.16, { arms: 2, stars: 500 });
    for (let i = 0; i < 16; i++) {
      const a = P.rng() * TAU, r = 0.3 + P.rng() * 0.6;
      put(P, infall, Math.cos(a) * r, Math.sin(a) * r, 0.025 + P.rng() * 0.02, P.rng() * TAU, 0.6);
    }
    glow(P, 0, 0, P.R * 0.2, GOLD, 0.95);
    crowd(P, lite ? 14 : 30, { spread: 0.09, scale: 0.7 });
    glow(P, 0, 0, P.R * 0.05, WHITE, 1);

    const { ctx, R, g } = P;
    ctx.save();
    ctx.rotate(0.35);
    ctx.globalCompositeOperation = 'source-over';
    const band = ctx.createLinearGradient(0, -0.2 * R, 0, 0.2 * R);
    band.addColorStop(0, 'rgba(6,4,3,0)');
    band.addColorStop(0.5, 'rgba(6,4,3,0.85)');
    band.addColorStop(1, 'rgba(6,4,3,0)');
    ctx.fillStyle = band;
    ctx.fillRect(-R, -0.2 * R, R * 2, 0.4 * R);
    // Staubschwaden in der Milchstraßenscheibe
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const y0 = g() * 0.04 * R, amp = 0.02 * R + P.rng() * 0.03 * R, ph = P.rng() * TAU;
      ctx.strokeStyle = rgba([60, 26, 14], 0.35 + P.rng() * 0.25);
      ctx.lineWidth = R * (0.01 + P.rng() * 0.02);
      ctx.beginPath();
      for (let x = -1; x <= 1.001; x += 0.05) {
        const y = y0 + Math.sin(x * 5 + ph) * amp;
        if (x === -1) ctx.moveTo(x * R, y);
        else ctx.lineTo(x * R, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(WARM, 0.1);
    ctx.lineWidth = R * 0.07;
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.lineTo(R, 0);
    ctx.stroke();
    scatter(P, 6000, p => {
      p.x = (P.rng() * 2 - 1) * R;
      p.y = g() * 0.06 * R;
    }, [[WHITE, 0.5], [WARM, 0.3], [[255, 190, 160], 0.2]], [0.5, 1.4], [0.2, 0.8]);
    ctx.restore();
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#ffe8c8' });
  },
  wall(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    web(P, { nodes: 22, haze: 0.4, dots: 150, color: [120, 130, 230] });
    const { ctx, R, g } = P;
    // Ein riesiger Bogen aus Galaxien quer durchs Bild
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const [w, a] of [[0.16, 0.05], [0.06, 0.1]]) {
      ctx.strokeStyle = rgba(GOLD, a);
      ctx.lineWidth = w * R;
      ctx.beginPath();
      ctx.arc(0, 0.95 * R, 1.15 * R, -2.45, -0.7);
      ctx.stroke();
    }
    scatter(P, 7000, p => {
      const a = -2.45 + P.rng() * 1.75, r = 1.15 * R + g() * 0.045 * R;
      p.x = Math.cos(a) * r;
      p.y = 0.95 * R + Math.sin(a) * r;
    }, [[WHITE, 0.5], [GOLD, 0.5]], [0.6, 1.6], [0.3, 0.9]);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#ffe4b8' });
  },
  filament(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[-0.5, -0.25, 0.22], [0, -0.05, 0.25], [0.5, 0.22, 0.22]], TEAL, 0.5);
    tail(P, -0.92, -0.42, 0, -0.1, 0.92, 0.45, { width: 0.06, stars: 6000, color: [170, 160, 255], taper: 1 });
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6, x = -0.92 + t * 1.84, y = -0.42 * (1 - t) ** 2 - 0.2 * t * (1 - t) + 0.45 * t * t;
      glow(P, x * P.R, y * P.R, P.R * (0.04 + P.rng() * 0.04), GOLD, 0.8);
      tail(P, x, y, x + P.g() * 0.2, y + 0.3 * (i % 2 ? 1 : -1), x + P.g() * 0.3, y + 0.55 * (i % 2 ? 1 : -1), { width: 0.02, stars: 500, color: VIOLET });
    }
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.003) })], { tint: '#d8d0ff' });
  },
  web(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    gas(P, [[0, 0, 0.8]], [90, 60, 200], 0.18);
    web(P, { nodes: 42, minDist: 0.13, k: 3, color: [150, 95, 255], node: [255, 200, 120], dots: 600 });
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })], { tint: '#d6c8ff' });
  },
  void(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    web(P, { nodes: 34, hole: 0.5, minDist: 0.11, color: [130, 100, 240], dots: 500 });
    // Drei einsame Galaxien mitten im Nichts
    const lone = miniSpiral(P, P.R * 0.2, { arms: 2, stars: 600 });
    for (let i = 0; i < 3; i++) put(P, lone, P.g() * 0.18, P.g() * 0.18, 0.04, P.rng() * TAU, 0.7);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })], { tint: '#cfc4ff' });
  },

  // --- Das Ende ------------------------------------------------------------------------
  universe(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    web(P, { nodes: 46, radius: 0.78, minDist: 0.1, k: 3, color: [150, 100, 255], node: [255, 205, 130], dots: 420 });
    cmb(P, 0.84, 0.97);
    glow(P, 0, 0, P.R * 0.04, AMBER, 1);
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })], { tint: '#ffd8b0' });
  },
  multiverse(seed, rng, lite) {
    const P = canvasFor(seed, rng, lite);
    const tones = [
      [[150, 100, 255], [255, 205, 130], [40, 90, 210], [255, 120, 40]],
      [[90, 210, 230], [255, 240, 200], [30, 140, 160], [255, 220, 120]],
      [[255, 110, 170], [255, 230, 200], [120, 50, 160], [255, 160, 90]],
      [[140, 255, 170], [255, 255, 220], [30, 120, 90], [200, 255, 120]],
    ];
    const bubbles = [[0, 0, 0.42], [-0.55, -0.35, 0.28], [0.55, -0.3, 0.3], [-0.45, 0.52, 0.24], [0.5, 0.55, 0.22], [0.05, -0.72, 0.18], [-0.82, 0.05, 0.13], [0.84, 0.12, 0.12]];
    bubbles.forEach(([x, y, r], i) => {
      const t = tones[i % tones.length];
      const u = sub(P, P.R * r * 2, s => {
        web(s, { nodes: 12, radius: 0.72, minDist: 0.2, color: t[0], node: t[1], dots: 260 });
        cmb(s, 0.8, 0.97, { cold: t[2], hot: t[3] });
      });
      put(P, u, x, y, r, P.rng() * TAU);
      // Blasenhaut mit Glanzlicht
      const { ctx, R } = P;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(WHITE, 0.22);
      ctx.lineWidth = R * 0.006;
      ctx.beginPath();
      ctx.arc(x * R, y * R, r * R, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, 0.45);
      ctx.lineWidth = R * 0.012;
      ctx.beginPath();
      ctx.arc(x * R, y * R, r * R * 0.86, -2.6, -1.9);
      ctx.stroke();
    });
    return finish(rng, [layer(P.c, 1.8, { spin: spinOf(rng, 0.004) })], { tint: '#e8d8ff' });
  },
  orbiteater(seed, rng, lite) {
    // Die letzte Stufe ist das Logo des Spiels: im O ein ganzes Universum, dahinter das
    // kosmische Netz, außen herum die eigene Vergangenheit (Renderer: drawLogo)
    const P = canvasFor(seed, rng, lite);
    web(P, { nodes: 30, radius: 0.92, minDist: 0.13, color: [150, 100, 255], node: [255, 205, 130], dots: 300, haze: 0.7 });
    const U = canvasFor(seed, rng, lite, 0.5);
    web(U, { nodes: 14, radius: 0.74, minDist: 0.17, color: [150, 100, 255], node: [255, 205, 130], dots: 320 });
    cmb(U, 0.82, 0.97);
    return finish(rng, [
      layer(P.c, 2.5, { spin: spinOf(rng, 0.004), alpha: 0.45 }),
      shine('#ffe2b0', 1.7, 0.18),
      layer(U.c, 0.64, { spin: spinOf(rng, 0.03) }),
    ], {
      logo: { ring: 0.8, width: 0.34, orbit: 1.22, outer: 1.85, dot: 0.15, speed: 0.55, phase: rng() * TAU },
      tint: '#ffb347', extent: 2.1, thumb: 0.26,
    });
  },
};
