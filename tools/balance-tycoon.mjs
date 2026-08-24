/**
 * Headless balance harness for the tycoon.
 *
 *   node tools/balance-tycoon.mjs [days] [runs]
 *
 * Plays the same economy the browser plays, with three very different hands on
 * the wheel, and prints where each one ends up. The point is to check that
 * doing nothing stagnates, that a naive price hike is not a free win, and that
 * a competent operator reaches the IPO in a few in-game years — without ever
 * opening the browser.
 */

import {
  createGame, tickDay, hire, train, buyUpgrade, doResearch, startCampaign,
  openLocation, setPrice, setQuality, setPriceLevel, locationThroughput,
  openingCost, dailyFixedCosts, takeLoan, repayLoan,
} from '../tycoon/src/economy.js';
import { PRODUCTS, LOCATIONS, RESEARCH, UPGRADES, ROLES, CAMPAIGNS } from '../tycoon/src/data.js';

const DAYS = Number(process.argv[2] || 720);
const RUNS = Number(process.argv[3] || 12);

/* ------------------------------------------------------------- strategies */

const idle = { name: 'Nichtstun', play() {} };

const naive = {
  name: 'Nur Preise hoch',
  play(g) {
    if (g.day !== 1) return;
    for (const p of PRODUCTS) setPrice(g, p.id, p.ref * 1.25);
  },
};

/** A competent-but-not-clairvoyant operator: keeps the counter staffed, marks
 *  up modestly, researches what is affordable, expands when the cash cushion
 *  covers it, and keeps one campaign running. */
const operator = {
  name: 'Guter Spieler',
  play(g) {
    if (g.day === 1) {
      for (const p of PRODUCTS) setPrice(g, p.id, p.ref * 1.12);
      setQuality(g, 'bahnhof', 4);
      setPriceLevel(g, 'bahnhof', 0.92);
    }
    if (g.day % 3 !== 0) return;

    const buffer = dailyFixedCosts(g) * 12;

    // 1. Staff every counter that is turning customers away.
    for (const loc of g.locations) {
      const s = loc.stats;
      if (!s) continue;
      if (s.serveRatio < 0.96 && loc.staff.length < loc.staffSlots && g.cash > buffer) {
        const role = g.cash > buffer * 2.2 ? 'fachkraft' : 'aushilfe';
        hire(g, loc.id, role);
      }
      // An idle counter is money on fire.
      if (s.serveRatio > 0.999 && s.prepNeeded < locationThroughput(g, loc) * 0.55
          && loc.staff.length > 1) {
        const weakest = [...loc.staff].sort((a, b) => a.skill - b.skill)[0];
        if (loc.staff.length > 2) require_fire(g, loc, weakest);
      }
    }

    // 2. Research, cheapest first, while it stays affordable.
    for (const r of RESEARCH) {
      if (g.research.has(r.id) || g.day < r.day) continue;
      if (g.cash > r.cost + buffer) { doResearch(g, r.id); break; }
    }

    // 3. Expand first — a new district out-earns any single machine.
    const owned = new Set(g.locations.map((l) => l.id));
    const next = LOCATIONS.filter((l) => !owned.has(l.id))
      .sort((a, b) => a.cost - b.cost)[0];
    if (next && g.cash > openingCost(g, next.id) + buffer * 1.5) {
      openLocation(g, next.id);
      const loc = g.locations[g.locations.length - 1];
      setQuality(g, loc.id, 4);
      // Charge what the district can bear, not what the head office wants.
      setPriceLevel(g, loc.id, Math.max(0.72, loc.wealth * 0.86));
      hire(g, loc.id, 'aushilfe');
      hire(g, loc.id, 'aushilfe');
    }

    // 4. Upgrades where the counter is the bottleneck.
    for (const loc of g.locations) {
      for (const u of UPGRADES) {
        if (loc.upgrades.has(u.id)) continue;
        if (g.cash > u.cost + buffer * 2.5) { buyUpgrade(g, loc.id, u.id); break; }
      }
    }

    // 5. Keep exactly one campaign alive.
    if (!g.campaigns.length) {
      const affordable = CAMPAIGNS.filter((c) => c.perDay * c.days < g.cash * 0.12)
        .sort((a, b) => b.reach - a.reach)[0];
      if (affordable) startCampaign(g, affordable.id);
    }

    // 6. Pay the bank back when it is cheap to do so.
    if (g.debt > 0 && g.cash > buffer * 3) repayLoan(g, Math.min(g.debt, g.cash - buffer * 2));
  },
};

function require_fire(g, loc, s) {
  // Local import avoidance: firing is rare enough to inline the rule.
  const i = loc.staff.indexOf(s);
  if (i >= 0 && loc.staff.length > 1) loc.staff.splice(i, 1);
}

/* ------------------------------------------------------------------- run */

function run(strategy, seed) {
  const g = createGame(seed);
  let bankruptDay = null;
  let ipoDay = null;
  let minCash = g.cash;
  for (let i = 0; i < DAYS && !g.over; i++) {
    strategy.play(g);
    tickDay(g);
    minCash = Math.min(minCash, g.cash - g.debt);
  }
  if (g.over === 'bankrott') bankruptDay = g.day;
  if (g.over === 'boerse') ipoDay = g.day;
  return {
    value: g.companyValue, cash: g.cash, debt: g.debt, rep: g.reputation,
    locs: g.locations.length, staff: g.staffCount, day: g.day,
    profit: g.today.profit, bankruptDay, ipoDay, minCash,
    served: g.today.sold, lost: g.lostShare,
  };
}

const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0));

for (const s of [idle, naive, operator]) {
  const rows = [];
  for (let i = 0; i < RUNS; i++) rows.push(run(s, 1000 + i * 37));
  const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  const med = (f) => rows.map(f).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
  const bankrupt = rows.filter((r) => r.bankruptDay).length;
  const ipo = rows.filter((r) => r.ipoDay);
  console.log(
    `${s.name.padEnd(16)} ` +
    `Wert ⌀${fmt(avg((r) => r.value)).padStart(6)} med ${fmt(med((r) => r.value)).padStart(6)} | ` +
    `Filialen ${avg((r) => r.locs).toFixed(1)} | Ruf ${avg((r) => r.rep).toFixed(0)} | ` +
    `Gewinn/Tag ${fmt(avg((r) => r.profit)).padStart(5)} | ` +
    `Schulden ${fmt(avg((r) => r.debt)).padStart(5)} | ` +
    `Pleiten ${bankrupt}/${RUNS} | ` +
    `Börsengang ${ipo.length}/${RUNS}` +
    (ipo.length ? ` (⌀ Tag ${Math.round(ipo.reduce((a, r) => a + r.ipoDay, 0) / ipo.length)})` : ''),
  );
}
