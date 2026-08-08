/**
 * The star, and what the hall does about it.
 *
 * There is exactly one shadow-casting light. Everything else — how dark the
 * room gets, whether the plants glow, whether the strip lights matter — is
 * derived from where that light is. Crucially the hull is *not* faked: the
 * walls and ceiling cast shadows, so when the star swings round to the blind
 * side of the station the hall goes dark because the building is in the way,
 * not because something dimmed a number.
 *
 * The station tumbles rather than orbits, so the star sweeps out and back
 * instead of circling. Both turning points are the melancholy part: the light
 * leaves through the same window it came in by.
 */

import * as THREE from 'three';
import { SUN, PALETTE, HALL } from './config.js';
import { pingPong, lerp, saturate, smoothstep } from './util.js';

export class SunRig {
  constructor(scene, openings, quality) {
    this.openings = openings;

    this.light = new THREE.DirectionalLight(new THREE.Color(PALETTE.sunHigh), SUN.intensityHigh);
    this.light.castShadow = true;

    const s = this.light.shadow;
    s.mapSize.set(quality.shadow, quality.shadow);
    /* The frustum has to hold the whole hall from any direction, and the hall
     * is long. 96 metres across a 2048 map is a 4.7 cm texel — coarse, but
     * these are shadows of a building, not of eyelashes. */
    s.camera.left = -48;
    s.camera.right = 48;
    s.camera.top = 52;
    s.camera.bottom = -52;
    s.camera.near = 140;
    s.camera.far = 400;
    s.bias = -0.0004;
    s.normalBias = 0.022;
    s.radius = 2.2;

    this.target = new THREE.Object3D();
    this.target.position.set(0, HALL.height * 0.35, 0);
    scene.add(this.target);
    this.light.target = this.target;
    scene.add(this.light);

    /* Fill light. In a real hull this is the light bouncing off the plating,
     * and it is the only reason the shadowed side of anything is visible. */
    this.hemi = new THREE.HemisphereLight(
      new THREE.Color(PALETTE.sunLow),
      new THREE.Color(PALETTE.bounce),
      0.5,
    );
    scene.add(this.hemi);

    /* A hemisphere light gives a downward-facing surface its ground colour and
     * nothing else, which left the ceiling — the largest surface in the room,
     * and the one every shaft is silhouetted against — at pure black. This
     * lifts it just far enough to read as a ceiling rather than as a hole. */
    this.ambient = new THREE.AmbientLight(new THREE.Color(PALETTE.bounce), 0.3);
    scene.add(this.ambient);

    /** Shared state, read by everything that cares what time it is. */
    this.state = {
      direction: new THREE.Vector3(0, -1, 0),   // the way the light travels
      toSun: new THREE.Vector3(0, 1, 0),
      color: new THREE.Color(PALETTE.sunHigh),
      daylight: 1,        // 0..1, how much of the star the hall can actually see
      perOpening: new Float32Array(openings.list.length),
      angle: 0,
    };

    this.update(0);
  }

  update(time) {
    const st = this.state;

    const p = pingPong(time + SUN.startPhase * SUN.period, SUN.period);
    const angle = lerp(SUN.angleFrom, SUN.angleTo, p);
    st.angle = angle;

    // A much slower nod out of the hall's cross-section. This is the only
    // thing that ever puts the star in front of the panorama window.
    const tilt = SUN.tiltAmount * Math.sin((time / SUN.tiltPeriod) * Math.PI * 2);

    st.toSun.set(Math.cos(angle), Math.sin(angle), tilt).normalize();
    st.direction.copy(st.toSun).negate();

    this.light.position.copy(st.toSun).multiplyScalar(SUN.distance).add(this.target.position);

    /* How much light each opening is admitting: the cosine between the way
     * the light travels and the opening's inward normal. Negative means the
     * star is on the wrong side of that wall. */
    let best = 0;
    this.openings.list.forEach((o, i) => {
      const c = saturate(st.direction.dot(o.normal));
      st.perOpening[i] = c;
      if (c > best) best = c;
    });
/* Widened deliberately. With the old 0.45 ceiling the hall sat at full
     * daylight for nearly the whole sweep and the cycle stopped meaning
     * anything; this tracks what is actually getting in. */
    st.daylight = smoothstep(0.02, 0.85, best);

    /* Grazing light is warm, overhead light is not. Same trick as a sunset,
     * for the same reason — it is the one colour cue everybody reads. */
    const high = saturate(Math.abs(st.toSun.y) * 1.7);
    st.color.set(PALETTE.sunLow).lerp(new THREE.Color(PALETTE.sunHigh), high);
    this.light.color.copy(st.color);
    this.light.intensity = lerp(SUN.intensityLow, SUN.intensityHigh, high);

    this.hemi.intensity = lerp(SUN.ambientNight, SUN.ambientDay, st.daylight);
/* Bounce off a steel hull is not the colour of the star. Copying the
     * sun colour straight in turned every up-facing surface orange. */
    this.hemi.color.set(PALETTE.bounce).lerp(st.color, 0.42);
    this.ambient.intensity = lerp(0.16, 0.70, st.daylight);

    return st;
  }
}
