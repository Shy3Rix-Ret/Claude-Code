/**
 * The light coming through the broken windows, as something you can stand in.
 *
 * One oblique prism per opening: the window rectangle extruded along the
 * direction the star's light travels. Because the extrusion axis is not
 * perpendicular to the cross-section, the prism is sheared — which is exactly
 * right, and is why the matrix is built by hand from three basis vectors
 * instead of a position/quaternion/scale.
 *
 * The fragment shader ray-marches that prism in its own local space. At each
 * step it asks the pane mask whether there is still glass in the way; the same
 * mask built the actual glass meshes, so the shafts line up with the shadows
 * the glass casts on the floor rather than merely resembling them.
 *
 * Occlusion is real: the pass runs after the scene, at half resolution, into
 * its own buffer, and reads the scene's depth to stop each ray at the first
 * surface behind it. That is the difference between a beam that wraps around a
 * column and a beam that shines through it.
 */

import * as THREE from 'three';
import { BEAM, HALL, PALETTE } from './config.js';

const VERT = /* glsl */`
varying vec3 vLocal;
varying vec3 vWorld;

void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
precision highp float;

#include <packing>

uniform sampler2D uMask;
uniform sampler2D uDepth;
uniform vec2  uMaskOffset;
uniform vec2  uMaskScale;
uniform mat4  uInvModel;
uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uIntensity;
uniform float uLength;
uniform float uDensity;
uniform float uBrightness;
uniform float uFalloff;
uniform float uSoft;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uFogDensity;

varying vec3 vLocal;
varying vec3 vWorld;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  /* Everything happens in the prism's own space, where it is the unit box
     x,y in [-0.5, 0.5] and z in [0, 1] — z = 0 at the window, z = 1 at the
     far end of the shaft. */
  vec3 ro = (uInvModel * vec4(cameraPosition, 1.0)).xyz;
  vec3 rd = vLocal - ro;              // t = 0 at the eye, t = 1 at this fragment

  vec3 inv = 1.0 / rd;
  vec3 ta = (vec3(-0.5, -0.5, 0.0) - ro) * inv;
  vec3 tb = (vec3( 0.5,  0.5, 1.0) - ro) * inv;
  vec3 tmin = min(ta, tb);
  vec3 tmax = max(ta, tb);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar  = min(min(tmax.x, tmax.y), tmax.z);

  float tStart = max(tNear, 0.0);
  float tEnd   = min(tFar, 1.0);

  /* Stop at whatever the scene already drew in this pixel. Without this the
     shaft glows straight through the columns standing in it. */
  vec3 toFrag = vWorld - cameraPosition;
  float viewZ = (viewMatrix * vec4(toFrag, 0.0)).z;
  float sceneDepth = -perspectiveDepthToViewZ(
    texture2D(uDepth, gl_FragCoord.xy / uResolution).x, uNear, uFar);
  if (viewZ < -1e-5) tEnd = min(tEnd, sceneDepth / -viewZ);

  float span = tEnd - tStart;
  if (span <= 0.0) discard;

  float stepWorld = (span / float(STEPS)) * length(toFrag);

  // Dither the first sample so the low step count reads as grain, not as bands.
  float jitter = hash13(vec3(gl_FragCoord.xy, fract(uTime) * 977.0));

  float acc = 0.0;
  for (int i = 0; i < STEPS; i++) {
    float t = tStart + span * (float(i) + jitter) / float(STEPS);
    vec3 p = ro + rd * t;

    vec2 muv = uMaskOffset + clamp(p.xy + 0.5, 0.002, 0.998) * uMaskScale;
    float open = 1.0 - texture2D(uMask, muv).r;
    if (open <= 0.001) continue;

    // Soften the cross-section border, or the prism reads as a solid object
    // with a straight edge rather than as light.
    vec2 q = abs(p.xy);
    open *= smoothstep(0.5, 0.5 - uSoft, max(q.x, q.y));

    float depth = clamp(p.z, 0.0, 1.0) * uLength;
    acc += open * exp(-depth * uFalloff);
  }

  /* Saturating transfer instead of a linear one. See BEAM.brightness. */
  float v = (1.0 - exp(-acc * stepWorld * uDensity)) * uIntensity * uBrightness;

  /* Slow breathing, so a static camera in a static shaft still has something
     alive in the frame — plus an uneven grain along the shaft. Three sines
     rather than real noise: at up to twenty samples per pixel the difference
     is not worth the texture fetches. */
  v *= 1.0 + ${BEAM.wobble.toFixed(3)} * sin(uTime * 0.31 + vLocal.z * 2.1);
  v *= 1.0 - ${BEAM.grain.toFixed(3)} * (0.5 - 0.5 *
       sin(vLocal.x * 7.3 + uTime * 0.21) *
       sin(vLocal.y * 6.1 - uTime * 0.17) *
       sin(vLocal.z * 3.7 + uTime * 0.11));

  // Distance haze, matched to the scene's fog so the far end of a long shaft
  // does not out-run the room it is in.
  float d = length(toFrag);
  v *= exp(-d * uFogDensity * 1.1);

  gl_FragColor = vec4(uColor * max(v, 0.0), 1.0);
}
`;

/** Distance from `origin` along `dir` to where the ray leaves an AABB. */
function rayBoxExit(origin, dir, min, max) {
  let t = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const d = dir[axis];
    if (Math.abs(d) < 1e-6) continue;
    const t1 = (min[axis] - origin[axis]) / d;
    const t2 = (max[axis] - origin[axis]) / d;
    const far = Math.max(t1, t2);
    if (far > 0) t = Math.min(t, far);
  }
  return Number.isFinite(t) ? t : BEAM.length;
}

export class Beams {
  constructor(openings, quality, fogDensity) {
    this.openings = openings;
    this.scene = new THREE.Scene();

    /* z is authored 0..1 rather than centred, so the shader can read "how far
     * into the room am I" straight off the local coordinate. */
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, 0.5);

    this.hallMin = new THREE.Vector3(-HALL.halfWidth, 0, -HALL.halfLength);
    this.hallMax = new THREE.Vector3(HALL.halfWidth, HALL.height, HALL.halfLength);

    this.beams = openings.list.map((o) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: { STEPS: quality.beamSteps },
        uniforms: {
          uMask: { value: openings.maskTexture },
          uDepth: { value: null },
          uMaskOffset: { value: o.maskOffset },
          uMaskScale: { value: o.maskScale },
          uInvModel: { value: new THREE.Matrix4() },
          uColor: { value: new THREE.Color(PALETTE.sunLow) },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uIntensity: { value: 0 },
          uLength: { value: BEAM.length },
          uDensity: { value: BEAM.density },
          uBrightness: { value: BEAM.brightness },
          uFalloff: { value: BEAM.falloff },
          uSoft: { value: BEAM.softEdge },
          uNear: { value: 0.1 },
          uFar: { value: 2000 },
          uTime: { value: 0 },
          uFogDensity: { value: fogDensity },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        side: THREE.BackSide,      // so the shaft survives the camera entering it
        toneMapped: false,
        fog: false,
      });

      const mesh = new THREE.Mesh(geo, material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;   // the matrix is sheared; the culler cannot help
      this.scene.add(mesh);
      return { opening: o, mesh, material };
    });
  }

  setSize(width, height) {
    for (const b of this.beams) b.material.uniforms.uResolution.value.set(width, height);
  }

  update(sun, camera, time, depthTexture) {
    const scratch = new THREE.Matrix4();

    for (const b of this.beams) {
      const o = b.opening;
      const admit = sun.perOpening[o.index];

      // Below this the shaft is a smear of noise; not drawing it is cheaper
      // and looks better than drawing it faintly.
      if (admit < 0.035) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = true;

      // How far the shaft can travel before it leaves the hall.
      const reach = Math.min(
        BEAM.length,
        rayBoxExit(o.center, sun.direction, this.hallMin, this.hallMax) + 1.5,
      );

      /* Columns: the opening's own two axes, and the light direction. An
       * oblique basis — which is the whole point. */
      const m = b.mesh.matrix;
      m.makeBasis(
        o.rightDir.clone().multiplyScalar(o.halfW * 2),
        o.upDir.clone().multiplyScalar(o.halfH * 2),
        sun.direction.clone().multiplyScalar(reach),
      );
      m.setPosition(o.center);
      // matrixAutoUpdate is off, so this is the one place the matrix changes.
      b.mesh.matrixWorldNeedsUpdate = true;

      const u = b.material.uniforms;
      u.uInvModel.value.copy(scratch.copy(m).invert());
      u.uLength.value = reach;
      u.uTime.value = time;
      u.uDepth.value = depthTexture;
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uColor.value.copy(sun.color);
      /* Grazing light through a window is dimmer per unit of floor but the
       * shaft itself is longer and denser; the ^0.65 is where that argument
       * ended up looking right. */
      u.uIntensity.value = Math.pow(admit, 0.65) * sun.daylight;
    }
  }

  render(renderer, camera, target) {
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    for (const b of this.beams) b.material.dispose();
  }
}
