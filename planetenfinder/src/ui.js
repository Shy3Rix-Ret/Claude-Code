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

/* ----------------------------------------------------------- time panel */

export function buildTimePanel(app) {
  const frag = document.createDocumentFragment();
  const readout = el('div', { class: 'note' });
  const slider = el('input', {
    type: 'range', min: '-1440', max: '1440', step: '5',
    value: String(Math.round(app.timeOffsetMinutes)),
  });

  const sync = () => {
    const off = app.timeOffsetMinutes;
    readout.textContent = off === 0
      ? `Jetzt — ${fmtDateTime(app.now())}`
      : `${fmtDateTime(app.now())} (${off > 0 ? '+' : ''}${nf(off / 60, 1)} h)`;
    slider.value = String(Math.round(off));
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
      + 'hoch genug steht. Die Live-Ansicht folgt weiter deiner Blickrichtung.',
  }));
  sync();
  return frag;
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
