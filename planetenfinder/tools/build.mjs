/**
 * Bundles the app into one self-contained HTML file.
 *
 *   node planetenfinder/tools/build.mjs
 *   -> planetenfinder/dist/planetenfinder.html
 *
 * No dependencies, no assets, no network calls at runtime: the ephemeris is
 * code and the star catalogue is a table, so the single file works offline.
 *
 * A note for phones: the orientation and geolocation APIs only exist in a
 * secure context. The file works from https:// and from localhost; opened
 * straight off the filesystem the sensors stay silent and the app falls back
 * to drag-to-look.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'planetenfinder.html');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(
    'esbuild not found.\n' +
    '  npm install --no-save esbuild\n' +
    'then run this again. (planetenfinder/index.html works without it — this\n' +
    'step only produces the single-file version.)',
  );
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari14'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

html = html.replace(
  '<script type="module" src="./src/main.js"></script>',
  () => `<script>\n${js}\n</script>`,
);

if (html.includes('src/main.js')) {
  console.error('Could not find the module script tag in index.html.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`planetenfinder/dist/planetenfinder.html  ${kb} KB  (self-contained)`);
