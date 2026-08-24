/**
 * Every tunable number of the game world lives here: the menu, the districts,
 * the staff, the upgrades, the campaigns, the events and the milestones.
 *
 * economy.js reads this table and never writes to it. Balancing the game means
 * editing this file and re-running `node tools/balance-tycoon.mjs`.
 */

/* ---------------------------------------------------------------- produkte
 *
 * cost  — Wareneinsatz per sale at quality level 3 (the neutral one).
 * ref   — reference price. The demand curve treats this as "fair"; asking more
 *         costs you customers, asking less buys you volume at a thin margin.
 * prep  — how much staff throughput one sale eats. Everything is measured in
 *         these units, so a Döner really does tie up a pair of hands.
 * appeal— pull relative to the other items of its category.
 * cat   — items compete inside a category, not across it. A second drink
 *         cannibalises the first; a drink next to a main does not.
 */
export const CATEGORIES = {
  main:  { name: 'Hauptgericht', take: 0.200 },
  side:  { name: 'Beilage',      take: 0.140 },
  drink: { name: 'Getränk',      take: 0.240 },
  sweet: { name: 'Süßes',        take: 0.100 },
};

export const PRODUCTS = [
  { id: 'currywurst', name: 'Currywurst',      cat: 'main',  cost: 1.15, ref: 4.80,  prep: 1.0, appeal: 1.00, start: true },
  { id: 'pommes',     name: 'Pommes',          cat: 'side',  cost: 0.55, ref: 3.20,  prep: 0.8, appeal: 1.15, start: true },
  { id: 'softdrink',  name: 'Softdrink',       cat: 'drink', cost: 0.42, ref: 2.80,  prep: 0.2, appeal: 1.00, start: true },
  { id: 'kaffee',     name: 'Filterkaffee',    cat: 'drink', cost: 0.28, ref: 2.40,  prep: 0.4, appeal: 0.85, start: true },
  { id: 'doener',     name: 'Döner',           cat: 'main',  cost: 2.20, ref: 7.00,  prep: 1.5, appeal: 1.35 },
  { id: 'croissant',  name: 'Croissant',       cat: 'sweet', cost: 0.65, ref: 3.00,  prep: 0.4, appeal: 1.05 },
  { id: 'bowl',       name: 'Vegane Bowl',     cat: 'main',  cost: 2.45, ref: 9.50,  prep: 1.5, appeal: 1.10 },
  { id: 'burger',     name: 'Craft-Burger',    cat: 'main',  cost: 3.30, ref: 12.50, prep: 1.9, appeal: 1.45 },
  { id: 'bubbletea',  name: 'Bubble Tea',      cat: 'drink', cost: 0.95, ref: 5.40,  prep: 0.9, appeal: 1.30, trendy: true },
  { id: 'eis',        name: 'Softeis',         cat: 'sweet', cost: 0.35, ref: 2.90,  prep: 0.3, appeal: 1.25, summer: true },
  { id: 'flatwhite',  name: 'Flat White',      cat: 'drink', cost: 0.55, ref: 4.20,  prep: 0.7, appeal: 1.40 },
  { id: 'kuchen',     name: 'Hausgemachter Kuchen', cat: 'sweet', cost: 1.20, ref: 4.60, prep: 0.5, appeal: 1.35 },
];

export const productById = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]));

/* -------------------------------------------------------------- standorte
 *
 * footfall  — passers-by on an average day before season, weekday and weather.
 * rent      — per day, due whether you sell anything or not.
 * wealth    — price tolerance. 1.2 means the district shrugs at prices 20 %
 *             over the reference; 0.75 means it does not.
 * profile   — weekday shape, so a campus dies on Sunday and the promenade
 *             lives for it.
 * capacity  — hard ceiling on staff slots; a kiosk cannot absorb ten people.
 */
export const LOCATIONS = [
  {
    id: 'bahnhof', name: 'Bahnhofsviertel', kind: 'Kiosk',
    footfall: 425, rent: 95, wealth: 0.92, cost: 0, staffSlots: 3,
    profile: 'commuter', summer: 1.0,
    blurb: 'Der erste Laden. Nie leer, nie geduldig.',
  },
  {
    id: 'campus', name: 'Uni-Campus', kind: 'Imbiss',
    footfall: 540, rent: 125, wealth: 0.74, cost: 16000, staffSlots: 4,
    profile: 'campus', summer: 0.85,
    blurb: 'Riesiger Andrang, dünne Geldbeutel. Semesterferien tun weh.',
  },
  {
    id: 'gewerbe', name: 'Gewerbepark Nord', kind: 'Imbiss',
    footfall: 340, rent: 70, wealth: 1.00, cost: 13000, staffSlots: 3,
    profile: 'office', summer: 0.95,
    blurb: 'Mittagsgeschäft wie ein Uhrwerk. Am Wochenende Geisterstadt.',
  },
  {
    id: 'altstadt', name: 'Altstadt', kind: 'Café',
    footfall: 390, rent: 175, wealth: 1.18, cost: 27000, staffSlots: 4,
    profile: 'leisure', summer: 1.15,
    blurb: 'Zahlungskräftig und wählerisch. Hier verzeiht niemand billige Ware.',
  },
  {
    id: 'mall', name: 'Innenstadt-Mall', kind: 'Food-Court',
    footfall: 800, rent: 340, wealth: 1.04, cost: 68000, staffSlots: 6,
    profile: 'retail', summer: 0.9,
    blurb: 'Konstanter Strom, brutale Miete, drei Konkurrenten in Sichtweite.',
  },
  {
    id: 'promenade', name: 'Strandpromenade', kind: 'Kiosk',
    footfall: 650, rent: 205, wealth: 1.10, cost: 44000, staffSlots: 4,
    profile: 'leisure', summer: 1.65,
    blurb: 'Im Sommer Gold, im Januar eine Bruchbude am Wasser.',
  },
  {
    id: 'flughafen', name: 'Flughafen Terminal B', kind: 'Franchise',
    footfall: 950, rent: 430, wealth: 1.34, cost: 95000, staffSlots: 7,
    profile: 'airport', summer: 1.2,
    blurb: 'Gefangene Kundschaft, Preise wie im Märchen, Miete wie im Albtraum.',
  },
  {
    id: 'festival', name: 'Messe & Arena', kind: 'Franchise',
    footfall: 875, rent: 380, wealth: 1.12, cost: 82000, staffSlots: 6,
    profile: 'events', summer: 1.1,
    blurb: 'Alles oder nichts: Veranstaltungstage tragen den ganzen Monat.',
  },
];

export const locationById = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));

/** Weekday shape per profile, Monday first. */
export const WEEKDAY_PROFILES = {
  commuter: [1.10, 1.10, 1.08, 1.10, 1.15, 0.80, 0.55],
  campus:   [1.25, 1.25, 1.20, 1.20, 0.95, 0.45, 0.30],
  office:   [1.20, 1.20, 1.20, 1.18, 1.05, 0.30, 0.20],
  leisure:  [0.75, 0.75, 0.80, 0.90, 1.20, 1.60, 1.45],
  retail:   [0.90, 0.90, 0.95, 1.00, 1.25, 1.55, 0.55],
  airport:  [1.05, 1.00, 1.00, 1.05, 1.20, 1.10, 1.05],
  events:   [0.60, 0.60, 0.70, 0.85, 1.35, 1.80, 1.35],
};

/** Seasonal multiplier per month, January first. Applied with the location's
 *  `summer` weight, so the promenade swings and the airport barely notices. */
export const SEASON = [0.80, 0.82, 0.92, 1.00, 1.08, 1.18, 1.22, 1.20, 1.05, 0.95, 0.88, 1.02];

/* -------------------------------------------------------------- qualität
 *
 * One dial per location. It moves the Wareneinsatz and what the guests think
 * of the food at the same time — the whole cheap-versus-good argument in five
 * steps.
 */
export const QUALITY_TIERS = [
  { level: 1, name: 'Billigware',   costMul: 0.72, quality: 0.68, hygiene: 0.70 },
  { level: 2, name: 'Sparsam',      costMul: 0.86, quality: 0.85, hygiene: 0.85 },
  { level: 3, name: 'Solide',       costMul: 1.00, quality: 1.00, hygiene: 1.00 },
  { level: 4, name: 'Gut',          costMul: 1.22, quality: 1.14, hygiene: 1.08 },
  { level: 5, name: 'Manufaktur',   costMul: 1.55, quality: 1.28, hygiene: 1.15 },
];

/* -------------------------------------------------------------- personal */
export const ROLES = {
  aushilfe: {
    id: 'aushilfe', name: 'Aushilfe', wage: 88, throughput: 62, hire: 300,
    desc: 'Günstig, schnell eingestellt, hält die Schlange gerade so kurz.',
  },
  fachkraft: {
    id: 'fachkraft', name: 'Fachkraft', wage: 152, throughput: 104, hire: 900,
    desc: 'Deutlich mehr Durchsatz und spürbar bessere Qualität.',
  },
  leitung: {
    id: 'leitung', name: 'Filialleitung', wage: 235, throughput: 70, hire: 2200,
    desc: 'Führt die Filiale: +18 % Durchsatz für alle, stabilisiert die Moral.',
  },
};

export const TRAINING = { cost: 1400, gain: 0.14, cap: 1.6 };

/* -------------------------------------------------------------- ausbauten
 *
 * Bought per location, paid once, some carry a daily upkeep.
 */
export const UPGRADES = [
  { id: 'fritteuse',  name: 'Doppelfritteuse',      cost: 4200,  upkeep: 3,  effect: { throughput: 0.14 },
    desc: '+14 % Durchsatz. Der erste Engpass ist immer die Küche.' },
  { id: 'terminal',   name: 'Bestellterminal',      cost: 7800,  upkeep: 6,  effect: { throughput: 0.18, wageEff: 0.05 },
    desc: '+18 % Durchsatz, Personal wird 5 % effizienter.' },
  { id: 'kuehlhaus',  name: 'Kühlhaus',             cost: 5600,  upkeep: 4,  effect: { waste: -0.035 },
    desc: 'Senkt den Verderb deutlich — wirkt bei jedem verkauften Teil.' },
  { id: 'siebtraeger', name: 'Siebträgermaschine',  cost: 6900,  upkeep: 3,  effect: { quality: 0.05, drinkAppeal: 0.28 },
    desc: 'Getränke werden deutlich attraktiver, Qualität steigt leicht.' },
  { id: 'terrasse',   name: 'Außenterrasse',        cost: 12500, upkeep: 9,  effect: { footfall: 0.16, summerFootfall: 0.12 },
    desc: '+16 % Laufkundschaft, im Sommer noch mehr.' },
  { id: 'leuchtwerbung', name: 'Leuchtreklame',     cost: 3400,  upkeep: 2,  effect: { footfall: 0.08, reputationFloor: 4 },
    desc: '+8 % Laufkundschaft und ein Stück Markenbekanntheit.' },
];

export const upgradeById = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

/* ------------------------------------------------------------- forschung
 *
 * Chain-wide unlocks, paid once, available after the given day so the opening
 * weeks stay about the first kiosk.
 */
export const RESEARCH = [
  { id: 'r_doener',   name: 'Dönerspieß & Grill',   cost: 5200,  day: 0,   unlock: 'doener',
    desc: 'Schaltet den Döner frei: der Umsatzträger der frühen Jahre.' },
  { id: 'r_croissant', name: 'Frühstückstheke',     cost: 3600,  day: 0,   unlock: 'croissant',
    desc: 'Schaltet Croissants frei und weckt das Morgengeschäft.' },
  { id: 'r_eis',      name: 'Softeismaschine',      cost: 4800,  day: 20,  unlock: 'eis',
    desc: 'Schaltet Softeis frei — im Sommer ein Selbstläufer.' },
  { id: 'r_flatwhite', name: 'Barista-Schulung',    cost: 9500,  day: 30,  unlock: 'flatwhite',
    desc: 'Schaltet Flat White frei: hohe Marge, kleiner Aufwand.' },
  { id: 'r_bowl',     name: 'Frische-Konzept',      cost: 11000, day: 45,  unlock: 'bowl',
    desc: 'Schaltet die vegane Bowl frei und hebt den Ruf um 4 Punkte.',
    effect: { reputation: 4 } },
  { id: 'r_kuchen',   name: 'Eigene Backstube',     cost: 14000, day: 60,  unlock: 'kuchen',
    desc: 'Schaltet hausgemachten Kuchen frei und senkt den Wareneinsatz um 4 %.',
    effect: { cogs: -0.04 } },
  { id: 'r_bubbletea', name: 'Trendlabor',          cost: 12500, day: 70,  unlock: 'bubbletea',
    desc: 'Schaltet Bubble Tea frei. Der Trend schwankt — beobachte ihn.' },
  { id: 'r_burger',   name: 'Grillstation',         cost: 21000, day: 90,  unlock: 'burger',
    desc: 'Schaltet den Craft-Burger frei: der höchste Deckungsbeitrag im Menü.' },
  { id: 'r_einkauf',  name: 'Zentraleinkauf',       cost: 18000, day: 40,
    desc: 'Senkt den Wareneinsatz aller Filialen um 8 %.', effect: { cogs: -0.08 } },
  { id: 'r_app',      name: 'Liefer-App',           cost: 26000, day: 75,
    desc: '+12 % Nachfrage in allen Filialen, unabhängig vom Wetter.',
    effect: { demand: 0.12 } },
  { id: 'r_schulung', name: 'Qualitätsmanagement',  cost: 16000, day: 55,
    desc: 'Hebt die Qualität überall um 6 % und entschärft Kontrollen.',
    effect: { quality: 0.06, hygiene: 0.15 } },
  { id: 'r_franchise', name: 'Franchise-Handbuch',  cost: 32000, day: 110,
    desc: 'Filialen ab der fünften kosten 20 % weniger in der Eröffnung.',
    effect: { openingDiscount: 0.2 } },
];

export const researchById = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));

/* -------------------------------------------------------------- marketing
 *
 * Campaigns run for a fixed number of days, cost per day, and lift demand
 * chain-wide. Reach stacks with diminishing returns (see economy.js).
 */
export const CAMPAIGNS = [
  { id: 'flyer',   name: 'Flyer im Viertel',   perDay: 45,  days: 10, reach: 0.10, rep: 0,
    desc: 'Billig und kurzatmig. Für den Start völlig in Ordnung.' },
  { id: 'social',  name: 'Social Media',       perDay: 130, days: 20, reach: 0.22, rep: 2,
    desc: 'Solide Reichweite und ein kleiner Ruf-Schub.' },
  { id: 'radio',   name: 'Lokalradio',         perDay: 310, days: 25, reach: 0.34, rep: 3,
    desc: 'Erreicht die halbe Stadt. Lohnt erst ab mehreren Filialen.' },
  { id: 'influ',   name: 'Influencer-Kooperation', perDay: 620, days: 14, reach: 0.55, rep: 6,
    desc: 'Kurz, teuer, laut. Kann eine Eröffnung tragen.' },
  { id: 'sponsor', name: 'Vereinssponsoring',  perDay: 210, days: 60, reach: 0.18, rep: 8,
    desc: 'Langsame Reichweite, dafür der beste Ruf-Aufbau im Spiel.' },
];

export const campaignById = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c]));

/* ------------------------------------------------------------- meilensteine */
export const MILESTONES = [
  { id: 'm_first',   name: 'Zweite Filiale',        test: (g) => g.locations.length >= 2,   reward: 0 },
  { id: 'm_rep70',   name: 'Ruf 70',                test: (g) => g.reputation >= 70,        reward: 2500 },
  { id: 'm_day1k',   name: '1.000 € Tagesgewinn',   test: (g) => g.today.profit >= 1000,    reward: 5000 },
  { id: 'm_five',    name: 'Fünf Filialen',         test: (g) => g.locations.length >= 5,   reward: 10000 },
  { id: 'm_100k',    name: '100.000 € Firmenwert',  test: (g) => g.companyValue >= 100000,  reward: 0 },
  { id: 'm_500k',    name: 'Eine halbe Million',    test: (g) => g.companyValue >= 500000,  reward: 0 },
  { id: 'm_all',     name: 'Alle Standorte',        test: (g) => g.locations.length >= 8,   reward: 25000 },
  { id: 'm_ipo',     name: 'Börsenreif',            test: (g) => g.companyValue >= 2500000, reward: 0 },
];

export const IPO_TARGET = 2500000;

/* ------------------------------------------------------------- ereignisse
 *
 * Rolled once per day. `weight` is relative, `when` gates an event behind a
 * condition, `apply` mutates the game and returns the log line.
 */
export const EVENT_POOL = [
  {
    id: 'hitzewelle', weight: 10, name: 'Hitzewelle',
    apply: (g) => {
      g.modifiers.push({ id: 'hitze', days: g.rng.int(3, 6), label: 'Hitzewelle',
        demand: { drink: 0.55, sweet: 0.40, main: -0.12 } });
      return { tone: 'good', text: 'Hitzewelle angekündigt: Getränke und Eis gehen weg wie nichts.' };
    },
  },
  {
    id: 'dauerregen', weight: 10, name: 'Dauerregen',
    apply: (g) => {
      g.modifiers.push({ id: 'regen', days: g.rng.int(2, 5), label: 'Dauerregen',
        footfall: -0.22 });
      return { tone: 'bad', text: 'Dauerregen: weniger Laufkundschaft, vor allem draußen.' };
    },
  },
  {
    id: 'baustelle', weight: 7, name: 'Baustelle',
    when: (g) => g.locations.length > 0,
    apply: (g) => {
      const loc = g.rng.pick(g.locations);
      g.modifiers.push({ id: 'baustelle', days: g.rng.int(8, 20), label: `Baustelle: ${loc.name}`,
        locationId: loc.id, footfall: -0.35 });
      return { tone: 'bad', text: `Baustelle vor „${loc.name}“: die Hälfte der Laufkundschaft nimmt den Umweg.` };
    },
  },
  {
    id: 'kontrolle', weight: 9, name: 'Kontrolle',
    when: (g) => g.locations.length > 0,
    apply: (g) => {
      const loc = g.rng.pick(g.locations);
      const tier = QUALITY_TIERS[loc.quality - 1];
      const hygiene = tier.hygiene * (1 + g.effects.hygiene) * (0.9 + loc.morale * 0.2);
      if (hygiene < 0.95 && g.rng.chance(0.72)) {
        const fine = Math.round(1200 + g.rng.range(0, 2600));
        g.cash -= fine;
        g.reputation -= 6;
        g.ledger.fines += fine;
        return { tone: 'bad', text: `Lebensmittelkontrolle in „${loc.name}“: Mängel, ${Math.round(fine)} € Bußgeld, Ruf beschädigt.` };
      }
      g.reputation += 2;
      return { tone: 'good', text: `Lebensmittelkontrolle in „${loc.name}“: keine Beanstandung. Der Aushang wirkt.` };
    },
  },
  {
    id: 'viral', weight: 6, name: 'Viraler Post',
    when: (g) => g.reputation > 55,
    apply: (g) => {
      g.modifiers.push({ id: 'viral', days: g.rng.int(4, 9), label: 'Viraler Post', footfall: 0.30 });
      g.reputation += 3;
      return { tone: 'good', text: 'Ein Video eurer Theke geht viral. Für ein paar Tage steht die Schlange um die Ecke.' };
    },
  },
  {
    id: 'shitstorm', weight: 5, name: 'Verriss',
    when: (g) => g.reputation < 55 || g.lostShare > 0.2,
    apply: (g) => {
      g.reputation -= 7;
      return { tone: 'bad', text: 'Ein Verriss macht die Runde: lange Wartezeit, laue Ware. Der Ruf leidet.' };
    },
  },
  {
    id: 'lieferengpass', weight: 8, name: 'Lieferengpass',
    apply: (g) => {
      g.modifiers.push({ id: 'engpass', days: g.rng.int(4, 10), label: 'Lieferengpass', cogs: 0.18 });
      return { tone: 'bad', text: 'Lieferengpass beim Großhändler: der Wareneinsatz steigt vorübergehend um 18 %.' };
    },
  },
  {
    id: 'konkurrenz', weight: 7, name: 'Konkurrenz',
    when: (g) => g.locations.length > 0 && g.day > 25,
    apply: (g) => {
      const loc = g.rng.pick(g.locations);
      loc.competition = Math.min(0.45, loc.competition + 0.12);
      return { tone: 'bad', text: `Neue Konkurrenz neben „${loc.name}“. Ein Teil der Kundschaft probiert erst mal dort.` };
    },
  },
  {
    id: 'konkurrenz_zu', weight: 5, name: 'Konkurrenz schließt',
    when: (g) => g.locations.some((l) => l.competition > 0.05),
    apply: (g) => {
      const loc = g.rng.pick(g.locations.filter((l) => l.competition > 0.05));
      loc.competition = Math.max(0, loc.competition - 0.15);
      return { tone: 'good', text: `Der Laden gegenüber von „${loc.name}“ macht dicht. Die Kundschaft kommt zurück.` };
    },
  },
  {
    id: 'trend', weight: 6, name: 'Trendwelle',
    when: (g) => g.unlocked.has('bubbletea'),
    apply: (g) => {
      const up = g.rng.chance(0.55);
      g.trend = up ? 1.5 : 0.6;
      return {
        tone: up ? 'good' : 'bad',
        text: up
          ? 'Bubble Tea ist plötzlich überall. Der Trend zieht kräftig an.'
          : 'Der Bubble-Tea-Hype flaut ab. Die Nachfrage sackt weg.',
      };
    },
  },
  {
    id: 'grossauftrag', weight: 6, name: 'Großauftrag',
    when: (g) => g.locations.length >= 2 && g.reputation > 50,
    apply: (g) => {
      const gain = Math.round(400 + g.reputation * 22 + g.locations.length * 260);
      g.cash += gain;
      g.ledger.other += gain;
      return { tone: 'good', text: `Catering-Auftrag angenommen: ${gain} € zusätzlich in der Kasse.` };
    },
  },
  {
    id: 'defekt', weight: 8, name: 'Defekt',
    when: (g) => g.locations.length > 0,
    apply: (g) => {
      const loc = g.rng.pick(g.locations);
      const bill = Math.round(500 + g.rng.range(0, 1800));
      g.cash -= bill;
      g.ledger.repairs += bill;
      g.modifiers.push({ id: 'defekt', days: g.rng.int(1, 3), label: `Defekt: ${loc.name}`,
        locationId: loc.id, throughput: -0.3 });
      return { tone: 'bad', text: `Kühlung in „${loc.name}“ ausgefallen: ${bill} € Reparatur, ein paar Tage halbe Kraft.` };
    },
  },
  {
    id: 'krankheit', weight: 7, name: 'Krankheitswelle',
    when: (g) => g.staffCount >= 3,
    apply: (g) => {
      g.modifiers.push({ id: 'krank', days: g.rng.int(3, 7), label: 'Krankheitswelle', throughput: -0.18 });
      return { tone: 'bad', text: 'Krankheitswelle im Team: der Durchsatz sinkt, bis alle zurück sind.' };
    },
  },
  {
    id: 'stadtfest', weight: 6, name: 'Stadtfest',
    apply: (g) => {
      g.modifiers.push({ id: 'fest', days: g.rng.int(2, 4), label: 'Stadtfest', footfall: 0.45 });
      return { tone: 'good', text: 'Stadtfest am Wochenende: die Innenstadt ist voll.' };
    },
  },
  {
    id: 'mieterhoehung', weight: 5, name: 'Mieterhöhung',
    when: (g) => g.locations.length > 0 && g.day > 60,
    apply: (g) => {
      const loc = g.rng.pick(g.locations);
      const before = loc.rent;
      loc.rent = Math.round(loc.rent * 1.08);
      return { tone: 'bad', text: `Mieterhöhung für „${loc.name}“: ${before} € → ${loc.rent} € pro Tag.` };
    },
  },
];
