// CHROME_BIN=/path/to/chromium node scripts/bake-vehicle-probes.js
// Run after changes to the district, daylight, solar HDR or Three's PMREM layout.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { decodeVehicleProbe, PROBE_WIDTH as width, PROBE_HEIGHT as height } from '../src/vehicle-probe.js';

function pack(rgba, quality) {
  const pixels = width * height;
  if (rgba.length !== pixels * 8) throw new Error('Unexpected PMREM byte count');
  const planes = Buffer.alloc(rgba.length);
  // Row differences and separate byte planes compress smoothly varying HDR
  // data without changing any half-float bits, including zero-alpha padding.
  for (let channel = 0; channel < 4; channel++) {
    for (let row = 0; row < pixels; row += width) {
      let previous = 0;
      for (let i = row; i < row + width; i++) {
        const sample = rgba.readUInt16LE(2 * (4 * i + channel));
        const delta = (sample - previous) & 65535;
        planes[2 * channel * pixels + i] = delta & 255;
        planes[(2 * channel + 1) * pixels + i] = delta >> 8;
        previous = sample;
      }
    }
  }
  return Buffer.concat([Buffer.from([65, 85, 80, 49, Number(quality === 'high')]), gzipSync(planes, { level: 9 })]);
}

const directory = resolve('public/textures/sky');
const scratch = await mkdtemp(join(tmpdir(), 'astra-vehicle-probe-'));
let accept;
function replace(source, from, to) {
  if (!source.includes(from)) throw new Error(`Capture hook no longer exists: ${from}`);
  return source.replace(from, to);
}
const server = await createServer({
  cacheDir: join(scratch, 'vite'),
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [{
    name: 'read-canonical-vehicle-probe', enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/vehicle-probe.js')) {
        return 'export function loadVehicleProbe(){return {ready:Promise.resolve(),createTarget:()=>null}}';
      }
      if (id.endsWith('/src/main.js')) {
        source = replace(source, "softwareRenderer ? 'performance' : 'high'", "new URLSearchParams(location.search).get('quality')");
        return replace(source, 'renderer.shadowMap.autoUpdate=!softwareRenderer', "renderer.shadowMap.autoUpdate=graphicsQuality==='high'");
      }
      if (id.endsWith('/src/environment-lighting.js')) {
        const hook = 'next.vehicle = pmrem.fromCubemap(capture.texture);';
        return replace(source, hook, hook + `
          if (sky.solarSeparationStats?.skipped) throw Error("The authored HDR failed to load");
          const probe = next.vehicle;
          if (probe.width !== ${width} || probe.height !== ${height}) throw Error("Unexpected PMREM dimensions");
          const bits = new Uint16Array(probe.width * probe.height * 4);
          renderer.readRenderTargetPixels(probe, 0, 0, probe.width, probe.height, bits);
          fetch('/__vehicle_probe', {method:'POST',body:bits.buffer});
        `);
      }
    },
    configureServer(vite) {
      vite.middlewares.use('/__vehicle_probe', async (req, res) => {
        if (!accept || req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        res.end('ok'); accept(bytes);
      });
    },
  }],
});
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  await mkdir(directory, { recursive: true });
  for (const quality of ['performance', 'high']) {
    const captured = new Promise(resolve => { accept = resolve; });
    const args = ['--headless', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--window-size=960,560', `--user-data-dir=${join(scratch, quality)}`, url + '?quality=' + quality];
    if (process.getuid?.() === 0) args.unshift('--no-sandbox');
    const browser = spawn(process.env.CHROME_BIN || 'chromium', args, { stdio: 'ignore' });
    const exited = once(browser, 'exit');
    let timeout;
    try {
      const bytes = await Promise.race([captured, exited.then(() => { throw Error('Chromium exited before capture'); }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Timed out waiting for the vehicle probe')), 120000); })]);
      const name = `vehicle-probe-${quality}.bin`;
      const packed = pack(bytes, quality);
      const decoded = await decodeVehicleProbe(packed, quality);
      if (!bytes.equals(Buffer.from(decoded.buffer)) || !decoded.some(bits => bits > 0x3c00 && bits < 0x7c00)) {
        throw new Error('Vehicle probe failed its lossless HDR round trip');
      }
      await writeFile(join(scratch, name), packed);
      console.log(`Captured ${quality}: ${width} × ${height} native RGBA16F.`);
    } finally {
      clearTimeout(timeout); accept = null;
      browser.kill(); await exited.catch(() => {});
    }
  }
  for (const quality of ['performance', 'high']) {
    const name = `vehicle-probe-${quality}.bin`;
    const temp = join(directory, name + '.tmp');
    try {
      await copyFile(join(scratch, name), temp);
      await rename(temp, join(directory, name));
    } finally { await rm(temp, { force: true }); }
  }
} finally {
  await server.close();
  await rm(scratch, { recursive: true, force: true });
}
