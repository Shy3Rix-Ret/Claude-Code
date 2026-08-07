/**
 * Realistic mode — the sky as it looks, not as a diagram.
 *
 * Two halves:
 *
 *   The **atmosphere** is evaluated per direction into a small offscreen
 *   buffer and blown up. A phone cannot shade a million pixels in JavaScript,
 *   but it can shade six thousand and let the GPU interpolate, and a sky is
 *   nothing but smooth gradients — so the cheat costs nothing visible. The
 *   model is empirical rather than a full scattering integral, but it carries
 *   the things the eye actually reads: the glow around the Sun, haze thickening
 *   towards the horizon, the orange band at sunset, the Earth's own shadow
 *   rising opposite it with the Belt of Venus above, and moonlight at night.
 *
 *   The **bodies** get their real faces: Saturn's rings at the opening angle
 *   they actually have this year, Jupiter oblate and banded, Mars ruddy with a
 *   polar cap, Venus and Mercury showing phases, the Sun with a corona, the
 *   Moon with its maria.
 *
 * One honest caveat, stated in the settings too: the planets stay drawn far
 * larger than they are. Jupiter is 47 arcseconds across — a twentieth of a
 * pixel at normal zoom. Only the Sun and the Moon are drawn at their true
 * angular size, because they are the only two that have one worth seeing.
 */

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ colour */

const mixRgb = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Lorentzian falloff — a decent glare profile, and far cheaper than exp(). */
const halo = (angle, width) => 1 / (1 + (angle / width) * (angle / width));

const rgbaOf = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ------------------------------------------------------- the sky itself */

const DAY_ZENITH = [46, 98, 178];
const DAY_HORIZON = [166, 196, 226];
const DUSK_ZENITH = [22, 38, 84];
const DUSK_HORIZON = [58, 74, 120];
const NIGHT_ZENITH = [5, 7, 14];
const NIGHT_HORIZON = [13, 18, 32];
const SUNSET_GLOW = [255, 138, 62];
const SUN_GLOW = [255, 244, 224];
const BELT_OF_VENUS = [212, 146, 156];
const EARTH_SHADOW = [26, 34, 62];
const MOON_GLOW = [150, 168, 200];

/**
 * Builds a shader for one frame.
 *
 * Everything that depends only on where the Sun is — the palette, the warmth
 * of the glow, how much twilight there is — is computed once out here. The
 * returned function then runs per direction and writes straight into the
 * pixel buffer without allocating anything, which is the difference between
 * this costing two thirds of the frame budget and costing a twentieth of it.
 */
function makeSkyShader(env) {
  const sunAlt = env.sunAlt;
  const day = clamp01((sunAlt + 5) / 11);
  const dusk = clamp01((sunAlt + 18) / 14);
  const night = clamp01((-sunAlt - 10) / 8);

  const lerp = (a, b, t) => a + (b - a) * t;

  // Base palette for this instant.
  const zr = lerp(lerp(NIGHT_ZENITH[0], DUSK_ZENITH[0], dusk), DAY_ZENITH[0], day);
  const zg = lerp(lerp(NIGHT_ZENITH[1], DUSK_ZENITH[1], dusk), DAY_ZENITH[1], day);
  const zb = lerp(lerp(NIGHT_ZENITH[2], DUSK_ZENITH[2], dusk), DAY_ZENITH[2], day);
  const hr = lerp(lerp(NIGHT_HORIZON[0], DUSK_HORIZON[0], dusk), DAY_HORIZON[0], day);
  const hg = lerp(lerp(NIGHT_HORIZON[1], DUSK_HORIZON[1], dusk), DAY_HORIZON[1], day);
  const hb = lerp(lerp(NIGHT_HORIZON[2], DUSK_HORIZON[2], dusk), DAY_HORIZON[2], day);

  // Colour and strength of the glow around the Sun.
  const warmth = clamp01((sunAlt + 2) / 12);
  const wr = lerp(SUNSET_GLOW[0], SUN_GLOW[0], warmth);
  const wg = lerp(SUNSET_GLOW[1], SUN_GLOW[1], warmth);
  const wb = lerp(SUNSET_GLOW[2], SUN_GLOW[2], warmth);
  const glowGain = 0.35 + 0.75 * clamp01((sunAlt + 8) / 10);

  const twilight = clamp01(1 - Math.abs(sunAlt + 3) / 9);
  const antiBelt = clamp01(1 - Math.abs(sunAlt + 3) / 7);
  const sunDepth = Math.abs(sunAlt);

  const sx = env.sun[0], sy = env.sun[1], sz = env.sun[2];
  const mx = env.moon[0], my = env.moon[1], mz = env.moon[2];
  const moonGain = env.moonIllum * clamp01((env.moonAlt + 4) / 12) * night * 0.55;

  return function shade(dx, dy, dz, data, i) {
    const above = dz > 0 ? Math.asin(dz) / DEG : 0;

    // Vertical gradient. u*u*sqrt(u) stands in for pow(u, 2.5) — the shape is
    // what matters, and sqrt is an order of magnitude cheaper than pow.
    const u = 1 - above / 90;
    const t = u * u * Math.sqrt(u);

    let r = zr + (hr - zr) * t;
    let g = zg + (hg - zg) * t;
    let b = zb + (hb - zb) * t;

    const cosSun = dx * sx + dy * sy + dz * sz;
    const gammaSun = Math.acos(cosSun < -1 ? -1 : cosSun > 1 ? 1 : cosSun) / DEG;

    const nearSun = halo(gammaSun, 3.5) * 0.85 + halo(gammaSun, 16) * 0.35 + halo(gammaSun, 55) * 0.12;
    if (nearSun > 0.002) {
      const k = clamp01(nearSun * glowGain);
      r += (wr - r) * k; g += (wg - g) * k; b += (wb - b) * k;
    }

    if (twilight > 0.01) {
      const azimuthal = clamp01(1 - Math.abs(gammaSun - sunDepth) / 90);
      const low = clamp01(1 - above / 22);
      const k = twilight * azimuthal * low * low * 0.75;
      if (k > 0.002) {
        r += (SUNSET_GLOW[0] - r) * k;
        g += (SUNSET_GLOW[1] - g) * k;
        b += (SUNSET_GLOW[2] - b) * k;
      }
    }

    // Opposite the Sun during twilight: the Earth's own shadow rising, with
    // the pink Belt of Venus resting on top of it.
    if (antiBelt > 0.01 && gammaSun > 110) {
      const opposite = clamp01((gammaSun - 110) / 60) * antiBelt;
      const belt = clamp01(1 - Math.abs(above - 9) / 9) * opposite * 0.5;
      const shadow = clamp01(1 - above / 5) * opposite * 0.55;
      r += (BELT_OF_VENUS[0] - r) * belt;
      g += (BELT_OF_VENUS[1] - g) * belt;
      b += (BELT_OF_VENUS[2] - b) * belt;
      r += (EARTH_SHADOW[0] - r) * shadow;
      g += (EARTH_SHADOW[1] - g) * shadow;
      b += (EARTH_SHADOW[2] - b) * shadow;
    }

    if (night > 0.01) {
      if (moonGain > 0.002) {
        const cosMoon = dx * mx + dy * my + dz * mz;
        const gammaMoon = Math.acos(cosMoon < -1 ? -1 : cosMoon > 1 ? 1 : cosMoon) / DEG;
        const k = clamp01(halo(gammaMoon, 5) * 0.5 + halo(gammaMoon, 30) * 0.22) * moonGain;
        r += (MOON_GLOW[0] - r) * k;
        g += (MOON_GLOW[1] - g) * k;
        b += (MOON_GLOW[2] - b) * k;
      }
      // The dome of light every inhabited horizon carries.
      const lp = clamp01(1 - above / 25);
      const k = night * lp * lp * lp * 0.35;
      r += (26 - r) * k; g += (30 - g) * k; b += (38 - b) * k;
    }

    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  };
}

let buffer = null;

/**
 * Paint the atmosphere across the whole frame.
 *
 * The buffer is deliberately coarse — around a hundred pixels on the long
 * side — and drawn back up with smoothing on. Nothing in a clear sky has an
 * edge, so nothing is lost.
 */
export function paintSky(ctx, view) {
  const { w, h, basis, fov, scene } = view;

  // Measured: the upscale filter, not the shading, is what costs. A
  // high-quality resample of the whole frame halved the frame rate, while
  // bilinear from a denser buffer is free and looks the same on a gradient.
  const long = 132;
  const bw = Math.max(2, Math.round(w >= h ? long : long * (w / h)));
  const bh = Math.max(2, Math.round(w >= h ? long * (h / w) : long));

  if (!buffer || buffer.canvas.width !== bw || buffer.canvas.height !== bh) {
    const canvas = document.createElement('canvas');
    canvas.width = bw;
    canvas.height = bh;
    buffer = { canvas, ctx: canvas.getContext('2d') };
    buffer.image = buffer.ctx.createImageData(bw, bh);
  }

  const sun = scene.bodies.find((b) => b.id === 'sun');
  const moon = scene.bodies.find((b) => b.id === 'moon');
  const env = {
    sun: unit(sun.az, sun.altApparent),
    sunAlt: sun.altApparent,
    moon: unit(moon.az, moon.altApparent),
    moonAlt: moon.altApparent,
    moonIllum: moon.illuminated ?? 0,
  };

  const shade = makeSkyShader(env);
  const f = (Math.min(w, h) / 2) / Math.tan((fov / 2) * DEG);
  const rx = basis.right[0], ry = basis.right[1], rz = basis.right[2];
  const ux = basis.up[0], uy = basis.up[1], uz = basis.up[2];
  const fx = basis.forward[0], fy = basis.forward[1], fz = basis.forward[2];
  const data = buffer.image.data;

  let i = 0;
  for (let py = 0; py < bh; py++) {
    const sy = -(((py + 0.5) / bh) * h - h / 2);
    // The row's fixed part, so the inner loop only adds the column term.
    const ax = fx * f + ux * sy, ay = fy * f + uy * sy, az = fz * f + uz * sy;
    for (let px = 0; px < bw; px++, i += 4) {
      const sx = ((px + 0.5) / bw) * w - w / 2;
      const x = ax + rx * sx;
      const y = ay + ry * sx;
      const z = az + rz * sx;
      const inv = 1 / Math.sqrt(x * x + y * y + z * z);
      shade(x * inv, y * inv, z * inv, data, i);
    }
  }

  buffer.ctx.putImageData(buffer.image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(buffer.canvas, 0, 0, bw, bh, 0, 0, w, h);
}

const unit = (az, alt) => {
  const ca = Math.cos(alt * DEG);
  return [ca * Math.sin(az * DEG), ca * Math.cos(az * DEG), Math.sin(alt * DEG)];
};

/**
 * Ground, with the haze that always sits on a real horizon. Same quad strip
 * as the plain mode, but shaded from a dusty near distance into black at the
 * nadir and tinted by whatever light is left in the sky.
 */
export function paintGround(ctx, view, project) {
  const sun = view.scene.bodies.find((b) => b.id === 'sun');
  const light = clamp01((sun.altApparent + 8) / 16);

  const near = mixRgb([24, 26, 30], [96, 92, 82], light);
  const far = mixRgb([6, 7, 10], [26, 25, 23], light);
  const rings = [0, -3, -8, -18, -35, -60, -90];

  for (let r = 0; r < rings.length - 1; r++) {
    const t = Math.pow(r / (rings.length - 2), 0.65);
    ctx.fillStyle = rgbaOf(mixRgb(near, far, t), 1);
    for (let az = 0; az < 360; az += 10) {
      const p = [
        project(unit(az, rings[r])),
        project(unit(az + 10, rings[r])),
        project(unit(az + 10, rings[r + 1])),
        project(unit(az, rings[r + 1])),
      ];
      if (p.some((q) => !q)) continue;
      ctx.beginPath();
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/* ---------------------------------------------------------------- bodies */

/**
 * Draw one body as it looks.
 *
 * `limb` is the screen angle towards the Sun, so phases point the right way;
 * `detail` says whether the disc is big enough on screen to be worth painting
 * features onto, which depends entirely on how far the user has zoomed in.
 */
export function paintBody(ctx, body, p, r, opts) {
  const { limb = 0, ringAngle = 0, ringTilt = -9, dayness = 0 } = opts;
  const detail = r >= 5;

  ctx.save();
  ctx.translate(p.x, p.y);

  switch (body.id) {
    case 'sun': paintSun(ctx, r); break;
    case 'moon': paintMoon(ctx, r, body, limb, detail); break;
    case 'saturn': paintSaturn(ctx, r, ringTilt, ringAngle, detail); break;
    case 'jupiter': paintJupiter(ctx, r, detail); break;
    case 'mars': paintMars(ctx, r, limb, detail); break;
    case 'venus': paintInner(ctx, r, body, limb, detail, ['#fffaf0', '#ffeec2'], 1); break;
    case 'mercury': paintInner(ctx, r, body, limb, detail, ['#d8cbb8', '#9c8f7c'], 0.35); break;
    case 'uranus': paintIceGiant(ctx, r, '#a9e6ea', '#6fb9c2'); break;
    case 'neptune': paintIceGiant(ctx, r, '#8fb4ff', '#3f63b8'); break;
    default: paintIceGiant(ctx, r, '#cbbfae', '#8a7f70'); break;
  }

  ctx.restore();
}

/** Glow, then a hard limb — the way a bright point looks through a lens. */
function bloom(ctx, r, colour, reach, strength) {
  const g = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * reach);
  g.addColorStop(0, rgbaOf(colour, strength));
  g.addColorStop(0.35, rgbaOf(colour, strength * 0.28));
  g.addColorStop(1, rgbaOf(colour, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * reach, 0, Math.PI * 2);
  ctx.fill();
}

/** The four-point cross a very bright object makes in any real optic. */
export function spikes(ctx, r, colour, strength, length) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    const g = ctx.createLinearGradient(0, 0, r * length, 0);
    g.addColorStop(0, rgbaOf(colour, strength));
    g.addColorStop(1, rgbaOf(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.32);
    ctx.lineTo(r * length, 0);
    ctx.lineTo(0, r * 0.32);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function paintSun(ctx, r) {
  bloom(ctx, r, [255, 214, 140], 7, 0.5);
  spikes(ctx, r, [255, 236, 190], 0.5, 6);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#fff3c4');
  g.addColorStop(1, '#ffcf5c');       // limb darkening, warm at the edge
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

function paintMoon(ctx, r, body, limb, detail) {
  const k = clamp01(body.illuminated ?? 1);
  bloom(ctx, r, [190, 200, 215], 3.4, 0.28 * (0.3 + k));

  ctx.save();
  ctx.rotate(limb);

  // Earthshine: the night side is never truly black.
  ctx.fillStyle = 'rgba(74,78,90,0.6)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, r * Math.abs(1 - 2 * k), r, 0, Math.PI / 2, -Math.PI / 2, k > 0.5);
  ctx.closePath();
  ctx.fillStyle = '#e9e6dd';
  ctx.fill();

  if (detail) {
    // The maria, roughly where they are on the near side. The disc is clipped
    // so the dark patches cannot spill over the terminator.
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(126,128,136,0.32)';
    const seas = [[-0.30, -0.30, 0.40], [0.06, -0.44, 0.30], [0.34, -0.06, 0.34],
      [-0.44, 0.14, 0.26], [-0.02, 0.14, 0.40], [0.30, 0.36, 0.22]];
    for (const [sx, sy, sr] of seas) {
      ctx.beginPath();
      ctx.ellipse(sx * r, sy * r, sr * r, sr * r * 0.9, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function paintSaturn(ctx, r, ringTilt, ringAngle, detail) {
  bloom(ctx, r, [230, 210, 160], 3.2, 0.34);
  const flat = 0.9;                       // Saturn is visibly oblate
  const tilt = Math.abs(Math.sin(ringTilt * DEG));

  ctx.save();
  ctx.rotate(ringAngle);

  const ringR = r * 2.3;
  const ringH = ringR * tilt;

  // Back half of the rings, then the globe, then the front half — that
  // ordering is the whole reason Saturn looks like Saturn.
  const drawRing = (from, to) => {
    ctx.strokeStyle = 'rgba(232,214,170,0.8)';
    ctx.lineWidth = Math.max(0.8, r * 0.26);
    ctx.beginPath();
    ctx.ellipse(0, 0, ringR, Math.max(ringH, 0.35), 0, from, to);
    ctx.stroke();
  };

  if (detail && tilt > 0.03) drawRing(Math.PI, Math.PI * 2);

  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#f6e7bd');
  g.addColorStop(0.5, '#efdcab');
  g.addColorStop(1, '#c9b183');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * flat, 0, 0, Math.PI * 2);
  ctx.fill();

  if (detail && tilt > 0.03) drawRing(0, Math.PI);
  else if (detail) {
    // Edge-on: a hairline through the disc, which is exactly what a telescope
    // shows in 2025 and 2026.
    ctx.strokeStyle = 'rgba(226,208,164,0.8)';
    ctx.lineWidth = Math.max(0.6, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(-ringR, 0);
    ctx.lineTo(ringR, 0);
    ctx.stroke();
  }
  ctx.restore();
}

function paintJupiter(ctx, r, detail) {
  bloom(ctx, r, [240, 220, 180], 3.4, 0.38);
  const flat = 0.93;                      // the most oblate planet there is

  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, '#e8d3ad');
  g.addColorStop(0.45, '#f6e6c8');
  g.addColorStop(1, '#d8bd8f');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * flat, 0, 0, Math.PI * 2);
  ctx.fill();

  if (detail) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(186,146,104,0.55)';
    for (const [y, height] of [[-0.42, 0.13], [-0.14, 0.16], [0.20, 0.15], [0.52, 0.10]]) {
      ctx.fillRect(-r, y * r, r * 2, height * r);
    }
    ctx.fillStyle = 'rgba(198,110,80,0.65)';
    ctx.beginPath();
    ctx.ellipse(r * 0.30, r * 0.26, r * 0.20, r * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function paintMars(ctx, r, limb, detail) {
  bloom(ctx, r, [230, 110, 70], 3.2, 0.36);

  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#ff9c6a');
  g.addColorStop(0.7, '#e2673a');
  g.addColorStop(1, '#a8412a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  if (detail) {
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(120,58,36,0.5)';
    ctx.beginPath();
    ctx.ellipse(r * 0.15, r * 0.05, r * 0.45, r * 0.28, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // Polar cap.
    ctx.fillStyle = 'rgba(255,248,242,0.85)';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.82, r * 0.42, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Venus and Mercury: small, phase-showing, and in Venus's case dazzling. */
function paintInner(ctx, r, body, limb, detail, [lit, shade], brilliance) {
  bloom(ctx, r, [255, 246, 220], 3.6, 0.3 + 0.3 * brilliance);
  if (brilliance > 0.8) spikes(ctx, r, [255, 250, 235], 0.32, 4.5);

  const k = clamp01(body.illuminated ?? 1);
  ctx.save();
  ctx.rotate(limb);

  if (detail) {
    ctx.fillStyle = 'rgba(60,58,54,0.45)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, r * Math.abs(1 - 2 * k), r, 0, Math.PI / 2, -Math.PI / 2, k > 0.5);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
  }

  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.25, 0, 0, 0, r);
  g.addColorStop(0, lit);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

function paintIceGiant(ctx, r, lit, shade) {
  bloom(ctx, r, hexToArr(shade), 3, 0.3);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 0, 0, 0, r);
  g.addColorStop(0, lit);
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
}

const hexToArr = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/* ----------------------------------------------------------------- stars */

/**
 * Scintillation. Air turbulence is what makes stars twinkle and planets not,
 * and it bites hardest near the horizon where the line of sight cuts through
 * the most atmosphere — so the amount here follows the air mass.
 */
export function twinkle(seed, altitude, time) {
  const airmass = clamp01(1 - altitude / 45);
  const amplitude = 0.06 + 0.4 * airmass * airmass;
  const a = Math.sin(time * 5.3 + seed * 12.9898);
  const b = Math.sin(time * 8.7 + seed * 78.233);
  return 1 + amplitude * (a * 0.6 + b * 0.4) * 0.5;
}
