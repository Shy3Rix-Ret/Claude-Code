/**
 * Interface (DOM): Startbildschirm, HUD, Rangliste, Minimap, Toasts,
 * Hinweise, Pause und Game Over.
 *
 * Das HUD wird jeden Frame aktualisiert, aber nur dort, wo sich etwas
 * ändert — Rangliste mit 4 Hz, Minimap mit 15 Hz, Texte nur bei neuem Wert.
 */
import { STAGES, BODY, COMBO, WORLD, PALETTE } from './config.js';
import { TAU, fmt, fmtTime, clamp, damp } from './utils.js';
import { canEat, maxOrbiters } from './entities.js';
import { storage } from './storage.js';

const RULER_TICKS = 24;
const BOARD_ROWS = 10;
const MAP_RANGE = 2400;

const HINTS = {
  move: {
    mouse: 'Bewege die Maus – dein Asteroid folgt dem Zeiger. Je weiter weg, desto schneller.',
    touch: 'Daumen aufs Display und ziehen – so steuerst du.',
  },
  rules: 'Grüner Ring: kleiner als du, fressbar. Roter Ring: größer – Abstand halten!',
  orbit: {
    mouse: 'Eingefangen! Orbit-Brocken wachsen dir langsam an. Oder: Maustaste halten, loslassen – Feuer.',
    touch: 'Eingefangen! Orbit-Brocken wachsen dir langsam an. Oder: SCHLEUDER halten, loslassen – Feuer.',
  },
  boost: {
    mouse: '<kbd>Shift</kbd> oder <kbd>Leertaste</kbd> halten: Boost. Kostet etwas Masse.',
    touch: 'Zweiter Finger oder BOOST: schneller. Kostet etwas Masse.',
  },
  hole: 'Schwarzes Loch! Nichts kommt aus dem Horizont zurück – Abstand halten oder boosten.',
  drain: {
    mouse: `Ab ${BODY.decayStart} Masse kostet Bewegung etwas Masse (Reibung). Wer stillsteht, verliert nichts – Zeiger einfach auf dich legen.`,
    touch: `Ab ${BODY.decayStart} Masse kostet Bewegung etwas Masse (Reibung). Wer stillsteht, verliert nichts – Daumen einfach loslassen.`,
  },
  comet: 'Komet! Schnell, aber 24 Masse wert. Fang ihn ab.',
};

export class UI {
  /**
   * @param handlers { play(name), resume(), menu(), restart(), pause(), mute(), volume(v), click() }
   */
  constructor(handlers) {
    this.h = handlers;
    const $ = id => document.getElementById(id);
    this.$ = $;
    this.screens = { start: $('screen-start'), pause: $('screen-pause'), over: $('screen-over') };
    this.hud = $('hud');
    this.el = {
      mass: $('hud-mass'), stage: $('hud-stage'), stageNum: $('hud-stagenum'), ruler: $('hud-ruler'), next: $('hud-next'),
      drain: $('hud-drain'), admin: $('hud-admin'),
      combo: $('combo'), comboMult: $('combo-mult'), comboCount: $('combo-count'), comboBar: $('combo-bar'),
      board: $('board'), boardCount: $('board-count'),
      orbit: $('ab-orbit'), pips: $('orbit-pips'), orbitVal: $('orbit-val'),
      boost: $('ab-boost'), boostState: $('boost-state'), coords: $('coords'),
      map: $('minimap'), mapRange: $('map-range'),
      feed: $('feed'), hint: $('hint'),
      toast: $('toast'), toastKicker: $('toast-kicker'), toastTitle: $('toast-title'), toastLine: $('toast-line'),
      name: $('name'), record: $('record'), touch: $('touch'), flash: $('flash'), debug: $('debug'),
      volume: $('volume'), volumeVal: $('volume-val'),
    };

    this.displayMass = 0;
    this.shownMass = -1;
    this.lastMass = 0;
    this.massFlashT = 0;
    this.boardT = 0;
    this.mapT = 0;
    this.coordT = 0;
    this.pipCount = -1;
    this.comboShown = 0;
    this.cache = {};
    this.hintsSeen = new Set(storage.get('hints', []));
    this.hintQueue = [];
    this.hintT = 0;
    this.hintKey = null;
    this.mode = 'mouse';
    this.hideTimers = new Map();

    this.buildRuler();
    this.buildBoard();
    this.buildMinimap();
    this.bind();
    this.el.name.value = storage.get('name', '');
  }

  // --- Aufbau ------------------------------------------------------------------

  buildRuler() {
    this.ticks = [];
    for (let i = 0; i < RULER_TICKS; i++) {
      const t = document.createElement('i');
      this.el.ruler.appendChild(t);
      this.ticks.push(t);
    }
  }

  buildBoard() {
    this.rows = [];
    for (let i = 0; i < BOARD_ROWS + 2; i++) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="board__rank"></span><i class="board__dot"></i><span class="board__name"></span><span class="board__mass"></span>';
      this.el.board.appendChild(li);
      this.rows.push({
        li,
        rank: li.children[0],
        dot: li.children[1],
        name: li.children[2],
        mass: li.children[3],
        key: '',
      });
    }
  }

  buildMinimap() {
    this.mapCtx = this.el.map.getContext('2d');
    this.resizeMinimap();
  }

  resizeMinimap() {
    const css = this.el.map.getBoundingClientRect().width || 172;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.mapSize = css;
    this.el.map.width = Math.round(css * dpr);
    this.el.map.height = Math.round(css * dpr);
    this.mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * Stufen-Vorschau im Startbildschirm — gerendert mit demselben Code wie im
   * Spiel. Die Bilder entstehen nacheinander: alle 19 auf einmal würden den
   * Start spürbar verzögern (ein Planet kostet ~20 ms).
   */
  buildStages(thumb) {
    const list = this.$('stages');
    const caption = this.$('stages-caption');
    const idle = `${STAGES.length} Stufen – vom Asteroiden bis zur Galaxie. Zeig auf eine.`;
    const describe = i => `${String(i + 1).padStart(2, '0')} · ${STAGES[i].name} · ${i === 0 ? 'Start' : `ab ${fmt(STAGES[i].min)} Masse`}`;
    list.innerHTML = '';
    caption.textContent = idle;
    const jobs = [];
    STAGES.forEach((s, i) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.title = s.name;
      li.setAttribute('aria-label', describe(i));
      const show = () => { caption.textContent = describe(i); };
      const hide = () => { caption.textContent = idle; };
      li.addEventListener('pointerenter', show);
      li.addEventListener('focus', show);
      li.addEventListener('pointerleave', hide);
      li.addEventListener('blur', hide);
      list.appendChild(li);
      jobs.push(() => li.appendChild(thumb(i, 40)));
    });
    const next = () => {
      const job = jobs.shift();
      if (!job) return;
      job();
      setTimeout(next, 16);
    };
    setTimeout(next, 250);
  }

  bind() {
    this.$('entry').addEventListener('submit', e => {
      e.preventDefault();
      this.h.play(this.playerName());
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const a = btn.dataset.action;
      if (this.h[a]) {
        this.h.click?.();
        this.h[a]();
      }
    });
    this.el.volume.addEventListener('input', () => {
      const v = Number(this.el.volume.value) / 100;
      this.el.volumeVal.textContent = this.el.volume.value;
      this.h.volume(v);
    });
    window.addEventListener('resize', () => this.resizeMinimap());
  }

  playerName() {
    const raw = this.el.name.value.replace(/\s+/g, ' ').trim().slice(0, 16);
    storage.set('name', raw);
    return raw || 'Weltraumtourist';
  }

  // --- Bildschirme -----------------------------------------------------------------

  /** name: 'start' | 'pause' | 'over' | 'dead' (nur Spielwelt) | null (Spiel mit HUD) */
  show(name) {
    for (const [key, el] of Object.entries(this.screens)) {
      if (key === name) this.reveal(el);
      else this.conceal(el);
    }
    const playing = name === null;
    this.hud.hidden = !(playing || name === 'pause');
    document.body.classList.toggle('is-menu', name === 'start');
    document.body.classList.toggle('is-playing', playing);
    this.el.touch.hidden = !(playing && this.mode === 'touch');
    // Am Handy nicht automatisch fokussieren — sonst verdeckt die Tastatur sofort alles
    if (name === 'start' && this.mode === 'mouse') setTimeout(() => this.el.name.focus({ preventScroll: true }), 50);
  }

  reveal(el) {
    clearTimeout(this.hideTimers.get(el));
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }

  conceal(el) {
    if (el.hidden) return;
    el.classList.remove('is-visible');
    this.hideTimers.set(el, setTimeout(() => { el.hidden = true; }, 450));
  }

  setMode(mode) {
    this.mode = mode;
    document.body.classList.toggle('is-touch', mode === 'touch');
    this.el.touch.hidden = !(document.body.classList.contains('is-playing') && mode === 'touch');
  }

  setAudio(muted, volume) {
    document.body.classList.toggle('is-muted', muted);
    for (const b of document.querySelectorAll('[data-action="mute"]')) b.setAttribute('aria-label', muted ? 'Ton an' : 'Ton aus');
    const v = Math.round(volume * 100);
    this.el.volume.value = String(v);
    this.el.volumeVal.textContent = String(v);
  }

  showRecord(best) {
    const r = this.el.record;
    if (!best) {
      r.textContent = 'Noch kein Rekord. Zeit, das zu ändern.';
      return;
    }
    r.innerHTML = `Rekord <strong>${fmt(best.mass)}</strong> Masse · ${STAGES[best.stage]?.name ?? '–'} · ${best.kills} Kills · ${fmtTime(best.time)}`;
  }

  showGameOver(s) {
    const $ = this.$;
    const titles = { eaten: 'Verschlungen.', blackhole: 'Spaghettifiziert.', shot: 'Zerschossen.' };
    $('over-title').textContent = titles[s.cause] || 'Aus.';
    const by = $('over-by');
    if (s.cause === 'eaten' && s.killer) {
      by.innerHTML = `Von <strong></strong> · Masse ${fmt(s.killerMass)}`;
      by.querySelector('strong').textContent = s.killer;
    } else if (s.cause === 'shot' && s.killer) {
      by.innerHTML = '<strong></strong> hat dich mit Asteroiden beworfen.';
      by.querySelector('strong').textContent = s.killer;
    } else if (s.cause === 'blackhole') {
      by.textContent = 'Ein Schwarzes Loch war schneller. Nichts kommt aus dem Horizont zurück.';
    } else {
      by.textContent = '';
    }
    $('st-stage').textContent = STAGES[s.stage].name;
    $('st-kills').textContent = String(s.kills);
    $('st-time').textContent = fmtTime(s.time);
    this.countUp($('st-mass'), s.mass);
    this.countUp($('st-max'), s.maxMass);

    const rec = $('over-record');
    if (s.cheated) {
      rec.textContent = 'Admin-Runde – zählt nicht für den Rekord.';
    } else if (s.isNewBest) {
      rec.innerHTML = '<span class="is-new">Neuer persönlicher Rekord.</span> Höchste Masse bisher.';
    } else if (s.best) {
      rec.innerHTML = `Persönlicher Rekord <strong>${fmt(s.best.mass)}</strong> · ${STAGES[s.best.stage]?.name ?? '–'}`;
    } else {
      rec.textContent = '';
    }
    this.show('over');
  }

  /** Zahlen zählen hoch statt zu erscheinen — kleine Belohnung fürs Hinschauen. */
  countUp(el, target) {
    const start = performance.now(), dur = 900;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - (1 - t) ** 3));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // --- Meldungen --------------------------------------------------------------------

  toast(kicker, title, line) {
    const t = this.el.toast;
    this.el.toastKicker.textContent = kicker;
    this.el.toastTitle.textContent = title;
    this.el.toastLine.textContent = line;
    t.classList.remove('is-on');
    void t.offsetWidth;          // Animation neu starten
    t.classList.add('is-on');
  }

  /** Eine Zeile im Ereignis-Feed. `parts` wechselt Text und hervorgehobene Namen ab. */
  feed(parts, tone = '') {
    const p = document.createElement('p');
    if (tone) p.className = tone;
    parts.forEach((part, i) => {
      if (i % 2) {
        const b = document.createElement('b');
        b.textContent = part;
        p.appendChild(b);
      } else {
        p.appendChild(document.createTextNode(part));
      }
    });
    const feed = this.el.feed;
    feed.appendChild(p);
    while (feed.children.length > 4) feed.firstChild.remove();
    setTimeout(() => p.remove(), 4300);
  }

  flashDamage() {
    const f = this.el.flash;
    f.classList.remove('is-on');
    void f.offsetWidth;
    f.classList.add('is-on');
  }

  denyOrbit() {
    const o = this.el.orbit;
    o.classList.remove('is-denied');
    void o.offsetWidth;
    o.classList.add('is-denied');
  }

  /** Hinweise erscheinen einmal pro Gerät — wer das Spiel kennt, wird nicht belehrt. */
  hint(key, force = false) {
    if (!force && this.hintsSeen.has(key)) return;
    if (this.hintKey === key || this.hintQueue.includes(key)) return;
    this.hintQueue.push(key);
  }

  resetHints() {
    this.hintQueue.length = 0;
    this.hintKey = null;
    this.hintT = 0;
    this.el.hint.classList.remove('is-on');
  }

  updateHints(dt) {
    if (this.hintKey) {
      this.hintT -= dt;
      if (this.hintT <= 0) {
        this.el.hint.classList.remove('is-on');
        this.hintKey = null;
        this.hintT = -0.6;      // kurze Pause zwischen zwei Hinweisen
      }
      return;
    }
    if (this.hintT < 0) {
      this.hintT += dt;
      return;
    }
    const key = this.hintQueue.shift();
    if (!key) return;
    const text = HINTS[key];
    this.el.hint.innerHTML = typeof text === 'string' ? text : text[this.mode];
    this.el.hint.classList.add('is-on');
    this.hintKey = key;
    this.hintT = key === 'move' ? 4.5 : 6;
    this.hintsSeen.add(key);
    storage.set('hints', [...this.hintsSeen]);
  }

  // --- HUD pro Frame -------------------------------------------------------------------

  update(game, dt, view) {
    this.updateHints(dt);
    const p = game.player;
    if (!p || !p.alive) return;

    // Masse: weich mitzählen, Farbe blitzt bei Gewinn/Verlust
    this.displayMass = damp(this.displayMass, p.mass, 14, dt);
    const shown = Math.round(this.displayMass);
    if (shown !== this.shownMass) {
      this.el.mass.textContent = fmt(shown);
      this.shownMass = shown;
    }
    const delta = p.mass - this.lastMass;
    this.lastMass = p.mass;
    if (delta > 3 || delta < -2) {
      this.el.mass.classList.toggle('is-up', delta > 0);
      this.el.mass.classList.toggle('is-down', delta < 0);
      this.massFlashT = 0.25;
    }
    if (this.massFlashT > 0) {
      this.massFlashT -= dt;
      if (this.massFlashT <= 0) this.el.mass.classList.remove('is-up', 'is-down');
    }

    // Stufe + Fortschritt bis zur nächsten
    const s = p.stage;
    this.set('stage', this.el.stage, STAGES[s].name);
    this.set('stageNum', this.el.stageNum, `${s + 1} / ${STAGES.length}`);
    const next = STAGES[s + 1];
    let prog = 1;
    if (next) {
      prog = clamp((p.mass - STAGES[s].min) / (next.min - STAGES[s].min), 0, 1);
      this.set('next', this.el.next, `${next.name} bei ${fmt(next.min)}`);
    } else {
      this.set('next', this.el.next, 'Höchste Stufe erreicht');
    }
    // Reibung: nur anzeigen, wenn sie spürbar ist
    const drain = p.drain >= 0.1 ? `−${p.drain.toFixed(1).replace('.', ',')} / s Reibung` : '';
    if (drain !== this.cache.drain) {
      this.cache.drain = drain;
      this.el.drain.textContent = drain;
      this.el.drain.hidden = !drain;
    }

    const on = Math.round(prog * RULER_TICKS);
    if (on !== this.cache.ruler) {
      this.cache.ruler = on;
      this.ticks.forEach((t, i) => t.classList.toggle('on', i < on));
    }

    // Kombo
    const c = game.combo;
    const showCombo = c.count >= COMBO.showFrom;
    this.el.combo.classList.toggle('is-on', showCombo);
    if (showCombo) {
      const mult = 1 + Math.min(c.count - 1, COMBO.maxSteps) * COMBO.step;
      if (c.count !== this.comboShown) {
        this.el.comboMult.textContent = `×${mult.toFixed(2).replace('.', ',')}`;
        this.el.comboCount.textContent = `${c.count} in Folge`;
        this.el.combo.classList.remove('is-bump');
        void this.el.combo.offsetWidth;
        this.el.combo.classList.add('is-bump');
        this.comboShown = c.count;
      }
      this.el.comboBar.style.transform = `scaleX(${clamp(c.timer / COMBO.window, 0, 1)})`;
    } else {
      this.comboShown = 0;
    }

    // Fähigkeiten
    const max = maxOrbiters(p.mass);
    const n = p.orbiters.length;
    if (max !== this.pipCount) {
      this.el.pips.innerHTML = '<i></i>'.repeat(max);
      this.pipCount = max;
      this.cache.pips = -1;
    }
    if (n !== this.cache.pips) {
      this.cache.pips = n;
      [...this.el.pips.children].forEach((pip, i) => pip.classList.toggle('on', i < n));
      this.el.orbitVal.textContent = `${n} / ${max}`;
      this.el.orbit.classList.toggle('is-ready', n > 0);
    }
    const canBoost = p.mass > BODY.boostMinMass;
    this.set('boost', this.el.boostState, p.boosting ? 'aktiv' : canBoost ? 'bereit' : `ab ${BODY.boostMinMass} Masse`);
    this.el.boost.classList.toggle('is-ready', canBoost);

    this.coordT -= dt;
    if (this.coordT <= 0) {
      this.coordT = 0.2;
      const deg = ((Math.atan2(p.y, p.x) * 180) / Math.PI + 90 + 360) % 360;
      this.el.coords.textContent = `${String(Math.round(deg) % 360).padStart(3, '0')}° · ${fmt(Math.hypot(p.x, p.y))} AE`;
    }

    this.boardT -= dt;
    if (this.boardT <= 0) {
      this.boardT = 0.25;
      this.updateBoard(game, p);
    }
    this.mapT -= dt;
    if (this.mapT <= 0) {
      this.mapT = 1 / 15;
      this.drawMinimap(game, p, view);
    }
  }

  set(key, el, text) {
    if (this.cache[key] === text) return;
    this.cache[key] = text;
    el.textContent = text;
  }

  updateBoard(game, p) {
    const ranked = game.ranking();
    const myRank = ranked.indexOf(p);
    this.el.boardCount.textContent = `${ranked.length} im Orbit`;
    const rows = this.rows;
    const fill = (row, b, rank) => {
      row.li.hidden = false;
      row.li.classList.remove('is-gap');
      row.dot.style.visibility = '';
      const self = b === p;
      const rel = self ? 'self' : canEat(b, p) ? 'threat' : canEat(p, b) ? 'prey' : '';
      const key = `${rank}|${b.id}|${Math.round(b.mass)}|${rel}`;
      if (row.key === key) return;
      row.key = key;
      row.rank.textContent = String(rank + 1).padStart(2, '0');
      row.dot.className = `board__dot ${rel}`;
      row.name.textContent = self ? `${b.name} (du)` : b.name;
      row.mass.textContent = fmt(b.mass);
      row.li.classList.toggle('is-self', self);
    };
    const top = Math.min(BOARD_ROWS, ranked.length);
    for (let i = 0; i < top; i++) fill(rows[i], ranked[i], i);
    for (let i = top; i < rows.length; i++) rows[i].li.hidden = true;
    if (myRank >= BOARD_ROWS) {
      const gap = rows[BOARD_ROWS];
      gap.li.hidden = false;
      gap.li.classList.add('is-gap');
      gap.key = 'gap';
      gap.rank.textContent = gap.name.textContent = gap.mass.textContent = '';
      gap.dot.className = 'board__dot';
      gap.dot.style.visibility = 'hidden';
      fill(rows[BOARD_ROWS + 1], p, myRank);
    }
  }

  /** Radar-Karte: Arena, eigener Sichtbereich, Schwarze Löcher, Kometen und Körper in der Nähe. */
  drawMinimap(game, p, view) {
    const ctx = this.mapCtx, S = this.mapSize, c = S / 2, R = c - 4;
    const k = R / WORLD.radius;
    ctx.clearRect(0, 0, S, S);

    ctx.fillStyle = 'rgba(5,7,11,0.72)';
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(236,230,214,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.moveTo(c + R * f, c);
      ctx.arc(c, c, R * f, 0, TAU);
    }
    ctx.moveTo(c - R, c); ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R); ctx.lineTo(c, c + R);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(214,244,244,0.55)';
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    for (let d = 0; d < 360; d += 30) {
      const a = (d / 180) * Math.PI;
      ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      ctx.lineTo(c + Math.cos(a) * (R - (d % 90 === 0 ? 6 : 3)), c + Math.sin(a) * (R - (d % 90 === 0 ? 6 : 3)));
    }
    ctx.stroke();

    // Sichtbereich der Kamera
    if (view) {
      ctx.strokeStyle = 'rgba(255,179,71,0.4)';
      ctx.strokeRect(c + view.x0 * k, c + view.y0 * k, (view.x1 - view.x0) * k, (view.y1 - view.y0) * k);
    }

    // Umkreis, in dem Körper angezeigt werden
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(236,230,214,0.16)';
    ctx.beginPath();
    ctx.arc(c + p.x * k, c + p.y * k, MAP_RANGE * k, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const h of game.blackHoles) {
      const x = c + h.x * k, y = c + h.y * k;
      ctx.strokeStyle = `rgba(255,91,79,${0.45 * h.strength})`;
      ctx.beginPath();
      ctx.arc(x, y, h.pullR * k, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#000';
      ctx.strokeStyle = 'rgba(255,190,120,0.9)';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2.5, h.r * k * 2), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }

    ctx.fillStyle = '#bfefff';
    for (const d of game.debris) {
      if (d.kind !== 2) continue;
      ctx.fillRect(c + d.x * k - 1, c + d.y * k - 1, 2, 2);
    }

    for (const b of game.bodies) {
      if (!b.alive || b === p) continue;
      if (Math.hypot(b.x - p.x, b.y - p.y) > MAP_RANGE) continue;
      const rel = canEat(b, p) ? PALETTE.threat : canEat(p, b) ? PALETTE.prey : 'rgba(236,230,214,0.6)';
      ctx.fillStyle = rel;
      ctx.beginPath();
      ctx.arc(c + b.x * k, c + b.y * k, clamp(b.r * k * 1.4, 1.6, 6), 0, TAU);
      ctx.fill();
    }

    const px = c + p.x * k, py = c + p.y * k;
    ctx.strokeStyle = PALETTE.amber;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const sp = Math.hypot(p.vx, p.vy) || 1;
    ctx.lineTo(px + (p.vx / sp) * 9, py + (p.vy / sp) * 9);
    ctx.stroke();
    ctx.fillStyle = PALETTE.amber;
    ctx.beginPath();
    ctx.arc(px, py, clamp(p.r * k * 1.4, 2.5, 7), 0, TAU);
    ctx.fill();
  }

  resetHud() {
    this.displayMass = BODY.startMass;
    this.shownMass = -1;
    this.lastMass = BODY.startMass;
    this.cache = {};
    this.pipCount = -1;
    this.comboShown = 0;
    this.el.combo.classList.remove('is-on');
    for (const r of this.rows) {
      r.key = '';
      r.dot.style.visibility = '';
    }
    this.el.mapRange.textContent = fmt(MAP_RANGE);
    this.el.drain.hidden = true;
  }

  setAdmin(on) {
    this.el.admin.hidden = !on;
  }

  debug(text) {
    const d = this.el.debug;
    if (text === null) {
      d.hidden = true;
      return;
    }
    d.hidden = false;
    d.textContent = text;
  }
}
