/**
 * The material set. Four families, which is the whole point of the exercise:
 *
 *   metal      painted hull panelling, still holding
 *   rust       the same steel where the paint gave up
 *   glass      the window panes that are still in their frames
 *   plants     leaves, moss, bark — everything that came afterwards
 *
 * plus concrete for the floor, an emissive for the strip lights that somehow
 * still have power, and a second emissive for whatever the vegetation does
 * once the star goes behind the planet.
 *
 * Two shader edits are grafted onto the stock MeshStandardMaterial for the
 * foliage: a wind sway in the vertex stage, and a back-light term in the
 * fragment stage so a leaf standing in a shaft glows through instead of
 * turning into a silhouette. Both are small enough to be worth not writing a
 * whole material for.
 */

import * as THREE from 'three';
import { PALETTE, FLORA } from './config.js';
import * as TEX from './textures.js';

/** Clone a texture at a different tiling. `clone()` shares the GPU upload, so
 *  this costs nothing but a Texture object. */
function withRepeat(tex, x, y = x) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

/**
 * The three maps that come out of one bake, wired up as one material.
 *
 * `repeat` defaults to 1 because the architecture tiles its textures by
 * scaling UVs in the geometry (see station.js) — that way a wall and a floor
 * share one texture object at one world scale. Only geometries with their own
 * intrinsic UV layout, like a cylinder, pass a repeat here.
 */
function standard(surface, repeat = 1, extra = {}) {
  const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
  return new THREE.MeshStandardMaterial({
    map: withRepeat(surface.map, rx, ry),
    roughnessMap: withRepeat(surface.armMap, rx, ry),
    metalnessMap: withRepeat(surface.armMap, rx, ry),
    normalMap: withRepeat(surface.normalMap, rx, ry),
    // The maps carry the actual values; these two just have to not scale them.
    roughness: 1,
    metalness: 1,
    normalScale: new THREE.Vector2(1, 1),
    ...extra,
  });
}

export class Materials {
  constructor(renderer, quality) {
    TEX.setAnisotropy(renderer);

    this._wind = [];        // foliage uniform blocks that need the clock

    /* ---- baked surfaces (this is the expensive part of the load) ---- */
    const panel = TEX.paintedPanel(PALETTE);
    const rust = TEX.rustedSteel(PALETTE);
    const floor = TEX.terminalFloor(PALETTE);
    const grime = TEX.glassGrime();
    const leaf = TEX.leafCard(PALETTE);
    const moss = TEX.mossPatch(PALETTE);
    const bark = TEX.bark(PALETTE);

    this.sprite = TEX.radialSprite(64, 2.4);

    /* --------------------------------------- metal, rust, concrete ---- */

    this.metal = standard(panel);
    this.rust = standard(rust);
    this.floor = standard(floor);
    this.floorPatch = standard(floor, 2);   // rubble: unit boxes, own UVs

    /* -------------------------------------------------------- glass ---- */
    /* Real transmission is a second render of the scene every frame. It is
     * worth it when the machine can pay for it and pointless when it cannot,
     * so the cheap variant is a plain tinted transparent surface. Both keep
     * the same grime map, so the panes read the same either way. */

    const glassCommon = {
      color: new THREE.Color(0xbcd3cd),
      roughnessMap: withRepeat(grime.armMap, 1, 1),
      normalMap: withRepeat(grime.normalMap, 1, 1),
      normalScale: new THREE.Vector2(0.35, 0.35),
      metalness: 0,
      roughness: 1,
      side: THREE.DoubleSide,
    };

    this.glass = quality.transmission
      ? new THREE.MeshPhysicalMaterial({
          ...glassCommon,
          transmission: 0.92,
          thickness: 0.02,
          ior: 1.48,
          transparent: true,
          opacity: 1,
          envMapIntensity: 1.2,
        })
      : new THREE.MeshPhysicalMaterial({
          ...glassCommon,
          transparent: true,
          opacity: 0.30,
          envMapIntensity: 1.6,
        });

    if (this.glass.transmissionResolutionScale !== undefined) {
      this.glass.transmissionResolutionScale = 0.4;
    }

    /* ------------------------------------------------------- plants ---- */

    this.foliage = this._makeFoliage(leaf.map, leaf.normalMap, 0.42);
    this.moss = this._makeFoliage(moss.map, moss.normalMap, 0.30, {
      side: THREE.DoubleSide, wind: 0.25,
    });
    this.bark = standard(bark, [1.6, 1.0]);

    this.vine = new THREE.MeshStandardMaterial({
      color: 0x4a5c39,
      roughness: 0.92,
      metalness: 0.0,
      map: withRepeat(bark.map, 1, 6),
      normalMap: withRepeat(bark.normalMap, 1, 6),
      normalScale: new THREE.Vector2(0.7, 0.7),
    });

    /* ----------------------------------------------------- emissive ---- */

    this.strip = new THREE.MeshStandardMaterial({
      color: 0x14100f,
      emissive: new THREE.Color(PALETTE.emergency),
      emissiveIntensity: 1.4,
      roughness: 0.6,
      metalness: 0,
    });

    this.pod = new THREE.MeshStandardMaterial({
      color: 0x0d1a14,
      emissive: new THREE.Color(PALETTE.bio),
      emissiveIntensity: 0.08,
      roughness: 0.55,
      metalness: 0,
    });

    this.sign = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.1,
    });

    this.board = new THREE.MeshStandardMaterial({
      color: 0x0a0e10,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.2,
    });
  }

  /**
   * Standard material + wind + back-light. `alphaTest` rather than blending:
   * thousands of transparent leaf cards would need sorting every frame and
   * would still punch holes in each other.
   */
  _makeFoliage(map, normalMap, alphaTest, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      alphaTest,
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0,
      shadowSide: THREE.DoubleSide,
    });

    const uniforms = {
      uTime: { value: 0 },
      uWind: { value: FLORA.windStrength * (opts.wind ?? 1) },
      uWindSpeed: { value: FLORA.windSpeed },
      uGust: { value: 0 },
      uTranslucency: { value: 0.85 },
    };

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform float uTime;
          uniform float uWind;
          uniform float uWindSpeed;
          uniform float uGust;
        `)
        .replace('#include <begin_vertex>', /* glsl */`
          #include <begin_vertex>
          /* Per-instance phase, read straight out of the instance matrix's
             translation column, so every card moves on its own clock. */
          #ifdef USE_INSTANCING
            vec3 iOrigin = instanceMatrix[3].xyz;
          #else
            vec3 iOrigin = vec3(0.0);
          #endif
          float phase = dot(iOrigin, vec3(0.53, 0.31, 0.77));
          float t = uTime * uWindSpeed;
          float sway = sin(t + phase) * 0.62 + sin(t * 1.73 + phase * 2.3) * 0.38;
          /* The card's geometry is authored with its stem at y = 0, so the
             tip travels and the stem does not. */
          float lever = max(transformed.y, 0.0);
          transformed.x += sway * uWind * (1.0 + uGust * 3.0) * lever;
          transformed.z += cos(t * 1.31 + phase) * uWind * 0.5 * lever;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */`
          #include <common>
          uniform float uTranslucency;
        `)
        .replace('#include <lights_fragment_end>', /* glsl */`
          #include <lights_fragment_end>
          /* Leaves are thin. Standing in a shaft with the star behind them
             they should light up, not go to silhouette. */
          #if NUM_DIR_LIGHTS > 0
            vec3 vDir = normalize(vViewPosition);
            float back = pow(max(dot(vDir, -directionalLights[0].direction), 0.0), 3.0);
            reflectedLight.indirectDiffuse +=
              directionalLights[0].color * back * uTranslucency * diffuseColor.rgb;
          #endif
        `);
    };
    /* Materials that compile to different programs must not share a cache
     * key, or the second one silently reuses the first one's shader. */
    mat.customProgramCacheKey = () => `foliage-${alphaTest}-${opts.wind ?? 1}`;

    mat.userData.uniforms = uniforms;
    this._wind.push(uniforms);
    return mat;
  }

  /**
   * A tiny environment for the metal to reflect. Without one, every metallic
   * surface renders as a black hole — the hull needs to be able to see the
   * star, the planet and its own dark ceiling.
   */
  buildEnvironment(renderer, scene) {
    const env = new THREE.Scene();
    const box = (w, h, d, color, pos, intensity = 1) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(intensity),
          side: THREE.BackSide,
        }),
      );
      m.position.set(...pos);
      env.add(m);
      return m;
    };

    // the room itself: dark, cold, closed — but not black. Most of this hall
    // is metal, and metal with nothing to reflect renders as a hole.
    box(30, 20, 60, 0x1a242a, [0, 0, 0], 1);
    // the star, off to one side
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.sunLow).multiplyScalar(9) }),
    );
    sun.position.set(-13.5, 6, 0);
    sun.rotation.y = Math.PI / 2;
    env.add(sun);
    // the planet, filling the other side with cold blue
    const planet = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 14),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.planet).multiplyScalar(0.7) }),
    );
    planet.position.set(0, 2, -28);
    env.add(planet);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(env, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;

    env.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    pmrem.dispose();
    this.envTarget = target;
  }

  /** Per-frame. `sun` comes from the light rig; night is when the plants
   *  take over the lighting and the strip lights start to matter. */
  update(time, dt, sun) {
    for (const u of this._wind) {
      u.uTime.value = time;
      // A gust every so often, shaped so it arrives faster than it leaves.
      const g = Math.sin(time * 0.19) * Math.sin(time * 0.071 + 1.3);
      u.uGust.value = Math.max(0, g) ** 2;
    }

    /* The bioluminescence is the inverse of the daylight, with a slow pulse.
     * In full daylight it is almost off — these are not fairy lights, they
     * are what the hall has instead of light once the star has gone. */
    const night = 1 - sun.daylight;
    this.pod.emissiveIntensity = 0.06 + night * (1.7 + Math.sin(time * 0.7) * 0.2);

    // Failing ballast in the emergency strips. Mostly on, occasionally not.
    const f = Math.sin(time * 37.0) * Math.sin(time * 11.3) * Math.sin(time * 3.1);
    this.strip.emissiveIntensity = (0.9 + night * 1.5) * (f > -0.86 ? 1 : 0.12);

    this.board.emissiveIntensity =
      0.55 + night * 0.5 + (Math.sin(time * 23.7) > 0.97 ? -0.45 : 0);
  }
}
