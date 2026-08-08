/**
 * The dust.
 *
 * Motes drift through the whole hall, but a mote is only worth looking at when
 * it is standing in a shaft — so each one asks, in the vertex shader, whether
 * the star can actually see it: trace back along the light direction, hit the
 * plane of each opening, and check both that the hit lands inside the window
 * and that the pane it lands on is one of the broken ones. Same mask as the
 * glass and the shafts, so a mote lights up exactly where the beam is and goes
 * out exactly where a pane is still in its frame.
 *
 * All of the motion is on the GPU. Nothing here is touched per frame from
 * JavaScript except the clock and the sun.
 */

import * as THREE from 'three';
import { DUST, HALL } from './config.js';
import { makeRng, range } from './util.js';

const VERT = /* glsl */`
uniform float uTime;
uniform float uPixelScale;
uniform float uSize;
uniform float uDrift;
uniform float uSwirl;
uniform float uFalloff;
uniform float uBoost;
uniform float uDaylight;
uniform vec3  uSunDir;
uniform vec2  uYRange;
uniform sampler2D uMask;

uniform vec3 uWinC[NWIN];
uniform vec3 uWinR[NWIN];
uniform vec3 uWinU[NWIN];
uniform vec3 uWinN[NWIN];
uniform vec4 uWinM[NWIN];
uniform float uAdmit[NWIN];

attribute float aSeed;
attribute float aScale;

varying float vBright;

void main() {
  vec3 p = position;

  /* Fall, and wrap. The wrap is why the volume can be a box instead of a
     particle system with a lifetime. */
  float span = uYRange.y - uYRange.x;
  p.y = uYRange.x + mod(p.y - uTime * uDrift * (0.4 + aSeed) - uYRange.x, span);

  float t = uTime * (0.35 + aSeed * 0.5) + aSeed * 40.0;
  p.x += sin(t * 0.7) * uSwirl + sin(t * 0.23 + p.y * 0.4) * uSwirl * 1.6;
  p.z += cos(t * 0.6 + aSeed) * uSwirl + cos(t * 0.19 + p.y * 0.3) * uSwirl * 1.6;

  /* Is this mote in a shaft? Walk back toward the star and see which window,
     if any, it came through. */
  float lit = 0.0;
  for (int i = 0; i < NWIN; i++) {
    if (uAdmit[i] < 0.03) continue;

    float denom = dot(uSunDir, uWinN[i]);
    if (denom <= 0.001) continue;                 // wrong side of that wall

    float d = dot(uWinC[i] - p, uWinN[i]) / denom;
    if (d >= -0.001) continue;                    // window is downstream, not up

    vec3 hit = p + uSunDir * d;                   // d is negative: step backwards
    vec3 rel = hit - uWinC[i];
    float u = dot(rel, uWinR[i]) / dot(uWinR[i], uWinR[i]);
    float v = dot(rel, uWinU[i]) / dot(uWinU[i], uWinU[i]);
    if (abs(u) > 1.0 || abs(v) > 1.0) continue;

    vec2 muv = uWinM[i].xy + clamp(vec2(u, v) * 0.5 + 0.5, 0.002, 0.998) * uWinM[i].zw;
    float open = 1.0 - texture2D(uMask, muv).r;
    lit = max(lit, open * uAdmit[i] * exp(d * uFalloff));
  }

  vBright = (0.05 + uDaylight * 0.22) + lit * uBoost;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uSize * aScale * uPixelScale / max(-mv.z, 0.1), 0.7, 42.0);
}
`;

const FRAG = /* glsl */`
precision highp float;

uniform sampler2D uSprite;
uniform vec3 uColor;
varying float vBright;

void main() {
  float a = texture2D(uSprite, gl_PointCoord).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * vBright * a, 1.0);
}
`;

export class Dust {
  constructor(scene, openings, sprite, quality) {
    const count = Math.round(DUST.ambient * quality.dust);
    const rng = makeRng(0x0dc57);

    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);

    const V = DUST.volume;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = range(rng, -V.x, V.x);
      positions[i * 3 + 1] = range(rng, V.yFrom, V.yTo);
      positions[i * 3 + 2] = range(rng, -V.z, V.z);
      seeds[i] = rng();
      // A few big flakes among a lot of fine dust reads better than one size.
      scales[i] = rng() < 0.08 ? range(rng, 1.8, 3.4) : range(rng, 0.5, 1.2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 6, 0), 90);

    const arrays = openings.uniformArrays();

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines: { NWIN: arrays.count },
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: DUST.size * 900 },
        uPixelScale: { value: 1 },
        uDrift: { value: DUST.drift },
        uSwirl: { value: DUST.swirl },
        uFalloff: { value: 0.012 },
        uBoost: { value: DUST.litBoost },
        uDaylight: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0, -1, 0) },
        uYRange: { value: new THREE.Vector2(V.yFrom, V.yTo) },
        uMask: { value: openings.maskTexture },
        uSprite: { value: sprite },
        uColor: { value: new THREE.Color(0xffe9cf) },
        uWinC: { value: arrays.centers },
        uWinR: { value: arrays.rights },
        uWinU: { value: arrays.ups },
        uWinN: { value: arrays.normals },
        uWinM: { value: arrays.masks },
        uAdmit: { value: new Array(arrays.count).fill(0) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.count = count;
  }

  setSize(height, pixelRatio) {
    // Point size is in device pixels, so it has to follow the drawing buffer.
    this.material.uniforms.uPixelScale.value = (height * pixelRatio) / 900;
  }

  update(time, sun) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(sun.direction);
    u.uDaylight.value = sun.daylight;
    u.uColor.value.copy(sun.color);
    for (let i = 0; i < u.uAdmit.value.length; i++) u.uAdmit.value[i] = sun.perOpening[i];
  }
}
