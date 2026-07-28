/**
 * What is under you.
 *
 * Two things live here: the suspended particulate that makes the water read as
 * water once you are inside it, and the thing that passes beneath during Act 3.
 * The thing is never lit, never framed and never explained — it is a slightly
 * darker absence moving through murk, and it is enormous.
 */

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { NOISE, FOG_FN } from './glsl.js';
import { makeRng, saturate, smoothstep } from './util.js';

/* ---------------------------------------------------------- particulate */

const MOTE_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform vec3  uCenter;
uniform float uBox;
uniform float uPixelRatio;
uniform float uSlab;      // 1 = foam riding the surface, 0 = suspended cloud
varying float vFade;
varying float vDist;

void main(){
  // Wrap each mote into a box that follows the camera, so the cloud is endless.
  vec3 p = position;
  p.x += sin(uTime * 0.11 + aPhase * 6.28) * 0.35;
  p.y += sin(uTime * 0.07 + aPhase * 12.9) * 0.28 * (1.0 - uSlab)
       - uTime * 0.045 * (1.0 - uSlab);
  p.z += cos(uTime * 0.09 + aPhase * 9.4) * 0.35;

  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 world = uCenter + rel;

  /* Foam has to sit on the water, and the water moves: the swell shifts the
   * surface by nearly half a metre, so a slab pinned to absolute zero spends
   * half its time underneath an opaque ocean, invisible. In slab mode the
   * height comes straight from the surface instead of from the wrap. */
  if (uSlab > 0.5) {
    world.y = uCenter.y + p.y;
    rel.y = 0.0;
  }

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDist = -mv.z;
  // Soft in, soft out at the edge of the box — nothing ever pops.
  vFade = (1.0 - smoothstep(uBox * 0.24, uBox * 0.48, length(rel)))
        * smoothstep(0.30, 1.1, vDist);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio * (22.0 / max(vDist, 0.25));
}
`;

const MOTE_FRAG = /* glsl */ `
precision mediump float;
uniform vec3  uColor;
uniform float uOpacity;
varying float vFade;
varying float vDist;
${NOISE}
${FOG_FN}
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = (1.0 - r * 4.0);
  a *= a * vFade * uOpacity;
  float f = fogAmount(vDist);
  a *= 1.0 - f;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class Motes {
  /**
   * opts.slab flattens the cloud into a band around a height, which turns the
   * same system into surface foam. Foam matters more than it sounds: in open
   * fog with nothing inside the draw distance, specks streaming past the
   * camera are the only thing that tells a player they are moving at all.
   */
  constructor(scene, count, box = 26, opts = {}) {
    const rng = makeRng(opts.seed ?? 0x5c1e);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * box;
      pos[i * 3 + 1] = opts.slab
        ? (rng() - 0.5) * opts.slab
        : (rng() - 0.5) * box;
      pos[i * 3 + 2] = (rng() - 0.5) * box;
      size[i] = (0.4 + rng() * rng() * 2.6) * (opts.sizeScale ?? 1);
      phase[i] = rng();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), box * 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uCenter:     { value: new THREE.Vector3() },
        uBox:        { value: box },
        uPixelRatio: { value: 1 },
        uSlab:       { value: opts.slab ? 1 : 0 },
        uColor:      { value: new THREE.Color(opts.color ?? PALETTE.fogLow) },
        uOpacity:    { value: 0 },
        uFogLow:     { value: new THREE.Color(PALETTE.fogLow) },
        uFogHigh:    { value: new THREE.Color(PALETTE.fogHigh) },
        uMurkColor:  { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
        uFogNear:    { value: 6 },
        uFogFar:     { value: 52 },
        uUnderwater: { value: 0 },
      },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this._colorAbove = new THREE.Color(opts.color ?? PALETTE.fogLow);
    this._colorBelow = new THREE.Color(PALETTE.fogHigh).multiplyScalar(1.25);
    this._opts = opts;
  }

  update(state, camera, pixelRatio, speed01 = 0, surfaceY = 0) {
    const u = this.material.uniforms;
    u.uTime.value = state.time;
    u.uCenter.value.copy(camera.position);
    u.uPixelRatio.value = pixelRatio;
    u.uFogNear.value = state.fogNear;
    u.uFogFar.value = state.fogFar;
    u.uUnderwater.value = state.submersion;

    if (this._opts.slab) {
      // Follows the camera horizontally, rides the real waterline vertically,
      // and only shows up once you are disturbing it.
      u.uCenter.value.y = surfaceY;
      u.uOpacity.value = (0.05 + 0.50 * speed01) * (1 - state.submersion * 0.55);
    } else {
      // Almost nothing above the surface; unavoidable once you are under it.
      u.uOpacity.value = 0.022 + state.submersion * 0.90;
      u.uColor.value.copy(this._colorAbove).lerp(this._colorBelow, state.submersion);
    }
  }

  dispose() { this.points.geometry.dispose(); this.material.dispose(); }
}

/* -------------------------------------------------------------- the thing */

const LEV_VERT = /* glsl */ `
uniform float uTime;
varying vec3  vWorld;
varying vec3  vNormal;
varying float vDist;
varying float vY;

void main(){
  vec3 p = position;
  // A long, slow travelling undulation down the length of the body.
  float wave = sin(p.z * 0.055 - uTime * 0.55) * 1.0
             + sin(p.z * 0.021 + uTime * 0.31) * 1.7;
  p.x += wave * smoothstep(-10.0, 90.0, p.z) * 1.6;
  p.y += wave * 0.35;

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vY = p.z;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const LEV_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uCamPos;
uniform vec3  uBio;
uniform float uOpacity;
uniform float uTime;
varying vec3  vWorld;
varying vec3  vNormal;
varying float vDist;
varying float vY;
${NOISE}
${FOG_FN}

void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float ndv = clamp(dot(normalize(vNormal), V), 0.0, 1.0);

  // Darker than the dark. It occludes murk rather than reflecting anything.
  vec3 col = vec3(0.0008, 0.0016, 0.0019);
  col += uFogLow * pow(1.0 - ndv, 5.0) * 0.028;

  // A handful of dim lights strung along the flank. Not eyes. Probably.
  float lane = fbm3(vec3(vY * 0.09, vWorld.y * 0.2, uTime * 0.05), 3);
  float spark = smoothstep(0.79, 0.94, lane) * (0.5 + 0.5 * sin(uTime * 1.7 + vY));
  col += uBio * spark * 0.045;

  float f = fogAmount(vDist);
  float a = uOpacity * (1.0 - f * 0.90);
  if (a < 0.004) discard;
  col = mix(col, fogColorFor(-V), f * 0.55);
  gl_FragColor = vec4(col, a);
}
`;

export class Leviathan {
  constructor(scene) {
    // A single vast tapered body. No head, no features, no scale reference.
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 30, true);
    geo.rotateX(Math.PI / 2);
    const pos = geo.attributes.position;
    const rng = makeRng(0xabb5);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const t = z + 0.5;                       // 0..1 along the body
      const girth = Math.sin(Math.pow(t, 0.62) * Math.PI) * 0.92 + 0.08;
      const wobble = 1 + (rng() - 0.5) * 0.20;
      pos.setXYZ(i, x * girth * wobble * 11.0, y * girth * wobble * 8.0, z * 148.0);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uCamPos:     { value: new THREE.Vector3() },
        uBio:        { value: new THREE.Color(PALETTE.bio) },
        uOpacity:    { value: 0 },
        uFogLow:     { value: new THREE.Color(PALETTE.fogLow) },
        uFogHigh:    { value: new THREE.Color(PALETTE.fogHigh) },
        uMurkColor:  { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
        uFogNear:    { value: 6 },
        uFogFar:     { value: 52 },
        uUnderwater: { value: 0 },
      },
      vertexShader: LEV_VERT,
      fragmentShader: LEV_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.active = false;
    this.t = 0;
    this.duration = 46;
  }

  /** Starts the pass. `depth` is how far below the player it travels. */
  trigger(camera, depth = 62) {
    this.active = true;
    this.t = 0;
    this.mesh.visible = true;
    this.depth = depth;
    this.originX = camera.position.x;
    this.originZ = camera.position.z;
    this.heading = Math.random() * Math.PI * 2;
    this.travel = 320;
  }

  update(dt, state, camera) {
    const u = this.material.uniforms;
    u.uTime.value = state.time;
    u.uCamPos.value.copy(camera.position);
    u.uFogNear.value = state.fogNear;
    u.uFogFar.value = state.fogFar;
    u.uUnderwater.value = state.submersion;

    if (!this.active) return;
    this.t += dt;
    const k = saturate(this.t / this.duration);

    const along = (k - 0.5) * this.travel;
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    // Passes offset to one side so it is never framed as a subject.
    this.mesh.position.set(
      this.originX + hx * along - hz * 26,
      -this.depth + Math.sin(k * Math.PI) * 16,
      this.originZ + hz * along + hx * 26,
    );
    this.mesh.rotation.y = this.heading;

    // Only visible in the middle of the pass, and only barely.
    const window = Math.sin(k * Math.PI);
    u.uOpacity.value = window * 0.92 * state.submersion;

    if (k >= 1) { this.active = false; this.mesh.visible = false; }
  }

  /** 0..1 — how close the thing is to directly underneath. Drives infrasound. */
  proximity(camera) {
    if (!this.active) return 0;
    const d = Math.hypot(
      this.mesh.position.x - camera.position.x,
      this.mesh.position.z - camera.position.z,
    );
    return (1 - smoothstep(20, 190, d)) * Math.sin(saturate(this.t / this.duration) * Math.PI);
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
