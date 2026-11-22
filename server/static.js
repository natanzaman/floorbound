// Static files (the game's code, Three.js, models, voice lines) with compression and caching, so a page load is small
// and a repeat visit downloads almost nothing:
//  - gzip: text and models are compressed once (zlib level 9) and kept in memory, keyed by the file's size and mtime,
//    so an edited file is picked up on the next request (local play) and the CPU cost is paid once per file.
//  - ETag + 304: the browser revalidates and gets "not modified" for files it already has.
//  - Cache-Control: code and pages are revalidated on every load (`no-cache`: a deploy is seen at once); heavy assets
//    that rarely change (models, Three.js, sounds) are fresh for a day and then revalidated, so a repeat visit doesn't
//    even ask for them.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8', '.yaml': 'text/yaml; charset=utf-8' };
const ZIP = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.glb', '.txt', '.yaml']); // (png and mp3 are compressed already)
const LONG = new Set(['.glb', '.mp3', '.png']); // heavy assets: cached for a day (plus anything under /vendor/)
const MAX_CACHED = 4 << 20; // files bigger than this are streamed as they are, not kept in memory

const cache = new Map(); // file -> { key, ready: Promise<{ etag, raw, gz }> }
const gzipAsync = (buf, opts) => new Promise((res, rej) => zlib.gzip(buf, opts, (err, out) => (err ? rej(err) : res(out))));

// Read and compress off the game loop (zlib runs on libuv's thread pool, so a first load never stalls a tick).
async function load(file, st) {
  const key = `${st.size}:${st.mtimeMs}`;
  const e = cache.get(file);
  if (e?.key === key) return e.ready;
  const ready = (async () => {
    const raw = await fs.promises.readFile(file);
    const gz = ZIP.has(path.extname(file)) ? await gzipAsync(raw, { level: 9 }) : null;
    return { raw, gz: gz && gz.length < raw.length * 0.9 ? gz : null, etag: `"${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"` };
  })();
  cache.set(file, { key, ready });
  ready.catch(() => cache.delete(file));
  return ready;
}

/** Serve `file` for `req`; long = cache it for a day (Three.js under /vendor/). Answers 404 when it isn't there. */
export function serveFile(req, res, file, long = false) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const headers = {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'cache-control': long || LONG.has(ext) ? 'public, max-age=86400' : 'no-cache',
      vary: 'accept-encoding',
    };
    if (st.size > MAX_CACHED) { res.writeHead(200, headers); return fs.createReadStream(file).pipe(res); }
    load(file, st).then(e => send(req, res, e, headers), () => { res.writeHead(404); res.end('Not found'); });
  });
}

function send(req, res, e, headers) {
  headers.etag = e.etag;
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304, headers); return res.end(); }
  const gzip = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gzip) headers['content-encoding'] = 'gzip';
  const body = gzip ? e.gz : e.raw;
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}
