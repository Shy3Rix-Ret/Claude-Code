/**
 * BAHNHOF KEPLER-9 — bootstrap and frame loop.
 *
 * Load order matters here. The textures are baked on the CPU, which takes long
 * enough to be noticeable, so the build is stepped and yields a frame between
 * stages: the loading line says what it is doing rather than lying still.
 *
 * The frame is drawn in three parts — scene into an HDR buffer with depth,
 * volumetric shafts into a half-resolution buffer that reads that depth for
 * occlusion, then one composite pass that tone maps the pair. See post.js.
 */

import * as THREE from 'three';
import { PALETTE, QUALITY, PLAYER } from './config.js';
import { clamp, damp, saturate } from './util.js';
import { Openings } from './openings.js';
import { Materials } from './materials.js';
import { Station } from './station.js';
import { Flora } from './flora.js';
import { SunRig } from './light.js';
import { Beams } from './beams.js';
import { Dust } from './dust.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Ambience } from './audio.js';
import { Overlay } from './overlay.js';

const FOG_DENSITY = 0.0062;

const params = new URLSearchParams(location.search);
const fail = (msg) => window.__bootFail?.(msg);

/* ------------------------------------------------------------- quality */

function pickQuality() {
  const forced = params.get('quality');
  if (forced && QUALITY[forced]) return { name: forced, ...QUALITY[forced] };

  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;

  if (cores >= 8 && mem >= 8 && !small) return { name: 'high', ...QUALITY.high };
  if (cores >= 4 && mem >= 4) return { name: 'medium', ...QUALITY.medium };
  return { name: 'low', ...QUALITY.low };
}

/* --------------------------------------------------------------- boot */

const bootLine = document.getElementById('boot-line');
const bootEl = document.getElementById('boot');
const bootHint = document.getElementById('boot-hint');

const say = (text) => { if (bootLine) bootLine.textContent = text; };
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function build() {
  const canvas = document.getElementById('gl');
  const quality = pickQuality();

  /* ---------------------------------------------------------- renderer */

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,          // MSAA is on the render target, not the canvas
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // done in the composite pass
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft is deprecated in r185

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.fog), FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(68, 1, 0.12, 3000);
  camera.rotation.order = 'YXZ';

  /* ------------------------------------------------------------- build */

  say('Oberflächen werden gealtert …');
  await frame();
  const mats = new Materials(renderer, quality);
  mats.buildEnvironment(renderer, scene);

  say('Hülle, Gates, Mezzanin …');
  await frame();
  const openings = new Openings();
  const station = new Station(scene, mats, openings, quality);

  say('Etwas wächst hier …');
  await frame();
  const flora = new Flora(scene, mats, openings, station, quality);

  say('Der Stern kommt herum …');
  await frame();
  const sun = new SunRig(scene, openings, quality);
  const beams = new Beams(openings, quality, FOG_DENSITY);
  const dust = new Dust(scene, openings, mats.sprite, quality);
  const post = new Post(renderer, quality);

  const player = new Player(camera, canvas, station.colliders);
  const overlay = new Overlay();
  const audio = new Ambience();

  /* --------------------------------------------------------------- size */

  let renderScale = 1;
  const basePixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);

  function applySize() {
    const w = Math.max(2, window.innerWidth);
    const h = Math.max(2, window.innerHeight);

    renderer.setPixelRatio(basePixelRatio * renderScale);
    renderer.setSize(w, h, false);

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    const buf = renderer.getDrawingBufferSize(new THREE.Vector2());
    post.setSize(buf.x, buf.y);
    beams.setSize(post.beamSize.x, post.beamSize.y);
    dust.setSize(h, basePixelRatio * renderScale);
  }

  applySize();
  window.addEventListener('resize', applySize);

  /* --------------------------------------------------------------- run */

  const EXPOSURE = 1.12;
  let last = performance.now() / 1000;
  let time = 0;
  let fade = 0;
  let started = false;
  let firstFrameChecked = false;

  const timeScale = clamp(Number(params.get('speed')) || 1, 0.1, 40);

  // Rolling frame cost, for the one performance lever that is allowed to move.
  let avgFrame = 1 / 60;
  let scaleCooldown = 3;

  function step() {
    requestAnimationFrame(step);

    const now = performance.now() / 1000;
    const dt = Math.min(now - last, 0.1);
    last = now;
    time += dt * timeScale;

    const sunState = sun.update(time);

    if (started) player.update(dt);
    mats.update(time, dt, sunState);
    station.update(time, dt, sunState);
    dust.update(time, sunState);
    overlay.update(dt, player.position, time);
    audio.update(dt, sunState, player);

    fade = damp(fade, started ? 1 : 0, 0.9, dt);

    /* ---- draw ---- */
    renderer.setRenderTarget(post.sceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);

    beams.update(sunState, camera, time, post.sceneRT.depthTexture);
    beams.render(renderer, camera, post.beamRT);

    post.finish(time, saturate(fade), EXPOSURE);

    /* ---- adaptive resolution: the only thing that reacts to frame rate ---- */
    avgFrame = avgFrame * 0.94 + dt * 0.06;
    scaleCooldown -= dt;
    if (scaleCooldown <= 0) {
      if (avgFrame > 1 / 26 && renderScale > 0.62) {
        renderScale = Math.max(0.62, renderScale - 0.12);
        applySize();
        scaleCooldown = 4;
      } else if (avgFrame < 1 / 55 && renderScale < 1) {
        renderScale = Math.min(1, renderScale + 0.08);
        applySize();
        scaleCooldown = 6;
      } else {
        scaleCooldown = 1.5;
      }
    }

    /* A black screen and a scene that is meant to be dark look identical.
     * Read a few pixels back once and say something if nothing arrived. */
    if (!firstFrameChecked && started && fade > 0.6) {
      firstFrameChecked = true;
      try {
        const gl = renderer.getContext();
        const px = new Uint8Array(4 * 64);
        gl.readPixels(
          Math.floor(gl.drawingBufferWidth / 2) - 8,
          Math.floor(gl.drawingBufferHeight / 2) - 4,
          8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px,
        );
        let sum = 0;
        for (let i = 0; i < px.length; i++) sum += px[i];
        if (sum === 0) {
          fail('Die Szene rendert, aber es kommt kein Bild an. '
             + 'Wahrscheinlich blockiert der Browser WebGL oder die GPU wurde abgelehnt.');
        }
      } catch { /* readPixels is a diagnostic, never a requirement */ }
    }
  }

  /* ------------------------------------------------------------- start */

  async function begin() {
    if (started) return;
    started = true;

    bootEl?.classList.add('gone');
    overlay.begin();
    player.enabled = true;
    player.requestLock();

    // AMBIENT-SOUND-TRIGGER — see audio.js. This is the gesture it needs.
    audio.start().catch(() => {});
  }

  bootEl?.addEventListener('click', begin);
  window.addEventListener('keydown', (e) => {
    if (!started && (e.code === 'Space' || e.code === 'Enter')) begin();
    if (e.code === 'KeyM') audio.toggleMute();
    if (e.code === 'KeyH') overlay.toggleHint();
    if (e.code === 'KeyR') {
      player.position.set(...PLAYER.start);
      player.velocity.set(0, 0, 0);
      player.yaw = PLAYER.startYaw;
      player.pitch = 0;
    }
  });

  if (bootHint) bootHint.classList.add('show');
  say('Bahnhof Kepler-9. Niemand ist mehr hier.');

  step();

  // Handy from the console, and how the smoke test reaches in.
  window.__station = {
    renderer, scene, camera, player, sun, station, flora, quality, begin,
    beams, dust, post, mats, overlay, audio,
  };
  return window.__station;
}

build().catch((err) => {
  console.error(err);
  fail('Start fehlgeschlagen — ' + (err?.message || err));
});
