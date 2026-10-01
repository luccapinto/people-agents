#!/usr/bin/env node
/**
 * Serves a static build the way GitHub Pages does: files under a sub-path, `index.html` for
 * directory requests, and a plain 404 for anything else (no single-page-app fallback).
 * Used by the demo e2e run so the proof matches the publication target.
 *
 *   node scripts/serve-static.mjs <dir> <base-path> <port>
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const [dir = 'dist-demo', base = '/atrium-demo/', port = '4174'] = process.argv.slice(2);
const root = resolve(dir);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404).end('Not found');
    return;
  }
  let path = normalize(join(root, decodeURIComponent(url.pathname.slice(base.length))));
  if (!path.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    await stat(path);
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
}).listen(Number(port), '127.0.0.1', () => console.log(`serving ${root} at http://127.0.0.1:${port}${base}`));
