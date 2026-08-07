/**
 * Device orientation -> a camera basis in the East/North/Up frame.
 *
 * The chain, because every step of it is a place where sky apps go wrong:
 *
 *   1. `deviceorientation` gives alpha/beta/gamma, an intrinsic Z-X'-Y''
 *      rotation from the device frame into a world frame with X east,
 *      Y north, Z up.
 *   2. Those are turned into a quaternion, then rotated by -90° about X so
 *      that "phone held up, looking through it" is the neutral pose, and by
 *      the screen orientation angle so landscape does not tip the sky over.
 *   3. The result is read out as three vectors — right, up, forward — in ENU.
 *      Forward is the back camera's axis, so a body is on screen exactly when
 *      it is in front of that vector. Turn away and it leaves the screen by
 *      itself; no visibility bookkeeping anywhere else in the app.
 *
 * Azimuth is the weak link, not the maths: `alpha` is magnetic on most
 * phones and arbitrary on some, so a user-settable offset rides along, and
 * `calibrateTo()` sets it from a body you can actually see.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/* ------------------------------------------------------------ quaternions */

const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Intrinsic Y-X-Z Euler angles (radians) to quaternion. */
function qFromEulerYXZ(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 - s1 * s2 * c3,
    c1 * c2 * c3 + s1 * s2 * s3,
  ];
}

function qFromAxisZ(angle) {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

function qRotate(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function qSlerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let target = b;
  if (dot < 0) { target = [-b[0], -b[1], -b[2], -b[3]]; dot = -dot; }
  if (dot > 0.9995) {
    const out = [
      a[0] + (target[0] - a[0]) * t,
      a[1] + (target[1] - a[1]) * t,
      a[2] + (target[2] - a[2]) * t,
      a[3] + (target[3] - a[3]) * t,
    ];
    const n = Math.hypot(...out) || 1;
    return out.map((v) => v / n);
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / s;
  const wb = Math.sin(t * theta) / s;
  return [
    a[0] * wa + target[0] * wb,
    a[1] * wa + target[1] * wb,
    a[2] * wa + target[2] * wb,
    a[3] * wa + target[3] * wb,
  ];
}

// Neutral pose: -90° about X, so holding the phone up and looking "through"
// it points at the horizon rather than at the zenith.
const Q_SCREEN = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

/* ------------------------------------------------------------ ENU helpers */

/** three-style frame (x east, y up, z south) -> [east, north, up]. */
const toENU = (v) => [v[0], -v[2], v[1]];

const norm360 = (x) => ((x % 360) + 360) % 360;
const norm180 = (x) => norm360(x + 180) - 180;

export function azAltOf(vec) {
  const [e, n, u] = vec;
  return {
    az: norm360(Math.atan2(e, n) * RAD),
    alt: Math.asin(Math.max(-1, Math.min(1, u / (Math.hypot(e, n, u) || 1)))) * RAD,
  };
}

export function vectorFor(az, alt) {
  const ca = Math.cos(alt * DEG);
  return [ca * Math.sin(az * DEG), ca * Math.cos(az * DEG), Math.sin(alt * DEG)];
}

/**
 * Take the roll out of a camera basis: same aim, but the horizon lies flat
 * across the screen instead of tipping with every twitch of the wrist.
 *
 * Pointing straight up the levelled basis is undefined — there is no "flat
 * horizon" at the zenith — so the device's own roll is faded back in above
 * 55° of elevation and used alone above 75°. Without that fade the picture
 * would spin on the spot exactly where people hold the phone to look at the
 * sky.
 */
function levelled({ right, up, forward }) {
  const horizontal = Math.hypot(forward[0], forward[1]);
  if (horizontal < 1e-4) return { right, up, forward };

  const alt = Math.abs(Math.asin(Math.max(-1, Math.min(1, forward[2]))) * RAD);
  const blend = Math.max(0, Math.min(1, (alt - 55) / 20));
  if (blend >= 1) return { right, up, forward };

  // Level frame: right stays horizontal, up completes the right-handed set.
  const rightL = [forward[1] / horizontal, -forward[0] / horizontal, 0];
  const upL = [
    rightL[1] * forward[2] - rightL[2] * forward[1],
    rightL[2] * forward[0] - rightL[0] * forward[2],
    rightL[0] * forward[1] - rightL[1] * forward[0],
  ];

  // How far the device is rolled away from that frame, and how much of it we
  // keep. Rotating the level frame back by the kept amount preserves the aim.
  const roll = Math.atan2(
    right[0] * upL[0] + right[1] * upL[1] + right[2] * upL[2],
    right[0] * rightL[0] + right[1] * rightL[1] + right[2] * rightL[2],
  ) * blend;

  const c = Math.cos(roll), s = Math.sin(roll);
  return {
    right: rightL.map((v, i) => v * c + upL[i] * s),
    up: rightL.map((v, i) => -v * s + upL[i] * c),
    forward,
  };
}

/* ------------------------------------------------------------------ class */

export class Orientation extends EventTarget {
  constructor() {
    super();
    this.mode = 'idle';           // idle | sensor | manual | denied
    this.absolute = false;        // alpha is referenced to (magnetic) north
    this.compassAccuracy = null;  // iOS only, degrees
    this.headingOffset = 0;       // user calibration, added to the azimuth
    this.smoothing = true;
    this.levelHorizon = true;     // damp the device roll, see basis()

    this._raw = null;             // {alpha, beta, gamma}
    this._compassOffset = null;   // eased from webkitCompassHeading
    this._compassAt = 0;
    this._resnap = false;
    this._q = [0, 0, 0, 1];
    this._qTarget = [0, 0, 0, 1];
    this._lastEvent = 0;
    this._screenAngle = 0;

    // Manual look, used on desktop and whenever the sensors say nothing.
    this.manual = { az: 180, alt: 20 };

    this._onOrientation = this._onOrientation.bind(this);
    this._onAbsolute = this._onAbsolute.bind(this);
    this._onScreen = this._onScreen.bind(this);
  }

  /** True once real sensor data has arrived in the last few seconds. */
  get live() {
    return this.mode === 'sensor' && performance.now() - this._lastEvent < 3000;
  }

  get needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** iOS demands a user gesture for this; call it from a click handler. */
  async requestPermission() {
    if (!this.needsPermission) return 'granted';
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') this.mode = 'denied';
      return res;
    } catch {
      this.mode = 'denied';
      return 'denied';
    }
  }

  start() {
    this._readScreenAngle();
    window.addEventListener('deviceorientation', this._onOrientation, true);
    window.addEventListener('deviceorientationabsolute', this._onAbsolute, true);
    window.addEventListener('orientationchange', this._onScreen);
    screen.orientation?.addEventListener?.('change', this._onScreen);

    // Nothing within a second and a half means no usable sensor: fall back
    // rather than leave the user staring at a frozen sky.
    this._fallbackTimer = setTimeout(() => {
      if (this.mode !== 'sensor') {
        this.mode = this.mode === 'denied' ? 'denied' : 'manual';
        this.dispatchEvent(new CustomEvent('modechange'));
      }
    }, 1500);
  }

  stop() {
    window.removeEventListener('deviceorientation', this._onOrientation, true);
    window.removeEventListener('deviceorientationabsolute', this._onAbsolute, true);
    window.removeEventListener('orientationchange', this._onScreen);
    screen.orientation?.removeEventListener?.('change', this._onScreen);
    clearTimeout(this._fallbackTimer);
  }

  _readScreenAngle() {
    const a = screen.orientation?.angle;
    this._screenAngle = (typeof a === 'number' ? a : window.orientation || 0) * DEG;
  }

  _onScreen() {
    this._readScreenAngle();
  }

  _onAbsolute(ev) {
    if (ev.alpha == null) return;
    this.absolute = true;
    this._accept(ev, true);
  }

  _onOrientation(ev) {
    if (ev.alpha == null) return;
    // An absolute event stream, once seen, wins over the relative one.
    if (this.absolute && !ev.absolute && ev.webkitCompassHeading == null) return;
    this._accept(ev, !!ev.absolute);
  }

  _accept(ev, absolute) {
    if (absolute) this.absolute = true;

    if (typeof ev.webkitCompassHeading === 'number' && !Number.isNaN(ev.webkitCompassHeading)) {
      // iOS: the heading is true north referenced, alpha is not. The compass
      // counts clockwise, alpha counterclockwise — hence 360 - heading.
      this._blendCompass(norm180(ev.alpha - (360 - ev.webkitCompassHeading)));
      this.absolute = true;
      if (typeof ev.webkitCompassAccuracy === 'number' && ev.webkitCompassAccuracy >= 0) {
        this.compassAccuracy = ev.webkitCompassAccuracy;
      }
    }

    this._raw = { alpha: ev.alpha, beta: ev.beta || 0, gamma: ev.gamma || 0 };
    this._lastEvent = performance.now();

    if (this.mode !== 'sensor') {
      this.mode = 'sensor';
      clearTimeout(this._fallbackTimer);
      this._q = this._computeQuaternion();
      this.dispatchEvent(new CustomEvent('modechange'));
    }
  }

  /**
   * Complementary filter for the compass.
   *
   * `alpha` is gyro-driven: smooth, fast, and slowly drifting. The magnetic
   * heading is the opposite — absolutely referenced but jumpy, and it lurches
   * whenever the magnetometer recalibrates or the app comes back from being
   * interrupted. Taking the offset raw on every event, as this used to, made
   * the azimuth follow the magnetometer 1:1 while the tilt still came from
   * the gyro, and the sky wobbled and span between the two.
   *
   * So the offset is eased instead: short-term motion follows the smooth
   * alpha, and the compass only pulls the heading towards true north over a
   * few seconds. A large disagreement is treated as a genuine re-reference —
   * after a phone call, for instance, alpha's origin can reset — and is
   * closed off quickly rather than crawled towards.
   */
  _blendCompass(target) {
    const now = performance.now();
    const dt = Math.min((now - (this._compassAt || now)) / 1000, 1);
    this._compassAt = now;

    if (this._compassOffset == null || this._resnap) {
      this._compassOffset = target;
      this._resnap = false;
      return;
    }

    const diff = norm180(target - this._compassOffset);
    const tau = Math.abs(diff) > 90 ? 0.4 : 2.5;
    this._compassOffset = norm180(this._compassOffset + diff * (1 - Math.exp(-dt / tau)));
  }

  /**
   * Take the next compass reading as gospel instead of easing into it. Used
   * when the app comes back to the foreground, where the reference alpha is
   * measured against may have moved while we were not looking.
   */
  resnap() {
    this._resnap = true;
  }

  _computeQuaternion() {
    const { alpha, beta, gamma } = this._raw;
    // A negative offset here turns the sky the other way, so it is applied
    // as a subtraction from alpha and read back as an addition to azimuth.
    const a = (alpha - (this._compassOffset ?? 0) - this.headingOffset) * DEG;
    let q = qFromEulerYXZ(beta * DEG, a, -gamma * DEG);
    q = qMul(q, Q_SCREEN);
    q = qMul(q, qFromAxisZ(-this._screenAngle));
    return q;
  }

  /**
   * Per-frame update. `dt` in seconds; the smoothing is frame-rate
   * independent so a 120 Hz phone and a 30 Hz one feel the same.
   */
  update(dt) {
    if (this.mode !== 'sensor' || !this._raw) return;
    this._qTarget = this._computeQuaternion();
    if (!this.smoothing) { this._q = this._qTarget; return; }
    const t = 1 - Math.exp(-16 * Math.max(dt, 0.001));
    this._q = qSlerp(this._q, this._qTarget, t);
  }

  /** Camera basis in ENU: where the back of the phone is aimed. */
  basis() {
    if (this.mode === 'sensor' && this._raw) {
      const raw = {
        right: toENU(qRotate(this._q, [1, 0, 0])),
        up: toENU(qRotate(this._q, [0, 1, 0])),
        forward: toENU(qRotate(this._q, [0, 0, -1])),
      };
      return this.levelHorizon ? levelled(raw) : raw;
    }
    // Manual: no roll, so the horizon stays level.
    const { az, alt } = this.manual;
    const forward = vectorFor(az, alt);
    const right = [Math.cos(az * DEG), -Math.sin(az * DEG), 0];
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    return { right, up, forward };
  }

  /** Where the phone points, in horizon coordinates. */
  aim() {
    return azAltOf(this.basis().forward);
  }

  /** Roll angle of the device around the view axis, degrees. */
  roll() {
    if (this.mode !== 'sensor') return 0;
    const { right } = this.basis();
    return Math.atan2(right[2], Math.hypot(right[0], right[1])) * RAD;
  }

  /**
   * If the sensor stream dies mid-session — permission revoked, a browser that
   * stops delivering in the background — the last quaternion would otherwise
   * freeze the view and swallow every drag. The first drag after the data goes
   * stale takes over from wherever the phone was last pointing.
   */
  _takeManualControl() {
    if (this.mode !== 'sensor' || this.live) return;
    const aim = this.aim();
    this.manual.az = aim.az;
    this.manual.alt = aim.alt;
    this.mode = 'manual';
    this.dispatchEvent(new CustomEvent('modechange'));
  }

  /** Drag/keys for the manual mode; ignored while the sensors are live. */
  look(dAz, dAlt) {
    this._takeManualControl();
    this.manual.az = norm360(this.manual.az + dAz);
    this.manual.alt = Math.max(-90, Math.min(90, this.manual.alt + dAlt));
  }

  /** Jump the manual view straight at something. */
  lookAt(az, alt) {
    this._takeManualControl();
    this.manual.az = norm360(az);
    this.manual.alt = Math.max(-90, Math.min(90, alt));
  }

  /**
   * "This is Saturn, right there" — align the compass on a body the user can
   * see. Only azimuth is touched: altitude comes from gravity and is already
   * as good as the phone gets.
   */
  calibrateTo(trueAz) {
    const current = this.aim().az;
    this.headingOffset = norm180(this.headingOffset + norm180(trueAz - current));
    return this.headingOffset;
  }

  setHeadingOffset(deg) {
    this.headingOffset = norm180(deg);
  }
}
