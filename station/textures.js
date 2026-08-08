/**
 * Every surface in the station is baked here, at load, from noise. There are
 * no image files anywhere in this project — partly so the whole thing stays a
 * single self-contained HTML file, and partly because a station that has been
 * rotting for forty years wants stains that do not repeat.
 *
 * `bakeSurface` walks a texture once and emits albedo, roughness and a normal
 * map together, because all three come out of the same height field and
 * walking 256² pixels three times would be silly.
 */

import * as THREE from 'three';
import { fbm2, ridge2, cell2, clamp, saturate, smoothstep, lerp, makeRng } from './util.js';

/* ----------------------------------------------------------------- helpers */

const rgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

let maxAnisotropy = 1;
export function setAnisotropy(renderer) {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
}

function finish(tex, srgb) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * One pass over the texture. `sample(u, v, out)` fills `out`:
 *   out.r/g/b  albedo, 0..1, sRGB-ish
 *   out.rough  0..1
 *   out.metal  0..1  (packed into the roughness map's blue channel, which is
 *                     exactly where MeshStandardMaterial expects metalness)
 *   out.h      height, 0..1, for the normal map
 *   out.a      alpha, 0..1 — only used by the cutout materials
 */
function bakeSurface(size, sample, opts = {}) {
  const { normalStrength = 1.6, alpha = false } = opts;

  const albedo = new Uint8Array(size * size * 4);
  const arm = new Uint8Array(size * size * 4);   // (unused, rough, metal, -)
  const height = new Float32Array(size * size);
  const out = { r: 0, g: 0, b: 0, rough: 0.8, metal: 0, h: 0.5, a: 1 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      out.r = out.g = out.b = 0; out.rough = 0.8; out.metal = 0; out.h = 0.5; out.a = 1;
      sample(x / size, y / size, out);

      const i = (y * size + x) * 4;
      albedo[i]     = saturate(out.r) * 255;
      albedo[i + 1] = saturate(out.g) * 255;
      albedo[i + 2] = saturate(out.b) * 255;
      albedo[i + 3] = alpha ? saturate(out.a) * 255 : 255;

      arm[i]     = 255;
      arm[i + 1] = saturate(out.rough) * 255;
      arm[i + 2] = saturate(out.metal) * 255;
      arm[i + 3] = 255;

      height[y * size + x] = out.h;
    }
  }

  /* Central differences on the height field. Wrapping the lookups keeps the
   * normal map seamless, which matters because these tile a lot. */
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * normalStrength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * normalStrength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      normal[i]     = ((-dx / len) * 0.5 + 0.5) * 255;
      normal[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      normal[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      normal[i + 3] = 255;
    }
  }

  return {
    map: finish(new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat), true),
    armMap: finish(new THREE.DataTexture(arm, size, size, THREE.RGBAFormat), false),
    normalMap: finish(new THREE.DataTexture(normal, size, size, THREE.RGBAFormat), false),
  };
}

/* ------------------------------------------------------------------ steel */

/**
 * Painted hull panelling. Institutional green-grey over steel, with panel
 * seams, rivets, scuffs, and paint that has begun to let go in patches.
 */
export function paintedPanel(PAL) {
  const paint = rgb(PAL.paint);
  const steel = rgb(PAL.steel);
  const dark = rgb(PAL.steelDark);
  const rust = rgb(PAL.rust);

  return bakeSurface(256, (u, v, o) => {
    const U = u * 256, V = v * 256;

    // panel seams: a 4×4 grid of plates with a recessed groove between them
    const gx = Math.abs(((u * 4) % 1) - 0.5) * 2;
    const gy = Math.abs(((v * 4) % 1) - 0.5) * 2;
    const seam = Math.max(smoothstep(0.90, 1.0, gx), smoothstep(0.90, 1.0, gy));

    // rivets down each seam
    const rx = ((u * 4 * 8) % 1) - 0.5;
    const ry = ((v * 4 * 8) % 1) - 0.5;
    const rivet = (gx > 0.86 || gy > 0.86)
      ? smoothstep(0.30, 0.12, Math.hypot(rx, ry)) : 0;

    const grain = fbm2(U * 0.09, V * 0.09, 4);
    const flake = cell2(U * 0.055, V * 0.055);
    const bare = smoothstep(0.30, 0.06, flake) * smoothstep(0.44, 0.62, grain);
    const stain = ridge2(U * 0.02, V * 0.10, 3);   // vertical weeping from the seams

    let c = mix3(paint, mix3(paint, dark, 0.55), grain * 0.7);
    c = mix3(c, steel, bare * 0.85);                        // paint gone, steel under it
    c = mix3(c, mix3(rust, dark, 0.4), saturate(stain - 0.42) * 1.5 * (0.3 + bare));
    c = mix3(c, dark, seam * 0.7);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = clamp(0.78 - bare * 0.28 + grain * 0.16 - rivet * 0.15, 0.12, 0.98);
    o.metal = clamp(0.10 + bare * 0.80 - seam * 0.05, 0, 1);
    o.h = 0.5 - seam * 0.42 + rivet * 0.5 + grain * 0.08 - bare * 0.05;
  }, { normalStrength: 2.6 });
}

/**
 * The same steel where the paint lost entirely. Wetter, redder, flakier —
 * this is the material that carries the age of the place.
 */
export function rustedSteel(PAL) {
  const rust = rgb(PAL.rust);
  const deep = rgb(PAL.rustDeep);
  const steel = rgb(PAL.steelDark);

  return bakeSurface(256, (u, v, o) => {
    const U = u * 256, V = v * 256;

    const base = fbm2(U * 0.05, V * 0.05, 5);
    const scale = cell2(U * 0.09, V * 0.09);           // flake plates
    const pit = smoothstep(0.22, 0.02, cell2(U * 0.34, V * 0.34));
    const run = ridge2(U * 0.012, V * 0.09, 4);        // rust running downward

    let c = mix3(deep, rust, saturate(base * 1.5 - 0.2));
    c = mix3(c, mix3(rust, [0.55, 0.38, 0.26], 0.6), saturate(run - 0.38) * 1.1);
    c = mix3(c, steel, smoothstep(0.34, 0.52, scale) * 0.35);   // metal still showing
    c = mix3(c, deep, pit * 0.7);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = clamp(0.92 - smoothstep(0.4, 0.6, scale) * 0.28 + pit * 0.06, 0.3, 1);
    o.metal = clamp(0.06 + smoothstep(0.36, 0.58, scale) * 0.55, 0, 1);
    o.h = base * 0.5 + (1 - scale) * 0.35 - pit * 0.45;
  }, { normalStrength: 3.4 });
}

/* --------------------------------------------------------------- concrete */

/** The terminal floor: poured composite, expansion joints, four decades of
 *  water finding the low spots. */
export function terminalFloor(PAL) {
  const con = rgb(PAL.concrete);
  const worn = rgb(PAL.concreteWorn);
  const moss = rgb(PAL.moss);

  return bakeSurface(512, (u, v, o) => {
    const U = u * 256, V = v * 256;

    const joint = Math.max(
      smoothstep(0.965, 1.0, Math.abs(((u * 2) % 1) - 0.5) * 2),
      smoothstep(0.965, 1.0, Math.abs(((v * 2) % 1) - 0.5) * 2),
    );
    const agg = cell2(U * 0.55, V * 0.55);                    // aggregate
    const grime = fbm2(U * 0.035, V * 0.035, 5);
    const damp = smoothstep(0.52, 0.78, fbm2(U * 0.018 + 40, V * 0.018, 4));
    const bio = saturate(damp * 1.3 - 0.35) * smoothstep(0.4, 0.75, grime);
    const scuff = ridge2(U * 0.2, V * 0.03, 2);

    let c = mix3(con, worn, grime * 0.9);
    c = mix3(c, worn, saturate(scuff - 0.5) * 0.5);
    c = mix3(c, [c[0] * 0.55, c[1] * 0.58, c[2] * 0.6], damp * 0.7);   // wet
    c = mix3(c, moss, bio * 0.55);
    c = mix3(c, [0.10, 0.11, 0.11], joint * 0.85);
    c = mix3(c, [0.78, 0.78, 0.75], smoothstep(0.85, 0.95, agg) * 0.25);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = clamp(0.95 - damp * 0.55 - bio * 0.1, 0.18, 1);
    o.metal = 0.02;
    o.h = 0.5 - joint * 0.5 + (1 - agg) * 0.12 + grime * 0.06;
  }, { normalStrength: 1.5 });
}

/* ------------------------------------------------------------------ glass */

/** Grime on the panes. Drives roughness and a faint tint — the transparency
 *  itself is the material's job, not the texture's. */
export function glassGrime() {
  return bakeSurface(256, (u, v, o) => {
    const U = u * 256, V = v * 256;
    const dirt = fbm2(U * 0.03, V * 0.03, 5);
    const runs = ridge2(U * 0.015, V * 0.13, 4);        // rain-track streaks
    const edge = 1 - smoothstep(0.0, 0.16, Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v)));
    const film = saturate(dirt * 0.7 + saturate(runs - 0.4) * 1.2 + edge * 0.8);

    o.r = lerp(0.78, 0.52, film);
    o.g = lerp(0.83, 0.55, film);
    o.b = lerp(0.80, 0.50, film);
    o.rough = clamp(0.03 + film * 0.55, 0.02, 0.8);
    o.metal = 0;
    o.h = film * 0.3;
  }, { normalStrength: 0.8 });
}

/* --------------------------------------------------------------- foliage */

/**
 * One leaf on a transparent card. The shape is analytic: a lens whose width
 * follows sin(πv), with a midrib, side veins and a darker margin. Instances
 * get their own tint and scale, so a single card is enough variety.
 */
export function leafCard(PAL) {
  const pale = rgb(PAL.leafPale);
  const mid = rgb(PAL.leaf);
  const dark = rgb(PAL.leafDark);

  return bakeSurface(128, (u, v, o) => {
    const t = v;                                   // 0 at stem, 1 at tip
    /* Narrow, and pushed toward the tip. The first version was a fat lens and
     * a few thousand of them at distance read as shrubbery made of coins. */
    const lobe = Math.pow(Math.sin(Math.PI * clamp(t * 0.88 + 0.06, 0, 1)), 0.85);
    const width = lobe * 0.20 * (1 - 0.28 * Math.cos(t * 7.4));   // slight scallop
    const dx = Math.abs(u - 0.5);
    const inside = width - dx;

    // A bare stem for the bottom fifth, which is what actually reads as a leaf.
    const stem = smoothstep(0.0, 0.02, 0.022 - dx) * smoothstep(0.26, 0.02, t);
    o.a = Math.max(smoothstep(0.0, 0.010, inside), stem) * smoothstep(1.0, 0.97, t);
    if (o.a <= 0.001) { o.r = o.g = o.b = 0; o.h = 0.5; return; }

    const across = dx / Math.max(width, 1e-3);     // 0 midrib .. 1 margin
    const rib = smoothstep(0.10, 0.0, across);
    const veins = smoothstep(0.55, 0.85,
      Math.abs(Math.sin((t * 9.0 - across * 3.2) * Math.PI)) );
    const blotch = fbm2(u * 90, v * 90, 3);

    let c = mix3(mid, pale, saturate(t * 0.5 + blotch * 0.5));
    c = mix3(c, dark, across * across * 0.55);     // darker toward the margin
    c = mix3(c, pale, rib * 0.5 + veins * 0.14);
    c = mix3(c, mix3(dark, [0.45, 0.36, 0.18], 0.5), saturate(blotch * 1.4 - 0.85)); // dieback

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = 0.72 - rib * 0.2;
    o.metal = 0;
    o.h = 0.5 + rib * 0.25 - veins * 0.08;
  }, { normalStrength: 1.1, alpha: true });
}

/** A soft-edged patch of moss, laid flat on floors and ledges. */
export function mossPatch(PAL) {
  const moss = rgb(PAL.moss);
  const dark = rgb(PAL.leafDark);
  const pale = rgb(PAL.leafPale);

  return bakeSurface(128, (u, v, o) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    /* Two scales of wobble on the outline. One was not enough: a single
     * octave still leaves a recognisable disc, and a disc of bright green on
     * a wall reads as a decal, not as moss. */
    const wob = fbm2(u * 9, v * 9, 3) * 0.7 + fbm2(u * 34, v * 34, 3) * 0.3;
    o.a = smoothstep(1.0, 0.30, d + (wob - 0.5) * 1.5);

    const clump = cell2(u * 58, v * 58);
    let c = mix3(dark, moss, fbm2(u * 40, v * 40, 4));
    c = mix3(c, pale, smoothstep(0.4, 0.05, clump) * 0.20);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = 0.95;
    o.metal = 0;
    o.h = 1 - clump;
  }, { normalStrength: 2.2, alpha: true });
}

/** Bark for the trunks that have come up through the floor. */
export function bark(PAL) {
  const base = rgb(PAL.bark);
  const dark = [0.12, 0.10, 0.09];
  const moss = rgb(PAL.moss);

  return bakeSurface(256, (u, v, o) => {
    const U = u * 256, V = v * 256;
    const fissure = ridge2(U * 0.10, V * 0.014, 5);       // vertical splits
    const grain = fbm2(U * 0.3, V * 0.05, 4);
    const green = smoothstep(0.55, 0.85, fbm2(U * 0.04 + 11, V * 0.04, 3));

    let c = mix3(base, dark, saturate(fissure * 1.6 - 0.4));
    c = mix3(c, [c[0] * 1.25, c[1] * 1.2, c[2] * 1.1], grain * 0.25);
    c = mix3(c, moss, green * 0.4);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = 0.94 - green * 0.06;
    o.metal = 0;
    o.h = fissure * 0.8 + grain * 0.2;
  }, { normalStrength: 3.0 });
}

/* --------------------------------------------------------------- sprites */

/** Soft round sprite, for dust motes and the bioluminescent pods. */
export function radialSprite(size = 64, power = 2.2) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const a = Math.pow(saturate(1 - d), power);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/* --------------------------------------------------------------- signage */

/**
 * The departure board. This is the one texture that needs a real 2D canvas,
 * because it needs letterforms. Every destination on it is cancelled; the
 * board is the only thing in the hall that still tries to say something.
 */
export function departureBoard(rows) {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  g.fillStyle = '#05090b';
  g.fillRect(0, 0, W, H);

  // scanline tint of a display that has been on for four decades
  for (let y = 0; y < H; y += 3) {
    g.fillStyle = 'rgba(120,190,210,0.030)';
    g.fillRect(0, y, W, 1);
  }

  g.textBaseline = 'middle';
  const mono = '600 30px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  g.font = '600 34px ui-monospace, Menlo, monospace';
  g.fillStyle = '#7fd6c4';
  g.fillText('ABFLUG / DEPARTURES', 40, 48);
  g.fillStyle = '#3d6b66';
  g.fillText('KEPLER-9', W - 220, 48);

  g.fillStyle = 'rgba(120,220,200,0.22)';
  g.fillRect(36, 76, W - 72, 2);

  rows.forEach((row, i) => {
    const y = 132 + i * 56;
    g.font = mono;
    // burn-in: the rows that never changed are brighter than the rest
    const burn = i % 3 === 0 ? 0.92 : 0.62;
    g.fillStyle = `rgba(126,214,196,${burn})`;
    g.fillText(row.time, 44, y);
    g.fillText(row.dest, 210, y);

    g.fillStyle = row.status === 'ANNULLIERT'
      ? 'rgba(216,84,58,0.85)' : 'rgba(126,214,196,0.35)';
    g.fillText(row.status, 640, y);
  });

  // dead pixel columns and a horizontal tear
  const rng = makeRng(0x5117);
  for (let i = 0; i < 26; i++) {
    const x = (rng() * W) | 0;
    g.fillStyle = 'rgba(0,0,0,0.8)';
    g.fillRect(x, 0, 1 + ((rng() * 2) | 0), H);
  }
  g.fillStyle = 'rgba(0,0,0,0.75)';
  g.fillRect(0, 300 + ((rng() * 60) | 0), W, 7);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/**
 * Enamel gate signs. Small, high contrast, and the last thing in here that
 * was ever printed by anyone.
 */
export function gateSign(label, sub) {
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  g.fillStyle = '#c9cfc6';
  g.fillRect(0, 0, W, H);

  // enamel chipped off along the edges
  const rng = makeRng(label.charCodeAt(0) * 977 + label.length);
  for (let i = 0; i < 260; i++) {
    const x = rng() * W, y = rng() * H;
    const edge = 1 - Math.min(Math.min(x, W - x) / 60, Math.min(y, H - y) / 40);
    if (rng() < edge * 0.8) {
      g.fillStyle = `rgba(74,44,28,${0.25 + rng() * 0.5})`;
      g.beginPath();
      g.arc(x, y, 1.5 + rng() * 7, 0, Math.PI * 2);
      g.fill();
    }
  }

  g.fillStyle = '#1d2a2e';
  g.font = '700 104px ui-sans-serif, Helvetica, Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(label, 36, 96);
  g.font = '400 38px ui-sans-serif, Helvetica, Arial, sans-serif';
  g.fillStyle = '#44555a';
  g.fillText(sub, 38, 178);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAnisotropy);
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ space */

/**
 * What is outside the panorama window: a starfield with a planet limb. Baked
 * into an equirectangular-ish backdrop rather than a real skybox, because it
 * is only ever seen through one window and one hole in the roof.
 */
export function starfield(size = 1024) {
  const data = new Uint8Array(size * (size / 2) * 4);
  const h = size / 2;
  const rng = makeRng(0x51a7);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // faint galactic band, so the black is not flat black
      const band = Math.exp(-Math.pow((y / h - 0.52) * 6.5, 2)) * 0.10
        * (0.5 + fbm2(x * 0.02, y * 0.02, 4));
      data[i]     = (band * 120) | 0;
      data[i + 1] = (band * 132) | 0;
      data[i + 2] = (band * 168) | 0;
      data[i + 3] = 255;
    }
  }
  // stars
  for (let n = 0; n < 2600; n++) {
    const x = (rng() * size) | 0;
    const y = (rng() * h) | 0;
    const b = Math.pow(rng(), 3.2);
    const warm = rng();
    const i = (y * size + x) * 4;
    data[i]     = Math.min(255, data[i]     + b * 255 * (0.8 + warm * 0.2));
    data[i + 1] = Math.min(255, data[i + 1] + b * 255 * 0.92);
    data[i + 2] = Math.min(255, data[i + 2] + b * 255 * (1.0 - warm * 0.25));
  }

  const tex = new THREE.DataTexture(data, size, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** The planet's surface, seen from low orbit. Cloud bands over cold ocean. */
export function planetSurface(PAL, size = 512) {
  const ocean = rgb(PAL.planet);
  const land = [0.30, 0.33, 0.28];
  const ice = [0.86, 0.90, 0.94];

  return bakeSurface(size, (u, v, o) => {
    const U = u * 256, V = v * 256;
    const cont = fbm2(U * 0.02, V * 0.028, 6);
    const isLand = smoothstep(0.50, 0.58, cont);
    const cloud = smoothstep(0.48, 0.72, fbm2(U * 0.045 + 90, V * 0.016, 5));
    const polar = smoothstep(0.34, 0.06, Math.abs(v - 0.5) * 2 - 0.55);

    let c = mix3(ocean, land, isLand);
    c = mix3(c, ice, saturate(polar));
    c = mix3(c, [0.92, 0.94, 0.96], cloud * 0.8);

    o.r = c[0]; o.g = c[1]; o.b = c[2];
    o.rough = lerp(0.35, 0.95, isLand);
    o.metal = 0;
    o.h = cont;
  }, { normalStrength: 0.6 }).map;
}
