/**
 * One mutable bag of world state. The director writes it; every other system
 * only reads. This is what keeps the ocean, the audio, the watchers and the
 * post stack telling the same story on the same frame.
 */

import { PALETTE, FOG, POST } from './config.js';

export const PHASE = {
  BOOT:      'BOOT',
  COLD_OPEN: 'COLD_OPEN',
  WAKE:      'WAKE',
  ESTABLISH: 'ESTABLISH',
  ACT1:      'ACT1',
  ACT2:      'ACT2',
  ACT3:      'ACT3',
  ACT4:      'ACT4',
  ACT5:      'ACT5',
  END:       'END',
};

export function createState() {
  return {
    /* clock */
    time: 0,          // seconds since the experience began (post tap-to-start)
    dt: 0,
    frame: 0,
    phase: PHASE.BOOT,
    phaseT: 0,        // seconds inside the current phase

    /* player */
    controlEnabled: false,  // false during the establishing pan (§2.3)
    swimEnabled: false,
    swimming: false,
    playerPos: { x: 0, y: 0, z: 0 },
    lookSpeed: 0,           // rad/s, drives the motion blur
    stillness: 0,           // seconds since the player last did anything

    /* camera */
    eyeHeight: 0.16,        // metres above mean water level, face barely clear
    submersion: 0,          // 0 = at surface, 1 = fully under
    shake: 0.35,            // handshake amplitude multiplier

    /* atmosphere */
    fogNear: FOG.nearBase,
    fogFar: FOG.farBase,
    darkness: 0,            // Act 3: the water below the player going black
    ambient: 1,             // global light scale

    /* the light */
    beacon: 0,              // 0..1 visibility of the distant point
    doorReveal: 0,          // 0..1 geometry fade-in as you close the distance
    doorDistance: Infinity,
    doorOpen: 0,

    /* watchers */
    watcherProfile: 'ACT1',
    watcherAlert: 0,        // 0..1 — drives the click density in the audio

    /* audio mix, driven by the director */
    ambienceLevel: 0,       // water + air beds
    rumbleLevel: 0,         // the 31–58 Hz floor
    breathIntensity: 0.75,  // how hard you are breathing
    groansEnabled: false,
    pulse: 0,               // heartbeat, also squeezes the frame in post

    /* post */
    exposure: 1,
    vignette: POST.vignetteStart,
    grain: POST.grainBase,
    bloom: 1,
    chroma: 0,
    fade: 1,                // 1 = pure black. Starts black (§2.1).
    desaturate: 0,
    underwaterFilter: 0,

    /* palette handles, resolved to THREE.Color in world.js */
    palette: PALETTE,

    /* debug */
    timeScale: 1,
    debug: false,
  };
}
