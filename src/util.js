/**
 * Small maths helpers and a deterministic noise field shared by the CPU-side
 * systems (camera shake, watcher drift). The GLSL twins live in glsl.js.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const saturate = (v) => clamp(v, 0, 1);

export function smoothstep(edge0, edge1, x) {
  const t = saturate(invLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. `rate` is roughly 1/seconds. */
export function damp(current, target, rate, dt) {
  return lerp(target, current, Math.exp(-rate * dt));
}

/** Remap with clamping. */
export function remap(v, inA, inB, outA, outB) {
  return lerp(outA, outB, saturate(invLerp(inA, inB, v)));
}

/* ------------------------------------------------------------------- rng */

/** mulberry32 — tiny, fast, good enough, and reproducible. */
export function makeRng(seed = 0x4444) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rangeFrom(rng, [min, max]) {
  return min + rng() * (max - min);
}

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

function grad1(hash, x) {
  return (hash & 1) === 0 ? x : -x;
}

/** Classic 1D value/perlin hybrid — used for camera shake curves. */
export function noise1(x) {
  const xi = Math.floor(x) & 255;
  const xf = x - Math.floor(x);
  const u = fade(xf);
  const a = grad1(PERM[xi], xf);
  const b = grad1(PERM[xi + 1], xf - 1);
  return lerp(a, b, u) * 2.0;
}

/** Layered 1D noise. Organic, non-looping camera motion (§2.2). */
export function fbm1(x, octaves = 3, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise1(x * freq + i * 17.31);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/* --------------------------------------------------------------- helpers */

/** Ease that starts slow and ends slow — used for every fade in the game. */
export const easeInOut = (t) => {
  t = saturate(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - saturate(t), 3);
export const easeInCubic = (t) => Math.pow(saturate(t), 3);

/** Formats seconds as HH:MM:SS for the found-footage timestamp (§2.4). */
export function timecode(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
