import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { separateSolarEnvironment } from '../src/solar-environment.js';
import { SUN_DIRECTION, SKY_ROTATION } from '../src/atmosphere.js';

test('actual HDR solar separation preserves source/background, alpha and every pixel outside the bounded disc', async () => {
  const bytes = await readFile(new URL('../public/textures/sky/qwantani_sunset_puresky_2k.hdr', import.meta.url));
  const hdr = new HDRLoader().setDataType(THREE.HalfFloatType).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const source = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, THREE.HalfFloatType);
  source.colorSpace = THREE.LinearSRGBColorSpace;
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.flipY = true;
  const original = hdr.data.slice();
  const sourceSun = SUN_DIRECTION.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -SKY_ROTATION).normalize();
  const { texture, stats } = separateSolarEnvironment(source, sourceSun);
  assert.deepEqual(source.image.data, original, 'visible sky is not mutated');
  assert.notEqual(texture.image.data, source.image.data);
  assert.equal(texture.type, source.type);
  assert.equal(texture.colorSpace, source.colorSpace);
  assert.equal(texture.mapping, source.mapping);
  assert.equal(texture.flipY, source.flipY);
  const direction = new THREE.Vector3();
  let changed = 0;
  for (let y = 0; y < hdr.height; y++) for (let x = 0; x < hdr.width; x++) {
    const theta = (y + .5) / hdr.height * Math.PI, phi = ((x + .5) / hdr.width - .5) * 2 * Math.PI;
    direction.set(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const index = (y * hdr.width + x) * 4;
    assert.equal(texture.image.data[index + 3], original[index + 3]);
    let pixelChanged = false;
    for (let k = 0; k < 3; k++) {
      const before = THREE.DataUtils.fromHalfFloat(original[index + k]);
      const after = THREE.DataUtils.fromHalfFloat(texture.image.data[index + k]);
      assert.ok(Number.isFinite(after) && after >= 0 && after <= before, 'does not create energy');
      if (sourceSun.dot(direction) < Math.cos(Math.PI / 180)) assert.equal(after, before, 'wider sky/halo remains exact');
      pixelChanged ||= after !== before;
    }
    changed += Number(pixelChanged);
  }
  assert.equal(stats.changedPixels, changed);
  assert.ok(changed > 50 && changed < 150);
  assert.ok(stats.removedEnergyFraction[0] > .25 && stats.removedEnergyFraction[0] < .4);
  assert.ok(stats.removedEnergyFraction[2] < .025, 'broad blue sky energy is preserved');
  assert.throws(() => separateSolarEnvironment(source, new THREE.Vector3(NaN, 0, 1)), /finite/);
  assert.throws(() => separateSolarEnvironment(source, sourceSun, { outerRadius: 5 }), /bounded/);
  texture.dispose(); source.dispose();
});

test('invalid HDR inputs fail explicitly rather than producing a corrupt lighting map', () => {
  const direction = new THREE.Vector3(1, 0, 0);
  assert.throws(() => separateSolarEnvironment(null, direction), /finite RGBA HDR/);
  const source = new THREE.DataTexture(new Float32Array([NaN, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  assert.throws(() => separateSolarEnvironment(source, direction), /invalid radiance/);
  source.image.data[0] = 1;
  assert.throws(() => separateSolarEnvironment(source, direction), /resolution does not resolve/);
  source.type = THREE.UnsignedByteType;
  assert.throws(() => separateSolarEnvironment(source, direction), /finite RGBA HDR/);
});

test('an unavailable photographic sky retains procedural background and compatible day/night environment selection', async () => {
  const { createAtmosphere } = await import('../src/atmosphere.js');
  const originalLoad = HDRLoader.prototype.loadAsync;
  const originalWarn = console.warn;
  HDRLoader.prototype.loadAsync = async () => { throw new Error('fixture offline'); };
  console.warn = () => {};
  try {
    const scene = new THREE.Scene();
    const atmosphere = createAtmosphere(scene);
    const ready = await atmosphere.ready;
    assert.equal(ready.lightingTexture, ready.texture, 'fallback has no solar disc to extract');
    assert.match(ready.solarSeparationStats.skipped, /fallback/);
    assert.equal(scene.background, ready.texture);
    const day = new THREE.Texture(), night = new THREE.Texture();
    atmosphere.setEnvironment(day, night);
    assert.equal(scene.environment, day);
    atmosphere.setNight(true);
    assert.equal(scene.environment, night);
    assert.equal(scene.background, ready.nightTexture);
    atmosphere.setNight(false);
    assert.equal(scene.environment, day);
    assert.equal(scene.background, ready.texture);
    ready.texture.dispose(); ready.nightTexture.dispose(); day.dispose(); night.dispose();
  } finally {
    HDRLoader.prototype.loadAsync = originalLoad;
    console.warn = originalWarn;
  }
});
