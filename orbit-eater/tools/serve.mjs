/**
 * Minimaler statischer Server ohne Abhängigkeiten.
 * ES-Module brauchen einen echten Origin — per Doppelklick geht es nicht.
 *
 *   node tools/serve.mjs [port]      →  http://localhost:8080/
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url.endsWith('/') ? `${url}index.html` : url;
  const abs = path.join(ROOT, path.normalize(rel));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(data);
  });
}).listen(PORT, () => {
  console.log(`ORBIT EATER → http://localhost:${PORT}/`);
});
