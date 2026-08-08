/**
 * Maths, a seeded RNG, and the value-noise field the procedural textures are
 * carved out of. Nothing in here touches Three.js or the DOM, so it is also
 * the only file that is trivially testable in node.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const saturate = (v) => clamp(v, 0, 1);
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(edge0, edge1, x) {
  const t = saturate(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. `rate` is roughly 1/seconds. */
export function damp(current, target, rate, dt) {
  return lerp(target, current, Math.exp(-rate * dt));
}

/** Ping-pong 0..1..0 over a period. The star's sweep runs on this. */
export function pingPong(t, period) {
  const x = ((t / period) % 1 + 1) % 1;
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

/* ------------------------------------------------------------------- rng */

/** mulberry32 — small, fast, reproducible. Every random thing here is seeded,
 *  so the station looks the same on every machine and every reload. */
export function makeRng(seed = 0x4b39) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (rng, min, max) => min + rng() * (max - min);

/* ----------------------------------------------------------------- noise */

const PERM = new Uint8Array(512);
{
  const rng = makeRng(0x9e3779b9);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const hash2 = (x, y) => PERM[(PERM[x & 255] + y) & 255] / 255;

/** 2D value noise in 0..1. Tiles every 256 units, which is why every texture
 *  below is authored in that space — it makes them seamless for free. */
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Layered value noise. `octaves` of 4 is plenty at texture resolution. */
export function fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq + i * 31.7, y * freq - i * 17.3);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged noise — the streaks that rust and water stains run in. */
export function ridge2(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2(x * freq + i * 11.1, y * freq + i * 7.7) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    freq *= 2.13;
    amp *= 0.55;
  }
  return sum / norm;
}

/** Worley-ish cell distance, used for flaking paint and leaf veins. */
export function cell2(x, y, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const px = cx + hash2(cx, cy) * jitter;
      const py = cy + hash2(cx + 71, cy + 29) * jitter;
      const dx = px - x, dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

