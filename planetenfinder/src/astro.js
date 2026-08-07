/**
 * Ephemeris core — where the bodies actually are.
 *
 * Everything here is self-contained maths; the app makes no network request
 * for positions. Sources and accuracy:
 *
 *   Planets   Keplerian elements with linear rates from JPL/Standish
 *             ("Approximate Positions of the Major Planets", valid
 *             1800-2050). Better than ~1' for the inner planets, a few
 *             arcminutes for Jupiter outwards.
 *   Sun       Derived from the Earth/Moon-barycentre elements above.
 *   Moon      Brown's theory truncated to the twelve largest terms in
 *             longitude, five in latitude, two in distance (~2' worst case).
 *             Corrected for parallax, which is the term that matters: from
 *             the surface of the Earth the Moon can sit a full degree away
 *             from its geocentric position.
 *
 * On top of that: light-time, precession to the equinox of date, the main
 * nutation term, topocentric parallax for every body, and refraction. That is
 * comfortably inside a phone compass's own error — a degree at best — which
 * is the honest limit of the whole exercise.
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const AU_KM = 149597870.7;
export const EARTH_RADIUS_KM = 6378.137;
const LIGHT_AU_PER_DAY = 173.144632674;

export const norm360 = (x) => ((x % 360) + 360) % 360;
export const norm180 = (x) => norm360(x + 180) - 180;
const sind = (x) => Math.sin(x * DEG);
const cosd = (x) => Math.cos(x * DEG);
const tand = (x) => Math.tan(x * DEG);

export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0. */
export function centuries(jd) {
  return (jd - 2451545.0) / 36525;
}

/**
 * TT - UT in seconds. Espenak/Meeus fit for 2005-2050, held flat outside it.
 * Worth roughly an arcsecond of Moon position — small, but free.
 */
export function deltaTSeconds(jd) {
  const year = 2000 + (jd - 2451545.0) / 365.25;
  const t = Math.min(Math.max(year, 2005), 2050) - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

/* ------------------------------------------------------------- elements */

// a (AU), e, I (deg), L (deg), longitude of perihelion, longitude of node
// and their per-century rates.
const ELEMENTS = {
  mercury: {
    el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  earth: {
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  mars: {
    el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  uranus: {
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  neptune: {
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
  pluto: {
    el: [39.48211675, 0.24882730, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
    rate: [-0.00031596, 0.00005170, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
  },
};

export const PLANET_IDS = Object.keys(ELEMENTS).filter((k) => k !== 'earth');

/** Heliocentric rectangular coordinates, J2000 ecliptic, in AU. */
function heliocentric(name, T) {
  const p = ELEMENTS[name];
  const a = p.el[0] + p.rate[0] * T;
  const e = p.el[1] + p.rate[1] * T;
  const I = p.el[2] + p.rate[2] * T;
  const L = p.el[3] + p.rate[3] * T;
  const peri = p.el[4] + p.rate[4] * T;
  const node = p.el[5] + p.rate[5] * T;

  const w = peri - node;
  const M = norm180(L - peri);

  // Kepler, in degrees. Converges in three or four passes even for Pluto.
  const eDeg = e * RAD;
  let E = M + eDeg * sind(M);
  for (let i = 0; i < 12; i++) {
    const dM = M - (E - eDeg * sind(E));
    const dE = dM / (1 - e * cosd(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }

  const xp = a * (cosd(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * sind(E);

  const cw = cosd(w), sw = sind(w);
  const cn = cosd(node), sn = sind(node);
  const ci = cosd(I), si = sind(I);

  return [
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    (sw * si) * xp + (cw * si) * yp,
  ];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);

/* --------------------------------------------------- frames and rotations */

/** Mean obliquity of the ecliptic, degrees. */
function obliquity(T) {
  return 23.439291111 - 0.0130041667 * T - 1.63888e-7 * T * T + 5.036111e-7 * T * T * T;
}

/** Main nutation terms: enough for the arcsecond level we care about. */
function nutation(T) {
  const om = 125.04452 - 1934.136261 * T;
  return {
    dPsi: (-17.20 * sind(om)) / 3600,
    dEps: (9.20 * cosd(om)) / 3600,
  };
}

/** General precession in ecliptic longitude since J2000, degrees. */
function precessionLongitude(T) {
  return (5029.0966 * T + 1.11113 * T * T) / 3600;
}

/**
 * J2000 ecliptic rectangle -> apparent right ascension / declination of date.
 * Precession is applied as a shift in ecliptic longitude, which is accurate to
 * about an arcsecond over the decades this app is used in.
 */
function eclipticToEquatorial(vec, T) {
  const r = len(vec);
  const lonJ2000 = norm360(Math.atan2(vec[1], vec[0]) * RAD);
  const lat = Math.asin(vec[2] / r) * RAD;

  const { dPsi, dEps } = nutation(T);
  const lon = norm360(lonJ2000 + precessionLongitude(T) + dPsi);
  const eps = obliquity(T) + dEps;

  return eclipticLonLatToEquatorial(lon, lat, r, eps);
}

function eclipticLonLatToEquatorial(lon, lat, r, eps) {
  const x = cosd(lat) * cosd(lon);
  const y = cosd(eps) * cosd(lat) * sind(lon) - sind(eps) * sind(lat);
  const z = sind(eps) * cosd(lat) * sind(lon) + cosd(eps) * sind(lat);
  return {
    ra: norm360(Math.atan2(y, x) * RAD),
    dec: Math.asin(z) * RAD,
    dist: r,
    lon,
    lat,
  };
}

/** Apparent Greenwich sidereal time in degrees. Uses UT, not TT. */
export function gmst(jdUT, T) {
  const d = jdUT - 2451545.0;
  const theta = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
  const { dPsi, dEps } = nutation(T);
  return norm360(theta + dPsi * cosd(obliquity(T) + dEps));
}

/** Local apparent sidereal time, degrees. East longitude positive. */
export function lstFor(jdUT, T, lonDeg) {
  return norm360(gmst(jdUT, T) + lonDeg);
}

/* ------------------------------------------------------------ observer */

/** Geocentric position of the observer, equatorial rectangular, in km. */
function observerVector(site, lst) {
  const lat = site.lat;
  const h = (site.elevation || 0) / 1000;
  const u = Math.atan(0.99664719 * tand(lat));
  const rhoSin = 0.99664719 * Math.sin(u) + (h / EARTH_RADIUS_KM) * sind(lat);
  const rhoCos = Math.cos(u) + (h / EARTH_RADIUS_KM) * cosd(lat);
  return [
    EARTH_RADIUS_KM * rhoCos * cosd(lst),
    EARTH_RADIUS_KM * rhoCos * sind(lst),
    EARTH_RADIUS_KM * rhoSin,
  ];
}

/** Shift a geocentric direction to the observer's actual place on Earth. */
function toTopocentric(eq, distKm, site, lst) {
  const r = distKm;
  const v = [
    r * cosd(eq.dec) * cosd(eq.ra),
    r * cosd(eq.dec) * sind(eq.ra),
    r * sind(eq.dec),
  ];
  const o = observerVector(site, lst);
  const t = sub(v, o);
  const d = len(t);
  return {
    ra: norm360(Math.atan2(t[1], t[0]) * RAD),
    dec: Math.asin(t[2] / d) * RAD,
    distKm: d,
  };
}

/** Equatorial -> horizon. Azimuth counts from north through east. */
export function toHorizon(ra, dec, latDeg, lst) {
  const H = norm180(lst - ra);
  const sinAlt = sind(latDeg) * sind(dec) + cosd(latDeg) * cosd(dec) * cosd(H);
  const alt = Math.asin(Math.min(1, Math.max(-1, sinAlt))) * RAD;
  const az = norm360(
    Math.atan2(sind(H), cosd(H) * sind(latDeg) - tand(dec) * cosd(latDeg)) * RAD + 180,
  );
  return { alt, az, hourAngle: H };
}

/**
 * Bennett's refraction, arcminutes -> degrees. Below about -1° the formula has
 * nothing left to say, so it is faded out rather than left to diverge.
 */
export function refraction(altDeg) {
  if (altDeg < -1.5) return 0;
  const h = Math.max(altDeg, -1.0);
  const r = 1.02 / tand(h + 10.3 / (h + 5.11)) / 60;
  return Math.max(0, r);
}

/* ---------------------------------------------------------------- moon */

/**
 * Geocentric ecliptic position of the Moon, mean equinox of date.
 * Distance comes back in Earth radii, as the classical elements give it.
 */
function moonEcliptic(jde) {
  const d = jde - 2451543.5;

  // Sun, needed for every perturbation term below.
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = norm360(356.0470 + 0.9856002585 * d);

  // Moon.
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666;
  const e = 0.054900;
  const M = norm360(115.3654 + 13.0649929509 * d);

  const eDeg = e * RAD;
  let E = M + eDeg * sind(M);
  for (let k = 0; k < 10; k++) {
    const dE = (M - (E - eDeg * sind(E))) / (1 - e * cosd(E));
    E += dE;
    if (Math.abs(dE) < 1e-9) break;
  }

  const xv = a * (cosd(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * sind(E);
  const v = norm360(Math.atan2(yv, xv) * RAD);
  const r = Math.hypot(xv, yv);

  const cn = cosd(N), sn = sind(N);
  const cvw = cosd(v + w), svw = sind(v + w);
  const ci = cosd(i), si = sind(i);

  let lon = norm360(Math.atan2(sn * cvw + cn * svw * ci, cn * cvw - sn * svw * ci) * RAD);
  let lat = Math.asin(svw * si) * RAD;
  let dist = r;

  // Perturbations. The first two — evection and variation — are worth about
  // a degree and a half between them; leaving them out is what makes naive
  // moon code point at empty sky.
  const Ls = norm360(Ms + ws);
  const Lm = norm360(M + w + N);
  const D = norm360(Lm - Ls);
  const F = norm360(Lm - N);

  lon +=
    -1.274 * sind(M - 2 * D) +
    0.658 * sind(2 * D) +
    -0.186 * sind(Ms) +
    -0.059 * sind(2 * M - 2 * D) +
    -0.057 * sind(M - 2 * D + Ms) +
    0.053 * sind(M + 2 * D) +
    0.046 * sind(2 * D - Ms) +
    0.041 * sind(M - Ms) +
    -0.035 * sind(D) +
    -0.031 * sind(M + Ms) +
    -0.015 * sind(2 * F - 2 * D) +
    0.011 * sind(M - 4 * D);

  lat +=
    -0.173 * sind(F - 2 * D) +
    -0.055 * sind(M - F - 2 * D) +
    -0.046 * sind(M + F - 2 * D) +
    0.033 * sind(F + 2 * D) +
    0.017 * sind(2 * M + F);

  dist += -0.58 * cosd(M - 2 * D) + -0.46 * cosd(2 * D);

  return { lon: norm360(lon), lat, distEarthRadii: dist };
}

/* ------------------------------------------------------- body positions */

/** Geocentric apparent equatorial position, plus the distance in km. */
function geocentricEquatorial(id, jde) {
  const T = centuries(jde);

  if (id === 'moon') {
    const m = moonEcliptic(jde);
    const { dPsi, dEps } = nutation(T);
    const eq = eclipticLonLatToEquatorial(
      m.lon + dPsi,
      m.lat,
      m.distEarthRadii,
      obliquity(T) + dEps,
    );
    return { ...eq, distKm: m.distEarthRadii * EARTH_RADIUS_KM, sunDistAu: 0, helioDistAu: 0 };
  }

  const earth = heliocentric('earth', T);

  if (id === 'sun') {
    const vec = [-earth[0], -earth[1], -earth[2]];
    const eq = eclipticToEquatorial(vec, T);
    return { ...eq, distKm: eq.dist * AU_KM, helioDistAu: 0, sunDistAu: eq.dist };
  }

  // Light-time: look up where the planet was when the light left it.
  let body = heliocentric(id, T);
  let delta = len(sub(body, earth));
  for (let k = 0; k < 2; k++) {
    const Tl = centuries(jde - delta / LIGHT_AU_PER_DAY);
    body = heliocentric(id, Tl);
    delta = len(sub(body, earth));
  }

  const eq = eclipticToEquatorial(sub(body, earth), T);
  return {
    ...eq,
    distKm: eq.dist * AU_KM,
    helioDistAu: len(body),
    sunDistAu: len(earth),
  };
}

/* ------------------------------------------------- brightness and phase */

/** Phase angle at the body: Sun-body-Earth, degrees. */
function phaseAngle(helioDist, geoDist, sunDist) {
  if (!helioDist || !geoDist) return 0;
  const c = (helioDist * helioDist + geoDist * geoDist - sunDist * sunDist) / (2 * helioDist * geoDist);
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

/** Apparent magnitude, Astronomical Almanac fits. */
function magnitudeOf(id, r, delta, i) {
  const base = 5 * Math.log10(Math.max(r * delta, 1e-6));
  switch (id) {
    case 'mercury': return -0.42 + base + 0.0380 * i - 0.000273 * i * i + 2e-6 * i ** 3;
    case 'venus': return -4.40 + base + 0.0009 * i + 0.000239 * i * i - 6.5e-7 * i ** 3;
    case 'mars': return -1.52 + base + 0.016 * i;
    case 'jupiter': return -9.40 + base + 0.005 * i;
    // The rings swing Saturn by more than a magnitude over its year; this is
    // the ringless value, so treat it as a floor.
    case 'saturn': return -8.88 + base;
    case 'uranus': return -7.19 + base;
    case 'neptune': return -6.87 + base;
    case 'pluto': return -1.00 + base;
    default: return 0;
  }
}

// Equatorial diameter in arcseconds at 1 AU (Moon and Sun handled separately).
const DIAMETER_1AU = {
  mercury: 6.74, venus: 16.92, mars: 9.36, jupiter: 196.94,
  saturn: 165.6, uranus: 65.8, neptune: 62.2, pluto: 4.0,
};

function angularDiameter(id, distAu, distKm) {
  if (id === 'moon') return (2 * Math.atan(1737.4 / distKm) * RAD) * 3600;
  if (id === 'sun') return 1919.26 / distAu;
  return (DIAMETER_1AU[id] || 1) / Math.max(distAu, 1e-6);
}

/* ---------------------------------------------------------- public API */

export const BODY_IDS = ['sun', 'moon', ...PLANET_IDS];

/**
 * Everything the app needs about one body at one instant, from one place.
 * `alt` is geometric, `altApparent` includes refraction — the second one is
 * where you actually see it, so that is what the views draw.
 */
export function bodyState(id, date, site, { topocentric = true } = {}) {
  const jdUT = julianDay(date);
  const T = centuries(jdUT);
  const jde = jdUT + deltaTSeconds(jdUT) / 86400;
  const lst = lstFor(jdUT, T, site.lon);

  const geo = geocentricEquatorial(id, jde);
  // Eclipses are events in the Earth's own shadow geometry, not something an
  // observer's few thousand kilometres of offset take part in — those want
  // the geocentric position.
  const topo = topocentric
    ? toTopocentric(geo, geo.distKm, site, lst)
    : { ra: geo.ra, dec: geo.dec, distKm: geo.distKm };
  const hor = toHorizon(topo.ra, topo.dec, site.lat, lst);
  const alt = hor.alt;
  const altApparent = alt + refraction(alt);

  const distAu = topo.distKm / AU_KM;
  let phase = 0;
  let illuminated = 1;
  let mag = 0;

  if (id === 'sun') {
    mag = -26.74;
  } else if (id === 'moon') {
    const sun = geocentricEquatorial('sun', jde);
    const elong = angularSeparation(geo.ra, geo.dec, sun.ra, sun.dec);
    const R = sun.distKm;
    const D = geo.distKm;
    phase = Math.atan2(R * sind(elong), D - R * cosd(elong)) * RAD;
    illuminated = (1 + cosd(phase)) / 2;
    // Waxing while the Moon leads the Sun in ecliptic longitude.
    const waxing = norm360(geo.lon - sun.lon) < 180;
    mag = -12.7 + 0.026 * Math.abs(phase) + 4e-9 * phase ** 4;
    return finish({ phase, illuminated, waxing, mag, elongation: elong });
  } else {
    phase = phaseAngle(geo.helioDistAu, distAu, geo.sunDistAu);
    illuminated = (1 + cosd(phase)) / 2;
    mag = magnitudeOf(id, geo.helioDistAu, distAu, phase);
  }

  return finish({ phase, illuminated, waxing: true, mag, elongation: null });

  function finish(extra) {
    return {
      id,
      date,
      ra: topo.ra,
      dec: topo.dec,
      // Apparent geocentric ecliptic coordinates of date. Longitude is what
      // tells a first quarter from a last quarter, and two planets meeting
      // from two planets merely passing on opposite sides of the sky.
      eclLon: geo.lon,
      eclLat: geo.lat,
      az: hor.az,
      alt,
      altApparent,
      hourAngle: hor.hourAngle,
      distKm: topo.distKm,
      distAu,
      helioDistAu: geo.helioDistAu,
      lightMinutes: topo.distKm / 299792.458 / 60,
      angularDiameter: angularDiameter(id, distAu, topo.distKm),
      aboveHorizon: altApparent > 0,
      ...extra,
    };
  }
}

/** All bodies at once, brightest first is left to the caller. */
export function allBodies(date, site) {
  return BODY_IDS.map((id) => bodyState(id, date, site));
}

/**
 * Opening angle of Saturn's rings, degrees, signed by which face we see.
 *
 * Worth having rather than guessing: the ring plane crossed the Earth in
 * 2025, so through 2026 the rings are all but edge-on — a drawing with them
 * wide open would be a picture of a different decade. Meeus, chapter 45.
 */
export function saturnRingTilt(date) {
  const jd = julianDay(date);
  const T = centuries(jd);
  const s = bodyState('saturn', date, { lat: 0, lon: 0, elevation: 0 }, { topocentric: false });
  const inclination = 28.075 - 0.012 * T;      // ring plane to the ecliptic
  const node = 169.508 + 1.394 * T;            // its ascending node
  return Math.asin(Math.max(-1, Math.min(1,
    sind(inclination) * cosd(s.eclLat) * sind(s.eclLon - node)
    - cosd(inclination) * sind(s.eclLat),
  ))) * RAD;
}

/** Angular distance between two equatorial positions, degrees. */
export function angularSeparation(ra1, dec1, ra2, dec2) {
  const c =
    sind(dec1) * sind(dec2) + cosd(dec1) * cosd(dec2) * cosd(ra1 - ra2);
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

/** Angular distance between two horizon positions, degrees. */
export function separationAltAz(alt1, az1, alt2, az2) {
  const c = sind(alt1) * sind(alt2) + cosd(alt1) * cosd(alt2) * cosd(az1 - az2);
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

/**
 * Galactic coordinates -> equatorial J2000. The Milky Way is defined in the
 * galactic frame, so drawing it means coming back out of that frame.
 */
export function galacticToEquatorial(l, b) {
  const raPole = 192.85948;
  const decPole = 27.12825;
  const lNorth = 122.93192;          // galactic longitude of the celestial pole

  const dec = Math.asin(
    sind(decPole) * sind(b) + cosd(decPole) * cosd(b) * cosd(lNorth - l),
  ) * RAD;
  const ra = raPole + Math.atan2(
    cosd(b) * sind(lNorth - l),
    cosd(decPole) * sind(b) - sind(decPole) * cosd(b) * cosd(lNorth - l),
  ) * RAD;
  return { ra: norm360(ra), dec };
}

/** Anything fixed on the sky, given in J2000 -> where it is right now. */
export function j2000ToHorizon(raDeg, decDeg, date, site) {
  return starHorizon(raDeg / 15, decDeg, date, site);
}

/** Fixed star (J2000 RA/Dec) -> horizon coordinates for a moment and place. */
export function starHorizon(raHours, decDeg, date, site) {
  const jdUT = julianDay(date);
  const T = centuries(jdUT);
  const lst = lstFor(jdUT, T, site.lon);

  // Same ecliptic-longitude precession path as the planets, so the stars and
  // the planets never disagree about which way the sky is turned.
  const eps0 = obliquity(0);
  const ra0 = raHours * 15;
  const x = cosd(decDeg) * cosd(ra0);
  const y = cosd(eps0) * cosd(decDeg) * sind(ra0) + sind(eps0) * sind(decDeg);
  const z = -sind(eps0) * cosd(decDeg) * sind(ra0) + cosd(eps0) * sind(decDeg);
  const lon = norm360(Math.atan2(y, x) * RAD) + precessionLongitude(T);
  const lat = Math.asin(z) * RAD;

  const eq = eclipticLonLatToEquatorial(lon, lat, 1, obliquity(T));
  const hor = toHorizon(eq.ra, eq.dec, site.lat, lst);
  return { alt: hor.alt + refraction(hor.alt), az: hor.az, ra: eq.ra, dec: eq.dec };
}

/** Ecliptic longitude -> horizon, used to draw the ecliptic on the map. */
export function eclipticPointHorizon(lonDeg, date, site) {
  const jdUT = julianDay(date);
  const T = centuries(jdUT);
  const lst = lstFor(jdUT, T, site.lon);
  const eq = eclipticLonLatToEquatorial(lonDeg, 0, 1, obliquity(T));
  const hor = toHorizon(eq.ra, eq.dec, site.lat, lst);
  return { alt: hor.alt, az: hor.az };
}

/* ----------------------------------------------------- rise / set / transit */

const MIN = 60000;

/**
 * Scans altitude over a window and interpolates the crossings. One routine for
 * every body: the Moon's own motion and the Sun's twilight steps are handled
 * by sampling rather than by a closed form, which keeps this honest for
 * fast-moving bodies and for the polar cases where nothing rises at all.
 */
export function findEvents(id, date, site, { hoursBack = 14, hoursAhead = 30, thresholds } = {}) {
  const limits = thresholds || [{ key: 'horizon', alt: 0 }];
  const step = 10 * MIN;
  const start = date.getTime() - hoursBack * 3600000;
  const end = date.getTime() + hoursAhead * 3600000;

  const samples = [];
  for (let t = start; t <= end; t += step) {
    const s = bodyState(id, new Date(t), site);
    samples.push({ t, alt: s.altApparent });
  }

  const events = [];

  // The culmination people mean is the one belonging to *this* night, which
  // may be an hour behind them — so take the local maximum nearest to now,
  // not the highest sample in the whole window.
  const peaks = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].alt >= samples[i - 1].alt && samples[i].alt >= samples[i + 1].alt) {
      peaks.push(samples[i]);
    }
  }
  const peak = peaks.length
    ? peaks.reduce((best, p) =>
      Math.abs(p.t - date.getTime()) < Math.abs(best.t - date.getTime()) ? p : best)
    : samples.reduce((best, p) => (p.alt > best.alt ? p : best), samples[0]);
  const maxAlt = peak.alt;
  const transit = peak.t;

  for (const limit of limits) {
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      const da = a.alt - limit.alt;
      const db = b.alt - limit.alt;
      if (da === 0 || (da < 0) === (db < 0)) continue;

      // Bisect for the minute-level answer the UI shows.
      let lo = a.t, hi = b.t, loAlt = da;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        const midAlt = bodyState(id, new Date(mid), site).altApparent - limit.alt;
        if ((midAlt < 0) === (loAlt < 0)) { lo = mid; loAlt = midAlt; } else { hi = mid; }
      }
      events.push({
        key: limit.key,
        rising: db > da,
        time: new Date((lo + hi) / 2),
      });
    }
  }

  events.sort((x, y) => x.time - y.time);

  const now = date.getTime();
  const horizon = events.filter((e) => e.key === 'horizon');
  const past = horizon.filter((e) => e.time <= now);
  return {
    events,
    maxAltitude: maxAlt,
    transit: transit != null ? new Date(transit) : null,
    nextRise: horizon.find((e) => e.rising && e.time > now)?.time || null,
    nextSet: horizon.find((e) => !e.rising && e.time > now)?.time || null,
    // For something already up, the rise that matters is the one it made
    // earlier tonight — not the next one, 24 hours out.
    lastRise: [...past].reverse().find((e) => e.rising)?.time || null,
    lastSet: [...past].reverse().find((e) => !e.rising)?.time || null,
    circumpolar: horizon.length === 0 && maxAlt > 0,
    neverRises: horizon.length === 0 && maxAlt <= 0,
  };
}

/**
 * Rise, set and culmination for something fixed on the sky — a deep-sky
 * object or a star. Same sampling as the planets; only the position function
 * differs, since these do not move against the stars at all.
 */
export function findFixedEvents(raHours, decDeg, date, site, { hoursBack = 14, hoursAhead = 30 } = {}) {
  const step = 10 * MIN;
  const samples = [];
  for (let t = date.getTime() - hoursBack * 3600000; t <= date.getTime() + hoursAhead * 3600000; t += step) {
    samples.push({ t, alt: starHorizon(raHours, decDeg, new Date(t), site).alt });
  }

  const events = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if ((a.alt < 0) === (b.alt < 0)) continue;
    let lo = a.t, hi = b.t, loAlt = a.alt;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      const midAlt = starHorizon(raHours, decDeg, new Date(mid), site).alt;
      if ((midAlt < 0) === (loAlt < 0)) { lo = mid; loAlt = midAlt; } else { hi = mid; }
    }
    events.push({ rising: b.alt > a.alt, time: new Date((lo + hi) / 2) });
  }

  const peaks = [];
  for (let i = 1; i < samples.length - 1; i++) {
    if (samples[i].alt >= samples[i - 1].alt && samples[i].alt >= samples[i + 1].alt) peaks.push(samples[i]);
  }
  const peak = peaks.length
    ? peaks.reduce((best, p) => (Math.abs(p.t - date.getTime()) < Math.abs(best.t - date.getTime()) ? p : best))
    : samples.reduce((best, p) => (p.alt > best.alt ? p : best), samples[0]);

  const now = date.getTime();
  const past = events.filter((e) => e.time <= now);
  return {
    events,
    maxAltitude: peak.alt,
    transit: new Date(peak.t),
    nextRise: events.find((e) => e.rising && e.time > now)?.time || null,
    nextSet: events.find((e) => !e.rising && e.time > now)?.time || null,
    lastRise: [...past].reverse().find((e) => e.rising)?.time || null,
    lastSet: [...past].reverse().find((e) => !e.rising)?.time || null,
    circumpolar: events.length === 0 && peak.alt > 0,
    neverRises: events.length === 0 && peak.alt <= 0,
  };
}

/** Sun events including the three twilights, for the observing summary. */
export function sunEvents(date, site) {
  return findEvents('sun', date, site, {
    hoursBack: 12,
    hoursAhead: 24,
    thresholds: [
      { key: 'horizon', alt: -0.833 },
      { key: 'civil', alt: -6 },
      { key: 'nautical', alt: -12 },
      { key: 'astronomical', alt: -18 },
    ],
  });
}

/**
 * Next new and full moon, found by walking the Sun-Moon elongation in
 * ecliptic longitude. Coarse scan, then bisection.
 */
export function moonPhaseEvents(date, site) {
  const diffAt = (t) => {
    const jde = julianDay(new Date(t)) + deltaTSeconds(julianDay(new Date(t))) / 86400;
    const m = moonEcliptic(jde);
    const s = geocentricEquatorial('sun', jde);
    return norm360(m.lon - s.lon);
  };

  const find = (targetDeg) => {
    const step = 6 * 3600000;
    let prev = norm180(diffAt(date.getTime()) - targetDeg);
    for (let t = date.getTime() + step; t < date.getTime() + 40 * 86400000; t += step) {
      const cur = norm180(diffAt(t) - targetDeg);
      if (prev < 0 && cur >= 0) {
        let lo = t - step, hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (norm180(diffAt(mid) - targetDeg) < 0) lo = mid; else hi = mid;
        }
        return new Date((lo + hi) / 2);
      }
      prev = cur;
    }
    return null;
  };

  return { newMoon: find(0), firstQuarter: find(90), fullMoon: find(180), lastQuarter: find(270) };
}
