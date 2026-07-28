/**
 * The hand (§5, Act 5).
 *
 * You never see it until the very end, and when you do it should be a small
 * shock — grey, waterlogged, and not obviously in good condition. It is
 * parented to the camera and animated in view space so it survives whatever
 * the player is doing with their thumb.
 *
 * Everything here is tuned around one constraint: at 40cm from a 68° lens a
 * human hand already eats a third of the frame, so the arm has to leave the
 * picture fast or the shot becomes a portrait of a forearm.
 */

import * as THREE from 'three';
import { makeFoggedMaterial, syncFogged } from './materials.js';
import { clamp, easeInOut, lerp, saturate, fbm1 } from './util.js';

function roundedBox(w, h, d, r, seg = 3) {
  const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
  const pos = geo.attributes.position;
  const hw = Math.max(0, w / 2 - r), hh = Math.max(0, h / 2 - r), hd = Math.max(0, d / 2 - r);
  const v = new THREE.Vector3(), c = new THREE.Vector3(), dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd));
    dir.copy(v).sub(c);
    const len = dir.length();
    if (len > 1e-6) v.copy(c).addScaledVector(dir, r / len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** A chain of joints, each pivoting off the end of the last. */
function makeFinger(material, lengths, widths, geos) {
  const joints = [];
  let parent = new THREE.Group();
  const root = parent;
  for (let i = 0; i < lengths.length; i++) {
    const j = new THREE.Group();
    parent.add(j);
    // Segments overlap slightly so the knuckles never show daylight.
    const len = lengths[i] * 1.18;
    const g = roundedBox(widths[i], widths[i] * 0.88, len, widths[i] * 0.44, 2);
    geos.push(g);
    const m = new THREE.Mesh(g, material);
    m.position.z = -len / 2 + lengths[i] * 0.09;
    j.add(m);
    const next = new THREE.Group();
    next.position.z = -lengths[i];
    j.add(next);
    joints.push(j);
    parent = next;
  }
  return { root, joints };
}

export class Hand {
  constructor(camera) {
    this.camera = camera;
    this.geos = [];
    // Skin that has been in cold water long enough to stop looking like skin.
    this.material = makeFoggedMaterial({
      color: 0x6f6862, rough: 0.55, wetness: 0.95, hemiIntensity: 0.52,
    });

    this.root = new THREE.Group();
    this.root.visible = false;
    camera.add(this.root);

    this.wrist = new THREE.Group();
    this.root.add(this.wrist);

    const palmGeo = roundedBox(0.082, 0.030, 0.092, 0.014, 3);
    this.geos.push(palmGeo);
    const palm = new THREE.Mesh(palmGeo, this.material);
    palm.position.z = -0.046;
    this.wrist.add(palm);

    // Short and tapered: just enough wrist to read, then out of frame.
    const forearmGeo = roundedBox(0.046, 0.042, 0.19, 0.020, 3);
    this.geos.push(forearmGeo);
    const forearm = new THREE.Mesh(forearmGeo, this.material);
    forearm.position.z = 0.094;
    this.wrist.add(forearm);

    // Four fingers, splayed slightly, each a little too long.
    this.fingers = [];
    const spread = [-0.030, -0.010, 0.010, 0.030];
    const scaleByFinger = [0.94, 1.08, 1.02, 0.86];
    for (let i = 0; i < 4; i++) {
      const s = scaleByFinger[i];
      const f = makeFinger(
        this.material,
        [0.040 * s, 0.029 * s, 0.023 * s],
        [0.0185 * s, 0.0168 * s, 0.0142 * s],
        this.geos,
      );
      f.root.position.set(spread[i], 0.001, -0.090);
      f.root.rotation.y = -spread[i] * 2.4;
      this.wrist.add(f.root);
      this.fingers.push(f);
    }

    // Thumb, off the side of the palm.
    const thumb = makeFinger(this.material, [0.038, 0.030], [0.0225, 0.0185], this.geos);
    thumb.root.position.set(-0.040, -0.003, -0.048);
    thumb.root.rotation.set(0.12, 1.02, 0.0);
    this.wrist.add(thumb.root);
    this.thumb = thumb;

    /* Poses, in camera space. The arm enters low and from the right, so the
     * forearm leaves the frame instead of lying across it. */
    this.restPos = new THREE.Vector3(0.22, -0.36, -0.30);
    this.reachPos = new THREE.Vector3(0.098, 0.042, -0.405);
    this.restRot = new THREE.Euler(0.62, 0.46, -0.34);
    this.reachRot = new THREE.Euler(0.04, 0.34, -0.11);

    this.reach = 0;
    this.grip = 0;
  }

  /** reach: 0 = out of frame, 1 = at the handle. grip: 0 = open, 1 = closed. */
  setPose(reach, grip) {
    this.reach = reach;
    this.grip = grip;
  }

  update(dt, state, camera, warm) {
    const show = this.reach > 0.001;
    this.root.visible = show;
    if (!show) return;

    const k = easeInOut(saturate(this.reach));

    this.wrist.position.lerpVectors(this.restPos, this.reachPos, k);
    this.wrist.rotation.set(
      lerp(this.restRot.x, this.reachRot.x, k),
      lerp(this.restRot.y, this.reachRot.y, k),
      lerp(this.restRot.z, this.reachRot.z, k),
    );

    // Cold, tired, and not entirely steady.
    const t = state.time;
    const tremor = 0.0032 + 0.0038 * (1 - k);
    this.wrist.position.x += fbm1(t * 3.1, 2) * tremor;
    this.wrist.position.y += fbm1(t * 2.7 + 41, 2) * tremor;
    this.wrist.rotation.z += fbm1(t * 2.2 + 91, 2) * 0.030;

    // Curl. The fingers close last, once the hand is nearly there.
    const g = saturate(this.grip);
    const curls = [1.0, 1.06, 1.0, 0.92];
    for (let i = 0; i < 4; i++) {
      const f = this.fingers[i];
      const c = g * curls[i];
      f.joints[0].rotation.x = 0.12 + c * 0.98;
      f.joints[1].rotation.x = 0.08 + c * 1.10;
      f.joints[2].rotation.x = 0.05 + c * 0.84;
    }
    this.thumb.joints[0].rotation.x = 0.10 + g * 0.58;
    this.thumb.joints[1].rotation.x = 0.06 + g * 0.76;

    syncFogged(this.material, state, camera, warm);
    // The hand is 40cm from the lens; distance fog would swallow it, so it
    // gets its own much longer falloff.
    this.material.uniforms.uFogNear.value = 8;
    this.material.uniforms.uFogFar.value = 400;
    this.material.uniforms.uExtraFog.value = 0;
    this.material.uniforms.uOpacity.value = 1;
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.material.dispose();
  }
}
