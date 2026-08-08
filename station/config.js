/**
 * BAHNHOF KEPLER-9 — every tuning number in one place.
 *
 * The scene is one long departure hall in an orbital transit station that has
 * been empty for a very long time. Units are metres, seconds, radians.
 *
 * The hall runs along Z. Its west wall (-X) carries a row of clerestory
 * windows, the ceiling carries skylights, the north end (-Z) is one enormous
 * panorama window looking at the planet, and the south end has caved in.
 * The star sweeps past outside, so the light through those openings moves —
 * that movement is the whole piece.
 */

/* ------------------------------------------------------------- dimensions */

export const HALL = {
  halfWidth: 12,     // walls at x = ±12
  halfLength: 42,    // ends at z = ±42
  height: 13,        // ceiling
  bay: 7,            // structural rib spacing along Z
  mezzanine: {
    y: 5.2,
    xInner: 5.5,     // walkway spans x = 5.5 .. 12 along the east wall
    zFrom: -30,
    zTo: 18,
    collapseFrom: 2, // this stretch of floor plate is gone
    collapseTo: 9,
  },
  rubble: { zFrom: 26 },  // the caved-in south end starts here
};

/* ---------------------------------------------------------------- palette */
/* Cold station greys and one warm star. The only saturated colour that is not
 * sunlight is the vegetation — that contrast is the point of the image. */

export const PALETTE = {
  steel:        0x6f7a80,
  steelDark:    0x3a4247,
  paint:        0x7d8a86,   // the faded institutional green-grey of the panels
  rust:         0x54443c,
  rustDeep:     0x332824,
  concrete:     0x6f6d66,
  concreteWorn: 0x484741,

  leaf:         0x4e7a3d,
  leafPale:     0x87a860,
  leafDark:     0x243a21,
  moss:         0x3c5730,
  bark:         0x4a4036,

  sunHigh:      0xfff2dc,   // star overhead, near-white
  sunLow:       0xffc8a2,   // star raking in, warm
  bounce:       0x4a5a62,   // cold fill from the hull plating
  planet:       0x4d6f8f,   // the world outside the panorama window
  bio:          0x7de0b0,   // whatever the plants have learned to do at night
  emergency:    0xd8543a,   // the strip lighting that still has power
  fog:          0x1b2429,
};

/* ------------------------------------------------------------- the window */
/* Openings in the hull. Each one is a rectangle: `center` plus a `right` and
 * an `up` axis, both already scaled to the half-extent. The inward normal is
 * right × up and is computed at load — get the winding wrong and the beam
 * points out into space instead of onto the floor.
 *
 * `cols`/`rows` is the pane grid. `seed` drives which panes are still there;
 * the same mask is used for the glass meshes, for the shadow they cast, for
 * the volumetric shaft and for the dust brightening, so all four agree.
 * `intact` is roughly the fraction of panes still glazed.
 */

export const OPENINGS = [
  // --- clerestory, west wall, normal +X ---
  ...[-28, -14, 0, 14, 28].map((z, i) => ({
    id: `clerestory-${i}`,
    kind: 'wall',
    center: [-HALL.halfWidth + 0.15, 9.0, z],
    right: [0, 0, 3.4],
    up: [0, 2.4, 0],
    cols: 6, rows: 4,
    intact: [0.34, 0.62, 0.18, 0.5, 0.44][i],
    seed: 1301 + i * 97,
  })),

  // --- skylights, ceiling, normal -Y. Deliberately off the clerestory
  //     rhythm so the two patterns never line up on the floor. ---
  ...[-21, 3, 24].map((z, i) => ({
    id: `skylight-${i}`,
    kind: 'ceiling',
    center: [2.5 - i * 2.5, HALL.height - 0.15, z],
    right: [3.0, 0, 0],
    up: [0, 0, 3.0],
    cols: 5, rows: 5,
    intact: [0.28, 0.46, 0.12][i],
    seed: 2711 + i * 131,
  })),

  // --- the panorama window at the north end, normal +Z ---
  {
    id: 'panorama',
    kind: 'wall',
    center: [0, 6.4, -HALL.halfLength + 0.2],
    right: [9.5, 0, 0],
    up: [0, 4.4, 0],
    cols: 8, rows: 4,
    intact: 0.55,
    seed: 5099,
  },

  // --- where the roof came down over the south end. No glass left at all. ---
  {
    id: 'breach',
    kind: 'ceiling',
    center: [-1.0, HALL.height - 0.15, 33],
    right: [5.2, 0, 0],
    up: [0, 0, 4.6],
    cols: 6, rows: 5,
    intact: 0.06,
    seed: 8123,
  },
];

/* -------------------------------------------------------------- the light */

export const SUN = {
  /* The station tumbles slowly rather than orbiting cleanly, so the star
   * sweeps back and forth instead of circling. It means the hall is never
   * fully dark for long — but it does go dim at both turning points, and
   * that dimming is where the piece is saddest. */
  angleFrom: -0.05 * Math.PI,  //  -9° — star on the blind side, hall dark
  angleTo:    1.55 * Math.PI,  // 279° — and out the other side, dark again
  period: 320,                 // seconds for one full sweep and back
  /* 0.25 puts the star at 135° on the first frame: light entering the west
   * clerestory at 45° and landing as separate patches nine metres out on the
   * floor. Higher than this and the shafts lie down and merge into one slab
   * across the ceiling, which is a worse first image. */
  startPhase: 0.25,

  /* A much slower nod out of the XY plane. This is the only thing that ever
   * puts light through the panorama window, which is why it is worth having. */
  tiltAmount: 0.42,
  tiltPeriod: 137,

  distance: 260,               // where the shadow-casting light is parked
  intensityHigh: 5.2,
  intensityLow: 2.4,
  /* Bounce off the plating. The hull shadows almost everything almost all of
   * the time, so this is what the room is actually lit by — set it too low
   * and the scene is a black rectangle with three bright stripes in it. */
  ambientDay: 0.95,
  ambientNight: 0.22,
};

/* Volumetric shafts. These are boxes extruded from each opening along the
 * light direction and ray-marched in the fragment shader. */
export const BEAM = {
  length: 46,          // how far a shaft is drawn before it gives up
  density: 0.16,       // optical density per metre of shaft travelled
  /* The accumulated density goes through 1 - exp(-x) before it is used, so a
   * shaft looked at end-on saturates towards `brightness` instead of piling
   * up into a flat white slab. Without that, standing in a beam and looking
   * along it whites out half the frame. */
  brightness: 0.55,
  falloff: 0.033,      // per metre, along the shaft
  softEdge: 0.10,      // fade at the cross-section border, in cross-section units
  wobble: 0.07,        // slow breathing of the shaft brightness
  grain: 0.22,         // unevenness along the shaft, so it is not a solid wedge
};

export const DUST = {
  ambient: 2600,       // motes drifting through the whole hall
  size: 0.042,
  drift: 0.10,         // metres per second, downward
  swirl: 0.16,
  litBoost: 17.0,      // how much brighter a mote is inside a shaft
  volume: { x: 11.5, yFrom: 0.1, yTo: 12.4, z: 41 },
};

/* --------------------------------------------------------------- the play */

export const PLAYER = {
  eyeHeight: 1.68,
  radius: 0.38,
  walkSpeed: 3.4,
  runSpeed: 6.6,
  accel: 12,
  gravity: 11.5,       // station spin gravity, a little under Earth's
  jump: 4.2,
  flySpeed: 8.0,
  lookSensitivity: 0.0022,
  pitchClamp: Math.PI / 2 - 0.02,
  bobAmount: 0.032,
  bobSpeed: 9.4,
  start: [0, 0, 30],   // just inside the collapsed end, facing the hall
  startYaw: Math.PI,
};

/* ---------------------------------------------------------------- foliage */

export const FLORA = {
  vinesPerBay: 3,
  groundTufts: 1400,
  ceilingRoots: 140,
  moss: 220,
  pods: 190,           // bioluminescent clusters — the night lighting
  windStrength: 0.075,
  windSpeed: 0.55,
  leafSize: 0.145,
};

/* --------------------------------------------------------------- quality */
/* Chosen once at boot from cores/memory/screen. Only the renderer's
 * resolution is touched afterwards, if the frame rate asks for it. */

export const QUALITY = {
  high:   { shadow: 2048, beamSteps: 20, dust: 1.0,  bloom: true,  transmission: true,  pixelRatio: 1.75, foliage: 1.0,  samples: 4 },
  medium: { shadow: 1536, beamSteps: 13, dust: 0.65, bloom: true,  transmission: false, pixelRatio: 1.35, foliage: 0.7,  samples: 2 },
  low:    { shadow: 1024, beamSteps: 8,  dust: 0.4,  bloom: false, transmission: false, pixelRatio: 1.0,  foliage: 0.45, samples: 0 },
};

/* ------------------------------------------------------------------ sound */

export const AUDIO = {
  master: 0.30,
  droneHz: 47,
  hissLevel: 0.055,
  groanEvery: [16, 46],   // seconds between hull groans, random in range
  dripEvery: [3.5, 13],
};

/* ------------------------------------------------------------- the texts */
/* Proximity triggers. Each fires once, when the player comes within `radius`
 * of `at`, and then never again. Nothing else in the scene uses words. */

export const MOMENTS = [
  {
    at: [0, 1.6, 30],
    radius: 9,
    text: 'Gate C — Abflug in Richtung Ceres, Themis, Hygiea',
    sub: 'Bitte halten Sie Ihre Bordkarte bereit.',
    delay: 3.0,
  },
  {
    at: [7.5, 1.6, 8],
    radius: 6,
    text: 'Die Bänke sind noch nummeriert.',
    sub: '41 bis 68. Reihe C.',
  },
  {
    at: [-7, 1.6, -6],
    radius: 6.5,
    text: 'Jemand hat den Koffer stehen lassen.',
    sub: 'Er ist nicht mehr aufgemacht worden.',
  },
  {
    at: [0, 1.6, -30],
    radius: 10,
    text: 'Der letzte Shuttle ist vor vierzig Jahren abgeflogen.',
    sub: 'Von hier aus sieht man den Planeten immer noch.',
  },
  {
    at: [0, 1.6, 0],
    radius: 5,
    text: 'Etwas wächst hier weiter.',
    sub: 'Es hat auf niemanden gewartet.',
  },
];
