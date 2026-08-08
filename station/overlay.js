/**
 * The only words in the scene.
 *
 * Five lines, each tied to a place rather than to a clock, each shown once.
 * They are not a tutorial and not a story — they are captions for things the
 * player is already looking at, and the scene works without them.
 */

import * as THREE from 'three';
import { MOMENTS } from './config.js';

const SHOW = 0.9;      // fade in
const HOLD = 5.6;
const HIDE = 1.8;

export class Overlay {
  constructor() {
    this.el = document.getElementById('moment');
    this.textEl = document.getElementById('moment-text');
    this.subEl = document.getElementById('moment-sub');
    this.hintEl = document.getElementById('hint');

    this.moments = MOMENTS.map((m) => ({
      ...m,
      at: new THREE.Vector3(...m.at),
      fired: false,
    }));

    this.active = null;
    this.phase = 0;
    this.elapsed = 0;
    this.queue = [];
    this.hintTimer = 0;
    this.hintVisible = true;
  }

  /** Fired by main once the player has actually taken control. */
  begin() {
    this.hintTimer = 14;
  }

  toggleHint() {
    this.hintVisible = !this.hintVisible;
    if (this.hintEl) this.hintEl.classList.toggle('gone', !this.hintVisible);
    this.hintTimer = this.hintVisible ? 10 : 0;
  }

  update(dt, position, elapsedTotal) {
    // The controls line retires itself once the player is clearly using them.
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.hintEl && this.hintVisible) {
        this.hintEl.classList.add('gone');
        this.hintVisible = false;
      }
    }

    for (const m of this.moments) {
      if (m.fired) continue;
      if (elapsedTotal < (m.delay || 0)) continue;
      if (position.distanceTo(m.at) > m.radius) continue;
      m.fired = true;
      this.queue.push(m);
    }

    if (!this.active && this.queue.length) {
      this.active = this.queue.shift();
      this.elapsed = 0;
      if (this.textEl) this.textEl.textContent = this.active.text;
      if (this.subEl) this.subEl.textContent = this.active.sub || '';
      if (this.el) this.el.classList.add('show');
    }

    if (!this.active) return;

    this.elapsed += dt;
    if (this.elapsed > SHOW + HOLD) {
      if (this.el) this.el.classList.remove('show');
      if (this.elapsed > SHOW + HOLD + HIDE) this.active = null;
    }
  }
}
