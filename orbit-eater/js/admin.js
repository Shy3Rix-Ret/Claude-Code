/**
 * Admin-Konsole: Befehle zum Testen, Ausprobieren und Angeben.
 *
 * Öffnen mit T, Enter oder / (am Handy über den Konsolen-Knopf oben rechts).
 * Tab vervollständigt, ↑/↓ blättert durch den Verlauf, Esc schließt.
 *
 * Fairness: Sobald ein Befehl das Spiel verändert, gilt die Runde als
 * "Admin-Runde" — sie zählt nicht für den persönlichen Rekord.
 */
import { BODY, BOTS, STAGES, BLACK_HOLE, WORLD } from './config.js';
import { TAU, clamp, fmt, random, randRange } from './utils.js';
import { BlackHole, maxOrbiters } from './entities.js';
import { storage } from './storage.js';

/** "Roter Überriese" → "roterueberriese" — so findet /stufe Namen mit und ohne Umlaute. */
const normalize = s => s.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]/g, '');

const STAGE_ALIASES = (() => {
  const map = {};
  STAGES.forEach((s, i) => { map[normalize(s.name)] = i; map[s.key] = i; });
  // Spitznamen aus dem Sonnensystem und Kurzformen
  const nick = {
    europa: 'icemoon', io: 'lavamoon', mars: 'desert', erde: 'ocean', planet: 'ocean', venus: 'cloud',
    uranus: 'icegiant', neptun: 'icegiant', jupiter: 'gasgiant', riese: 'gasgiant', saturn: 'ringgiant',
    stern: 'sun', star: 'sun', pulsar: 'neutron', loch: 'blackhole', bh: 'blackhole',
  };
  for (const [n, key] of Object.entries(nick)) map[n] = STAGES.findIndex(s => s.key === key);
  return map;
})();

/** Zahl aus einem Argument; akzeptiert deutsches Komma ("0,5"). */
function num(arg, fallback) {
  if (arg === undefined || arg === '') return fallback;
  const v = Number(String(arg).replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

const de = v => String(Math.round(v * 100) / 100).replace('.', ',');

export class AdminConsole {
  /**
   * @param ctx {
   *   game, renderer, ui, audio,
   *   isPlaying(): boolean,
   *   setTimeScale(v), getTimeScale(),
   *   toggleDebug(): boolean,
   * }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.el = document.getElementById('console');
    this.log = document.getElementById('console-log');
    this.form = document.getElementById('console-form');
    this.input = document.getElementById('console-input');
    this.suggest = document.getElementById('console-suggest');
    this.history = storage.get('console-history', []);
    this.histIndex = -1;
    this.isOpen = false;
    this.commands = this.buildCommands();
    this.bind();
  }

  // --- Öffnen, Schließen, Eingabe ---------------------------------------------

  bind() {
    this.form.addEventListener('submit', e => {
      e.preventDefault();
      const line = this.input.value.trim();
      if (line && line !== '/') this.execute(line);
      this.close();
    });
    this.input.addEventListener('input', () => this.updateSuggest());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.complete();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.browse(e.key === 'ArrowUp' ? 1 : -1);
      }
    });
    this.suggest.addEventListener('click', e => {
      const b = e.target.closest('button[data-cmd]');
      if (!b) return;
      this.input.value = `/${b.dataset.cmd} `;
      this.input.focus();
      this.updateSuggest();
    });
  }

  open(prefill = '/') {
    if (!this.ctx.isPlaying()) return;
    this.isOpen = true;
    this.el.classList.add('is-open');
    document.body.classList.add('console-open');
    if (!this.input.value || this.input.value === '/') this.input.value = prefill;
    this.histIndex = -1;
    this.updateSuggest();
    this.log.scrollTop = this.log.scrollHeight;
    // Fokus erst im nächsten Frame — sonst landet der auslösende Tastendruck im Feld
    requestAnimationFrame(() => {
      this.input.focus({ preventScroll: true });
      const n = this.input.value.length;
      this.input.setSelectionRange(n, n);
    });
  }

  close() {
    this.isOpen = false;
    this.el.classList.remove('is-open');
    document.body.classList.remove('console-open');
    this.input.value = '';
    this.suggest.innerHTML = '';
    this.input.blur();
  }

  browse(dir) {
    if (!this.history.length) return;
    this.histIndex = clamp(this.histIndex + dir, -1, this.history.length - 1);
    this.input.value = this.histIndex < 0 ? '/' : this.history[this.history.length - 1 - this.histIndex];
    this.updateSuggest();
  }

  /** Passende Befehle zum bisher Getippten (nur solange noch kein Argument da ist). */
  matches() {
    const raw = this.input.value.replace(/^\//, '');
    if (raw.includes(' ')) return [];
    const q = raw.toLowerCase();
    return this.commands.filter(c => c.name.startsWith(q) || c.alias.some(a => a.startsWith(q)));
  }

  complete() {
    const m = this.matches();
    if (m.length) {
      this.input.value = `/${m[0].name} `;
      this.updateSuggest();
    }
  }

  updateSuggest() {
    const m = this.matches().slice(0, 6);
    this.suggest.innerHTML = '';
    m.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.cmd = c.name;
      if (i === 0) b.className = 'is-first';
      const name = document.createElement('b');
      name.textContent = `/${c.name}`;
      b.append(name, c.args ? ` ${c.args}` : '', ` — ${c.help}`);
      this.suggest.appendChild(b);
    });
  }

  print(text, tone = '') {
    const li = document.createElement('li');
    if (tone) li.className = tone;
    li.textContent = text;
    this.log.appendChild(li);
    while (this.log.children.length > 40) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  // --- Ausführen ------------------------------------------------------------------

  execute(line) {
    if (this.history[this.history.length - 1] !== line) {
      this.history.push(line);
      if (this.history.length > 30) this.history.shift();
      storage.set('console-history', this.history);
    }
    this.print(line, 'cmd');
    const parts = line.replace(/^\//, '').trim().split(/\s+/);
    const word = (parts.shift() || '').toLowerCase();
    const cmd = this.commands.find(c => c.name === word || c.alias.includes(word));
    if (!cmd) {
      this.print(`Unbekannter Befehl „${word}“. /hilfe zeigt alle.`, 'err');
      this.ctx.audio.denied();
      return;
    }
    const p = this.ctx.game.player;
    if (cmd.needsPlayer && (!p || !p.alive)) {
      this.print('Dafür musst du im Spiel sein.', 'err');
      return;
    }
    try {
      const out = cmd.run(parts, p);
      if (out instanceof Error) {
        this.print(out.message, 'err');
        this.ctx.audio.denied();
        return;
      }
      if (cmd.cheat) this.markCheated();
      if (out) this.print(out, 'ok');
      this.ctx.audio.ui('confirm');
    } catch (err) {
      this.print(`Fehler: ${err.message}`, 'err');
    }
  }

  markCheated() {
    this.ctx.game.cheated = true;
    this.ctx.ui.setAdmin(true);
  }

  /** Wirken noch globale Admin-Effekte (Zeit, Zoom, eingefrorene Bots)? Dann zählt auch die nächste Runde nicht. */
  globalEffectsActive() {
    const { game, renderer } = this.ctx;
    return this.ctx.getTimeScale() !== 1 || renderer.zoomMul !== 1 || game.freezeBots;
  }

  // --- Befehle ----------------------------------------------------------------------

  buildCommands() {
    const { game, renderer } = this.ctx;
    const err = msg => new Error(msg);
    const cmd = (name, alias, args, help, run, opts = {}) =>
      ({ name, alias, args, help, run, cheat: opts.cheat !== false, needsPlayer: opts.needsPlayer !== false });

    /** Punkt in Blickrichtung des Spielers, `dist` vor ihm. */
    const ahead = (p, dist) => {
      const sp = Math.hypot(p.vx, p.vy);
      const dx = sp > 5 ? p.vx / sp : p.dirX, dy = sp > 5 ? p.vy / sp : p.dirY;
      return { x: p.x + dx * dist, y: p.y + dy * dist };
    };
    const inArena = (x, y, margin) => {
      const d = Math.hypot(x, y), lim = WORLD.radius - margin;
      return d > lim ? { x: (x / d) * lim, y: (y / d) * lim } : { x, y };
    };

    return [
      cmd('hilfe', ['help', '?'], '', 'alle Befehle anzeigen', () => {
        for (const c of this.commands) this.print(`/${c.name}${c.args ? ' ' + c.args : ''} — ${c.help}`, 'info');
        return '';
      }, { cheat: false, needsPlayer: false }),

      cmd('masse', ['mass', 'm'], '<zahl>', 'eigene Masse setzen', (a, p) => {
        const v = num(a[0]);
        if (!Number.isFinite(v)) return err('Beispiel: /masse 500');
        const m = clamp(v, BODY.minMass, BODY.maxMass);
        p.mass = m;
        if (m > p.maxMass) p.maxMass = m;
        return `Masse auf ${fmt(m)} gesetzt.`;
      }),

      cmd('stufe', ['stage'], `<1–${STAGES.length} | name>`, 'direkt auf eine Stufe springen', (a, p) => {
        const arg = normalize(a.join(''));
        let i = STAGE_ALIASES[arg];
        if (i === undefined) i = num(arg) - 1;
        if (!Number.isInteger(i) || i < 0 || i >= STAGES.length) {
          return err(`Beispiel: /stufe 13, /stufe quasar oder /stufe roter zwerg (1–${STAGES.length})`);
        }
        const m = i === 0 ? 30 : Math.round(STAGES[i].min * 1.1);
        p.mass = m;
        if (m > p.maxMass) p.maxMass = m;
        return `${STAGES[i].name}: Masse ${fmt(m)}.`;
      }),

      cmd('gott', ['god', 'godmode'], '', 'unverwundbar an/aus', (a, p) => {
        p.god = !p.god;
        if (!p.god) p.shield = 0;
        return p.god ? 'Gottmodus an. Nichts kann dich fressen, treffen oder verschlucken.' : 'Gottmodus aus.';
      }),

      cmd('tempo', ['speed'], '<faktor>', 'eigenes Tempo × Faktor (1 = normal)', (a, p) => {
        const v = num(a[0], 1);
        if (!Number.isFinite(v)) return err('Beispiel: /tempo 2');
        p.speedMul = clamp(v, 0.2, 5);
        return `Tempo × ${de(p.speedMul)}.`;
      }),

      cmd('bot', ['spawn'], '[masse] [anzahl]', 'Bots neben dir erzeugen', (a, p) => {
        const m = num(a[0], Math.round(p.mass * 0.6));
        const n = Math.round(num(a[1], 1));
        if (!Number.isFinite(m) || !Number.isFinite(n)) return err('Beispiel: /bot 300 2');
        const count = clamp(n, 1, 20);
        for (let i = 0; i < count; i++) {
          const b = game.spawnBot();
          b.setMass(clamp(m, 12, 20000));
          const ang = random() * TAU, dist = p.r + b.r + randRange(260, 480);
          const pos = inArena(p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist, b.r + 20);
          b.place(pos.x, pos.y);
        }
        return `${count} Bot${count > 1 ? 's' : ''} mit Masse ${fmt(clamp(m, 12, 20000))} erzeugt.`;
      }),

      cmd('bots', [], '<anzahl>', `Anzahl der Bots in der Arena (0–${BOTS.count * 2})`, a => {
        const n = num(a[0]);
        if (!Number.isFinite(n)) return err(`Beispiel: /bots ${Math.round(BOTS.count / 2)}`);
        const target = clamp(Math.round(n), 0, BOTS.count * 2);
        const bots = game.bodies.filter(b => !b.isPlayer && b.alive);
        game.respawnAt.length = 0;
        if (bots.length < target) {
          for (let i = bots.length; i < target; i++) game.spawnBot();
        } else {
          // Überzählige verschwinden still — kleinste zuerst
          bots.sort((x, y) => x.mass - y.mass).slice(0, bots.length - target).forEach(b => {
            game.releaseOrbiters(b);
            b.alive = false;
            b.removed = true;
          });
        }
        return `${target} Bots in der Arena.`;
      }, { needsPlayer: false }),

      cmd('loch', ['blackhole', 'bh'], '', 'Schwarzes Loch vor dir erzeugen', (a, p) => {
        const h = new BlackHole(0, 0);
        const spot = ahead(p, p.r + h.pullR * 1.15);
        const pos = inArena(spot.x, spot.y, h.pullR * 0.4);
        h.x = h.px = pos.x;
        h.y = h.py = pos.y;
        game.blackHoles.push(h);
        game.events.emit('bhSpawn', h);
        return 'Schwarzes Loch entsteht vor dir. Viel Glück.';
      }),

      cmd('komet', ['comet'], '[anzahl]', 'Kometen auf dich zu schicken', (a, p) => {
        const n = clamp(Math.round(num(a[0], 1)), 1, 10);
        for (let i = 0; i < n; i++) {
          game.spawnComet();
          const d = game.debris[game.debris.length - 1];
          const ang = random() * TAU, dist = 1100 + random() * 400;
          d.place(p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist);
          d.age = 0;
          const sp = randRange(380, 480);
          const tx = p.x - d.x + (random() - 0.5) * 200, ty = p.y - d.y + (random() - 0.5) * 200;
          const len = Math.hypot(tx, ty);
          d.vx = (tx / len) * sp;
          d.vy = (ty / len) * sp;
          d.angle = Math.atan2(d.vy, d.vx);
        }
        return `${n} Komet${n > 1 ? 'en' : ''} im Anflug.`;
      }),

      cmd('orbit', [], '[anzahl]', 'deinen Orbit mit Asteroiden füllen', (a, p) => {
        const free = Math.max(0, maxOrbiters(p.mass) - p.orbiters.length);
        const n = clamp(Math.round(num(a[0], free || 5)), 1, 30 - p.orbiters.length);
        if (n <= 0) return err('Mehr als 30 Orbiter gehen nicht.');
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU, dist = p.r + 30 + (i % 3) * 14;
          const d = game.spawnAsteroid(false, randRange(4, 8));
          d.place(p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist);
          game.capture(p, d, dist);
        }
        return `${n} Asteroiden im Orbit. Maustaste halten, loslassen.`;
      }),

      cmd('vernichten', ['killall', 'nuke'], '[alle]', 'Bots in deiner Nähe zerlegen (mit „alle“: jeden)', (a, p) => {
        const all = (a[0] || '').toLowerCase() === 'alle' || (a[0] || '').toLowerCase() === 'all';
        let n = 0;
        for (const b of game.bodies) {
          if (b === p || !b.alive || b.isPlayer) continue;
          if (!all && Math.hypot(b.x - p.x, b.y - p.y) > 2400) continue;
          game.killBody(b, 'shot', p);
          n++;
        }
        return n ? `${n} Bot${n > 1 ? 's' : ''} zerlegt.` : 'Niemand in der Nähe. /vernichten alle trifft jeden.';
      }),

      cmd('einfrieren', ['freeze'], '', 'Bots anhalten an/aus', () => {
        game.freezeBots = !game.freezeBots;
        return game.freezeBots ? 'Bots eingefroren.' : 'Bots bewegen sich wieder.';
      }, { needsPlayer: false }),

      cmd('zeit', ['time', 'slowmo'], '<faktor>', 'Zeitlupe (0,2) bis Zeitraffer (3)', a => {
        const v = num(a[0], 1);
        if (!Number.isFinite(v)) return err('Beispiel: /zeit 0,5');
        this.ctx.setTimeScale(clamp(v, 0.1, 3));
        return `Zeit × ${de(clamp(v, 0.1, 3))}.`;
      }, { needsPlayer: false }),

      cmd('zoom', [], '<faktor>', 'Kamera weiter weg (0,3) oder näher (2)', a => {
        const v = num(a[0], 1);
        if (!Number.isFinite(v)) return err('Beispiel: /zoom 0,5');
        renderer.zoomMul = clamp(v, 0.15, 3);
        return `Zoom × ${de(renderer.zoomMul)}.`;
      }, { needsPlayer: false }),

      cmd('tp', ['teleport'], '<x> <y> | mitte | zufall', 'teleportieren', (a, p) => {
        const w = (a[0] || '').toLowerCase();
        let x, y;
        if (w === 'mitte' || w === 'center') {
          x = 0; y = 0;
        } else if (w === 'zufall' || w === 'random' || w === '') {
          const ang = random() * TAU, r = Math.sqrt(random()) * WORLD.radius * 0.85;
          x = Math.cos(ang) * r; y = Math.sin(ang) * r;
        } else {
          x = num(a[0]); y = num(a[1], 0);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return err('Beispiel: /tp 1200 -800, /tp mitte');
        }
        const pos = inArena(x, y, p.r + 10);
        p.place(pos.x, pos.y);
        p.vx = p.vy = 0;
        renderer.camera.jump(pos.x, pos.y);
        return `Teleportiert nach ${fmt(pos.x)} / ${fmt(pos.y)}.`;
      }),

      cmd('aufräumen', ['clear', 'aufraeumen'], '', 'alle Schwarzen Löcher auflösen', () => {
        const n = game.blackHoles.length;
        for (const h of game.blackHoles) h.age = Math.max(h.age, h.life - BLACK_HOLE.collapseTime);
        return n ? `${n} Schwarze${n > 1 ? ' Löcher lösen' : 's Loch löst'} sich auf.` : 'Keine Schwarzen Löcher da.';
      }, { needsPlayer: false }),

      cmd('name', ['rename'], '<neuer name>', 'dich umbenennen', (a, p) => {
        const name = a.join(' ').trim().slice(0, 16);
        if (!name) return err('Beispiel: /name Planet Ömer');
        p.name = name;
        p.upperName = null;
        return `Du heißt jetzt ${name}.`;
      }, { cheat: false }),

      cmd('fps', ['debug'], '', 'Leistungsanzeige an/aus', () =>
        (this.ctx.toggleDebug() ? 'Leistungsanzeige an.' : 'Leistungsanzeige aus.'),
      { cheat: false, needsPlayer: false }),

      cmd('rekordreset', ['resetbest'], '', 'persönlichen Rekord löschen', () => {
        storage.set('best', null);
        return 'Rekord gelöscht.';
      }, { cheat: false, needsPlayer: false }),

      cmd('reset', [], '', 'alle Admin-Effekte zurücksetzen', (a, p) => {
        this.ctx.setTimeScale(1);
        renderer.zoomMul = 1;
        game.freezeBots = false;
        if (p) {
          p.god = false;
          p.shield = 0;
          p.speedMul = 1;
        }
        return 'Zeit, Zoom, Tempo, Gottmodus und Bots zurückgesetzt. Diese Runde bleibt eine Admin-Runde.';
      }, { cheat: false, needsPlayer: false }),
    ];
  }
}
