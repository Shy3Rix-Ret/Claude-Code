/**
 * Minimal static server. ES modules need a real origin — opening index.html
 * from the filesystem will not work.
 *
 *   node tools/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4444);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = url === '/' ? '/index.html' : url;
  const abs = path.join(ROOT, path.normalize(rel));

  if (!abs.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      // Needed for the higher-resolution timers some profilers want. Harmless.
      'cross-origin-opener-policy': 'same-origin',
    }).end(data);
  });
}).listen(PORT, () => {
  console.log(`LEVEL 4444 → http://localhost:${PORT}/`);
});
