/**
 * The whole interface. Six tabs over one game object.
 *
 * Rendering is deliberately dumb: each tab builds a string, the container gets
 * it, and clicks are caught by delegation on `[data-act]`. At this size that is
 * faster to read — and to change — than any diffing scheme, with one exception
 * handled explicitly below: a slider must not be rebuilt while a thumb is
 * under the player's finger.
 */

import {
  PRODUCTS, productById, CATEGORIES, LOCATIONS, locationById, QUALITY_TIERS,
  ROLES, TRAINING, UPGRADES, upgradeById, RESEARCH, CAMPAIGNS, campaignById,
  MILESTONES, IPO_TARGET,
} from './data.js';
import {
  hire, fire, train, buyUpgrade, doResearch, startCampaign, stopCampaign,
  openLocation, closeLocation, setPrice, setPriceLevel, setQuality,
  toggleProduct, takeLoan, repayLoan, locationThroughput, openingCost,
  dailyFixedCosts, creditLimit, avgRelativePrice, RULES,
} from './economy.js';
import { money, price, num, num1, pct, dateLabel, clamp, sum, signed } from './util.js';
import { drawChart } from './chart.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createUI(host, api) {
  const ui = {
    tab: 'uebersicht',
    loc: 'bahnhof',
    dragging: false,
    toastTimer: 0,
  };

  // Toast and modal sit outside the app container — they overlay the page —
  // so they are looked up on the document, and so are the listeners below.
  const el = {
    hud: host.querySelector('#hud'),
    stageBar: host.querySelector('#stage-bar'),
    tabs: host.querySelector('#tabs'),
    view: host.querySelector('#view'),
    feed: host.querySelector('#feed'),
    toast: document.querySelector('#toast'),
    modal: document.querySelector('#modal'),
  };

  const TABS = [
    ['uebersicht', 'Übersicht'],
    ['filialen', 'Filialen'],
    ['menue', 'Menü'],
    ['marketing', 'Marketing'],
    ['forschung', 'Entwicklung'],
    ['finanzen', 'Finanzen'],
  ];

  /* ------------------------------------------------------------- chrome */

  function renderHud(g) {
    const profit = g.today.profit;
    const speeds = [['0', '‖'], ['1', '▸'], ['2', '▸▸'], ['3', '▸▸▸']];
    el.hud.innerHTML = `
      <div class="hud-left">
        <input id="firm" class="firm" value="${esc(g.firm)}" maxlength="28"
               data-act="rename" aria-label="Name der Kette">
        <div class="date">${dateLabel(g.day)}${g.over ? ' · beendet' : ''}</div>
      </div>
      <div class="hud-stats">
        ${stat('Kasse', money(g.cash), g.cash < 2000 ? 'warn' : '')}
        ${stat('Gewinn / Tag', signed(profit), profit >= 0 ? 'good' : 'bad')}
        ${stat('Ruf', num(g.reputation), g.reputation >= 60 ? 'good' : g.reputation < 40 ? 'bad' : '')}
        ${stat('Firmenwert', money(g.companyValue), '')}
      </div>
      <div class="speeds" role="group" aria-label="Geschwindigkeit">
        ${speeds.map(([v, label]) => `
          <button data-act="speed" data-v="${v}"
                  class="${api.getSpeed() === Number(v) ? 'on' : ''}"
                  title="${v === '0' ? 'Pause (Leertaste)' : `Tempo ${v}`}">${label}</button>`).join('')}
      </div>`;
  }

  const stat = (label, value, tone) => `
    <div class="stat ${tone}">
      <span class="stat-label">${label}</span>
      <span class="stat-value">${value}</span>
    </div>`;

  function renderTabs() {
    el.tabs.innerHTML = TABS.map(([id, label]) => `
      <button data-act="tab" data-v="${id}" class="${ui.tab === id ? 'on' : ''}">${label}</button>`)
      .join('');
  }

  /** The strip under the scene: which branch you are watching, and what the
   *  weather and the campaigns are doing to it right now. */
  function renderStageBar(g) {
    if (!el.stageBar) return;
    const loc = g.locations.find((l) => l.id === ui.loc) || g.locations[0];
    const labels = [...new Set([
      ...g.modifiers.filter((m) => !m.locationId || m.locationId === loc?.id).map((m) => m.label),
      ...g.campaigns.map((c) => campaignById[c.id].name),
    ])];
    el.stageBar.innerHTML = `
      ${g.locations.map((l) => `
        <button class="chip ${l.id === ui.loc ? 'on' : ''}" data-act="goloc" data-loc="${l.id}"
                title="Diese Filiale ansehen">${esc(l.name)}</button>`).join('')}
      ${labels.length ? `<span class="weather">${labels.map(esc).join(' · ')}</span>` : ''}
      <span class="note">Die Szene zeigt einen Ausschnitt des Tages — Andrang,
        Schlange und Tempo entsprechen den echten Zahlen.</span>`;
  }

  function renderFeed(g) {
    el.feed.innerHTML = `
      <h2>Geschehen</h2>
      <ol class="log">
        ${g.log.slice(0, 40).map((l) => `
          <li class="log-${l.tone}"><span class="log-day">T${l.day}</span> ${esc(l.text)}</li>`).join('')}
      </ol>`;
  }

  /* ---------------------------------------------------------- übersicht */

  function viewUebersicht(g) {
    const fixed = dailyFixedCosts(g);
    const margin = g.today.revenue > 0
      ? (g.today.revenue - g.today.cogs) / g.today.revenue : 0;
    const done = MILESTONES.filter((m) => g.milestones.has(m.id)).length;

    return `
      <section class="panel">
        <div class="chart-wrap"><canvas id="chart"></canvas></div>
      </section>

      <section class="grid grid-4">
        ${card('Umsatz gestern', money(g.today.revenue),
    `${num(g.today.sold)} Artikel verkauft`)}
        ${card('Fixkosten / Tag', money(fixed),
    'Miete, Löhne, Werbung, Zinsen')}
        ${card('Rohertragsmarge', pct(margin, 0),
    `Wareneinsatz ${money(g.today.cogs)}`)}
        ${card('Verlorene Gäste', pct(g.lostShare, 0),
    g.lostShare > 0.08 ? 'Die Schlange ist zu lang — mehr Personal.' : 'Die Theke kommt mit.')}
      </section>

      <section class="grid grid-2">
        <div class="panel">
          <h2>Filialen</h2>
          <table class="table">
            <thead><tr><th>Standort</th><th>Auslastung</th><th>Umsatz</th><th>Gewinn</th></tr></thead>
            <tbody>
              ${g.locations.map((l) => {
    const s = l.stats;
    const load = s ? s.prepNeeded / Math.max(1, s.capacity) : 0;
    return `<tr>
                  <td><button class="link" data-act="goloc" data-loc="${l.id}">${esc(l.name)}</button></td>
                  <td class="${load > 1 ? 'bad' : load < 0.5 ? 'dim' : ''}">${s ? pct(Math.min(load, 2), 0) : '—'}</td>
                  <td>${s ? money(s.revenue) : '—'}</td>
                  <td class="${s && s.profit < 0 ? 'bad' : 'good'}">${s ? signed(s.profit) : '—'}</td>
                </tr>`;
  }).join('')}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <h2>Ziele <span class="dim">${done}/${MILESTONES.length}</span></h2>
          <ul class="checks">
            ${MILESTONES.map((m) => `
              <li class="${g.milestones.has(m.id) ? 'done' : ''}">
                <span class="box">${g.milestones.has(m.id) ? '✓' : ''}</span>
                ${esc(m.name)}${m.reward ? ` <span class="dim">· ${money(m.reward)}</span>` : ''}
              </li>`).join('')}
          </ul>
          <p class="hint">Börsengang bei einem Firmenwert von ${money(IPO_TARGET)}.
            Aktuell ${pct(clamp(g.companyValue / IPO_TARGET, 0, 1), 0)}.</p>
          <div class="bar"><i style="width:${clamp(g.companyValue / IPO_TARGET, 0, 1) * 100}%"></i></div>
        </div>
      </section>

      ${g.modifiers.length ? `
        <section class="panel">
          <h2>Läuft gerade</h2>
          <div class="chips">
            ${g.modifiers.map((m) => `<span class="chip">${esc(m.label)} <b>${m.days} T</b></span>`).join('')}
            ${g.campaigns.map((c) => `<span class="chip on">${esc(campaignById[c.id].name)} <b>${c.daysLeft} T</b></span>`).join('')}
          </div>
        </section>` : ''}
    `;
  }

  const card = (label, value, note) => `
    <div class="panel card">
      <span class="card-label">${label}</span>
      <span class="card-value">${value}</span>
      <span class="card-note">${note}</span>
    </div>`;

  /* ----------------------------------------------------------- filialen */

  function viewFilialen(g) {
    const loc = g.locations.find((l) => l.id === ui.loc) || g.locations[0];
    if (loc) ui.loc = loc.id;
    const owned = new Set(g.locations.map((l) => l.id));
    const available = LOCATIONS.filter((l) => !owned.has(l.id));

    return `
      <section class="panel">
        <div class="chips">
          ${g.locations.map((l) => `
            <button class="chip ${l.id === ui.loc ? 'on' : ''}" data-act="goloc" data-loc="${l.id}">
              ${esc(l.name)} ${l.stats ? `<b class="${l.stats.profit < 0 ? 'bad' : 'good'}">${signed(l.stats.profit)}</b>` : ''}
            </button>`).join('')}
        </div>
      </section>
      ${loc ? locationDetail(g, loc) : ''}
      <section class="panel">
        <h2>Neue Standorte</h2>
        ${available.length ? `<div class="grid grid-2">
          ${available.map((d) => {
    const cost = openingCost(g, d.id);
    const afford = g.cash >= cost;
    return `<div class="offer">
              <div class="offer-head">
                <b>${esc(d.name)}</b><span class="dim">${d.kind}</span>
              </div>
              <p class="dim">${esc(d.blurb)}</p>
              <div class="kv">
                <span>Laufkundschaft</span><b>${num(d.footfall)} / Tag</b>
                <span>Miete</span><b>${money(d.rent)} / Tag</b>
                <span>Kaufkraft</span><b>${num1(d.wealth * 100)} %</b>
                <span>Theken-Plätze</span><b>${d.staffSlots}</b>
              </div>
              <button class="primary" data-act="open" data-loc="${d.id}" ${afford ? '' : 'disabled'}>
                Eröffnen · ${money(cost)}
              </button>
            </div>`;
  }).join('')}
        </div>` : '<p class="hint">Alle Standorte gehören dir. Es gibt nichts mehr zu erobern.</p>'}
      </section>`;
  }

  function locationDetail(g, loc) {
    const s = loc.stats;
    const cap = locationThroughput(g, loc);
    const load = s ? s.prepNeeded / Math.max(1, cap) : 0;
    const tier = QUALITY_TIERS[loc.quality - 1];
    const def = locationById[loc.id];

    return `
      <section class="grid grid-2">
        <div class="panel">
          <h2>${esc(loc.name)} <span class="dim">${loc.kind}</span></h2>
          <div class="kv">
            <span>Laufkundschaft</span><b>${s ? num(s.footfall) : '—'} / Tag</b>
            <span>Verkauft</span><b>${s ? num(s.units) : '—'} Artikel</b>
            <span>Umsatz</span><b>${s ? money(s.revenue) : '—'}</b>
            <span>Wareneinsatz</span><b>${s ? money(s.cogs) : '—'}</b>
            <span>Löhne</span><b>${s ? money(s.wages) : '—'}</b>
            <span>Miete + Betrieb</span><b>${money(loc.rent + (s ? s.upkeep : 0))}</b>
            <span>Ergebnis</span><b class="${s && s.profit < 0 ? 'bad' : 'good'}">${s ? signed(s.profit) : '—'}</b>
            <span>Auslastung</span><b class="${load > 1 ? 'bad' : ''}">${pct(Math.min(load, 2), 0)}</b>
            <span>Stimmung</span><b>${pct(clamp(loc.morale, 0, 1.2), 0)}</b>
            <span>Konkurrenzdruck</span><b class="${loc.competition > 0.2 ? 'bad' : ''}">${pct(loc.competition, 0)}</b>
          </div>
          ${load > 1 ? '<p class="warn-line">Die Theke ist überlaufen: Gäste gehen wieder. Personal einstellen oder Ausbau kaufen.</p>' : ''}
          ${load < 0.45 && loc.staff.length > 1 ? '<p class="hint">Viel Leerlauf hinter der Theke. Ein Mensch weniger spart Lohn.</p>' : ''}
        </div>

        <div class="panel">
          <h2>Stellschrauben</h2>
          <label class="field">
            <span>Zutatenqualität — <b>${tier.name}</b>
              <span class="dim">Wareneinsatz ${pct(tier.costMul - 1, 0)}</span></span>
            <input type="range" min="1" max="5" step="1" value="${loc.quality}"
                   data-act="quality" data-loc="${loc.id}">
          </label>
          <label class="field">
            <span>Preisniveau — <b>${pct(loc.priceLevel - 1, 0)}</b>
              <span class="dim">Kaufkraft im Viertel ${num1(loc.wealth * 100)} %</span></span>
            <input type="range" min="0.7" max="1.6" step="0.01" value="${loc.priceLevel}"
                   data-act="pricelevel" data-loc="${loc.id}">
          </label>
          <p class="hint">Über der Kaufkraft des Viertels zu liegen kostet Gäste — darunter
            verschenkst du Marge.</p>
          <div class="row">
            <button data-act="closeloc" data-loc="${loc.id}" class="danger"
              ${g.locations.length < 2 ? 'disabled' : ''}>Filiale schließen</button>
          </div>
        </div>
      </section>

      <section class="grid grid-2">
        <div class="panel">
          <h2>Team <span class="dim">${loc.staff.length}/${loc.staffSlots} Plätze</span></h2>
          <table class="table">
            <tbody>
              ${loc.staff.map((st) => {
    const role = ROLES[st.role];
    return `<tr>
                  <td>${role.name}</td>
                  <td class="dim">Können ${num(st.skill * 100)} %</td>
                  <td class="dim">${money(role.wage * st.skill)}/Tag</td>
                  <td class="right">
                    <button data-act="train" data-loc="${loc.id}" data-uid="${st.uid}"
                      ${st.skill >= TRAINING.cap - 1e-6 ? 'disabled' : ''}>Schulen ${money(TRAINING.cost)}</button>
                    <button class="danger" data-act="fire" data-loc="${loc.id}" data-uid="${st.uid}">Gehen lassen</button>
                  </td>
                </tr>`;
  }).join('') || '<tr><td class="dim">Niemand da. So verkauft sich nichts.</td></tr>'}
            </tbody>
          </table>
          <div class="row">
            ${Object.values(ROLES).map((r) => `
              <button data-act="hire" data-loc="${loc.id}" data-role="${r.id}"
                title="${esc(r.desc)}"
                ${loc.staff.length >= loc.staffSlots ? 'disabled' : ''}>
                + ${r.name} <span class="dim">${money(r.hire)}</span>
              </button>`).join('')}
          </div>
          <p class="hint">Kapazität ${num(cap)} Einheiten/Tag ·
            gebraucht ${s ? num(s.prepNeeded) : '—'}.</p>
        </div>

        <div class="panel">
          <h2>Ausbau</h2>
          <ul class="list">
            ${UPGRADES.map((u) => {
    const has = loc.upgrades.has(u.id);
    return `<li class="${has ? 'done' : ''}">
                <div>
                  <b>${u.name}</b>
                  <p class="dim">${esc(u.desc)}</p>
                </div>
                ${has ? '<span class="tag">eingebaut</span>' : `
                  <button data-act="upgrade" data-loc="${loc.id}" data-up="${u.id}"
                    ${g.cash < u.cost ? 'disabled' : ''}>${money(u.cost)}</button>`}
              </li>`;
  }).join('')}
          </ul>
        </div>
      </section>

      <section class="panel">
        <h2>Sortiment in ${esc(loc.name)}</h2>
        <div class="chips">
          ${PRODUCTS.filter((p) => g.unlocked.has(p.id)).map((p) => `
            <button class="chip ${loc.products[p.id] ? 'on' : ''}"
                    data-act="toggleprod" data-loc="${loc.id}" data-p="${p.id}">
              ${p.name}
              ${s?.byProduct[p.id] ? `<b>${num(s.byProduct[p.id].sold)}×</b>` : ''}
            </button>`).join('')}
        </div>
        <p class="hint">Produkte derselben Kategorie nehmen sich gegenseitig Gäste weg —
          ein zweites Getränk bringt weniger als das erste. Was hier nicht leuchtet,
          wird in dieser Filiale nicht verkauft.</p>
      </section>`;
  }

  /* --------------------------------------------------------------- menü */

  function viewMenue(g) {
    const rows = PRODUCTS.map((p) => {
      const unlocked = g.unlocked.has(p.id);
      const pr = g.prices[p.id];
      const sold = g.today.byProduct[p.id]?.sold || 0;
      const marge = pr - p.cost;
      const rel = pr / p.ref;
      return `
        <tr class="${unlocked ? '' : 'locked'}">
          <td>
            <b>${p.name}</b>
            <span class="dim">${CATEGORIES[p.cat].name}${p.trendy ? ' · Trend' : ''}${p.summer ? ' · Sommer' : ''}</span>
          </td>
          <td class="dim">${price(p.cost)}</td>
          <td>
            ${unlocked ? `
              <div class="price-cell">
                <input type="range" min="${(p.ref * 0.5).toFixed(2)}" max="${(p.ref * 2).toFixed(2)}"
                       step="0.05" value="${pr}" data-act="price" data-p="${p.id}">
                <b>${price(pr)}</b>
              </div>` : '<span class="dim">nicht freigeschaltet</span>'}
          </td>
          <td class="${rel > 1.35 ? 'bad' : rel < 0.85 ? 'warn' : 'good'}">${pct(rel - 1, 0)}</td>
          <td>${price(marge)}</td>
          <td>${unlocked ? num(sold) : '—'}</td>
          <td>${unlocked ? money(g.today.byProduct[p.id]?.margin || 0) : '—'}</td>
        </tr>`;
    }).join('');

    return `
      <section class="panel">
        <h2>Karte & Preise</h2>
        <p class="hint">Die Preise gelten für die ganze Kette; jede Filiale rechnet
          ihr Preisniveau darauf. Prozentwerte zeigen den Abstand zum Referenzpreis —
          ab etwa +35 % bricht die Nachfrage spürbar ein, und der Ruf sinkt mit.</p>
        <table class="table wide">
          <thead><tr>
            <th>Produkt</th><th>Einsatz</th><th>Preis</th><th>Δ Referenz</th>
            <th>Marge</th><th>Verkauft</th><th>Deckung</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="row">
          <button data-act="priceall" data-v="0.9">Alles −10 %</button>
          <button data-act="priceall" data-v="1">Referenzpreise</button>
          <button data-act="priceall" data-v="1.1">Alles +10 %</button>
        </div>
      </section>`;
  }

  /* ---------------------------------------------------------- marketing */

  function viewMarketing(g) {
    return `
      <section class="panel">
        <h2>Kampagnen</h2>
        <p class="hint">Reichweite stapelt sich, aber mit klar abnehmendem Ertrag.
          Ruf-Werte wirken langsam und halten dafür.</p>
        <ul class="list">
          ${CAMPAIGNS.map((c) => {
    const running = g.campaigns.find((x) => x.id === c.id);
    return `<li class="${running ? 'done' : ''}">
              <div>
                <b>${c.name}</b>
                <p class="dim">${esc(c.desc)}</p>
                <p class="dim">${money(c.perDay)}/Tag · ${c.days} Tage ·
                  Reichweite +${pct(c.reach, 0)} · Ruf +${c.rep}</p>
              </div>
              ${running
    ? `<button class="danger" data-act="stopcamp" data-c="${c.id}">Stoppen (${running.daysLeft} T)</button>`
    : `<button data-act="camp" data-c="${c.id}">Starten · ${money(c.perDay * c.days)}</button>`}
            </li>`;
  }).join('')}
        </ul>
      </section>
      <section class="panel">
        <h2>Wirkung</h2>
        <div class="kv">
          <span>Ruf</span><b>${num(g.reputation)} / 100</b>
          <span>Ruf strebt gegen</span><b>${num(g.repTarget ?? g.reputation)}</b>
          <span>Werbebudget</span><b>${money(sum(g.campaigns, (c) => campaignById[c.id].perDay))} / Tag</b>
          <span>Preisniveau der Kette</span><b>${pct(avgRelativePrice(g) - 1, 0)}</b>
          <span>Wartende Gäste verloren</span><b class="${g.lostShare > 0.1 ? 'bad' : ''}">${pct(g.lostShare, 0)}</b>
        </div>
        <p class="hint">Der Ruf zieht Laufkundschaft an: bei 100 kommen rund 40 % mehr
          Gäste als bei 50, bei 0 nur zwei Drittel.</p>
      </section>`;
  }

  /* --------------------------------------------------------- entwicklung */

  function viewForschung(g) {
    return `
      <section class="panel">
        <h2>Entwicklung</h2>
        <p class="hint">Einmalige Käufe für die ganze Kette. Neue Produkte gehen
          überall sofort in den Verkauf — abschalten kannst du sie je Filiale.</p>
        <ul class="list">
          ${RESEARCH.map((r) => {
    const has = g.research.has(r.id);
    const locked = g.day < r.day;
    return `<li class="${has ? 'done' : ''}">
              <div>
                <b>${r.name}</b>
                <p class="dim">${esc(r.desc)}</p>
                ${locked ? `<p class="warn">Verfügbar ab Tag ${r.day} — noch ${r.day - g.day} Tage.</p>` : ''}
              </div>
              ${has ? '<span class="tag">fertig</span>' : `
                <button data-act="research" data-r="${r.id}"
                  ${locked || g.cash < r.cost ? 'disabled' : ''}>${money(r.cost)}</button>`}
            </li>`;
  }).join('')}
        </ul>
      </section>`;
  }

  /* ----------------------------------------------------------- finanzen */

  function viewFinanzen(g) {
    const d = g.today;
    const m = g.lastMonth;
    const limit = creditLimit(g);
    const line = (label, v, cls = '') =>
      `<tr class="${cls}"><td>${label}</td><td class="right">${signed(v)}</td></tr>`;

    return `
      <section class="grid grid-2">
        <div class="panel">
          <h2>Gestern</h2>
          <table class="table">
            <tbody>
              ${line('Umsatz', d.revenue)}
              ${line('Wareneinsatz', -d.cogs)}
              ${line('Löhne', -d.wages)}
              ${line('Miete', -d.rent)}
              ${line('Betrieb & Ausbau', -d.upkeep)}
              ${line('Werbung', -d.marketing)}
              ${line('Zinsen', -d.interest)}
              ${line('<b>Ergebnis</b>', d.profit, d.profit >= 0 ? 'good' : 'bad')}
            </tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Letzter Monatsabschluss</h2>
          ${m ? `<table class="table"><tbody>
            ${line('Umsatz', m.revenue)}
            ${line('Wareneinsatz', -m.cogs)}
            ${line('Löhne', -m.wages)}
            ${line('Miete & Betrieb', -m.rent)}
            ${line('Werbung', -m.marketing)}
            ${line('Steuer', -m.tax)}
            ${line('<b>Gewinn</b>', m.profit - m.tax, m.profit - m.tax >= 0 ? 'good' : 'bad')}
          </tbody></table>` : '<p class="hint">Der erste Monat läuft noch.</p>'}
          <p class="hint">Auf den Monatsgewinn fallen ${pct(RULES.taxRate, 0)} Steuer an.</p>
        </div>
      </section>

      <section class="grid grid-2">
        <div class="panel">
          <h2>Bank</h2>
          <div class="kv">
            <span>Kasse</span><b>${money(g.cash)}</b>
            <span>Schulden</span><b class="${g.debt > limit * 0.7 ? 'bad' : ''}">${money(g.debt)}</b>
            <span>Kreditrahmen</span><b>${money(limit)}</b>
            <span>Zins</span><b>${pct(RULES.interestDaily * 365, 1)} p. a.</b>
            <span>Firmenwert</span><b>${money(g.companyValue)}</b>
          </div>
          <div class="row">
            <button data-act="loan" data-v="10000">+10.000 € aufnehmen</button>
            <button data-act="loan" data-v="25000">+25.000 €</button>
            <button data-act="repay" data-v="10000" ${g.debt <= 0 ? 'disabled' : ''}>10.000 € tilgen</button>
            <button data-act="repay" data-v="1e9" ${g.debt <= 0 ? 'disabled' : ''}>Alles tilgen</button>
          </div>
          <p class="hint">Überzieht die Kasse den Rahmen um mehr als ein Drittel,
            ist das Spiel vorbei. Zinsen laufen täglich.</p>
        </div>
        <div class="panel">
          <h2>Sonderposten</h2>
          <div class="kv">
            <span>Bußgelder</span><b class="bad">${money(g.ledger.fines)}</b>
            <span>Reparaturen</span><b class="bad">${money(g.ledger.repairs)}</b>
            <span>Steuern gezahlt</span><b class="bad">${money(g.ledger.tax)}</b>
            <span>Sondererträge</span><b class="good">${money(g.ledger.other)}</b>
          </div>
          <div class="row">
            <button data-act="save">Speichern</button>
            <button class="danger" data-act="newgame">Neu anfangen</button>
          </div>
        </div>
      </section>`;
  }

  /* ------------------------------------------------------------- render */

  const VIEWS = {
    uebersicht: viewUebersicht,
    filialen: viewFilialen,
    menue: viewMenue,
    marketing: viewMarketing,
    forschung: viewForschung,
    finanzen: viewFinanzen,
  };

  function render(g) {
    // Never rebuild the DOM under a finger that is dragging a slider.
    if (ui.dragging) { renderHud(g); return; }
    renderHud(g);
    renderStageBar(g);
    renderTabs();
    el.view.innerHTML = VIEWS[ui.tab](g);
    renderFeed(g);
    const canvas = el.view.querySelector('#chart');
    if (canvas) drawChart(canvas, g.history);
    renderModal(g);
  }

  function renderModal(g) {
    if (!g.over) { el.modal.hidden = true; el.modal.innerHTML = ''; return; }
    const won = g.over === 'boerse';
    el.modal.hidden = false;
    el.modal.innerHTML = `
      <div class="modal-box">
        <h2>${won ? 'Börsengang' : 'Insolvenz'}</h2>
        <p>${won
    ? `Nach ${g.day} Tagen ist die Kette ${money(g.companyValue)} wert. ` +
          `${g.locations.length} Filialen, Ruf ${num(g.reputation)}. Verkauf die Hälfte und leg dich an den Strand.`
    : `Nach ${g.day} Tagen sind ${money(g.debt)} Schulden nicht mehr zu decken. ` +
          'Die Bank übernimmt, was noch da ist.'}</p>
        <button class="primary" data-act="newgame">Noch mal</button>
      </div>`;
  }

  function toast(msg, tone = '') {
    if (!msg) return;
    el.toast.textContent = msg;
    el.toast.className = `show ${tone}`;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => { el.toast.className = ''; }, 2600);
  }

  /* ------------------------------------------------------------ actions */

  function handle(act, t, g) {
    const locId = t.dataset.loc;
    switch (act) {
      case 'speed': api.setSpeed(Number(t.dataset.v)); return null;
      case 'tab': ui.tab = t.dataset.v; return null;
      case 'goloc':
        ui.loc = locId;
        // From the stage strip the point is to watch the branch, not to leave
        // the tab the player is working in.
        if (!t.closest('#stage-bar')) ui.tab = 'filialen';
        return null;
      case 'hire': return hire(g, locId, t.dataset.role);
      case 'fire': return fire(g, locId, Number(t.dataset.uid));
      case 'train': return train(g, locId, Number(t.dataset.uid));
      case 'upgrade': return buyUpgrade(g, locId, t.dataset.up);
      case 'open': { const r = openLocation(g, locId); if (r.ok) ui.loc = locId; return r; }
      case 'closeloc': return closeLocation(g, locId);
      case 'research': return doResearch(g, t.dataset.r);
      case 'camp': return startCampaign(g, t.dataset.c);
      case 'stopcamp': return stopCampaign(g, t.dataset.c);
      case 'toggleprod': return toggleProduct(g, locId, t.dataset.p);
      case 'loan': return takeLoan(g, Number(t.dataset.v));
      case 'repay': return repayLoan(g, Number(t.dataset.v));
      case 'save': { const ok = api.save(); return { ok, msg: ok ? 'Gespeichert.' : 'Speichern ging nicht.' }; }
      case 'newgame': api.newGame(); return null;
      case 'priceall': {
        const f = Number(t.dataset.v);
        for (const p of PRODUCTS) setPrice(g, p.id, p.ref * f);
        return { ok: true, msg: 'Preise gesetzt.' };
      }
      default: return null;
    }
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT') return;
    const g = api.game();
    const res = handle(t.dataset.act, t, g);
    if (res && res.msg) toast(res.msg, res.ok ? '' : 'bad');
    render(g);
  });

  /* Sliders: live-update the model on `input` so the numbers move with the
     thumb, but hold the re-render until the drag ends. */
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.dataset.act) return;
    const g = api.game();
    ui.dragging = t.type === 'range';
    if (t.dataset.act === 'price') setPrice(g, t.dataset.p, Number(t.value));
    else if (t.dataset.act === 'pricelevel') setPriceLevel(g, t.dataset.loc, Number(t.value));
    else if (t.dataset.act === 'quality') setQuality(g, t.dataset.loc, Number(t.value));
    else if (t.dataset.act === 'rename') g.firm = t.value.slice(0, 28);
    liveLabel(t, g);
  });

  document.addEventListener('change', (ev) => {
    if (!ev.target.dataset.act) return;
    ui.dragging = false;
    render(api.game());
  });

  /** Keeps the label next to a slider honest during a drag, without touching
   *  the rest of the document. */
  function liveLabel(t, g) {
    if (t.dataset.act === 'price') {
      const b = t.parentElement.querySelector('b');
      if (b) b.textContent = price(g.prices[t.dataset.p]);
    } else if (t.dataset.act === 'pricelevel' || t.dataset.act === 'quality') {
      const loc = g.locations.find((l) => l.id === t.dataset.loc);
      const b = t.parentElement.querySelector('b');
      if (!b || !loc) return;
      b.textContent = t.dataset.act === 'quality'
        ? QUALITY_TIERS[loc.quality - 1].name
        : pct(loc.priceLevel - 1, 0);
    }
  }

  return { render, toast, ui };
}
