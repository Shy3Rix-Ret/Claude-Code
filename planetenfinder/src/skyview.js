/**
 * The live view: what is in front of the phone, drawn where it actually is.
 *
 * A pinhole projection against the camera basis from sensors.js. Anything
 * behind the phone has a negative forward component and is simply not drawn,
 * which is the whole trick — turn away from Saturn and Saturn is gone,
 * without a single line of visibility logic.
 */

import { BODIES, compassShort } from './bodies.js';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------- colours */

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Blend two colours. The result is hex again rather than `rgb(...)`, because
 * these get mixed a second time — the ground shades between two already
 * blended colours — and a half-blended `rgb()` string would come back out of
 * hexToRgb as NaN, which canvas silently ignores while keeping the previous
 * fill style.
 */
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Sky colour as a function of how far the Sun is below the horizon. */
function skyColours(sunAlt) {
  const stops = [
    { alt: 10, zenith: '#3a72c4', horizon: '#b9d3ee' },
    { alt: 0, zenith: '#2c5aa8', horizon: '#e6a76a' },
    { alt: -6, zenith: '#16264f', horizon: '#a1552f' },
    { alt: -12, zenith: '#0a1230', horizon: '#2d3560' },
    { alt: -18, zenith: '#05070f', horizon: '#0d1426' },
    { alt: -90, zenith: '#03040a', horizon: '#080c18' },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (sunAlt <= a.alt && sunAlt >= b.alt) {
      const t = (a.alt - sunAlt) / (a.alt - b.alt);
      return { zenith: mix(a.zenith, b.zenith, t), horizon: mix(a.horizon, b.horizon, t) };
    }
  }
  return sunAlt > 10 ? stops[0] : stops[stops.length - 1];
}

/** 0 = full night, 1 = full daylight. Drives how much of the sky survives. */
export function daylight(sunAlt) {
  return Math.max(0, Math.min(1, (sunAlt + 12) / 18));
}

/* ---------------------------------------------------------- projection */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function makeProjector(basis, w, h, fovDeg) {
  const f = (Math.min(w, h) / 2) / Math.tan((fovDeg / 2) * DEG);
  const { right, up, forward } = basis;
  return function project(vec) {
    const z = dot(vec, forward);
    if (z <= 0.001) return null;
    const x = dot(vec, right);
    const y = dot(vec, up);
    return { x: w / 2 + (f * x) / z, y: h / 2 - (f * y) / z, z, depth: z };
  };
}

/** Screen-plane direction of a body, valid even when it is behind you. */
function planeDirection(basis, vec) {
  const x = dot(vec, basis.right);
  const y = dot(vec, basis.up);
  const n = Math.hypot(x, y) || 1;
  return { x: x / n, y: -y / n };
}

/**
 * Keeps labels off each other. Bodies bunch up near the horizon and at
 * conjunctions — Sun and Jupiter sat on top of each other in testing — so a
 * label that lands on an earlier one is nudged down until it is clear.
 */
export function makeLabelPlacer(lineHeight = 13) {
  const placed = [];
  return (x, y) => {
    let out = y;
    for (let i = 0; i < 8; i++) {
      const clash = placed.some((p) => Math.abs(p.x - x) < 56 && Math.abs(p.y - out) < lineHeight);
      if (!clash) break;
      out += lineHeight;
    }
    placed.push({ x, y: out });
    return out;
  };
}

export function unitVector(az, alt) {
  const ca = Math.cos(alt * DEG);
  return [ca * Math.sin(az * DEG), ca * Math.cos(az * DEG), Math.sin(alt * DEG)];
}

/* --------------------------------------------------------------- render */

export function renderSky(ctx, view) {
  const { w, h, basis, fov, scene, settings, target, cameraOn } = view;
  const project = makeProjector(basis, w, h, fov);
  const scale = Math.min(w, h) / 420;
  const day = daylight(scene.sunAlt);

  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (!cameraOn) {
    drawBackground(ctx, view, project, day);
  } else {
    drawHorizonOnly(ctx, view, project);
  }

  if (settings.stars && (!cameraOn || day < 0.4)) {
    if (settings.constellations) drawConstellations(ctx, scene, project, day, cameraOn);
    drawStars(ctx, scene, project, scale, day, cameraOn);
  }

  if (settings.grid) drawGrid(ctx, project, w, h);
  drawCardinals(ctx, project, scale);

  const drawn = drawBodies(ctx, view, project, scale, day);
  drawReticle(ctx, view, scale);
  if (target) drawTarget(ctx, view, project, scale, target);

  return drawn;
}

/* ------------------------------------------------------------ background */

function drawBackground(ctx, view, project, day) {
  const { w, h, basis, scene } = view;
  const { zenith, horizon } = skyColours(scene.sunAlt);

  // The gradient follows world-up on screen, so it stays right when the phone
  // is rolled into landscape or held at an angle.
  const upDir = planeDirection(basis, [0, 0, 1]);
  const len = Math.hypot(w, h);
  const g = ctx.createLinearGradient(
    w / 2 + upDir.x * len, h / 2 + upDir.y * len,
    w / 2 - upDir.x * len, h / 2 - upDir.y * len,
  );
  g.addColorStop(0, zenith);
  g.addColorStop(1, horizon);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  drawGround(ctx, project, day);
}

/**
 * The ground as a strip of quads between the horizon and the nadir. Quads
 * with a corner behind the camera are dropped; at these step sizes that only
 * happens beyond ±90° from the view axis, which is off screen anyway.
 */
function drawGround(ctx, project, day) {
  const rings = [0, -6, -15, -30, -50, -90];
  const near = mix('#232830', '#4a4237', day);
  const far = mix('#0b0d11', '#1d1a16', day);

  for (let r = 0; r < rings.length - 1; r++) {
    const t = r / (rings.length - 2);
    ctx.fillStyle = mix(near, far, t);
    for (let az = 0; az < 360; az += 10) {
      const p = [
        project(unitVector(az, rings[r])),
        project(unitVector(az + 10, rings[r])),
        project(unitVector(az + 10, rings[r + 1])),
        project(unitVector(az, rings[r + 1])),
      ];
      if (p.some((q) => !q)) continue;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
  drawHorizonLine(ctx, project, 'rgba(255,255,255,0.28)', 1.5);
}

/** With the camera on, only the horizon itself is drawn — the rest is real. */
function drawHorizonOnly(ctx, view, project) {
  drawHorizonLine(ctx, project, 'rgba(120,200,255,0.35)', 1.2);
}

function drawHorizonLine(ctx, project, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  let pen = false;
  for (let az = 0; az <= 360; az += 2) {
    const p = project(unitVector(az, 0));
    if (!p) { pen = false; continue; }
    if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ grid */

function drawGrid(ctx, project, w, h) {
  ctx.strokeStyle = 'rgba(140,180,220,0.16)';
  ctx.lineWidth = 1;

  for (let alt = -60; alt <= 80; alt += 15) {
    if (alt === 0) continue;
    strokePath(ctx, (add) => {
      for (let az = 0; az <= 360; az += 4) add(project(unitVector(az, alt)));
    });
  }
  for (let az = 0; az < 360; az += 15) {
    strokePath(ctx, (add) => {
      for (let alt = -80; alt <= 80; alt += 4) add(project(unitVector(az, alt)));
    });
  }
}

/** Polyline helper that lifts the pen wherever the sky leaves the frustum. */
function strokePath(ctx, feed) {
  ctx.beginPath();
  let pen = false;
  feed((p) => {
    if (!p) { pen = false; return; }
    if (!pen) { ctx.moveTo(p.x, p.y); pen = true; } else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

function drawCardinals(ctx, project, scale) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 45) {
    const p = project(unitVector(az, 0));
    if (!p) continue;
    const label = compassShort(az);
    const major = az % 90 === 0;
    ctx.font = `${major ? 700 : 500} ${(major ? 15 : 12) * scale}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = az === 0 ? 'rgba(255,140,120,0.95)' : 'rgba(210,230,255,0.75)';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3 * scale;
    ctx.strokeText(label, p.x, p.y - 12 * scale);
    ctx.fillText(label, p.x, p.y - 12 * scale);

    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 5 * scale);
    ctx.lineTo(p.x, p.y + 5 * scale);
    ctx.strokeStyle = 'rgba(210,230,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

/* ----------------------------------------------------------------- stars */

function starRadius(mag, scale) {
  return Math.max(0.8, 4.6 - mag * 0.85) * scale * 0.85;
}

function drawStars(ctx, scene, project, scale, day, cameraOn) {
  const alpha = (1 - day) * (cameraOn ? 0.75 : 1);
  if (alpha <= 0.02) return;
  for (const s of scene.stars) {
    if (s.alt < -2) continue;
    const p = project(unitVector(s.az, s.alt));
    if (!p) continue;
    const r = starRadius(s.mag, scale);
    ctx.globalAlpha = alpha * Math.max(0.45, 1 - s.mag / 6);
    ctx.fillStyle = '#eef3ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    if (s.mag < 1.6) {
      ctx.globalAlpha = alpha * 0.75;
      ctx.font = `500 ${9.5 * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(200,220,255,0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(s.name, p.x + r + 4 * scale, p.y + 3 * scale);
    }
  }
  ctx.globalAlpha = 1;
}

function drawConstellations(ctx, scene, project, day, cameraOn) {
  ctx.globalAlpha = (1 - day) * (cameraOn ? 0.3 : 0.42);
  ctx.strokeStyle = '#7fa8d8';
  ctx.lineWidth = 1;
  for (const line of scene.lines) {
    if (line.a.alt < -5 && line.b.alt < -5) continue;
    const p1 = project(unitVector(line.a.az, line.a.alt));
    const p2 = project(unitVector(line.b.az, line.b.alt));
    if (!p1 || !p2) continue;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------- bodies */

/** Marker radius: bright things are bigger, but never microscopic. */
function bodyRadius(body, scale) {
  const meta = BODIES[body.id];
  const fromMag = 7 - Math.max(-4, Math.min(8, body.mag)) * 0.9;
  return Math.max(3.5, fromMag * (meta?.size ?? 1)) * scale * 0.85;
}

function drawBodies(ctx, view, project, scale, day) {
  const { scene, settings } = view;
  const drawn = [];
  // Two lines per label — name and altitude — so the whole block is reserved.
  const placeLabel = makeLabelPlacer(26 * scale);

  // Faintest first so the bright ones end up on top.
  const order = [...scene.bodies].sort((a, b) => b.mag - a.mag);

  for (const body of order) {
    const below = !body.aboveHorizon;
    if (below && !settings.belowHorizon) continue;

    const p = project(unitVector(body.az, body.altApparent));
    if (!p) continue;
    if (p.x < -80 || p.x > view.w + 80 || p.y < -80 || p.y > view.h + 80) continue;

    const meta = BODIES[body.id] || {};
    const r = bodyRadius(body, scale);
    const alpha = below ? 0.4 : 1;
    ctx.globalAlpha = alpha;

    // Glow.
    const glowR = r * (body.id === 'sun' ? 6 : 3.4);
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
    grad.addColorStop(0, hexAlpha(meta.glow || '#ffffff', 0.55));
    grad.addColorStop(1, hexAlpha(meta.glow || '#ffffff', 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    if (body.id === 'moon') {
      drawMoon(ctx, view, p, r, body);
    } else {
      ctx.fillStyle = meta.color || '#fff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (body.id === 'sun') drawSunRays(ctx, p, r);
    }

    // Ring for the ones that need finding rather than admiring.
    if (below) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (settings.labels) {
      const label = meta.name || body.id;
      const sub = below
        ? `${Math.abs(body.altApparent).toFixed(0)}° unter dem Horizont`
        : `${body.altApparent.toFixed(0)}° hoch`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${12.5 * scale}px ui-sans-serif, system-ui, sans-serif`;
      const tx = p.x + r + 7 * scale;
      const ty = placeLabel(tx, p.y - 5 * scale);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3.5 * scale;
      ctx.strokeText(label, tx, ty);
      ctx.fillStyle = meta.color || '#fff';
      ctx.fillText(label, tx, ty);

      ctx.font = `400 ${10 * scale}px ui-sans-serif, system-ui, sans-serif`;
      ctx.strokeText(sub, tx, ty + 13 * scale);
      ctx.fillStyle = 'rgba(225,235,250,0.8)';
      ctx.fillText(sub, tx, ty + 13 * scale);
    }

    ctx.globalAlpha = 1;
    drawn.push({ id: body.id, x: p.x, y: p.y, r: Math.max(r, 14 * scale) });
  }

  ctx.globalAlpha = 1;
  return drawn;
}

function hexAlpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * The Moon with its actual phase, and with the lit limb turned towards the
 * Sun — including when the Sun itself is below the horizon or behind you.
 */
function drawMoon(ctx, view, p, r, body) {
  const meta = BODIES.moon;
  const k = Math.max(0, Math.min(1, body.illuminated ?? 1));

  // Position angle of the bright limb, measured on screen.
  const sun = view.scene.bodies.find((b) => b.id === 'sun');
  let angle = 0;
  if (sun) {
    const toSun = unitVector(sun.az, sun.altApparent);
    const d = planeDirection(view.basis, toSun);
    angle = Math.atan2(d.y, d.x);
  }

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);

  // Dark side, faintly visible: earthshine, and it keeps the disc readable.
  ctx.fillStyle = 'rgba(70,74,84,0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = meta.color;
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  const terminator = r * Math.abs(1 - 2 * k);
  ctx.ellipse(0, 0, terminator, r, 0, Math.PI / 2, -Math.PI / 2, k > 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawSunRays(ctx, p, r) {
  ctx.strokeStyle = 'rgba(255,214,120,0.7)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(a) * r * 1.4, p.y + Math.sin(a) * r * 1.4);
    ctx.lineTo(p.x + Math.cos(a) * r * 2.1, p.y + Math.sin(a) * r * 2.1);
    ctx.stroke();
  }
}

/* --------------------------------------------------------------- reticle */

function drawReticle(ctx, view, scale) {
  const { w, h } = view;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  const r = 13 * scale;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2 - r - 6 * scale, h / 2);
  ctx.lineTo(w / 2 - r - 1 * scale, h / 2);
  ctx.moveTo(w / 2 + r + 1 * scale, h / 2);
  ctx.lineTo(w / 2 + r + 6 * scale, h / 2);
  ctx.moveTo(w / 2, h / 2 - r - 6 * scale);
  ctx.lineTo(w / 2, h / 2 - r - 1 * scale);
  ctx.moveTo(w / 2, h / 2 + r + 1 * scale);
  ctx.lineTo(w / 2, h / 2 + r + 6 * scale);
  ctx.stroke();
}

/* -------------------------------------------------------------- guidance */

/**
 * Target lock. On screen it gets a ring; off screen an arrow at the edge
 * saying how far you still have to turn, which is the part that actually
 * gets people onto a 5th-magnitude planet.
 */
function drawTarget(ctx, view, project, scale, target) {
  const { w, h, basis } = view;
  const body = view.scene.bodies.find((b) => b.id === target);
  if (!body) return;

  const vec = unitVector(body.az, body.altApparent);
  const p = project(vec);
  const meta = BODIES[body.id] || {};
  const onScreen = p && p.x > 30 && p.x < w - 30 && p.y > 30 && p.y < h - 30;

  const centerVec = basis.forward;
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(vec, centerVec)))) / DEG;

  if (onScreen) {
    const r = Math.max(22 * scale, bodyRadius(body, scale) + 14 * scale);
    ctx.strokeStyle = meta.color || '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  const d = planeDirection(basis, vec);
  const cx = w / 2, cy = h / 2;
  const margin = 58 * scale;
  const tx = Math.max(margin, Math.min(w - margin, cx + d.x * w));
  const ty = Math.max(margin, Math.min(h - margin, cy + d.y * h));
  const angle = Math.atan2(d.y, d.x);

  ctx.save();
  ctx.translate(tx, ty);
  ctx.rotate(angle);
  ctx.fillStyle = meta.color || '#fff';
  ctx.beginPath();
  ctx.moveTo(16 * scale, 0);
  ctx.lineTo(-8 * scale, -10 * scale);
  ctx.lineTo(-3 * scale, 0);
  ctx.lineTo(-8 * scale, 10 * scale);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${12 * scale}px ui-sans-serif, system-ui, sans-serif`;
  const text = `${meta.name || body.id} · ${sep.toFixed(0)}°`;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 4 * scale;
  ctx.strokeText(text, tx, ty + 26 * scale);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, tx, ty + 26 * scale);
}
