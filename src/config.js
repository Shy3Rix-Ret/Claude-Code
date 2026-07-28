/**
 * LEVEL 4444 — THE ABYSS
 * Central tuning surface. Every magic number that shapes the experience lives here.
 */

/* ---------------------------------------------------------------- palette */
/* Art direction §3.1 — everything is dead grey-blue-green except the beacon. */
export const PALETTE = {
  waterDeep:    0x0d1416, // the colour of "down"
  waterMid:     0x1a2426,
  waterShallow: 0x36474a,
  fogLow:       0x6b7378, // fog at the horizon
  fogHigh:      0x9aa0a3, // fog overhead
  skyTop:       0x565e63,
  beacon:       0xf4b942, // the only saturated value in the entire colour space
  beaconCore:   0xfff0cf,
  bio:          0x5ce1c9, // watcher bioluminescence, sickly and dim
  rust:         0x6a4a37,
  concrete:     0x8d8f8b,
  skin:         0xa9a19a, // waterlogged, desaturated
};

/* ------------------------------------------------------------- the script */
/* Durations in seconds. The whole run is ~16 minutes. Acts 3 and 4 have
 * soft floors: they can run long if the player resists, never short. */
export const SCRIPT = {
  COLD_OPEN: 15,   // §2.1 black screen, sound only
  WAKE:      30,   // §2.2 fade up, drifting, breath settling
  ESTABLISH: 30,   // §2.3 uninterruptible 180° pan
  ACT1:      210,  // §4   the drifting
  ACT2:      225,  //      the presence
  ACT3_MIN:  120,  //      the pull — gated on stillness, not the clock
  ACT4:      215,  //      the way to the light — gated on distance to the door
  ACT5:      70,   //      the door
};

/* §2.4 — the only title card in the game */
export const TITLE_CARD = {
  showAt: 2.0,   // seconds into ACT1
  hold:   4.0,
};

/* -------------------------------------------------------------- the ocean */
export const OCEAN = {
  radius:     1400,  // how far the surface mesh reaches
  innerRadius: 0.28, // first ring — keeps the polar centre from pinching

  /* Every speed below is an integer multiple of TIME_QUANTUM. That makes the
   * whole field exactly periodic over TIME_WRAP, so the clock can be wrapped
   * without a visible pop — which keeps shader phases bounded no matter how
   * long the page has been open. Unbounded phases lose float precision and
   * the water starts to shimmer into a mirror. */
  timeQuantum: 0.01,

  // Deliberately tiny amplitudes. The level lives on unnatural calm (§3.3).
  waves: [
    // dirX, dirZ, amplitude, frequency, speed
    [ 0.98,  0.20, 0.170, 0.055, 0.42],
    [-0.62,  0.78, 0.105, 0.098, 0.55],
    [ 0.31, -0.95, 0.052, 0.187, 0.73],
    [-0.88, -0.47, 0.026, 0.331, 0.94],
    [ 0.55,  0.83, 0.013, 0.622, 1.22],
  ],
  swell: { amp: 0.40, fx: 0.0091, fz: 0.0067, speed: 0.08 },

  /* Micro-ripple for the near field. Analytic, so the surface normal comes
   * from a derivative we know exactly rather than a finite difference of a
   * noise field — the latter amplifies precision loss by 1/epsilon and turns
   * close water into a mirror of the sky after a few minutes. */
  ripples: [
    [ 0.91,  0.42, 0.0115, 1.15, 0.63],
    [-0.38,  0.93, 0.0082, 1.87, 0.91],
    [ 0.67, -0.74, 0.0054, 2.93, 1.34],
    [-0.96, -0.29, 0.0036, 4.31, 1.79],
    [ 0.22,  0.98, 0.0021, 6.70, 2.35],
  ],
};

/** Seconds after which the ocean clock repeats exactly. 2*pi / timeQuantum. */
export const TIME_WRAP = (Math.PI * 2) / OCEAN.timeQuantum;

/* ---------------------------------------------------------------- the fog */
/* §3.3 — 40..60m visibility, breathing slowly so it never reads as culling. */
export const FOG = {
  nearBase: 6,
  farBase:  52,
  farSwing: 9,     // ± drift
  swingPeriod: 37, // seconds, prime-ish so it never syncs with anything
};

/* ----------------------------------------------------------- the watchers */
export const WATCHERS = {
  poolSize: 7,
  // Per-act behaviour. range = [min, max] metres from the player.
  acts: {
    ACT1: { active: 2, range: [46, 78], dwell: [5, 11],  approach: 0.00, eyeGain: 0.35 },
    ACT2: { active: 5, range: [15, 42], dwell: [9, 20],  approach: 0.42, eyeGain: 1.00 },
    ACT3: { active: 0, range: [60, 90], dwell: [1, 2],   approach: 0.00, eyeGain: 0.00 },
    ACT4: { active: 2, range: [38, 70], dwell: [4, 9],   approach: 0.05, eyeGain: 0.55 },
    ACT5: { active: 0, range: [60, 90], dwell: [1, 2],   approach: 0.00, eyeGain: 0.00 },
  },
  // §3.2 peripheral vision: how centred a watcher must be before it notices
  // that it is being looked at. Measured as NDC radius from screen centre.
  focusInner: 0.20, // fully "seen"
  focusOuter: 0.62, // fully peripheral
  gazeTolerance: 0.55, // seconds of direct focus before it goes
  vanishTime: 0.40,    // how fast it fades — fast enough to feel like doubt
  cooldown: [7, 22],   // seconds dormant after being seen
};

/* --------------------------------------------------------------- movement */
export const SWIM = {
  maxSpeed:  1.15,   // m/s — slow, exhausting
  // Terminal speed is accel/drag, so this has to exceed maxSpeed*drag or the
  // clamp never comes into play and swimming is quietly slower than stated.
  accel:     0.78,
  drag:      0.62,
  driftSpeed: 0.055, // the ocean always moves you a little, even at rest

  /* Act 4 only. The current does most of the work if the player does none, so
   * the level always reaches the door: ~5 minutes adrift, ~3 swimming. */
  act4Current:  0.80,
  // Swimming eases the current but must not cancel it: Rule 1 means swimming
  // slightly off-axis, and punishing that with a dead sea makes obeying the
  // rule feel like a mistake.
  act4Swimming: 0.45,
  act4Riptide:  2.30,  // if they are well over time, the sea decides
};

/* --------------------------------------------------------------- the door */
export const DOOR = {
  /* Placed far out along -Z. The beacon sprite ignores fog so it reads as a
   * pinprick on the horizon long before the geometry resolves. */
  position: [0, 0, -286],
  arriveDistance: 3.1,
  beaconVisibleFrom: 900,
};

/* ------------------------------------------------------------ look/camera */
export const LOOK = {
  sensitivity: 0.0026,   // radians per CSS pixel
  /* A thumb has far less room than a mouse: at the base rate a full-width
   * swipe on a phone turns you only 60°, so looking behind you takes three
   * strokes. Touch gets its own multiplier. */
  touchScale: 1.5,
  pitchClamp: 1.32,      // ~75.6°, you can look up at the fog but not fold over
  smoothing: 18,         // exponential damping rate
  gyroBlend: 1.0,
};

/* ------------------------------------------------------- post-processing */
export const POST = {
  bloomThreshold: 0.62,
  bloomKnee: 0.28,
  grainBase: 0.055,
  vignetteStart: 0.46,  // §5 — deepens progressively across the run
  vignetteEnd: 0.80,
};

/* Quality tiers are chosen at boot from a quick device probe. */
export const QUALITY = {
  high: {
    radial: 168, rings: 118, bloomDiv: 2, motes: 2400, droplets: 26,
    pixelRatioCap: 2.0, skyOctaves: 4, motionBlurSamples: 6,
  },
  medium: {
    /* 1.25 rather than 1.6: a phone at devicePixelRatio 3 is already asking
     * the fragment stage for well over a million pixels, and the composite
     * pass touches every one of them a dozen times. Sharpness is the cheapest
     * thing to give back (§5). */
    radial: 128, rings: 92, bloomDiv: 3, motes: 1200, droplets: 16,
    pixelRatioCap: 1.25, skyOctaves: 3, motionBlurSamples: 4,
  },
  low: {
    radial: 92, rings: 66, bloomDiv: 4, motes: 700, droplets: 11,
    pixelRatioCap: 1.0, skyOctaves: 2, motionBlurSamples: 3,
  },
};
