/**
 * Bundles KIOSK IMPERIUM into one self-contained HTML file.
 *
 *   node tools/build-tycoon.mjs
 *   -> dist/kiosk-imperium.html        (complete document, double-click it)
 *   -> dist/kiosk-imperium.embed.html  (body only, for hosts that supply the shell)
 *
 * Same shape as tools/build.mjs, which does this for the level. The game has no
 * assets and no dependencies, so the bundle is the whole thing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');
const SRC_HTML = path.join(ROOT, 'tycoon/index.html');
const SCRIPT_TAG = '<script type="module" src="./src/main.js"></script>';

let esbuild;
try {
  esbuild = await import('esbuild');
} catch {
  console.error(
    'esbuild not found.\n' +
    '  npm install --no-save esbuild\n' +
    'then run this again. (tycoon/index.html works without it — this step only\n' +
    'produces the single-file version.)',
  );
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'tycoon/src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
const source = fs.readFileSync(SRC_HTML, 'utf8');

if (!source.includes(SCRIPT_TAG)) {
  console.error('Could not find the module script tag in tycoon/index.html.');
  process.exit(1);
}

const html = source.replace(SCRIPT_TAG, `<script>\n${js}\n</script>`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'kiosk-imperium.html'), html);
console.log(`dist/kiosk-imperium.html        ${kb(html)} KB  (self-contained, no network)`);

/* ------------------------------------------------------------------------
 * Body-only variant for hosts that own the document shell (claude.ai
 * artifacts, CMS embeds, iframes). The wrapper decides two things we cannot
 * leave to it: the viewport meta, injected at runtime, and the background,
 * which has to stay dark in a light-mode host — the game commits to one look.
 * ---------------------------------------------------------------------- */

const grab = (tag) => {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
};

const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .trim();

const embed = `<style>
:root, :root[data-theme="light"], :root[data-theme="dark"] {
  color-scheme: dark;
  background: #12100d;
}
html, body { background: #12100d !important; }
${grab('style')}
/* The host owns the document height. */
#start { min-height: 100dvh; }
</style>

${body}

<script>
/* No head of our own: without this a phone lays the page out at 980px. */
(function () {
  try {
    if (!document.querySelector('meta[name="viewport"]')) {
      var m = document.createElement('meta');
      m.name = 'viewport';
      m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
      (document.head || document.documentElement).appendChild(m);
    }
  } catch (e) { /* embedded somewhere strict; the game still runs */ }
})();
</script>
`;

if (/<\/?(?:html|head|body|!doctype)\b/i.test(embed)) {
  console.error('Embed variant must not contain document-level tags.');
  process.exit(1);
}
if (embed.includes('src/main.js')) {
  console.error('Embed variant still references the unbundled entry point.');
  process.exit(1);
}

fs.writeFileSync(path.join(OUT_DIR, 'kiosk-imperium.embed.html'), embed);
console.log(`dist/kiosk-imperium.embed.html  ${kb(embed)} KB  (body-only)`);

function kb(s) { return (Buffer.byteLength(s) / 1024).toFixed(0); }
