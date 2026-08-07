/**
 * Panels, rows and the wording. Everything visible is German; the code around
 * it stays English like the rest of the repo.
 *
 * These builders take plain data plus a handful of callbacks and hand back DOM
 * nodes — no framework, no template strings with user data spliced in.
 */

import { BODIES, DISPLAY_ORDER, compassName, compassShort, moonPhaseName } from './bodies.js';
import { PRESETS, formatCoords } from './geo.js';

/* ------------------------------------------------------------ formatting */

export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
};

const nf = (value, digits = 0) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtTime = (d) =>
  d ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtDateTime = (d) =>
  d.toLocaleString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

/** Rise/set on another day should say so, otherwise the time is a riddle. */
export function fmtClock(d, reference) {
  if (!d) return '—';
  const sameDay = d.toDateString() === reference.toDateString();
  if (sameDay) return fmtTime(d);
  const tomorrow = new Date(reference.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return `${fmtTime(d)} (morgen)`;
  const yesterday = new Date(reference.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return `${fmtTime(d)} (gestern)`;
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDistance(body) {
  if (body.id === 'moon') return `${nf(body.distKm)} km`;
  const km = body.distKm;
  if (km > 1e9) return `${nf(km / 1e9, 2)} Mrd. km`;
  return `${nf(km / 1e6, 1)} Mio. km`;
}

export function fmtLightTime(minutes) {
  if (minutes < 1) return `${nf(minutes * 60, 1)} Lichtsekunden`;
  if (minutes < 90) return `${nf(minutes, 1)} Lichtminuten`;
  return `${nf(minutes / 60, 1)} Lichtstunden`;
}

export const fmtAz = (az) => `${nf(az)}° (${compassName(az)})`;

/** How high, in words that mean something without a protractor. */
export function altitudeWords(alt) {
  if (alt < 0) return 'unter dem Horizont';
  if (alt < 10) return 'sehr tief';
  if (alt < 25) return 'tief';
  if (alt < 50) return 'mittelhoch';
  if (alt < 75) return 'hoch';
  return 'fast im Zenit';
}

/* ------------------------------------------------------------- the list */

export function buildList(bodies, { target, onSelect, sortBy = 'view' }) {
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const ordered = sortBy === 'altitude'
    ? [...bodies].sort((a, b) => b.altApparent - a.altApparent)
    : DISPLAY_ORDER.map((id) => byId.get(id)).filter(Boolean);

  const frag = document.createDocumentFragment();
  for (const body of ordered) {
    const meta = BODIES[body.id];
    const visible = body.aboveHorizon;
    const naked = body.mag < 6.2;

    const state = visible
      ? `${altitudeWords(body.altApparent)} im ${compassName(body.az)}`
      : `${nf(Math.abs(body.altApparent))}° unter dem Horizont`;

    const row = el('div', {
      class: `row${visible ? '' : ' faded'}${body.id === target ? ' active' : ''}`,
      onclick: () => onSelect(body.id),
    }, [
      el('div', { class: 'dot', style: `background:${meta.color};color:${meta.glow}` }),
      el('div', {}, [
        el('div', { class: 'name', text: meta.name }),
        el('div', {
          class: 'meta',
          text: `${state}${naked ? '' : ' · nur optisch'}`,
        }),
      ]),
      el('div', { class: 'right' }, [
        el('b', { text: `${nf(body.altApparent)}°` }),
        el('span', { text: `${compassShort(body.az)} ${nf(body.az)}°` }),
      ]),
    ]);
    frag.appendChild(row);
  }
  return frag;
}

/* ----------------------------------------------------------- the detail */

export function buildDetail(body, events, extra, actions) {
  const meta = BODIES[body.id];
  const frag = document.createDocumentFragment();

  frag.appendChild(el('div', { class: 'note' }, [
    el('b', { text: body.aboveHorizon ? 'Über dem Horizont' : 'Unter dem Horizont' }),
    document.createTextNode(
      body.aboveHorizon
        ? ` — ${altitudeWords(body.altApparent)}, ${compassName(body.az)}.`
        : ' — gerade nicht zu sehen. Der Marker zeigt trotzdem die Richtung.',
    ),
  ]));

  const kv = (label, value) => el('div', { class: 'kv' }, [
    document.createTextNode(label), el('b', { text: value }),
  ]);

  const grid = el('div', { class: 'grid2' }, [
    kv('Höhe', `${nf(body.altApparent, 1)}°`),
    kv('Richtung', fmtAz(body.az)),
    kv('Helligkeit', `${nf(body.mag, 1)} mag`),
    kv('Entfernung', fmtDistance(body)),
    kv('Lichtlaufzeit', fmtLightTime(body.lightMinutes)),
    kv('Scheinbarer Durchmesser', body.angularDiameter > 120
      ? `${nf(body.angularDiameter / 60, 1)}′`
      : `${nf(body.angularDiameter, 1)}″`),
  ]);
  frag.appendChild(grid);

  if (body.id === 'moon') {
    frag.appendChild(el('h3', { text: 'Phase' }));
    frag.appendChild(el('div', { class: 'grid2' }, [
      kv('Aktuell', moonPhaseName(body.illuminated, body.waxing)),
      kv('Beleuchtet', `${nf(body.illuminated * 100)} %`),
      kv('Nächster Vollmond', extra.fullMoon ? fmtDateTime(extra.fullMoon) : '—'),
      kv('Nächster Neumond', extra.newMoon ? fmtDateTime(extra.newMoon) : '—'),
    ]));
  } else if (['mercury', 'venus', 'mars'].includes(body.id)) {
    frag.appendChild(el('div', { class: 'grid2' }, [
      kv('Beleuchtet', `${nf(body.illuminated * 100)} %`),
      kv('Phasenwinkel', `${nf(body.phase)}°`),
    ]));
  }

  frag.appendChild(el('h3', { text: 'Heute' }));
  if (events.neverRises) {
    frag.appendChild(el('div', { class: 'note', text: 'Geht von deinem Standort aus im Moment gar nicht auf.' }));
  } else if (events.circumpolar) {
    frag.appendChild(el('div', { class: 'note', text: 'Steht dauerhaft über dem Horizont (zirkumpolar).' }));
  } else {
    // Above the horizon, the interesting rise already happened.
    const rise = body.aboveHorizon ? (events.lastRise || events.nextRise) : events.nextRise;
    const set = body.aboveHorizon ? (events.nextSet || events.lastSet) : events.nextSet;
    frag.appendChild(el('div', { class: 'grid2' }, [
      kv(body.aboveHorizon ? 'Aufgegangen' : 'Aufgang', fmtClock(rise, body.date)),
      kv('Untergang', fmtClock(set, body.date)),
      kv('Höchststand', fmtClock(events.transit, body.date)),
      kv('Höhe dabei', `${nf(events.maxAltitude, 1)}°`),
    ]));
  }

  if (extra.twilight) frag.appendChild(extra.twilight);

  frag.appendChild(el('div', { class: 'btnrow' }, [
    el('button', {
      class: 'btn small primary',
      text: actions.isTarget ? 'Ziel aufheben' : 'Als Ziel setzen',
      onclick: actions.onTarget,
    }),
    el('button', { class: 'btn small ghost', text: 'Auf der Karte zeigen', onclick: actions.onShowMap }),
    body.aboveHorizon
      ? el('button', {
        class: 'btn small ghost',
        text: 'Kompass hierauf eichen',
        onclick: actions.onCalibrate,
      })
      : null,
  ]));

  frag.appendChild(el('div', { class: 'note', text: meta.facts }));
  if (meta.note) frag.appendChild(el('div', { class: 'note warn', text: meta.note }));

  return frag;
}

/** Sun twilight block, appended into the Sun's detail view. */
export function buildTwilight(sun) {
  const pick = (key, rising) =>
    sun.events.find((e) => e.key === key && e.rising === rising)?.time || null;
  const ref = new Date();
  const kv = (label, value) => el('div', { class: 'kv' }, [
    document.createTextNode(label), el('b', { text: value }),
  ]);
  return el('div', {}, [
    el('h3', { text: 'Dämmerung' }),
    el('div', { class: 'grid2' }, [
      kv('Bürgerlich (Ende)', fmtClock(pick('civil', false), ref)),
      kv('Nautisch (Ende)', fmtClock(pick('nautical', false), ref)),
      kv('Astronomisch (Ende)', fmtClock(pick('astronomical', false), ref)),
      kv('Astronomisch (Beginn)', fmtClock(pick('astronomical', true), ref)),
    ]),
    el('div', {
      class: 'note',
      text: 'Richtig dunkel — und damit gut für Uranus, Neptun und die Milchstraße — '
        + 'ist es zwischen Ende und Beginn der astronomischen Dämmerung.',
    }),
  ]);
}

/* -------------------------------------------------------------- Termine */

/**
 * Countdown wording. Seconds only appear inside a day, where they mean
 * something — a ticking seconds field on a countdown of eight months is
 * decoration, not information.
 */
export function countdownText(ms, precise = false) {
  if (ms <= 0) return 'jetzt';
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');

  // The card at the top runs to the second whatever the distance — that is
  // the whole point of a countdown to an eclipse. The rows below stay coarse,
  // because sixty of them ticking is noise.
  if (precise && days >= 1) {
    return `${days} ${days === 1 ? 'Tag' : 'Tage'} ${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  }
  if (days >= 2) return `in ${days} Tagen ${hours} h`;
  if (days === 1) return `in 1 Tag ${hours} h`;
  if (hours >= 1) return `in ${hours}:${pad(mins)}:${pad(secs)} h`;
  if (mins >= 1) return `in ${mins}:${pad(secs)} min`;
  return `in ${secs} s`;
}

const ECLIPSE_KIND = {
  total: 'total', annular: 'ringförmig', partial: 'partiell', penumbral: 'Halbschatten',
};

/** Title, detail line and colour for one event. */
export function describeEvent(e) {
  const body = (id) => BODIES[id]?.name || id;
  const colour = (id) => BODIES[id]?.color || '#9fb6d4';

  switch (e.key) {
    case 'solar-eclipse': {
      const title = e.kind === 'none'
        ? 'Sonnenfinsternis (hier nicht sichtbar)'
        : `Sonnenfinsternis, ${ECLIPSE_KIND[e.kind]}`;
      const detail = e.kind === 'none'
        ? 'Findet statt, aber von deinem Standort aus nicht zu sehen.'
        : `${nf(e.covered * 100)} % der Sonnenfläche bedeckt · Sonne ${nf(e.sunAltitude)}° hoch`
          + (e.sunAltitude < 0 ? ' — leider schon untergegangen' : '')
          + (e.begins && e.ends ? ` · ${fmtTime(e.begins)} bis ${fmtTime(e.ends)}` : '');
      return { title, detail, colour: colour('sun'), major: e.kind !== 'none', warn: e.kind !== 'none' };
    }
    case 'lunar-eclipse':
      return {
        title: `Mondfinsternis, ${ECLIPSE_KIND[e.kind]}`,
        detail: e.visible
          ? `Mond steht dabei ${nf(e.moonAltitude)}° hoch im ${compassName(e.moonAzimuth)}`
          : 'Von hier aus nicht zu sehen — der Mond ist dann unter dem Horizont.',
        colour: colour('moon'), major: e.visible,
      };
    case 'opposition':
      return {
        title: `${body(e.id)} in Opposition`,
        detail: `Die ganze Nacht sichtbar und so hell wie das Jahr über nicht mehr: `
          + `${nf(e.magnitude, 1)} mag, ${nf(e.distanceAu, 2)} AE entfernt.`,
        colour: colour(e.id), major: true,
      };
    case 'elongation':
      return {
        title: `${body(e.id)} im größten Abstand zur Sonne`,
        detail: `${nf(e.separation, 1)}° ${e.east ? 'östlich — am Abendhimmel' : 'westlich — am Morgenhimmel'}`
          + `, ${nf(e.magnitude, 1)} mag. Die beste Gelegenheit dieser Sichtbarkeit.`,
        colour: colour(e.id), major: e.id === 'mercury',
      };
    case 'conjunction': {
      const [a, b] = e.ids;
      const title = e.occultation
        ? `${body(a)} bedeckt ${body(b)}`
        : `${body(a)} trifft ${body(b)}`;
      const detail = `${nf(e.separation, 1)}° Abstand`
        + (e.bestTime
          ? ` · am besten ${fmtClock(e.bestTime, new Date())} bei ${nf(e.bestAltitude)}° Höhe`
          : ' · steht in der Dunkelheit leider zu tief');
      return { title, detail, colour: colour(a), major: e.separation < 1 || e.occultation };
    }
    case 'meteors': {
      // The peak is a night, not an instant, and its date is a long-term
      // average — the only entry in this list that is not computed, so it is
      // the only one that says so.
      const eve = new Date(e.time.getTime() - 6 * 3600000);
      return {
        title: `${e.name} — Sternschnuppen`,
        detail: `Maximum in der Nacht vom ${eve.getDate()}. auf den ${e.time.getDate()}., `
          + `bis zu ${e.rate} pro Stunde. `
          + (e.moonSpoils
            ? `Der Mond ist zu ${nf(e.moonIllumination * 100)} % beleuchtet und stört.`
            : `Der Mond stört kaum (${nf(e.moonIllumination * 100)} % beleuchtet).`)
          + ' Richtwert, das Maximum schwankt um etwa einen Tag.',
        colour: '#b6c7e6', major: !e.moonSpoils && e.rate >= 100,
      };
    }
    case 'new': case 'full': case 'first': case 'last':
      return { title: e.title, detail: e.note, colour: colour('moon') };
    default:
      return { title: e.title, detail: e.note || '', colour: '#9fb6d4' };
  }
}

/**
 * The Termine panel. Rows carry a `data-at` timestamp so the countdown can be
 * refreshed once a second without rebuilding any of this.
 */
export function buildEvents(events, { onShowSky, onTarget, reference }) {
  const frag = document.createDocumentFragment();

  if (!events.length) {
    frag.appendChild(el('div', { class: 'note', text: 'Keine Ereignisse gefunden.' }));
    return frag;
  }

  // The card at the top is for the thing worth waiting for. The next event
  // is usually a sunset, and a countdown to a sunset is not why anyone opens
  // this panel — so a highlight wins, and only if there is none does the
  // plain next event take the spot.
  const next = events.find((e) => describeEvent(e).major) || events[0];
  const lead = describeEvent(next);

  const hero = el('div', { class: 'hero' }, [
    el('div', { class: 'hero-label', text: lead.major ? 'Nächstes Highlight' : 'Als Nächstes' }),
    el('div', { class: 'hero-title', text: lead.title }),
    el('div', {
      class: 'hero-count countdown',
      'data-at': String(next.time.getTime()),
      'data-precise': '1',
      text: countdownText(next.time - Date.now(), true),
    }),
    el('div', { class: 'hero-when', text: fmtDateTime(next.time) + ' Uhr' }),
    el('div', { class: 'hero-detail', text: lead.detail }),
  ]);
  frag.appendChild(hero);

  let heading = null;
  for (const e of events) {
    const group = groupFor(e.time, reference);
    if (group !== heading) {
      heading = group;
      frag.appendChild(el('h3', { text: group }));
    }

    const d = describeEvent(e);
    const row = el('div', { class: `row event${d.major ? ' major' : ''}` }, [
      el('div', { class: 'dot', style: `background:${d.colour};color:${d.colour}` }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'name', text: d.title }),
        el('div', { class: 'meta', text: d.detail }),
        el('div', { class: 'when', text: `${fmtDateTime(e.time)} Uhr` }),
      ]),
      el('div', { class: 'right' }, [
        el('b', {
          class: 'countdown',
          'data-at': String(e.time.getTime()),
          text: countdownText(e.time - Date.now()),
        }),
      ]),
    ]);

    row.addEventListener('click', () => {
      const open = row.nextSibling?.classList?.contains('actions');
      document.querySelectorAll('.actions').forEach((n) => n.remove());
      if (open) return;

      const ids = e.ids || (e.id ? [e.id] : []);
      const actions = el('div', { class: 'actions btnrow' }, [
        el('button', {
          class: 'btn small primary', text: 'Himmel zu dieser Zeit',
          onclick: () => onShowSky(e.time),
        }),
        ...ids.map((id) => el('button', {
          class: 'btn small ghost', text: `${BODIES[id]?.name || id} als Ziel`,
          onclick: () => onTarget(id),
        })),
      ]);
      row.after(actions);
    });

    frag.appendChild(row);
  }

  frag.appendChild(el('div', {
    class: 'note',
    text: 'Alle Zeiten für deinen Standort und in deiner Zeitzone, aus derselben '
      + 'Rechnung wie die Himmelsansicht. Finsternisse, Oppositionen und '
      + 'Begegnungen sind nicht nachgeschlagen, sondern ausgerechnet — deshalb '
      + 'steht dabei, was von hier aus davon zu sehen ist. Einzige Ausnahme sind '
      + 'die Sternschnuppenströme: die lassen sich nicht aus Bahnen ableiten und '
      + 'stehen als Mittelwerte in einer Tabelle.',
  }));

  return frag;
}

function groupFor(time, reference) {
  const days = (time - reference) / 86400000;
  if (time.toDateString() === reference.toDateString()) return 'Heute';
  if (days < 2) return 'Morgen';
  if (days < 8) return 'Diese Woche';
  if (days < 32) return 'Diesen Monat';
  if (days < 190) return 'Die nächsten Monate';
  return 'Später';
}

/** Called once a second while the panel is open. */
export function tickCountdowns(root) {
  const now = Date.now();
  for (const node of root.querySelectorAll('.countdown')) {
    node.textContent = countdownText(Number(node.dataset.at) - now, !!node.dataset.precise);
  }
}

/* ----------------------------------------------------------- time panel */

export function buildTimePanel(app) {
  const frag = document.createDocumentFragment();
  const readout = el('div', { class: 'note' });
  const slider = el('input', { type: 'range', step: '5' });

  // The slider spans a day either side of wherever the clock currently sits,
  // rather than a day either side of now — otherwise jumping to an eclipse
  // eight months out would leave the control unable to represent its own
  // position, and the first touch would yank the sky back to today.
  const sync = () => {
    const off = Math.round(app.timeOffsetMinutes);
    readout.textContent = off === 0
      ? `Jetzt — ${fmtDateTime(app.now())}`
      : `${fmtDateTime(app.now())} (${describeOffset(off)})`;
    slider.min = String(off - 1440);
    slider.max = String(off + 1440);
    slider.value = String(off);
  };

  slider.addEventListener('input', () => {
    app.setTimeOffset(Number(slider.value));
    sync();
  });

  const jump = (minutes, label) => el('button', {
    class: 'btn small ghost', text: label,
    onclick: () => { app.setTimeOffset(app.timeOffsetMinutes + minutes); sync(); },
  });

  frag.appendChild(el('h3', { text: 'Zeitpunkt' }));
  frag.appendChild(readout);
  frag.appendChild(el('div', { class: 'field' }, [
    el('label', { text: '−24 h … +24 h' }), slider,
  ]));
  frag.appendChild(el('div', { class: 'btnrow' }, [
    jump(-1440, '−1 Tag'), jump(-60, '−1 h'), jump(-10, '−10 min'),
    el('button', {
      class: 'btn small primary', text: 'Jetzt',
      onclick: () => { app.setTimeOffset(0); sync(); },
    }),
    jump(10, '+10 min'), jump(60, '+1 h'), jump(1440, '+1 Tag'),
  ]));
  frag.appendChild(el('div', {
    class: 'note',
    text: 'Verschiebt den Himmel in der Zeit — praktisch, um zu sehen, wann ein Planet '
      + 'hoch genug steht. Die Live-Ansicht folgt weiter deiner Blickrichtung. '
      + 'Aus den Terminen heraus springt die Zeit auch weiter, bis zu einem Jahr.',
  }));
  sync();
  return frag;
}

/** "+3,5 h", "in 12 Tagen", "vor 2 Monaten" — for the time readout. */
function describeOffset(minutes) {
  const abs = Math.abs(minutes);
  const ahead = minutes > 0;
  if (abs < 90) return `${ahead ? '+' : '−'}${nf(abs)} min`;
  if (abs < 1440) return `${ahead ? '+' : '−'}${nf(abs / 60, 1)} h`;
  if (abs < 60 * 1440) return `${ahead ? 'in ' : 'vor '}${nf(abs / 1440)} Tagen`;
  return `${ahead ? 'in ' : 'vor '}${nf(abs / 1440 / 30.44, 1)} Monaten`;
}

/* ------------------------------------------------------- settings panel */

export function buildSettings(app) {
  const s = app.settings;
  const frag = document.createDocumentFragment();

  const toggle = (key, label, hint) => el('div', { class: 'field' }, [
    el('label', {}, [
      document.createTextNode(label),
      hint ? el('small', { text: hint }) : null,
    ]),
    el('span', { class: 'switch' }, [
      el('input', {
        type: 'checkbox', ...(s[key] ? { checked: 'checked' } : {}),
        onchange: (ev) => app.setSetting(key, ev.target.checked),
      }),
      el('span', {}),
    ]),
  ]);

  /* ------------------------------------------------------------ place */

  frag.appendChild(el('h3', { text: 'Standort' }));
  const placeInfo = el('div', { class: 'note', text: `${s.site.label} · ${formatCoords(s.site)}` });
  frag.appendChild(placeInfo);

  const latInput = el('input', { type: 'number', step: '0.0001', value: String(s.site.lat) });
  const lonInput = el('input', { type: 'number', step: '0.0001', value: String(s.site.lon) });
  const elevInput = el('input', { type: 'number', step: '1', value: String(Math.round(s.site.elevation || 0)) });

  frag.appendChild(el('div', { class: 'btnrow' }, [
    el('button', {
      class: 'btn small primary', text: 'GPS verwenden',
      onclick: async (ev) => {
        ev.target.textContent = 'Suche …';
        const site = await app.useGps();
        ev.target.textContent = 'GPS verwenden';
        if (site) {
          latInput.value = site.lat.toFixed(4);
          lonInput.value = site.lon.toFixed(4);
          elevInput.value = String(Math.round(site.elevation || 0));
          placeInfo.textContent = `${site.label} · ${formatCoords(site)}`;
        }
      },
    }),
  ]));

  const preset = el('select', {
    onchange: (ev) => {
      const p = PRESETS[Number(ev.target.value)];
      if (!p) return;
      latInput.value = String(p.lat);
      lonInput.value = String(p.lon);
      elevInput.value = String(p.elevation);
      app.setSite({ ...p, source: 'preset' });
      placeInfo.textContent = `${p.label} · ${formatCoords(p)}`;
    },
  }, [el('option', { value: '', text: 'Ort wählen …' })].concat(
    PRESETS.map((p, i) => el('option', { value: String(i), text: p.label })),
  ));
  frag.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Voreinstellung' }), preset]));

  const applyManual = () => {
    app.setSite({
      lat: Number(latInput.value), lon: Number(lonInput.value),
      elevation: Number(elevInput.value) || 0,
      label: 'Eigener Ort', source: 'manual', accuracy: null,
    });
    placeInfo.textContent = `Eigener Ort · ${formatCoords(app.settings.site)}`;
  };
  latInput.addEventListener('change', applyManual);
  lonInput.addEventListener('change', applyManual);
  elevInput.addEventListener('change', applyManual);

  frag.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Breite (°N)' }), latInput]));
  frag.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Länge (°O)' }), lonInput]));
  frag.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Höhe (m)' }), elevInput]));

  /* ---------------------------------------------------------- compass */

  frag.appendChild(el('h3', { text: 'Kompass' }));
  frag.appendChild(el('div', { class: 'note', text: app.compassStatusText() }));

  const offsetValue = el('b', { text: `${nf(app.orientation.headingOffset, 1)}°` });
  const offsetSlider = el('input', {
    type: 'range', min: '-45', max: '45', step: '0.5',
    value: String(app.orientation.headingOffset),
    oninput: (ev) => {
      app.orientation.setHeadingOffset(Number(ev.target.value));
      app.setSetting('headingOffset', Number(ev.target.value));
      offsetValue.textContent = `${nf(Number(ev.target.value), 1)}°`;
    },
  });
  frag.appendChild(el('div', { class: 'field' }, [
    el('label', {}, [
      document.createTextNode('Korrektur'),
      el('small', { text: 'gegen Missweisung und Magnetfelder in der Nähe' }),
    ]),
    offsetSlider,
  ]));
  frag.appendChild(el('div', { class: 'field' }, [
    el('label', { text: 'Aktuell' }), offsetValue,
  ]));
  frag.appendChild(el('div', { class: 'btnrow' }, [
    el('button', {
      class: 'btn small ghost', text: 'Korrektur zurücksetzen',
      onclick: () => {
        app.orientation.setHeadingOffset(0);
        app.setSetting('headingOffset', 0);
        offsetSlider.value = '0';
        offsetValue.textContent = '0,0°';
      },
    }),
  ]));
  frag.appendChild(el('div', {
    class: 'note',
    text: 'Am genauesten wird es so: ein Objekt, das du wirklich siehst — Mond, Venus, '
      + 'die Sonne — in die Bildmitte nehmen, in der Objektliste antippen und dort auf '
      + '„Kompass hierauf eichen“. Danach stimmt auch alles andere.',
  }));

  /* ------------------------------------------------------------- view */

  frag.appendChild(el('h3', { text: 'Ansicht' }));
  frag.appendChild(toggle('camera', 'Kamerabild', 'Planeten über das Livebild legen'));
  frag.appendChild(toggle('stars', 'Sterne'));
  frag.appendChild(toggle('constellations', 'Sternbilder'));
  frag.appendChild(toggle('grid', 'Gradnetz'));
  frag.appendChild(toggle('labels', 'Beschriftungen'));
  frag.appendChild(toggle('belowHorizon', 'Untergegangene zeigen', 'gedimmt, mit Richtung'));
  frag.appendChild(toggle('mapHeadingUp', 'Karte in Blickrichtung drehen'));
  frag.appendChild(toggle('nightMode', 'Nachtmodus (rot)', 'schont die Dunkeladaption der Augen'));
  frag.appendChild(toggle('levelHorizon', 'Horizont waagrecht halten',
    'ruhigeres Bild; beim Kamerabild automatisch aus'));
  frag.appendChild(toggle('smoothing', 'Bewegung glätten'));

  const fovValue = el('b', { text: `${nf(s.fov)}°` });
  frag.appendChild(el('div', { class: 'field' }, [
    el('label', {}, [
      document.createTextNode('Sichtfeld'),
      el('small', { text: 'kleiner = stärker gezoomt' }),
    ]),
    el('input', {
      type: 'range', min: '25', max: '110', step: '1', value: String(s.fov),
      oninput: (ev) => {
        app.setSetting('fov', Number(ev.target.value));
        fovValue.textContent = `${nf(Number(ev.target.value))}°`;
      },
    }),
  ]));
  frag.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Aktuell' }), fovValue]));

  /* ------------------------------------------------------------ about */

  frag.appendChild(el('h3', { text: 'Genauigkeit' }));
  frag.appendChild(el('div', {
    class: 'note',
    text: 'Die Positionen selbst stimmen auf Bogenminuten genau — deutlich besser, als '
      + 'man mit bloßem Auge unterscheiden kann. Die Unsicherheit steckt fast '
      + 'vollständig im Magnetkompass des Handys: 5° bis 15° Fehler sind normal, in '
      + 'Gebäuden und an Autos mehr. Deshalb die Eichfunktion oben.',
  }));
  frag.appendChild(el('div', {
    class: 'note',
    text: 'Rechengrundlage: Bahnelemente des JPL für die Planeten, gekürzte Mondtheorie, '
      + 'dazu Lichtlaufzeit, Präzession, Nutation, Parallaxe und Refraktion. Alles '
      + 'offline im Gerät.',
  }));

  return frag;
}
