/**
 * The map view: the whole sky at once, seen from the inside.
 *
 * Azimuthal equidistant — zenith in the middle, horizon on the ring, so
 * altitude is linear in radius and "half way out" really is 45°. Bodies that
 * have set are not dropped but pushed into a dimmed band outside the ring:
 * knowing that Saturn is 20° below the eastern horizon and coming up is more
 * useful than an empty map.
 *
 * The wedge shows where the phone is pointing, so the map and the live view
 * always agree about which way you are facing.
 */

import { BODIES, compassShort } from './bodies.js';
import { eclipticPointHorizon } from './astro.js';
import { daylight, makeLabelPlacer } from './skyview.js';

const DEG = Math.PI / 180;
const BELOW_BAND = 0.17; // fraction of the radius given to set bodies

export function renderMap(ctx, view) {
  const { w, h, scene, settings, aim, target, date, site } = view;
  // The HUD sits over the top and the tab bar over the bottom, so the disc is
  // centred in what is left rather than in the raw canvas — otherwise the
  // horizon ring hides behind the buttons in landscape.
  const inset = view.insets || { top: 0, bottom: 0 };
  const usable = Math.max(120, h - inset.top - inset.bottom);
  const cx = w / 2;
  const cy = inset.top + usable / 2;
  const scale = Math.min(w, h) / 420;
  const outer = Math.min(w, usable) / 2 - 26 * scale;   // room for the compass ring
  const R = outer / (1 + BELOW_BAND);
  const rotate = settings.mapHeadingUp ? -aim.az : 0;
  const day = daylight(scene.sunAlt);

  const place = (az, alt) => {
    const a = (az + rotate) * DEG;
    let r;
    if (alt >= 0) r = R * (90 - alt) / 90;
    else r = R * (1 + BELOW_BAND * Math.min(1, -alt / 90));
    return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a), r };
  };

  ctx.clearRect(0, 0, w, h);

  drawBackdrop(ctx, cx, cy, R, day, scene.sunAlt);
  drawBelowBand(ctx, cx, cy, R);
  drawRings(ctx, cx, cy, R, scale);
  drawCardinalRing(ctx, cx, cy, R, scale, rotate);
  if (settings.ecliptic !== false) drawEcliptic(ctx, place, date, site);
  if (settings.stars) drawStars(ctx, scene, place, scale, day);
  drawFieldOfView(ctx, place, cx, cy, R, aim, view.fov, scale);

  const hits = drawBodies(ctx, view, place, scale, R, target);
  // In landscape the compass ring already reaches the tab bar; the legend
  // would land on top of it, so it only appears where there is room.
  if (usable > 340) drawLegend(ctx, w, h - inset.bottom, scale);
  return hits;
}

function drawBackdrop(ctx, cx, cy, R, day, sunAlt) {
  const outer = R * (1 + BELOW_BAND);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  if (day > 0.5) {
    g.addColorStop(0, '#1d3a63');
    g.addColorStop(0.75, '#2b5488');
  } else if (sunAlt > -12) {
    g.addColorStop(0, '#0a1230');
    g.addColorStop(0.75, '#152246');
  } else {
    g.addColorStop(0, '#05070f');
    g.addColorStop(0.75, '#0a1020');
  }
  g.addColorStop(1, '#05070d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.fill();
}

function drawBelowBand(ctx, cx, cy, R) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * (1 + BELOW_BAND), 0, Math.PI * 2);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fillStyle = 'rgba(20,24,34,0.75)';
  ctx.fill('evenodd');
  ctx.restore();
}

function drawRings(ctx, cx, cy, R, scale) {
  ctx.strokeStyle = 'rgba(150,190,230,0.18)';
  ctx.lineWidth = 1;
  for (const alt of [30, 60]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * (90 - alt) / 90, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(180,215,255,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = 'rgba(180,205,235,0.5)';
  ctx.font = `500 ${9 * scale}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('60°', cx + 3 * scale, cy - R / 3 + 3 * scale);
  ctx.fillText('30°', cx + 3 * scale, cy - (R * 2) / 3 + 3 * scale);
  ctx.textAlign = 'center';
  ctx.fillText('Zenit', cx, cy - 7 * scale);
}

function drawCardinalRing(ctx, cx, cy, R, scale, rotate) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 45) {
    const a = (az + rotate) * DEG;
    const rr = R * (1 + BELOW_BAND) + 14 * scale;
    const x = cx + rr * Math.sin(a);
    const y = cy - rr * Math.cos(a);
    const major = az % 90 === 0;
    ctx.font = `${major ? 700 : 500} ${(major ? 13 : 10.5) * scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = az === 0 ? 'rgba(255,150,130,0.95)' : 'rgba(205,225,250,0.7)';
    ctx.fillText(compassShort(az), x, y);
  }
}

/** The plane the planets stay near — a useful "look along here" line. */
function drawEcliptic(ctx, place, date, site) {
  ctx.strokeStyle = 'rgba(255,205,120,0.35)';
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  let pen = false;
  for (let lon = 0; lon <= 360; lon += 3) {
    const h = eclipticPointHorizon(lon, date, site);
    if (h.alt < -12) { pen = false; continue; }
    const p = place(h.az, h.alt);
    if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawStars(ctx, scene, place, scale, day) {
  const alpha = 1 - day * 0.85;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(125,165,215,0.35)';
  ctx.lineWidth = 1;
  for (const line of scene.lines) {
    if (line.a.alt < 0 || line.b.alt < 0) continue;
    const p1 = place(line.a.az, line.a.alt);
    const p2 = place(line.b.az, line.b.alt);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  for (const s of scene.stars) {
    if (s.alt < 0) continue;
    const p = place(s.az, s.alt);
    ctx.fillStyle = '#e9f0ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.7, (2.6 - s.mag * 0.55)) * scale * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Where the phone is aimed: a wedge as wide as the live view's field. */
function drawFieldOfView(ctx, place, cx, cy, R, aim, fov, scale) {
  const half = fov / 2;
  const outer = R * (1 + BELOW_BAND);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  for (let d = -half; d <= half; d += 2) {
    const p = place(aim.az + d, 0);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
  g.addColorStop(0, 'rgba(120,200,255,0.05)');
  g.addColorStop(1, 'rgba(120,200,255,0.20)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  // The needle sits at the altitude the phone is actually tilted to.
  const tip = place(aim.az, Math.max(-20, Math.min(89, aim.alt)));
  ctx.strokeStyle = 'rgba(140,215,255,0.9)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(140,215,255,0.95)';
  ctx.beginPath();
  ctx.arc(tip.x, tip.y, 3.5 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawBodies(ctx, view, place, scale, R, target) {
  const { scene, settings } = view;
  const hits = [];
  const placeLabel = makeLabelPlacer(12 * scale);
  const order = [...scene.bodies].sort((a, b) => b.mag - a.mag);

  for (const body of order) {
    const below = !body.aboveHorizon;
    if (below && !settings.belowHorizon) continue;
    const meta = BODIES[body.id] || {};
    const p = place(body.az, body.altApparent);
    const r = Math.max(3.5, (6.5 - Math.max(-4, Math.min(8, body.mag)) * 0.75) * (meta.size ?? 1)) * scale * 0.8;

    ctx.globalAlpha = below ? 0.45 : 1;

    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2);
    glow.addColorStop(0, hexAlpha(meta.glow || '#fff', 0.5));
    glow.addColorStop(1, hexAlpha(meta.glow || '#fff', 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = meta.color || '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    if (body.id === target) {
      ctx.strokeStyle = meta.color || '#fff';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 7 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (settings.labels) {
      ctx.font = `600 ${10.5 * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3 * scale;
      const ty = placeLabel(p.x, p.y + r + 3 * scale);
      ctx.strokeText(meta.name || body.id, p.x, ty);
      ctx.fillStyle = below ? 'rgba(220,230,245,0.75)' : (meta.color || '#fff');
      ctx.fillText(meta.name || body.id, p.x, ty);
    }

    ctx.globalAlpha = 1;
    hits.push({ id: body.id, x: p.x, y: p.y, r: Math.max(r + 6 * scale, 16 * scale) });
  }
  return hits;
}

function drawLegend(ctx, w, h, scale) {
  ctx.font = `400 ${9.5 * scale}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(190,210,235,0.55)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Mitte = Zenit · Ring = Horizont · außerhalb = untergegangen', w / 2, h - 6 * scale);
}

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
