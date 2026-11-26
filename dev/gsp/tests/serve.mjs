import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
export function serve(port = 18930) {
  const s = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const b = await readFile(path.join(root, p));
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  return new Promise((r) => s.listen(port, () => r({ url: `http://localhost:${port}/`, close: () => s.close() })));
}
