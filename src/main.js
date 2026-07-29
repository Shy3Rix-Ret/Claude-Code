/**
 * LEVEL 4444 — THE ABYSS
 * Bootstrap and frame loop.
 */

import * as THREE from 'three';
import { PALETTE, QUALITY, SWIM } from './config.js';
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

/**
 * Rough opening guess at scene detail. Resolution is deliberately not part of
 * it — the frame-rate loop adapts pixel ratio continuously and does that
 * better than anything decidable at load time.
 *
 * navigator.deviceMemory is Chromium-only, so it must never be the deciding
 * vote; on Safari and Firefox it simply is not there.
 */
function pickQuality() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory;   // undefined outside Chromium

  if (cores <= 4 || (mem !== undefined && mem <= 3)) {
    return { name: 'low', ...QUALITY.low };
  }
  if (cores >= 8 && (mem === undefined || mem >= 8)) {
    return { name: 'high', ...QUALITY.high };
  }
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

    this.skySystem = new Sky(this.scene, this.quality);
    this.ocean = new Ocean(this.scene, this.quality);
    this.motes = new Motes(this.scene, this.quality.motes);
    /* Foam at the waterline. World-anchored, so it streams past as you move —
     * in open fog it is the only thing that reads as forward motion. */
    /* A tight box on purpose: only the first few metres of water are ever
     * visible from 16cm above it, so the whole budget goes there. */
    this.foam = new Motes(this.scene, Math.round(this.quality.motes * 0.8), 12, {
      slab: 0.34, seed: 0x0f0a, sizeScale: 0.8, color: PALETTE.fogHigh,
    });
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
    // Keep the horizontal field constant across window shapes, so a wide
    // monitor shows more sea rather than a cropped strip of it.
    const hFov = 92 * (Math.PI / 180);
    this.camera.fov = 2 * Math.atan(Math.tan(hFov / 2) / Math.max(w / h, 0.6))
                    * (180 / Math.PI);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    this.motes.material.uniforms.uPixelRatio.value = this.pixelRatio;
  }

  async begin() {
    await this.overlay.waitForStart(() => {
      // Capture the pointer from inside the gesture; browsers refuse it later.
      try { this.controls.requestPointerLock(); } catch { /* drag fallback */ }
    });

    /* Last line of defence. If anything below still manages to stall, the
     * player gets a sentence rather than a loading screen that never moves. */
    const watchdog = setTimeout(() => {
      if (this.state.frame === 0) {
        this.overlay.showError('Start hängt fest — bitte die Seite neu laden.');
      }
    }, 6000);

    /* Everything that needs a user gesture happens right here, in one go —
     * and none of it may stop the level from starting.
     *
     * Audio in particular gets a deadline rather than an await. On iOS inside
     * an embedded frame the audio graph can take an unbounded time to come up,
     * without ever failing, and a start path that waits on it leaves the
     * loading screen on screen forever. Give it a moment so the cold open
     * lands in sync on devices where it works, then go regardless; the engine
     * joins late or not at all, and the level plays either way. */
    const audioReady = this.audio.start().catch((err) => {
      this.audio.enabled = false;
      console.warn('[4444] audio unavailable:', err);
    });
    await Promise.race([
      audioReady,
      new Promise((r) => setTimeout(r, 1200)),
    ]);

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

    clearTimeout(watchdog);
    this._last = performance.now();
    this._loop(this._last);
  }

  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 1 / 60;
    /* The cap keeps a tab-switch from skipping an act, but it must not be so
     * tight that a slow device runs the world in slow motion: at 0.1s a phone
     * managing 8fps advanced the clock at a fifth of real time, so the REC
     * stamp crawled, swimming covered almost no distance, and the level looked
     * frozen while it was in fact merely slow. Every integrator here is exact
     * for any step, so the cap can afford to be generous. */
    dt = Math.min(dt, 0.25);
    this._smoothDt = lerp(this._smoothDt, dt, 0.1);

    this._fpsAccum += Math.min((now - (this._fpsLast ?? now)) / 1000, 1);
    this._fpsLast = now;
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
    this._updateDiag(dt);
  }

  /**
   * Resolution goes first, per §5 — detail is the thing worth keeping. But it
   * cannot be the only lever: below the floor a struggling device used to be
   * left struggling, and a level running at 8fps is not a slower level, it is
   * a broken one. So once resolution is spent, effects come off too.
   */
  _adaptQuality() {
    const w = window.innerWidth, h = window.innerHeight;
    const apply = () => {
      this.post.setSize(w, h, this.pixelRatio);
      this.motes.material.uniforms.uPixelRatio.value = this.pixelRatio;
      this.foam.material.uniforms.uPixelRatio.value = this.pixelRatio;
    };

    if (this._fps < 26) {
      this._slowFor = (this._slowFor || 0) + 1;
      if (this.pixelRatio > 0.6) {
        this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.16);
        apply();
      } else if (this._slowFor > 4) {
        // Still short after giving up resolution: start shedding effects.
        this._shedEffects();
      }
    } else {
      this._slowFor = 0;
      if (this._fps > 52 && this.pixelRatio < this.quality.pixelRatioCap) {
        this.pixelRatio = Math.min(this.quality.pixelRatioCap, this.pixelRatio + 0.05);
        apply();
      }
    }
  }

  /** One rung at a time, cheapest-looking loss first. */
  _shedEffects() {
    const u = this.post.compositeMat.uniforms;
    const step = (this._shed = (this._shed || 0) + 1);
    this._slowFor = 0;
    if (step === 1) {
      u.uDropAmount.value = 0;                 // lens droplets: 2 samples/px
      this.post.compositeMat.defines.MB_SAMPLES = 3;
      this.post.compositeMat.needsUpdate = true;
    } else if (step === 2) {
      this.motes.points.visible = false;   // foam stays: it is feedback, not decor
      this.skySystem.material.defines.SKY_OCT = 2;
      this.skySystem.material.needsUpdate = true;
    } else if (step === 3) {
      u.uBloom.value = 0;
      this.post.compositeMat.defines.MB_SAMPLES = 1;
      this.post.compositeMat.needsUpdate = true;
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
    let bob = fbm1(t * 0.21 + sh + 5, 2) * 0.045 * amp
            + Math.sin(t * 0.63) * 0.014 * amp;

    /* Stroke rhythm. Swimming in open water changes almost nothing you can
     * see, so the motion has to be felt in the camera: a surge and a dip on
     * every pull, scaled by how hard you are actually going. */
    const swim01 = clamp(this.controls.velocity.length() / SWIM.maxSpeed, 0, 1);
    if (swim01 > 0.01) {
      this._stroke = (this._stroke || 0) + dt * (1.7 + swim01 * 1.1);
      bob += Math.sin(this._stroke * Math.PI * 2) * 0.055 * swim01;
      pitch += Math.sin(this._stroke * Math.PI * 2 + 1.1) * 0.022 * swim01;
    }

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
    const speed01 = clamp(this.controls.velocity.length() / SWIM.maxSpeed, 0, 1);
    this.motes.update(s, cam, this.pixelRatio, speed01);
    // Foam rides the surface under the camera, just above it so it is not
    // swallowed by the opaque water.
    this.foam.update(s, cam, this.pixelRatio, speed01, surface + 0.02);
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
    this._checkPicture();
  }

  /**
   * Reads back a few pixels once, at the point in the prologue where the fade
   * has lifted and the ocean must be on screen. A renderer that produces
   * nothing looks exactly like a level that is meant to be dark, and on a
   * device I cannot attach a debugger to that difference is invisible — so
   * the level checks for itself and says so.
   */
  _checkPicture() {
    if (this._pictureChecked) return;
    const s = this.state;
    if (s.fade > 0.25 || s.frame < 60) return;
    this._pictureChecked = true;

    try {
      const gl = this.renderer.getContext();
      const w = 8, h = 8;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(
        Math.max(0, (gl.drawingBufferWidth >> 1) - 4),
        Math.max(0, (gl.drawingBufferHeight >> 1) - 4),
        w, h, gl.RGBA, gl.UNSIGNED_BYTE, px,
      );
      let peak = 0;
      for (let i = 0; i < px.length; i += 4) {
        peak = Math.max(peak, px[i], px[i + 1], px[i + 2]);
      }
      if (peak < 6) {
        this.overlay.showError(
          'Die Grafik liefert kein Bild — dieser Browser stellt das Level nicht dar. '
          + 'Bitte die Seite direkt in Safari oder Chrome öffnen.',
        );
      }
    } catch { /* readback refused; not worth failing over */ }
  }

  /* ---------------------------------------------------------------- debug */

  /**
   * ?diag=1 puts the numbers on screen. Not a HUD — §6 forbids one — but the
   * level ships to phones I cannot profile, and "it feels stuck" and "it runs
   * at nine frames a second" look identical from here.
   */
  _installDiag() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;z-index:99;padding:4px 7px;'
      + 'font:11px ui-monospace,monospace;color:#7dd3a0;background:rgba(0,0,0,.62);'
      + 'pointer-events:none;white-space:pre;line-height:1.5';
    document.body.appendChild(el);
    this._diagEl = el;
    this._diagT = 0;
  }

  _updateDiag(dt) {
    if (!this._diagEl) return;
    this._diagT += dt;
    if (this._diagT < 0.25) return;
    this._diagT = 0;
    const s = this.state;
    this._diagEl.textContent =
      `${this._fps.toFixed(0)} fps   ${this.quality.name}  px ${this.pixelRatio.toFixed(2)}\n`
      + `${s.phase}  t=${s.time.toFixed(0)}s  shed ${this._shed || 0}\n`
      + `swim ${s.swimEnabled ? 'on' : 'off'} in ${this.controls.swimInput.toFixed(2)}  `
      + `v ${this.controls.velocity.length().toFixed(2)}\n`
      + `hdr ${this.post.hdr}  audio ${this.audio.ctx?.state || 'none'}`;
  }

  _installDebug() {
    const params = new URLSearchParams(location.search);
    if (params.get('diag') === '1') this._installDiag();
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

/** Puts a reason on screen instead of leaving the loading line up forever. */
function fail(message, detail) {
  const text = detail ? `${message} ${detail}` : message;
  const el = document.getElementById('boot');
  if (el) {
    el.classList.remove('gone');
    el.style.display = '';
  }
  if (window.__bootFail) {
    window.__bootFail(text);
  } else {
    const box = document.getElementById('boot-error');
    if (box) { box.textContent = text; box.classList.add('show'); }
  }
  // eslint-disable-next-line no-console
  console.error('[4444]', message, detail || '');
}

/**
 * Probes for a usable context and releases it again. Safari keeps a small
 * pool of live WebGL contexts and will refuse the renderer's own request if
 * this one is still holding a slot.
 */
function probeWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}

if (!probeWebGL()) {
  fail(
    'Kein WebGL verfügbar.',
    'Dieser Browser kann das Level nicht darstellen — bitte in Safari oder '
    + 'Chrome direkt öffnen, nicht in einer App-Vorschau.',
  );
} else {
  try {
    const game = new Game();
    window.__level4444 = game;

    // A lost context on mobile is common enough to be worth naming.
    game.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      fail('Grafikkontext verloren.', 'Seite neu laden.');
    });

    game.begin().catch((err) => fail('Start fehlgeschlagen —', String((err && err.message) || err)));
  } catch (err) {
    fail('Start fehlgeschlagen —', String((err && err.message) || err));
  }
}
