/**
 * Checks the ephemeris against things that can be verified from outside it.
 *
 *   node planetenfinder/tools/verify.mjs
 *
 * Three tests, in descending order of how much they prove:
 *
 *   1. The total solar eclipse of 12 August 2026. An eclipse is the Sun and
 *      the Moon at the same place in the sky, which only comes out right if
 *      the solar position, the lunar position, the time scale and the
 *      topocentric parallax are all correct together. Nothing else in this
 *      file is anywhere near as demanding.
 *   2. Equinoxes and solstices, which are printed against the calendar.
 *   3. The planets against a second, independent implementation — Paul
 *      Schlyter's classical method, with a different element set, a different
 *      epoch and its own perturbation terms, sharing no code with the app.
 *      Two implementations agreeing rules out coding mistakes; it does not
 *      prove the underlying theory, so the thresholds are set at the accuracy
 *      both methods claim rather than at zero.
 */

import { bodyState, angularSeparation, separationAltAz } from '../src/astro.js';

const D = Math.PI / 180;
const sin = (x) => Math.sin(x * D);
const cos = (x) => Math.cos(x * D);
const rev = (x) => ((x % 360) + 360) % 360;

const ELEMENTS = {
  mercury: (d) => ({ N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5.0e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d }),
  venus:   (d) => ({ N: 76.6799 + 2.46590e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.8910 + 1.38374e-5 * d, a: 0.723330, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d }),
  mars:    (d) => ({ N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d }),
  jupiter: (d) => ({ N: 100.4542 + 2.76854e-5 * d, i: 1.3030 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.8950 + 0.0830853001 * d }),
  saturn:  (d) => ({ N: 113.6634 + 2.38980e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.9670 + 0.0334442282 * d }),
  uranus:  (d) => ({ N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d, w: 96.6612 + 3.0565e-5 * d, a: 19.18171 - 1.55e-8 * d, e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d }),
  neptune: (d) => ({ N: 131.7806 + 3.0173e-5 * d, i: 1.7700 - 2.55e-7 * d, w: 272.8461 - 6.027e-6 * d, a: 30.05826 + 3.313e-8 * d, e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d }),
};

/** Heliocentric ecliptic longitude/latitude/radius, equinox of date. */
function helio(name, d) {
  const { N, i, w, a, e, M } = ELEMENTS[name](d);
  let E = M + (e * 180 / Math.PI) * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 30; k++) {
    const dE = (E - (e * 180 / Math.PI) * sin(E) - M) / (1 - e * cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  const xv = a * (cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sin(E);
  const v = rev(Math.atan2(yv, xv) / D);
  const r = Math.hypot(xv, yv);

  const xh = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i));
  const yh = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i));
  const zh = r * sin(v + w) * sin(i);
  return { lon: rev(Math.atan2(yh, xh) / D), lat: Math.atan2(zh, Math.hypot(xh, yh)) / D, r };
}

/** Sun, needed both for the Earth's position and for the perturbations. */
function sunPos(d) {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = rev(356.0470 + 0.9856002585 * d);
  let E = M + (e * 180 / Math.PI) * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 30; k++) {
    const dE = (E - (e * 180 / Math.PI) * sin(E) - M) / (1 - e * cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  const xv = cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * sin(E);
  return { lon: rev(Math.atan2(yv, xv) / D + w), r: Math.hypot(xv, yv) };
}

/** Schlyter's perturbation terms for the big outer planets. */
function perturb(name, d, pos) {
  const Mj = rev(19.8950 + 0.0830853001 * d);
  const Ms = rev(316.9670 + 0.0334442282 * d);
  const Mu = rev(142.5905 + 0.011725806 * d);
  let dLon = 0, dLat = 0;

  if (name === 'jupiter') {
    dLon = -0.332 * sin(2 * Mj - 5 * Ms - 67.6)
         - 0.056 * sin(2 * Mj - 2 * Ms + 21)
         + 0.042 * sin(3 * Mj - 5 * Ms + 21)
         - 0.036 * sin(Mj - 2 * Ms)
         + 0.022 * cos(Mj - Ms)
         + 0.023 * sin(2 * Mj - 3 * Ms + 52)
         - 0.016 * sin(Mj - 5 * Ms - 69);
  } else if (name === 'saturn') {
    dLon = +0.812 * sin(2 * Mj - 5 * Ms - 67.6)
         - 0.229 * cos(2 * Mj - 4 * Ms - 2)
         + 0.119 * sin(Mj - 2 * Ms - 3)
         + 0.046 * sin(2 * Mj - 6 * Ms - 69)
         + 0.014 * sin(Mj - 3 * Ms + 32);
    dLat = -0.020 * cos(2 * Mj - 4 * Ms - 2)
         + 0.018 * sin(2 * Mj - 6 * Ms - 49);
  } else if (name === 'uranus') {
    dLon = +0.040 * sin(Ms - 2 * Mu + 6)
         + 0.035 * sin(Ms - 3 * Mu + 33)
         - 0.015 * sin(Mj - Mu + 20);
  }
  return { lon: pos.lon + dLon, lat: pos.lat + dLat, r: pos.r };
}

/** Geocentric right ascension / declination, equinox of date. */
function geocentric(name, date) {
  const d = date.getTime() / 86400000 + 2440587.5 - 2451543.5;
  const p = perturb(name, d, helio(name, d));
  const s = sunPos(d);

  const xh = p.r * cos(p.lon) * cos(p.lat);
  const yh = p.r * sin(p.lon) * cos(p.lat);
  const zh = p.r * sin(p.lat);
  const xs = s.r * cos(s.lon);
  const ys = s.r * sin(s.lon);

  const xg = xh + xs, yg = yh + ys, zg = zh;
  const ecl = 23.4393 - 3.563e-7 * d;
  const xe = xg;
  const ye = yg * cos(ecl) - zg * sin(ecl);
  const ze = yg * sin(ecl) + zg * cos(ecl);
  return { ra: rev(Math.atan2(ye, xe) / D), dec: Math.atan2(ze, Math.hypot(xe, ye)) / D };
}


/* ------------------------------------------------------------------ report */

const fail = [];
const check = (ok, label, detail) => {
  fail.push(ok ? null : label);
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(46)} ${detail}`);
};

/* 1 ------------------------------------------------- total solar eclipse */

console.log('\nSonnenfinsternis vom 12.08.2026, Ort der größten Verfinsterung');
console.log('(65,2° N / 25,2° W). Sonne und Mond müssen sich dort decken.\n');

const eclipseSite = { lat: 65.2, lon: -25.2, elevation: 0 };
let best = null;
for (let t = Date.UTC(2026, 7, 12, 15, 0); t <= Date.UTC(2026, 7, 12, 21, 0); t += 10000) {
  const at = new Date(t);
  const sun = bodyState('sun', at, eclipseSite);
  const moon = bodyState('moon', at, eclipseSite);
  const sep = separationAltAz(sun.alt, sun.az, moon.alt, moon.az);
  if (!best || sep < best.sep) best = { t, sep, sun, moon };
}
const sunR = best.sun.angularDiameter / 7200;
const moonR = best.moon.angularDiameter / 7200;
const clock = new Date(best.t).toISOString().slice(11, 16);

check(best.sep * 60 < 3, 'Sonne und Mond stehen übereinander',
  `${(best.sep * 60).toFixed(2)}′ Abstand`);
check(best.sep < moonR - sunR, 'Mond bedeckt die Sonne vollständig',
  `Mondradius ${(moonR * 60).toFixed(1)}′ > Sonnenradius ${(sunR * 60).toFixed(1)}′`);
check(Math.abs(best.t - Date.UTC(2026, 7, 12, 17, 46)) < 5 * 60000,
  'Zeitpunkt trifft die veröffentlichte Vorhersage', `${clock} UT, erwartet 17:46 UT`);

// Without the observer's own position on the globe there is no eclipse here
// at all — worth showing, because it is the correction most sky apps skip.
const centre = { lat: 0, lon: 0, elevation: -6371000 };
const at = new Date(best.t);
const sepGeo = separationAltAz(
  bodyState('sun', at, centre).alt, bodyState('sun', at, centre).az,
  bodyState('moon', at, centre).alt, bodyState('moon', at, centre).az);
console.log(`     (ohne Standortkorrektur wären es ${(sepGeo * 60).toFixed(0)}′ — keine Finsternis)`);

/* 2 --------------------------------------------------- equinox / solstice */

console.log('\nTagundnachtgleichen und Sonnenwenden 2026, gegen den Kalender:\n');

const scanSun = (from, to, pick) => {
  let found = null;
  for (let t = from; t <= to; t += 600000) {
    const dec = bodyState('sun', new Date(t), centre).dec;
    if (!found || pick(dec, found.dec)) found = { t, dec };
  }
  return found;
};

const marchEquinox = scanSun(Date.UTC(2026, 2, 18), Date.UTC(2026, 2, 22),
  (d, best) => Math.abs(d) < Math.abs(best));
const juneSolstice = scanSun(Date.UTC(2026, 5, 19), Date.UTC(2026, 5, 23), (d, best) => d > best);

const fmt = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UT';

// The published instant is 20 March 2026, 14:46 UT. The residual is the
// honest measure of the solar position's accuracy: the Sun moves 1° per day,
// so a quarter hour is about 40 arcseconds of ecliptic longitude. That is
// the JPL element fit talking, plus the annual aberration this code does not
// model — both far below anything the app can point at, but not zero.
const publishedEquinox = Date.UTC(2026, 2, 20, 14, 46);
const equinoxOff = (marchEquinox.t - publishedEquinox) / 60000;
check(Math.abs(equinoxOff) < 30, 'Frühlingsanfang trifft den Kalender',
  `${fmt(marchEquinox.t)}, veröffentlicht 14:46 UT (${equinoxOff > 0 ? '+' : ''}${equinoxOff.toFixed(0)} min ≈ ${Math.abs(equinoxOff * 2.5).toFixed(0)}″)`);
check(Math.abs(juneSolstice.dec - 23.44) < 0.05, 'Sonnenwende erreicht 23,44° Deklination',
  `${juneSolstice.dec.toFixed(2)}° am ${fmt(juneSolstice.t)}`);

/* 3 ------------------------------------------- planets, second opinion */

console.log('\nPlaneten gegen eine unabhängige zweite Rechnung');
console.log('(schlechtester Wert über sechs Zeitpunkte von 2026 bis 2030):\n');

const site = { lat: 48.1372, lon: 11.5756, elevation: 519 };
const dates = [
  new Date(),
  new Date(Date.UTC(2026, 0, 15, 3, 0)),
  new Date(Date.UTC(2026, 9, 4, 22, 0)),
  new Date(Date.UTC(2027, 4, 20, 12, 0)),
  new Date(Date.UTC(2028, 11, 1, 6, 0)),
  new Date(Date.UTC(2030, 6, 9, 18, 0)),
];

// Both methods claim a few arcminutes for the outer planets, so that is what
// they are held to. Anything worse means a mistake, not a rounding.
const LIMIT = { mercury: 3, venus: 3, mars: 3, jupiter: 6, saturn: 10, uranus: 5, neptune: 3 };

for (const name of Object.keys(ELEMENTS)) {
  let worst = 0;
  for (const date of dates) {
    const mine = bodyState(name, date, site);
    const theirs = geocentric(name, date);
    worst = Math.max(worst, angularSeparation(mine.ra, mine.dec, theirs.ra, theirs.dec) * 60);
  }
  check(worst < LIMIT[name], `${name} stimmt mit der Zweitrechnung überein`,
    `${worst.toFixed(2)}′ (Grenze ${LIMIT[name]}′)`);
}

console.log('\nZum Einordnen: der Vollmond ist 30′ breit, das bloße Auge trennt');
console.log('bestenfalls 1′, und der Magnetkompass eines Handys irrt sich um');
console.log('300′ bis 900′. Die Rechnung ist nie das schwächste Glied.\n');

const broken = fail.filter(Boolean);
if (broken.length) {
  console.error(`${broken.length} Prüfung(en) fehlgeschlagen:\n  - ${broken.join('\n  - ')}`);
  process.exit(1);
}
console.log('Alle Prüfungen bestanden.');
