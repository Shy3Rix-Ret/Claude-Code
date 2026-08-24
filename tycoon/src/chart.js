/**
 * The one chart in the game: company value and daily profit over the last few
 * months. Hand-drawn on a canvas — a charting library for two series would be
 * more code than this file.
 */

import { money, shortDate } from './util.js';

export function drawChart(canvas, history, opts = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim() || '#e8e2d6';
  const dim = css.getPropertyValue('--dim').trim() || '#8b8577';
  const good = css.getPropertyValue('--good').trim() || '#6fcf8d';
  const accent = css.getPropertyValue('--accent').trim() || '#e8a13a';
  const grid = 'rgba(255,255,255,0.06)';

  const data = history.slice(-(opts.days || 120));
  const pad = { l: 8, r: 8, t: 14, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;

  if (data.length < 2) {
    ctx.fillStyle = dim;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Noch keine Daten — lass ein paar Tage laufen.', w / 2, h / 2);
    return;
  }

  const values = data.map((d) => d.value);
  const profits = data.map((d) => d.profit);
  const vMin = Math.min(0, ...values);
  const vMax = Math.max(1, ...values);
  const pAbs = Math.max(1, ...profits.map(Math.abs));

  const x = (i) => pad.l + (i / (data.length - 1)) * iw;
  const yv = (v) => pad.t + ih * (1 - (v - vMin) / (vMax - vMin || 1));
  const yp = (v) => pad.t + ih * (0.5 - (v / pAbs) * 0.42);

  // Baseline for the profit series.
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, Math.round(yp(0)) + 0.5);
  ctx.lineTo(w - pad.r, Math.round(yp(0)) + 0.5);
  ctx.stroke();

  // Daily profit as a fine line — the texture of the business.
  ctx.strokeStyle = 'rgba(232,161,58,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(x(i), yp(d.profit)) : ctx.moveTo(x(i), yp(d.profit))));
  ctx.stroke();

  // Company value, filled.
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
  grad.addColorStop(0, 'rgba(111,207,141,0.30)');
  grad.addColorStop(1, 'rgba(111,207,141,0.02)');
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(x(i), yv(d.value)) : ctx.moveTo(x(i), yv(d.value))));
  ctx.lineTo(x(data.length - 1), pad.t + ih);
  ctx.lineTo(x(0), pad.t + ih);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(x(i), yv(d.value)) : ctx.moveTo(x(i), yv(d.value))));
  ctx.strokeStyle = good;
  ctx.lineWidth = 1.75;
  ctx.stroke();

  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = dim;
  ctx.textAlign = 'left';
  ctx.fillText(shortDate(data[0].day), pad.l, h - 5);
  ctx.textAlign = 'right';
  ctx.fillText(shortDate(data[data.length - 1].day), w - pad.r, h - 5);

  ctx.textAlign = 'left';
  ctx.fillStyle = ink;
  ctx.fillText(`Firmenwert ${money(values[values.length - 1])}`, pad.l, 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = accent;
  ctx.fillText(`Gewinn/Tag ${money(profits[profits.length - 1])}`, w - pad.r, 10);
}
