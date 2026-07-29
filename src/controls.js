/**
 * §6, on a desktop.
 *
 *   mouse            look
 *   W / ↑ / Space    swim forward
 *   left button      swim forward (once the pointer is captured)
 *   let go           hold still — in Act 3 that stops being the absence of
 *                    input and becomes the input
 *
 * Nothing else. No HUD, no buttons, no pause.
 *
 * The camera runs on pointer lock, so looking around needs no dragging and has
 * no edge to run into. Clicking the page captures the pointer; Esc releases it
 * and clicking again takes it back. If a browser refuses the lock — inside a
 * restricted frame, most often — looking falls back to click-and-drag, and the
 * keyboard still swims.
 */

import * as THREE from 'three';
import { LOOK, SWIM } from './config.js';
import { clamp, damp } from './util.js';

const FORWARD_KEYS = ['KeyW', 'ArrowUp', 'Space'];

export class Controls {
  constructor(domElement) {
    this.dom = domElement;

    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;

    this.swimInput = 0;       // 0..1, smoothed
    this.enabled = false;
    this.lookSpeed = 0;
    this.idleTime = 0;        // seconds since the last meaningful input

    this.velocity = new THREE.Vector3();
    this.position = new THREE.Vector3(0, 0, 0);

    this.locked = false;
    this._dragging = false;   // fallback path when the lock is unavailable
    this._last = { x: 0, y: 0 };
    this._keys = new Set();
    this._mouseDown = false;

    this._bind();
  }

  _bind() {
    const dom = this.dom;

    /* ---------------- pointer lock ---------------- */

    this._onLockChange = () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) this._dragging = false;
    };
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockChange);

    this._onMouseDown = (e) => {
      if (e.button !== 0) return;
      this._mouseDown = true;
      if (!this.locked) {
        // First click takes the pointer; it does not also swim, or every
        // attempt to re-capture after Esc would shove the player forward.
        this.requestPointerLock();
        this._dragging = true;
        this._last.x = e.clientX;
        this._last.y = e.clientY;
      }
      e.preventDefault();
    };
    this._onMouseUp = (e) => {
      if (e.button !== 0) return;
      this._mouseDown = false;
      this._dragging = false;
    };

    dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', () => {
      this._mouseDown = false;
      this._dragging = false;
      this._keys.clear();
    });

    /* ---------------- look ---------------- */

    this._onMouseMove = (e) => {
      if (!this.enabled) return;

      let dx, dy;
      if (this.locked) {
        dx = e.movementX || 0;
        dy = e.movementY || 0;
      } else if (this._dragging) {
        dx = e.clientX - this._last.x;
        dy = e.clientY - this._last.y;
        this._last.x = e.clientX;
        this._last.y = e.clientY;
      } else {
        return;
      }

      this.targetYaw -= dx * LOOK.sensitivity;
      this.targetPitch -= dy * LOOK.sensitivity;
      this.targetPitch = clamp(this.targetPitch, -LOOK.pitchClamp, LOOK.pitchClamp);
      if (Math.abs(dx) + Math.abs(dy) > 0.5) this.idleTime = 0;
    };
    window.addEventListener('mousemove', this._onMouseMove);

    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---------------- keyboard ---------------- */

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (FORWARD_KEYS.includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this._keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  requestPointerLock() {
    if (!this.dom.requestPointerLock) return;
    try {
      const r = this.dom.requestPointerLock();
      // Chrome returns a promise; a rejection here just means we stay on the
      // drag fallback, which is a working control scheme, not a failure.
      if (r && r.catch) r.catch(() => {});
    } catch { /* denied — drag fallback stands */ }
  }

  /** True when the player is doing anything at all. */
  isActive() {
    return this._mouseDown
        || this._keys.size > 0
        || this.lookSpeed > 0.09;
  }

  /**
   * §4 Act 3 — "let go completely and stay still". A mouse resting on a desk
   * really is still, so this can be strict without being unfair.
   */
  isHoldingStill() {
    return !this._mouseDown && this._keys.size === 0 && this.lookSpeed < 0.12;
  }

  update(dt, state) {
    /* ---- look ---- */
    const prevYaw = this.yaw, prevPitch = this.pitch;
    this.yaw = damp(this.yaw, this.targetYaw, LOOK.smoothing, dt);
    this.pitch = damp(this.pitch, this.targetPitch, LOOK.smoothing, dt);

    const dYaw = this.yaw - prevYaw;
    const dPitch = this.pitch - prevPitch;
    this.lookSpeed = dt > 0 ? Math.hypot(dYaw, dPitch) / dt : 0;
    this.lastYawDelta = dYaw;
    this.lastPitchDelta = dPitch;

    /* ---- swim ---- */
    const keyForward = FORWARD_KEYS.some((k) => this._keys.has(k));
    // Holding the button swims only once the pointer is captured; before that
    // the button's job is to capture it.
    const mouseForward = this.locked && this._mouseDown;
    const wantSwim = (keyForward || mouseForward) && state.swimEnabled;

    this.swimInput = damp(this.swimInput, wantSwim ? 1 : 0, 8, dt);
    state.swimming = wantSwim;

    if (this.isActive()) this.idleTime = 0;
    else this.idleTime += dt;
    state.stillness = this.idleTime;
    state.lookSpeed = this.lookSpeed;
  }

  /** Integrates the swim plus the current that never stops moving you. */
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
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockChange);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }
}
