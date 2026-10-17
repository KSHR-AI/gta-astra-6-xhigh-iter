import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEffectMaterialPool } from '../src/effect-material-pool.js';
import { createEffectShaderWarmup, warmKnownEffectVariants } from '../src/effect-shader-warmup.js';

function materialPool({ failParticle = false } = {}) {
  const disposals = [], created = [];
  const factories = {
    flash: () => new THREE.SpriteMaterial({ transparent: true }),
    shell: () => new THREE.MeshStandardMaterial(),
    tracer: () => new THREE.LineBasicMaterial(),
    particle: () => { if (failParticle) throw Error('factory failed'); return new THREE.MeshBasicMaterial(); },
  };
  for (const [kind, create] of Object.entries(factories)) factories[kind] = () => {
    const material = create(); created.push(material);
    material.addEventListener('dispose', () => disposals.push(material));
    return material;
  };
  return { pool: createEffectMaterialPool(factories), disposals, created };
}

test('four retained owners survive live-pool overflow and are reused across rebuilds', () => {
  const f = materialPool(), captured = [];
  const renderer = { getContext: () => ({ isContextLost: () => false }) };
  const warmup = createEffectShaderWarmup({ renderer, materials: f.pool,
    prepare: materials => { captured.push(materials); return true; } });
  assert.equal(warmup.update(1), true);
  assert.equal(f.created.length, 4);
  const retained = new Set(Object.values(captured[0]));
  for (const kind of ['flash', 'shell', 'tracer', 'particle']) {
    const live = Array.from({ length: 18 }, () => f.pool.acquire(kind));
    assert.ok(live.every(material => !retained.has(material)), 'live opacity/color never shares a retained owner');
    live.reverse().forEach(material => f.pool.release(material));
  }
  assert.ok(f.disposals.length > 0, 'the actual pool eviction path was exercised');
  assert.ok(f.disposals.every(material => !retained.has(material)));
  assert.equal(warmup.update(1), true); assert.equal(captured.length, 1);
  assert.equal(warmup.update(2), true); assert.equal(captured[1], captured[0]);
  warmup.dispose(); warmup.dispose();
  assert.ok([...retained].every(material => f.disposals.includes(material)), 'full idle buckets dispose returned owners at teardown');
  const before = f.created.length;
  assert.equal(warmup.update(3), false); assert.equal(f.created.length, before);
  f.pool.dispose(); assert.equal(new Set(f.disposals).size, f.created.length);
});

test('partial retention failure returns earlier leases and does not repeat each frame', () => {
  const f = materialPool({ failParticle: true }); let calls = 0;
  const warmup = createEffectShaderWarmup({ renderer: { getContext: () => ({ isContextLost: () => false }) },
    materials: f.pool, prepare: () => { calls++; return true; } });
  assert.equal(warmup.update(1), true); assert.equal(calls, 0);
  assert.equal(warmup.getInfo().error, 'factory failed');
  assert.equal(warmup.update(1), true); assert.equal(f.created.length, 3);
  for (const kind of ['flash', 'shell', 'tracer']) assert.ok(f.created.includes(f.pool.acquire(kind)));
  warmup.dispose(); f.pool.dispose(); assert.equal(f.disposals.length, 3);
});

function sceneFixture(failAt = -1) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 2, .1, 1400);
  scene.fog = new THREE.FogExp2(0xcdb6a7, .0021);
  const dayEnvironment = new THREE.Texture(), nightEnvironment = new THREE.Texture();
  scene.environment = nightEnvironment; scene.environmentIntensity = .55;
  const parent = new THREE.Group(); parent.position.set(3, 2, 1); scene.add(parent);
  const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.position.set(4, 5, 6); parent.add(sun);
  const targetParent = new THREE.Group(); targetParent.position.set(1, 2, 3); targetParent.add(sun.target); scene.add(targetParent);
  const hemisphere = new THREE.HemisphereLight(); scene.add(hemisphere);
  const streetLights = Array.from({ length: 4 }, (_, i) => { const light = new THREE.PointLight(); light.visible = false; light.position.set(i, 8, i); scene.add(light); return light; });
  const headlights = Array.from({ length: 2 }, (_, i) => { const light = new THREE.SpotLight(); light.visible = false; light.position.set(i, 1, 4); light.target.position.set(i, 0, 20); scene.add(light, light.target); return light; });
  const originals = [sun, hemisphere, ...streetLights, ...headlights];
  const before = originals.map(light => ({ parent: light.parent, visible: light.visible, position: light.position.clone(), rotation: light.quaternion.clone() }));
  const f = materialPool(), retainedMaterials = Object.fromEntries(['flash', 'shell', 'tracer', 'particle'].map(kind => [kind, f.pool.acquire(kind)]));
  const originalTarget = new THREE.WebGLRenderTarget(2, 2), captures = [];
  let target = originalTarget, face = 3, mip = 2, targetDisposals = 0;
  const geometryDisposals = new Set();
  const renderer = {
    xr: { enabled: true }, shadowMap: { enabled: false, type: THREE.PCFSoftShadowMap, autoUpdate: true, needsUpdate: true },
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(next, nextFace = 0, nextMip = 0) { target = next; face = nextFace; mip = nextMip;
      if (next !== originalTarget) next.addEventListener('dispose', () => targetDisposals++); },
    render(warm, view) {
      const lights = warm.children.filter(object => object.isLight && object.visible);
      const objects = warm.children.filter(object => !object.isLight);
      const copy = lights.find(light => light.isDirectionalLight);
      assert.notEqual(copy, sun); assert.equal(copy.shadow.map, null);
      assert.deepEqual(copy.position.toArray(), [7, 7, 7]); assert.deepEqual(copy.target.position.toArray(), [1, 2, 3]);
      assert.equal(renderer.xr.enabled, false); assert.equal(renderer.shadowMap.autoUpdate, false); assert.equal(renderer.shadowMap.needsUpdate, false);
      assert.ok(objects.every(object => !object.frustumCulled && object.layers.mask === view.layers.mask));
      for (const object of objects) object.geometry.addEventListener('dispose', () => geometryDisposals.add(object.geometry));
      captures.push({ environment: warm.environment, shadows: renderer.shadowMap.enabled,
        count: { point: lights.filter(light => light.isPointLight).length, spot: lights.filter(light => light.isSpotLight).length },
        objects, versions: objects.map(object => object.material.version), target });
      if (captures.length === failAt) throw Error('draw failed');
    },
  };
  return { scene, camera, sun, hemisphere, streetLights, headlights, dayEnvironment, nightEnvironment,
    renderer, retainedMaterials, captures, pool: f.pool, disposals: f.disposals,
    assertRestored() {
      assert.equal(renderer.getRenderTarget(), originalTarget); assert.equal(face, 3); assert.equal(mip, 2);
      assert.equal(renderer.xr.enabled, true); assert.equal(renderer.shadowMap.enabled, false);
      assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
      assert.equal(scene.environment, nightEnvironment); assert.equal(scene.environmentIntensity, .55);
      originals.forEach((light, i) => { assert.equal(light.parent, before[i].parent); assert.equal(light.visible, before[i].visible);
        assert.ok(light.position.equals(before[i].position)); assert.ok(light.quaternion.equals(before[i].rotation)); });
      assert.equal(targetDisposals, 1); assert.equal(geometryDisposals.size, 3, 'shared sprite geometry remains alive');
      assert.equal(f.disposals.length, 0, 'retained material leases remain owned by the controller/pool');
    } };
}

test('all six modes share one target and actual material owners without mutating live lighting', () => {
  const f = sceneFixture(); assert.equal(warmKnownEffectVariants(f), true);
  assert.equal(f.captures.length, 6);
  assert.deepEqual(f.captures.map(capture => [capture.count.point, capture.count.spot, capture.shadows]),
    [[0, 0, true], [0, 0, false], [4, 0, true], [4, 0, false], [4, 2, true], [4, 2, false]]);
  assert.deepEqual(f.captures.map(capture => capture.environment),
    [f.dayEnvironment, f.dayEnvironment, f.nightEnvironment, f.nightEnvironment, f.nightEnvironment, f.nightEnvironment]);
  for (let i = 1; i < f.captures.length; i++) {
    assert.equal(f.captures[i].target, f.captures[0].target);
    f.captures[i].objects.forEach((object, j) => { assert.equal(object, f.captures[0].objects[j]);
      assert.equal(f.captures[i].versions[j], f.captures[i - 1].versions[j] + 1); });
  }
  f.assertRestored(); f.pool.dispose(); assert.equal(f.disposals.length, 4);
});

test('a mid-batch draw failure restores quality, transforms, environment and retained ownership', () => {
  const f = sceneFixture(4); assert.throws(() => warmKnownEffectVariants(f), /draw failed/);
  assert.equal(f.captures.length, 4); f.assertRestored(); f.pool.dispose();
});
