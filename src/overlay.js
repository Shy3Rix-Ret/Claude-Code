/**
 * The only text in the game.
 *
 * §6 — no HUD, no buttons, no pause menu. Three moments of type, total:
 * the loading line, the four-second title card, and the last word.
 */

import { timecode } from './util.js';

export class Overlay {
  constructor(root) {
    this.root = root;
    this.boot = root.querySelector('#boot');
    this.bootHint = root.querySelector('#boot-hint');
    this.rec = root.querySelector('#rec');
    this.recTime = root.querySelector('#rec-time');
    this.endCard = root.querySelector('#end-card');
    this.endText = root.querySelector('#end-text');

    this._recVisible = false;
    this._recT = 0;
    this._flick = 0;
  }

  /** Resolves on the first tap — the gesture that unlocks audio. */
  waitForStart() {
    return new Promise((resolve) => {
      let done = false;
      const go = (e) => {
        if (done) return;
        done = true;
        e?.preventDefault?.();
        resolve();
      };
      this.boot.addEventListener('pointerdown', go, { once: true });
      this.boot.addEventListener('click', go, { once: true });
      window.addEventListener('keydown', go, { once: true });
      // The hint only appears if you hesitate. Nudge, not instruction.
      setTimeout(() => { if (!done) this.bootHint.classList.add('show'); }, 2600);
    });
  }

  hideBoot() {
    this.boot.classList.add('gone');
    setTimeout(() => { this.boot.style.display = 'none'; }, 1400);
  }

  /** §2.4 — the found-footage stamp. Shown once, for four seconds, ever. */
  showTitleCard(elapsedSeconds) {
    this.recTime.textContent = timecode(elapsedSeconds);
    this.rec.classList.add('show');
    this._recVisible = true;
    this._recT = 0;
  }

  update(dt, elapsedSeconds) {
    if (!this._recVisible) return;
    this._recT += dt;
    this.recTime.textContent = timecode(elapsedSeconds);

    // Cheap tube flicker: mostly on, occasionally not.
    this._flick -= dt;
    if (this._flick <= 0) {
      this.rec.style.opacity = Math.random() < 0.12 ? '0.28' : '0.82';
      this._flick = 0.04 + Math.random() * 0.22;
    }

    if (this._recT > 4.0) {
      this.rec.classList.remove('show');
      this._recVisible = false;
    }
  }

  /** §4, Act 5 — no score, no stats, no "you survived". Just the new place. */
  showEndCard(text = 'LEVEL 2') {
    this.endText.textContent = text;
    this.endCard.classList.add('show');
  }
}
