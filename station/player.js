/**
 * Walking around.
 *
 *   mouse              look (pointer lock; click-and-drag if the lock is refused)
 *   W A S D / arrows   move
 *   Shift              faster
 *   Space              jump — or rise, in float mode
 *   Ctrl               sink, in float mode
 *   F                  float mode: the station's spin gravity, on and off
 *
 * Collision is a list of axis-aligned boxes and nothing more. The body is a
 * vertical cylinder; horizontal resolution pushes it out along whichever axis
 * it entered by, and anything whose top is within a step of the feet is
 * climbed rather than blocked — which is the entire staircase implementation.
 */

import * as THREE from 'three';
import { PLAYER, HALL } from './config.js';
import { clamp, damp } from './util.js';

const STEP_UP = 0.55;
const BODY_HEIGHT = 1.8;

export class Player {
  constructor(camera, dom, colliders) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;

    this.position = new THREE.Vector3(...PLAYER.start);
    this.velocity = new THREE.Vector3();
    this.yaw = PLAYER.startYaw;
    this.pitch = 0;

    this.flying = false;
    this.grounded = true;
    this.locked = false;
    this.enabled = false;

    this.bobPhase = 0;
    this.bob = 0;
    this.landing = 0;      // dip after a fall, eases back out
    this.speedFelt = 0;    // smoothed, for the audio and the head bob

    this._keys = new Set();
    this._dragging = false;
    this._last = { x: 0, y: 0 };
    this._tmp = new THREE.Vector3();

    this._bind();
  }

  /* --------------------------------------------------------------- input */

  _bind() {
    const dom = this.dom;

    this._onLockChange = () => {
      this.locked = document.pointerLockElement === dom;
      if (this.locked) this._dragging = false;
    };
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockChange);

    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      if (!this.locked) {
        this.requestLock();
        // Fallback for frames that refuse the lock: drag to look.
        this._dragging = true;
        this._last.x = e.clientX;
        this._last.y = e.clientY;
      }
      e.preventDefault();
    });

    window.addEventListener('mouseup', () => { this._dragging = false; });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this._dragging = false;
    });

    window.addEventListener('mousemove', (e) => {
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
      } else return;

      this.yaw -= dx * PLAYER.lookSensitivity;
      this.pitch = clamp(this.pitch - dy * PLAYER.lookSensitivity, -PLAYER.pitchClamp, PLAYER.pitchClamp);
    });

    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys.add(e.code);
      if (e.code === 'KeyF') this.flying = !this.flying;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this._keys.delete(e.code));
  }

  requestLock() {
    try {
      const p = this.dom.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* some frames simply say no; drag-to-look covers it */ }
  }

  /* ----------------------------------------------------------- collision */

  /** Highest surface under the body that the feet could be standing on. */
  _groundUnder(x, y, z) {
    let best = 0;
    const r = PLAYER.radius;
    for (const c of this.colliders) {
      if (x < c.min.x - r || x > c.max.x + r) continue;
      if (z < c.min.z - r || z > c.max.z + r) continue;
      if (c.max.y > y + STEP_UP) continue;      // too tall to be a floor
      if (c.max.y > best) best = c.max.y;
    }
    return best;
  }

  /** Push out of anything the body is inside, one axis at a time. */
  _resolve(axis) {
    const p = this.position;
    const r = PLAYER.radius;
    const feet = p.y + (this.flying ? -0.4 : STEP_UP);
    const head = p.y + BODY_HEIGHT;

    for (const c of this.colliders) {
      if (c.max.y <= feet || c.min.y >= head) continue;
      if (p.x < c.min.x - r || p.x > c.max.x + r) continue;
      if (p.z < c.min.z - r || p.z > c.max.z + r) continue;

      if (axis === 'x') {
        const toMin = p.x - (c.min.x - r);
        const toMax = (c.max.x + r) - p.x;
        p.x += toMin < toMax ? -toMin : toMax;
      } else {
        const toMin = p.z - (c.min.z - r);
        const toMax = (c.max.z + r) - p.z;
        p.z += toMin < toMax ? -toMin : toMax;
      }
    }
  }

  /* -------------------------------------------------------------- update */

  update(dt) {
    const k = this._keys;
    const p = this.position;

    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const running = k.has('ShiftLeft') || k.has('ShiftRight');

    // Movement is in the yaw plane; looking up does not make you fly.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wish = this._tmp.set(
      side * cos - fwd * sin,
      0,
      -side * sin - fwd * cos,
    );
    if (wish.lengthSq() > 0) wish.normalize();

    const speed = this.flying
      ? PLAYER.flySpeed * (running ? 2.2 : 1)
      : (running ? PLAYER.runSpeed : PLAYER.walkSpeed);

    const accel = this.flying ? 8 : PLAYER.accel;
    this.velocity.x = damp(this.velocity.x, wish.x * speed, accel, dt);
    this.velocity.z = damp(this.velocity.z, wish.z * speed, accel, dt);

    if (this.flying) {
      const lift = (k.has('Space') ? 1 : 0) - (k.has('ControlLeft') || k.has('ControlRight') ? 1 : 0);
      this.velocity.y = damp(this.velocity.y, lift * speed * 0.8, 8, dt);
    } else {
      if (this.grounded && k.has('Space')) {
        this.velocity.y = PLAYER.jump;
        this.grounded = false;
      }
      this.velocity.y -= PLAYER.gravity * dt;
    }

    // --- horizontal, with resolution per axis ---
    p.x += this.velocity.x * dt;
    this._resolve('x');
    p.z += this.velocity.z * dt;
    this._resolve('z');

    // --- vertical ---
    const wasFalling = this.velocity.y;
    p.y += this.velocity.y * dt;

    if (!this.flying) {
      const ground = this._groundUnder(p.x, p.y, p.z);
      if (p.y <= ground) {
        p.y = ground;
        if (wasFalling < -5) this.landing = Math.min(1, -wasFalling / 12);
        this.velocity.y = 0;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    }
    p.y = clamp(p.y, -3, HALL.height - 0.35);
    p.x = clamp(p.x, -HALL.halfWidth - 8, HALL.halfWidth + 8);
    p.z = clamp(p.z, -HALL.halfLength + 0.6, HALL.halfLength - 0.6);

    /* --- head --- */
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this.speedFelt = damp(this.speedFelt, planar, 6, dt);

    if (this.grounded && planar > 0.4 && !this.flying) {
      this.bobPhase += dt * PLAYER.bobSpeed * (planar / PLAYER.walkSpeed);
    }
    const bobTarget = this.grounded && !this.flying
      ? Math.sin(this.bobPhase) * PLAYER.bobAmount * Math.min(1, planar / PLAYER.walkSpeed)
      : 0;
    this.bob = damp(this.bob, bobTarget, 12, dt);
    this.landing = damp(this.landing, 0, 4.5, dt);

    this.camera.position.set(
      p.x,
      p.y + PLAYER.eyeHeight + this.bob - this.landing * 0.35,
      p.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase * 0.5) * 0.004, 'YXZ');
  }
}
