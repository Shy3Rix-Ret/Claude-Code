/**
 * Termine — what the sky is going to do next, and exactly when.
 *
 * Everything here is derived from the same ephemeris the views use, so a
 * countdown and the sky it counts towards can never disagree. Nothing is
 * looked up; eclipses in particular are found rather than tabulated, which is
 * why they carry local circumstances — the same eclipse is total in Iceland,
 * a deep partial in Zürich, and nothing at all in Sydney.
 *
 * The search is deliberately staged from cheap to expensive: a coarse pass
 * finds the candidate moments, and only those get the fine scan.
 */

import { bodyState, angularSeparation, norm360, norm180, findEvents, sunEvents } from './astro.js';
import { DISPLAY_ORDER } from './bodies.js';

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;

// Eclipse geometry belongs to the Earth as a whole, so those calls pass
// { topocentric: false } and this stand-in place is never actually used.
const GEOCENTRE = { lat: 0, lon: 0, elevation: 0 };

const geo = (id, t) => bodyState(id, new Date(t), GEOCENTRE, { topocentric: false });
const at = (id, t, site) => bodyState(id, new Date(t), site);

/** Degrees of the disc, from the arcseconds the ephemeris reports. */
const radiusOf = (body) => body.angularDiameter / 7200;

/* ------------------------------------------------------------ moon phases */

const PHASE_NAMES = {
  0: { key: 'new', title: 'Neumond', note: 'Dunkelster Himmel des Monats — beste Zeit für schwache Objekte.' },
  90: { key: 'first', title: 'Erstes Viertel', note: 'Halbmond am Abendhimmel. Krater am Terminator stehen scharf.' },
  180: { key: 'full', title: 'Vollmond', note: 'Der Mond überstrahlt die ganze Nacht.' },
  270: { key: 'last', title: 'Letztes Viertel', note: 'Halbmond am Morgenhimmel.' },
};

/** Elongation of the Moon from the Sun in ecliptic longitude, 0…360°. */
function moonPhaseAngle(t) {
  return norm360(geo('moon', t).eclLon - geo('sun', t).eclLon);
}

/**
 * Every new moon, quarter and full moon in the window. One coarse pass over
 * the whole period feeds all four phases, which is four times cheaper than
 * hunting them separately.
 */
export function moonPhases(from, days) {
  const step = 6 * HOUR;
  const out = [];
  let prev = moonPhaseAngle(from);

  for (let t = from + step; t <= from + days * DAY; t += step) {
    const cur = moonPhaseAngle(t);
    for (const target of [0, 90, 180, 270]) {
      const a = norm180(prev - target);
      const b = norm180(cur - target);
      if (a < 0 && b >= 0 && Math.abs(a) < 90) {
        let lo = t - step, hi = t;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          if (norm180(moonPhaseAngle(mid) - target) < 0) lo = mid; else hi = mid;
        }
        out.push({ time: new Date((lo + hi) / 2), ...PHASE_NAMES[target] });
      }
    }
    prev = cur;
  }
  return out;
}

/* -------------------------------------------------------------- eclipses */

/** Overlap of two discs as a fraction of the first one's area. */
function overlapFraction(sep, r, R) {
  if (sep >= r + R) return 0;
  if (sep <= Math.abs(R - r)) return Math.min(1, (R * R) / (r * r));
  const d = sep;
  const a = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r))
          + R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R))
          - 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return a / (Math.PI * r * r);
}

/** Sun-Moon separation as seen from `site` (or from the Earth's centre). */
function sunMoonGap(t, site, topo) {
  const sun = topo ? at('sun', t, site) : geo('sun', t);
  const moon = topo ? at('moon', t, site) : geo('moon', t);
  return {
    sep: angularSeparation(sun.ra, sun.dec, moon.ra, moon.dec),
    sun, moon,
  };
}

/**
 * Solar eclipses around each new moon.
 *
 * The filter is the Moon's ecliptic latitude: more than about 1.6° off the
 * ecliptic and the shadow misses the Earth entirely, which throws away five
 * new moons out of six before any real work happens.
 */
export function solarEclipses(newMoons, site) {
  const out = [];

  for (const phase of newMoons) {
    const t0 = phase.time.getTime();
    if (Math.abs(geo('moon', t0).eclLat) > 1.6) continue;

    // Does it touch the Earth at all? Half a degree of discs plus up to a
    // degree of parallax is the widest an observer anywhere could reach.
    let globalBest = null;
    for (let t = t0 - 3 * HOUR; t <= t0 + 3 * HOUR; t += 5 * MIN) {
      const g = sunMoonGap(t, site, false);
      if (!globalBest || g.sep < globalBest.sep) globalBest = { t, ...g };
    }
    if (globalBest.sep > radiusOf(globalBest.sun) + radiusOf(globalBest.moon) + 1.05) continue;

    // Local circumstances: the same eclipse, seen from here.
    let best = null;
    for (let t = t0 - 4 * HOUR; t <= t0 + 4 * HOUR; t += MIN) {
      const g = sunMoonGap(t, site, true);
      if (!best || g.sep < best.sep) best = { t, ...g };
    }
    for (let t = best.t - MIN; t <= best.t + MIN; t += 2000) {
      const g = sunMoonGap(t, site, true);
      if (g.sep < best.sep) best = { t, ...g };
    }

    const sunR = radiusOf(best.sun);
    const moonR = radiusOf(best.moon);
    const limit = sunR + moonR;
    const covered = overlapFraction(best.sep, sunR, moonR);

    let kind = 'none';
    if (best.sep < Math.abs(moonR - sunR)) kind = moonR >= sunR ? 'total' : 'annular';
    else if (best.sep < limit) kind = 'partial';

    // Contact times, by bisection against the sample either side of maximum.
    const contact = (dir) => {
      let inside = best.t;
      let outside = best.t + dir * 4 * HOUR;
      if (sunMoonGap(outside, site, true).sep < limit) return null;
      for (let k = 0; k < 24; k++) {
        const mid = (inside + outside) / 2;
        if (sunMoonGap(mid, site, true).sep < limit) inside = mid; else outside = mid;
      }
      return new Date((inside + outside) / 2);
    };

    out.push({
      key: 'solar-eclipse',
      ids: ['sun'],
      time: new Date(best.t),
      kind,
      visible: kind !== 'none' && best.sun.altApparent > -0.5,
      covered,
      magnitude: Math.max(0, (limit - best.sep) / (2 * sunR)),
      sunAltitude: best.sun.altApparent,
      sunAzimuth: best.sun.az,
      begins: kind === 'none' ? null : contact(-1),
      ends: kind === 'none' ? null : contact(1),
      globalTime: new Date(globalBest.t),
    });
  }
  return out;
}

/**
 * Lunar eclipses around each full moon. The shadow radii follow the classical
 * construction: the Moon's own parallax, plus the Sun's, minus (umbra) or
 * plus (penumbra) the solar semidiameter, enlarged by 2 % for the Earth's
 * atmosphere.
 */
export function lunarEclipses(fullMoons, site) {
  const out = [];

  for (const phase of fullMoons) {
    const t0 = phase.time.getTime();
    if (Math.abs(geo('moon', t0).eclLat) > 1.6) continue;

    const gap = (t) => {
      const sun = geo('sun', t);
      const moon = geo('moon', t);
      // The shadow sits exactly opposite the Sun.
      return {
        sep: angularSeparation(moon.ra, moon.dec, norm360(sun.ra + 180), -sun.dec),
        sun, moon,
      };
    };

    let best = null;
    for (let t = t0 - 4 * HOUR; t <= t0 + 4 * HOUR; t += MIN) {
      const g = gap(t);
      if (!best || g.sep < best.sep) best = { t, ...g };
    }

    const moonParallax = Math.asin(6378.14 / best.moon.distKm) * (180 / Math.PI);
    const sunParallax = 0.002443 / best.sun.distAu;
    const sunR = radiusOf(best.sun);
    const moonR = radiusOf(best.moon);
    const umbra = 1.02 * (moonParallax + sunParallax - sunR);
    const penumbra = 1.02 * (moonParallax + sunParallax + sunR);

    let kind = 'none';
    if (best.sep < umbra - moonR) kind = 'total';
    else if (best.sep < umbra + moonR) kind = 'partial';
    else if (best.sep < penumbra + moonR) kind = 'penumbral';
    if (kind === 'none') continue;

    // Unlike a solar eclipse this one is visible from the whole night side,
    // so the only local question is whether the Moon is up.
    const local = at('moon', best.t, site);

    out.push({
      key: 'lunar-eclipse',
      ids: ['moon'],
      time: new Date(best.t),
      kind,
      visible: local.altApparent > 0,
      moonAltitude: local.altApparent,
      moonAzimuth: local.az,
      umbralDepth: Math.max(0, (umbra + moonR - best.sep) / (2 * moonR)),
    });
  }
  return out;
}

/* ------------------------------------------------- planets worth catching */

const OUTER = ['mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const INNER = ['mercury', 'venus'];

/**
 * Oppositions — a planet opposite the Sun, so it rises at sunset, stands
 * highest at midnight and is at its closest and brightest of the year. For
 * anyone with a telescope this is the date that matters.
 */
export function oppositions(from, days) {
  const out = [];
  const step = 2 * DAY;

  for (const id of OUTER) {
    const diff = (t) => norm180(geo(id, t).eclLon - geo('sun', t).eclLon - 180);
    let prev = diff(from);
    for (let t = from + step; t <= from + days * DAY; t += step) {
      const cur = diff(t);
      // The Sun gains about a degree a day on any outer planet, so this
      // difference runs *down* through opposition, not up. Watching for the
      // rising crossing found nothing at all.
      if (prev > 0 && cur <= 0 && Math.abs(prev) < 90) {
        let lo = t - step, hi = t;
        for (let k = 0; k < 24; k++) {
          const mid = (lo + hi) / 2;
          if (diff(mid) > 0) lo = mid; else hi = mid;
        }
        const when = (lo + hi) / 2;
        const body = geo(id, when);
        out.push({
          key: 'opposition', id, time: new Date(when),
          magnitude: body.mag, distanceAu: body.distAu,
        });
      }
      prev = cur;
    }
  }
  return out;
}

/**
 * Greatest elongation — the only times Mercury and Venus stand far enough
 * from the Sun to be comfortable. East means the evening sky, west the
 * morning.
 */
export function greatestElongations(from, days) {
  const out = [];
  const step = DAY;

  for (const id of INNER) {
    const elong = (t) => {
      const b = geo(id, t);
      const s = geo('sun', t);
      return {
        sep: angularSeparation(b.ra, b.dec, s.ra, s.dec),
        east: norm180(b.eclLon - s.eclLon) > 0,
      };
    };

    let a = elong(from).sep;
    let b = elong(from + step).sep;
    for (let t = from + 2 * step; t <= from + days * DAY; t += step) {
      const c = elong(t).sep;
      if (b > a && b >= c) {
        // Refine the peak by golden-section on the bracketing triple.
        let lo = t - 2 * step, hi = t;
        for (let k = 0; k < 30; k++) {
          const m1 = lo + (hi - lo) * 0.382;
          const m2 = lo + (hi - lo) * 0.618;
          if (elong(m1).sep > elong(m2).sep) hi = m2; else lo = m1;
        }
        const when = (lo + hi) / 2;
        const peak = elong(when);
        out.push({
          key: 'elongation', id, time: new Date(when),
          separation: peak.sep, east: peak.east,
          magnitude: geo(id, when).mag,
        });
      }
      a = b; b = c;
    }
  }
  return out;
}

/**
 * Close approaches. The Moon sweeps past a planet every month and the sight
 * of the two a finger's width apart is the most reliably pretty thing the
 * sky does, so those get a generous threshold; planet meets planet is rarer
 * and gets a tight one.
 */
export function conjunctions(from, days, site) {
  const ids = DISPLAY_ORDER.filter((id) => id !== 'sun' && id !== 'pluto');
  const step = 6 * HOUR;
  const samples = [];

  for (let t = from; t <= from + days * DAY; t += step) {
    const positions = {};
    for (const id of ids) positions[id] = geo(id, t);
    samples.push({ t, positions });
  }

  const pairs = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  }

  const out = [];
  for (const [a, b] of pairs) {
    const withMoon = a === 'moon' || b === 'moon';
    const threshold = withMoon ? 3 : 2;
    const sepAt = (t) => {
      const x = geo(a, t), y = geo(b, t);
      return angularSeparation(x.ra, x.dec, y.ra, y.dec);
    };

    for (let k = 1; k < samples.length - 1; k++) {
      const prev = angularSeparation(
        samples[k - 1].positions[a].ra, samples[k - 1].positions[a].dec,
        samples[k - 1].positions[b].ra, samples[k - 1].positions[b].dec);
      const cur = angularSeparation(
        samples[k].positions[a].ra, samples[k].positions[a].dec,
        samples[k].positions[b].ra, samples[k].positions[b].dec);
      const next = angularSeparation(
        samples[k + 1].positions[a].ra, samples[k + 1].positions[a].dec,
        samples[k + 1].positions[b].ra, samples[k + 1].positions[b].dec);
      if (!(cur <= prev && cur <= next) || cur > threshold + 2) continue;

      let lo = samples[k - 1].t, hi = samples[k + 1].t;
      for (let i = 0; i < 30; i++) {
        const m1 = lo + (hi - lo) * 0.382;
        const m2 = lo + (hi - lo) * 0.618;
        if (sepAt(m1) < sepAt(m2)) hi = m2; else lo = m1;
      }
      const when = (lo + hi) / 2;
      const sep = sepAt(when);
      if (sep > threshold) continue;

      // Worth mentioning only if both are actually up at some point that
      // night; a conjunction behind the Earth is a calendar entry, not a view.
      let bestAlt = -90;
      let bestTime = when;
      for (let t = when - 12 * HOUR; t <= when + 12 * HOUR; t += 20 * MIN) {
        const alt = Math.min(at(a, t, site).altApparent, at(b, t, site).altApparent);
        const sunAlt = at('sun', t, site).altApparent;
        if (sunAlt < -6 && alt > bestAlt) { bestAlt = alt; bestTime = t; }
      }

      // Closer than the Moon's own radius means it does not merely pass the
      // planet, it covers it.
      const occultation = withMoon && sep < radiusOf(geo('moon', when));

      out.push({
        key: 'conjunction', ids: [a, b], time: new Date(when),
        separation: sep,
        occultation,
        bestAltitude: bestAlt,
        bestTime: bestAlt > 0 ? new Date(bestTime) : null,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------- meteor showers */

/**
 * The one thing in this file that is looked up rather than derived.
 *
 * Meteor streams are debris trails, not two-body orbits, so there is nothing
 * here to integrate — the peaks come from the long-term averages published by
 * the IMO and the AMS. `day` is the morning the peak night runs into, since
 * most of these are richest in the small hours; the real maximum wanders by
 * about a day from year to year, and the panel says so.
 */
const SHOWERS = [
  { name: 'Quadrantiden', month: 1, day: 4, rate: 120, note: 'Kurzes, scharfes Maximum — nur wenige Stunden.' },
  { name: 'Lyriden', month: 4, day: 22, rate: 18, note: 'Gelegentlich helle Boliden.' },
  { name: 'Eta-Aquariiden', month: 5, day: 6, rate: 55, note: 'Reste des Halleyschen Kometen, tief am Morgenhimmel.' },
  { name: 'Perseiden', month: 8, day: 13, rate: 100, note: 'Der Klassiker: warme Nächte, hohe Rate, die ganze Nacht.' },
  { name: 'Orioniden', month: 10, day: 21, rate: 20, note: 'Ebenfalls vom Halleyschen Kometen, sehr schnelle Meteore.' },
  { name: 'Leoniden', month: 11, day: 17, rate: 15, note: 'Alle 33 Jahre ein Sturm — dazwischen ruhig.' },
  { name: 'Geminiden', month: 12, day: 14, rate: 150, note: 'Der reichste Strom des Jahres, auch schon am Abend.' },
  { name: 'Ursiden', month: 12, day: 22, rate: 10, note: 'Klein, zirkumpolar, kurz vor Weihnachten.' },
];

/** Next peak of each shower, with the Moon's verdict on it. */
export function meteorShowers(from, days) {
  const out = [];
  const start = new Date(from);

  for (const shower of SHOWERS) {
    for (const year of [start.getFullYear(), start.getFullYear() + 1, start.getFullYear() + 2]) {
      const peak = new Date(year, shower.month - 1, shower.day, 2, 0, 0);
      const t = peak.getTime();
      if (t < from || t > from + days * DAY) continue;

      const moon = geo('moon', t);
      const illum = moon.illuminated;
      out.push({
        key: 'meteors', time: peak, name: shower.name, rate: shower.rate,
        note: shower.note,
        approximate: true,
        moonIllumination: illum,
        moonSpoils: illum > 0.6,
      });
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------ tonight's basics */

/** Sunset, twilight, moonrise — the things that decide whether tonight works. */
export function tonight(date, site) {
  const out = [];
  const now = date.getTime();
  const sun = sunEvents(date, site);
  const moon = findEvents('moon', date, site);

  const add = (time, title, note, key) => {
    if (time && time.getTime() > now) out.push({ key, time, title, note });
  };

  const pick = (k, rising) => sun.events.find((e) => e.key === k && e.rising === rising && e.time > now)?.time;

  add(pick('horizon', false), 'Sonnenuntergang', 'Danach beginnt die Dämmerung.', 'sun-set');
  add(pick('civil', false), 'Ende der bürgerlichen Dämmerung', 'Die hellsten Planeten treten hervor.', 'twilight');
  add(pick('astronomical', false), 'Astronomische Dämmerung endet', 'Ab jetzt ist der Himmel so dunkel, wie er hier wird.', 'dark');
  add(pick('astronomical', true), 'Astronomische Dämmerung beginnt', 'Das Ende der dunklen Stunden.', 'dawn');
  add(pick('horizon', true), 'Sonnenaufgang', null, 'sun-rise');
  add(moon.nextRise, 'Mondaufgang', null, 'moon-rise');
  add(moon.nextSet, 'Monduntergang', null, 'moon-set');

  return out;
}

/* --------------------------------------------------------------- gather */

const idle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Everything, in one sorted list.
 *
 * The stages yield to the browser between them: the whole search is a few
 * hundred milliseconds on a phone, which is long enough to drop frames if it
 * were done in one go, and the live view keeps running behind the panel.
 */
export async function collectEvents(date, site, { years = 2, onStage } = {}) {
  const from = date.getTime();
  const days = Math.round(years * 365.25);
  const events = [];

  const stage = async (label, fn) => {
    onStage?.(label);
    await idle();
    events.push(...fn());
  };

  await stage('Heute Nacht', () => tonight(date, site));

  let phases = [];
  await stage('Mondphasen', () => {
    phases = moonPhases(from, Math.min(days, 120));
    return phases.slice(0, 8);
  });

  // Eclipses need the phases from the full window, not just the listed ones.
  let allPhases = phases;
  await stage('Finsternisse', () => {
    allPhases = days > 120 ? moonPhases(from, days) : phases;
    return [
      ...solarEclipses(allPhases.filter((p) => p.key === 'new'), site),
      ...lunarEclipses(allPhases.filter((p) => p.key === 'full'), site),
    ];
  });

  await stage('Oppositionen', () => oppositions(from, days));
  await stage('Elongationen', () => greatestElongations(from, days));
  await stage('Begegnungen', () => conjunctions(from, Math.min(days, 120), site));
  await stage('Sternschnuppen', () => meteorShowers(from, days));

  return events
    .filter((e) => e.time.getTime() > from)
    .sort((a, b) => a.time - b.time);
}
