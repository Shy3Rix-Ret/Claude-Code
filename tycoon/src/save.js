/**
 * Save games. The state carries Sets and a live PRNG, neither of which
 * survives JSON, so both ends are explicit rather than clever.
 */

import { makeRng } from './util.js';
import { recomputeEffects } from './economy.js';

export const SAVE_KEY = 'kiosk-imperium.save.v1';

export function serialize(g) {
  return {
    version: g.version,
    seed: g.seed,
    rngState: g.rng.state(),
    firm: g.firm,
    day: g.day,
    cash: g.cash,
    debt: g.debt,
    reputation: g.reputation,
    trend: g.trend,
    prices: g.prices,
    unlocked: [...g.unlocked],
    research: [...g.research],
    milestones: [...g.milestones],
    campaigns: g.campaigns,
    modifiers: g.modifiers,
    ledger: g.ledger,
    history: g.history,
    log: g.log,
    month: g.month,
    lastMonth: g.lastMonth,
    over: g.over,
    nextStaffUid: g.nextStaffUid,
    locations: g.locations.map((l) => ({ ...l, upgrades: [...l.upgrades], stats: null })),
  };
}

export function deserialize(raw) {
  const g = {
    ...raw,
    rng: makeRng(raw.seed),
    unlocked: new Set(raw.unlocked),
    research: new Set(raw.research),
    milestones: new Set(raw.milestones),
    locations: raw.locations.map((l) => ({
      ...l,
      upgrades: new Set(l.upgrades),
      priceLevel: l.priceLevel ?? 1,
      stats: null,
    })),
    today: {
      revenue: 0, cogs: 0, wages: 0, rent: 0, marketing: 0, upkeep: 0,
      interest: 0, tax: 0, profit: 0, customers: 0, sold: 0, lost: 0, byProduct: {},
    },
    companyValue: raw.history?.length ? raw.history[raw.history.length - 1].value : 0,
    staffCount: raw.locations.reduce((a, l) => a + l.staff.length, 0),
    lostShare: 0,
  };
  g.rng.setState(raw.rngState);
  recomputeEffects(g);
  return g;
}

export function save(g) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(serialize(g)));
    return true;
  } catch { return false; }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1) return null;
    return deserialize(parsed);
  } catch { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing to do */ }
}
