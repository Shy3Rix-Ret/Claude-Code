/**
 * The holes in the hull, and which panes are still in them.
 *
 * This module exists so that four different systems agree about one thing:
 *
 *   station.js  builds the glass panes that are still there — and they are
 *               what casts the shadow, so the pattern on the floor is real
 *   light.js    extrudes a volumetric shaft out of every opening
 *   dust.js     brightens a mote when it is standing inside one of them
 *   audio.js    knows where the draught is coming from
 *
 * The pane pattern is baked once into a small mask atlas: one block of
 * MASK_COLS × MASK_ROWS texels per opening, red channel, 1 = glass still in
 * place. Each block is padded by a ring of "glass" texels so the atlas can be
 * sampled with linear filtering — the shafts want soft edges, and without the
 * padding the filter would bleed one window into the next.
 */

import * as THREE from 'three';
import { OPENINGS } from './config.js';
import { makeRng, noise2, clamp } from './util.js';

export const MASK_COLS = 10;   // block width, including 1 texel of padding
export const MASK_ROWS = 7;    // block height, including 1 texel of padding

const HALL_CENTRE = new THREE.Vector3(0, 6, 0);

export class Openings {
  constructor() {
    this.list = OPENINGS.map((spec, index) => this._prepare(spec, index));
    this.maskTexture = this._bakeAtlas();
  }

  _prepare(spec, index) {
    const center = new THREE.Vector3(...spec.center);
    const right = new THREE.Vector3(...spec.right);
    const up = new THREE.Vector3(...spec.up);

    /* The winding of right × up depends on how each opening was written down,
     * and getting it wrong points the shaft out into space. Rather than
     * demanding a convention from config.js, flip whatever comes out until it
     * faces the inside of the hall. */
    const normal = new THREE.Vector3().crossVectors(right, up).normalize();
    if (normal.dot(HALL_CENTRE.clone().sub(center)) < 0) normal.negate();

    const cols = Math.min(spec.cols, MASK_COLS - 2);
    const rows = Math.min(spec.rows, MASK_ROWS - 2);

    /* Which panes survived. A flat coin toss gives an even sprinkle that
     * reads as noise; modulating it with a smooth field makes the gaps clump
     * the way real breakage does — one impact takes out its neighbours. */
    const rng = makeRng(spec.seed);
    const mask = new Uint8Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const clump = noise2(c * 0.9 + spec.seed * 0.013, r * 0.9);
        const p = clamp(spec.intact + (clump - 0.5) * 0.75, 0.02, 0.98);
        mask[r * cols + c] = rng() < p ? 1 : 0;
      }
    }

    return {
      ...spec,
      index,
      center,
      right,
      up,
      normal,
      halfW: right.length(),
      halfH: up.length(),
      rightDir: right.clone().normalize(),
      upDir: up.clone().normalize(),
      cols,
      rows,
      mask,
      /* Where this opening's block sits in the atlas, in UV. The +1 skips the
       * padding ring. */
      maskOffset: new THREE.Vector2(
        (index * MASK_COLS + 1) / (MASK_COLS * OPENINGS.length),
        1 / MASK_ROWS,
      ),
      maskScale: new THREE.Vector2(
        cols / (MASK_COLS * OPENINGS.length),
        rows / MASK_ROWS,
      ),
    };
  }

  _bakeAtlas() {
    const w = MASK_COLS * this.list.length;
    const h = MASK_ROWS;
    // Default is "glass everywhere", so the padding ring blocks light and the
    // shafts fade out at the frame instead of ending on a hard line.
    const data = new Uint8Array(w * h).fill(255);

    for (const o of this.list) {
      for (let r = 0; r < o.rows; r++) {
        for (let c = 0; c < o.cols; c++) {
          const x = o.index * MASK_COLS + 1 + c;
          const y = 1 + r;
          data[y * w + x] = o.mask[r * o.cols + c] ? 255 : 0;
        }
      }
    }

    const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat);
    tex.unpackAlignment = 1;         // the atlas is 100 texels wide, not 4-aligned
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  /** World transform of one pane, for the instanced glass and its frame. */
  paneMatrix(o, col, row, inset = 0, thickness = 1) {
    const u = (col + 0.5) / o.cols * 2 - 1;    // -1..1 across the opening
    const v = (row + 0.5) / o.rows * 2 - 1;
    const pos = o.center.clone()
      .addScaledVector(o.right, u)
      .addScaledVector(o.up, v)
      .addScaledVector(o.normal, inset);

    const m = new THREE.Matrix4();
    m.makeBasis(o.rightDir, o.upDir, o.normal);
    m.setPosition(pos);
    m.scale(new THREE.Vector3(
      (o.halfW * 2) / o.cols,
      (o.halfH * 2) / o.rows,
      thickness,
    ));
    return m;
  }

  /** Flat arrays for the dust shader, which needs every opening at once. */
  uniformArrays() {
    const centers = [], rights = [], ups = [], normals = [], masks = [];
    for (const o of this.list) {
      centers.push(o.center.clone());
      rights.push(o.right.clone());
      ups.push(o.up.clone());
      normals.push(o.normal.clone());
      masks.push(new THREE.Vector4(o.maskOffset.x, o.maskOffset.y, o.maskScale.x, o.maskScale.y));
    }
    return { centers, rights, ups, normals, masks, count: this.list.length };
  }
}
