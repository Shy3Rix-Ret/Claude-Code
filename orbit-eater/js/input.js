/**
 * Eingabe: Maus + Tastatur am Desktop, schwebender Joystick + Buttons am Handy.
 *
 * Desktop
 *   Richtung & Tempo   Mausposition relativ zum eigenen Körper
 *   Boost              Shift oder Leertaste (gedrückt halten)
 *   Schleuder          linke Maustaste halten, loslassen feuert
 *
 * Touch
 *   Erster Finger      schwebender Joystick (wo der Daumen landet, ist die Mitte)
 *   Zweiter Finger     Boost, solange er liegt
 *   Buttons            SCHLEUDER (halten/loslassen) und BOOST
 *
 * Bewusste Abweichung von "zum Touchpunkt steuern": Auf dem Handy würde der
 * Daumen sonst genau das verdecken, worauf man zusteuert. Der Joystick lässt
 * den Bildschirm frei und fühlt sich in .io-Spielen vertraut an.
 */
import { clamp } from './utils.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.hasMouse = false;
    this.mouseDown = false;
    this.keys = new Set();

    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.stickRadius = 64;
    this.lastDirX = 1;
    this.lastDirY = 0;
    this.boostTouches = new Set();
    this.slingButton = false;
    this.boostButton = false;

    /** Callbacks für Tastenkürzel: { pause, mute, confirm, console, debug, mode } */
    this.handlers = {};

    this.bind();
  }

  bind() {
    const c = this.canvas;
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse') {
        this.mouseX = e.clientX;
        this.mouseY = e.clientY;
        this.hasMouse = true;
        this.setMode('mouse');
      } else if (e.pointerId === this.stick.id) {
        this.stick.x = e.clientX;
        this.stick.y = e.clientY;
      }
    }, { passive: true });

    c.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouseDown = true;
        this.setMode('mouse');
        return;
      }
      this.setMode('touch');
      e.preventDefault();
      if (!this.stick.active) {
        const s = this.stick;
        s.active = true;
        s.id = e.pointerId;
        s.ox = s.x = e.clientX;
        s.oy = s.y = e.clientY;
      } else {
        this.boostTouches.add(e.pointerId);
      }
    });

    const release = e => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0 || e.type === 'pointercancel') this.mouseDown = false;
        return;
      }
      if (e.pointerId === this.stick.id) {
        this.stick.active = false;
        this.stick.id = -1;
      }
      this.boostTouches.delete(e.pointerId);
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    c.addEventListener('contextmenu', e => e.preventDefault());

    window.addEventListener('keydown', e => {
      if (isTyping(e)) return;           // Enter im Namensfeld erledigt das Formular selbst
      if (e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      // "/" öffnet die Admin-Konsole (Tastaturbelegung egal, deshalb e.key statt e.code)
      if (e.key === '/' && this.handlers.console?.()) {
        e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      switch (e.code) {
        case 'Escape': case 'KeyP': this.handlers.pause?.(); break;
        case 'KeyM': this.handlers.mute?.(); break;
        case 'Enter': this.handlers.confirm?.(); break;
        case 'KeyT': if (this.handlers.console?.()) e.preventDefault(); break;
        case 'F3': e.preventDefault(); this.handlers.debug?.(); break;
      }
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));

    // Fenster verliert den Fokus → nichts darf "hängen bleiben"
    window.addEventListener('blur', () => this.reset());
  }

  /** Touch-Buttons (SCHLEUDER / BOOST) anbinden. */
  bindButton(el, onChange) {
    const down = e => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-down');
      onChange(true);
    };
    const up = e => {
      e.preventDefault();
      el.classList.remove('is-down');
      onChange(false);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.handlers.mode?.(mode);
  }

  reset() {
    this.keys.clear();
    this.mouseDown = false;
    this.stick.active = false;
    this.stick.id = -1;
    this.boostTouches.clear();
    this.slingButton = false;
    this.boostButton = false;
  }

  get boost() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Space')
      || this.boostTouches.size > 0 || this.boostButton;
  }

  get sling() {
    return this.mouseDown || this.slingButton;
  }

  /**
   * Übersetzt die Eingabe in Steuerbefehle für den Spielerkörper.
   * @param sx, sy  Bildschirmposition des Spielers (CSS-px)
   * @param sr      Bildschirmradius des Spielers
   * @param toWorld Funktion (sx, sy) → {x, y}
   */
  control(sx, sy, sr, toWorld) {
    let dirX = this.lastDirX, dirY = this.lastDirY, throttle = 0, aimX, aimY;

    if (this.mode === 'mouse') {
      if (this.hasMouse) {
        const dx = this.mouseX - sx, dy = this.mouseY - sy;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dirX = dx / len; dirY = dy / len; }
        // Zeiger nah am Körper = langsam, weiter weg = volle Fahrt
        throttle = clamp((len - sr * 0.4) / (sr + 110), 0, 1);
      }
      const w = toWorld(this.mouseX, this.mouseY);
      aimX = w.x;
      aimY = w.y;
    } else {
      const s = this.stick;
      if (s.active) {
        const dx = s.x - s.ox, dy = s.y - s.oy;
        const len = Math.hypot(dx, dy);
        if (len > 4) { dirX = dx / len; dirY = dy / len; }
        throttle = clamp((len - 4) / (this.stickRadius * 0.75), 0, 1);
      }
      // Am Handy zielt die Schleuder in Flugrichtung
      const w = toWorld(sx + dirX * 400, sy + dirY * 400);
      aimX = w.x;
      aimY = w.y;
    }
    this.lastDirX = dirX;
    this.lastDirY = dirY;
    return { dirX, dirY, throttle, aimX, aimY, boost: this.boost, sling: this.sling };
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
