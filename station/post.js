/**
 * The image stack, written by hand because `EffectComposer` lives in the
 * examples folder and this project vendors only the core.
 *
 *   scene  ->  sceneRT   (HDR, half-float, with a depth texture attached)
 *   beams  ->  beamRT    (half resolution; reads the depth above for occlusion)
 *   both   ->  bloom     (bright pass, then two separable blurs at 1/4)
 *   all    ->  screen    (tone map, vignette, aberration, grain)
 *
 * The depth texture is the reason the scene is not drawn straight to the
 * canvas: the volumetric pass needs to know where the room is.
 */

import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const PREFILTER = /* glsl */`
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBeams;
uniform float uThreshold;
uniform float uKnee;
uniform float uBeamGain;
varying vec2 vUv;

void main() {
  vec3 c = texture2D(uScene, vUv).rgb + texture2D(uBeams, vUv).rgb * uBeamGain;
  float l = max(c.r, max(c.g, c.b));
  // Soft knee, so the bloom does not switch on at a visible contour.
  float w = clamp((l - uThreshold) / max(uKnee, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * w * w, 1.0);
}
`;

const BLUR = /* glsl */`
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDirection;   // texel-sized step, one axis at a time
varying vec2 vUv;

void main() {
  // 9-tap gaussian, weights normalised.
  float w[5];
  w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;
  vec3 c = texture2D(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDirection * float(i);
    c += texture2D(uTex, vUv + o).rgb * w[i];
    c += texture2D(uTex, vUv - o).rgb * w[i];
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE = /* glsl */`
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBeams;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uBeamGain;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uTime;
uniform float uFadeIn;
varying vec2 vUv;

/* Narkowicz's ACES fit. Cheap, and it keeps the highlights in the shafts from
   clipping to a flat white disc. */
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCentre = uv - 0.5;
  float r2 = dot(fromCentre, fromCentre);

  /* A touch of lateral colour toward the edges. Every lens has it; without it
     a rendered frame reads as a rendered frame. */
  vec2 shift = fromCentre * uAberration * r2;
  vec3 col;
  col.r = texture2D(uScene, uv + shift).r;
  col.g = texture2D(uScene, uv).g;
  col.b = texture2D(uScene, uv - shift).b;

  col += texture2D(uBeams, uv).rgb * uBeamGain;
  col += texture2D(uBloom, uv).rgb * uBloomStrength;

  col = aces(col * uExposure);

  // Vignette
  col *= 1.0 - uVignette * smoothstep(0.12, 0.78, r2);

  // Grain, a little stronger in the shadows where the eye expects noise —
  // but only a little: this hall is dark almost everywhere, and a shadow
  // boost that looked reasonable on a test frame buried the whole image.
  float n = hash12(gl_FragCoord.xy + fract(uTime) * 913.0) - 0.5;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += n * uGrain * (0.65 + 0.35 * (1.0 - lum));

  col *= uFadeIn;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
  #include <colorspace_fragment>
}
`;

export class Post {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    /* Half float keeps the sun's highlight above 1.0 all the way to the tone
     * mapper. If the extension is missing the stack still runs, it just
     * clips — so the bloom threshold drops to compensate. */
    this.hdr = renderer.capabilities.isWebGL2 !== false
      && renderer.extensions.has('EXT_color_buffer_half_float');
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

    const rtOpts = {
      type,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };

    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      ...rtOpts,
      samples: quality.samples || 0,
    });
    this.sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
    this.sceneRT.depthTexture.type = THREE.UnsignedIntType;

    this.beamRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });

    const mk = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this.prefilterMat = mk(PREFILTER, {
      uScene: { value: this.sceneRT.texture },
      uBeams: { value: this.beamRT.texture },
      uThreshold: { value: this.hdr ? 1.05 : 0.72 },
      uKnee: { value: 0.7 },
      uBeamGain: { value: 1.0 },
    });

    this.blurMat = mk(BLUR, {
      uTex: { value: null },
      uDirection: { value: new THREE.Vector2() },
    });

    this.compositeMat = mk(COMPOSITE, {
      uScene: { value: this.sceneRT.texture },
      uBeams: { value: this.beamRT.texture },
      uBloom: { value: this.bloomA.texture },
      uExposure: { value: 1.12 },
      uBloomStrength: { value: quality.bloom ? 0.55 : 0.0 },
      uBeamGain: { value: 1.0 },
      uVignette: { value: 0.50 },
      uGrain: { value: 0.020 },
      uAberration: { value: 0.0032 },
      uTime: { value: 0 },
      uFadeIn: { value: 0 },
    });
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;

    this.sceneRT.setSize(width, height);
    this.sceneRT.depthTexture.image.width = width;
    this.sceneRT.depthTexture.image.height = height;
    this.sceneRT.depthTexture.needsUpdate = true;

    const bw = Math.max(2, Math.floor(width / 2));
    const bh = Math.max(2, Math.floor(height / 2));
    this.beamRT.setSize(bw, bh);
    this.beamSize = new THREE.Vector2(bw, bh);

    const qw = Math.max(2, Math.floor(width / 4));
    const qh = Math.max(2, Math.floor(height / 4));
    this.bloomA.setSize(qw, qh);
    this.bloomB.setSize(qw, qh);
    this.bloomSize = new THREE.Vector2(qw, qh);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
  }

  _blur(from, to, dx, dy) {
    this.blurMat.uniforms.uTex.value = from.texture;
    this.blurMat.uniforms.uDirection.value.set(dx / this.bloomSize.x, dy / this.bloomSize.y);
    this._pass(this.blurMat, to);
  }

  /** Everything after the scene and the beams have been drawn. */
  finish(time, fadeIn, exposure) {
    const r = this.renderer;

    if (this.quality.bloom) {
      this._pass(this.prefilterMat, this.bloomA);
      this._blur(this.bloomA, this.bloomB, 1, 0);
      this._blur(this.bloomB, this.bloomA, 0, 1);
      this._blur(this.bloomA, this.bloomB, 2.4, 0);
      this._blur(this.bloomB, this.bloomA, 0, 2.4);
    }

    const u = this.compositeMat.uniforms;
    u.uTime.value = time;
    u.uFadeIn.value = fadeIn;
    u.uExposure.value = exposure;

    r.setRenderTarget(null);
    this.quad.material = this.compositeMat;
    r.render(this.scene, this.camera);
  }

  dispose() {
    for (const rt of [this.sceneRT, this.beamRT, this.bloomA, this.bloomB]) rt.dispose();
    for (const m of [this.prefilterMat, this.blurMat, this.compositeMat]) m.dispose();
  }
}
