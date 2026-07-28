/**
 * §6 — the entire control scheme.
 *
 *   drag / mouse   look
 *   tap and hold   swim forward
 *   let go         hold still
 *
 * There is nothing else. No buttons, no HUD, no pause. The third line is the
 * one that matters: in Act 3 "not touching the screen" stops being the absence
 * of input and becomes the input.
 */

import * as THREE from 'three';
import { LOOK, SWIM } from './config.js';
import { clamp, damp } from './util.js';

export class Controls {
  constructor(domElement) {
    this.dom = domElement;

    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.pointerDown = false;
    this.holdTime = 0;        // seconds the current press has lasted
    this.dragDistance = 0;    // CSS px moved during the current press
    this.swimInput = 0;       // 0..1, smoothed
    this.enabled = false;
    this.lookSpeed = 0;
    this.idleTime = 0;        // seconds since the last meaningful input

    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 0, 0);

    this.gyroActive = false;
    this._gyroPrev = null;
    this._gyroDelta = { yaw: 0, pitch: 0 };

    this._activePointer = null;
    this._last = { x: 0, y: 0 };
    this._keys = new Set();

    this._bind();
  }

  _bind() {
    const dom = this.dom;
    const opts = { passive: false };

    this._onPointerDown = (e) => {
      if (this._activePointer !== null) return;
      this._activePointer = e.pointerId;
      this.pointerDown = true;
      this.holdTime = 0;
      this.dragDistance = 0;
      this._last.x = e.clientX;
      this._last.y = e.clientY;
      try { dom.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      e.preventDefault();
    };

    this._onPointerMove = (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' && !this.pointerDown && !this._pointerLocked()) return;
      if (this.pointerDown && e.pointerId !== this._activePointer) return;

      let dx, dy;
      if (this._pointerLocked()) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else {
        if (!this.pointerDown) return;
        dx = e.clientX - this._last.x;
        dy = e.clientY - this._last.y;
        this._last.x = e.clientX;
        this._last.y = e.clientY;
      }

      this.dragDistance += Math.hypot(dx, dy);
      this.targetYaw -= dx * LOOK.sensitivity;
      this.targetPitch -= dy * LOOK.sensitivity;
      this.targetPitch = clamp(this.targetPitch, -LOOK.pitchClamp, LOOK.pitchClamp);
      if (Math.abs(dx) + Math.abs(dy) > 0.5) this.idleTime = 0;
    };

    this._onPointerUp = (e) => {
      if (e.pointerId !== this._activePointer) return;
      this._activePointer = null;
      this.pointerDown = false;
      try { dom.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    };

    dom.addEventListener('pointerdown', this._onPointerDown, opts);
    window.addEventListener('pointermove', this._onPointerMove, opts);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);

    // Keep the browser from doing anything helpful.
    dom.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    dom.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('gesturestart', (e) => e.preventDefault());

    this._onKeyDown = (e) => {
      this._keys.add(e.code);
      if (['KeyW', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  _pointerLocked() {
    return document.pointerLockElement === this.dom;
  }

  /** Desktop nicety: click once and the mouse takes over the camera. */
  requestPointerLock() {
    if (this.dom.requestPointerLock && !('ontouchstart' in window)) {
      try { this.dom.requestPointerLock(); } catch { /* denied */ }
    }
  }

  /**
   * Device orientation, blended in as a delta on top of drag so both work at
   * once and neither fights the other. iOS needs the permission prompt to
   * happen inside the same gesture that starts the audio.
   */
  async enableGyro() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return false;
    try {
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      }
    } catch { return false; }

    this._onOrientation = (e) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      const yaw = THREE.MathUtils.degToRad(e.alpha ?? 0);
      const pitch = THREE.MathUtils.degToRad(e.beta ?? 0);
      if (this._gyroPrev) {
        let dy = yaw - this._gyroPrev.yaw;
        // unwrap
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        let dp = pitch - this._gyroPrev.pitch;
        if (Math.abs(dy) < 0.6 && Math.abs(dp) < 0.6) {
          this._gyroDelta.yaw += dy * LOOK.gyroBlend;
          this._gyroDelta.pitch += dp * LOOK.gyroBlend;
          if (Math.abs(dy) + Math.abs(dp) > 0.004) this.idleTime = 0;
        }
      }
      this._gyroPrev = { yaw, pitch };
      this.gyroActive = true;
    };
    window.addEventListener('deviceorientation', this._onOrientation);
    return true;
  }

  /** True when the player is doing anything at all. */
  isActive() {
    return this.pointerDown
        || this._keys.size > 0
        || this.lookSpeed > 0.09;
  }

  /**
   * §4 Act 3 — "let go completely and stay still". Deliberately more forgiving
   * than isActive(): a hand holding a phone is never perfectly steady, and
   * gyro noise must not read as disobedience. ~12°/s of drift is allowed.
   */
  isHoldingStill() {
    return !this.pointerDown && this._keys.size === 0 && this.lookSpeed < 0.22;
  }

  update(dt, state) {
    /* ---- look ---- */
    if (this.enabled) {
      this.targetYaw += this._gyroDelta.yaw;
      this.targetPitch = clamp(
        this.targetPitch + this._gyroDelta.pitch, -LOOK.pitchClamp, LOOK.pitchClamp,
      );
    }
    this._gyroDelta.yaw = 0;
    this._gyroDelta.pitch = 0;

    const prevYaw = this.yaw, prevPitch = this.pitch;
    this.yaw = damp(this.yaw, this.targetYaw, LOOK.smoothing, dt);
    this.pitch = damp(this.pitch, this.targetPitch, LOOK.smoothing, dt);

    const dYaw = this.yaw - prevYaw;
    const dPitch = this.pitch - prevPitch;
    this.lookSpeed = dt > 0 ? Math.hypot(dYaw, dPitch) / dt : 0;
    this.lastYawDelta = dYaw;
    this.lastPitchDelta = dPitch;

    /* ---- swim ---- */
    if (this.pointerDown) this.holdTime += dt;

    const keyForward = this._keys.has('KeyW') || this._keys.has('ArrowUp') || this._keys.has('Space');
    // A press only counts as "swim" once it has been held a moment — otherwise
    // every look-drag would shove you forward.
    const holdSwim = this.pointerDown && this.holdTime > 0.13;
    const wantSwim = (holdSwim || keyForward) && state.swimEnabled;

    this.swimInput = damp(this.swimInput, wantSwim ? 1 : 0, 6, dt);
    state.swimming = wantSwim;

    if (this.isActive()) this.idleTime = 0;
    else this.idleTime += dt;
    state.stillness = this.idleTime;
    state.lookSpeed = this.lookSpeed;
  }

  /** Integrates the swim + the current that never stops moving you. */
  integrate(dt, state, camera, driftDir) {
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();

    /* Exact solution of dv/dt = a - k*v, rather than an Euler step. Euler with
     * a large dt (a slow frame, or the debug time scale) decays the velocity to
     * nothing between frames and quietly makes swimming slower the worse the
     * device is. This is stable at any dt and settles at a/k. */
    const accel = SWIM.accel * this.swimInput * (state.swimEnabled ? 1 : 0);
    const k = SWIM.drag;
    const decay = Math.exp(-k * dt);
    this.velocity.multiplyScalar(decay);
    this.velocity.addScaledVector(forward, (accel / k) * (1 - decay));
    if (this.velocity.length() > SWIM.maxSpeed) {
      this.velocity.setLength(SWIM.maxSpeed);
    }

    this.position.addScaledVector(this.velocity, dt);
    if (driftDir) this.position.addScaledVector(driftDir, dt);

    state.playerPos.x = this.position.x;
    state.playerPos.y = this.position.y;
    state.playerPos.z = this.position.z;
  }

  dispose() {
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    if (this._onOrientation) window.removeEventListener('deviceorientation', this._onOrientation);
  }
}
