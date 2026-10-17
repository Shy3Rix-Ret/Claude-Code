/**
 * Kleine, abhängigkeitsfreie Helfer: Mathe, Easing, Zufall, Rauschen,
 * Formatierung und ein minimaler Event-Bus.
 */

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = invLerp(a, b, v);
  return t * t * (3 - 2 * t);
};

/** Bildraten-unabhängiges Annähern an ein Ziel (exponentiell). */
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

/** Kürzester Winkelabstand, Ergebnis in [-π, π]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

// --- Easing ----------------------------------------------------------------

export const easeOutCubic = t => 1 - (1 - t) ** 3;
export const easeInCubic = t => t * t * t;
export const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutExpo = t => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeOutBack = t => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

// --- Zufall ------------------------------------------------------------------
// Die Simulation zieht ihren Zufall ausschließlich hier. Für Tests lässt sich
// dadurch ein fester Seed setzen und jeder Lauf exakt wiederholen.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _rand = Math.random;
export const setSeed = seed => { _rand = mulberry32(seed); };
export const random = () => _rand();
export const randRange = (a, b) => a + (b - a) * _rand();
export const randInt = (a, b) => Math.floor(a + (b - a + 1) * _rand());
export const pick = arr => arr[Math.floor(_rand() * arr.length)];
export const chance = p => _rand() < p;

/** Normalverteilt (Box-Muller), Mittelwert 0, Standardabweichung 1. */
export function gaussian() {
  let u = 0;
  while (u === 0) u = _rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * _rand());
}

// --- Rauschen -----------------------------------------------------------------
// Wertrauschen mit optionaler Periodizität. Periodisch in x heißt: die Textur
// lässt sich nahtlos horizontal scrollen — so drehen sich die Planeten.

function hash2(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const wrap = (i, p) => ((i % p) + p) % p;

export function valueNoise(x, y, seed, periodX = 0, periodY = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
  if (periodX) { x0 = wrap(x0, periodX); x1 = wrap(x1, periodX); }
  if (periodY) { y0 = wrap(y0, periodY); y1 = wrap(y1, periodY); }
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fraktales Rauschen (fBm). Perioden werden pro Oktave mitverdoppelt. */
export function fbm(x, y, seed, octaves = 4, periodX = 0, periodY = 0) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 131, periodX * freq, periodY * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// --- Farbe --------------------------------------------------------------------

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgba = (hex, a) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** Mischt zwei RGB-Arrays in ein drittes (vermeidet Allokationen in Pixel-Schleifen). */
export function mixRgb(a, b, t, out) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

// --- Formatierung ---------------------------------------------------------------

const numberFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
export const fmt = n => numberFormat.format(Math.round(n));

export function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// --- Event-Bus --------------------------------------------------------------------
// Die Simulation meldet, was passiert ("eat", "death", "evolve" …). Renderer,
// Audio und UI hören zu. So bleibt die Spiellogik frei von DOM und Canvas.

export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(type, payload) {
    const list = this.listeners.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i](payload);
  }
}
