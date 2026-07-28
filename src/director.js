/**
 * The director.
 *
 * Owns the clock, the acts, and every value the rest of the level reads. This
 * is the only place that decides what is happening; everything else just
 * renders whatever it is handed.
 *
 * On one contradiction in the design doc: §2.2/§2.3 have the distant light
 * appearing during the awakening and framed at the end of the establishing
 * pan, while §4 has it appearing for the first time in Act 2. Both are kept.
 * You glimpse it in the prologue, it is gone for the whole of Act 1, and it
 * comes back in Act 2 — which turns the light into the same question the
 * watchers are: did I see that, or not. The doc's own doubt mechanic, applied
 * to the one thing in the frame you want to trust.
 */

import * as THREE from 'three';
import { DOOR, FOG, POST, SCRIPT, SWIM, TITLE_CARD } from './config.js';
import { PHASE } from './state.js';
import {
  clamp, damp, easeInOut, easeOutCubic, lerp, saturate, smoothstep, fbm1,
} from './util.js';

/* How long the player must stay off the screen in Act 3 (§4). */
const STILL_REQUIRED = 46;
/* Hard ceiling: the moment always resolves, however much they fight it (§4). */
const ACT3_HARD_CAP = 210;
/* How deep you go. Far enough that the surface stops being a fact. */
export const SINK_DEPTH = 3.6;

/**
 * Bearings and camera yaw are not the same number. A bearing b points along
 * (sin b, 0, cos b); a camera at rotation.y = θ looks along (-sin θ, 0, -cos θ).
 */
const bearingToYaw = (b) => b + Math.PI;

export class Director {
  constructor(ctx) {
    this.g = ctx;                 // { state, controls, audio, overlay, world }
    this.state = ctx.state;

    this.phaseIndex = 0;
    this.scripted = { active: false, yaw: 0, pitch: 0, height: 0 };

    /* The light's bearing — fixed for the whole run so it becomes a direction
     * the player learns, not a thing that moves around behind their back.
     * A "bearing" b points along (sin b, 0, cos b); a three.js camera with
     * rotation.y = θ looks along (-sin θ, 0, -cos θ). Hence bearingToYaw(). */
    this.beaconBearing = Math.PI;         // -Z
    this.beaconWorld = new THREE.Vector3();
    this.beaconLocked = false;
    this.horizonDistance = 780;

    this.titleShown = false;
    this._act1BeaconFade = 0;

    /* Act 3 bookkeeping */
    this.stillAccum = 0;
    this.agitation = 0;
    this.act3Stage = 0;           // 0 silence, 1 darkening, 2 sinking, 3 rising
    this.act3Total = 0;
    this.leviathanFired = false;

    /* Act 4 */
    this.directLook = 0;          // how long the player has stared at the light
    this.guidance = 1;            // 1 = obeying rule 1, 0 = staring straight at it
    this.swimBoost = 1;

    /* Act 5 */
    this.act5Stage = 0;
    this.handReach = 0;
    this.handGrip = 0;
    this.openHold = 0;
    this.endShown = false;

    this.drift = new THREE.Vector3();
    this._toDoor = new THREE.Vector3();
    this._fogPhase = Math.random() * 100;
  }

  /* ------------------------------------------------------------ helpers */

  setPhase(phase) {
    const s = this.state;
    s.phase = phase;
    s.phaseT = 0;
    this.onEnter(phase);
  }

  onEnter(phase) {
    const { audio, watchers, overlay } = this.g;
    const s = this.state;

    switch (phase) {
      case PHASE.COLD_OPEN:
        s.fade = 1;
        s.ambienceLevel = 0;
        audio.breathGain = 0;
        audio.playColdOpen();
        break;

      case PHASE.WAKE:
        // You come round already in the water, face barely clear of it (§2.2).
        audio.breathGain = 0.95;
        audio.breathRate = 1.45;      // hurried
        s.breathIntensity = 1.0;
        s.shake = 0.85;
        break;

      case PHASE.ESTABLISH: {
        // §2.3 — control is taken away, on purpose.
        s.controlEnabled = false;
        s.swimEnabled = false;
        this.scripted.active = true;
        // Start the arc 180° off the light so the pan lands on it.
        this.panEnd = bearingToYaw(this.beaconBearing);
        this.panStart = this.panEnd - Math.PI;
        this.panFrom = this.g.controls.yaw;
        this.apparitionFired = false;
        break;
      }

      case PHASE.ACT1:
        s.controlEnabled = true;
        s.swimEnabled = true;
        s.watcherProfile = 'ACT1';
        this.scripted.active = false;
        s.groansEnabled = false;
        break;

      case PHASE.ACT2:
        s.watcherProfile = 'ACT2';
        s.groansEnabled = true;
        break;

      case PHASE.ACT3:
        // §4 — they all leave at once. That is the cue.
        watchers.banishAll();
        s.watcherProfile = 'ACT3';
        this.act3Stage = 0;
        this.act3Total = 0;
        this.stillAccum = 0;
        this.agitation = 0;
        this.leviathanFired = false;
        break;

      case PHASE.ACT4:
        s.watcherProfile = 'ACT4';
        s.swimEnabled = true;
        this.lockBeacon();
        break;

      case PHASE.ACT5:
        s.watcherProfile = 'ACT5';
        this.act5Stage = 0;
        this.swimBoost = 1;
        break;

      case PHASE.END:
        break;

      default: break;
    }
  }

  /** Freezes the light at a real, reachable world position (§4, Act 4). */
  lockBeacon() {
    const p = this.g.controls.position;
    // Tuned so an engaged player crosses in ~3:20 and a passive one in ~5:00.
    const d = 250;
    this.beaconWorld.set(
      p.x + Math.sin(this.beaconBearing) * d,
      0,
      p.z + Math.cos(this.beaconBearing) * d,
    );
    this.beaconLocked = true;
    const door = this.g.door;
    // The door's front face (+Z local) has to look back down the approach.
    door.root.position.x = this.beaconWorld.x;
    door.root.position.z = this.beaconWorld.z;
    door.worldPos.set(this.beaconWorld.x, 0, this.beaconWorld.z);
    // Face the door back along the approach.
    door.root.rotation.y = bearingToYaw(this.beaconBearing);
  }

  /** Where the light is right now — on the horizon, or where we pinned it. */
  updateBeaconPosition() {
    if (this.beaconLocked) return this.beaconWorld;
    const p = this.g.controls.position;
    this.beaconWorld.set(
      p.x + Math.sin(this.beaconBearing) * this.horizonDistance,
      0.9,
      p.z + Math.cos(this.beaconBearing) * this.horizonDistance,
    );
    return this.beaconWorld;
  }

  /** 0..1 — how close the light is to the centre of the frame. */
  beaconCentredness(camera) {
    const v = this.beaconWorld.clone().project(camera);
    if (v.z > 1) return 0;
    const r = Math.hypot(v.x, v.y);
    return smoothstep(0.55, 0.10, r);
  }

  /* -------------------------------------------------------------- update */

  update(dt, camera) {
    const s = this.state;
    const { controls, audio, overlay, watchers, leviathan, apparition, hand, door } = this.g;

    s.phaseT += dt;

    /* --- the fog never sits still (§3.3) --- */
    const fogSwing = Math.sin((s.time + this._fogPhase) * (Math.PI * 2 / FOG.swingPeriod))
                   * 0.6 + fbm1(s.time * 0.07, 3) * 0.4;
    s.fogNear = FOG.nearBase;
    s.fogFar = FOG.farBase + fogSwing * FOG.farSwing;

    this.updateBeaconPosition();

    /* --- drift: the ocean is always taking you somewhere ---
     * Set before the act runs, so an act can override it. Act 4 does. */
    const driftAngle = this.beaconBearing + Math.sin(s.time * 0.041) * 0.8;
    this.drift.set(
      Math.sin(driftAngle) * SWIM.driftSpeed,
      0,
      Math.cos(driftAngle) * SWIM.driftSpeed,
    );

    switch (s.phase) {
      case PHASE.COLD_OPEN: this.coldOpen(dt); break;
      case PHASE.WAKE:      this.wake(dt); break;
      case PHASE.ESTABLISH: this.establish(dt, camera); break;
      case PHASE.ACT1:      this.act1(dt); break;
      case PHASE.ACT2:      this.act2(dt); break;
      case PHASE.ACT3:      this.act3(dt, camera); break;
      case PHASE.ACT4:      this.act4(dt, camera); break;
      case PHASE.ACT5:      this.act5(dt, camera); break;
      case PHASE.END:       this.end(dt); break;
      default: break;
    }

    /* --- vignette closes in steadily across the whole run (§5) --- */
    const runProgress = saturate(s.time / 900);
    const baseVig = lerp(POST.vignetteStart, POST.vignetteEnd, easeInOut(runProgress));
    s.vignette = damp(s.vignette, baseVig + this._vigBoost(), 1.4, dt);

    overlay.update(dt, s.time);
  }

  _vigBoost() {
    const s = this.state;
    return s.submersion * 0.16 + (this.agitation ?? 0) * 0.05 + (1 - (this.guidance ?? 1)) * 0.10;
  }

  /* ---------------------------------------------------------- §2.1 */

  coldOpen(dt) {
    const s = this.state;
    s.fade = 1;
    s.exposure = 1;
    s.grain = 0;
    if (s.phaseT >= SCRIPT.COLD_OPEN) this.setPhase(PHASE.WAKE);
  }

  /* ---------------------------------------------------------- §2.2 */

  wake(dt) {
    const s = this.state;
    const { audio, controls } = this.g;
    const t = s.phaseT;

    // "extrem langsam" — the fade takes most of the phase, in three stages so
    // the elements arrive one at a time rather than all at once.
    let fade;
    if (t < 7)       fade = lerp(1.00, 0.78, easeInOut(t / 7));
    else if (t < 17) fade = lerp(0.78, 0.14, easeInOut((t - 7) / 10));
    else             fade = lerp(0.14, 0.00, easeInOut(saturate((t - 17) / 8)));
    s.fade = fade;

    s.grain = POST.grainBase * saturate(t / 6);
    s.ambienceLevel = saturate(t / 9);
    s.rumbleLevel = 0.05 * saturate((t - 12) / 10);

    // The breath settles over twenty seconds (§2.2).
    const calm = easeOutCubic(saturate(t / 20));
    audio.breathRate = lerp(1.45, 4.3, calm);
    s.breathIntensity = lerp(1.0, 0.42, calm);
    s.shake = lerp(0.85, 0.42, calm);

    // Look control arrives quietly, so that losing it in a moment stings.
    if (t > 8 && !s.controlEnabled) s.controlEnabled = true;

    // Last of all, barely there: the light (§2.2).
    s.beacon = smoothstep(22, 29, t) * 0.13;

    if (t >= SCRIPT.WAKE) this.setPhase(PHASE.ESTABLISH);
  }

  /* ---------------------------------------------------------- §2.3 */

  establish(dt, camera) {
    const s = this.state;
    const { controls, apparition } = this.g;
    const t = s.phaseT;
    const D = SCRIPT.ESTABLISH;

    // 0–4s: ease from wherever the player was looking to the arc's start.
    // 4–26s: the 180° sweep, rising 15° and settling back.
    // 26–30s: hold on the light, then hand control back.
    const lead = 4.0, sweep = 22.0;

    let yaw, pitch;
    if (t < lead) {
      const k = easeInOut(t / lead);
      // shortest path to the start of the arc
      let delta = this.panStart - this.panFrom;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      yaw = this.panFrom + delta * k;
      pitch = lerp(this.g.controls.pitch, 0.06, k);
    } else {
      const k = saturate((t - lead) / sweep);
      const e = easeInOut(k);
      yaw = lerp(this.panStart, this.panEnd, e);
      // §2.3 — up about 15°, then back down onto the horizon.
      pitch = Math.sin(e * Math.PI) * 0.262 + 0.02;
    }

    this.scripted.active = true;
    this.scripted.yaw = yaw;
    this.scripted.pitch = pitch;
    // A touch of lift, as if you were being held up out of the water.
    this.scripted.height = Math.sin(saturate((t - lead) / sweep) * Math.PI) * 0.30;

    s.shake = 0.30;
    s.beacon = 0.13 + smoothstep(lead + sweep * 0.82, D - 1.0, t) * 0.16;

    // §2.3 — four to six frames of something pale, going down and away.
    const flashAt = lead + sweep * 0.66;
    if (!this.apparitionFired && t >= flashAt) {
      this.apparitionFired = true;
      apparition.trigger(camera);
      this.g.audio.groan(0.45);
    }

    if (t >= D) {
      // Hand back without a snap: the player inherits exactly this heading.
      controls.yaw = controls.targetYaw = yaw;
      controls.pitch = controls.targetPitch = pitch;
      this.scripted.active = false;
      this.setPhase(PHASE.ACT1);
    }
  }

  /* ------------------------------------------------------- §4 Act 1 */

  act1(dt) {
    const s = this.state;
    const t = s.phaseT;

    if (!this.titleShown && t >= TITLE_CARD.showAt) {
      this.titleShown = true;
      this.g.overlay.showTitleCard(s.time);
    }

    s.ambienceLevel = 1;
    s.rumbleLevel = 0.06 + 0.05 * smoothstep(60, 190, t);
    s.groansEnabled = t > 70;
    s.shake = damp(s.shake, 0.38, 1.2, dt);
    s.chroma = damp(s.chroma, 0, 2, dt);

    // The light you thought you saw goes away, and stays away.
    s.beacon = damp(s.beacon, 0, 0.13, dt);

    if (t >= SCRIPT.ACT1) this.setPhase(PHASE.ACT2);
  }

  /* ------------------------------------------------------- §4 Act 2 */

  act2(dt) {
    const s = this.state;
    const t = s.phaseT;
    const k = t / SCRIPT.ACT2;

    s.rumbleLevel = lerp(0.11, 0.30, easeInOut(k)) + s.watcherAlert * 0.10;
    s.shake = damp(s.shake, 0.40 + s.watcherAlert * 0.30, 1.0, dt);

    // §4 — the light returns, on a fixed clock, nothing the player did.
    s.beacon = damp(s.beacon, smoothstep(0.36, 0.62, k), 0.22, dt);

    // The closer they get, the more the footage struggles.
    s.grain = POST.grainBase * (1 + s.watcherAlert * 0.9);
    s.chroma = damp(s.chroma, s.watcherAlert * 0.10, 1.5, dt);

    if (t >= SCRIPT.ACT2) this.setPhase(PHASE.ACT3);
  }

  /* ------------------------------------------------------- §4 Act 3 */

  /**
   * The pull. The only interaction in the level is the absence of one: let go
   * of the screen and stay off it. There is no fail state — the sequence
   * always resolves — but nothing about the sound or the camera says so.
   */
  act3(dt, camera) {
    const s = this.state;
    const { controls, audio, leviathan, apparition } = this.g;
    const t = s.phaseT;
    this.act3Total += dt;

    s.swimEnabled = false;
    s.beacon = damp(s.beacon, 0.55, 0.5, dt);   // still there, dimmed by the murk

    const still = controls.isHoldingStill();

    /* ---- stage 0: the silence, right after they all leave ---- */
    if (this.act3Stage === 0) {
      s.ambienceLevel = damp(s.ambienceLevel, 0.22, 1.1, dt);
      s.rumbleLevel = damp(s.rumbleLevel, 0.02, 1.4, dt);
      audio.breathRate = damp(audio.breathRate, 3.2, 0.8, dt);
      s.breathIntensity = damp(s.breathIntensity, 0.6, 0.8, dt);
      if (t > 9) { this.act3Stage = 1; this.stageT = 0; }
    }

    /* ---- stage 1: the water beneath you stops having a bottom ---- */
    if (this.act3Stage === 1) {
      this.stageT += dt;
      s.darkness = saturate(this.stageT / 15);
      s.ambienceLevel = damp(s.ambienceLevel, 0.55, 0.9, dt);
      s.rumbleLevel = damp(s.rumbleLevel, 0.30, 0.7, dt);
      audio.heartGain = saturate(this.stageT / 12) * 0.35;
      audio.heartRate = 1.20;
      s.pulse = damp(s.pulse, 0.35, 1.5, dt);
      if (this.stageT > 15) { this.act3Stage = 2; this.stageT = 0; }
    }

    /* ---- stage 2: down ---- */
    if (this.act3Stage === 2) {
      this.stageT += dt;

      // Stillness is banked; movement spends it and stirs the water.
      if (still) {
        this.stillAccum += dt * lerp(0.55, 1.0, s.submersion);
        this.agitation = Math.max(0, this.agitation - dt * 0.55);
      } else {
        this.stillAccum = Math.max(0, this.stillAccum - dt * 0.7);
        this.agitation = Math.min(1, this.agitation + dt * 0.75);
      }

      const sinkTarget = saturate(this.stageT / 26);
      s.submersion = damp(s.submersion, sinkTarget, 0.55, dt);
      s.darkness = 1;

      // Everything tightens the further under you are, and further still if
      // the player will not keep their hands off the glass.
      const stress = saturate(s.submersion * 0.7 + this.agitation * 0.6);
      audio.heartGain = 0.35 + stress * 0.55;
      audio.heartRate = lerp(1.15, 0.52, stress);
      s.pulse = damp(s.pulse, 0.35 + stress * 0.75, 2.0, dt);
      s.chroma = damp(s.chroma, 0.05 + this.agitation * 0.34, 2.0, dt);
      s.grain = POST.grainBase * (1 + stress * 0.8);
      s.shake = damp(s.shake, 0.30 + this.agitation * 1.5, 1.2, dt);
      s.rumbleLevel = damp(s.rumbleLevel, 0.34 + stress * 0.30, 0.8, dt);
      s.ambienceLevel = damp(s.ambienceLevel, 0.75, 0.8, dt);
      audio.breathRate = lerp(3.2, 1.5, this.agitation);
      s.breathIntensity = lerp(0.5, 1.0, this.agitation);
      // Your breath is the last thing you hear before it goes too.
      s.breathIntensity *= 1 - s.submersion * 0.75;

      // Something enormous passes underneath, once, near the bottom (§3.4).
      if (!this.leviathanFired && s.submersion > 0.72) {
        this.leviathanFired = true;
        leviathan.trigger(camera, 58);
        audio.groan(1.0);
      }

      // If they keep fighting it, something comes close enough to notice.
      this._brushT = (this._brushT ?? 6) - dt;
      if (this._brushT <= 0 && this.agitation > 0.55) {
        apparition.trigger(camera);
        audio.watcherClick(camera.position.clone().add(new THREE.Vector3(2, -1, -1)), camera);
        this._brushT = 7 + Math.random() * 9;
      }

      const done = this.stillAccum >= STILL_REQUIRED;
      const forced = this.act3Total >= ACT3_HARD_CAP;
      if ((done || forced) && this.stageT > 30) {
        this.act3Stage = 3;
        this.stageT = 0;
        audio.groan(0.8);
      }
    }

    /* ---- stage 3: up ---- */
    if (this.act3Stage === 3) {
      this.stageT += dt;
      const k = saturate(this.stageT / 22);
      s.submersion = damp(s.submersion, 1 - easeInOut(k), 0.8, dt);
      s.darkness = damp(s.darkness, 1 - easeInOut(saturate((this.stageT - 6) / 16)), 0.9, dt);
      s.chroma = damp(s.chroma, 0, 1.2, dt);
      s.pulse = damp(s.pulse, 0.15, 0.8, dt);
      audio.heartGain = damp(audio.heartGain, 0.12, 0.5, dt);
      audio.heartRate = damp(audio.heartRate, 1.05, 0.5, dt);
      s.shake = damp(s.shake, 0.45, 1.0, dt);
      s.rumbleLevel = damp(s.rumbleLevel, 0.20, 0.6, dt);
      s.ambienceLevel = damp(s.ambienceLevel, 1.0, 0.8, dt);

      // Breaking the surface: one enormous breath.
      if (!this._gasped && s.submersion < 0.22) {
        this._gasped = true;
        audio.breathRate = 1.25;
        s.breathIntensity = 1.0;
      }
      s.breathIntensity = damp(s.breathIntensity, 0.55, 0.35, dt);
      audio.breathRate = damp(audio.breathRate, 3.6, 0.35, dt);

      if (this.stageT > 24) {
        s.submersion = 0;
        audio.heartGain = 0;
        s.pulse = 0;
        this.setPhase(PHASE.ACT4);
      }
    }

    // The lens opens up as it gets dark. Without this the whole act is a
    // black rectangle, which is not the same thing as being underwater.
    s.exposure = damp(s.exposure, 1 + s.submersion * 2.4, 1.1, dt);

    audio.setUnderwater(s.submersion);
    s.underwaterFilter = s.submersion;
  }

  /* ------------------------------------------------------- §4 Act 4 */

  /**
   * §4 Rule 1, as guidance rather than a rule: staring straight at the light
   * makes the world close in and the swimming heavy. Keeping it at the edge of
   * frame opens the fog back up. Nothing is ever taken away from the player,
   * it just gets harder to breathe.
   */
  act4(dt, camera) {
    const s = this.state;
    const { audio, controls, door } = this.g;
    const t = s.phaseT;

    s.swimEnabled = true;
    s.ambienceLevel = 1;
    s.beacon = damp(s.beacon, 1, 0.7, dt);
    s.rumbleLevel = damp(s.rumbleLevel, 0.22, 0.5, dt);
    s.breathIntensity = damp(s.breathIntensity, 0.5 + (controls.swimInput * 0.45), 0.6, dt);
    audio.breathRate = damp(audio.breathRate, 3.6 - controls.swimInput * 1.5, 0.6, dt);

    const centred = this.beaconCentredness(camera);
    this.directLook = clamp(this.directLook + (centred > 0.5 ? dt : -dt * 1.4), 0, 6);
    const staring = smoothstep(0.9, 3.2, this.directLook);
    this.guidance = 1 - staring;

    // The consequence of staring is atmospheric, never mechanical.
    s.fogFar = lerp(s.fogFar, s.fogFar * 0.55, staring);
    s.exposure = damp(s.exposure, lerp(1.0, 0.72, staring), 1.5, dt);
    s.desaturate = damp(s.desaturate, staring * 0.45, 1.5, dt);
    s.shake = damp(s.shake, 0.40 + staring * 0.55, 1.0, dt);
    s.chroma = damp(s.chroma, staring * 0.12, 1.5, dt);
    if (staring > 0.6) s.rumbleLevel += staring * 0.22;

    // Swimming with the light in the corner of your eye is simply easier.
    this.swimBoost = lerp(1.0, 0.42, staring);

    /* The current carries you whether or not you help. It eases off while the
     * player is actually swimming, so effort still means something, and builds
     * into a riptide if the crossing runs long — the level always ends, and it
     * ends by arriving rather than by cutting somewhere else.
     *
     * It aims at the door rather than along a fixed bearing. A fixed bearing
     * sails straight past on any frame long enough to step over the arrival
     * radius, and then keeps going forever. */
    const toDoor = this._toDoor
      .subVectors(this.g.door.worldPos, controls.position);
    toDoor.y = 0;
    const dist = toDoor.length();

    if (dist > 1e-3) {
      const overdue = smoothstep(0, 90, t - SCRIPT.ACT4 * 0.8);
      const speed = lerp(
        lerp(SWIM.act4Current, SWIM.act4Swimming, controls.swimInput)
          * lerp(1.0, 0.45, staring),
        SWIM.act4Riptide,
        overdue,
      );
      // Never step more than halfway in, whatever the frame time.
      const capped = Math.min(speed, (dist * 0.5) / Math.max(dt, 1e-3));
      // A lazy sideways wander so it does not feel like a rail.
      const wander = Math.sin(s.time * 0.041) * 0.30;
      const c = Math.cos(wander), sn = Math.sin(wander);
      this.drift.set(
        (toDoor.x * c - toDoor.z * sn),
        0,
        (toDoor.x * sn + toDoor.z * c),
      ).setLength(capped);
    }

    if (s.doorDistance < DOOR.arriveDistance) this.setPhase(PHASE.ACT5);
  }

  /* ------------------------------------------------------- §4 Act 5 */

  act5(dt, camera) {
    const s = this.state;
    const { audio, controls, hand, door, overlay } = this.g;
    const t = s.phaseT;

    s.swimEnabled = false;
    s.beacon = 1;
    this.guidance = 1;
    s.desaturate = damp(s.desaturate, 0, 1.5, dt);
    s.exposure = damp(s.exposure, 1, 1.5, dt);

    // Soft assist: the camera settles onto the door without wresting it away.
    const toDoor = new THREE.Vector3().subVectors(door.worldPos, camera.position);
    const wantYaw = bearingToYaw(Math.atan2(toDoor.x, toDoor.z));
    let dy = wantYaw - controls.targetYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const assist = 0.55 * dt;
    controls.targetYaw += dy * assist;
    controls.targetPitch += (0.10 - controls.targetPitch) * assist;

    switch (this.act5Stage) {
      case 0: {
        // Drift the last metre in, then the hand comes up.
        this.drift.set(toDoor.x, 0, toDoor.z).setLength(
          Math.min(0.45, toDoor.length() * 0.35),
        );
        if (t > 2.5) { this.act5Stage = 1; this.stageT = 0; }
        break;
      }
      case 1: {
        this.stageT += dt;
        this.drift.multiplyScalar(0.90);
        this.handReach = damp(this.handReach, 1, 0.9, dt);
        s.shake = damp(s.shake, 0.22, 1.0, dt);
        // §4 — the door opens after a short hold. The last input of the level.
        if (this.handReach > 0.85) {
          if (controls.pointerDown || controls._keys.size > 0) {
            this.openHold += dt;
            this.handGrip = damp(this.handGrip, 1, 3.0, dt);
            if (this.openHold > 0.9 && !this._handled) {
              this._handled = true;
              audio.doorHandle();
            }
          } else {
            this.openHold = Math.max(0, this.openHold - dt * 0.5);
            this.handGrip = damp(this.handGrip, 0.15, 2.0, dt);
          }
          if (this.openHold > 1.6) { this.act5Stage = 2; this.stageT = 0; audio.doorOpen(); }
        }
        break;
      }
      case 2: {
        this.stageT += dt;
        s.doorOpen = saturate(this.stageT / 2.4);
        this.handGrip = damp(this.handGrip, 0.55, 1.2, dt);
        this.handReach = damp(this.handReach, 0.55, 0.7, dt);
        // Light floods out. It is the first warm thing in fifteen minutes.
        s.exposure = 1 + easeInOut(saturate((this.stageT - 0.6) / 3.0)) * 5.2;
        s.bloom = 1 + easeInOut(saturate((this.stageT - 0.6) / 3.0)) * 2.4;
        s.shake = damp(s.shake, 0.55, 1.0, dt);
        if (this.stageT > 4.0) { this.act5Stage = 3; this.stageT = 0; }
        break;
      }
      case 3: {
        // Cut to black. Not a fade — a cut (§4).
        this.stageT += dt;
        if (this.stageT > 0.25) {
          s.fade = 1;
          s.exposure = 1;
          s.bloom = 1;
          if (!this.endShown) {
            this.endShown = true;
            audio.playEnding();
            setTimeout(() => overlay.showEndCard('LEVEL 2'), 3400);
          }
          this.setPhase(PHASE.END);
        } else {
          s.exposure = 6.4;
        }
        break;
      }
      default: break;
    }

    hand.setPose(this.handReach, this.handGrip);
  }

  end(dt) {
    const s = this.state;
    s.fade = 1;
    s.submersion = 0;
  }
}
