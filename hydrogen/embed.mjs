// Cuts hydrogen/index.html down to the body-only variant for hosts that bring their own
// <html>/<head>/<body> (claude.ai artifacts, CMS embeds).  Usage: node hydrogen/embed.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, 'index.html'), 'utf8');
const body = src.slice(src.indexOf('<!-- embed:start -->') + 20, src.indexOf('<!-- embed:end -->'));
const out = body.replace(/<!-- embed:cut -->[\s\S]*?<!-- embed:resume -->\n?/, '').trimStart();
writeFileSync(join(dir, 'hydrogen.embed.html'), out);
console.log('hydrogen.embed.html', out.length, 'bytes');
