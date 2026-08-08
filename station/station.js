/**
 * The building itself: one departure hall, 84 metres of it, and everything
 * that was left in it.
 *
 * Walls are not single quads. Each one is subdivided around its openings so
 * the holes are real holes — light goes through them, the hull around them
 * casts a hard shadow, and the player cannot walk through the wall between.
 * That subdivision is the only clever thing in this file; the rest is
 * carpentry.
 *
 * Collision is a flat list of axis-aligned boxes, collected as things are
 * built. player.js resolves against it. Anything the player should be able to
 * stand on — the mezzanine deck, a bench, a crate — is in the same list.
 */

import * as THREE from 'three';
import { HALL, PALETTE } from './config.js';
import { makeRng, range, lerp, clamp } from './util.js';
import { departureBoard, gateSign, starfield, planetSurface } from './textures.js';

/* ------------------------------------------------------------ geometry aid */

/** Scale a geometry's UVs so the texture tiles in world units, not per-face.
 *  It saves cloning the same texture at six different repeats. */
function scaleUV(geo, sx, sy) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  uv.needsUpdate = true;
  return geo;
}

const TILE = 0.34;   // texture repeats per metre, the house scale

const plane = (w, h, tiles = TILE) => scaleUV(new THREE.PlaneGeometry(w, h), w * tiles, h * tiles);
/** A plane whose UVs are left alone — for anything showing one whole image,
 *  like a sign. Running these through `plane` tiles the artwork instead. */
const quad = (w, h) => new THREE.PlaneGeometry(w, h);
const boxg = (w, h, d, tiles = TILE) =>
  scaleUV(new THREE.BoxGeometry(w, h, d), Math.max(w, d) * tiles, h * tiles);

/**
 * A rectangle with rectangular holes cut out of it, returned as a list of
 * sub-rectangles that cover everything except the holes. Coordinates are
 * centred: u and v run from -w/2..w/2 and -h/2..h/2.
 *
 * Holes that overlap along v are collected into one band and cut side by side
 * — that is the case that matters, because the five clerestory windows sit at
 * exactly the same height. Holes sharing a band are assumed to share its full
 * v range, which every opening in this station does.
 */
function subdivide(w, h, holes) {
  if (holes.length === 0) return [{ u: 0, v: 0, w, h }];

  const bands = [];
  for (const hole of holes.slice().sort((a, b) => (a.v - a.h / 2) - (b.v - b.h / 2))) {
    const v0 = hole.v - hole.h / 2;
    const v1 = hole.v + hole.h / 2;
    const last = bands[bands.length - 1];
    if (last && v0 < last.v1 - 1e-6) {
      last.v0 = Math.min(last.v0, v0);
      last.v1 = Math.max(last.v1, v1);
      last.holes.push(hole);
    } else {
      bands.push({ v0, v1, holes: [hole] });
    }
  }

  const out = [];
  let cursor = -h / 2;

  for (const band of bands) {
    const v0 = clamp(band.v0, -h / 2, h / 2);
    const v1 = clamp(band.v1, -h / 2, h / 2);
    if (v1 <= cursor) continue;

    if (v0 > cursor) out.push({ u: 0, v: (cursor + v0) / 2, w, h: v0 - cursor });

    let x = -w / 2;
    for (const hole of band.holes.slice().sort((a, b) => a.u - b.u)) {
      const u0 = clamp(hole.u - hole.w / 2, -w / 2, w / 2);
      const u1 = clamp(hole.u + hole.w / 2, -w / 2, w / 2);
      if (u0 > x) out.push({ u: (x + u0) / 2, v: (v0 + v1) / 2, w: u0 - x, h: v1 - v0 });
      x = Math.max(x, u1);
    }
    if (x < w / 2) out.push({ u: (x + w / 2) / 2, v: (v0 + v1) / 2, w: w / 2 - x, h: v1 - v0 });

    cursor = v1;
  }
  if (cursor < h / 2) out.push({ u: 0, v: (cursor + h / 2) / 2, w, h: h / 2 - cursor });

  return out.filter((r) => r.w > 0.001 && r.h > 0.001);
}

/* -------------------------------------------------------------- the build */

export class Station {
  constructor(scene, mats, openings, quality) {
    this.scene = scene;
    this.mats = mats;
    this.openings = openings;
    this.quality = quality;

    this.root = new THREE.Group();
    this.root.name = 'station';
    scene.add(this.root);

    this.colliders = [];      // {min: Vector3, max: Vector3}
    this.lights = [];         // point lights that respond to the day cycle

    const rng = makeRng(0x9c31);

    this._shell();
    this._structure(rng);
    this._windows(rng);
    this._mezzanine();
    this._gates();
    this._props(rng);
    this._rubble(rng);
    this._strips();
    this._outside();
  }

  /* ------------------------------------------------------------- helpers */

  add(mesh, { cast = true, receive = true } = {}) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.root.add(mesh);
    return mesh;
  }

  collider(cx, cy, cz, w, h, d) {
    this.colliders.push({
      min: new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
    });
  }

  /** InstancedMesh from a list of Matrix4. Cheaper than a mesh per rivet. */
  instance(geo, mat, matrices, opts = {}) {
    if (matrices.length === 0) return null;
    const m = new THREE.InstancedMesh(geo, mat, matrices.length);
    matrices.forEach((mat4, i) => m.setMatrixAt(i, mat4));
    m.instanceMatrix.needsUpdate = true;
    if (opts.colors) {
      opts.colors.forEach((c, i) => m.setColorAt(i, c));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    m.frustumCulled = opts.frustumCulled !== false;
    this.root.add(m);
    return m;
  }

  /* --------------------------------------------------------------- shell */

  _shell() {
    const { halfWidth: HW, halfLength: HL, height: H } = HALL;
    const M = this.mats;

    // ---- floor ----
    const floor = new THREE.Mesh(plane(HW * 2, HL * 2, 0.22), M.floor);
    floor.rotation.x = -Math.PI / 2;
    this.add(floor, { cast: false });

    // ---- ceiling, with the skylights and the breach cut out ----
    const ceilingHoles = this.openings.list
      .filter((o) => o.kind === 'ceiling')
      .map((o) => ({
        // ceiling plane is parameterised (u = x, v = z)
        u: o.center.x, v: o.center.z,
        w: o.halfW * 2 + 0.25, h: o.halfH * 2 + 0.25,
      }));

    for (const r of subdivide(HW * 2, HL * 2, ceilingHoles)) {
      const m = new THREE.Mesh(plane(r.w, r.h, 0.28), M.metal);
      m.rotation.x = Math.PI / 2;          // facing down
      m.position.set(r.u, H, r.v);
      this.add(m);
    }

    /* ---- west wall (-X), carrying the clerestory ----
     * Wall coordinates are centred on the wall, so a window at y = 9 in a
     * 13 m wall sits at v = 2.5. Getting that offset wrong puts the holes in
     * the floor and is invisible until the light arrives. */
    const westHoles = this.openings.list
      .filter((o) => o.id.startsWith('clerestory'))
      .map((o) => ({
        u: o.center.z, v: o.center.y - H / 2,
        w: o.halfW * 2 + 0.2, h: o.halfH * 2 + 0.2,
      }));

    for (const r of subdivide(HL * 2, H, westHoles)) {
      const m = new THREE.Mesh(plane(r.w, r.h), M.metal);
      m.rotation.y = Math.PI / 2;
      m.position.set(-HW, r.v + H / 2, r.u);
      this.add(m);
    }

    // ---- east wall (+X), carrying the gate doorways ----
    this.gateDoors = [-24, -8, 8, 24].map((z, i) => ({
      z, i, label: `C${i + 1}`, width: 4.2, height: 5.0, sill: 0,
    }));
    const eastHoles = this.gateDoors.map((g) => ({
      u: g.z, v: g.height / 2 - H / 2, w: g.width, h: g.height,
    }));

    for (const r of subdivide(HL * 2, H, eastHoles)) {
      const m = new THREE.Mesh(plane(r.w, r.h), M.metal);
      m.rotation.y = -Math.PI / 2;
      m.position.set(HW, r.v + H / 2, r.u);
      this.add(m);
    }

    // ---- north end (-Z): the panorama window ----
    const pano = this.openings.list.find((o) => o.id === 'panorama');
    const northHoles = [{
      u: pano.center.x, v: pano.center.y - H / 2,
      w: pano.halfW * 2 + 0.3, h: pano.halfH * 2 + 0.3,
    }];
    for (const r of subdivide(HW * 2, H, northHoles)) {
      const m = new THREE.Mesh(plane(r.w, r.h), M.metal);
      m.position.set(r.u, r.v + H / 2, -HL);
      this.add(m);
    }

    // ---- south end (+Z): sealed, and the rust has had it ----
    const south = new THREE.Mesh(plane(HW * 2, H), M.rust);
    south.rotation.y = Math.PI;
    south.position.set(0, H / 2, HL);
    this.add(south);

    // ---- containment ----
    const t = 1.0;
    this.collider(-HW - t / 2, H / 2, 0, t, H, HL * 2 + t);
    this.collider(HW + t / 2, H / 2, 0, t, H, HL * 2 + t);
    this.collider(0, H / 2, -HL - t / 2, HW * 2 + t, H, t);
    this.collider(0, H / 2, HL + t / 2, HW * 2 + t, H, t);
  }

  /* ----------------------------------------------------------- structure */

  _structure(rng) {
    const { halfWidth: HW, halfLength: HL, height: H, bay } = HALL;
    const M = this.mats;

    const columnGeo = boxg(0.7, H, 0.9);
    const braceGeo = boxg(HW * 2 - 1.4, 0.55, 0.75);
    const columns = [], braces = [];

    for (let z = -HL + bay / 2; z < HL; z += bay) {
      for (const x of [-HW + 0.45, HW - 0.45]) {
        const m = new THREE.Matrix4().makeTranslation(x, H / 2, z);
        columns.push(m);
        this.collider(x, H / 2, z, 0.7, H, 0.9);
      }
      // The roof brace: the piece that is holding the ceiling up, mostly.
      braces.push(new THREE.Matrix4().makeTranslation(0, H - 0.4, z));
    }

    this.instance(columnGeo, M.rust, columns);
    this.instance(braceGeo, M.rust, braces);

    // Service runs: conduit along both walls, high and low.
    const pipeGeo = new THREE.CylinderGeometry(0.13, 0.13, HL * 2 - 1, 8, 1, true);
    scaleUV(pipeGeo, 1, HL * 0.5);
    const pipes = [];
    for (const x of [-HW + 0.55, HW - 0.55]) {
      for (const y of [11.4, 11.0, 1.35]) {
        const m = new THREE.Matrix4()
          .makeRotationX(Math.PI / 2)
          .setPosition(x + (rng() - 0.5) * 0.1, y, 0);
        pipes.push(m);
      }
    }
    this.instance(pipeGeo, M.rust, pipes);

    // A duct that has come loose over the middle of the hall and hangs.
    const duct = new THREE.Mesh(boxg(1.1, 0.9, 9), M.rust);
    duct.position.set(-3.4, H - 1.4, -12);
    duct.rotation.z = 0.06;
    duct.rotation.x = -0.09;
    this.add(duct);

    const dangling = new THREE.Mesh(boxg(1.1, 0.9, 4.5), M.rust);
    dangling.position.set(-3.6, H - 3.3, -6.2);
    dangling.rotation.x = -0.62;
    this.add(dangling);
  }

  /* ------------------------------------------------------------- windows */

  _windows(rng) {
    const M = this.mats;
    const paneGeo = new THREE.PlaneGeometry(1, 1);
    const mullionGeo = boxg(1, 1, 1, 1.0);

    const panes = [];
    const mullions = [];
    const shards = [];

    for (const o of this.openings.list) {
      // --- glass still in its frame ---
      for (let r = 0; r < o.rows; r++) {
        for (let c = 0; c < o.cols; c++) {
          if (!o.mask[r * o.cols + c]) continue;
          panes.push(this.openings.paneMatrix(o, c, r, 0.0, 0.94));
        }
      }

      // --- the frame: outer rim plus the grid between panes ---
      const cw = (o.halfW * 2) / o.cols;
      const ch = (o.halfH * 2) / o.rows;
      const basis = new THREE.Matrix4().makeBasis(o.rightDir, o.upDir, o.normal);

      const bar = (u, v, w, h) => {
        const m = basis.clone();
        m.setPosition(
          o.center.clone().addScaledVector(o.right, u).addScaledVector(o.up, v),
        );
        m.scale(new THREE.Vector3(w, h, 0.22));
        mullions.push(m);
      };

      for (let c = 1; c < o.cols; c++) bar((c / o.cols) * 2 - 1, 0, 0.085, o.halfH * 2);
      for (let r = 1; r < o.rows; r++) bar(0, (r / o.rows) * 2 - 1, o.halfW * 2, 0.085);
      bar(-1, 0, 0.28, o.halfH * 2 + 0.28);
      bar(1, 0, 0.28, o.halfH * 2 + 0.28);
      bar(0, -1, o.halfW * 2 + 0.28, 0.28);
      bar(0, 1, o.halfW * 2 + 0.28, 0.28);

      // --- what fell out of it, on the floor underneath ---
      if (o.kind === 'wall' && o.center.y > 3) {
        const drop = 6 + rng() * 10;
        for (let i = 0; i < drop; i++) {
          const along = (rng() - 0.5) * 2;
          const p = o.center.clone()
            .addScaledVector(o.right, along)
            .addScaledVector(o.normal, 0.4 + rng() * 2.6);
          const m = new THREE.Matrix4()
            .makeRotationY(rng() * Math.PI)
            .premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
          m.setPosition(p.x, 0.012, p.z);
          m.scale(new THREE.Vector3(range(rng, 0.12, 0.4), range(rng, 0.12, 0.4), 1));
          shards.push(m);
        }
      }
    }

    /* Every pane carries the same grime texture, so without a per-instance
     * tint a window reads as one image repeated forty times. */
    const tint = new THREE.Color();
    const paneColors = panes.map(() => tint.setHSL(
      0.38 + rng() * 0.12,
      0.05 + rng() * 0.12,
      0.55 + rng() * 0.35,
    ).clone());

    this.instance(paneGeo, M.glass, panes, { receive: false, colors: paneColors });
    this.instance(mullionGeo, M.rust, mullions);
    // Shards do not cast — a hundred shadow-casting slivers costs more than
    // it shows, and they are lying flat on the floor anyway.
    this.instance(paneGeo, M.glass, shards, { cast: false, receive: false });
  }

  /* ---------------------------------------------------------- mezzanine */

  _mezzanine() {
    const M = this.mats;
    const Z = HALL.mezzanine;
    const deckY = Z.y;
    const w = HALL.halfWidth - Z.xInner;
    const cx = (Z.xInner + HALL.halfWidth) / 2;

    // Two spans of deck with a gap where the plate came down.
    const spans = [[Z.zFrom, Z.collapseFrom], [Z.collapseTo, Z.zTo]];
    for (const [z0, z1] of spans) {
      const d = z1 - z0;
      const deck = new THREE.Mesh(boxg(w, 0.35, d, 0.3), M.metal);
      deck.position.set(cx, deckY, (z0 + z1) / 2);
      this.add(deck);
      this.collider(cx, deckY, (z0 + z1) / 2, w, 0.35, d);

      // Railing: posts every 1.6 m plus two rails.
      const posts = [];
      for (let z = z0 + 0.8; z < z1; z += 1.6) {
        posts.push(new THREE.Matrix4().makeTranslation(Z.xInner + 0.12, deckY + 0.75, z));
      }
      this.instance(boxg(0.07, 1.2, 0.07, 1), M.rust, posts);

      for (const y of [deckY + 1.28, deckY + 0.66]) {
        const rail = new THREE.Mesh(boxg(0.09, 0.09, d, 1), M.rust);
        rail.position.set(Z.xInner + 0.12, y, (z0 + z1) / 2);
        this.add(rail);
      }
    }

    // The fallen plate, still hinged on one edge, leaning into the hall.
    const fallen = new THREE.Mesh(boxg(w, 0.3, Z.collapseTo - Z.collapseFrom, 0.3), M.rust);
    fallen.position.set(cx - 0.6, deckY - 2.4, (Z.collapseFrom + Z.collapseTo) / 2);
    fallen.rotation.z = 0.72;
    fallen.rotation.x = 0.1;
    this.add(fallen);

    /* Stairs up from the hall floor at the north end of the walkway. The
     * collider under each tread is a solid block from the floor up, not a
     * floating slab — otherwise the player drops through the gaps between
     * treads and the climb turns into a stutter. */
    const steps = [];
    const stepN = 22;
    for (let i = 0; i < stepN; i++) {
      const y = ((i + 1) / stepN) * deckY;
      const z = Z.zFrom - 0.5 - i * 0.45;
      steps.push(new THREE.Matrix4().makeTranslation(cx + 1.2, y - 0.09, z));
      this.collider(cx + 1.2, y / 2, z, 3.0, y, 0.45);
    }
    this.instance(boxg(3.0, 0.18, 0.45, 0.8), M.rust, steps);

  }

  /* -------------------------------------------------------------- gates */

  _gates() {
    const M = this.mats;
    const HW = HALL.halfWidth;

    for (const g of this.gateDoors) {
      // A short dead corridor behind the doorway. It goes nowhere; it only has
      // to be dark and have a rim of light around the airlock.
      const depth = 6.5;
      const corridor = new THREE.Group();
      corridor.position.set(HW + depth / 2, g.height / 2, g.z);
      this.root.add(corridor);

      const shellMat = M.rust;
      const mk = (geo, x, y, z, rx = 0, ry = 0) => {
        const m = new THREE.Mesh(geo, shellMat);
        m.position.set(x, y, z);
        m.rotation.set(rx, ry, 0);
        m.castShadow = true;
        m.receiveShadow = true;
        corridor.add(m);
        return m;
      };
      mk(plane(depth, g.height), 0, 0, -g.width / 2, 0, 0);
      mk(plane(depth, g.height), 0, 0, g.width / 2, 0, Math.PI);
      mk(plane(depth, g.width), 0, g.height / 2, 0, Math.PI / 2, 0);
      mk(plane(depth, g.width), 0, -g.height / 2, 0, -Math.PI / 2, 0);

      // The airlock at the far end: a ring, and a hatch that is either shut or
      // has been forced. Two of the four are open, which is enough to suggest
      // that someone left in a hurry and two others never got the chance.
      const open = g.i === 1 || g.i === 3;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5, 0.28, 8, 24),
        M.rust,
      );
      ring.position.set(depth / 2 - 0.3, 0, 0);
      ring.rotation.y = Math.PI / 2;
      ring.castShadow = true;
      corridor.add(ring);

      const hatch = new THREE.Mesh(
        new THREE.CylinderGeometry(1.45, 1.45, 0.22, 24),
        M.metal,
      );
      hatch.rotation.z = Math.PI / 2;
      if (open) {
        hatch.position.set(depth / 2 - 0.5, -0.4, 1.9);
        hatch.rotation.x = 1.15;
      } else {
        hatch.position.set(depth / 2 - 0.45, 0, 0);
      }
      hatch.castShadow = true;
      corridor.add(hatch);

      if (!open) {
        this.collider(HW + depth - 0.5, g.height / 2, g.z, 0.6, g.height, g.width);
      } else {
        // Beyond the open hatch: nothing. A faint cold rim so it is not a
        // black rectangle painted on the wall.
        const void_ = new THREE.Mesh(
          new THREE.CircleGeometry(1.45, 24),
          new THREE.MeshBasicMaterial({ color: 0x0a1418, fog: false }),
        );
        void_.position.set(HW + depth - 0.2, g.height / 2, g.z);
        void_.rotation.y = -Math.PI / 2;
        this.root.add(void_);
        this.collider(HW + depth + 0.2, g.height / 2, g.z, 0.6, g.height, g.width);
      }

      // Doorway walls so the player cannot walk through the jambs.
      this.collider(HW, g.height / 2, g.z - g.width / 2 - 0.4, 1.2, g.height, 0.8);
      this.collider(HW, g.height / 2, g.z + g.width / 2 + 0.4, 1.2, g.height, 0.8);

      // Sign over the door.
      const signMat = M.sign.clone();
      signMat.map = gateSign(g.label, ['CERES', 'THEMIS', 'HYGIEA', 'PALLAS'][g.i]);
      signMat.emissive = new THREE.Color(0xffffff);
      signMat.emissiveMap = signMat.map;
      signMat.emissiveIntensity = 0.05;
      const sign = new THREE.Mesh(quad(2.2, 1.1), signMat);
      sign.position.set(HW - 0.12, g.height + 1.1, g.z);
      sign.rotation.y = -Math.PI / 2;
      this.add(sign, { cast: false });
    }
  }

  /* -------------------------------------------------------------- props */

  _props(rng) {
    const M = this.mats;

    /* ---- rows of seating ---- */
    const seats = [], backs = [], legs = [], armrests = [];
    const rows = [
      { x: 7.2, zs: [-2, 4, 10, 16], rot: -Math.PI / 2 },
      { x: -6.5, zs: [-16, -10, 14, 20], rot: Math.PI / 2 },
    ];
    for (const row of rows) {
      for (const z of row.zs) {
        const yaw = row.rot + range(rng, -0.05, 0.05);
        const px = row.x + range(rng, -0.25, 0.25);
        const base = new THREE.Matrix4().makeRotationY(yaw);

        const put = (arr, ox, oy, oz, sx, sy, sz) => {
          const m = base.clone();
          const off = new THREE.Vector3(ox, oy, oz).applyMatrix4(base);
          m.setPosition(px + off.x, oy, z + off.z);
          m.scale(new THREE.Vector3(sx, sy, sz));
          arr.push(m);
        };

        put(seats, 0, 0.46, 0, 4.4, 0.12, 0.62);
        put(backs, 0, 0.78, -0.28, 4.4, 0.5, 0.09);
        for (const o of [-1.9, 0, 1.9]) put(legs, o, 0.23, 0, 0.1, 0.46, 0.5);
        for (const o of [-1.45, 0.0, 1.45]) put(armrests, o, 0.62, 0.05, 0.07, 0.32, 0.5);

        this.collider(px, 0.3, z, Math.abs(Math.cos(yaw)) * 4.4 + 0.6, 0.92,
          Math.abs(Math.sin(yaw)) * 4.4 + 0.6);
      }
    }
    this.instance(boxg(1, 1, 1, 0.5), M.metal, seats);
    this.instance(boxg(1, 1, 1, 0.5), M.metal, backs);
    this.instance(boxg(1, 1, 1, 0.5), M.rust, legs);
    this.instance(boxg(1, 1, 1, 0.5), M.rust, armrests);

    /* ---- the departure board ----
     * The shared material is written into rather than cloned: materials.js
     * drives its emissive flicker every frame, and a clone would quietly stop
     * receiving that. There is only ever one board. */
    const boardMat = M.board;
    boardMat.map = departureBoard([
      { time: '04:15', dest: 'CERES  · TRANSFER', status: 'ANNULLIERT' },
      { time: '06:40', dest: 'THEMIS · DIREKT', status: 'ANNULLIERT' },
      { time: '09:05', dest: 'HYGIEA · TRANSFER', status: 'ANNULLIERT' },
      { time: '13:20', dest: 'PALLAS · DIREKT', status: 'ANNULLIERT' },
      { time: '17:55', dest: 'ERDE   · RÜCKFLUG', status: '—' },
      { time: '—    ', dest: 'KEINE WEITEREN ABFLÜGE', status: '' },
    ]);
    boardMat.emissiveMap = boardMat.map;

    const boardFrame = new THREE.Mesh(boxg(9.4, 4.9, 0.4, 0.5), M.rust);
    boardFrame.position.set(0, 8.4, 17.6);
    boardFrame.rotation.x = 0.13;
    this.add(boardFrame);

    const boardFace = new THREE.Mesh(quad(9.0, 4.5), boardMat);
    boardFace.position.set(0, 8.4 + Math.sin(0.13) * 0.22, 17.6 - 0.22);
    boardFace.rotation.x = 0.13;
    boardFace.rotation.y = Math.PI;
    this.add(boardFace, { cast: false });

    // Hangers up to the ceiling.
    for (const x of [-3.6, 3.6]) {
      const rod = new THREE.Mesh(boxg(0.08, 4.2, 0.08, 1), M.rust);
      rod.position.set(x, 10.9, 17.4);
      this.add(rod);
    }

    /* ---- the kiosk that used to sell something ---- */
    const counter = new THREE.Mesh(boxg(5.4, 1.15, 1.5, 0.5), M.metal);
    counter.position.set(-8.2, 0.575, 10.5);
    this.add(counter);
    this.collider(-8.2, 0.575, 10.5, 5.4, 1.15, 1.5);

    const backWall = new THREE.Mesh(boxg(5.4, 2.9, 0.25, 0.5), M.rust);
    backWall.position.set(-9.6, 1.45, 10.5);
    backWall.rotation.y = Math.PI / 2;
    this.add(backWall);

    const shelf = new THREE.Mesh(boxg(4.6, 0.09, 0.5, 0.6), M.rust);
    shelf.position.set(-9.35, 1.9, 10.5);
    shelf.rotation.y = Math.PI / 2;
    this.add(shelf);

    /* ---- crates, cases, the things nobody came back for ---- */
    const crates = [], cases = [];
    const scatter = [
      [-4.2, 24], [3.1, 26.5], [-9.5, -2], [9.0, -14], [-2.4, -20],
      [6.4, -26], [-7.0, -6], [1.2, 12], [8.6, 20], [-10.2, 18],
    ];
    for (const [x, z] of scatter) {
      const n = 1 + ((rng() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const s = range(rng, 0.55, 1.05);
        const h = s * range(rng, 0.6, 1.0);
        const px = x + range(rng, -0.9, 0.9);
        const pz = z + range(rng, -0.9, 0.9);
        const m = new THREE.Matrix4()
          .makeRotationY(rng() * Math.PI)
          .setPosition(px, h / 2 + i * 0.02, pz);
        m.scale(new THREE.Vector3(s, h, s));
        crates.push(m);
        this.collider(px, h / 2, pz, s * 1.2, h, s * 1.2);
      }
    }
    this.instance(boxg(1, 1, 1, 0.7), M.rust, crates);

    // One suitcase, standing upright where it was set down.
    const suitcase = new THREE.Mesh(boxg(0.68, 0.92, 0.26, 1.2), M.metal);
    suitcase.position.set(-6.6, 0.46, -6.4);
    suitcase.rotation.y = 0.4;
    this.add(suitcase);
    this.collider(-6.6, 0.46, -6.4, 0.8, 0.92, 0.5);

    // A luggage trolley, on its side.
    const trolley = new THREE.Group();
    trolley.position.set(4.6, 0.3, -3.0);
    trolley.rotation.set(0, 0.9, Math.PI / 2 - 0.15);
    const cage = new THREE.Mesh(boxg(1.5, 1.1, 0.9, 0.8), M.rust);
    cage.castShadow = true;
    trolley.add(cage);
    for (const [ox, oz] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), M.rust);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(ox, -0.62, oz);
      wheel.castShadow = true;
      trolley.add(wheel);
    }
    this.root.add(trolley);
    this.collider(4.6, 0.4, -3.0, 1.4, 0.9, 1.6);

    /* ---- standing water ---- */
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x151f21,
      roughness: 0.11,
      metalness: 0.2,
      envMapIntensity: 1.4,
      transparent: true,
      opacity: 0.6,
    });
    this.puddleMaterial = puddleMat;
    const puddles = [];
    for (let i = 0; i < 22; i++) {
      const x = range(rng, -HALL.halfWidth + 1.5, HALL.halfWidth - 1.5);
      const z = range(rng, -HALL.halfLength + 3, HALL.halfLength - 8);
      const s = range(rng, 1.2, 4.4);
      const m = new THREE.Matrix4()
        .makeRotationX(-Math.PI / 2)
        .setPosition(x, 0.008, z);
      m.scale(new THREE.Vector3(s, s * range(rng, 0.5, 1.0), 1));
      puddles.push(m);
    }
    this.instance(new THREE.CircleGeometry(1, 18), puddleMat, puddles,
      { cast: false, receive: true });
  }

  /* ------------------------------------------------------------- rubble */

  _rubble(rng) {
    const M = this.mats;
    const z0 = HALL.rubble.zFrom;
    const chunks = [], plates = [];

    for (let i = 0; i < 130; i++) {
      const t = rng();
      const z = lerp(z0, HALL.halfLength - 0.5, Math.pow(t, 0.6));
      const spread = lerp(5.5, HALL.halfWidth, Math.pow(t, 0.5));
      const x = range(rng, -spread, spread);
      // The pile gets deeper toward the wall it came off.
      const pileH = lerp(0.25, 3.4, Math.pow(t, 1.5)) * range(rng, 0.5, 1.3);
      const s = range(rng, 0.4, 1.5);

      const m = new THREE.Matrix4()
        .makeRotationY(rng() * Math.PI)
        .premultiply(new THREE.Matrix4().makeRotationX(range(rng, -0.5, 0.5)))
        .premultiply(new THREE.Matrix4().makeRotationZ(range(rng, -0.5, 0.5)));
      m.setPosition(x, pileH * 0.4, z);
      m.scale(new THREE.Vector3(s * 1.6, s * 0.5, s * 1.4));
      chunks.push(m);

      if (i % 5 === 0) this.collider(x, pileH * 0.35, z, s * 2, pileH, s * 1.8);
    }
    this.instance(boxg(1, 1, 1, 0.8), M.floorPatch, chunks);

    // Ceiling plates that came down whole and are leaning against things.
    for (let i = 0; i < 9; i++) {
      const x = range(rng, -9, 9);
      const z = range(rng, z0 - 2, HALL.halfLength - 3);
      const m = new THREE.Matrix4()
        .makeRotationY(rng() * Math.PI)
        .premultiply(new THREE.Matrix4().makeRotationX(range(rng, 0.7, 1.35)));
      m.setPosition(x, range(rng, 0.8, 2.2), z);
      m.scale(new THREE.Vector3(range(rng, 2, 4), range(rng, 2, 3.5), 1));
      plates.push(m);
    }
    this.instance(boxg(1, 1, 0.14, 0.5), M.rust, plates);
  }

  /* ------------------------------------------------------- strip lights */

  _strips() {
    const M = this.mats;
    const strips = [];
    for (const x of [-HALL.halfWidth + 0.9, HALL.halfWidth - 0.9]) {
      for (let z = -HALL.halfLength + 6; z < HALL.halfLength - 6; z += 12) {
        strips.push(new THREE.Matrix4().makeTranslation(x, 3.1, z));
      }
    }
    this.instance(boxg(0.16, 0.1, 2.6, 1), M.strip, strips, { cast: false });

    /* Four point lights standing in for all of that emissive geometry. Any
     * more and the forward renderer starts to hurt; any fewer and the hall
     * goes properly black when the star leaves. */
    for (const [x, z, color, base] of [
      [-HALL.halfWidth + 1.2, -18, PALETTE.emergency, 1.0],
      [HALL.halfWidth - 1.2, 6, PALETTE.emergency, 1.0],
      [0, 28, PALETTE.bio, 1.6],
      [-2, -30, PALETTE.bio, 1.2],
    ]) {
      const l = new THREE.PointLight(new THREE.Color(color), 0, 26, 1.8);
      l.position.set(x, 3.2, z);
      this.root.add(l);
      this.lights.push({ light: l, base });
    }
  }

  /* ------------------------------------------------------------ outside */

  _outside() {
    // Stars. Big enough that the player never reaches the seam, unlit, and
    // explicitly out of the fog — nothing about the hall's air applies to it.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1400, 32, 16),
      new THREE.MeshBasicMaterial({
        map: starfield(PALETTE),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    sky.renderOrder = -2;
    this.scene.add(sky);
    this.sky = sky;

    // The planet, hanging below and to one side of the panorama window.
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(460, 48, 32),
      new THREE.MeshStandardMaterial({
        map: planetSurface(PALETTE),
        /* The star's intensity is set for an interior that is in shadow most
         * of the time. Out here nothing is in the way, so the albedo has to
         * come down or the planet tone maps to a flat white disc. */
        color: 0x77828f,
        /* And a trace of emissive so the night side is a dark globe
         * occluding stars rather than a hole in the starfield. */
        emissive: new THREE.Color(PALETTE.planet),
        emissiveIntensity: 0.05,
        roughness: 0.95,
        metalness: 0,
        fog: false,
      }),
    );
    planet.position.set(-430, 150, -1010);
    planet.rotation.z = 0.32;
    this.scene.add(planet);
    this.planet = planet;

    // A thin halo so the limb does not end on a hard edge.
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(486, 32, 20),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(PALETTE.planet).multiplyScalar(0.5),
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.copy(planet.position);
    this.scene.add(halo);
  }

  /* ------------------------------------------------------------- update */

  update(time, dt, sun) {
    const night = 1 - sun.daylight;
    for (const { light, base } of this.lights) {
      light.intensity = base * (0.35 + night * 5.5);
    }
    // The planet turns. Slowly enough that you only notice on the way back.
    this.planet.rotation.y += dt * 0.006;
    if (this.puddleMaterial) {
      this.puddleMaterial.envMapIntensity = 0.6 + sun.daylight * 1.2;
    }
  }
}
