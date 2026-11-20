// A static file server for the page, with the headers it needs: cross-origin
// isolation (COOP/COEP) and application/wasm. It also takes the page's
// result: the page POSTs it as JSON to /report when opened with
// ?report=/report.
//
// As a program, for opening the page by hand:
//   node tools/serve.mjs [--root build/site] [--port 8000] [--host 127.0.0.1]
// As a module: startServer() (tools/run.mjs uses it).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.wasm': 'application/wasm', '.css': 'text/css', '.txt': 'text/plain; charset=utf-8',
};

const HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

// Serves `root` and calls onReport(result) for every report. Resolves to the
// listening server; server.address().port is the port (0 picks a free one).
export function startServer({ root = 'build/site', port = 0, host = '127.0.0.1', onReport = () => {} } = {}) {
  root = resolve(root);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method === 'POST' && path === '/report') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      res.writeHead(204, HEADERS).end();
      try { onReport(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { console.error('serve: a report that is not JSON'); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, HEADERS).end(); return; }
    const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403, HEADERS).end(); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(404, HEADERS).end();
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opt = { root: 'build/site', port: '8000', host: '127.0.0.1' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    if (!(k in opt)) { console.error(`serve.mjs: unknown option ${argv[i]}`); process.exit(2); }
    opt[k] = argv[i + 1];
  }
  const server = await startServer({
    root: opt.root, port: Number(opt.port), host: opt.host,
    onReport: (r) => console.log(`report: ${r.verdict ? r.verdict.text : 'no verdict'} (${r.userAgent})`),
  });
  console.log(`serving ${resolve(opt.root)} at http://${opt.host}:${server.address().port}/`);
}
