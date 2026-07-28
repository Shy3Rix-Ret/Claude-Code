/**
 * The watchers.
 *
 * §3.2 — the mechanic is peripheral vision. A watcher is bright and legible at
 * the edge of the frame and dissolves the moment it lands in the middle of it.
 * Nothing is ever confirmed. The player is never given the satisfaction of a
 * good look.
 *
 * §5 — low-poly bases wrecked by vertex noise so the proportions read as wrong
 * rather than as bad modelling, with the eyes as a separate emissive mesh that
 * feeds the bloom pass.
 */

import * as THREE from 'three';
import { PALETTE, WATCHERS } from './config.js';
import { NOISE, FOG_FN } from './glsl.js';
import { clamp, damp, makeRng, rangeFrom, saturate, smoothstep } from './util.js';

/* ------------------------------------------------------------- geometry */

/** Minimal merge for position/normal-only geometries (avoids examples/jsm). */
function mergeGeometries(geos) {
  let vTotal = 0, iTotal = 0;
  for (const g of geos) {
    vTotal += g.attributes.position.count;
    iTotal += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vTotal * 3);
  const nrm = new Float32Array(vTotal * 3);
  const idx = new Uint32Array(iTotal);

  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    pos.set(p, vo * 3);
    nrm.set(n, vo * 3);
    const count = g.attributes.position.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      io += gi.length;
    } else {
      for (let i = 0; i < count; i++) idx[io + i] = i + vo;
      io += count;
    }
    vo += count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Deterministic 3D value noise, matched to the GLSL so shapes stay stable. */
function vnoise3(x, y, z, rngTable) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const H = (a, b, c) => rngTable[(((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)) >>> 0) & 1023];
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(H(xi, yi, zi), H(xi + 1, yi, zi), u), lerp(H(xi, yi + 1, zi), H(xi + 1, yi + 1, zi), u), v),
    lerp(lerp(H(xi, yi, zi + 1), H(xi + 1, yi, zi + 1), u), lerp(H(xi, yi + 1, zi + 1), H(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

function displace(geo, table, amount, freq, seedOffset) {
  const pos = geo.attributes.position;
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = vnoise3(x * freq + seedOffset, y * freq + seedOffset, z * freq + seedOffset, table);
    const n2 = vnoise3(x * freq * 2.7 - seedOffset, y * freq * 2.7, z * freq * 2.7 + seedOffset, table);
    const d = (n - 0.5) * amount + (n2 - 0.5) * amount * 0.4;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** One body: torso, an oversized head, and arms that hang far too long. */
function buildBody(seed) {
  const rng = makeRng(seed);
  const table = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) table[i] = rng();

  const parts = [];

  const torso = new THREE.IcosahedronGeometry(1, 3);
  torso.scale(0.40 + rng() * 0.09, 1.02 + rng() * 0.22, 0.27 + rng() * 0.06);
  displace(torso, table, 0.19, 1.7, rng() * 40);
  parts.push(torso);

  const head = new THREE.IcosahedronGeometry(0.235 + rng() * 0.05, 2);
  displace(head, table, 0.075, 5.5, rng() * 40);
  head.translate((rng() - 0.5) * 0.05, 1.16 + rng() * 0.09, (rng() - 0.5) * 0.04);
  parts.push(head);

  // Arms. Deliberately near the full height of the body.
  for (let s = -1; s <= 1; s += 2) {
    const arm = new THREE.IcosahedronGeometry(1, 2);
    arm.scale(0.062 + rng() * 0.02, 0.72 + rng() * 0.20, 0.055 + rng() * 0.018);
    displace(arm, table, 0.11, 3.1, rng() * 40);
    const tilt = (0.10 + rng() * 0.16) * s;
    arm.rotateZ(tilt);
    arm.translate(s * (0.33 + rng() * 0.07), 0.02 - rng() * 0.30, (rng() - 0.5) * 0.06);
    parts.push(arm);
  }

  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}

function buildEyes(seed) {
  const rng = makeRng(seed ^ 0xbeef);
  const parts = [];
  const sep = 0.070 + rng() * 0.022;
  const y = 1.18 + rng() * 0.07;
  for (let s = -1; s <= 1; s += 2) {
    const e = new THREE.SphereGeometry(0.0165 + rng() * 0.007, 8, 6);
    e.translate(s * sep, y + (rng() - 0.5) * 0.022, 0.145 + rng() * 0.02);
    parts.push(e);
  }
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return geo;
}

/* -------------------------------------------------------------- shaders */

const BODY_VERT = /* glsl */ `
uniform float uTime;
uniform float uWobble;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vDist;

void main(){
  vec3 p = position;
  // Slow, non-uniform swell — the silhouette never holds still enough to read.
  float s = sin(uTime * 0.7 + p.y * 2.1) * 0.5 + sin(uTime * 1.13 - p.x * 3.7) * 0.5;
  p += normal * s * 0.016 * uWobble;

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const BODY_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uCamPos;
uniform vec3  uBio;
uniform float uPresence;   // 0..1 master visibility
uniform float uEdge;       // 1 at the frame edge, 0 dead centre
uniform float uAmbient;
uniform float uTime;

varying vec3  vWorld;
varying vec3  vNormal;
varying float vDist;

${NOISE}
${FOG_FN}

void main(){
  vec3 V = normalize(uCamPos - vWorld);
  float ndv = clamp(dot(normalize(vNormal), V), 0.0, 1.0);

  // Mostly a hole in the fog. Slightly darker than whatever is behind it.
  vec3 base = vec3(0.006, 0.011, 0.013);

  // Wet rim where the fog wraps around the silhouette.
  float rim = pow(1.0 - ndv, 3.2);
  vec3 col = base + uFogLow * rim * 0.30;

  // Bioluminescence bleeding through the skin — never enough to light it (§3.1).
  float seep = fbm3(vWorld * 1.4 + vec3(0.0, uTime * 0.09, 0.0), 3);
  col += uBio * pow(seep, 3.5) * 0.055 * (0.4 + 0.6 * uEdge);

  col *= uAmbient;

  float f = fogAmount(vDist);
  col = mix(col, fogColorFor(-V), f);

  // Fade out with fog as well as presence, so a distant watcher never pops.
  float a = uPresence * (1.0 - f * 0.86);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const EYE_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uBio;
uniform float uPresence;
uniform float uGain;
uniform float uEdge;
varying float vDist;
varying vec3  vWorld;
varying vec3  vNormal;
${NOISE}
${FOG_FN}

void main(){
  // §3.2 — brightest in the periphery. Looking straight at them puts them out.
  float periph = mix(0.18, 1.0, uEdge);
  float f = fogAmount(vDist);
  float a = uPresence * (1.0 - f * 0.55);
  if (a < 0.004) discard;
  vec3 c = uBio * (1.1 + 2.4 * periph) * uGain;
  gl_FragColor = vec4(c * a, a);
}
`;

/* --------------------------------------------------------------- system */

const S = { DORMANT: 0, RISING: 1, WATCHING: 2, SUBMERGING: 3 };

class Watcher {
  constructor(index, scene, rng) {
    this.index = index;
    this.rng = rng;

    const seed = 0x4444 + index * 7919;
    this.bodyGeo = buildBody(seed);
    this.eyeGeo = buildEyes(seed);

    this.bodyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uWobble:    { value: 0.6 + rng() * 0.8 },
        uCamPos:    { value: new THREE.Vector3() },
        uBio:       { value: new THREE.Color(PALETTE.bio) },
        uPresence:  { value: 0 },
        uEdge:      { value: 1 },
        uAmbient:   { value: 1 },
        uFogLow:    { value: new THREE.Color(PALETTE.fogLow) },
        uFogHigh:   { value: new THREE.Color(PALETTE.fogHigh) },
        uMurkColor: { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
        uFogNear:   { value: 6 },
        uFogFar:    { value: 52 },
        uUnderwater:{ value: 0 },
      },
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.eyeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uWobble:    { value: 0 },
        uBio:       { value: new THREE.Color(PALETTE.bio) },
        uPresence:  { value: 0 },
        uGain:      { value: 1 },
        uEdge:      { value: 1 },
        uFogLow:    { value: new THREE.Color(PALETTE.fogLow) },
        uFogHigh:   { value: new THREE.Color(PALETTE.fogHigh) },
        uMurkColor: { value: new THREE.Color(PALETTE.waterDeep).multiplyScalar(2.2) },
        uFogNear:   { value: 6 },
        uFogFar:    { value: 52 },
        uUnderwater:{ value: 0 },
      },
      vertexShader: BODY_VERT,
      fragmentShader: EYE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(this.bodyGeo, this.bodyMat));
    this.group.add(new THREE.Mesh(this.eyeGeo, this.eyeMat));
    this.group.visible = false;
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.state = S.DORMANT;
    this.presence = 0;
    this.timer = rng() * 6;
    this.gazeT = 0;
    this.edge = 1;
    this.dist = 999;
    this.submerged = false;
    this.baseY = 0;
    this.angleDrift = (rng() - 0.5) * 0.02;
    this.scale = 0.92 + rng() * 0.30;
    this.group.scale.setScalar(this.scale);
    this._ndc = new THREE.Vector3();
  }

  /** Places the watcher somewhere the player is not currently looking. */
  spawn(camera, profile, ocean, time) {
    const rng = this.rng;
    const camYaw = Math.atan2(
      -camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10],
    );
    // 55°..180° off the view axis: they arrive at the edge, or behind you.
    const off = (0.96 + rng() * 2.18) * (rng() < 0.5 ? -1 : 1);
    const ang = camYaw + off;
    const d = rangeFrom(rng, profile.range);

    this.homeAngle = ang;
    this.dist = d;
    // A third of them never break the surface at all.
    this.submerged = rng() < 0.34;
    this.baseY = this.submerged ? -(1.4 + rng() * 3.2) : -(0.62 + rng() * 0.22);

    const x = camera.position.x + Math.sin(ang) * d;
    const z = camera.position.z + Math.cos(ang) * d;
    this.group.position.set(x, this.baseY, z);
    this.group.visible = true;
    this.state = S.RISING;
    this.timer = 0;
    this.gazeT = 0;
    this.riseTime = 1.6 + rng() * 2.4;
    this.dwell = rangeFrom(rng, profile.dwell);
    this.announced = false;
  }

  retire() {
    this.state = S.DORMANT;
    this.group.visible = false;
    this.presence = 0;
    this.timer = rangeFrom(this.rng, WATCHERS.cooldown);
  }

  update(dt, state, camera, ocean, profile, audio) {
    const g = this.group;

    if (this.state === S.DORMANT) {
      this.timer -= dt;
      return;
    }

    // Ride the swell, or hang below it.
    const surf = ocean.heightAt(g.position.x, g.position.z, state.time);
    const targetY = surf + this.baseY;
    g.position.y = damp(g.position.y, targetY, 2.4, dt);

    // Drift slowly around the player, and close in during Act 2.
    this.homeAngle += this.angleDrift * dt;
    this.dist = Math.max(6.5, this.dist - profile.approach * dt);
    g.position.x = damp(g.position.x, camera.position.x + Math.sin(this.homeAngle) * this.dist, 0.7, dt);
    g.position.z = damp(g.position.z, camera.position.z + Math.cos(this.homeAngle) * this.dist, 0.7, dt);

    // Always turned toward the player. Always.
    const dx = camera.position.x - g.position.x;
    const dz = camera.position.z - g.position.z;
    g.rotation.y = Math.atan2(dx, dz);

    /* ---- how centred is it? ---- */
    this._ndc.set(g.position.x, g.position.y + 1.2 * this.scale, g.position.z).project(camera);
    const behind = this._ndc.z > 1;
    const r = Math.hypot(this._ndc.x, this._ndc.y);
    const focus = behind ? 0 : smoothstep(WATCHERS.focusOuter, WATCHERS.focusInner, r);
    this.edge = 1 - focus;

    const eyeDist = Math.hypot(dx, dz);

    switch (this.state) {
      case S.RISING: {
        this.timer += dt;
        this.presence = saturate(this.timer / this.riseTime);
        if (!this.announced && this.presence > 0.35) {
          this.announced = true;
          audio?.watcherClick(g.position, camera);
        }
        if (this.presence >= 1) { this.state = S.WATCHING; this.timer = 0; }
        break;
      }
      case S.WATCHING: {
        this.timer += dt;
        this.presence = 1;
        // Being looked at directly is intolerable.
        if (focus > 0.62 && !this.submerged) {
          this.gazeT += dt;
          if (this.gazeT > WATCHERS.gazeTolerance) { this.state = S.SUBMERGING; this.timer = 0; }
        } else {
          this.gazeT = Math.max(0, this.gazeT - dt * 0.7);
        }
        if (this.timer > this.dwell) { this.state = S.SUBMERGING; this.timer = 0; }
        // Occasional clicks while it holds station.
        if (Math.random() < dt * 0.11 * (1 - smoothstep(10, 55, eyeDist))) {
          audio?.watcherClick(g.position, camera);
        }
        break;
      }
      case S.SUBMERGING: {
        this.timer += dt;
        this.presence = 1 - saturate(this.timer / WATCHERS.vanishTime);
        this.baseY -= dt * 2.6;
        if (this.presence <= 0) this.retire();
        break;
      }
      default: break;
    }

    /* ---- push to the shaders ---- */
    const bu = this.bodyMat.uniforms;
    bu.uTime.value = state.time;
    bu.uCamPos.value.copy(camera.position);
    bu.uPresence.value = this.presence;
    bu.uEdge.value = this.edge;
    bu.uAmbient.value = state.ambient;
    bu.uFogNear.value = state.fogNear;
    bu.uFogFar.value = state.fogFar;
    bu.uUnderwater.value = state.submersion;

    const eu = this.eyeMat.uniforms;
    eu.uTime.value = state.time;
    eu.uPresence.value = this.presence;
    eu.uEdge.value = this.edge;
    eu.uGain.value = profile.eyeGain;
    eu.uFogNear.value = state.fogNear;
    eu.uFogFar.value = state.fogFar;
    eu.uUnderwater.value = state.submersion;
  }

  dispose() {
    this.bodyGeo.dispose();
    this.eyeGeo.dispose();
    this.bodyMat.dispose();
    this.eyeMat.dispose();
  }
}

export class WatcherSystem {
  constructor(scene, audio) {
    this.rng = makeRng(0x1e4f);
    this.audio = audio;
    this.pool = [];
    for (let i = 0; i < WATCHERS.poolSize; i++) {
      this.pool.push(new Watcher(i, scene, this.rng));
    }
    this.spawnCooldown = 3;
  }

  /** Act 3 opens with every one of them leaving at once. */
  banishAll() {
    for (const w of this.pool) {
      if (w.state !== S.DORMANT) { w.state = S.SUBMERGING; w.timer = 0; }
    }
  }

  update(dt, state, camera, ocean) {
    const profile = WATCHERS.acts[state.watcherProfile] ?? WATCHERS.acts.ACT1;

    let live = 0;
    let alert = 0;
    for (const w of this.pool) {
      w.update(dt, state, camera, ocean, profile, this.audio);
      if (w.state !== S.DORMANT) {
        live++;
        const prox = 1 - smoothstep(8, 48, w.dist);
        alert = Math.max(alert, prox * w.presence);
      }
    }

    state.watcherAlert = damp(state.watcherAlert, alert, 3, dt);

    this.spawnCooldown -= dt;
    if (live < profile.active && this.spawnCooldown <= 0) {
      const candidate = this.pool.find((w) => w.state === S.DORMANT && w.timer <= 0);
      if (candidate) {
        candidate.spawn(camera, profile, ocean, state.time);
        this.spawnCooldown = 1.4 + this.rng() * 4.5;
      } else {
        this.spawnCooldown = 0.6;
      }
    }
  }

  dispose() { this.pool.forEach((w) => w.dispose()); }
}

/**
 * §2.3 — the four-to-six frame cut of something pale sliding away under the
 * surface. Long enough to register, far too short to confirm.
 */
export class Apparition {
  constructor(scene) {
    this.geo = buildBody(0x77aa);
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xb9c4c2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.scale.setScalar(2.6);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.t = -1;
    this.duration = 0.085; // ~5 frames at 60fps
  }

  /** Drops it just under the surface, in view, moving away. */
  trigger(camera) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const p = camera.position.clone()
      .addScaledVector(dir, 11)
      .add(new THREE.Vector3(dir.z * 2.5, 0, -dir.x * 2.5));
    p.y = -2.3;
    this.mesh.position.copy(p);
    this.mesh.rotation.set(1.15, Math.atan2(dir.x, dir.z) + 0.6, 0.35);
    this.mesh.visible = true;
    this.t = 0;
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / this.duration;
    this.mat.opacity = k < 1 ? 0.30 * (1 - k * 0.35) : 0;
    this.mesh.position.y -= dt * 5.5;
    this.mesh.position.z -= dt * 3.0;
    if (k >= 1) { this.mesh.visible = false; this.t = -1; }
  }

  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
