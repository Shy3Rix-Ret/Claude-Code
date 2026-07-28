/**
 * The light, and what it turns out to be.
 *
 * §3.1 — #f4b942 is the only saturated value in the entire colour space. The
 * contrast has to be brutal: everything else is dead, this is the one living
 * thing in the frame. It exists in three stages — a pinprick that ignores fog,
 * a bloom in the murk as you close, and finally a rusted door standing upright
 * in open water with light coming out from under it.
 */

import * as THREE from 'three';
import { DOOR, PALETTE } from './config.js';
import { NOISE } from './glsl.js';
import { makeFoggedMaterial, makeRustTexture, syncFogged } from './materials.js';
import { saturate, smoothstep, damp } from './util.js';

/* ---------------------------------------------------------------- beacon */

const BEACON_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform vec3  uCore;
uniform float uIntensity;
uniform float uTime;
uniform float uFlicker;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;

  // Tight core, wide halo, and a faint anamorphic smear along the horizontal.
  float core = pow(max(0.0, 1.0 - r), 26.0);
  float halo = pow(max(0.0, 1.0 - r), 2.3) * 0.30;
  float streak = pow(max(0.0, 1.0 - abs(d.y) * 14.0), 3.0)
               * pow(max(0.0, 1.0 - abs(d.x) * 2.1), 2.0) * 0.22;

  // Never steady. Something is between you and it, moving.
  float f = 1.0 - uFlicker * (0.5 + 0.5 * sin(uTime * 2.3))
                            * fbm2(vec2(uTime * 0.7, 0.0), 3);

  vec3 c = mix(uColor, uCore, core) * (core * 2.4 + halo + streak);
  gl_FragColor = vec4(c * uIntensity * f, 1.0);
}
`;

const BEACON_VERT = /* glsl */ `
varying vec2 vUv;
uniform float uScale;
void main(){
  vUv = uv;
  // Camera-facing billboard, sized in view space so it holds a constant
  // apparent size until you are genuinely close to it.
  vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uScale;
  gl_Position = projectionMatrix * mv;
}
`;

/* ------------------------------------------------------------ glow decal */

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
varying float vDist;
uniform float uScale;
void main(){
  vUv = uv;
  vec4 mv = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vDist = -mv.z;
  mv.xy += position.xy * uScale;
  gl_Position = projectionMatrix * mv;
}
`;

const GLOW_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2  vUv;
varying float vDist;
${NOISE}
void main(){
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float g = pow(1.0 - r, 3.1);
  // Fog is never smooth — let the halo boil very slightly.
  float n = 0.82 + 0.36 * fbm2(d * 5.0 + uTime * 0.06, 3);
  gl_FragColor = vec4(uColor * g * n * uIntensity, 1.0);
}
`;

/* ----------------------------------------------------------- light shaft */

const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SHAFT_FRAG = /* glsl */ `
precision highp float;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;
uniform vec3  uCamPos;
varying vec2  vUv;
varying vec3  vWorld;
${NOISE}
void main(){
  // Bright at the door, gone by the far end.
  float along = 1.0 - vUv.y;
  float body = pow(along, 2.2);
  // Soft edges across the width.
  float across = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 1.7);
  float dust = 0.75 + 0.5 * fbm2(vec2(vUv.x * 4.0, vUv.y * 2.0 - uTime * 0.05), 3);
  float a = body * across * dust;
  gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
}
`;

export class Beacon {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: new THREE.Color(PALETTE.beacon) },
        uCore:      { value: new THREE.Color(PALETTE.beaconCore) },
        uIntensity: { value: 0 },
        uScale:     { value: 1 },
        uTime:      { value: 0 },
        uFlicker:   { value: 0.18 },
      },
      vertexShader: BEACON_VERT,
      fragmentShader: BEACON_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,     // it reads through the fog — that is the whole point
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(state, camera, worldPos) {
    this.mesh.position.copy(worldPos);
    const u = this.material.uniforms;
    u.uTime.value = state.time;

    const dist = camera.position.distanceTo(worldPos);
    // Constant apparent size far out, blooming open as you arrive.
    const near = 1 - smoothstep(14, 90, dist);
    u.uScale.value = (0.0135 * dist) * (1 + near * 2.4);
    // Hand off to the real geometry rather than fighting with it up close.
    const handoff = 1 - smoothstep(5.0, 16.0, dist);
    u.uIntensity.value = state.beacon * (1 - handoff * 0.72);
    u.uFlicker.value = 0.22 * (1 - smoothstep(30, 120, dist));
    this.mesh.visible = state.beacon > 0.002;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}

export class Door {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.position.set(...DOOR.position);
    // Front face is local +Z; the director aims it down the approach in
    // lockBeacon(). Default: facing +Z, i.e. back toward the player's start.
    this.root.rotation.y = 0;
    this.root.rotation.z = 0.035;       // nothing out here stands quite straight
    this.root.visible = false;
    scene.add(this.root);

    this.worldPos = new THREE.Vector3(...DOOR.position);
    this.lightAnchor = new THREE.Vector3(DOOR.position[0], DOOR.position[1] + 0.2, DOOR.position[2]);

    const rust = makeRustTexture(512);
    this.rust = rust;

    this.materials = [];
    const mk = (opts) => { const m = makeFoggedMaterial(opts); this.materials.push(m); return m; };

    const frameMat = mk({ color: 0x6c6862, map: rust, rough: 0.94, wetness: 0.80, hemiIntensity: 0.95 });
    const panelMat = mk({ color: 0x7d786e, map: rust, rough: 0.90, wetness: 0.74, hemiIntensity: 0.95 });
    const metalMat = mk({ color: 0x9a948a, rough: 0.40, wetness: 0.90, hemiIntensity: 1.05 });

    const W = 1.02, H = 2.14, T = 0.075, FR = 0.085;
    // The door stands in the water rather than floating on it: the surface
    // moves against it, it does not ride the swell. Reads as planted, which is
    // considerably worse than "adrift".
    const BASE_Y = -0.34;

    /* --- frame: four rusted members, freestanding in open water --- */
    const frame = new THREE.Group();
    const post = new THREE.BoxGeometry(FR, H + FR * 2, T * 2.1);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(post, frameMat);
      m.position.set(s * (W / 2 + FR / 2), H / 2, 0);
      frame.add(m);
    }
    const lintel = new THREE.BoxGeometry(W + FR * 2, FR, T * 2.1);
    const top = new THREE.Mesh(lintel, frameMat);
    top.position.set(0, H + FR / 2, 0);
    frame.add(top);
    const sill = new THREE.Mesh(lintel, frameMat);
    sill.position.set(0, -FR / 2, 0);
    frame.add(sill);
    frame.position.y = BASE_Y;  // sill sits well under the waterline
    this.root.add(frame);
    this.frame = frame;

    /* --- the door itself, on a hinge pivot --- */
    this.pivot = new THREE.Group();
    this.pivot.position.set(-W / 2, BASE_Y, 0);
    this.root.add(this.pivot);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(W, H, T), panelMat);
    panel.position.set(W / 2, H / 2, 0);
    this.pivot.add(panel);
    this.panel = panel;

    // Two recessed sections, so it reads as a door and not a slab.
    for (const y of [H * 0.30, H * 0.70]) {
      const inset = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, H * 0.26, T * 0.35), panelMat);
      inset.position.set(W / 2, y, T * 0.42);
      this.pivot.add(inset);
    }

    // Lever handle.
    const handle = new THREE.Group();
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.022, 12), metalMat);
    rose.rotation.x = Math.PI / 2;
    handle.add(rose);
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.030, 0.030), metalMat);
    lever.position.set(-0.062, -0.010, 0.052);
    handle.add(lever);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.055, 10), metalMat);
    stem.rotation.x = Math.PI / 2;
    stem.position.z = 0.030;
    handle.add(stem);
    handle.position.set(W - 0.135, H * 0.48, T * 0.5);
    this.pivot.add(handle);
    this.handle = handle;
    this.handleWorld = new THREE.Vector3();

    // Hinges.
    for (const y of [H * 0.16, H * 0.84]) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.10, 8), metalMat);
      h.position.set(0.012, y, 0);
      this.pivot.add(h);
    }

    /* --- the threshold: what is on the other side --- */
    /* Sits just behind the panel, so the closed door occludes it and the swing
     * reveals it. Whatever is through there, you never get to look at it —
     * the exposure blows out before your eyes adjust. */
    this.threshold = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.01, H * 1.01),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.beaconCore),
        transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, fog: false,
      }),
    );
    this.threshold.position.set(0, BASE_Y + H / 2, -0.02);
    this.root.add(this.threshold);

    /* --- what comes out from under it --- */
    const warm = new THREE.Color(PALETTE.beacon);

    this.gap = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 0.94, 0.085),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.beaconCore),
        transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    this.gap.position.set(0, BASE_Y + 0.055, T * 0.55);
    this.root.add(this.gap);

    this.haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: warm.clone() },
        uIntensity: { value: 0 },
        uScale:     { value: 3.0 },
        uTime:      { value: 0 },
      },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      // Depth-tested: the water in front of the door must occlude the lower
      // half of the glow, or it reads as a puddle of light floating on top.
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.haloMat);
    this.halo.position.set(0, BASE_Y + 0.35, 0.16);
    this.halo.frustumCulled = false;
    this.halo.renderOrder = 880;
    this.root.add(this.halo);

    this.shaftMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: warm.clone() },
        uIntensity: { value: 0 },
        uTime:      { value: 0 },
        uCamPos:    { value: new THREE.Vector3() },
      },
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
    });
    this.shafts = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 4.6), this.shaftMat);
      q.geometry.translate(0, 2.3, 0);
      q.rotation.x = -Math.PI / 2 + 0.22 + i * 0.05;
      q.rotation.z = (i - 2) * 0.22;
      q.position.set(0, BASE_Y + 0.18, T * 0.6);
      this.shafts.add(q);
    }
    this.root.add(this.shafts);

    this.opening = 0;
    this._reveal = 0;
    this._warmPos = new THREE.Vector3();
    this._thresholdColor = new THREE.Color(PALETTE.beacon);
    this._thresholdHot = new THREE.Color(0xffffff);
  }

  /** World position of the handle — the hand reaches for this in Act 5. */
  getHandleWorld() {
    this.handle.getWorldPosition(this.handleWorld);
    return this.handleWorld;
  }

  update(dt, state, camera, ocean) {
    const dist = camera.position.distanceTo(this.worldPos);
    state.doorDistance = dist;

    // Geometry resolves out of the fog rather than switching on.
    const target = smoothstep(46, 14, dist) * state.beacon;
    this._reveal = damp(this._reveal, target, 2.2, dt);
    state.doorReveal = this._reveal;
    this.root.visible = this._reveal > 0.004 || state.doorOpen > 0;

    // It rides the long swell like everything else out here, but the chop laps
    // against it — so the waterline moves and the door does not.
    this.root.position.y = DOOR.position[1]
      + ocean.swellAt(this.worldPos.x, this.worldPos.z, state.time);
    this.root.rotation.z = 0.035 + Math.sin(state.time * 0.29) * 0.010;
    this.root.rotation.x = Math.sin(state.time * 0.23 + 1.1) * 0.007;

    // Hinge swing.
    this.opening = damp(this.opening, state.doorOpen, 1.5, dt);
    this.pivot.rotation.y = -this.opening * 1.66;

    // The spill sits just in front of and below the door, so the front face is
    // raked from underneath — the only warm light in the level, used sparingly.
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion);
    this._warmPos.copy(this.worldPos)
      .addScaledVector(front, 0.30)
      .setY(this.root.position.y - 0.16);
    const warm = {
      position: this._warmPos,
      intensity: (0.75 + this.opening * 6.0) * this._reveal,
      range: 2.4,
    };

    for (const m of this.materials) {
      syncFogged(m, state, camera, warm);
      // Reveal by fog, never by alpha: these panels overlap, and fading them
      // with opacity makes them depth-reject one another.
      m.uniforms.uExtraFog.value = 1 - this._reveal;
    }

    // The doorway itself, once anything of it is showing.
    this.threshold.material.opacity = saturate(this._reveal * this.opening * 3.4);
    this.threshold.material.color.copy(this._thresholdColor)
      .lerp(this._thresholdHot, saturate(this.opening * 1.3));

    const spill = this._reveal * (0.9 + this.opening * 7.0);
    this.gap.material.opacity = saturate(spill * 0.50);
    this.haloMat.uniforms.uIntensity.value = spill * 0.34;
    this.haloMat.uniforms.uScale.value = 1.5 + this.opening * 3.2;
    this.haloMat.uniforms.uTime.value = state.time;
    this.shaftMat.uniforms.uIntensity.value = spill * 0.10;
    this.shaftMat.uniforms.uTime.value = state.time;
    this.shaftMat.uniforms.uCamPos.value.copy(camera.position);

    return dist;
  }

  dispose() {
    this.rust.dispose();
    this.materials.forEach((m) => m.dispose());
    this.haloMat.dispose();
    this.shaftMat.dispose();
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
