/**
 * Bundles the whole level into one self-contained HTML file.
 *
 *   node tools/build.mjs
 *   -> dist/level-4444.html
 *
 * The result has no external requests of any kind — Three.js, every shader,
 * every texture and every sound is either inlined or generated at runtime — so
 * it works from a file:// URL, off a USB stick, or on a plane.
 *
 * Requires esbuild. If it is not installed the script says so and exits; the
 * unbundled `index.html` works without it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const OUT_FILE = path.join(OUT_DIR, 'level-4444.html');

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(
    'esbuild not found.\n' +
    '  npm install --no-save esbuild\n' +
    'then run this again. (index.html works without it — this step only\n' +
    'produces the single-file version.)',
  );
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
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

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Swap the import map + module script for the bundle.
html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`,
);

if (html.includes('src/main.js')) {
  console.error('Could not find the script tags to replace in index.html.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`dist/level-4444.html  ${kb} KB  (self-contained, no network)`);
