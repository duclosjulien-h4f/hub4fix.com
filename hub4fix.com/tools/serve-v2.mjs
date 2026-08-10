/**
 * Hub4Fix — serveur de prévisualisation du tronc B2C "V2".
 *
 * Sert le dossier hub4fix.com/ MAIS redirige la racine ("/" et "/index.html")
 * vers la page d'accueil V2 (kintsugi.html), pour que la V2 s'affiche
 * correctement à la racine — contrairement au serveur "demo-h4f" (port 9090)
 * dont la racine reste l'ancien index.html (V1).
 *
 * Zéro dépendance (http + fs natifs). No-store pour voir les modifs en direct.
 * Lancé via .claude/launch.json (configuration "h4f-v2") ou :
 *     node hub4fix.com/tools/serve-v2.mjs
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // tools/.. === hub4fix.com/
const PORT = process.env.PORT ? Number(process.env.PORT) : 9091;
const V2_HOME = '/kintsugi.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, `http://localhost`).pathname);

    // Root of the preview reads as the V2, not the legacy index.html.
    if (urlPath === '/' || urlPath === '/index.html') {
      res.writeHead(302, { Location: V2_HOME });
      res.end();
      return;
    }

    // Resolve within ROOT (block path traversal).
    let filePath = path.join(ROOT, urlPath);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 — introuvable');
      return;
    }
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');

    const data = await fs.readFile(filePath);
    const type = TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store, max-age=0' });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('500 — ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hub4Fix V2 preview -> http://localhost:${PORT}/ (racine -> ${V2_HOME})`);
});
