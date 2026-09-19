// Baut die Fassung für einen claude.ai-Artifact.
//
// Der Rahmen dort liefert <html>, <head> und <body> selbst — ein vollständiges
// Dokument würde ineinander verschachtelt landen. Also nur der Body-Inhalt,
// das Stylesheet eingebettet, und zwei Anpassungen an die Umgebung:
// Höhe über 100 % statt 100dvh (der Rahmen polstert :root um die
// Safe-Area-Ränder), und kein Manifest, das dort ohnehin ins Leere zeigt.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const html = await readFile(`${root}index.html`, 'utf8');
const css = await readFile(`${root}styles/app.css`, 'utf8');

const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1];
if (!title || !body) throw new Error('index.html sieht nicht aus wie erwartet.');

const overrides = `
/* ── Nur im Artifact-Rahmen ──────────────────────────────────────────────
   Der Rahmen polstert :root um die Safe-Area-Ränder und erwartet, dass eine
   Ein-Bildschirm-App sich über 100 % einpasst statt über 100dvh — sonst ragt
   sie unter den Systemleisten heraus. */
html, body { height: 100%; }
.app { height: 100%; }
`;

const out = `<title>${title}</title>
<style>
${css.trimEnd()}
${overrides}</style>
${body.trim()}
`;

await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/artifact.html`, out);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`dist/artifact.html — ${kb(out.length)} (CSS ${kb(css.length)}, Markup ${kb(body.length)})`);
console.log(`Titel: ${title}`);
// Auf Tag-Grenzen prüfen, sonst schlägt <header> als <head> an.
for (const tag of ['html', 'head', 'body']) {
  if (new RegExp(`</?${tag}[\\s>]`, 'i').test(out)) throw new Error(`<${tag}> ist noch enthalten`);
}
if (/<!doctype/i.test(out)) throw new Error('<!doctype> ist noch enthalten');
console.log('Keine Dokument-Hüllen enthalten.');
