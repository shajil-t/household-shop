#!/usr/bin/env node
/**
 * serve.js
 * ---------------------------------------------------------------------------
 * Zero-dependency static file server for local development.
 * ES modules and fetch() do not work over the file:// protocol, so use this
 * instead of double-clicking index.html.
 *
 * Usage:  npm run serve   (then open http://localhost:4173)
 *         PORT=8080 npm run serve
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
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
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Maps a request URL to a file inside ROOT, refusing path traversal.
 * @param {string} requestUrl
 * @returns {string|null} absolute path, or null when the request escapes ROOT
 */
function resolveSafePath(requestUrl) {
  let pathname;
  try {
    // A request target such as "//" is not a valid URL on its own, and an
    // unhandled throw here would take the whole server down.
    ({ pathname } = new URL(requestUrl, 'http://localhost'));
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  const absolute = path.resolve(ROOT, `.${relative}`);
  return absolute === ROOT || absolute.startsWith(`${ROOT}${path.sep}`) ? absolute : null;
}

const server = createServer(async (request, response) => {
  const filePath = resolveSafePath(request.url ?? '/');

  if (!filePath) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('400 Bad Request');
    console.warn(`400 ${request.method} ${request.url}`);
    return;
  }

  try {
    const info = await stat(filePath);
    const target = info.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const contentType = MIME_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';

    response.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    createReadStream(target).pipe(response);
    console.log(`200 ${request.method} ${request.url}`);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    console.warn(`404 ${request.method} ${request.url}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n🌐 Serving ${ROOT}\n   http://localhost:${PORT}\n   Press Ctrl+C to stop.\n`);
});
