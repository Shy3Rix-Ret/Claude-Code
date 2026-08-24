/**
 * Small helpers shared by the simulation and the interface.
 *
 * Nothing in here knows about the game; if a function needs a rule of the
 * economy it belongs in economy.js instead.
 */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sum = (arr, f) => arr.reduce((acc, x) => acc + f(x), 0);
export const round2 = (v) => Math.round(v * 100) / 100;

/** Deterministic PRNG. A seed makes a run reproducible, which is what the
 *  balance harness needs to compare two strategies fairly. */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  /** Normal-ish noise via three samples; enough shape for daily footfall. */
  next.noise = (spread = 0.1) =>
    1 + ((next() + next() + next()) / 3 - 0.5) * 2 * spread;
  next.state = () => s;
  next.setState = (v) => { s = v >>> 0 || 1; };
  return next;
}

/* ------------------------------------------------------------ formatting */

const EUR0 = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
});
const EUR2 = new Intl.NumberFormat('de-DE', {
  style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Money for headline figures: no cents, but compact once it gets silly. */
export function money(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${NUM1.format(v / 1e6)} Mio. €`;
  if (a >= 1e5) return `${NUM.format(Math.round(v / 1e3))} Tsd. €`;
  return EUR0.format(v);
}
/** Money where the cents carry meaning — prices, unit costs. */
export const price = (v) => EUR2.format(v);
export const num = (v) => NUM.format(v);
export const num1 = (v) => NUM1.format(v);
export const pct = (v, digits = 0) =>
  `${(v * 100).toFixed(digits).replace('.', ',')} %`;
/** A signed figure, for deltas that should read as good or bad at a glance. */
export const signed = (v) => (v >= 0 ? `+${money(v)}` : `−${money(-v)}`);

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** The calendar is a plain 30-day month — the economy is tuned around it, and
 *  nobody plays a kiosk sim for the leap years. */
export const DAYS_PER_MONTH = 30;

export function calendar(day) {
  const d = Math.max(0, Math.floor(day));
  const month = Math.floor(d / DAYS_PER_MONTH);
  return {
    dayOfMonth: (d % DAYS_PER_MONTH) + 1,
    month: month % 12,
    year: 1 + Math.floor(month / 12),
    weekday: d % 7,
    weekdayName: WEEKDAYS[d % 7],
    monthName: MONTHS[month % 12],
  };
}

export function dateLabel(day) {
  const c = calendar(day);
  return `${c.weekdayName}, ${c.dayOfMonth}. ${c.monthName} — Jahr ${c.year}`;
}
export function shortDate(day) {
  const c = calendar(day);
  return `${c.dayOfMonth}.${String(c.month + 1).padStart(2, '0')}.`;
}
