/**
 * Planetenfinder — application shell.
 *
 * Holds the state (place, time, settings, target), keeps one canvas fed by
 * either the live view or the map, and wires the panels. The astronomy lives
 * in astro.js and the pointing in sensors.js; this file is the part that has
 * opinions about buttons.
 */

import {
  allBodies, findEvents, sunEvents, moonPhaseEvents, starHorizon,
  separationAltAz, saturnRingTilt, j2000ToHorizon, findFixedEvents, bodyState,
} from './astro.js';
import { STARS, CONSTELLATION_LINES, MILKY_WAY } from './stars.js';
import { DEEP_SKY } from './deepsky.js';
import { BODIES, compassShort, compassName } from './bodies.js';
import { Orientation, azAltOf } from './sensors.js';
import { loadSettings, saveSettings, locate } from './geo.js';
import { renderSky } from './skyview.js';
import { renderMap } from './mapview.js';
import { collectEvents } from './events.js';
import {
  el, buildList, buildListRows, buildDetail, buildDeepSkyDetail, buildTwilight, buildTimePanel,
  buildSettings, buildEvents, tickCountdowns, fmtDateTime, altitudeWords,
} from './ui.js';

const $ = (id) => document.getElementById(id);

const app = {
  settings: loadSettings(),
  orientation: new Orientation(),
  mode: 'live',            // live | map
  target: null,
  timeOffsetMinutes: 0,
  scene: null,
  hits: [],
  sheetMode: null,
  cameraStream: null,
  eventCache: new Map(),
  events: null,          // the Termine list, once computed
  eventsAt: 0,
  listFilter: '',

  now() {
    return new Date(Date.now() + this.timeOffsetMinutes * 60000);
  },
};

/* ------------------------------------------------------------------ canvas */

const canvas = $('view');
const ctx = canvas.getContext('2d');
let cssW = 0, cssH = 0;

/**
 * Vertical room the overlays leave free. Measured from the DOM rather than
 * hard-coded, because the safe-area insets differ per device.
 */
let insets = { top: 0, bottom: 0 };

function measureInsets() {
  const summary = $('summary').getBoundingClientRect();
  const bar = $('bar').getBoundingClientRect();
  insets = {
    top: Math.max(0, summary.bottom + 10),
    bottom: Math.max(0, cssH - bar.top + 10),
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cssW = canvas.clientWidth;
  cssH = canvas.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  measureInsets();
  syncTabs();   // the tab widths changed, so the brass mark has moved with them
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

/* ------------------------------------------------------------------- scene */

let sceneAt = 0;
let starsAt = 0;
let cachedStars = [];
let cachedLines = [];
let cachedDeepSky = [];
let cachedMilkyWay = [];

function buildScene(force = false) {
  const t = performance.now();
  const date = app.now();
  const site = app.settings.site;

  if (force || !app.scene || t - sceneAt > 250) {
    sceneAt = t;
    const bodies = allBodies(date, site);
    const sun = bodies.find((b) => b.id === 'sun');

    if (force || t - starsAt > 2000) {
      starsAt = t;
      const positions = new Map();
      cachedStars = STARS.map((s) => {
        const h = starHorizon(s.ra, s.dec, date, site);
        const entry = { name: s.name, mag: s.mag, colour: s.colour, alt: h.alt, az: h.az };
        positions.set(s.id, entry);
        return entry;
      });
      cachedLines = CONSTELLATION_LINES.map((l) => ({
        a: positions.get(l.a.id), b: positions.get(l.b.id),
      })).filter((l) => l.a && l.b);

      cachedDeepSky = DEEP_SKY.map((o) => {
        const h = starHorizon(o.ra, o.dec, date, site);
        // altApparent and aboveHorizon so targeting and the summary can treat
        // these exactly like a planet.
        return { ...o, alt: h.alt, az: h.az, altApparent: h.alt, aboveHorizon: h.alt > 0 };
      });

      // The band is fixed against the stars, so only the horizon rotation
      // has to be redone — the galactic transform happened once at load.
      cachedMilkyWay = MILKY_WAY.map((row) => row.map((pt) => {
        const h = j2000ToHorizon(pt.ra, pt.dec, date, site);
        return { alt: h.alt, az: h.az, weight: pt.weight };
      }));
    }

    app.scene = {
      bodies, stars: cachedStars, lines: cachedLines,
      deepSky: cachedDeepSky, milkyWay: cachedMilkyWay,
      sunAlt: sun.altApparent, date,
      // Changes over years, not frames, but it costs one Kepler solution.
      ringTilt: saturnRingTilt(date),
    };
  }
  return app.scene;
}

/** Rise/set is a scan over dozens of positions, so it is cached per body. */
function eventsFor(id) {
  const date = app.now();
  const site = app.settings.site;
  const key = `${id}|${Math.floor(date.getTime() / 300000)}|${site.lat.toFixed(3)}|${site.lon.toFixed(3)}`;
  if (!app.eventCache.has(key)) {
    if (app.eventCache.size > 60) app.eventCache.clear();
    app.eventCache.set(key, id === 'sun' ? sunEvents(date, site) : findEvents(id, date, site));
  }
  return app.eventCache.get(key);
}

/**
 * Altitude of one thing over the next 24 hours, alongside the Sun's, for the
 * chart in the detail panels. Ninety-six samples is one every quarter hour —
 * enough for a smooth curve, cheap enough to compute on tap.
 */
function altitudeSamples(target) {
  const site = app.settings.site;
  const start = app.now().getTime();
  const out = [];
  // Discriminated explicitly: deep-sky objects carry an `id` too, and keying
  // off that alone sent 'dso-2' into the planetary ephemeris.
  const fixed = target.kind === 'fixed';
  for (let i = 0; i <= 96; i++) {
    const t = start + i * 15 * 60000;
    const when = new Date(t);
    const alt = fixed
      ? starHorizon(target.ra, target.dec, when, site).alt
      : bodyState(target.id, when, site).altApparent;
    out.push({ t, alt, sunAlt: bodyState('sun', when, site).altApparent });
  }
  return out;
}

/* -------------------------------------------------------------- render loop */

let lastFrame = performance.now();

function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  app.orientation.update(dt);
  const scene = buildScene();
  const basis = app.orientation.basis();
  const aim = azAltOf(basis.forward);

  const view = {
    w: cssW, h: cssH, basis, aim, insets,
    fov: app.settings.fov,
    scene, settings: app.settings,
    target: app.target,
    cameraOn: !!app.cameraStream,
    video: $('cam'),
    date: scene.date, site: app.settings.site,
  };

  app.hits = app.mode === 'live' ? renderSky(ctx, view) : renderMap(ctx, view);
  updateHud(aim);

  requestAnimationFrame(frame);
}

/* ---------------------------------------------------------------- the HUD */

let hudAt = 0;

function updateHud(aim) {
  const t = performance.now();
  if (t - hudAt < 200) return;
  hudAt = t;

  const site = app.settings.site;
  $('place-name').textContent = site.label;
  $('place-time').textContent = app.timeOffsetMinutes === 0
    ? fmtDateTime(app.now())
    : `${fmtDateTime(app.now())} · verschoben`;

  $('aim-heading').textContent = `${Math.round(aim.az)}° ${compassShort(aim.az)}`;
  const mode = app.orientation.live ? '' : ' · ziehen';
  $('aim-alt').textContent = `Höhe ${Math.round(aim.alt)}°${mode}`;

  $('summary').innerHTML = '';
  $('summary').appendChild(summaryNode(aim));
  measureInsets();
}

function summaryNode(aim) {
  const bodies = app.scene?.bodies || [];

  if (app.target) {
    const body = bodies.find((b) => b.id === app.target)
      || (app.scene?.deepSky || []).find((o) => o.id === app.target);
    if (body) {
      const sep = separationAltAz(aim.alt, aim.az, body.altApparent, body.az);
      const name = BODIES[body.id]?.name || body.name;
      if (sep < 6) {
        return el('span', {}, [
          el('b', { text: name }), document.createTextNode(' ist in der Bildmitte.'),
        ]);
      }
      const turn = body.aboveHorizon ? '' : ' (steht unter dem Horizont)';
      return el('span', {}, [
        document.createTextNode('Ziel '), el('b', { text: name }),
        document.createTextNode(` — noch ${Math.round(sep)}° drehen${turn}`),
      ]);
    }
  }

  const candidates = bodies
    .filter((b) => b.aboveHorizon && b.id !== 'sun' && b.mag < 6)
    .sort((a, b) => a.mag - b.mag);

  if (!candidates.length) {
    return el('span', { text: 'Gerade steht keiner der hellen Planeten über dem Horizont.' });
  }
  const best = candidates[0];
  return el('span', {}, [
    el('b', { text: BODIES[best.id].name }),
    document.createTextNode(
      ` steht ${Math.round(best.altApparent)}° hoch im ${compassName(best.az)}` +
      ` · ${altitudeWords(best.altApparent)}`,
    ),
  ]);
}

/* ---------------------------------------------------------------- the sheet */

function openSheet(mode, content, title) {
  app.sheetMode = mode;
  $('sheet-title').textContent = title;
  const body = $('sheet-body');
  body.innerHTML = '';
  body.appendChild(content);
  body.scrollTop = 0;
  $('sheet').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  playEntrance(body);
  syncTabs();
}

/**
 * The staggered arrival of the rows. It belongs to opening a panel, not to
 * having one open: the object list refreshes itself every few seconds, and a
 * list that re-animates while you are reading it is a fidget, not a flourish.
 * Hence the class comes off again once the animation has run.
 */
let entranceTimer = null;
function playEntrance(body) {
  body.classList.remove('entering');
  void body.offsetWidth;          // forces a restart; re-adding alone does not
  body.classList.add('entering');
  clearTimeout(entranceTimer);
  entranceTimer = setTimeout(() => body.classList.remove('entering'), 700);
}

function closeSheet() {
  app.sheetMode = null;
  $('sheet').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
  syncTabs();
}

function showList() {
  openSheet('list', buildList({
    filter: app.listFilter,
    onFilter: (value) => { app.listFilter = value; refreshListRows(); },
  }), 'Objekte');
  refreshListRows();
}

/** Only the rows — the search field above them is never rebuilt. */
function refreshListRows() {
  const container = $('sheet-body').querySelector('.rows');
  if (!container) return;
  const scene = buildScene(true);
  buildListRows(container, scene.bodies, {
    target: app.target,
    onSelect: showDetail,
    deepSky: scene.deepSky,
    onSelectDeepSky: showDeepSkyDetail,
    filter: app.listFilter,
  });
}

function showDeepSkyDetail(id) {
  const scene = buildScene(true);
  const object = scene.deepSky.find((o) => o.id === id);
  if (!object) return;

  const content = buildDeepSkyDetail(
    object,
    findFixedEvents(object.ra, object.dec, app.now(), app.settings.site),
    altitudeSamples({ kind: 'fixed', ra: object.ra, dec: object.dec }),
    {
      isTarget: app.target === id,
      onTarget: () => {
        app.target = app.target === id ? null : id;
        toast(app.target ? `Ziel: ${object.name}` : 'Ziel aufgehoben');
        showDeepSkyDetail(id);
      },
      onShowMap: () => { setMode('map'); closeSheet(); },
    },
  );

  const frag = document.createDocumentFragment();
  frag.appendChild(el('div', { class: 'btnrow' }, [
    el('button', { class: 'btn small ghost', text: '‹ Alle Objekte', onclick: showList }),
  ]));
  frag.appendChild(content);
  openSheet('detail', frag, object.name);
}

function showDetail(id) {
  const scene = buildScene(true);
  const body = scene.bodies.find((b) => b.id === id);
  if (!body) return;

  const extra = { samples: altitudeSamples({ kind: 'body', id }) };
  if (id === 'moon') Object.assign(extra, moonPhaseEvents(app.now(), app.settings.site));
  if (id === 'sun') extra.twilight = buildTwilight(eventsFor('sun'));

  const content = buildDetail(body, eventsFor(id), extra, {
    isTarget: app.target === id,
    onTarget: () => {
      app.target = app.target === id ? null : id;
      toast(app.target ? `Ziel: ${BODIES[id].name}` : 'Ziel aufgehoben');
      showDetail(id);
    },
    onShowMap: () => { setMode('map'); closeSheet(); },
    onCalibrate: () => {
      const offset = app.orientation.calibrateTo(body.az);
      app.setSetting('headingOffset', offset);
      toast(`Kompass geeicht: ${offset.toFixed(1)}° Korrektur`);
      closeSheet();
    },
  });

  const head = el('div', { class: 'btnrow' }, [
    el('button', { class: 'btn small ghost', text: '‹ Alle Objekte', onclick: showList }),
  ]);
  const frag = document.createDocumentFragment();
  frag.appendChild(head);
  frag.appendChild(content);
  openSheet('detail', frag, BODIES[id].name);
}

/**
 * Termine. The search takes a few hundred milliseconds, so the panel opens
 * immediately with a progress line and fills itself in — a spinner nobody
 * asked for is better than a tab that feels broken for half a second.
 */
async function showEvents() {
  const site = app.settings.site;
  const fresh = app.events
    && Date.now() - app.eventsAt < 10 * 60000
    && app.eventsSite === `${site.lat},${site.lon}`;

  if (fresh) {
    renderEvents();
    return;
  }

  const status = el('div', { class: 'note', text: 'Suche Ereignisse …' });
  openSheet('events', status, 'Termine');

  const list = await collectEvents(new Date(), site, {
    years: 2,
    onStage: (label) => { status.textContent = `Suche Ereignisse … ${label}`; },
  });

  app.events = list;
  app.eventsAt = Date.now();
  app.eventsSite = `${site.lat},${site.lon}`;
  if (app.sheetMode === 'events') renderEvents();
}

function renderEvents() {
  openSheet('events', buildEvents(app.events, {
    reference: new Date(),
    onShowSky: (time) => {
      app.setTimeOffset((time.getTime() - Date.now()) / 60000);
      setMode('map');
      closeSheet();
      toast(`Himmel am ${fmtDateTime(time)} — im Zeit-Tab zurück auf „Jetzt“`);
    },
    onTarget: (id) => {
      app.target = id;
      toast(`Ziel: ${BODIES[id].name}`);
    },
  }), 'Termine');
}

// One shared ticker: the countdowns are the only thing in the DOM that has to
// keep moving on its own.
setInterval(() => {
  if (app.sheetMode === 'events') tickCountdowns($('sheet-body'));
}, 1000);

/* ------------------------------------------------------------------ actions */

app.setSetting = (key, value) => {
  app.settings[key] = value;
  saveSettings(app.settings);
  if (key === 'nightMode') $('app').classList.toggle('night', value);
  if (key === 'smoothing') app.orientation.smoothing = value;
  if (key === 'levelHorizon') applyStabilisation();
  if (key === 'camera') value ? startCamera() : stopCamera();
};

/**
 * Keeping the horizon flat is a help right up until the camera is on: the
 * live image tips with the phone, so an overlay that refuses to would slide
 * off the world behind it.
 */
function applyStabilisation() {
  app.orientation.levelHorizon = !!app.settings.levelHorizon && !app.cameraStream;
}

app.setSite = (site) => {
  app.settings.site = { ...app.settings.site, ...site };
  app.eventCache.clear();
  app.events = null;
  saveSettings(app.settings);
  buildScene(true);
};

// A year either way: far enough for any eclipse in the Termine list, close
// enough that the ephemeris stays inside the range its elements are fitted for.
const MAX_OFFSET = 400 * 1440;

app.setTimeOffset = (minutes) => {
  app.timeOffsetMinutes = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, minutes));
  app.eventCache.clear();
  buildScene(true);
};

app.useGps = async () => {
  try {
    const site = await locate();
    app.setSite(site);
    toast(`Standort übernommen (±${Math.round(site.accuracy || 0)} m)`);
    return site;
  } catch (err) {
    toast(err.message);
    return null;
  }
};

app.compassStatusText = () => {
  const o = app.orientation;
  if (o.mode === 'denied') return 'Sensorzugriff abgelehnt — die Ansicht lässt sich mit dem Finger drehen.';
  if (o.mode !== 'sensor') return 'Keine Lagesensoren gefunden — zum Umsehen ziehen (Desktop: auch Pfeiltasten).';
  if (o.compassAccuracy != null) {
    return `Kompass aktiv, gemeldete Genauigkeit ±${Math.round(o.compassAccuracy)}°.` +
      (o.compassAccuracy > 20 ? ' Handy einmal in einer Acht bewegen.' : '');
  }
  return o.absolute
    ? 'Kompass aktiv (Norden vom Gerät). Magnetische Missweisung bleibt möglich.'
    : 'Das Gerät liefert keine Nordreferenz — bitte über ein sichtbares Objekt eichen.';
};

let swapTimer = null;
function setMode(mode) {
  if (app.mode !== mode) {
    // Both views share the one canvas, so there is nothing to slide past
    // anything. A short dip covers the cut instead.
    const view = $('view');
    view.classList.add('swapping');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => view.classList.remove('swapping'), 150);
  }
  app.mode = mode;
  syncTabs();
}

const TABS = {
  'tab-live': () => app.mode === 'live',
  'tab-map': () => app.mode === 'map',
  'tab-list': () => app.sheetMode === 'list' || app.sheetMode === 'detail',
  'tab-events': () => app.sheetMode === 'events',
  'tab-time': () => app.sheetMode === 'time',
  'tab-settings': () => app.sheetMode === 'settings',
};

function syncTabs() {
  for (const id in TABS) $(id).setAttribute('aria-pressed', String(TABS[id]()));

  // Two tabs read as pressed whenever a panel sits over the live view, and the
  // brass mark can only be in one place: put it under the panel if one is
  // open, otherwise under the view. That matches what the last tap changed.
  const panelTab = ['tab-list', 'tab-events', 'tab-time', 'tab-settings'].find((id) => TABS[id]());
  moveBarMark(panelTab || (app.mode === 'map' ? 'tab-map' : 'tab-live'));
}

let markPlaced = false;
function moveBarMark(id) {
  const mark = $('bar-mark');
  const tab = $(id);
  if (!tab || !tab.offsetWidth) { mark.style.opacity = '0'; return; }
  const width = Math.round(tab.offsetWidth * 0.44);
  const x = Math.round(tab.offsetLeft + (tab.offsetWidth - width) / 2);

  // The mark slides between tabs, but it must not slide in from the corner on
  // the first placement, nor skate sideways when the phone is merely rotated.
  const glide = markPlaced && mark.dataset.tab !== undefined && mark.dataset.tab !== id;
  mark.style.transition = glide ? '' : 'none';
  mark.style.opacity = '1';
  mark.style.width = `${width}px`;
  mark.style.transform = `translateX(${x}px)`;
  if (!glide) void mark.offsetWidth;   // land the jump before transitions return
  mark.style.transition = '';
  mark.dataset.tab = id;
  markPlaced = true;
}

let toastTimer = null;
function toast(text) {
  const node = $('toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
}

/* ------------------------------------------------------------------ camera */

async function startCamera() {
  if (app.cameraStream) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    app.cameraStream = stream;
    applyStabilisation();
    const video = $('cam');
    video.srcObject = stream;
    video.classList.add('on');
    await video.play().catch(() => {});
  } catch {
    app.settings.camera = false;
    saveSettings(app.settings);
    toast('Kein Kamerazugriff. Die Ansicht läuft weiter ohne Livebild.');
  }
}

function stopCamera() {
  if (!app.cameraStream) return;
  app.cameraStream.getTracks().forEach((t) => t.stop());
  app.cameraStream = null;
  applyStabilisation();
  const video = $('cam');
  video.srcObject = null;
  video.classList.remove('on');
}

/* -------------------------------------------------------------- interaction */

const pointers = new Map();
let pinchStart = null;
let gesture = null;

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
  if (pointers.size === 1) {
    gesture = { x: ev.clientX, y: ev.clientY, moved: 0, t: performance.now() };
  } else if (pointers.size === 2) {
    pinchStart = { dist: pointerDistance(), fov: app.settings.fov };
  }
});

canvas.addEventListener('pointermove', (ev) => {
  const prev = pointers.get(ev.pointerId);
  if (!prev) return;
  const dx = ev.clientX - prev.x;
  const dy = ev.clientY - prev.y;
  pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

  if (gesture) gesture.moved += Math.hypot(dx, dy);

  if (pointers.size === 2 && pinchStart) {
    const ratio = pinchStart.dist / Math.max(pointerDistance(), 1);
    app.setSetting('fov', Math.max(25, Math.min(110, pinchStart.fov * ratio)));
    return;
  }

  // Dragging only steers when the sensors are not doing it for us.
  if (pointers.size === 1 && !app.orientation.live && app.mode === 'live') {
    const perPx = app.settings.fov / Math.min(cssW, cssH);
    app.orientation.look(-dx * perPx, dy * perPx);
  }
});

function pointerDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function endPointer(ev) {
  const wasTap = gesture && pointers.size === 1 &&
    gesture.moved < 10 && performance.now() - gesture.t < 500;
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) gesture = null;
  if (!wasTap) return;

  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  const hit = [...app.hits]
    .map((h) => ({ ...h, d: Math.hypot(h.x - x, h.y - y) }))
    .filter((h) => h.d <= h.r)
    .sort((a, b) => a.d - b.d)[0];
  if (hit) showDetail(hit.id);
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  app.setSetting('fov', Math.max(25, Math.min(110, app.settings.fov + Math.sign(ev.deltaY) * 3)));
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  const step = ev.shiftKey ? 10 : 3;
  const keys = {
    ArrowLeft: () => app.orientation.look(-step, 0),
    ArrowRight: () => app.orientation.look(step, 0),
    ArrowUp: () => app.orientation.look(0, step),
    ArrowDown: () => app.orientation.look(0, -step),
  };
  if (keys[ev.key] && !app.orientation.live) { keys[ev.key](); ev.preventDefault(); }
  if (ev.key === 'm') setMode(app.mode === 'live' ? 'map' : 'live');
  if (ev.key === 'Escape') closeSheet();
});

/* --------------------------------------------------------------- the panels */

$('tab-live').addEventListener('click', () => { setMode('live'); closeSheet(); });
$('tab-map').addEventListener('click', () => { setMode('map'); closeSheet(); });
$('tab-list').addEventListener('click', () => {
  // From a detail page this is a "back" button, not a toggle.
  app.sheetMode === 'list' ? closeSheet() : showList();
});
$('tab-events').addEventListener('click', () => {
  app.sheetMode === 'events' ? closeSheet() : showEvents();
});
$('tab-time').addEventListener('click', () => {
  app.sheetMode === 'time' ? closeSheet() : openSheet('time', buildTimePanel(app), 'Zeitpunkt');
});
$('tab-settings').addEventListener('click', () => {
  app.sheetMode === 'settings' ? closeSheet() : openSheet('settings', buildSettings(app), 'Einstellungen');
});
$('sheet-close').addEventListener('click', closeSheet);
$('chip-place').addEventListener('click', () => openSheet('settings', buildSettings(app), 'Einstellungen'));

// The list drifts out of date as the sky turns; refresh it gently.
setInterval(() => {
  // Rows only, so a search in progress and the scroll position both survive.
  if (app.sheetMode === 'list') refreshListRows();
}, 5000);

/* ----------------------------------------------------------------- startup */

/**
 * The drift behind the start screen. Decoration, not ephemeris: a scatter of
 * stars that wander a few pixels a minute, breathe a little, and now and then
 * drop a meteor. It runs only while the overlay is up — the real sky needs the
 * frames afterwards.
 */
const startSky = (() => {
  const canvasEl = $('start-sky');
  const g = canvasEl.getContext('2d');
  const stars = [];
  for (let i = 0; i < 110; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * Math.random() * 2.0,
      base: 0.2 + Math.random() * 0.65,
      phase: Math.random() * Math.PI * 2,
      rate: 0.4 + Math.random() * 1.1,
      drift: 0.0016 + Math.random() * 0.0028,
      warm: Math.random() < 0.22,
    });
  }

  let raf = 0, w = 0, h = 0, t0 = 0;
  let meteor = null, nextMeteor = 3.5;

  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvasEl.clientWidth || 1;
    h = canvasEl.clientHeight || 1;
    canvasEl.width = Math.round(w * dpr);
    canvasEl.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (t) => {
    g.clearRect(0, 0, w, h);
    for (const s of stars) {
      // Slow rise, wrapping at the top — the sky turning, more or less.
      const y = ((s.y - t * s.drift) % 1 + 1) % 1;
      const a = s.base * (0.68 + 0.32 * Math.sin(t * s.rate + s.phase));
      g.globalAlpha = Math.max(0, Math.min(1, a));
      g.fillStyle = s.warm ? '#ffd9ac' : '#dbe6ff';
      g.beginPath();
      g.arc(s.x * w, y * h, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    if (meteor) {
      const age = (t - meteor.t0) / meteor.life;
      if (age >= 1) { meteor = null; } else {
        const fade = Math.sin(Math.PI * age);
        const x = meteor.x * w + meteor.dx * age * w;
        const y = meteor.y * h + meteor.dy * age * h;
        const grad = g.createLinearGradient(x, y, x - meteor.dx * 0.09 * w, y - meteor.dy * 0.09 * h);
        grad.addColorStop(0, `rgba(255, 244, 226, ${0.85 * fade})`);
        grad.addColorStop(1, 'rgba(255, 244, 226, 0)');
        g.strokeStyle = grad;
        g.lineWidth = 1.4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - meteor.dx * 0.09 * w, y - meteor.dy * 0.09 * h);
        g.stroke();
      }
    } else if (t > nextMeteor) {
      const dx = -(0.18 + Math.random() * 0.22);
      meteor = {
        t0: t, life: 0.75 + Math.random() * 0.35,
        x: 0.45 + Math.random() * 0.6, y: Math.random() * 0.45,
        dx, dy: -dx * (0.5 + Math.random() * 0.5),
      };
      nextMeteor = t + 6 + Math.random() * 9;
    }
  };

  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    draw((now - t0) / 1000);
  };

  return {
    start() {
      if (raf || !canvasEl.isConnected) return;
      fit();
      window.addEventListener('resize', fit);
      // A still sky for anyone who has asked the system for less movement.
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { draw(0); return; }
      t0 = performance.now();
      raf = requestAnimationFrame(loop);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', fit);
    },
  };
})();

async function begin(withPermissions) {
  // Let the overlay fade before it is taken out of the layout, so the sky
  // underneath is revealed rather than switched on.
  const start = $('start');
  start.classList.add('leaving');
  setTimeout(() => { start.classList.add('hidden'); startSky.stop(); }, 520);

  if (withPermissions) {
    const res = await app.orientation.requestPermission();
    if (res !== 'granted') toast('Ohne Sensorfreigabe: mit dem Finger ziehen zum Umsehen.');
    app.useGps().then((site) => {
      if (site && app.sheetMode === 'settings') openSheet('settings', buildSettings(app), 'Einstellungen');
    });
  } else if (app.settings.site.source === 'default') {
    toast('Bitte den Standort in den Einstellungen eintragen.');
  }

  app.orientation.start();
  if (app.settings.camera) startCamera();
  requestWakeLock();
}

let wakeLock = null;
async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch { /* not available, or denied — the screen may just dim */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!wakeLock) requestWakeLock();
    app.orientation.resnap();
    buildScene(true);
  }
});

$('start-go').addEventListener('click', () => begin(true));
$('start-skip').addEventListener('click', () => begin(false));

app.orientation.addEventListener('modechange', () => {
  if (app.orientation.mode === 'manual') {
    toast('Keine Lagesensoren — zum Umsehen ziehen.');
  }
});

/* Boot. */
app.orientation.smoothing = app.settings.smoothing;
applyStabilisation();
app.orientation.setHeadingOffset(app.settings.headingOffset || 0);
$('app').classList.toggle('night', !!app.settings.nightMode);
resize();
buildScene(true);
syncTabs();
startSky.start();
requestAnimationFrame(frame);

// Handy for poking at the ephemeris from the console.
window.planetenfinder = app;
