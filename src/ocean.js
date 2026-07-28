/**
 * The surface.
 *
 * A polar grid centred on the camera with exponentially spaced rings: dense
 * where you can see detail, sparse out at the fog line, and a single centre
 * vertex so there is no pinhole to look up through when you sink in Act 3.
 *
 * §5 — a custom shader rather than MeshPhysicalMaterial, which is far too
 * clean for footage that is supposed to have been recorded by something.
 */

import * as THREE from 'three';
import { OCEAN, PALETTE, TIME_WRAP } from './config.js';
import {
  NOISE, FOG_FN, oceanWaveGLSL, oceanRippleGLSL, WAVE_COMPONENTS, SWELL,
} from './glsl.js';

function buildPolarGrid(radial, rings, innerR, outerR) {
  const vertCount = 1 + radial * rings;
  const positions = new Float32Array(vertCount * 3);
  // ring index normalised 0..1, handed to the shader so it can soften detail
  // with distance instead of aliasing into noise out at the horizon.
  const ringT = new Float32Array(vertCount);

  positions[0] = 0; positions[1] = 0; positions[2] = 0;
  ringT[0] = 0;

  const growth = Math.pow(outerR / innerR, 1 / (rings - 1));
  let p = 3, q = 1;
  for (let r = 0; r < rings; r++) {
    const radius = innerR * Math.pow(growth, r);
    const t = r / (rings - 1);
    // Rotate every other ring by half a step so the triangles interlock
    // instead of forming visible radial seams.
    const twist = (r % 2) * (Math.PI / radial);
    for (let a = 0; a < radial; a++) {
      const ang = (a / radial) * Math.PI * 2 + twist;
      positions[p++] = Math.cos(ang) * radius;
      positions[p++] = 0;
      positions[p++] = Math.sin(ang) * radius;
      ringT[q++] = t;
    }
  }

  const indices = [];
  // centre fan
  for (let a = 0; a < radial; a++) {
    const cur = 1 + a;
    const nxt = 1 + ((a + 1) % radial);
    indices.push(0, nxt, cur);
  }
  // ring quads
  for (let r = 0; r < rings - 1; r++) {
    const base = 1 + r * radial;
    const next = 1 + (r + 1) * radial;
    for (let a = 0; a < radial; a++) {
      const a1 = a;
      const a2 = (a + 1) % radial;
      const i0 = base + a1, i1 = base + a2;
      const j0 = next + a1, j1 = next + a2;
      indices.push(i0, j1, j0);
      indices.push(i0, i1, j1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('ringT', new THREE.BufferAttribute(ringT, 1));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outerR * 1.2);
  return geo;
}

const VERT = /* glsl */ `
attribute float ringT;

uniform float uTime;
uniform vec2  uCenter;      // camera XZ — the grid rides along with the player

varying vec3  vWorld;
varying vec3  vWaveGrad;
varying float vRingT;
varying float vDist;

${oceanWaveGLSL()}

void main(){
  vec3 local = position;
  vec2 world2 = local.xz + uCenter;

  vec3 w = oceanWave(world2, uTime);

  // Flatten the displacement out toward the horizon: at 1km the wave height is
  // meaningless and only causes shimmer, but the long swell should survive.
  float falloff = 1.0 - smoothstep(0.55, 1.0, ringT);
  float h = w.x * mix(0.35, 1.0, falloff);

  vec3 worldPos = vec3(world2.x, h, world2.y);

  vWorld = worldPos;
  vWaveGrad = vec3(w.y, 0.0, w.z) * falloff;
  vRingT = ringT;
  vDist = length(worldPos.xz - uCenter);

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uCamPos;
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uShallow;
uniform vec3  uBeaconPos;
uniform vec3  uBeaconColor;
uniform float uBeaconIntensity;
uniform float uDarkness;    // Act 3: the water under the player losing its floor
uniform float uAmbient;

varying vec3  vWorld;
varying vec3  vWaveGrad;
varying float vRingT;
varying float vDist;

${NOISE}
${FOG_FN}
${oceanRippleGLSL()}

void main(){
  vec3 toEye = uCamPos - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / max(dist, 1e-4);

  // Analytic normal from the wave gradient, plus fine ripple detail that fades
  // out with distance so the horizon stays glassy instead of boiling.
  vec3 N = normalize(vec3(-vWaveGrad.x, 1.0, -vWaveGrad.z));

  // Micro-ripple, near field only. Beyond ~50m it would only alias.
  float detailFade = 1.0 - smoothstep(16.0, 52.0, dist);
  if (detailFade > 0.001) {
    vec3 rip = oceanRipple(vWorld.xz, uTime);
    N = normalize(N + vec3(-rip.y, 0.0, -rip.z) * detailFade);
  }

  bool topSide = gl_FrontFacing;
  if (!topSide) N = -N;

  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // Fresnel. Grazing angles turn the surface into a mirror of the fog, which is
  // what dissolves the horizon line — but a physically correct 0.98 ceiling
  // makes the whole frame the colour of the sky, and §3.1 wants water that
  // still reads grey-blue-green. Capped at 0.74 on purpose.
  float fres = 0.021 + 0.72 * pow(1.0 - ndv, 4.2);

  // What the surface reflects: the fog dome, sampled along the reflected ray,
  // knocked down and cooled — water is never a clean mirror.
  vec3 R = reflect(-V, N);
  vec3 skyRefl = fogColorFor(R) * vec3(0.50, 0.58, 0.60);

  // Sub-surface body colour. Steeper view angles look further down.
  float depthLook = pow(ndv, 0.85);
  vec3 body = mix(uMid, uDeep, depthLook);
  body = mix(body, uShallow, pow(1.0 - ndv, 2.4) * 0.35);

  // Act 3 — the floor drops out from under the player. Radial, centred on them.
  float radial = length(vWorld.xz - uCamPos.xz);
  float pit = (1.0 - smoothstep(2.0, 34.0, radial)) * uDarkness;
  body = mix(body, vec3(0.0015, 0.0028, 0.0032), pit * 0.94);

  vec3 col;
  if (topSide) {
    col = mix(body, skyRefl, fres);

    // A wide, directionless sheen from the fog overhead. Never a sun (§3.3).
    float sheen = pow(max(N.y, 0.0), 26.0) * 0.055;
    col += uFogHigh * sheen * (1.0 - uUnderwater);
  } else {
    // Seen from below, the surface is a dim restless ceiling — the only thing
    // down here that tells you which way is up. It has to stay readable even
    // at full darkness, or Act 3 is just a black screen for a minute.
    vec3 ceiling = mix(uFogLow * 0.42, uFogLow * 1.00, fres);
    float caustic = fbm2(vWorld.xz * 0.9 + uTime * 0.13, 3);
    ceiling += uFogHigh * 0.30 * pow(caustic, 3.0);
    col = ceiling * (1.0 - uDarkness * 0.25);
  }

  // The beacon lays a track across the water once it exists (§3.1). It has to
  // be a path — narrow across, long toward the viewer — not a pool of glow.
  if (uBeaconIntensity > 0.001) {
    vec3 toBeacon = normalize(uBeaconPos - vWorld);
    float align = max(dot(R, toBeacon), 0.0);
    float glint = pow(align, 110.0);
    float halo  = pow(align, 30.0);

    // Perpendicular distance from the camera-to-beacon line, in metres.
    vec2 axis = normalize(uBeaconPos.xz - uCamPos.xz + vec2(1e-5));
    vec2 rel = vWorld.xz - uCamPos.xz;
    float across = abs(rel.x * axis.y - rel.y * axis.x);
    float path = exp(-across * across * 1.5);

    float bd = distance(uBeaconPos.xz, vWorld.xz);
    float reach = 1.0 - smoothstep(0.0, 260.0, bd);
    col += uBeaconColor * (glint * 0.35 + halo * 0.022) * path
         * uBeaconIntensity * (0.25 + 0.75 * reach);
  }

  col *= uAmbient;

  // The surface holds its own colour a little longer than the air does.
  float f = fogAmount(dist) * 0.94;
  col = mix(col, fogColorFor(-V) * 0.88, f);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Ocean {
  constructor(scene, quality) {
    this.geometry = buildPolarGrid(
      quality.radial, quality.rings, OCEAN.innerRadius, OCEAN.radius,
    );

    this.uniforms = {
      uTime:        { value: 0 },
      uCenter:      { value: new THREE.Vector2() },
      uCamPos:      { value: new THREE.Vector3() },
      uDeep:        { value: new THREE.Color(PALETTE.waterDeep) },
      uMid:         { value: new THREE.Color(PALETTE.waterMid) },
      uShallow:     { value: new THREE.Color(PALETTE.waterShallow) },
      uFogLow:      { value: new THREE.Color(PALETTE.fogLow) },
      uFogHigh:     { value: new THREE.Color(PALETTE.fogHigh) },
      uMurkColor:   { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
      uFogNear:     { value: 6 },
      uFogFar:      { value: 52 },
      uUnderwater:  { value: 0 },
      uBeaconPos:   { value: new THREE.Vector3() },
      uBeaconColor: { value: new THREE.Color(PALETTE.beacon) },
      uBeaconIntensity: { value: 0 },
      uDarkness:    { value: 0 },
      uAmbient:     { value: 1 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    scene.add(this.mesh);

    // Shared with the shader — see glsl.js. Do not fork this.
    this._waves = WAVE_COMPONENTS;
  }

  /**
   * Every wave speed is a whole multiple of OCEAN.timeQuantum, so the field is
   * exactly periodic over TIME_WRAP (~628s) and the clock can be wrapped with
   * no discontinuity. That keeps shader phases bounded however long the page
   * stays open — unbounded phases lose precision and the surface starts to
   * shimmer.
   */
  static clock(time) {
    return time % TIME_WRAP;
  }

  /**
   * The long swell alone — wavelength in the hundreds of metres, period ~79s.
   * Anything sitting in the water rides this; only the chop laps against it.
   */
  swellAt(x, z, time) {
    const t = Ocean.clock(time);
    return SWELL.amp * Math.sin(x * SWELL.fx + z * SWELL.fz + t * SWELL.speed);
  }

  /** Surface height at a world XZ. Mirrors oceanWave() exactly. */
  heightAt(x, z, time) {
    const t = Ocean.clock(time);
    let h = 0;
    for (const w of this._waves) {
      h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.freq + t * w.spd);
    }
    return h + this.swellAt(x, z, time);
  }

  update(state, camera) {
    const u = this.uniforms;
    u.uTime.value = Ocean.clock(state.time);
    u.uCenter.value.set(camera.position.x, camera.position.z);
    u.uCamPos.value.copy(camera.position);
    u.uFogNear.value = state.fogNear;
    u.uFogFar.value = state.fogFar;
    u.uUnderwater.value = state.submersion;
    u.uDarkness.value = state.darkness;
    u.uAmbient.value = state.ambient;
    u.uBeaconIntensity.value = state.beacon;
  }

  setBeaconPosition(v) {
    this.uniforms.uBeaconPos.value.copy(v);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
