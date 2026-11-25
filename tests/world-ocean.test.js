import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createOcean } from '../src/world-ocean.js';

function lightingTexture({ half = false, width = 4, height = 2 } = {}) {
  const values = Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 1 : .5);
  const data = half ? Uint16Array.from(values, THREE.DataUtils.toHalfFloat) : Float32Array.from(values);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, half ? THREE.HalfFloatType : THREE.FloatType);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.flipY = true;
  return texture;
}
function sky(lighting = lightingTexture()) {
  return { texture: new THREE.Texture(), lightingTexture: lighting, nightTexture: new THREE.Texture(),
    rotation: new THREE.Euler(0, .73, 0), sunDirection: new THREE.Vector3(-3, 1, 9) };
}
function disposalCount(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

test('water owns a bounded reflection copy that survives release of the source HDR', () => {
  const ocean = createOcean(), input = sky(lightingTexture({ width: 1024, height: 512 }));
  const uniforms = ocean.mesh.material.uniforms;
  const originalPixels = input.lightingTexture.image.data;
  ocean.setNight(true);
  ocean.setSky(input);
  assert.equal(uniforms.sky.value, input.nightTexture, 'Late loading preserves current night mode');
  ocean.setNight(false);
  const reflection = uniforms.sky.value;
  assert.notEqual(reflection, input.lightingTexture);
  assert.notEqual(reflection.image.data, originalPixels);
  assert.ok(reflection.image.width <= 512 && reflection.image.height <= 256);
  assert.ok(reflection.image.data.byteLength <= 1024 * 1024, 'Owned base image stays within 1 MiB');
  assert.equal(reflection.colorSpace, input.lightingTexture.colorSpace);
  assert.equal(reflection.flipY, input.lightingTexture.flipY);
  assert.equal(reflection.generateMipmaps, true);
  input.lightingTexture.dispose();
  originalPixels.fill(0);
  assert.equal(THREE.DataUtils.fromHalfFloat(reflection.image.data[0]), .5, 'Source pixels are not retained as the reflection image');
  assert.equal(THREE.DataUtils.fromHalfFloat(reflection.image.data[3]), 1);
  ocean.setNight(true);
  assert.equal(uniforms.sky.value, input.nightTexture);
  ocean.setNight(false);
  assert.equal(uniforms.sky.value, reflection);
  ocean.dispose();
});

test('half-float lighting data produces a valid owned reflection', () => {
  const ocean = createOcean(), input = sky(lightingTexture({ half: true }));
  ocean.setSky(input);
  const reflection = ocean.mesh.material.uniforms.sky.value;
  assert.notEqual(reflection, input.lightingTexture);
  assert.equal(reflection.type, THREE.HalfFloatType);
  assert.equal(THREE.DataUtils.fromHalfFloat(reflection.image.data[0]), .5);
  assert.equal(ocean.mesh.material.uniforms.analyticSun.value, 1);
  ocean.dispose();
});

test('replacing sky releases the old private texture; teardown releases owned resources exactly once', () => {
  const ocean = createOcean(), first = sky(), second = sky();
  const parent = new THREE.Group(); parent.add(ocean.mesh);
  const borrowed = [first.texture, first.lightingTexture, first.nightTexture,
    second.texture, second.lightingTexture, second.nightTexture].map(disposalCount);
  ocean.setSky(first);
  const oldReflection = disposalCount(ocean.mesh.material.uniforms.sky.value);
  ocean.setSky(second);
  assert.equal(oldReflection(), 1);
  const owned = [ocean.mesh.geometry, ocean.mesh.material,
    ocean.mesh.material.uniforms.foamPattern.value, ocean.mesh.material.uniforms.sky.value].map(disposalCount);
  ocean.dispose(); ocean.dispose();
  assert.deepEqual(owned.map(count => count()), [1, 1, 1, 1]);
  assert.equal(oldReflection(), 1);
  assert.ok(borrowed.every(count => count() === 0), 'The caller retains ownership of every supplied sky');
  assert.equal(parent.children.length, 0);
  assert.equal(ocean.mesh.visible, false);
  assert.equal(ocean.mesh.material.uniforms.sky.value, null);
  assert.equal(ocean.mesh.material.uniforms.foamPattern.value, null);
});

test('late setters cannot read new data, allocate resources or revive a disposed ocean', () => {
  const ocean = createOcean(), uniforms = ocean.mesh.material.uniforms;
  ocean.update(42);
  ocean.dispose();
  const unreadable = new Proxy({}, { get() { throw new Error('Disposed ocean read a new payload'); } });
  assert.equal(ocean.setSky(unreadable), false);
  assert.equal(ocean.setNight(unreadable), false);
  assert.equal(ocean.update(100), false);
  assert.equal(uniforms.time.value, 42);
  assert.equal(uniforms.sky.value, null);
  assert.equal(ocean.mesh.visible, false);
  ocean.dispose();
});

test('unsupported or malformed lighting layouts use the borrowed visible sky without reading pixels', () => {
  const ocean = createOcean(), uniforms = ocean.mesh.material.uniforms;
  const invalid = [
    new THREE.Texture(),
    Object.assign(lightingTexture(), { format: THREE.RGFormat }),
    Object.assign(lightingTexture(), { type: THREE.UnsignedByteType }),
    Object.assign(lightingTexture(), { type: THREE.HalfFloatType }),
    Object.assign(lightingTexture({ half: true }), { type: THREE.FloatType }),
  ];
  for (const patch of [{ width: 0 }, { width: -2 }, { width: 2.5 }, { height: Infinity },
    { data: new Float32Array(4) }, { data: new Float32Array(36) }]) {
    const texture = lightingTexture(); Object.assign(texture.image, patch); invalid.push(texture);
  }
  for (const lighting of invalid) {
    const input = sky(lighting), count = disposalCount(lighting);
    assert.equal(ocean.setSky(input), true);
    assert.equal(uniforms.sky.value, input.texture);
    assert.equal(uniforms.analyticSun.value, 0, 'The fallback sky already contains the photographed sun');
    ocean.setNight(true); assert.equal(uniforms.sky.value, input.nightTexture);
    ocean.setNight(false); assert.equal(uniforms.sky.value, input.texture);
    assert.equal(count(), 0);
  }
  ocean.dispose();
});
