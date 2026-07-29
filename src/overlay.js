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
    this.bootError = root.querySelector('#boot-error');
    this.rec = root.querySelector('#rec');
    this.recTime = root.querySelector('#rec-time');
    this.endCard = root.querySelector('#end-card');
    this.endText = root.querySelector('#end-text');

    this._recVisible = false;
    this._recT = 0;
    this._flick = 0;
  }

  /**
   * Resolves on the first click or keypress — the gesture that unlocks audio
   * and captures the pointer. Bound on the window as well as the overlay,
   * because inside an embedded frame the event does not always arrive where
   * you expect, and a start button that only sometimes works is worse than no
   * start button.
   */
  waitForStart(onGesture) {
    return new Promise((resolve) => {
      let done = false;
      const go = (e) => {
        if (done) return;
        done = true;
        e?.preventDefault?.();
        for (const [target, type] of bindings) target.removeEventListener(type, go);
        // Runs synchronously, while the gesture is still live: pointer lock
        // is only granted from inside the handler itself.
        try { onGesture?.(e); } catch { /* optional extras may refuse */ }
        resolve();
      };

      const bindings = [
        [this.boot, 'mousedown'], [this.boot, 'click'],
        [window, 'mousedown'], [window, 'click'], [window, 'keydown'],
      ];
      for (const [target, type] of bindings) {
        target.addEventListener(type, go, { passive: false });
      }

      // The hint appears quickly — it is also the only proof to a player that
      // the page is alive at all before they click it.
      setTimeout(() => { if (!done) this.bootHint.classList.add('show'); }, 900);
    });
  }

  /** Something broke before the level could speak for itself. */
  showError(message) {
    if (window.__bootFail) { window.__bootFail(message); return; }
    if (!this.bootError) return;
    this.bootError.textContent = message;
    this.bootError.classList.add('show');
    this.bootHint?.classList.remove('show');
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
      this.rec.style.setProperty('--rec-flicker', Math.random() < 0.12 ? '0.28' : '0.82');
      this._flick = 0.04 + Math.random() * 0.22;
    }

    if (this._recT > 4.0) {
      this.rec.classList.remove('show');
      this.rec.style.removeProperty('--rec-flicker');
      this._recVisible = false;
    }
  }

  /** §4, Act 5 — no score, no stats, no "you survived". Just the new place. */
  showEndCard(text = 'LEVEL 2') {
    this.endText.textContent = text;
    this.endCard.classList.add('show');
  }
}
