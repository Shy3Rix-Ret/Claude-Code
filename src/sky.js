/**
 * The fog dome. There is no sun, no sky, no horizon line — only a low ceiling
 * of grey that gets marginally lighter overhead (§3.3). Slow-drifting fbm keeps
 * it from reading as a flat gradient without ever resolving into clouds.
 */

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { NOISE } from './glsl.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  // Strip translation from the view matrix — the dome is infinitely far away.
  mat4 rotOnly = viewMatrix;
  rotOnly[3].xyz = vec3(0.0);
  vec4 p = projectionMatrix * rotOnly * vec4(position, 1.0);
  gl_Position = p.xyww; // clamp to the far plane
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uFogLow;
uniform vec3  uFogHigh;
uniform vec3  uSkyTop;
uniform vec3  uMurk;
uniform float uUnderwater;
uniform float uAmbient;
uniform float uDarkness;

varying vec3 vDir;

${NOISE}

void main(){
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);

  // Base vertical ramp. Deliberately compressed: the ceiling feels close.
  vec3 col = mix(uFogLow, uFogHigh, smoothstep(-0.04, 0.34, up));
  col = mix(col, uSkyTop, smoothstep(0.30, 0.92, up));

  // Two layers of very slow drift, at different rates, so nothing ever loops.
  vec2 uv = d.xz / (abs(up) + 0.42);
  float n = fbm2(uv * 0.55 + vec2(uTime * 0.0037, uTime * -0.0025), 4);
  float n2 = fbm2(uv * 1.9 + vec2(uTime * -0.0061, uTime * 0.0044), 3);
  float cloud = mix(n, n2, 0.35);
  col *= 0.86 + 0.28 * cloud;

  // A slight darkening right at the waterline sells the low-hanging fog.
  col *= 1.0 - smoothstep(0.10, -0.16, up) * 0.22;

  // Below the surface the dome is just distance-murk in every direction.
  col = mix(col, uMurk * (0.55 + 0.45 * cloud), uUnderwater);

  col *= uAmbient;
  col *= 1.0 - uDarkness * 0.20;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTime:       { value: 0 },
      uFogLow:     { value: new THREE.Color(PALETTE.fogLow) },
      uFogHigh:    { value: new THREE.Color(PALETTE.fogHigh) },
      uSkyTop:     { value: new THREE.Color(PALETTE.skyTop) },
      uMurk:       { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(1.6) },
      uUnderwater: { value: 0 },
      uAmbient:    { value: 1 },
      uDarkness:   { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);
  }

  update(state, camera) {
    this.uniforms.uTime.value = state.time;
    this.uniforms.uUnderwater.value = state.submersion;
    this.uniforms.uAmbient.value = state.ambient;
    this.uniforms.uDarkness.value = state.darkness;
    this.mesh.position.copy(camera.position);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
