/**
 * Draws the app icons.
 *
 *   node planetenfinder/tools/icons.mjs
 *
 * A home-screen icon has to be a real PNG file — a data URI in the manifest
 * is not enough for iOS — and pulling in an image library for three circles
 * would be silly. So the shapes are rasterised here by hand with 4× super-
 * sampling, and written out through a minimal PNG encoder: signature, IHDR,
 * one deflated IDAT, IEND. Nothing else is needed for a truecolour image.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* --------------------------------------------------------------- PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA pixel buffer -> PNG file bytes. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // truecolour with alpha
  // 10-12: deflate, adaptive filtering, no interlace — all zero.

  // Each scanline is prefixed with its filter type; 0 means "none", which
  // costs a few bytes and saves all the complexity.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- shapes */

const SS = 4;                        // supersampling factor, for smooth edges

/** Is this point inside the ring ellipse's stroke? */
function onRing(x, y, rx, ry, width, tilt) {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const u = x * c + y * s;
  const v = -x * s + y * c;
  const d = Math.hypot(u / rx, v / ry);
  return Math.abs(d - 1) < width / rx;
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const r = size / 2;
  const planet = size * 0.21;
  const ringX = size * 0.40;
  const ringY = size * 0.125;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, ring = 0, globe = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - r;
          const py = y + (sy + 0.5) / SS - r;
          const dist = Math.hypot(px, py);
          if (dist > r - 0.5) continue;
          bg++;
          const inGlobe = dist < planet;
          if (inGlobe) { globe++; continue; }
          // The ring passes behind the globe, so it only shows outside it.
          if (onRing(px, py, ringX, ringY, size * 0.022, -0.36)) ring++;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      // A night-sky ground, a warm globe, a paler ring.
      const alpha = bg / n;
      let cr = 8, cg = 12, cb = 24;
      const gl = globe / n, rg = ring / n;
      cr = cr * (1 - gl) + 240 * gl;
      cg = cg * (1 - gl) + 222 * gl;
      cb = cb * (1 - gl) + 168 * gl;
      cr = cr * (1 - rg) + 232 * rg;
      cg = cg * (1 - rg) + 214 * rg;
      cb = cb * (1 - rg) + 170 * rg;

      rgba[i] = cr;
      rgba[i + 1] = cg;
      rgba[i + 2] = cb;
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

for (const size of [180, 192, 512]) {
  const file = path.join(ROOT, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  console.log(`planetenfinder/icon-${size}.png  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
}
