/**
 * The simulation. One call to `tickDay` advances the world by a business day:
 * footfall, demand, what the kitchen actually manages to serve, the till, the
 * reputation, and whatever the day decides to throw at you.
 *
 * The interface never computes a number itself — it reads what this file left
 * behind in `game.today` and on each location's `stats`.
 */

import {
  CATEGORIES, PRODUCTS, productById, LOCATIONS, locationById,
  WEEKDAY_PROFILES, SEASON, QUALITY_TIERS, ROLES, TRAINING,
  UPGRADES, upgradeById, RESEARCH, researchById, CAMPAIGNS, campaignById,
  MILESTONES, EVENT_POOL, IPO_TARGET,
} from './data.js';
import { clamp, makeRng, calendar, DAYS_PER_MONTH, sum } from './util.js';

/* Rates the whole economy leans on. */
export const RULES = {
  wasteBase: 0.05,        // spoilage on top of the Wareneinsatz
  interestDaily: 0.00028, // ~10,7 % im Jahr
  taxRate: 0.25,          // auf den Monatsgewinn
  creditBase: 25000,
  historyDays: 400,
  logMax: 160,
};

/* ------------------------------------------------------------------ setup */

export function createGame(seed = Math.floor(Math.random() * 1e9)) {
  const g = {
    version: 1,
    seed,
    rng: makeRng(seed),
    firm: 'Meine Kette',
    day: 0,
    cash: 25000,
    debt: 0,
    reputation: 50,
    trend: 1,
    locations: [],
    prices: Object.fromEntries(PRODUCTS.map((p) => [p.id, p.ref])),
    unlocked: new Set(PRODUCTS.filter((p) => p.start).map((p) => p.id)),
    research: new Set(),
    campaigns: [],
    modifiers: [],
    milestones: new Set(),
    ledger: { fines: 0, repairs: 0, other: 0, tax: 0 },
    history: [],
    log: [],
    month: { revenue: 0, profit: 0, cogs: 0, wages: 0, rent: 0, marketing: 0 },
    lastMonth: null,
    today: emptyDay(),
    effects: {},
    companyValue: 0,
    staffCount: 0,
    lostShare: 0,
    over: null,
    nextStaffUid: 1,
  };
  recomputeEffects(g);
  openLocation(g, 'bahnhof', { free: true });
  // A starting crew, otherwise day one is a queue and nothing else.
  hire(g, 'bahnhof', 'aushilfe', { free: true });
  hire(g, 'bahnhof', 'aushilfe', { free: true });
  g.log = [];
  logLine(g, 'info', 'Der Kiosk im Bahnhofsviertel gehört dir. Zwei Aushilfen, 25.000 € auf dem Konto.');
  return g;
}

function emptyDay() {
  return {
    revenue: 0, cogs: 0, wages: 0, rent: 0, marketing: 0, upkeep: 0,
    interest: 0, tax: 0, profit: 0, customers: 0, sold: 0, lost: 0,
    byProduct: {},
  };
}

export function logLine(g, tone, text) {
  g.log.unshift({ day: g.day, tone, text });
  if (g.log.length > RULES.logMax) g.log.length = RULES.logMax;
}

/** Chain-wide effects granted by research. Recomputed rather than accumulated
 *  so loading a save can never drift from a fresh game. */
export function recomputeEffects(g) {
  const e = {
    cogs: 0, quality: 0, demand: 0, hygiene: 0,
    openingDiscount: 0, reputationBonus: 0,
  };
  for (const id of g.research) {
    const r = researchById[id];
    if (!r || !r.effect) continue;
    for (const [k, v] of Object.entries(r.effect)) {
      if (k === 'reputation') continue; // one-off, applied when bought
      e[k] = (e[k] || 0) + v;
    }
  }
  g.effects = e;
}

/* -------------------------------------------------------------- modifiers */

function modsFor(g, locId) {
  const out = { footfall: 0, throughput: 0, cogs: 0, demand: {}, labels: [] };
  for (const m of g.modifiers) {
    if (m.locationId && m.locationId !== locId) continue;
    out.footfall += m.footfall || 0;
    out.throughput += m.throughput || 0;
    out.cogs += m.cogs || 0;
    if (m.demand) for (const [k, v] of Object.entries(m.demand)) out.demand[k] = (out.demand[k] || 0) + v;
    out.labels.push(m.label);
  }
  return out;
}

/** Campaign reach stacks, but three campaigns are not three times one. */
function marketingReach(g) {
  const raw = sum(g.campaigns, (c) => campaignById[c.id].reach);
  return raw <= 0 ? 0 : 1 - Math.exp(-raw) + raw * 0.12;
}

/* ------------------------------------------------------- demand & kitchen */

/** How much a price of `p` sells at, relative to what the district finds fair.
 *  1.0 at the reference price, roughly 1.45 at −30 %, 0.34 at +50 %. */
function priceFactor(pricePaid, reference) {
  const r = pricePaid / reference;
  return 2 / (1 + Math.exp(3.2 * (r - 1)));
}

export function locationThroughput(g, loc) {
  const mods = modsFor(g, loc.id);
  let base = 0;
  let hasLead = false;
  for (const s of loc.staff) {
    const role = ROLES[s.role];
    base += role.throughput * Math.pow(s.skill, 1.15);
    if (s.role === 'leitung') hasLead = true;
  }
  let mul = 1;
  for (const u of loc.upgrades) {
    const up = upgradeById[u];
    if (up?.effect.throughput) mul += up.effect.throughput;
    if (up?.effect.wageEff) mul += up.effect.wageEff;
  }
  if (hasLead) mul += 0.18;
  mul *= clamp(0.8 + loc.morale * 0.3, 0.6, 1.2);
  mul *= clamp(1 + mods.throughput, 0.25, 2);
  return Math.max(0, base * mul);
}

export function locationQuality(g, loc) {
  const tier = QUALITY_TIERS[loc.quality - 1];
  const skill = loc.staff.length
    ? sum(loc.staff, (s) => s.skill) / loc.staff.length
    : 0.8;
  let q = tier.quality * (0.9 + skill * 0.1) * (1 + g.effects.quality);
  for (const u of loc.upgrades) {
    const up = upgradeById[u];
    if (up?.effect.quality) q += up.effect.quality;
  }
  q *= clamp(0.9 + loc.morale * 0.12, 0.85, 1.06);
  return clamp(q, 0.4, 1.7);
}

export function locationFootfall(g, loc) {
  const cal = calendar(g.day);
  const mods = modsFor(g, loc.id);
  const season = 1 + (SEASON[cal.month] - 1) * loc.summer;
  const weekday = WEEKDAY_PROFILES[loc.profile][cal.weekday];
  let upgradeLift = 0;
  const isSummer = cal.month >= 4 && cal.month <= 8;
  for (const u of loc.upgrades) {
    const up = upgradeById[u];
    if (up?.effect.footfall) upgradeLift += up.effect.footfall;
    if (isSummer && up?.effect.summerFootfall) upgradeLift += up.effect.summerFootfall;
  }
  const rep = 0.62 + g.reputation * 0.0076; // Ruf 50 ist neutral
  return loc.footfall
    * season * weekday
    * (1 + upgradeLift)
    * (1 + marketingReach(g))
    * (1 + g.effects.demand)
    * (1 + mods.footfall)
    * (1 - loc.competition)
    * rep;
}

/** One trading day for one location. Pure apart from the RNG and the stats it
 *  writes back onto `loc`. */
function runLocation(g, loc) {
  const mods = modsFor(g, loc.id);
  const tier = QUALITY_TIERS[loc.quality - 1];
  const quality = locationQuality(g, loc);
  const qFactor = 0.45 + 0.55 * quality;
  const footfall = locationFootfall(g, loc) * g.rng.noise(0.12);
  const cal = calendar(g.day);

  let drinkAppeal = 0;
  for (const u of loc.upgrades) {
    const up = upgradeById[u];
    if (up?.effect.drinkAppeal) drinkAppeal += up.effect.drinkAppeal;
  }

  /* Demand, category by category. Items inside a category compete for the
     same appetite; a broader menu lifts the whole category but with sharply
     diminishing returns. */
  const demand = {};
  for (const [catId, cat] of Object.entries(CATEGORIES)) {
    const items = PRODUCTS.filter(
      (p) => p.cat === catId && g.unlocked.has(p.id) && loc.products[p.id],
    );
    if (!items.length) continue;
    const attrs = items.map((p) => {
      let a = p.appeal * qFactor
        * priceFactor(g.prices[p.id] * loc.priceLevel, p.ref * loc.wealth);
      if (p.trendy) a *= g.trend;
      if (p.summer) a *= cal.month >= 4 && cal.month <= 8 ? 1.5 : 0.55;
      if (p.cat === 'drink') a *= 1 + drinkAppeal;
      return Math.max(0.01, a);
    });
    const A = sum(attrs, (x) => x);
    const take = cat.take * (1 - Math.exp(-A)) * (1 + (mods.demand[catId] || 0));
    const customers = Math.max(0, footfall * take);
    items.forEach((p, i) => { demand[p.id] = customers * (attrs[i] / A); });
  }

  const prepNeeded = sum(Object.keys(demand), (id) => demand[id] * productById[id].prep);
  const capacity = locationThroughput(g, loc);
  const serveRatio = prepNeeded > 0 ? Math.min(1, capacity / prepNeeded) : 1;

  let revenue = 0;
  let cogs = 0;
  let units = 0;
  const wasteUp = sum([...loc.upgrades], (u) => upgradeById[u]?.effect.waste || 0);
  const waste = Math.max(0.008, RULES.wasteBase + wasteUp);
  const costMul = tier.costMul * (1 + waste) * (1 + g.effects.cogs) * (1 + mods.cogs);

  const byProduct = {};
  for (const [id, want] of Object.entries(demand)) {
    const p = productById[id];
    const sold = want * serveRatio;
    const rev = sold * g.prices[id] * loc.priceLevel;
    const cost = sold * p.cost * costMul;
    revenue += rev;
    cogs += cost;
    units += sold;
    byProduct[id] = { sold, revenue: rev, margin: rev - cost };
  }

  const wages = sum(loc.staff, (s) => ROLES[s.role].wage * s.skill);
  const upkeep = sum([...loc.upgrades], (u) => upgradeById[u]?.upkeep || 0);
  const lostShare = 1 - serveRatio;

  /* Morale follows the pressure at the counter, not the payslip. */
  const hasLead = loc.staff.some((s) => s.role === 'leitung');
  const target = clamp(
    0.86 + (hasLead ? 0.14 : 0) - lostShare * 0.75 + (g.reputation - 50) / 500,
    0.25, 1.15,
  );
  loc.morale += (target - loc.morale) * 0.12;

  loc.stats = {
    footfall, capacity, prepNeeded, serveRatio, quality,
    revenue, cogs, wages, rent: loc.rent, upkeep, units,
    profit: revenue - cogs - wages - loc.rent - upkeep,
    lost: prepNeeded * lostShare,
    labels: mods.labels,
    byProduct,
  };
  return loc.stats;
}

/* ---------------------------------------------------------------- the day */

export function tickDay(g) {
  if (g.over) return g.today;

  const d = emptyDay();

  for (const loc of g.locations) {
    const s = runLocation(g, loc);
    d.revenue += s.revenue;
    d.cogs += s.cogs;
    d.wages += s.wages;
    d.rent += s.rent;
    d.upkeep += s.upkeep;
    d.sold += s.units;
    d.customers += s.units * 0.62; // Besuche, nicht Artikel
    d.lost += s.lost;
    for (const [id, v] of Object.entries(s.byProduct)) {
      const acc = d.byProduct[id] || (d.byProduct[id] = { sold: 0, revenue: 0, margin: 0 });
      acc.sold += v.sold; acc.revenue += v.revenue; acc.margin += v.margin;
    }
  }

  d.marketing = sum(g.campaigns, (c) => campaignById[c.id].perDay);
  d.interest = g.debt * RULES.interestDaily;
  d.profit = d.revenue - d.cogs - d.wages - d.rent - d.upkeep - d.marketing - d.interest;

  g.cash += d.profit;
  g.lostShare = d.sold + d.lost > 0 ? d.lost / (d.sold + d.lost) : 0;

  /* Reputation chases a target rather than drifting: what you serve, what you
     charge for it, and how long you make people wait settle on an equilibrium,
     and the reputation walks towards it a few percent a day. That way a price
     hike costs you a fixed amount of goodwill instead of everything. */
  const avgQuality = g.locations.length
    ? sum(g.locations, (l) => l.stats.quality) / g.locations.length
    : 1;
  const relPrice = avgRelativePrice(g);
  const campaignRep = sum(g.campaigns, (c) => campaignById[c.id].rep);
  const target = clamp(
    50 + (avgQuality - 1) * 70 + (1 - relPrice) * 30 - g.lostShare * 50 + campaignRep * 1.2,
    0, 100,
  );
  g.reputation += (target - g.reputation) * 0.05;
  g.repTarget = target;
  const floor = sum(g.locations, (l) =>
    sum([...l.upgrades], (u) => upgradeById[u]?.effect.reputationFloor || 0));
  if (floor > 0) g.reputation = Math.max(g.reputation, Math.min(60, 35 + floor));

  /* A competitor next door hurts, but the curiosity wears off. */
  for (const loc of g.locations) loc.competition = Math.max(0, loc.competition - 0.0025);

  /* Campaigns and temporary modifiers age by one day. */
  g.campaigns = g.campaigns.filter((c) => --c.daysLeft > 0);
  g.modifiers = g.modifiers.filter((m) => --m.days > 0);
  if (g.trend !== 1) g.trend += (1 - g.trend) * 0.06;

  rollEvent(g);

  /* Overdraft: the bank covers a shortfall, at a price. */
  if (g.cash < 0) {
    g.debt += -g.cash;
    g.cash = 0;
  }

  g.month.revenue += d.revenue;
  g.month.profit += d.profit;
  g.month.cogs += d.cogs;
  g.month.wages += d.wages;
  g.month.rent += d.rent + d.upkeep;
  g.month.marketing += d.marketing;

  g.day += 1;
  g.staffCount = sum(g.locations, (l) => l.staff.length);
  g.today = d;
  g.companyValue = companyValue(g);

  /* Month end: taxes and a closing statement. */
  if (g.day % DAYS_PER_MONTH === 0) closeMonth(g, d);

  checkMilestones(g);

  g.history.push({
    day: g.day, cash: g.cash, debt: g.debt, revenue: d.revenue,
    profit: d.profit, value: g.companyValue, reputation: g.reputation,
  });
  if (g.history.length > RULES.historyDays) g.history.shift();

  if (g.debt > creditLimit(g) * 1.35) {
    g.over = 'bankrott';
    logLine(g, 'bad', `Die Bank zieht die Linie: ${Math.round(g.debt)} € Schulden ohne Deckung. Insolvenz.`);
  } else if (g.companyValue >= IPO_TARGET && !g.over) {
    g.over = 'boerse';
    logLine(g, 'good', 'Firmenwert über 2,5 Mio. €. Der Börsengang steht — du hast gewonnen.');
  }

  return d;
}

function closeMonth(g, d) {
  const taxable = Math.max(0, g.month.profit);
  const tax = taxable * RULES.taxRate;
  g.cash -= tax;
  g.ledger.tax += tax;
  d.tax = tax;
  g.lastMonth = { ...g.month, tax, day: g.day };
  const c = calendar(g.day - 1);
  logLine(
    g, g.month.profit >= 0 ? 'info' : 'bad',
    `Monatsabschluss ${c.monthName}: Umsatz ${Math.round(g.month.revenue)} €, ` +
    `Gewinn ${Math.round(g.month.profit)} €, Steuer ${Math.round(tax)} €.`,
  );
  g.month = { revenue: 0, profit: 0, cogs: 0, wages: 0, rent: 0, marketing: 0 };
}

function rollEvent(g) {
  // Roughly one event every five days, a little more once the chain is big.
  const p = 0.16 + Math.min(0.12, g.locations.length * 0.02);
  if (!g.rng.chance(p)) return;
  const pool = EVENT_POOL.filter((e) => !e.when || e.when(g));
  if (!pool.length) return;
  const total = sum(pool, (e) => e.weight);
  let r = g.rng() * total;
  for (const e of pool) {
    r -= e.weight;
    if (r <= 0) {
      const res = e.apply(g);
      if (res) logLine(g, res.tone, res.text);
      return;
    }
  }
}

function checkMilestones(g) {
  for (const m of MILESTONES) {
    if (g.milestones.has(m.id)) continue;
    if (!m.test(g)) continue;
    g.milestones.add(m.id);
    if (m.reward) {
      g.cash += m.reward;
      g.ledger.other += m.reward;
      logLine(g, 'good', `Meilenstein: ${m.name}. Prämie ${m.reward} €.`);
    } else {
      logLine(g, 'good', `Meilenstein erreicht: ${m.name}.`);
    }
  }
}

/* --------------------------------------------------------------- readouts */

/** What the chain charges relative to what its districts consider fair. Feeds
 *  the reputation target, so a chain of premium-priced shops has to earn the
 *  goodwill back with quality. */
export function avgRelativePrice(g) {
  const active = PRODUCTS.filter((p) => g.unlocked.has(p.id));
  if (!active.length) return 1;
  const menu = sum(active, (p) => g.prices[p.id] / p.ref) / active.length;
  const level = g.locations.length
    ? sum(g.locations, (l) => l.priceLevel / l.wealth) / g.locations.length
    : 1;
  return menu * level;
}

export function setPriceLevel(g, locId, value) {
  const loc = g.locations.find((l) => l.id === locId);
  if (!loc) return { ok: false, msg: 'Standort unbekannt.' };
  loc.priceLevel = clamp(Math.round(value * 100) / 100, 0.7, 1.6);
  return { ok: true, msg: '' };
}

export function creditLimit(g) {
  return RULES.creditBase + sum(g.locations, (l) => l.invest * 0.5);
}

export function companyValue(g) {
  const assets = sum(g.locations, (l) => l.invest * 0.75);
  const window = g.history.slice(-30);
  const avgProfit = window.length ? sum(window, (h) => h.profit) / window.length : 0;
  return g.cash - g.debt + assets + Math.max(0, avgProfit) * 220;
}

export function dailyFixedCosts(g) {
  return sum(g.locations, (l) => l.rent + sum([...l.upgrades], (u) => upgradeById[u]?.upkeep || 0))
    + sum(g.locations, (l) => sum(l.staff, (s) => ROLES[s.role].wage * s.skill))
    + sum(g.campaigns, (c) => campaignById[c.id].perDay)
    + g.debt * RULES.interestDaily;
}

export function openingCost(g, defId) {
  const def = locationById[defId];
  if (!def) return Infinity;
  const discount = g.locations.length >= 4 ? g.effects.openingDiscount : 0;
  return Math.round(def.cost * (1 - discount));
}

/* ---------------------------------------------------------------- actions
 *
 * Every one of these returns { ok, msg }. The interface shows `msg` and does
 * not need to know why something was refused.
 */

export function openLocation(g, defId, opts = {}) {
  const def = locationById[defId];
  if (!def) return { ok: false, msg: 'Unbekannter Standort.' };
  if (g.locations.some((l) => l.id === defId)) return { ok: false, msg: 'Gehört dir bereits.' };
  const cost = opts.free ? 0 : openingCost(g, defId);
  if (g.cash < cost) return { ok: false, msg: `Zu wenig Geld: ${Math.round(cost)} € nötig.` };
  g.cash -= cost;
  g.locations.push({
    id: def.id, name: def.name, kind: def.kind,
    footfall: def.footfall, rent: def.rent, wealth: def.wealth,
    profile: def.profile, summer: def.summer, staffSlots: def.staffSlots,
    quality: 3, priceLevel: 1, competition: 0, morale: 0.9, invest: Math.max(cost, def.cost, 6000),
    staff: [], upgrades: new Set(),
    products: Object.fromEntries(PRODUCTS.filter((p) => p.start).map((p) => [p.id, true])),
    stats: null,
  });
  if (!opts.free) {
    logLine(g, 'good',
      `„${def.name}“ eröffnet — ${Math.round(cost)} € investiert. Ohne Personal ` +
      'steht die Theke still und die Miete läuft trotzdem.');
  }
  return { ok: true, msg: `„${def.name}“ eröffnet — jetzt Personal einstellen.` };
}

export function closeLocation(g, locId) {
  const i = g.locations.findIndex((l) => l.id === locId);
  if (i < 0) return { ok: false, msg: 'Standort unbekannt.' };
  if (g.locations.length === 1) return { ok: false, msg: 'Die letzte Filiale kannst du nicht schließen.' };
  const loc = g.locations[i];
  const payout = Math.round(loc.invest * 0.45);
  g.cash += payout;
  g.locations.splice(i, 1);
  logLine(g, 'info', `„${loc.name}“ geschlossen. Ablöse ${payout} €, Team entlassen.`);
  return { ok: true, msg: `Geschlossen, ${payout} € zurück.` };
}

export function hire(g, locId, roleId, opts = {}) {
  const loc = g.locations.find((l) => l.id === locId);
  const role = ROLES[roleId];
  if (!loc || !role) return { ok: false, msg: 'Geht nicht.' };
  if (loc.staff.length >= loc.staffSlots) return { ok: false, msg: 'Kein Platz mehr hinter der Theke.' };
  if (roleId === 'leitung' && loc.staff.some((s) => s.role === 'leitung')) {
    return { ok: false, msg: 'Eine Leitung pro Filiale reicht.' };
  }
  const cost = opts.free ? 0 : role.hire;
  if (g.cash < cost) return { ok: false, msg: `Einstellung kostet ${cost} €.` };
  g.cash -= cost;
  loc.staff.push({ uid: g.nextStaffUid++, role: roleId, skill: 1 });
  return { ok: true, msg: `${role.name} eingestellt.` };
}

export function fire(g, locId, uid) {
  const loc = g.locations.find((l) => l.id === locId);
  if (!loc) return { ok: false, msg: 'Standort unbekannt.' };
  const i = loc.staff.findIndex((s) => s.uid === uid);
  if (i < 0) return { ok: false, msg: 'Person nicht gefunden.' };
  const s = loc.staff[i];
  const severance = Math.round(ROLES[s.role].wage * 4 * s.skill);
  g.cash -= severance;
  loc.staff.splice(i, 1);
  loc.morale = Math.max(0.3, loc.morale - 0.08);
  return { ok: true, msg: `Entlassen. Abfindung ${severance} €.` };
}

export function train(g, locId, uid) {
  const loc = g.locations.find((l) => l.id === locId);
  const s = loc?.staff.find((x) => x.uid === uid);
  if (!s) return { ok: false, msg: 'Person nicht gefunden.' };
  if (s.skill >= TRAINING.cap - 1e-6) return { ok: false, msg: 'Da geht nichts mehr rauf.' };
  if (g.cash < TRAINING.cost) return { ok: false, msg: `Schulung kostet ${TRAINING.cost} €.` };
  g.cash -= TRAINING.cost;
  s.skill = Math.min(TRAINING.cap, s.skill + TRAINING.gain);
  return { ok: true, msg: 'Geschult: mehr Durchsatz, etwas höherer Lohn.' };
}

export function buyUpgrade(g, locId, upId) {
  const loc = g.locations.find((l) => l.id === locId);
  const up = upgradeById[upId];
  if (!loc || !up) return { ok: false, msg: 'Geht nicht.' };
  if (loc.upgrades.has(upId)) return { ok: false, msg: 'Schon eingebaut.' };
  if (g.cash < up.cost) return { ok: false, msg: `Kostet ${up.cost} €.` };
  g.cash -= up.cost;
  loc.upgrades.add(upId);
  loc.invest += up.cost;
  logLine(g, 'info', `„${loc.name}“: ${up.name} eingebaut.`);
  return { ok: true, msg: `${up.name} eingebaut.` };
}

export function doResearch(g, rid) {
  const r = researchById[rid];
  if (!r) return { ok: false, msg: 'Unbekannt.' };
  if (g.research.has(rid)) return { ok: false, msg: 'Bereits entwickelt.' };
  if (g.day < r.day) return { ok: false, msg: `Erst ab Tag ${r.day} verfügbar.` };
  if (g.cash < r.cost) return { ok: false, msg: `Kostet ${r.cost} €.` };
  g.cash -= r.cost;
  g.research.add(rid);
  if (r.unlock) {
    g.unlocked.add(r.unlock);
    // New items go live everywhere; switching them off again is one click.
    for (const loc of g.locations) loc.products[r.unlock] = true;
  }
  if (r.effect?.reputation) g.reputation = clamp(g.reputation + r.effect.reputation, 0, 100);
  recomputeEffects(g);
  logLine(g, 'good', `Entwicklung abgeschlossen: ${r.name}.`);
  return { ok: true, msg: `${r.name} abgeschlossen.` };
}

export function startCampaign(g, cid) {
  const c = campaignById[cid];
  if (!c) return { ok: false, msg: 'Unbekannt.' };
  if (g.campaigns.some((x) => x.id === cid)) return { ok: false, msg: 'Läuft bereits.' };
  if (g.cash < c.perDay * 3) return { ok: false, msg: 'Zu wenig Puffer für die Kampagne.' };
  g.campaigns.push({ id: cid, daysLeft: c.days });
  logLine(g, 'info', `Kampagne gestartet: ${c.name} (${c.days} Tage, ${c.perDay} €/Tag).`);
  return { ok: true, msg: `${c.name} läuft.` };
}

export function stopCampaign(g, cid) {
  g.campaigns = g.campaigns.filter((c) => c.id !== cid);
  return { ok: true, msg: 'Kampagne beendet.' };
}

export function setPrice(g, pid, value) {
  const p = productById[pid];
  if (!p) return { ok: false, msg: 'Unbekannt.' };
  g.prices[pid] = clamp(Math.round(value * 20) / 20, 0.2, p.ref * 3);
  return { ok: true, msg: '' };
}

export function setQuality(g, locId, level) {
  const loc = g.locations.find((l) => l.id === locId);
  if (!loc) return { ok: false, msg: 'Standort unbekannt.' };
  loc.quality = clamp(Math.round(level), 1, 5);
  return { ok: true, msg: '' };
}

export function toggleProduct(g, locId, pid) {
  const loc = g.locations.find((l) => l.id === locId);
  if (!loc || !g.unlocked.has(pid)) return { ok: false, msg: 'Noch nicht freigeschaltet.' };
  loc.products[pid] = !loc.products[pid];
  return { ok: true, msg: '' };
}

export function takeLoan(g, amount) {
  const room = creditLimit(g) - g.debt;
  const amt = Math.min(Math.max(0, Math.round(amount)), Math.round(room));
  if (amt <= 0) return { ok: false, msg: 'Die Bank gibt nichts mehr her.' };
  g.debt += amt;
  g.cash += amt;
  logLine(g, 'info', `Kredit aufgenommen: ${amt} €.`);
  return { ok: true, msg: `${amt} € aufgenommen.` };
}

export function repayLoan(g, amount) {
  const amt = Math.min(Math.max(0, Math.round(amount)), Math.round(g.debt), Math.round(g.cash));
  if (amt <= 0) return { ok: false, msg: 'Dafür fehlt das Geld.' };
  g.debt -= amt;
  g.cash -= amt;
  return { ok: true, msg: `${amt} € getilgt.` };
}
