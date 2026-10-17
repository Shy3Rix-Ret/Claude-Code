/**
 * Prozedurale Grafik.
 *
 * Es gibt im ganzen Spiel keine einzige Bilddatei: Planetenoberflächen,
 * Gasbänder, Kraterfelder, Sternfelder, Nebel und die Akkretionsscheibe
 * der Schwarzen Löcher werden hier beim Start bzw. bei Bedarf aus Rauschen
 * berechnet und als Offscreen-Canvas gecacht.
 *
 * Kugeltexturen sind "Streifen" (3H × H): 2H breit entspricht 360° Länge,
 * die ersten H Spalten werden hinten noch einmal angehängt. So kann der
 * Renderer jedes H-breite Fenster (= sichtbare Halbkugel) in einem Stück
 * herausschneiden und die Textur endlos scrollen — der Planet dreht sich.
 * Die Zeilen sind nach Breitengrad verteilt (y ∝ sin φ), dadurch sitzen
 * Muster ohne weitere Verzerrung korrekt auf der Kugel.
 */
import { ASTEROID } from './config.js';
import { TAU, clamp, lerp, fbm, valueNoise, hexToRgb, mixRgb, mulberry32, smoothstep } from './utils.js';

export const STRIP_H = 128;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// --- Paletten ----------------------------------------------------------------

const rgbAll = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? v.map(hexToRgb) : typeof v === 'string' && v[0] === '#' ? hexToRgb(v) : v;
    out[k + 'Hex'] = v;
  }
  return out;
};

const ROCK = [
  { dark: '#2c2724', base: '#6b6058', light: '#a89a8c' },
  { dark: '#262b31', base: '#5d6670', light: '#9aa6b0' },
  { dark: '#2f2119', base: '#7a5a45', light: '#b9937a' },
  { dark: '#23211f', base: '#57524c', light: '#8f8880' },
].map(rgbAll);

const MOON = [
  { dark: '#5a5650', base: '#a9a49a', light: '#dcd6cb', mare: '#6f6a62' },
  { dark: '#545b62', base: '#9ea6ad', light: '#d3d9de', mare: '#68707a' },
  { dark: '#62584a', base: '#b3a58f', light: '#e0d3bc', mare: '#7a6d5a' },
].map(rgbAll);

const PLANET = [
  { deep: '#0b2545', shallow: '#1d5f8a', low: '#3f6b35', high: '#8a7a4a', peak: '#cbbf98', ice: '#eef3f5', atmo: '#7fc8ff' },
  { deep: '#0f3436', shallow: '#1f7f78', low: '#7a4a2e', high: '#b07a4a', peak: '#e0c08a', ice: '#f4efe6', atmo: '#8fe3d0' },
  { deep: '#1d1638', shallow: '#3d3478', low: '#5f7f62', high: '#a8a878', peak: '#dcd6a8', ice: '#f0eefa', atmo: '#b9a8ff' },
  { deep: '#2a100c', shallow: '#5a2416', low: '#a2482a', high: '#cf7d4a', peak: '#efc08a', ice: '#fbe9d8', atmo: '#ffab7a' },
].map(rgbAll);

const GIANT = [
  { bands: ['#efe0c0', '#c99a68', '#a7643f', '#f4e9d2', '#8a4b30'], storm: '#b5502e', ring: '#d8c4a0' },
  { bands: ['#d6e6f6', '#7fa6d8', '#3f66b0', '#eaf2fa', '#2b4a8a'], storm: '#1d2f66', ring: '#a8c0e0' },
  { bands: ['#efdcaa', '#cfae6a', '#a5844a', '#f7ebc8', '#7a5c34'], storm: '#f5e6b8', ring: '#e6d2a0' },
  { bands: ['#c9ece2', '#6fb8a8', '#2f7f78', '#e2f6ef', '#1f5a55'], storm: '#e8fff8', ring: '#a8d8cc' },
].map(rgbAll);

const STAR = [
  { core: '#fff8e6', mid: '#ffd27a', edge: '#f08a32', corona: '#ffb347' },
  { core: '#ffffff', mid: '#dce8ff', edge: '#7f9cff', corona: '#9fc0ff' },
  { core: '#fff0e0', mid: '#ff9a62', edge: '#c8402a', corona: '#ff6a4a' },
  { core: '#fffdf0', mid: '#fff0a8', edge: '#ffbf40', corona: '#ffe08a' },
].map(rgbAll);

// --- Pixel-Helfer ---------------------------------------------------------------

function paint(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      out[3] = 255;
      fn(x, y, out);
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Legt einen Kugelstreifen an; `fn(u, v, out)` bekommt Länge u und Breite v (je 0..1). */
function sphereStrip(fn) {
  const H = STRIP_H, W = H * 2;
  const c = makeCanvas(W + H, H);
  const ctx = c.getContext('2d');
  const lat = new Float32Array(H);
  for (let y = 0; y < H; y++) lat[y] = Math.asin(clamp(((y + 0.5) / H) * 2 - 1, -1, 1)) / Math.PI + 0.5;
  paint(ctx, W, H, (x, y, out) => fn(x / W, lat[y], out));
  return { c, ctx, W, H };
}

/** Hängt die ersten H Spalten hinten an → nahtloses Scrollen. */
function closeStrip(s) {
  s.ctx.drawImage(s.c, 0, 0, s.H, s.H, s.W, 0, s.H, s.H);
  return s.c;
}

/** Breite v (0..1) → Pixelzeile im Streifen, plus horizontale Dehnung (1/cos φ). */
function latToY(v, H) {
  const phi = (v - 0.5) * Math.PI;
  return { y: (Math.sin(phi) * 0.5 + 0.5) * H, stretch: 1 / Math.max(0.25, Math.cos(phi)) };
}

/** Zeichnet etwas an x und — falls es über den Rand ragt — zusätzlich um eine Periode versetzt. */
function wrapDraw(W, x, r, fn) {
  fn(x);
  if (x - r < 0) fn(x + W);
  if (x + r > W) fn(x - W);
}

const rgbStr = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Krater, Licht von links oben: Mulde dunkel, Innenwand rechts unten hell. */
function crater(ctx, x, y, rx, ry, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(-0.3, -0.3, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 0.16;
  ctx.strokeStyle = rgbStr(light, 0.45);
  ctx.beginPath();
  ctx.arc(0, 0, 0.86, -0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = rgbStr(light, 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, 1.06, 0.9 * Math.PI, 1.6 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// --- Körper-Kunst je Stufe --------------------------------------------------------

/**
 * Erzeugt das Aussehen eines Körpers für eine Stufe. Deterministisch aus dem
 * Seed — derselbe Bot sieht nach einem Stufenwechsel "verwandt" aus.
 */
export function buildBodyArt(seed, stage) {
  const rng = mulberry32(seed + stage * 7919);
  switch (stage) {
    case 0: return rockArt(seed, rng);
    case 1: return moonArt(seed, rng);
    case 2: return planetArt(seed, rng);
    case 3: return giantArt(seed, rng);
    default: return starArt(seed, rng);
  }
}

function rockArt(seed, rng) {
  const p = ROCK[seed % ROCK.length];
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  paint(ctx, S, S, (x, y, out) => {
    const n = fbm((x / S) * 5, (y / S) * 5, seed, 5) * 0.75 + fbm((x / S) * 16, (y / S) * 16, seed + 9, 3) * 0.25;
    if (n < 0.5) mixRgb(p.dark, p.base, n * 2, out);
    else mixRgb(p.base, p.light, (n - 0.5) * 2, out);
  });
  for (let i = 0; i < 9; i++) {
    const r = 4 + rng() * 11;
    crater(ctx, 14 + rng() * (S - 28), 14 + rng() * (S - 28), r, r, p.light);
  }
  // Unregelmäßige Silhouette: Radius entlang des Umfangs aus Rauschen
  const n = 22;
  const shape = new Float32Array(n * 2);
  let max = 0;
  const radii = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = 0.8 + 0.34 * fbm(Math.cos(a) * 1.3 + 3, Math.sin(a) * 1.3 + 3, seed + 77, 3);
    radii.push(rr);
    max = Math.max(max, rr);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    shape[i * 2] = (Math.cos(a) * radii[i]) / max;
    shape[i * 2 + 1] = (Math.sin(a) * radii[i]) / max;
  }
  return { stage: 0, kind: 'rock', surface: c, shape, tint: p.baseHex, light: p.lightHex };
}

function moonArt(seed, rng) {
  const p = MOON[seed % MOON.length];
  const s = sphereStrip((u, v, out) => {
    const n = fbm(u * 8, v * 4, seed, 5, 8);
    const m = fbm(u * 3, v * 1.5, seed + 7, 3, 3);
    if (n < 0.5) mixRgb(p.dark, p.base, n * 2, out);
    else mixRgb(p.base, p.light, (n - 0.5) * 2, out);
    mixRgb(out, p.mare, smoothstep(0.5, 0.62, m) * 0.75, out);
  });
  for (let i = 0; i < 34; i++) {
    const v = 0.12 + rng() * 0.76;
    const { y, stretch } = latToY(v, s.H);
    const r = 2 + rng() * rng() * 13;
    wrapDraw(s.W, rng() * s.W, r * stretch, x => crater(s.ctx, x, y, r * stretch, r, p.light));
  }
  return { stage: 1, kind: 'sphere', surface: closeStrip(s), tint: p.baseHex, rate: 0.016 + rng() * 0.01 };
}

function planetArt(seed, rng) {
  const p = PLANET[seed % PLANET.length];
  const sea = 0.46 + rng() * 0.1;
  const tmp = [0, 0, 0];
  const s = sphereStrip((u, v, out) => {
    const h = fbm(u * 5, v * 2.5, seed, 5, 5);
    if (h < sea) {
      mixRgb(p.deep, p.shallow, smoothstep(sea - 0.2, sea, h), out);
    } else {
      const t = (h - sea) / (1 - sea);
      if (t < 0.45) mixRgb(p.low, p.high, t / 0.45, out);
      else mixRgb(p.high, p.peak, (t - 0.45) / 0.55, out);
      // feine Struktur auf Land
      const f = fbm(u * 20, v * 10, seed + 4, 2, 20) - 0.5;
      out[0] += f * 30; out[1] += f * 30; out[2] += f * 30;
    }
    const lat = Math.abs(v - 0.5) * 2;
    const ice = smoothstep(0.76, 0.86, lat + (fbm(u * 12, v * 6, seed + 3, 3, 12) - 0.5) * 0.25);
    mixRgb(out, p.ice, ice, tmp);
    out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
  });
  const cl = sphereStrip((u, v, out) => {
    const n = fbm(u * 5, v * 9, seed + 50, 5, 5);
    const lat = Math.abs(v - 0.5) * 2;
    out[0] = 255; out[1] = 255; out[2] = 255;
    out[3] = smoothstep(0.56, 0.8, n) * (0.5 + 0.5 * (1 - lat)) * 200;
  });
  return {
    stage: 2, kind: 'sphere', surface: closeStrip(s), clouds: closeStrip(cl),
    atmo: p.atmoHex, tint: p.shallowHex, rate: 0.022 + rng() * 0.012,
  };
}

function giantArt(seed, rng) {
  const p = GIANT[seed % GIANT.length];
  const bands = p.bands;
  const nb = bands.length;
  const freq = 5 + rng() * 4;
  const s = sphereStrip((u, v, out) => {
    const turb = fbm(u * 4, v * 6, seed, 4, 4);
    const pos = v * freq + (turb - 0.5) * 1.4 + Math.sin(u * TAU * 2 + v * 9) * 0.05;
    const i = Math.floor(pos);
    const a = bands[((i % nb) + nb) % nb], b = bands[(((i + 1) % nb) + nb) % nb];
    mixRgb(a, b, smoothstep(0.62, 1, pos - i), out);
    const streak = (fbm(u * 16, v * 48, seed + 5, 3, 16) - 0.5) * 46;
    out[0] += streak; out[1] += streak; out[2] += streak;
  });
  // Großer Sturm — wie der Rote Fleck
  const sv = 0.3 + rng() * 0.4;
  const { y, stretch } = latToY(sv, s.H);
  const rx = (8 + rng() * 7) * stretch, ry = 5 + rng() * 3;
  wrapDraw(s.W, rng() * s.W, rx, x => {
    const ctx = s.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgbStr(p.storm, 0.95));
    g.addColorStop(0.6, rgbStr(p.storm, 0.6));
    g.addColorStop(1, rgbStr(p.storm, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.62, 0.48, 0.2, 0, TAU);
    ctx.stroke();
    ctx.restore();
  });
  const ring = rng() < 0.8 ? {
    canvas: ringSprite(p.ring, seed),
    tilt: 0.2 + rng() * 0.16,
    rot: (rng() - 0.5) * 0.9,
    outer: 2.15,
  } : null;
  return { stage: 3, kind: 'sphere', surface: closeStrip(s), ring, tint: p.bandsHex[1], rate: 0.03 + rng() * 0.015 };
}

function starArt(seed, rng) {
  const p = STAR[seed % STAR.length];
  const s = sphereStrip((u, v, out) => {
    const g = fbm(u * 10, v * 5, seed, 5, 10);
    const fine = fbm(u * 36, v * 18, seed + 3, 3, 36);
    const t = clamp(g * 0.8 + fine * 0.35 - 0.08, 0, 1);
    if (t < 0.5) mixRgb(p.edge, p.mid, t * 2, out);
    else mixRgb(p.mid, p.core, (t - 0.5) * 2, out);
  });
  for (let i = 0; i < 3; i++) {
    const v = 0.3 + rng() * 0.4;
    const { y, stretch } = latToY(v, s.H);
    const r = 2 + rng() * 3;
    wrapDraw(s.W, rng() * s.W, r * stretch, x => {
      s.ctx.fillStyle = 'rgba(70,20,0,0.45)';
      s.ctx.beginPath();
      s.ctx.ellipse(x, y, r * stretch, r, 0, 0, TAU);
      s.ctx.fill();
    });
  }
  return {
    stage: 4, kind: 'star', surface: closeStrip(s),
    corona: p.coronaHex, edge: p.edgeHex, core: p.coreHex, tint: p.midHex, rate: 0.012 + rng() * 0.008,
    flare: rng() * TAU,
  };
}

/** Ringsystem als Kreisscheibe — wird beim Zeichnen gestaucht und in Vorder-/Rückseite geteilt. */
function ringSprite(color, seed) {
  const S = 256, R = S / 2, inner = 0.62;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [cr, cg, cb] = color;
  paint(ctx, S, S, (x, y, out) => {
    const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
    if (d < inner || d > 1) { out[3] = 0; return; }
    const t = (d - inner) / (1 - inner);
    const band = valueNoise(t * 24, 0.5, seed) * 0.6 + valueNoise(t * 90, 1.5, seed + 1) * 0.4;
    const gap = 1 - Math.exp(-(((t - 0.58) / 0.035) ** 2)) * 0.9;
    const edge = smoothstep(0, 0.06, t) * (1 - smoothstep(0.88, 1, t));
    const shade = 0.75 + 0.25 * band;
    out[0] = cr * shade; out[1] = cg * shade; out[2] = cb * shade;
    out[3] = 255 * band * gap * edge * 0.85;
  });
  return c;
}

// --- Trümmer ------------------------------------------------------------------------

/** Kleine Asteroiden-Sprites mit eingebackenem Licht (sie sind klein, das fällt beim Drehen nicht auf). */
export function buildAsteroidSprites() {
  const list = [];
  for (let v = 0; v < ASTEROID.variants; v++) {
    const seed = 1000 + v * 37;
    const p = ROCK[v % ROCK.length];
    const S = 48, R = 20;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.translate(S / 2, S / 2);
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = R * (0.74 + 0.3 * valueNoise(Math.cos(a) * 1.4 + 4, Math.sin(a) * 1.4 + 4, seed));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const lg = ctx.createLinearGradient(-R, -R, R, R);
    lg.addColorStop(0, p.lightHex);
    lg.addColorStop(0.5, p.baseHex);
    lg.addColorStop(1, p.darkHex);
    ctx.fillStyle = lg;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    const rng = mulberry32(seed);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.22)' : rgbStr(p.light, 0.18);
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * 2 * R, (rng() - 0.5) * 2 * R, 0.8 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    crater(ctx, (rng() - 0.5) * R, (rng() - 0.5) * R, 4 + rng() * 3, 4 + rng() * 3, p.light);
    const sh = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.1);
    sh.addColorStop(0, 'rgba(255,250,240,0.18)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = sh;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    ctx.restore();
    list.push(c);
  }
  return list;
}

// --- Leuchten -------------------------------------------------------------------------

const glowCache = new Map();

/** Weicher Lichtpunkt — für additive Glows, Auren, Partikel. */
export function glowSprite(hex, size = 64) {
  const key = hex + size;
  let c = glowCache.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const R = size / 2;
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.16)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

/**
 * Aura-Ring: leuchtet direkt am Körperrand und läuft nach außen aus.
 * Der Körper deckt die Mitte ab — sichtbar bleibt ein farbiger Saum,
 * der auch auf kleinen Körpern sofort lesbar ist (rot = Gefahr, grün = Beute).
 */
const auraCache = new Map();
export function auraSprite(hex, inner = 0.55) {
  let c = auraCache.get(hex);
  if (c) return c;
  const S = 128, R = S / 2;
  c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(inner - 0.06, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(inner, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(inner + 0.1, `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  auraCache.set(hex, c);
  return c;
}

/** Staubkorn: heller Kern, kleiner Hof. */
export function dustSprite(hex) {
  const S = 24, R = S / 2;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  const hi = c => Math.round(c + (255 - c) * 0.55);
  grad.addColorStop(0, `rgba(${hi(r)},${hi(g)},${hi(b)},1)`);
  grad.addColorStop(0.2, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.32, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  return c;
}

/** Akkretionsscheibe eines Schwarzen Lochs: heiß innen, glühend rot außen, mit Schlieren. */
export function buildBlackHoleDisk() {
  const S = 256, R = S / 2, inner = 0.3;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const hot = hexToRgb('#fff4dc'), mid = hexToRgb('#ff9a3c'), cool = hexToRgb('#9a2a18');
  paint(ctx, S, S, (x, y, out) => {
    const dx = x + 0.5 - R, dy = y + 0.5 - R;
    const d = Math.hypot(dx, dy) / R;
    if (d < inner || d > 1) { out[3] = 0; return; }
    const t = (d - inner) / (1 - inner);
    const u = Math.atan2(dy, dx) / TAU + 0.5;
    const streak = fbm(u * 24, t * 5, 31, 4, 24);
    if (t < 0.35) mixRgb(hot, mid, t / 0.35, out);
    else mixRgb(mid, cool, (t - 0.35) / 0.65, out);
    const k = (1 - t) ** 1.5 * (0.45 + 0.55 * streak) * smoothstep(0, 0.05, t);
    out[3] = clamp(k * 1.25, 0, 1) * 255;
  });
  return c;
}

// --- Hintergrund ------------------------------------------------------------------------

const STAR_COLORS = ['#ffffff', '#fff1d6', '#d6e4ff', '#ffd8b0', '#ffffff'];

/** Kachelbares Sternfeld (Sterne am Rand werden umgebrochen). */
export function buildStarTile(size, count, seed, o) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size;
    const m = rnd() ** o.pow;
    const r = lerp(o.rMin, o.rMax, m);
    const a = lerp(o.aMin, o.aMax, m);
    const col = hexToRgb(STAR_COLORS[Math.floor(rnd() * STAR_COLORS.length)]);
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        const px = x + ox, py = y + oy;
        if (px < -8 || py < -8 || px > size + 8 || py > size + 8) continue;
        if (r < 1.2) {
          ctx.fillStyle = rgbStr(col, a);
          ctx.fillRect(px, py, r, r);
        } else {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
          g.addColorStop(0, rgbStr(col, a));
          g.addColorStop(0.35, rgbStr(col, a * 0.35));
          g.addColorStop(1, rgbStr(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
        }
      }
    }
  }
  return c;
}

/**
 * Nebel in der "Hubble-Palette" (Teal und Gold statt Lila und Pink),
 * in beide Richtungen kachelbar, mit dunklen Staubbahnen.
 */
export function buildNebulaTile(size, seed) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const teal = hexToRgb('#1f6f78'), gold = hexToRgb('#8a5a1c'), rust = hexToRgb('#5a1f18');
  paint(ctx, size, size, (x, y, out) => {
    const u = x / size, v = y / size;
    const a = fbm(u * 4, v * 4, seed, 5, 4, 4);
    const b = fbm(u * 3, v * 3, seed + 1, 5, 3, 3);
    const lane = fbm(u * 8, v * 8, seed + 2, 4, 8, 8);
    const ta = smoothstep(0.38, 0.92, a) ** 1.8;
    const ga = smoothstep(0.42, 0.95, b) ** 1.8;
    const dark = 1 - smoothstep(0.5, 0.8, lane) * 0.45;
    const sum = ta + ga + 1e-5;
    out[0] = (teal[0] * ta + gold[0] * ga * 0.8 + rust[0] * ga * 0.2) / sum;
    out[1] = (teal[1] * ta + gold[1] * ga * 0.8 + rust[1] * ga * 0.2) / sum;
    out[2] = (teal[2] * ta + gold[2] * ga * 0.8 + rust[2] * ga * 0.2) / sum;
    out[3] = clamp(Math.max(ta, ga) * dark, 0, 1) * 200;
  });
  return c;
}

/** Diagonale Schraffur — markiert den Bereich außerhalb der Arena wie auf einer technischen Zeichnung. */
export function buildHatchTile() {
  const S = 14;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(236,230,214,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, S + 2); ctx.lineTo(S + 2, -2);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(S - 2, S + 2); ctx.lineTo(S + 2, S - 2);
  ctx.stroke();
  return c;
}
