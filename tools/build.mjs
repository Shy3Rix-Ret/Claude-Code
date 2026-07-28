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

/* ------------------------------------------------------------------------
 * Second target: a body-only variant for hosts that wrap the page in their
 * own document shell (claude.ai artifacts, CMS embeds, iframes).
 *
 * Same bundle, same markup — only the document wrapper is stripped, plus two
 * things the wrapper would otherwise decide for us: the viewport meta, which
 * is injected at runtime, and the background, which is forced black in both
 * colour schemes. A white page behind a horror piece is not a theme choice.
 * ---------------------------------------------------------------------- */

const EMBED_FILE = path.join(OUT_DIR, 'level-4444.embed.html');

const grab = (tag) => {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
};

const css = grab('style');
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .trim();

const embed = `<style>
/* This page is deliberately single-theme: it commits to one visual world, and
   the viewer's light mode must not put a white ground behind it. */
:root, :root[data-theme="light"], :root[data-theme="dark"] {
  color-scheme: dark;
  background: #000;
}
html, body { background: #000 !important; height: 100%; }
${css}
/* The host controls the document height; fall back to the dynamic viewport so
   a mobile address bar does not crop the frame. */
#gl { height: 100dvh; }
#boot, #end-card { min-height: 100dvh; }
</style>

${body}

<script>
/* The wrapper owns the document head, so the viewport tag has to be added
   from here. Without it a phone lays the page out at 980px and renders a
   postage stamp. */
(function () {
  try {
    if (!document.querySelector('meta[name="viewport"]')) {
      var m = document.createElement('meta');
      m.name = 'viewport';
      m.content = 'width=device-width, initial-scale=1, maximum-scale=1, ' +
                  'user-scalable=no, viewport-fit=cover';
      (document.head || document.documentElement).appendChild(m);
    }
  } catch (e) { /* embedded somewhere strict; the game still runs */ }
})();
</script>
`;

const embedHtml = embed.replace(
  /<script type="importmap">[\s\S]*?<\/script>\s*<script type="module" src="\.\/src\/main\.js"><\/script>/,
  () => `<script>\n${js}\n</script>`,
);

if (embedHtml.includes('src/main.js')) {
  console.error('Embed variant still references the unbundled entry point.');
  process.exit(1);
}
if (/<\/?(?:html|head|body|!doctype)\b/i.test(embedHtml)) {
  console.error('Embed variant must not contain document-level tags.');
  process.exit(1);
}

fs.writeFileSync(EMBED_FILE, embedHtml);
console.log(
  `dist/level-4444.embed.html  ${(Buffer.byteLength(embedHtml) / 1024).toFixed(0)} KB` +
  '  (body-only, for hosts that supply the document shell)',
);
