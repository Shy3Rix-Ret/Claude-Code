/**
 * The camera this footage was supposedly shot on.
 *
 * §5 — bloom, a vignette that closes in over the run, constant film grain, and
 * chromatic aberration that only shows up in Act 3. Plus two things the design
 * doc asks for elsewhere: water on the lens (§3.2) and defocus smear when the
 * player whips their head around (§3.2).
 *
 * Hand-rolled rather than EffectComposer: one composite pass doing all of the
 * screen-space work means one full-res fragment shader on a phone instead of
 * six, which is where the budget for the water shader comes from (§5).
 */

import * as THREE from 'three';
import { POST } from './config.js';
import { FULLSCREEN_VS, NOISE, TONEMAP } from './glsl.js';

const BRIGHT_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tSrc;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb;
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tSrc;
uniform vec2 uDir;        // texel-sized step, horizontal or vertical
varying vec2 vUv;
void main(){
  // 9-tap gaussian, linear-sampling optimised to 5 fetches.
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  c += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tScene;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform sampler2D tDroplets;

uniform vec2  uResolution;
uniform float uAspect;
uniform float uTime;

uniform float uBloom;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uChroma;
uniform vec2  uMotion;       // screen-space smear direction, in uv units
uniform float uUnderwater;
uniform float uDesaturate;
uniform float uFade;
uniform float uDropAmount;
uniform vec3  uMurkTint;
uniform float uPulse;        // Act 3 heartbeat, squeezes the frame

varying vec2 vUv;

${NOISE}
${TONEMAP}

vec3 sampleScene(vec2 uv){ return texture2D(tScene, clamp(uv, 0.0005, 0.9995)).rgb; }

void main(){
  vec2 uv = vUv;

  /* --- water on the lens: refract, then add the highlight back at the end --- */
  float dropSpec = 0.0;
  if (uDropAmount > 0.001) {
    // Big and soft: this is water sitting on glass, not dust on a sensor.
    vec2 duv = vUv * vec2(uAspect, 1.0) * 0.58 + vec2(0.0, -uTime * 0.0032);
    vec4 dr = texture2D(tDroplets, duv);
    vec2 duv2 = vUv * vec2(uAspect, 1.0) * 1.05 + vec2(0.13, -uTime * 0.0068);
    vec4 dr2 = texture2D(tDroplets, duv2);
    vec2 off = ((dr.rg - 0.5) * dr.a * 1.0 + (dr2.rg - 0.5) * dr2.a * 0.55) * 0.062 * uDropAmount;
    uv += off;
    dropSpec = (dr.b * dr.a + dr2.b * dr2.a * 0.6) * uDropAmount;
  }

  /* --- underwater: the whole frame swims --- */
  if (uUnderwater > 0.001) {
    float w = uUnderwater * 0.0055;
    uv += vec2(
      sin(vUv.y * 11.0 + uTime * 0.9) * w,
      cos(vUv.x * 13.0 - uTime * 0.7) * w * 0.8
    );
  }

  /* --- heartbeat squeeze (Act 3) --- */
  if (uPulse > 0.001) {
    uv = (uv - 0.5) * (1.0 - uPulse * 0.013) + 0.5;
  }

  /* --- defocus smear on fast head movement --- */
  vec3 col;
  float mlen = length(uMotion);
  if (mlen > 0.00012) {
    col = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 6; i++) {
      float t = float(i) / 5.0 - 0.5;
      float w = 1.0 - abs(t) * 0.72;
      col += sampleScene(uv + uMotion * t) * w;
      wsum += w;
    }
    col /= wsum;
  } else {
    col = sampleScene(uv);
  }

  /* --- chromatic aberration, radial (Act 3 only) --- */
  if (uChroma > 0.0001) {
    vec2 d = vUv - 0.5;
    vec2 off = d * dot(d, d) * uChroma;
    col.r = sampleScene(uv + off).r;
    col.b = sampleScene(uv - off).b;
  }

  /* --- bloom --- */
  vec3 b = texture2D(tBloomA, uv).rgb * 0.62 + texture2D(tBloomB, uv).rgb * 0.55;
  col += b * uBloom;

  /* --- underwater grade --- */
  col = mix(col, col * uMurkTint, uUnderwater * 0.75);
  col *= 1.0 - uUnderwater * 0.12;

  col *= uExposure;

  /* --- tone + transfer --- */
  col = acesFilm(col);
  col = linearToSRGB(col);

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), uDesaturate);

  /* --- droplet highlight sits on the glass, not in the world --- */
  col += vec3(0.85, 0.90, 0.92) * dropSpec * 0.085;

  /* --- vignette --- */
  float vr = length(vUv - 0.5) * 1.4142;
  float vig = smoothstep(1.06, 0.30, vr);
  col *= mix(1.0, vig, uVignette);

  /* --- grain: heavier in the shadows, like a pushed sensor --- */
  float g = hash12(vUv * uResolution + fract(uTime * 37.0) * 733.0);
  col += (g - 0.5) * uGrain * mix(1.0, 0.42, clamp(lum * 2.2, 0.0, 1.0));

  col *= 1.0 - uFade;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export class PostStack {
  constructor(renderer, quality, dropletTexture) {
    this.renderer = renderer;
    this.div = quality.bloomDiv;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const caps = renderer.capabilities;
    this.hdrType = caps.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType;

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: this.hdrType,
      depthBuffer: true,
      stencilBuffer: false,
      colorSpace: THREE.NoColorSpace,
    };
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, rtOpts);

    const bloomOpts = { ...rtOpts, depthBuffer: false };
    this.rtA1 = new THREE.WebGLRenderTarget(1, 1, bloomOpts);
    this.rtA2 = new THREE.WebGLRenderTarget(1, 1, bloomOpts);
    this.rtB1 = new THREE.WebGLRenderTarget(1, 1, bloomOpts);
    this.rtB2 = new THREE.WebGLRenderTarget(1, 1, bloomOpts);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tSrc: { value: null },
        uThreshold: { value: POST.bloomThreshold },
        uKnee: { value: POST.bloomKnee },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: BLUR_FRAG,
      depthTest: false, depthWrite: false,
    });

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene:      { value: null },
        tBloomA:     { value: null },
        tBloomB:     { value: null },
        tDroplets:   { value: dropletTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uAspect:     { value: 1 },
        uTime:       { value: 0 },
        uBloom:      { value: 1 },
        uExposure:   { value: 1 },
        uVignette:   { value: POST.vignetteStart },
        uGrain:      { value: POST.grainBase },
        uChroma:     { value: 0 },
        uMotion:     { value: new THREE.Vector2() },
        uUnderwater: { value: 0 },
        uDesaturate: { value: 0 },
        uFade:       { value: 1 },
        uDropAmount: { value: 0.8 },
        uMurkTint:   { value: new THREE.Color(0.42, 0.72, 0.78) },
        uPulse:      { value: 0 },
      },
      vertexShader: FULLSCREEN_VS,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false, depthWrite: false,
    });

    this._size = new THREE.Vector2();
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(2, Math.floor(width * pixelRatio));
    const h = Math.max(2, Math.floor(height * pixelRatio));
    this._size.set(w, h);
    this.rtScene.setSize(w, h);

    const d = this.div;
    const w1 = Math.max(2, Math.floor(w / d)), h1 = Math.max(2, Math.floor(h / d));
    const w2 = Math.max(2, Math.floor(w / (d * 2))), h2 = Math.max(2, Math.floor(h / (d * 2)));
    this.rtA1.setSize(w1, h1); this.rtA2.setSize(w1, h1);
    this.rtB1.setSize(w2, h2); this.rtB2.setSize(w2, h2);

    const u = this.compositeMat.uniforms;
    u.uResolution.value.set(w, h);
    u.uAspect.value = width / height;
  }

  _draw(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.camera);
  }

  _blur(src, tmp, dst, w, h) {
    this.blurMat.uniforms.tSrc.value = src.texture;
    this.blurMat.uniforms.uDir.value.set(1 / w, 0);
    this._draw(this.blurMat, tmp);
    this.blurMat.uniforms.tSrc.value = tmp.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / h);
    this._draw(this.blurMat, dst);
  }

  /** Renders the world into the offscreen buffer. */
  renderScene(scene, camera) {
    this.renderer.setRenderTarget(this.rtScene);
    this.renderer.clear(true, true, false);
    this.renderer.render(scene, camera);
  }

  /** Runs bloom + composite and blits to the canvas. */
  present(state, motionX, motionY) {
    const d = this.div;
    const w = this._size.x, h = this._size.y;

    // Bright pass into the first bloom mip.
    this.brightMat.uniforms.tSrc.value = this.rtScene.texture;
    this._draw(this.brightMat, this.rtA1);
    this._blur(this.rtA1, this.rtA2, this.rtA1, w / d, h / d);

    // Second, wider mip from the first.
    this.blurMat.uniforms.tSrc.value = this.rtA1.texture;
    this.blurMat.uniforms.uDir.value.set(1 / (w / (d * 2)), 0);
    this._draw(this.blurMat, this.rtB1);
    this.blurMat.uniforms.tSrc.value = this.rtB1.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / (h / (d * 2)));
    this._draw(this.blurMat, this.rtB2);
    this._blur(this.rtB2, this.rtB1, this.rtB2, w / (d * 2), h / (d * 2));

    const u = this.compositeMat.uniforms;
    u.tScene.value = this.rtScene.texture;
    u.tBloomA.value = this.rtA1.texture;
    u.tBloomB.value = this.rtB2.texture;
    u.uTime.value = state.time;
    u.uBloom.value = state.bloom;
    u.uExposure.value = state.exposure;
    u.uVignette.value = state.vignette;
    u.uGrain.value = state.grain;
    u.uChroma.value = state.chroma;
    u.uUnderwater.value = state.underwaterFilter;
    u.uDesaturate.value = state.desaturate;
    u.uFade.value = state.fade;
    u.uPulse.value = state.pulse ?? 0;
    u.uMotion.value.set(motionX, motionY);

    this.renderer.setRenderTarget(null);
    this._draw(this.compositeMat, null);
  }

  dispose() {
    [this.rtScene, this.rtA1, this.rtA2, this.rtB1, this.rtB2].forEach((r) => r.dispose());
    [this.brightMat, this.blurMat, this.compositeMat].forEach((m) => m.dispose());
    this.quad.geometry.dispose();
  }
}
