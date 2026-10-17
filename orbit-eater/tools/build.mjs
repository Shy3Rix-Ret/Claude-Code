/**
 * Single-File-Build ohne Abhängigkeiten.
 *
 *   node tools/build.mjs                  →  dist/orbit-eater.html
 *   node tools/build.mjs --embed <datei>  →  zusätzlich eine Variante nur mit dem
 *                                            Body-Inhalt (für Hosts, die <html>/<head>
 *                                            selbst mitbringen)
 *
 * Bündelt alle ES-Module aus js/ in ein einziges Skript und das CSS inline.
 * Jedes Modul bekommt einen eigenen Funktions-Scope; Importe werden zu
 * Destrukturierungen des exportierenden Moduls. Das Ergebnis ist eine HTML-
 * Datei, die auch per Doppelklick (file://) läuft — ideal zum Verschicken.
 *
 * Unterstützt bewusst nur die Syntax, die dieses Projekt benutzt:
 *   import { a, b as c } from './x.js';
 *   export const|let|function|class Name
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const varName = file => `__${file.replace(/\.js$/, '').replace(/[^\w]/g, '_')}`;

// --- Module einsammeln und in Abhängigkeitsreihenfolge bringen ---------------

const modules = new Map();
const order = [];

function load(file) {
  if (modules.has(file)) return;
  let code = read(`js/${file}`);
  const deps = [];
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.-]+\.js)';?/g, (_, names, dep) => {
    deps.push(dep);
    const binds = names.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.replace(/\s+as\s+/, ': '));
    return `const { ${binds.join(', ')} } = ${varName(dep)};`;
  });
  const exports = [];
  code = code.replace(/^export\s+(const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exports.push(name);
    return `${kind} ${name}`;
  });
  if (/^\s*(import|export)\s/m.test(code)) throw new Error(`${file}: nicht unterstützte import/export-Syntax`);
  modules.set(file, { code, deps, exports });
  for (const d of deps) load(d);
  order.push(file);   // Post-Order: Abhängigkeiten stehen vorne
}

load('main.js');

let bundle = '(function () {\n\'use strict\';\n';
for (const file of order) {
  const m = modules.get(file);
  bundle += `\n// ---- js/${file} ----\n`;
  bundle += m.exports.length
    ? `const ${varName(file)} = (() => {\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();\n`
    : `(() => {\n${m.code}\n})();\n`;
}
bundle += '})();\n';
bundle = bundle.replace(/<\/script/gi, '<\\/script');

// --- HTML zusammensetzen ----------------------------------------------------------

const css = read('css/style.css');
const html = read('index.html')
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}</style>`)
  .replace('<script type="module" src="js/main.js"></script>', () => `<script>\n${bundle}</script>`)
  // Der file://-Hinweis ist im Bundle überflüssig: diese Datei läuft auch ohne Server.
  .replace(/\/\* dev-only \*\/[\s\S]*?\/\* end dev-only \*\//g, '');

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'orbit-eater.html');
fs.writeFileSync(out, html);
console.log(`${path.relative(ROOT, out)}  ${(html.length / 1024).toFixed(0)} KB  (${order.length} Module)`);

const embedArg = process.argv.indexOf('--embed');
if (embedArg > 0) {
  const target = path.resolve(process.argv[embedArg + 1]);
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
  fs.writeFileSync(target, `${title}\n${style}\n${body}`);
  console.log(`${target}  (nur Body-Inhalt)`);
}
