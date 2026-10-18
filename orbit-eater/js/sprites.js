/**
 * Prozedurale Grafik.
 *
 * Es gibt im ganzen Spiel keine einzige Bilddatei: Planetenoberflächen,
 * Gasbänder, Kraterfelder, Sternfelder, Nebel und die Akkretionsscheibe
 * der Schwarzen Löcher werden hier beim Start bzw. bei Bedarf aus Rauschen
 * berechnet und als Offscreen-Canvas gecacht.
 *
 * Kugeltexturen sind "Streifen" (3H × H): 2H breit entspricht 360° Länge,
 * die ersten H Spalten werden hinten noch einmal angehängt. So kann der
 * Renderer jedes H-breite Fenster (= sichtbare Halbkugel) in einem Stück
 * herausschneiden und die Textur endlos scrollen — der Planet dreht sich.
 * Die Zeilen sind nach Breitengrad verteilt (y ∝ sin φ), dadurch sitzen
 * Muster ohne weitere Verzerrung korrekt auf der Kugel.
 */
import { ASTEROID, STAGES } from './config.js';
import { TAU, clamp, lerp, fbm, valueNoise, hexToRgb, mixRgb, mulberry32, smoothstep } from './utils.js';

export const STRIP_H = 128;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// --- Paletten ----------------------------------------------------------------

const rgbAll = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? v.map(hexToRgb) : typeof v === 'string' && v[0] === '#' ? hexToRgb(v) : v;
    out[k + 'Hex'] = v;
  }
  return out;
};

const ROCK = [
  { dark: '#2c2724', base: '#6b6058', light: '#a89a8c' },
  { dark: '#262b31', base: '#5d6670', light: '#9aa6b0' },
  { dark: '#2f2119', base: '#7a5a45', light: '#b9937a' },
  { dark: '#23211f', base: '#57524c', light: '#8f8880' },
].map(rgbAll);

const MOON = [
  { dark: '#5a5650', base: '#a9a49a', light: '#dcd6cb', mare: '#6f6a62' },
  { dark: '#545b62', base: '#9ea6ad', light: '#d3d9de', mare: '#68707a' },
  { dark: '#62584a', base: '#b3a58f', light: '#e0d3bc', mare: '#7a6d5a' },
].map(rgbAll);

const ICE = [
  { dark: '#8fb2c8', base: '#cfe3ee', light: '#f6fbff', stain: '#a8704e' },
  { dark: '#9aaebc', base: '#d9e4ea', light: '#ffffff', stain: '#b0805a' },
  { dark: '#7fa6ad', base: '#c4dde0', light: '#eefcff', stain: '#8a5a44' },
].map(rgbAll);

const LAVA = [
  { crust: '#1c1714', crust2: '#3b2f27', sulfur: '#b8a040', lava: '#ff6a12', hot: '#ffd36a' },
  { crust: '#33291a', crust2: '#5e4e22', sulfur: '#d8c860', lava: '#ff5a1a', hot: '#ffe08a' },
].map(rgbAll);

const DESERT = [
  { deep: '#3a160e', shallow: '#6a2a18', low: '#a2482a', high: '#cf7d4a', peak: '#efc08a', ice: '#fbe9d8', atmo: '#ffab7a' },
  { deep: '#3a2a12', shallow: '#6a4a22', low: '#b08040', high: '#d8a860', peak: '#f0d8a0', ice: '#fff4e0', atmo: '#ffd59a' },
].map(rgbAll);

const OCEAN = [
  { deep: '#0b2545', shallow: '#1d5f8a', low: '#3f6b35', high: '#8a7a4a', peak: '#cbbf98', ice: '#eef3f5', atmo: '#7fc8ff' },
  { deep: '#0f3436', shallow: '#1f7f78', low: '#7a4a2e', high: '#b07a4a', peak: '#e0c08a', ice: '#f4efe6', atmo: '#8fe3d0' },
  { deep: '#1d1638', shallow: '#3d3478', low: '#5f7f62', high: '#a8a878', peak: '#dcd6a8', ice: '#f0eefa', atmo: '#b9a8ff' },
].map(rgbAll);

const VENUS = [
  { a: '#f4e6b8', b: '#dcbc74', c: '#b58e4c', atmo: '#ffe2a0' },
  { a: '#f1e9d6', b: '#d2c09a', c: '#a8916a', atmo: '#fff0c8' },
].map(rgbAll);

const ICEGIANT = [
  { bands: ['#c8f0f4', '#a4e2ea', '#86d2de', '#d8f6f8', '#70c2d0'], storm: '#2d6f8a', ring: '#b8d8e0' },
  { bands: ['#a8c8f6', '#7aa2ea', '#5880d6', '#c8dcf8', '#4466c0'], storm: '#1d2f66', ring: '#a8c0e0' },
].map(rgbAll);

const JOVIAN = [
  { bands: ['#efe0c0', '#c99a68', '#a7643f', '#f4e9d2', '#8a4b30'], storm: '#b5502e', ring: '#d8c4a0' },
  { bands: ['#f0d8b8', '#d8a878', '#b07048', '#f8ead8', '#986040'], storm: '#c06038', ring: '#e0c8a8' },
  { bands: ['#c9ece2', '#6fb8a8', '#2f7f78', '#e2f6ef', '#1f5a55'], storm: '#e8fff8', ring: '#a8d8cc' },
].map(rgbAll);

const SATURN = [
  { bands: ['#efdcaa', '#cfae6a', '#a5844a', '#f7ebc8', '#7a5c34'], storm: '#f5e6b8', ring: '#e6d2a0' },
  { bands: ['#f2e6c8', '#dcc89a', '#bfa470', '#faf2dc', '#a08a5a'], storm: '#fff4d8', ring: '#ece0c0' },
].map(rgbAll);

const BROWN = [
  { bands: ['#5a1e2a', '#3a1018', '#7a2a2a', '#2a0c12', '#8a3a2a'], glow: '#ff4a2a', ember: '#ff7a3a' },
  { bands: ['#4a2420', '#2a1210', '#6a3424', '#1e0c0a', '#7a4428'], glow: '#ff6a2a', ember: '#ff9a4a' },
].map(rgbAll);

const STARS = {
  red: [{ core: '#fff0e0', mid: '#ff9a62', edge: '#c8402a', corona: '#ff6a4a' }],
  sun: [
    { core: '#fff8e6', mid: '#ffd27a', edge: '#f08a32', corona: '#ffb347' },
    { core: '#fffdf0', mid: '#fff0a8', edge: '#ffbf40', corona: '#ffe08a' },
  ],
  blue: [{ core: '#ffffff', mid: '#dce8ff', edge: '#7f9cff', corona: '#9fc0ff' }],
  giant: [{ core: '#ffe8c8', mid: '#ff8a4a', edge: '#9a2a16', corona: '#ff5a2a' }],
};
for (const k of Object.keys(STARS)) STARS[k] = STARS[k].map(rgbAll);

const pal = (list, seed) => list[seed % list.length];

// --- Pixel-Helfer ---------------------------------------------------------------

function paint(ctx, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      out[3] = 255;
      fn(x, y, out);
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
      d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Legt einen Kugelstreifen an; `fn(u, v, out)` bekommt Länge u und Breite v (je 0..1). */
function sphereStrip(fn) {
  const H = STRIP_H, W = H * 2;
  const c = makeCanvas(W + H, H);
  const ctx = c.getContext('2d');
  const lat = new Float32Array(H);
  for (let y = 0; y < H; y++) lat[y] = Math.asin(clamp(((y + 0.5) / H) * 2 - 1, -1, 1)) / Math.PI + 0.5;
  paint(ctx, W, H, (x, y, out) => fn(x / W, lat[y], out));
  return { c, ctx, W, H };
}

/** Hängt die ersten H Spalten hinten an → nahtloses Scrollen. */
function closeStrip(s) {
  s.ctx.drawImage(s.c, 0, 0, s.H, s.H, s.W, 0, s.H, s.H);
  return s.c;
}

/** Breite v (0..1) → Pixelzeile im Streifen, plus horizontale Dehnung (1/cos φ). */
function latToY(v, H) {
  const phi = (v - 0.5) * Math.PI;
  return { y: (Math.sin(phi) * 0.5 + 0.5) * H, stretch: 1 / Math.max(0.25, Math.cos(phi)) };
}

/** Zeichnet etwas an x und — falls es über den Rand ragt — zusätzlich um eine Periode versetzt. */
function wrapDraw(W, x, r, fn) {
  fn(x);
  if (x - r < 0) fn(x + W);
  if (x + r > W) fn(x - W);
}

const rgbStr = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Krater, Licht von links oben: Mulde dunkel, Innenwand rechts unten hell. */
function crater(ctx, x, y, rx, ry, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(-0.3, -0.3, 0, 0, 0, 1);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.2)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.lineWidth = 0.16;
  ctx.strokeStyle = rgbStr(light, 0.45);
  ctx.beginPath();
  ctx.arc(0, 0, 0.86, -0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.lineWidth = 0.1;
  ctx.strokeStyle = rgbStr(light, 0.2);
  ctx.beginPath();
  ctx.arc(0, 0, 1.06, 0.9 * Math.PI, 1.6 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

// --- Körper-Kunst je Stufe --------------------------------------------------------
//
// Jede Stufe aus config.js (STAGES[i].key) hat hier einen Bauplan. Die meisten
// nutzen parametrisierte Generatoren (Planet, Riese, Stern) mit eigenen Paletten;
// Exoten wie Pulsar, Schwarzes Loch und Galaxie haben eigene Zeichenarten.
//
// Felder, die der Renderer auswertet:
//   kind      'rock' | 'sphere' | 'star' | 'pulsar' | 'hole' | 'quasar' | 'galaxy'
//   surface   Oberflächentextur (Kugelstreifen bzw. Quadrat bei 'rock')
//   clouds    zweite, halbtransparente Schicht, dreht `cloudRate`-mal so schnell
//   emissive  Leuchtschicht (Lava, Glut) — leuchtet auch auf der Nachtseite
//   atmo      Farbe des Atmosphärensaums, `atmoSize` = Außenradius
//   glow      weicher Schein hinter dem Körper (`glowSize`, `glowAlpha`)
//   ring      Ringsystem { canvas, tilt, rot, outer }
//   thumb     Radius in der Stufen-Vorschau (Anteil der Bildgröße)
//   extent    wie weit das Namensschild nach unten rücken muss (× r)
//   reach     wie weit der Körper optisch reicht (× r), fürs Culling

const STAGE_ART = {
  asteroid: (seed, rng) => rockArt(seed, rng),
  moon: (seed, rng) => moonArt(seed, rng, pal(MOON, seed)),
  icemoon: (seed, rng) => iceMoonArt(seed, rng, pal(ICE, seed)),
  lavamoon: (seed, rng) => lavaMoonArt(seed, rng, pal(LAVA, seed)),
  desert: (seed, rng) => planetArt(seed, rng, pal(DESERT, seed), { sea: 0.32, clouds: 0.35, ice: 0.84 }),
  ocean: (seed, rng) => planetArt(seed, rng, pal(OCEAN, seed), { sea: 0.52, clouds: 1, ice: 0.76 }),
  cloud: (seed, rng) => cloudWorldArt(seed, rng, pal(VENUS, seed)),
  icegiant: (seed, rng) => giantArt(seed, rng, pal(ICEGIANT, seed), {
    freq: 3.5, turb: 0.5, streak: 14, storm: 0.6,
    ring: { chance: 1, outer: 1.85, inner: 0.8, alpha: 0.5, rot: Math.PI / 2 - 0.3, tilt: 0.24 },
  }),
  gasgiant: (seed, rng) => giantArt(seed, rng, pal(JOVIAN, seed), {
    freq: 7, turb: 1.4, streak: 46, storm: 1,
    ring: { chance: 0.3, outer: 1.9, inner: 0.72, alpha: 0.55 },
  }),
  ringgiant: (seed, rng) => giantArt(seed, rng, pal(SATURN, seed), {
    freq: 6, turb: 1, streak: 30, storm: 0.4,
    ring: { chance: 1, outer: 2.6, inner: 0.48, alpha: 1 },
  }),
  browndwarf: (seed, rng) => brownDwarfArt(seed, rng, pal(BROWN, seed)),
  reddwarf: (seed, rng) => starArt(seed, rng, STARS.red[0], { corona: 2.6, rays: 10, cells: 1 }),
  sun: (seed, rng) => starArt(seed, rng, pal(STARS.sun, seed), { corona: 3.4, rays: 18, cells: 1 }),
  bluegiant: (seed, rng) => starArt(seed, rng, STARS.blue[0], { corona: 4.2, rays: 26, cells: 1.4, rayAlpha: 0.09 }),
  redgiant: (seed, rng) => starArt(seed, rng, STARS.giant[0], { corona: 3, rays: 0, cells: 0.4, spots: 7 }),
  neutron: (seed, rng) => pulsarArt(seed, rng),
  blackhole: (seed, rng) => holeArt(seed, rng, false),
  quasar: (seed, rng) => holeArt(seed, rng, true),
  galaxy: (seed, rng) => galaxyArt(seed, rng),
};

/**
 * Erzeugt das Aussehen eines Körpers für eine Stufe. Deterministisch aus dem
 * Seed — derselbe Bot sieht nach einem Stufenwechsel "verwandt" aus.
 */
export function buildBodyArt(seed, stage) {
  const rng = mulberry32(seed + stage * 7919);
  const art = STAGE_ART[STAGES[stage].key](seed, rng);
  art.stage = stage;
  return art;
}

/** Zufallsquelle mit Normalverteilung für die Generatoren (unabhängig vom Spiel-Zufall). */
function gaussFrom(rng) {
  return () => {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  };
}

function rockArt(seed, rng) {
  const p = pal(ROCK, seed);
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  paint(ctx, S, S, (x, y, out) => {
    const n = fbm((x / S) * 5, (y / S) * 5, seed, 5) * 0.75 + fbm((x / S) * 16, (y / S) * 16, seed + 9, 3) * 0.25;
    if (n < 0.5) mixRgb(p.dark, p.base, n * 2, out);
    else mixRgb(p.base, p.light, (n - 0.5) * 2, out);
  });
  for (let i = 0; i < 9; i++) {
    const r = 4 + rng() * 11;
    crater(ctx, 14 + rng() * (S - 28), 14 + rng() * (S - 28), r, r, p.light);
  }
  // Unregelmäßige Silhouette: Radius entlang des Umfangs aus Rauschen
  const n = 22;
  const shape = new Float32Array(n * 2);
  let max = 0;
  const radii = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = 0.8 + 0.34 * fbm(Math.cos(a) * 1.3 + 3, Math.sin(a) * 1.3 + 3, seed + 77, 3);
    radii.push(rr);
    max = Math.max(max, rr);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    shape[i * 2] = (Math.cos(a) * radii[i]) / max;
    shape[i * 2 + 1] = (Math.sin(a) * radii[i]) / max;
  }
  return { kind: 'rock', surface: c, shape, tint: p.baseHex, thumb: 0.34 };
}

function moonArt(seed, rng, p) {
  const s = sphereStrip((u, v, out) => {
    const n = fbm(u * 8, v * 4, seed, 5, 8);
    const m = fbm(u * 3, v * 1.5, seed + 7, 3, 3);
    if (n < 0.5) mixRgb(p.dark, p.base, n * 2, out);
    else mixRgb(p.base, p.light, (n - 0.5) * 2, out);
    mixRgb(out, p.mare, smoothstep(0.5, 0.62, m) * 0.75, out);
  });
  for (let i = 0; i < 34; i++) {
    const v = 0.12 + rng() * 0.76;
    const { y, stretch } = latToY(v, s.H);
    const r = 2 + rng() * rng() * 13;
    wrapDraw(s.W, rng() * s.W, r * stretch, x => crater(s.ctx, x, y, r * stretch, r, p.light));
  }
  return { kind: 'sphere', surface: closeStrip(s), tint: p.baseHex, rate: 0.016 + rng() * 0.01, thumb: 0.34 };
}

/** Eismond wie Europa: helles Eis, rostbraune Flecken und lange Risse (Lineae). */
function iceMoonArt(seed, rng, p) {
  const s = sphereStrip((u, v, out) => {
    const n = fbm(u * 6, v * 3, seed, 5, 6);
    const chaos = fbm(u * 3, v * 1.5, seed + 9, 3, 3);
    if (n < 0.5) mixRgb(p.dark, p.base, n * 2, out);
    else mixRgb(p.base, p.light, (n - 0.5) * 2, out);
    mixRgb(out, p.stain, smoothstep(0.56, 0.76, chaos) * 0.42, out);
  });
  const ctx = s.ctx;
  ctx.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    const y0 = 10 + rng() * (s.H - 20);
    const a = (rng() - 0.5) * 1.1;
    const len = 40 + rng() * 120;
    const bend = (rng() - 0.5) * 50;
    const w = 0.6 + rng() * 1.5;
    wrapDraw(s.W, rng() * s.W, len, x => {
      const ex = x + Math.cos(a) * len, ey = y0 + Math.sin(a) * len;
      const cx = (x + ex) / 2 - Math.sin(a) * bend, cy = (y0 + ey) / 2 + Math.cos(a) * bend * 0.4;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.strokeStyle = rgbStr(p.stain, 0.6);
      ctx.lineWidth = w;
      ctx.stroke();
      ctx.strokeStyle = rgbStr(p.light, 0.4);
      ctx.lineWidth = w * 0.35;
      ctx.stroke();
    });
  }
  return { kind: 'sphere', surface: closeStrip(s), atmo: '#d8f0ff', atmoSize: 1.06, tint: p.baseHex, rate: 0.014 + rng() * 0.01, thumb: 0.34 };
}

/** Lavamond wie Io: dunkle Kruste, Schwefelfelder, glühende Spalten und Vulkane. */
function lavaMoonArt(seed, rng, p) {
  const s = sphereStrip((u, v, out) => {
    const n = fbm(u * 7, v * 3.5, seed, 5, 7);
    const sul = fbm(u * 4, v * 2, seed + 3, 3, 4);
    mixRgb(p.crust, p.crust2, n, out);
    mixRgb(out, p.sulfur, smoothstep(0.58, 0.78, sul) * 0.55, out);
  });
  // Leuchtschicht: feine Grate im Rauschen ergeben ein Netz aus Lavaspalten
  const e = sphereStrip((u, v, out) => {
    const n = fbm(u * 6, v * 3, seed + 11, 4, 6);
    const ridge = 1 - Math.abs(n * 2 - 1);
    const region = smoothstep(0.36, 0.6, fbm(u * 3, v * 1.5, seed + 21, 3, 3));
    mixRgb(p.lava, p.hot, smoothstep(0.95, 1, ridge), out);
    out[3] = smoothstep(0.87, 0.98, ridge) * region * 255;
  });
  for (let i = 0; i < 9; i++) {
    const { y, stretch } = latToY(0.15 + rng() * 0.7, s.H);
    const r = 2 + rng() * 4;
    wrapDraw(s.W, rng() * s.W, r * 3 * stretch, x => {
      s.ctx.fillStyle = 'rgba(0,0,0,0.35)';
      s.ctx.beginPath();
      s.ctx.ellipse(x, y, r * 2.4 * stretch, r * 2.4, 0, 0, TAU);
      s.ctx.fill();
      const g = e.ctx.createRadialGradient(x, y, 0, x, y, r * 1.8 * stretch);
      g.addColorStop(0, rgbStr(p.hot, 1));
      g.addColorStop(0.45, rgbStr(p.lava, 0.85));
      g.addColorStop(1, rgbStr(p.lava, 0));
      e.ctx.fillStyle = g;
      e.ctx.beginPath();
      e.ctx.ellipse(x, y, r * 1.8 * stretch, r * 1.8, 0, 0, TAU);
      e.ctx.fill();
    });
  }
  return {
    kind: 'sphere', surface: closeStrip(s), emissive: closeStrip(e),
    glow: p.lavaHex, glowSize: 1.7, glowAlpha: 0.22,
    tint: p.lavaHex, rate: 0.02 + rng() * 0.01, flare: rng() * TAU, thumb: 0.34,
  };
}

/** Gesteinsplanet: Meere (oder Tiefländer), Kontinente, Polkappen, optional Wolken. */
function planetArt(seed, rng, p, o) {
  const sea = o.sea - 0.05 + rng() * 0.1;
  const tmp = [0, 0, 0];
  const s = sphereStrip((u, v, out) => {
    const h = fbm(u * 5, v * 2.5, seed, 5, 5);
    if (h < sea) {
      mixRgb(p.deep, p.shallow, smoothstep(sea - 0.2, sea, h), out);
    } else {
      const t = (h - sea) / (1 - sea);
      if (t < 0.45) mixRgb(p.low, p.high, t / 0.45, out);
      else mixRgb(p.high, p.peak, (t - 0.45) / 0.55, out);
      const f = fbm(u * 20, v * 10, seed + 4, 2, 20) - 0.5;
      out[0] += f * 30; out[1] += f * 30; out[2] += f * 30;
    }
    const lat = Math.abs(v - 0.5) * 2;
    const ice = smoothstep(o.ice, o.ice + 0.1, lat + (fbm(u * 12, v * 6, seed + 3, 3, 12) - 0.5) * 0.25);
    mixRgb(out, p.ice, ice, tmp);
    out[0] = tmp[0]; out[1] = tmp[1]; out[2] = tmp[2];
  });
  let clouds = null;
  if (o.clouds > 0) {
    const cl = sphereStrip((u, v, out) => {
      const n = fbm(u * 5, v * 9, seed + 50, 5, 5);
      const lat = Math.abs(v - 0.5) * 2;
      out[0] = 255; out[1] = 255; out[2] = 255;
      out[3] = smoothstep(0.56, 0.8, n) * (0.5 + 0.5 * (1 - lat)) * 200 * o.clouds;
    });
    clouds = closeStrip(cl);
  }
  return {
    kind: 'sphere', surface: closeStrip(s), clouds,
    atmo: p.atmoHex, tint: o.sea < 0.4 ? p.lowHex : p.shallowHex, rate: 0.022 + rng() * 0.012, thumb: 0.34,
  };
}

/** Wolkenwelt wie die Venus: geschlossene, gelbliche Wolkendecke mit V-förmigen Bändern. */
function cloudWorldArt(seed, rng, p) {
  const s = sphereStrip((u, v, out) => {
    const warp = fbm(u * 3, v * 5, seed, 4, 3);
    const t = v * 5 + (warp - 0.5) * 2.4 + Math.abs(Math.sin(u * TAU * 2)) * 0.5 * (0.5 - Math.abs(v - 0.5));
    const f = t - Math.floor(t);
    const k = fbm(u * 10, v * 18, seed + 4, 3, 10);
    mixRgb(p.b, p.a, clamp(smoothstep(0.2, 0.8, f) * 0.7 + k * 0.3, 0, 1), out);
    mixRgb(out, p.c, smoothstep(0.62, 0.85, warp) * 0.5, out);
  });
  const cl = sphereStrip((u, v, out) => {
    const n = fbm(u * 6, v * 14, seed + 40, 4, 6);
    out[0] = p.a[0]; out[1] = p.a[1]; out[2] = p.a[2];
    out[3] = smoothstep(0.5, 0.76, n) * 150;
  });
  return {
    kind: 'sphere', surface: closeStrip(s), clouds: closeStrip(cl), cloudRate: 2.4,
    atmo: p.atmoHex, atmoSize: 1.2, tint: p.bHex, rate: 0.012 + rng() * 0.008, thumb: 0.32,
  };
}

/** Gas- und Eisriesen: Wolkenbänder, Sturmfleck, Ringe — alles über Optionen steuerbar. */
function giantArt(seed, rng, p, o) {
  const bands = p.bands;
  const nb = bands.length;
  const freq = o.freq * (0.8 + rng() * 0.4);
  const s = sphereStrip((u, v, out) => {
    const turb = fbm(u * 4, v * 6, seed, 4, 4);
    const pos = v * freq + (turb - 0.5) * o.turb + Math.sin(u * TAU * 2 + v * 9) * 0.05;
    const i = Math.floor(pos);
    const a = bands[((i % nb) + nb) % nb], b = bands[(((i + 1) % nb) + nb) % nb];
    mixRgb(a, b, smoothstep(0.62, 1, pos - i), out);
    const streak = (fbm(u * 16, v * 48, seed + 5, 3, 16) - 0.5) * o.streak;
    out[0] += streak; out[1] += streak; out[2] += streak;
  });
  if (rng() < o.storm) {
    const { y, stretch } = latToY(0.3 + rng() * 0.4, s.H);
    const rx = (8 + rng() * 7) * stretch, ry = 5 + rng() * 3;
    wrapDraw(s.W, rng() * s.W, rx, x => {
      const ctx = s.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, rgbStr(p.storm, 0.95));
      g.addColorStop(0.6, rgbStr(p.storm, 0.6));
      g.addColorStop(1, rgbStr(p.storm, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 0.08;
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.62, 0.48, 0.2, 0, TAU);
      ctx.stroke();
      ctx.restore();
    });
  }
  const R = o.ring;
  const ring = rng() < R.chance ? {
    canvas: ringSprite(p.ring, seed, R.inner, R.alpha),
    tilt: R.tilt ?? 0.2 + rng() * 0.16,
    rot: R.rot ?? (rng() - 0.5) * 0.9,
    outer: R.outer,
  } : null;
  return {
    kind: 'sphere', surface: closeStrip(s), ring, tint: p.bandsHex[1], rate: 0.03 + rng() * 0.015,
    thumb: ring ? Math.min(0.34, 0.47 / ring.outer) : 0.34,
  };
}

/** Brauner Zwerg: zu klein für Kernfusion — dunkle Bänder, die von innen glimmen. */
function brownDwarfArt(seed, rng, p) {
  const bands = p.bands;
  const nb = bands.length;
  const s = sphereStrip((u, v, out) => {
    const turb = fbm(u * 4, v * 6, seed, 4, 4);
    const pos = v * 6 + (turb - 0.5) * 1.6;
    const i = Math.floor(pos);
    const a = bands[((i % nb) + nb) % nb], b = bands[(((i + 1) % nb) + nb) % nb];
    mixRgb(a, b, smoothstep(0.55, 1, pos - i), out);
  });
  const e = sphereStrip((u, v, out) => {
    const n = fbm(u * 5, v * 10, seed + 7, 4, 5);
    out[0] = p.ember[0]; out[1] = p.ember[1]; out[2] = p.ember[2];
    out[3] = smoothstep(0.52, 0.85, n) * 140;
  });
  return {
    kind: 'sphere', surface: closeStrip(s), emissive: closeStrip(e),
    glow: p.glowHex, glowSize: 2.3, glowAlpha: 0.32,
    tint: p.emberHex, rate: 0.028 + rng() * 0.01, flare: rng() * TAU, thumb: 0.3,
  };
}

/** Sterne: Granulation, Sonnenflecken, Korona und Strahlen — Größe und Farbe je Typ. */
function starArt(seed, rng, p, o) {
  const f = Math.max(2, Math.round(10 * o.cells));
  const s = sphereStrip((u, v, out) => {
    const g = fbm(u * f, v * f * 0.5, seed, 5, f);
    const fine = fbm(u * 36, v * 18, seed + 3, 3, 36);
    const t = clamp(g * 0.8 + fine * 0.35 - 0.08, 0, 1);
    if (t < 0.5) mixRgb(p.edge, p.mid, t * 2, out);
    else mixRgb(p.mid, p.core, (t - 0.5) * 2, out);
  });
  const spots = o.spots ?? 3;
  for (let i = 0; i < spots; i++) {
    const { y, stretch } = latToY(0.3 + rng() * 0.4, s.H);
    const r = 2 + rng() * 3;
    wrapDraw(s.W, rng() * s.W, r * stretch, x => {
      s.ctx.fillStyle = 'rgba(70,20,0,0.45)';
      s.ctx.beginPath();
      s.ctx.ellipse(x, y, r * stretch, r, 0, 0, TAU);
      s.ctx.fill();
    });
  }
  return {
    kind: 'star', surface: closeStrip(s),
    corona: p.coronaHex, coronaMul: o.corona, rays: o.rays, rayAlpha: o.rayAlpha ?? 0.07,
    edge: p.edgeHex, core: p.coreHex, tint: p.midHex, rate: 0.012 + rng() * 0.008,
    flare: rng() * TAU, thumb: clamp(0.62 / o.corona, 0.14, 0.24), extent: 1.15,
  };
}

/** Neutronenstern: winzig, gleißend, mit zwei rotierenden Lichtkegeln (Pulsar). */
function pulsarArt(seed, rng) {
  const cool = [92, 140, 235], hot = [235, 245, 255];
  const s = sphereStrip((u, v, out) => {
    mixRgb(cool, hot, smoothstep(0.3, 0.75, fbm(u * 12, v * 6, seed, 4, 12)), out);
  });
  return {
    kind: 'pulsar', surface: closeStrip(s), tint: '#bfe4ff', beam: '#a8dcff',
    axis: rng() * TAU, period: 1.4 + rng() * 0.8, rate: 0.35, thumb: 0.2, extent: 1.2, reach: 7.5,
  };
}

/** Schwarzes Loch als Spielerstufe — mit `jets` wird daraus ein Quasar. */
function holeArt(seed, rng, jets) {
  return {
    kind: jets ? 'quasar' : 'hole', tint: jets ? '#bfe6ff' : '#ffb070',
    rot: -0.5 + rng() * 0.6, tilt: 0.26 + rng() * 0.08, spinDir: rng() < 0.5 ? -1 : 1,
    thumb: jets ? 0.17 : 0.2, extent: 1.1, reach: jets ? 9 : 3.6,
  };
}

/** Galaxie: Spiralarme aus Tausenden Sternen, Staubbahnen und ein heller Kern. */
function galaxyArt(seed, rng) {
  const gauss = gaussFrom(rng);
  const S = 384, R = S / 2;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.translate(R, R);
  const arms = rng() < 0.55 ? 2 : 3;
  const twist = 2.4 + rng() * 1.2;
  const armAngle = (arm, t) => (arm * TAU) / arms + t * twist;
  const radius = t => (0.06 + t * 0.9) * R;

  const disk = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
  disk.addColorStop(0, 'rgba(255,236,200,0.9)');
  disk.addColorStop(0.08, 'rgba(255,214,160,0.5)');
  disk.addColorStop(0.3, 'rgba(170,190,255,0.2)');
  disk.addColorStop(0.7, 'rgba(120,150,255,0.07)');
  disk.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = disk;
  ctx.fillRect(-R, -R, S, S);

  // Nebliger Schimmer entlang der Arme (breite, sehr transparente Striche)
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let arm = 0; arm < arms; arm++) {
    for (const [w, a, col] of [[R * 0.22, 0.05, '150,175,255'], [R * 0.1, 0.08, '190,205,255'], [R * 0.04, 0.12, '255,235,215']]) {
      ctx.strokeStyle = `rgba(${col},${a})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (let k = 0; k <= 45; k++) {
        const t = 0.04 + k * 0.02;
        const ang = armAngle(arm, t), rr = radius(t);
        if (k === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      ctx.stroke();
    }
  }
  for (let i = 0; i < 8000; i++) {
    const arm = i % arms;
    const t = Math.pow(rng(), 0.8);
    const a = armAngle(arm, t) + gauss() * 0.22 * (1 - t * 0.5);
    const rr = radius(t) * (1 + gauss() * 0.04);
    const roll = rng();
    const col = t < 0.22 ? '255,226,180' : roll < 0.04 ? '255,140,190' : roll < 0.5 ? '200,220,255' : '255,250,240';
    const size = roll < 0.04 ? 1.8 : 0.5 + rng() * 1.1;
    ctx.fillStyle = `rgba(${col},${0.25 + rng() * 0.6})`;
    ctx.fillRect(Math.cos(a) * rr, Math.sin(a) * rr, size, size);
  }

  // Staubbahnen an der Innenkante der Arme
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(30,14,10,0.35)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let arm = 0; arm < arms; arm++) {
    ctx.beginPath();
    for (let k = 0; k <= 38; k++) {
      const t = 0.1 + k * 0.02;
      const a = armAngle(arm, t) - 0.18;
      const x = Math.cos(a) * radius(t), y = Math.sin(a) * radius(t);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.globalCompositeOperation = 'lighter';
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.16);
  core.addColorStop(0, 'rgba(255,248,230,1)');
  core.addColorStop(0.4, 'rgba(255,224,170,0.6)');
  core.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = core;
  ctx.fillRect(-R, -R, S, S);

  return {
    kind: 'galaxy', sprite: c, tint: '#cfd8ff',
    spin: (rng() < 0.5 ? -1 : 1) * (0.035 + rng() * 0.02), tilt: 0.72 + rng() * 0.2, rot0: rng() * TAU,
    thumb: 0.32, extent: 1.45, reach: 1.8,
  };
}

/** Ringsystem als Kreisscheibe — wird beim Zeichnen gestaucht und in Vorder-/Rückseite geteilt. */
function ringSprite(color, seed, inner = 0.62, alpha = 0.85) {
  const S = 256, R = S / 2;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [cr, cg, cb] = color;
  paint(ctx, S, S, (x, y, out) => {
    const d = Math.hypot(x + 0.5 - R, y + 0.5 - R) / R;
    if (d < inner || d > 1) { out[3] = 0; return; }
    const t = (d - inner) / (1 - inner);
    const band = valueNoise(t * 24, 0.5, seed) * 0.6 + valueNoise(t * 90, 1.5, seed + 1) * 0.4;
    const gap = 1 - Math.exp(-(((t - 0.58) / 0.035) ** 2)) * 0.9;
    const edge = smoothstep(0, 0.06, t) * (1 - smoothstep(0.88, 1, t));
    const shade = 0.75 + 0.25 * band;
    out[0] = cr * shade; out[1] = cg * shade; out[2] = cb * shade;
    out[3] = 255 * band * gap * edge * alpha;
  });
  return c;
}

// --- Trümmer ------------------------------------------------------------------------

/** Kleine Asteroiden-Sprites mit eingebackenem Licht (sie sind klein, das fällt beim Drehen nicht auf). */
export function buildAsteroidSprites() {
  const list = [];
  for (let v = 0; v < ASTEROID.variants; v++) {
    const seed = 1000 + v * 37;
    const p = ROCK[v % ROCK.length];
    const S = 48, R = 20;
    const c = makeCanvas(S, S);
    const ctx = c.getContext('2d');
    ctx.translate(S / 2, S / 2);
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = R * (0.74 + 0.3 * valueNoise(Math.cos(a) * 1.4 + 4, Math.sin(a) * 1.4 + 4, seed));
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    const lg = ctx.createLinearGradient(-R, -R, R, R);
    lg.addColorStop(0, p.lightHex);
    lg.addColorStop(0.5, p.baseHex);
    lg.addColorStop(1, p.darkHex);
    ctx.fillStyle = lg;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    const rng = mulberry32(seed);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(0,0,0,0.22)' : rgbStr(p.light, 0.18);
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * 2 * R, (rng() - 0.5) * 2 * R, 0.8 + rng() * 2.4, 0, TAU);
      ctx.fill();
    }
    crater(ctx, (rng() - 0.5) * R, (rng() - 0.5) * R, 4 + rng() * 3, 4 + rng() * 3, p.light);
    const sh = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.1);
    sh.addColorStop(0, 'rgba(255,250,240,0.18)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = sh;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    ctx.restore();
    list.push(c);
  }
  return list;
}

// --- Leuchten -------------------------------------------------------------------------

const glowCache = new Map();

/** Weicher Lichtpunkt — für additive Glows, Auren, Partikel. */
export function glowSprite(hex, size = 64) {
  const key = hex + size;
  let c = glowCache.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const R = size / 2;
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},0.16)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowCache.set(key, c);
  return c;
}

/**
 * Aura-Ring: leuchtet direkt am Körperrand und läuft nach außen aus.
 * Der Körper deckt die Mitte ab — sichtbar bleibt ein farbiger Saum,
 * der auch auf kleinen Körpern sofort lesbar ist (rot = Gefahr, grün = Beute).
 */
const auraCache = new Map();
export function auraSprite(hex, inner = 0.55) {
  let c = auraCache.get(hex);
  if (c) return c;
  const S = 128, R = S / 2;
  c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(inner - 0.06, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(inner, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(inner + 0.1, `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  auraCache.set(hex, c);
  return c;
}

/** Staubkorn: heller Kern, kleiner Hof. */
export function dustSprite(hex) {
  const S = 24, R = S / 2;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const [r, g, b] = hexToRgb(hex);
  const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
  const hi = c => Math.round(c + (255 - c) * 0.55);
  grad.addColorStop(0, `rgba(${hi(r)},${hi(g)},${hi(b)},1)`);
  grad.addColorStop(0.2, `rgba(${r},${g},${b},0.95)`);
  grad.addColorStop(0.32, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.1)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  return c;
}

/** Akkretionsscheibe eines Schwarzen Lochs: heiß innen, glühend rot außen, mit Schlieren. */
export function buildBlackHoleDisk() {
  const S = 256, R = S / 2, inner = 0.3;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const hot = hexToRgb('#fff4dc'), mid = hexToRgb('#ff9a3c'), cool = hexToRgb('#9a2a18');
  paint(ctx, S, S, (x, y, out) => {
    const dx = x + 0.5 - R, dy = y + 0.5 - R;
    const d = Math.hypot(dx, dy) / R;
    if (d < inner || d > 1) { out[3] = 0; return; }
    const t = (d - inner) / (1 - inner);
    const u = Math.atan2(dy, dx) / TAU + 0.5;
    const streak = fbm(u * 24, t * 5, 31, 4, 24);
    if (t < 0.35) mixRgb(hot, mid, t / 0.35, out);
    else mixRgb(mid, cool, (t - 0.35) / 0.65, out);
    const k = (1 - t) ** 1.5 * (0.45 + 0.55 * streak) * smoothstep(0, 0.05, t);
    out[3] = clamp(k * 1.25, 0, 1) * 255;
  });
  return c;
}

// --- Hintergrund ------------------------------------------------------------------------

const STAR_COLORS = ['#ffffff', '#fff1d6', '#d6e4ff', '#ffd8b0', '#ffffff'];

/** Kachelbares Sternfeld (Sterne am Rand werden umgebrochen). */
export function buildStarTile(size, count, seed, o) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size, y = rnd() * size;
    const m = rnd() ** o.pow;
    const r = lerp(o.rMin, o.rMax, m);
    const a = lerp(o.aMin, o.aMax, m);
    const col = hexToRgb(STAR_COLORS[Math.floor(rnd() * STAR_COLORS.length)]);
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        const px = x + ox, py = y + oy;
        if (px < -8 || py < -8 || px > size + 8 || py > size + 8) continue;
        if (r < 1.2) {
          ctx.fillStyle = rgbStr(col, a);
          ctx.fillRect(px, py, r, r);
        } else {
          const g = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
          g.addColorStop(0, rgbStr(col, a));
          g.addColorStop(0.35, rgbStr(col, a * 0.35));
          g.addColorStop(1, rgbStr(col, 0));
          ctx.fillStyle = g;
          ctx.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4);
        }
      }
    }
  }
  return c;
}

/**
 * Nebel in der "Hubble-Palette" (Teal und Gold statt Lila und Pink),
 * in beide Richtungen kachelbar, mit dunklen Staubbahnen.
 */
export function buildNebulaTile(size, seed) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const teal = hexToRgb('#1f6f78'), gold = hexToRgb('#8a5a1c'), rust = hexToRgb('#5a1f18');
  paint(ctx, size, size, (x, y, out) => {
    const u = x / size, v = y / size;
    const a = fbm(u * 4, v * 4, seed, 5, 4, 4);
    const b = fbm(u * 3, v * 3, seed + 1, 5, 3, 3);
    const lane = fbm(u * 8, v * 8, seed + 2, 4, 8, 8);
    const ta = smoothstep(0.38, 0.92, a) ** 1.8;
    const ga = smoothstep(0.42, 0.95, b) ** 1.8;
    const dark = 1 - smoothstep(0.5, 0.8, lane) * 0.45;
    const sum = ta + ga + 1e-5;
    out[0] = (teal[0] * ta + gold[0] * ga * 0.8 + rust[0] * ga * 0.2) / sum;
    out[1] = (teal[1] * ta + gold[1] * ga * 0.8 + rust[1] * ga * 0.2) / sum;
    out[2] = (teal[2] * ta + gold[2] * ga * 0.8 + rust[2] * ga * 0.2) / sum;
    out[3] = clamp(Math.max(ta, ga) * dark, 0, 1) * 200;
  });
  return c;
}

/** Diagonale Schraffur — markiert den Bereich außerhalb der Arena wie auf einer technischen Zeichnung. */
export function buildHatchTile() {
  const S = 14;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(236,230,214,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-2, S + 2); ctx.lineTo(S + 2, -2);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(S - 2, S + 2); ctx.lineTo(S + 2, S - 2);
  ctx.stroke();
  return c;
}
