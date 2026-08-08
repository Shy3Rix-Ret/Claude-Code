/**
 * What came afterwards.
 *
 * Everything green in the hall is built out of four instanced meshes — leaf
 * cards, woody segments, moss quads, glowing pods — which keeps a couple of
 * hundred thousand triangles inside a handful of draw calls, and more
 * importantly keeps them all inside the alpha-tested shadow pass so the light
 * through the windows comes out dappled instead of clean.
 *
 * Placement is not uniform. `growth()` scores a spot by how close it is to the
 * floor under an opening, because that is the only place in this building
 * where anything could photosynthesise. The plants are not decorating the
 * station; they are following the light, and the shape they make is the shape
 * the broken windows drew for them.
 */

import * as THREE from 'three';
import { HALL, FLORA, PALETTE } from './config.js';
import { makeRng, range, lerp, saturate, smoothstep, noise2 } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Matrix that puts a unit Y-cylinder from `a` to `b` with radius `r`. */
function segment(a, b, r) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 1e-4;
  dir.divideScalar(len);

  return new THREE.Matrix4().compose(
    new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(UP, dir),
    new THREE.Vector3(r, len, r),
  );
}

/** Matrix for a leaf card: stem at the given point, facing a random way. */
function leafAt(point, rng, size, tilt = 0.9) {
  const q = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(
      range(rng, -tilt, tilt),
      rng() * Math.PI * 2,
      range(rng, -tilt, tilt) * 0.6,
      'YXZ',
    ));
  const s = size * range(rng, 0.7, 1.35);
  return new THREE.Matrix4().compose(point, q, new THREE.Vector3(s, s, s));
}

/**
 * A blade in a ground tuft: pick a compass bearing, then lean away from the
 * centre by that much. Fully random orientation — which is what leafAt does —
 * makes ground cover look like leaves that have fallen off something, not
 * like something growing.
 */
function bladeAt(point, rng, size, lean) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    range(rng, lean * 0.35, lean),   // away from vertical
    rng() * Math.PI * 2,             // which way
    range(rng, -0.25, 0.25),
    'YXZ',
  ));
  const s = size * range(rng, 0.65, 1.4);
  return new THREE.Matrix4().compose(point, q, new THREE.Vector3(s, s, s));
}

export class Flora {
  constructor(scene, mats, openings, station, quality) {
    this.mats = mats;
    this.openings = openings;
    this.station = station;
    this.density = quality.foliage;

    this.root = new THREE.Group();
    this.root.name = 'flora';
    scene.add(this.root);

    /* Where the light lands. Wall openings project their patch of floor out
     * into the room; ceiling openings drop it straight down. */
    this.sunSpots = openings.list.map((o) => {
      const p = o.center.clone();
      if (o.kind === 'wall') p.addScaledVector(o.normal, 4.5);
      p.y = 0;
      return { p, r: Math.max(o.halfW, o.halfH) * 1.9 };
    });

    const rng = makeRng(0x2f7a11);

    this.leaves = [];
    this.woody = [];
    this.bark = [];
    this.mossQuads = [];
    this.pods = [];

    this._vines(rng);
    this._trees(rng);
    this._ground(rng);
    this._roots(rng);
    this._moss(rng);

    this._commit();
  }

  /** 0..1 — how much this square metre of floor wants to be a plant. */
  growth(x, z) {
    let best = 0;
    for (const s of this.sunSpots) {
      const d = Math.hypot(x - s.p.x, z - s.p.z);
      best = Math.max(best, Math.exp(-(d * d) / (s.r * s.r * 1.5)));
    }
    // A little everywhere, in the damp — but the light is what matters.
    const damp = smoothstep(0.45, 0.8, noise2(x * 0.06 + 12, z * 0.06));
    return saturate(best * 0.95 + damp * 0.22);
  }

  /* -------------------------------------------------------------- vines */

  _vines(rng) {
    const { halfWidth: HW, halfLength: HL, height: H, bay } = HALL;

    for (let z = -HL + bay / 2; z < HL; z += bay) {
      for (const x of [-HW + 0.45, HW - 0.45]) {
        const vigour = this.growth(x, z);
        const count = Math.round(FLORA.vinesPerBay * this.density * (0.35 + vigour));

        for (let v = 0; v < count; v++) {
          const top = lerp(2.5, H - 0.6, saturate(vigour * 1.1 + rng() * 0.35));
          const turns = range(rng, 1.1, 2.6);
          const radius = range(rng, 0.44, 0.62);
          const phase = rng() * Math.PI * 2;
          const segs = 22;

          let prev = null;
          for (let i = 0; i <= segs; i++) {
            const t = i / segs;
            const a = phase + t * turns * Math.PI * 2;
            const y = t * top;
            // Wobble so it does not read as a machined helix.
            const wob = noise2(t * 6 + v * 3.1, z * 0.2) - 0.5;
            const p = new THREE.Vector3(
              x + Math.cos(a) * radius * (1 + wob * 0.25),
              y,
              z + Math.sin(a) * radius * (1 + wob * 0.25),
            );
            if (prev) {
              const r = lerp(0.045, 0.014, t) * range(rng, 0.8, 1.2);
              this.woody.push(segment(prev, p, r));
              if (i % 2 === 0 && rng() < 0.85) {
                this.leaves.push(leafAt(p.clone(), rng, FLORA.leafSize * range(rng, 0.8, 1.6)));
              }
            }
            prev = p;
          }

          // Runners that gave up on the column and hang.
          if (rng() < 0.55) {
            const from = new THREE.Vector3(
              x + Math.cos(phase) * radius, top, z + Math.sin(phase) * radius);
            const drop = range(rng, 1.2, 4.0);
            let p0 = from;
            for (let i = 1; i <= 7; i++) {
              const p1 = from.clone();
              p1.y -= (drop * i) / 7;
              p1.x += Math.sin(i * 0.9 + phase) * 0.22;
              p1.z += Math.cos(i * 0.7 + phase) * 0.22;
              this.woody.push(segment(p0, p1, lerp(0.02, 0.008, i / 7)));
              this.leaves.push(leafAt(p1.clone(), rng, FLORA.leafSize * 1.1));
              p0 = p1;
            }
          }
        }
      }
    }
  }

  /* -------------------------------------------------------------- trees */

  /** Recursive branching. Three of these in the whole hall — they are the
   *  silhouettes the shafts get to cut around. */
  _tree(origin, rng, scale) {
    const grow = (from, dir, len, rad, depth) => {
      const to = from.clone().addScaledVector(dir, len);
      this.bark.push(segment(from, to, rad));

      if (depth <= 0 || rad < 0.035) {
        // A tuft at the tip.
        const n = 5 + ((rng() * 6) | 0);
        for (let i = 0; i < n; i++) {
          const p = to.clone().add(new THREE.Vector3(
            range(rng, -0.35, 0.35), range(rng, -0.25, 0.35), range(rng, -0.35, 0.35),
          ));
          this.leaves.push(leafAt(p, rng, FLORA.leafSize * range(rng, 1.1, 2.0)));
        }
        if (rng() < 0.25) {
          this.pods.push(new THREE.Matrix4().compose(
            to.clone(),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1).multiplyScalar(range(rng, 0.05, 0.11)),
          ));
        }
        return;
      }

      const branches = rng() < 0.22 ? 3 : 2;
      for (let i = 0; i < branches; i++) {
        const next = dir.clone();
        // Bias every branch back toward the light it can see.
        const lean = new THREE.Vector3(
          range(rng, -1, 1), range(rng, 0.25, 1.0), range(rng, -1, 1),
        ).normalize();
        next.lerp(lean, range(rng, 0.35, 0.62)).normalize();
        grow(to, next, len * range(rng, 0.62, 0.82), rad * range(rng, 0.58, 0.72), depth - 1);
      }
    };

    grow(origin.clone(), new THREE.Vector3(range(rng, -0.15, 0.15), 1, range(rng, -0.15, 0.15)).normalize(),
      2.4 * scale, 0.34 * scale, 5);

    this.station.collider(origin.x, 1.4, origin.z, 0.9 * scale, 2.8, 0.9 * scale);
  }

  _trees(rng) {
    // Under the breach, under the middle skylight, and one that has come up
    // through the floor at the far end of the concourse.
    const trees = [
      { at: new THREE.Vector3(-1.5, 0, 31), scale: 1.35 },
      { at: new THREE.Vector3(2.0, 0, 3.5), scale: 1.0 },
      { at: new THREE.Vector3(-4.5, 0, -20), scale: 0.75 },
    ];
    for (const t of trees) this._tree(t.at, rng, t.scale);
  }

  /* ------------------------------------------------------------- ground */

  _ground(rng) {
    const { halfWidth: HW, halfLength: HL } = HALL;
    const target = Math.round(FLORA.groundTufts * this.density);

    let placed = 0, attempts = 0;
    while (placed < target && attempts < target * 14) {
      attempts++;
      const x = range(rng, -HW + 0.8, HW - 0.8);
      const z = range(rng, -HL + 1.5, HL - 1.5);
      const g = this.growth(x, z);
      if (rng() > g) continue;

      const base = new THREE.Vector3(x, 0.02, z);
      const blades = 5 + ((rng() * 7) | 0);
      for (let i = 0; i < blades; i++) {
        const p = base.clone().add(new THREE.Vector3(
          range(rng, -0.25, 0.25), range(rng, 0, 0.12), range(rng, -0.25, 0.25)));
        this.leaves.push(bladeAt(p, rng, FLORA.leafSize * range(rng, 0.8, 1.6), 0.95));
      }

      // The bioluminescent ones only bother where it is properly damp.
      if (rng() < 0.05 + g * 0.07) {
        const n = 2 + ((rng() * 3) | 0);
        for (let i = 0; i < n; i++) {
          this.pods.push(new THREE.Matrix4().compose(
            base.clone().add(new THREE.Vector3(
              range(rng, -0.3, 0.3), range(rng, 0.04, 0.3), range(rng, -0.3, 0.3))),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1).multiplyScalar(range(rng, 0.025, 0.055)),
          ));
        }
      }
      placed++;
    }
  }

  /* -------------------------------------------------------------- roots */

  /** Roots coming through the ceiling around the skylights — the plants above
   *  are looking for the same water everything else down here found. */
  _roots(rng) {
    const count = Math.round(FLORA.ceilingRoots * this.density);
    const ceilings = this.openings.list.filter((o) => o.kind === 'ceiling');
    if (ceilings.length === 0) return;

    for (let i = 0; i < count; i++) {
      const o = ceilings[(rng() * ceilings.length) | 0];
      const p = o.center.clone()
        .addScaledVector(o.right, range(rng, -1.5, 1.5))
        .addScaledVector(o.up, range(rng, -1.5, 1.5));
      p.y = Math.min(p.y, HALL.height - 0.05);

      const drop = range(rng, 0.6, 5.5);
      const segs = 5;
      let a = p.clone();
      for (let s = 1; s <= segs; s++) {
        const b = p.clone();
        b.y -= (drop * s) / segs;
        b.x += Math.sin(s * 1.3 + i) * 0.18 * s / segs;
        b.z += Math.cos(s * 0.9 + i) * 0.18 * s / segs;
        this.woody.push(segment(a, b, lerp(0.03, 0.006, s / segs)));
        if (s > 2 && rng() < 0.5) {
          this.leaves.push(leafAt(b.clone(), rng, FLORA.leafSize * 0.9));
        }
        a = b;
      }
    }
  }

  /* --------------------------------------------------------------- moss */

  _moss(rng) {
    const { halfWidth: HW, halfLength: HL } = HALL;
    const count = Math.round(FLORA.moss * this.density);

    for (let i = 0; i < count; i++) {
      const x = range(rng, -HW + 0.5, HW - 0.5);
      const z = range(rng, -HL + 1, HL - 1);
      const g = this.growth(x, z);
      if (rng() > g * 1.3) continue;

      const s = range(rng, 0.9, 3.4);
      this.mossQuads.push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0.015 + rng() * 0.006, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rng() * Math.PI * 2)),
        new THREE.Vector3(s, s * range(rng, 0.7, 1.3), 1),
      ));
    }

    // And up the lower two metres of both walls, where the damp sits. Small:
    // a big quad here is a green sticker, however irregular its outline.
    for (let i = 0; i < count * 0.9; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const z = range(rng, -HL + 1, HL - 1);
      const y = range(rng, 0.1, 2.6);
      const s = range(rng, 0.5, 1.5);
      this.mossQuads.push(new THREE.Matrix4().compose(
        new THREE.Vector3(side * (HALL.halfWidth - 0.06), y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * -Math.PI / 2, rng() * Math.PI * 2)),
        new THREE.Vector3(s, s, 1),
      ));
    }
  }

  /* ------------------------------------------------------------- commit */

  _commit() {
    const M = this.mats;
    const rng = makeRng(0x77aa31);

    // Leaf card: stem at y = 0, because the wind shader levers off local y.
    const leafGeo = new THREE.PlaneGeometry(1, 1);
    leafGeo.translate(0, 0.5, 0);

    const add = (geo, mat, matrices, opts = {}) => {
      if (!matrices.length) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = opts.cast !== false;
      mesh.receiveShadow = opts.receive !== false;
      this.root.add(mesh);
      return mesh;
    };

    this.leafMesh = add(leafGeo, M.foliage, this.leaves);
    if (this.leafMesh) {
      /* Per-instance tint. Without it five thousand copies of one card read as
       * wallpaper; with it they read as a population. */
      const c = new THREE.Color();
      const pale = new THREE.Color(PALETTE.leafPale);
      const dark = new THREE.Color(PALETTE.leafDark);
      const dead = new THREE.Color(0x8a7742);
      for (let i = 0; i < this.leaves.length; i++) {
        const t = rng();
        c.copy(dark).lerp(pale, 0.12 + t * 0.72);
        if (rng() < 0.07) c.lerp(dead, range(rng, 0.3, 0.8));
        this.leafMesh.setColorAt(i, c);
      }
      if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
    }

    const stem = new THREE.CylinderGeometry(0.75, 1, 1, 5, 1);
    this.vineMesh = add(stem, M.vine, this.woody);

    const trunk = new THREE.CylinderGeometry(0.72, 1, 1, 7, 1);
    this.barkMesh = add(trunk, M.bark, this.bark);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.mossMesh = add(quad, M.moss, this.mossQuads, { cast: false });

    // Pods do not cast. They are the light source at night, not an occluder.
    this.podMesh = add(new THREE.IcosahedronGeometry(1, 0), M.pod, this.pods,
      { cast: false, receive: false });

    this.counts = {
      leaves: this.leaves.length,
      woody: this.woody.length,
      bark: this.bark.length,
      moss: this.mossQuads.length,
      pods: this.pods.length,
    };

    // The build arrays were only scaffolding; the GPU has them now.
    this.leaves = this.woody = this.bark = this.mossQuads = this.pods = null;
  }
}
