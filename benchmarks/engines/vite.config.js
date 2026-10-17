import { defineConfig } from 'vite';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createReadStream, realpathSync, statSync } from 'node:fs';
const repository = resolve(import.meta.dirname, '../..');
const outside = (root, file) => {
  const path = relative(root, file);
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
};
export default defineConfig({
  publicDir: false,
  server: { host: '0.0.0.0', port: 3100, allowedHosts: ['.preview.niteshift.dev'], fs: { allow: [repository] } },
  plugins: [{ name: 'benchmark-assets', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      let path;
      try { path = decodeURIComponent((req.url ?? '').split('?')[0]); }
      catch { res.statusCode = 400; res.end('Invalid asset URL.'); return; }
      // Keep the historical workload URL stable without shipping the fixture in the game.
      const roots = path === '/models/vehicles/ferrari-lod.glb'
        ? [resolve(repository, 'benchmarks/fixtures'), 'ferrari-lod.glb']
        : path.startsWith('/models/')
        ? [resolve(repository, 'public/models'), path.slice(8)]
        : path.startsWith('/godot/') ? [resolve(repository, 'benchmarks/godot/web'), path.slice(7)] : null;
      if (!roots) return next();
      let file = resolve(roots[0], roots[1]);
      if (path.includes('\0') || outside(roots[0], file)) {
        res.statusCode = 403; res.end('Asset path is outside its root.'); return;
      }
      try {
        let stat = statSync(file);
        if (stat.isDirectory()) {
          file = resolve(file, 'index.html');
          stat = statSync(file);
        }
        if (!stat.isFile()) return next();
        // Keep symlinks confined to the same asset root as ordinary paths.
        if (outside(realpathSync(roots[0]), realpathSync(file))) {
          res.statusCode = 403; res.end('Asset path is outside its root.'); return;
        }
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return next();
        res.statusCode = 500; res.end('Unable to inspect benchmark asset.'); return;
      }
      const ext = extname(file).slice(1).toLowerCase();
      res.setHeader('Content-Type', ({js:'application/javascript',wasm:'application/wasm',html:'text/html',json:'application/json',png:'image/png',glb:'model/gltf-binary'})[ext] ?? 'application/octet-stream');
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      stream.on('error', error => {
        if (res.headersSent) { res.destroy(); return; }
        res.statusCode = error.code === 'ENOENT' ? 404 : 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Unable to read benchmark asset.');
      });
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    });
  }}],
  build: { target: 'es2022', chunkSizeWarningLimit: 1800 },
});
