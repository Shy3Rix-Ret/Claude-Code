/**
 * Bundles the station scene into one self-contained HTML file.
 *
 *   node tools/build-station.mjs
 *   -> dist/kepler-9.html
 *
 * Same deal as tools/build.mjs: no external requests of any kind, because
 * Three.js is vendored and every texture, sound and mesh in the scene is
 * generated at runtime. The result opens from a file:// URL.
 *
 * Requires esbuild. Without it, station.html still works over a real server.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'kepler-9.html');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(
    'esbuild not found.\n' +
    '  npm install --no-save esbuild\n' +
    'then run this again. (station.html works without it — this step only\n' +
    'produces the single-file version.)',
  );
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'station/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  alias: { three: path.join(ROOT, 'vendor/three.module.js') },
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;

let html = fs.readFileSync(path.join(ROOT, 'station.html'), 'utf8');

html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="\.\/station\/main\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`,
);

if (html.includes('station/main.js')) {
  console.error('Could not find the script tags to replace in station.html.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html);

console.log(
  `dist/kepler-9.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB` +
  '  (self-contained, no network)',
);
