import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { decodeVehicleProbe, PROBE_WIDTH, PROBE_HEIGHT } from '../src/vehicle-probe.js';

test('shipped native PMREM atlases retain two distinct finite HDR light fields', async () => {
  const atlases = [];
  for (const quality of ['performance', 'high']) {
    const file = await readFile(new URL(`../public/textures/sky/vehicle-probe-${quality}.bin`, import.meta.url));
    const rgba = await decodeVehicleProbe(file, quality);
    assert.equal(rgba.length, PROBE_WIDTH * PROBE_HEIGHT * 4);
    let nonBlack = 0, hdr = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      for (const channel of [rgba[i], rgba[i + 1], rgba[i + 2]]) assert.ok(channel < 0x7c00);
      if (rgba[i]) nonBlack++;
      if (rgba[i] > 0x3c00) hdr++;
    }
    assert.ok(nonBlack > PROBE_WIDTH * PROBE_HEIGHT / 2 && hdr > 100);
    atlases.push(rgba);
  }
  assert.notDeepEqual(atlases[0], atlases[1]);
});

test('an incorrect preset, version or decoded length rejects the bake before GPU use', async () => {
  const file = Buffer.concat([Buffer.from([65,85,80,49,1]), gzipSync(Buffer.from([0]))]);
  await assert.rejects(decodeVehicleProbe(file, 'performance'), /header/);
  await assert.rejects(decodeVehicleProbe(file, 'high'), /Incomplete/);
  file[3] = 0;
  await assert.rejects(decodeVehicleProbe(file, 'high'), /header/);
});
