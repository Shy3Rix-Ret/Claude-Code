/**
 * A single lit-surface material shared by every solid object in the level (the
 * door, its frame, the hand). Everything goes through the same fog function as
 * the water and the sky, so nothing ever sits "on top of" the atmosphere.
 *
 * Lighting model, per §3.3: one directionless hemisphere term standing in for
 * the fog ceiling, plus the door's warm spill. There is never a sun.
 */

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { NOISE, FOG_FN } from './glsl.js';
import { makeRng } from './util.js';

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vDist;

void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform float uUseMap;
uniform vec3  uColor;
uniform float uRough;
uniform vec3  uCamPos;
uniform vec3  uHemiSky;
uniform vec3  uHemiGround;
uniform float uHemiIntensity;
uniform vec3  uWarmPos;
uniform vec3  uWarmColor;
uniform float uWarmIntensity;
uniform float uWarmRange;
uniform float uAmbient;
uniform float uOpacity;
uniform float uExtraFog;   // reveal-out-of-fog, instead of an alpha fade
uniform float uWetness;
uniform float uTime;

varying vec3  vWorld;
varying vec3  vNormal;
varying vec2  vUv;
varying float vDist;

${NOISE}
${FOG_FN}

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  if (dot(N, V) < 0.0) N = -N;

  vec3 albedo = uColor;
  if (uUseMap > 0.5) albedo *= texture2D(uMap, vUv).rgb;

  // Hemisphere fill: light falls from the fog, unshaped, from everywhere above.
  float hemi = N.y * 0.5 + 0.5;
  vec3 lit = albedo * mix(uHemiGround, uHemiSky, hemi) * uHemiIntensity;

  // The door's spill. The only warm light in the game (§3.1).
  if (uWarmIntensity > 0.0001) {
    vec3 L = uWarmPos - vWorld;
    float d = length(L);
    L /= max(d, 1e-4);
    float atten = 1.0 / (1.0 + pow(d / uWarmRange, 2.0));
    float diff = max(dot(N, L), 0.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), mix(6.0, 90.0, 1.0 - uRough))
               * mix(0.06, 0.55, uWetness);
    lit += uWarmColor * uWarmIntensity * atten * (albedo * diff + spec);
  }

  // Everything down here has been in the water a long time.
  float sheen = pow(1.0 - max(dot(N, V), 0.0), 4.0) * uWetness;
  lit += uHemiSky * sheen * 0.16;

  lit *= uAmbient;

  // Solid geometry never fades out with alpha — it dissolves into the fog.
  // Alpha-fading overlapping panels makes them depth-reject one another.
  float f = clamp(fogAmount(vDist) + uExtraFog, 0.0, 1.0);
  lit = mix(lit, fogColorFor(-V), f);

  gl_FragColor = vec4(lit, uOpacity);
}
`;

/** Uniform block every fogged material needs; wired up once per frame. */
export function foggedUniforms(overrides = {}) {
  return Object.assign({
    uMap:            { value: null },
    uUseMap:         { value: 0 },
    uColor:          { value: new THREE.Color(0xffffff) },
    uRough:          { value: 0.8 },
    uCamPos:         { value: new THREE.Vector3() },
    uHemiSky:        { value: new THREE.Color(PALETTE.fogHigh) },
    uHemiGround:     { value: new THREE.Color(PALETTE.waterDeep) },
    uHemiIntensity:  { value: 0.55 },
    uWarmPos:        { value: new THREE.Vector3() },
    uWarmColor:      { value: new THREE.Color(PALETTE.beacon) },
    uWarmIntensity:  { value: 0 },
    uWarmRange:      { value: 3.4 },
    uAmbient:        { value: 1 },
    uOpacity:        { value: 1 },
    uExtraFog:       { value: 0 },
    uWetness:        { value: 0.6 },
    uTime:           { value: 0 },
    uFogLow:         { value: new THREE.Color(PALETTE.fogLow) },
    uFogHigh:        { value: new THREE.Color(PALETTE.fogHigh) },
    uMurkColor:      { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
    uFogNear:        { value: 6 },
    uFogFar:         { value: 52 },
    uUnderwater:     { value: 0 },
  }, overrides);
}

export function makeFoggedMaterial(opts = {}) {
  const uniforms = foggedUniforms();
  if (opts.color !== undefined) uniforms.uColor.value.set(opts.color);
  if (opts.map) { uniforms.uMap.value = opts.map; uniforms.uUseMap.value = 1; }
  if (opts.rough !== undefined) uniforms.uRough.value = opts.rough;
  if (opts.wetness !== undefined) uniforms.uWetness.value = opts.wetness;
  if (opts.hemiIntensity !== undefined) uniforms.uHemiIntensity.value = opts.hemiIntensity;

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: opts.transparent ?? false,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** Copies the per-frame world state into any fogged material. */
export function syncFogged(material, state, camera, warm) {
  const u = material.uniforms;
  u.uCamPos.value.copy(camera.position);
  u.uFogNear.value = state.fogNear;
  u.uFogFar.value = state.fogFar;
  u.uUnderwater.value = state.submersion;
  u.uAmbient.value = state.ambient;
  u.uTime.value = state.time;
  if (warm) {
    u.uWarmPos.value.copy(warm.position);
    u.uWarmIntensity.value = warm.intensity;
    u.uWarmRange.value = warm.range ?? u.uWarmRange.value;
  }
}

/* ------------------------------------------------------------- textures */

/**
 * Procedural rust. Generated once at boot — the level ships no image files, so
 * it loads instantly and works from a file:// URL or a single inlined page.
 */
export function makeRustTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const rng = makeRng(0x4a17);

  // Base coat: old marine paint, mostly gone.
  ctx.fillStyle = '#2a3033';
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;

  // Value-noise field for the corrosion mask.
  const N = 64;
  const field = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) field[i] = rng();
  const sample = (u, v) => {
    const x = u * N, y = v * N;
    const x0 = Math.floor(x) % N, y0 = Math.floor(y) % N;
    const x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
    const fx = x - Math.floor(x), fy = y - Math.floor(y);
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = field[y0 * N + x0], b = field[y0 * N + x1];
    const e = field[y1 * N + x0], f = field[y1 * N + x1];
    return (a + (b - a) * sx) + ((e + (f - e) * sx) - (a + (b - a) * sx)) * sy;
  };
  const fbm = (u, v) => {
    let s = 0, amp = 0.5, fq = 1, n = 0;
    for (let o = 0; o < 5; o++) { s += amp * sample(u * fq, v * fq); n += amp; fq *= 2.11; amp *= 0.5; }
    return s / n;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const corrosion = fbm(u * 3.1, v * 3.1);
      // Vertical weeping streaks below the corroded patches.
      const streak = fbm(u * 9.0, v * 0.85 + corrosion * 0.6);
      const mask = Math.min(1, Math.max(0, (corrosion - 0.38) * 2.6 + (streak - 0.5) * 0.9));
      const grit = (rng() - 0.5) * 0.09;

      // rust ramp: dark iron oxide -> orange bloom -> pale salt crust
      const t = Math.min(1, mask * 1.25);
      let r = 42 + t * 74, g = 48 - t * 4, b = 51 - t * 18;
      if (t > 0.42) {
        const k = (t - 0.42) / 0.58;
        r = 116 + k * 52; g = 52 + k * 14; b = 36 - k * 10;
      }
      if (t > 0.88) {
        const k = (t - 0.88) / 0.12;
        r += k * 46; g += k * 52; b += k * 56;
      }
      const i = (y * size + x) * 4;
      d[i]     = Math.max(0, Math.min(255, r * (1 + grit)));
      d[i + 1] = Math.max(0, Math.min(255, g * (1 + grit)));
      d[i + 2] = Math.max(0, Math.min(255, b * (1 + grit)));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // A few deep pits and scrapes for silhouette interest at close range.
  for (let i = 0; i < 90; i++) {
    ctx.globalAlpha = 0.10 + rng() * 0.26;
    ctx.fillStyle = rng() < 0.6 ? '#161b1e' : '#8a4a24';
    const w = 2 + rng() * 26, h = 2 + rng() * 90;
    ctx.fillRect(rng() * size, rng() * size, w, h);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The water on the lens (§3.2). A sparse field of droplets baked into an RGBA
 * texture: RG carries a refraction offset, B a specular highlight, A coverage.
 */
export function makeDropletTexture(count, size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(128,128,0,0)';
  ctx.fillRect(0, 0, size, size);

  const rng = makeRng(0x0dd0);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = 128; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 0; }

  for (let k = 0; k < count; k++) {
    const cx = rng() * size, cy = rng() * size;
    const rad = 5 + rng() * rng() * 34;
    const squash = 0.72 + rng() * 0.55; // gravity-elongated
    for (let y = Math.floor(cy - rad * 1.6); y <= cy + rad * 1.6; y++) {
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const px = ((x % size) + size) % size;
        const py = ((y % size) + size) % size;
        const dx = (x - cx) / rad;
        const dy = (y - cy) / (rad * squash);
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) continue;
        const h = Math.sqrt(1 - r2);          // hemisphere
        const nx = dx / (h + 0.35);
        const ny = dy / (h + 0.35);
        const i = (py * size + px) * 4;
        const a = Math.min(1, (1 - r2) * 1.6);
        if (a * 255 < d[i + 3]) continue;      // keep the nearer droplet
        d[i]     = Math.max(0, Math.min(255, 128 + nx * 96));
        d[i + 1] = Math.max(0, Math.min(255, 128 + ny * 96));
        // Highlight sits up and to one side, as if lit from the fog above.
        const spec = Math.pow(Math.max(0, 1 - Math.hypot(dx + 0.34, dy + 0.40) * 1.5), 4.0);
        d[i + 2] = Math.max(0, Math.min(255, spec * 255));
        d[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
