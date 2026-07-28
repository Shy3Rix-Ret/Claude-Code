/**
 * LEVEL 4444 — THE ABYSS
 * Bootstrap and frame loop.
 */

import * as THREE from 'three';
import { QUALITY } from './config.js';
import { createState, PHASE } from './state.js';
import { Controls } from './controls.js';
import { Ocean } from './ocean.js';
import { Sky } from './sky.js';
import { WatcherSystem, Apparition } from './watchers.js';
import { Motes, Leviathan } from './abyss.js';
import { Beacon, Door } from './door.js';
import { Hand } from './hand.js';
import { PostStack } from './post.js';
import { AudioEngine } from './audio.js';
import { Overlay } from './overlay.js';
import { Director, SINK_DEPTH } from './director.js';
import { makeDropletTexture } from './materials.js';
import { clamp, damp, fbm1, lerp } from './util.js';

/** Rough device probe. Errs toward "medium" — a stable 30fps beats a pretty 12. */
function pickQuality() {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || (mobile ? 4 : 8);
  const mem = navigator.deviceMemory || (mobile ? 4 : 8);
  const px = window.devicePixelRatio || 1;
  const wide = Math.max(window.innerWidth, window.innerHeight) * px;

  if (!mobile && cores >= 8 && mem >= 8) return { name: 'high', ...QUALITY.high };
  if (mobile && (cores <= 4 || mem <= 3 || wide > 2400)) return { name: 'low', ...QUALITY.low };
  if (cores <= 4 || mem <= 4) return { name: 'low', ...QUALITY.low };
  return { name: 'medium', ...QUALITY.medium };
}

class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.state = createState();
    this.quality = pickQuality();

    /* ---------------- renderer ---------------- */
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,           // grain and bloom hide the edges; save the fill rate
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    // We tonemap and encode by hand at the end of the post chain, so three must
    // leave the colour pipeline alone.
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);

    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap);
    this.renderer.setPixelRatio(1); // render targets carry the ratio themselves

    /* ---------------- scene ---------------- */
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.05, 2600);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.skySystem = new Sky(this.scene);
    this.ocean = new Ocean(this.scene, this.quality);
    this.motes = new Motes(this.scene, this.quality.motes);
    this.leviathan = new Leviathan(this.scene);
    this.beacon = new Beacon(this.scene);
    this.door = new Door(this.scene);
    this.hand = new Hand(this.camera);

    this.audio = new AudioEngine();
    this.watchers = new WatcherSystem(this.scene, this.audio);
    this.apparition = new Apparition(this.scene);

    this.droplets = makeDropletTexture(this.quality.droplets);
    this.post = new PostStack(this.renderer, this.quality, this.droplets);

    this.controls = new Controls(this.canvas);
    this.overlay = new Overlay(document.body);

    this.director = new Director({
      state: this.state,
      controls: this.controls,
      audio: this.audio,
      overlay: this.overlay,
      watchers: this.watchers,
      leviathan: this.leviathan,
      apparition: this.apparition,
      hand: this.hand,
      door: this.door,
    });

    /* ---------------- frame state ---------------- */
    this._last = 0;
    this._smoothDt = 1 / 60;
    this._motion = new THREE.Vector2();
    this._shakeSeed = Math.random() * 1000;
    this._fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    document.addEventListener('visibilitychange', () => {
      this.audio.setMasterMuted(document.hidden);
      if (!document.hidden) this._last = performance.now();
    });

    this.resize();
    this._installDebug();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Portrait phones need a wider vertical field or the frame feels like a slot.
    this.camera.fov = h > w ? 78 : 68;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.motes.material.uniforms.uPixelRatio.value = this.pixelRatio;
  }

  async begin() {
    await this.overlay.waitForStart();

    // Everything that needs a user gesture happens right here, in one go.
    await this.audio.start();
    this.controls.enableGyro();
    this.controls.requestPointerLock();
    this.controls.enabled = true;

    this.overlay.hideBoot();
    this.director.setPhase(PHASE.COLD_OPEN);

    // ?act=3 drops straight into an act — for development, and for anyone who
    // wants to see the end without sitting through the middle again.
    if (this._skipTo) {
      const map = {
        1: PHASE.ACT1, 2: PHASE.ACT2, 3: PHASE.ACT3, 4: PHASE.ACT4, 5: PHASE.ACT5,
      };
      const target = map[this._skipTo];
      if (target) this._jumpTo(target);
    }

    this._last = performance.now();
    this._loop(this._last);
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);               // a tab-switch must not skip an act
    this._smoothDt = lerp(this._smoothDt, dt, 0.1);

    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this._fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
      this._adaptQuality();
    }

    const s = this.state;
    dt *= s.timeScale;
    s.dt = dt;
    s.time += dt;
    s.frame++;

    this.update(dt);
    this.render();
  }

  /** If a phone cannot hold the frame rate, drop resolution before anything else. */
  _adaptQuality() {
    if (this._fps < 24 && this.pixelRatio > 0.72) {
      this.pixelRatio = Math.max(0.72, this.pixelRatio - 0.14);
      this.post.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
      this.motes.material.uniforms.uPixelRatio.value = this.pixelRatio;
    } else if (this._fps > 55 && this.pixelRatio < this.quality.pixelRatioCap) {
      this.pixelRatio = Math.min(this.quality.pixelRatioCap, this.pixelRatio + 0.05);
      this.post.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
      this.motes.material.uniforms.uPixelRatio.value = this.pixelRatio;
    }
  }

  update(dt) {
    const s = this.state;
    const cam = this.camera;

    /* ---- input ---- */
    this.controls.enabled = s.controlEnabled;
    this.controls.update(dt, s);

    /* ---- the story decides everything else ---- */
    this.director.update(dt, cam);

    /* ---- movement ---- */
    const boost = this.director.swimBoost ?? 1;
    const prevSwim = this.controls.swimInput;
    this.controls.swimInput *= boost;
    this.controls.integrate(dt, s, cam, this.director.drift);
    this.controls.swimInput = prevSwim;

    /* ---- camera placement ---- */
    const p = this.controls.position;
    const surface = this.ocean.heightAt(p.x, p.z, s.time);
    const sink = s.submersion * (SINK_DEPTH + Math.sin(s.time * 0.31) * 0.35);
    const scripted = this.director.scripted;

    let yaw = this.controls.yaw;
    let pitch = this.controls.pitch;
    if (scripted.active) {
      yaw = scripted.yaw;
      pitch = scripted.pitch;
      // Keep the player's own heading tracking the scripted one so the handover
      // at the end of the pan is invisible.
      this.controls.yaw = this.controls.targetYaw = yaw;
      this.controls.pitch = this.controls.targetPitch = pitch;
    }

    /* §5 — perlin handshake on all three axes, amplitude driven by the act */
    const t = s.time;
    const amp = s.shake;
    const sh = this._shakeSeed;
    const shakeYaw   = fbm1(t * 0.43 + sh, 3) * 0.021 * amp;
    const shakePitch = fbm1(t * 0.37 + sh + 31, 3) * 0.017 * amp;
    const shakeRoll  = fbm1(t * 0.29 + sh + 77, 3) * 0.030 * amp;
    // A slow vertical wallow on top of the actual wave height.
    const bob = fbm1(t * 0.21 + sh + 5, 2) * 0.045 * amp
              + Math.sin(t * 0.63) * 0.014 * amp;

    cam.position.set(
      p.x + fbm1(t * 0.19 + sh + 13, 2) * 0.05 * amp,
      surface + s.eyeHeight + bob + (scripted.height ?? 0) - sink,
      p.z + fbm1(t * 0.23 + sh + 47, 2) * 0.05 * amp,
    );
    cam.rotation.set(pitch + shakePitch, yaw + shakeYaw, shakeRoll, 'YXZ');
    cam.updateMatrixWorld(true);

    /* ---- the world ---- */
    const beaconPos = this.director.beaconWorld;
    this.ocean.setBeaconPosition(beaconPos);
    this.ocean.update(s, cam);
    this.skySystem.update(s, cam);
    this.motes.update(s, cam, this.pixelRatio);
    this.watchers.update(dt, s, cam, this.ocean);
    this.apparition.update(dt);
    this.leviathan.update(dt, s, cam);
    this.beacon.update(s, cam, beaconPos);
    this.door.update(dt, s, cam, this.ocean);

    const warm = {
      position: this.door.worldPos,
      intensity: s.doorReveal * (0.7 + s.doorOpen * 6.0),
      range: 2.8,
    };
    this.hand.update(dt, s, cam, warm);

    /* ---- audio ---- */
    this.audio.update(dt, s, cam, this.leviathan.proximity(cam));

    /* ---- post inputs ---- */
    // §3.2 — defocus smear proportional to how fast the head is turning.
    const mx = clamp(-this.controls.lastYawDelta * 0.55, -0.05, 0.05);
    const my = clamp(this.controls.lastPitchDelta * 0.55, -0.05, 0.05);
    this._motion.set(
      damp(this._motion.x, mx, 22, dt),
      damp(this._motion.y, my, 22, dt),
    );

    s.underwaterFilter = s.submersion;
    s.ambient = lerp(1, 0.62, s.submersion) * lerp(1, 0.68, s.darkness * 0.4);
  }

  render() {
    this.post.renderScene(this.scene, this.camera);
    this.post.present(this.state, this._motion.x, this._motion.y);
  }

  /* ---------------------------------------------------------------- debug */

  _installDebug() {
    const params = new URLSearchParams(location.search);
    const skipTo = params.get('act');
    const speed = parseFloat(params.get('speed') || '1');
    if (speed > 0 && speed !== 1) this.state.timeScale = clamp(speed, 0.1, 40);
    this._skipTo = skipTo;

    window.addEventListener('keydown', (e) => {
      if (!e.shiftKey) return;
      const map = {
        Digit1: PHASE.ACT1, Digit2: PHASE.ACT2, Digit3: PHASE.ACT3,
        Digit4: PHASE.ACT4, Digit5: PHASE.ACT5, Digit0: PHASE.WAKE,
      };
      if (map[e.code]) { this._jumpTo(map[e.code]); e.preventDefault(); }
      if (e.code === 'Equal') this.state.timeScale = Math.min(30, this.state.timeScale * 2);
      if (e.code === 'Minus') this.state.timeScale = Math.max(0.25, this.state.timeScale / 2);
    });
  }

  /** Fast-forwards the world into a later act without replaying the earlier ones. */
  _jumpTo(phase) {
    const s = this.state;
    const d = this.director;
    s.fade = 0;
    s.controlEnabled = true;
    s.swimEnabled = true;
    s.ambienceLevel = 1;
    d.scripted.active = false;
    d.titleShown = true;
    if (phase === PHASE.ACT2 || phase === PHASE.ACT3) s.beacon = 1;
    if (phase === PHASE.ACT4 || phase === PHASE.ACT5) {
      s.beacon = 1;
      d.beaconLocked = false;
      d.updateBeaconPosition();
    }
    if (phase === PHASE.ACT5) {
      d.lockBeacon();
      // Put the player on the doorstep.
      const dir = new THREE.Vector3(
        Math.sin(d.beaconBearing), 0, Math.cos(d.beaconBearing),
      );
      this.controls.position.copy(d.beaconWorld).addScaledVector(dir, -2.6);
      this.controls.targetYaw = this.controls.yaw = d.beaconBearing + Math.PI;
      d.beaconLocked = true;
    }
    d.setPhase(phase);
  }
}

/* ------------------------------------------------------------------ boot */

function fail(message, detail) {
  const el = document.getElementById('boot');
  if (el) {
    el.innerHTML = `<div class="boot-line">${message}</div>`
      + (detail ? `<div class="boot-hint show">${detail}</div>` : '');
    el.classList.remove('gone');
    el.style.display = '';
  }
  // eslint-disable-next-line no-console
  console.error('[4444]', message, detail || '');
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

if (!hasWebGL()) {
  fail('Kein WebGL verfügbar.', 'Dieses Gerät oder dieser Browser kann das Level nicht darstellen.');
} else {
  try {
    const game = new Game();
    window.__level4444 = game;
    game.begin().catch((err) => fail('Start fehlgeschlagen.', String(err && err.message || err)));
  } catch (err) {
    fail('Start fehlgeschlagen.', String(err && err.message || err));
  }
}
