import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.wasm':'application/wasm','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async (req,res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let base = resolve(import.meta.dirname, 'dist');
    let relative = path;
    if (path.startsWith('/models/')) base = resolve(root,'public');
    if (path.startsWith('/godot/')) { base = resolve(root,'benchmarks/godot/web'); relative = path.slice(6); }
    if (path === '/results.json') { base = resolve(root,'benchmarks/results'); relative = '/results.json'; }
    const file = resolve(base, '.' + (relative.endsWith('/') ? relative+'index.html' : relative));
    if (!file.startsWith(base+sep) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-cache','Content-Security-Policy':"frame-ancestors 'self' https://niteshift.dev https://*.niteshift.dev"});
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(Number(process.env.PORT || 3100),'0.0.0.0',()=>console.log('Engine lab listening on port '+(process.env.PORT || 3100)));
