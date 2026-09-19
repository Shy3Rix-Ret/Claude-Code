// Winziger Entwicklungsserver. ES-Module brauchen einen echten Origin, per
// file:// verweigert jeder Browser den Import — und ohne Origin gibt es auch
// keinen Service Worker.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mid': 'audio/midi',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';

    // Kein Ausbruch aus dem Projektordner.
    const target = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(root)) { res.writeHead(403).end('verboten'); return; }

    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) { res.writeHead(404).end('nicht gefunden'); return; }

    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      // Der Service Worker braucht keine besonderen Header, der WAV-Export
      // auch nicht — aber ohne diesen hier meckert der Browser bei
      // OfflineAudioContext in manchen Konstellationen.
      'cross-origin-opener-policy': 'same-origin',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(port, () => {
  console.log(`play_music_theory → http://localhost:${port}/`);
});
