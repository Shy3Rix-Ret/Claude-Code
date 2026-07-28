/**
 * Shared GLSL. Kept in one place so the ocean, the sky and the post stack all
 * agree on what noise and fog look like.
 */

import { OCEAN } from './config.js';

/* Cheap hash + value noise. No textures, nothing to load. */
export const NOISE = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float hash13(vec3 p3){
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

float fbm2(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++){
    if (i >= oct) break;
    s += a * vnoise2(p);
    n += a; p = p * 2.03 + 17.1; a *= 0.5;
  }
  return s / max(n, 1e-4);
}

float fbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++){
    if (i >= oct) break;
    s += a * vnoise3(p);
    n += a; p = p * 2.07 + 11.7; a *= 0.5;
  }
  return s / max(n, 1e-4);
}
`;

/**
 * Normalised wave components, shared by the GPU (via codegen below) and the
 * CPU (via `WAVE_COMPONENTS`, imported by ocean.js).
 *
 * There must be exactly one definition of the surface. When the shader and the
 * JS drifted apart during development the camera quietly sank below the water
 * at every swell peak, which looks like a rendering bug and is not one.
 */
function normalise(list) {
  return list.map(([dx, dz, amp, freq, spd]) => {
    const L = Math.hypot(dx, dz) || 1;
    return { dx: dx / L, dz: dz / L, amp, freq, spd };
  });
}

export const WAVE_COMPONENTS = normalise(OCEAN.waves);
export const RIPPLE_COMPONENTS = normalise(OCEAN.ripples);
export const SWELL = OCEAN.swell;

function unroll(components) {
  return components
    .map(({ dx, dz, amp, freq, spd }) => `  {
    vec2 d = vec2(${dx.toFixed(6)}, ${dz.toFixed(6)});
    float ph = dot(d, p) * ${freq.toFixed(6)} + t * ${spd.toFixed(6)};
    acc.x += ${amp.toFixed(8)} * sin(ph);
    acc.yz += ${(amp * freq).toFixed(10)} * cos(ph) * d;
  }`)
    .join('\n');
}

/**
 * The wave field, unrolled from config at build time so the GPU sees constants
 * rather than a uniform-array lookup.
 *
 * Returns vec3(height, dH/dx, dH/dz), so the fragment stage can build an exact
 * normal instead of differencing a grid whose density falls off with distance.
 */
export function oceanWaveGLSL() {
  const { amp, fx, fz, speed } = SWELL;
  return /* glsl */ `
vec3 oceanWave(vec2 p, float t){
  vec3 acc = vec3(0.0);
${unroll(WAVE_COMPONENTS)}
  // A very long swell so the horizon line itself breathes.
  {
    float ph = p.x * ${fx} + p.y * ${fz} + t * ${speed};
    acc.x += ${amp} * sin(ph);
    acc.yz += vec2(${(amp * fx).toFixed(10)}, ${(amp * fz).toFixed(10)}) * cos(ph);
  }
  return acc;
}
`;
}

/**
 * Fine surface texture for the near field, same contract as oceanWave().
 *
 * Analytic on purpose. The first version of this differenced an fbm field to
 * get its normal, and dividing that difference by epsilon amplified the
 * precision loss that creeps in as the clock grows — after a few minutes the
 * close water turned into a mirror of the sky.
 */
export function oceanRippleGLSL() {
  return /* glsl */ `
vec3 oceanRipple(vec2 p, float t){
  vec3 acc = vec3(0.0);
${unroll(RIPPLE_COMPONENTS)}
  return acc;
}
`;
}

/**
 * Height-and-distance fog. Above water it thickens toward the horizon; below
 * water it becomes a hard, close murk.
 */
export const FOG_FN = /* glsl */ `
uniform vec3  uFogLow;
uniform vec3  uFogHigh;
uniform float uFogNear;
uniform float uFogFar;
uniform float uUnderwater;   // 0 = above surface, 1 = submerged
uniform vec3  uMurkColor;

float fogAmount(float dist){
  float above = smoothstep(uFogNear, uFogFar, dist);
  // Underwater the useful range collapses to a few metres.
  float below = 1.0 - exp(-dist * 0.115);
  return mix(above, below, uUnderwater);
}

vec3 fogColorFor(vec3 dir){
  float up = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 air = mix(uFogLow, uFogHigh, smoothstep(0.42, 0.86, up));
  return mix(air, uMurkColor, uUnderwater);
}
`;

/** ACES-ish filmic curve, then linear -> sRGB. Applied once, in the composite. */
export const TONEMAP = /* glsl */ `
vec3 acesFilm(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 linearToSRGB(vec3 c){
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}
`;

/** Full-screen triangle vertex shader used by every post pass. */
export const FULLSCREEN_VS = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
