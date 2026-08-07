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

// The single file has no siblings, so the manifest, the icon and the worker
// would all be dead links. The app is fully offline in this form anyway.
html = html
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace(/\s*<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\s*<script>\s*\/\* Offline support[\s\S]*?<\/script>/, '');

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

/* ------------------------------------------------------------------------
 * Second target: body-only, for hosts that bring their own document shell
 * (claude.ai artifacts, CMS embeds, iframes). Same bundle, same markup —
 * only the wrapper is stripped, plus the two things the host would otherwise
 * decide for us: the viewport meta, injected at runtime, and the background,
 * forced dark in both colour schemes. A white page behind a night sky is not
 * a theme choice.
 *
 * Worth knowing before embedding: orientation sensors, compass, geolocation
 * and camera are gated behind a permissions policy in a cross-origin frame.
 * A host that does not grant them leaves the app in drag-to-look mode with
 * the default location — everything else, including the whole ephemeris,
 * works unchanged.
 * ---------------------------------------------------------------------- */

const EMBED_FILE = path.join(OUT_DIR, 'planetenfinder.embed.html');

const grab = (tag) => {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : '';
};

const css = grab('style');
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .trim();

const embed = `<style>
/* The app is deliberately single-theme — it is a night sky — so the viewer's
   light mode must not put a white ground behind it. */
:root, :root[data-theme="light"], :root[data-theme="dark"] {
  color-scheme: dark;
  background: #05070f;
}
html, body { background: #05070f !important; height: 100%; }
${css}
/* The host owns the document height; fall back to the dynamic viewport so a
   mobile address bar does not crop the sky. */
#app { height: 100dvh; }
</style>

${body}

<script>
/* The wrapper owns the document head, so the viewport tag has to be added
   from here. Without it a phone lays the page out at 980px wide and renders
   a postage stamp. */
(function () {
  try {
    if (!document.querySelector('meta[name="viewport"]')) {
      var m = document.createElement('meta');
      m.name = 'viewport';
      m.content = 'width=device-width, initial-scale=1, maximum-scale=1, ' +
                  'user-scalable=no, viewport-fit=cover';
      (document.head || document.documentElement).appendChild(m);
    }
  } catch (e) { /* embedded somewhere strict; the app still runs */ }
})();
</script>
`;

if (/<\/?(?:html|head|body|!doctype)\b/i.test(embed)) {
  console.error('Embed variant must not contain document-level tags.');
  process.exit(1);
}

fs.writeFileSync(EMBED_FILE, embed);
console.log(
  `planetenfinder/dist/planetenfinder.embed.html  ${(Buffer.byteLength(embed) / 1024).toFixed(0)} KB` +
  '  (body-only, for hosts that supply the document shell)',
);
