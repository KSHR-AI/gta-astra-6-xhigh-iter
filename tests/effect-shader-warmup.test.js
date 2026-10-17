import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEffectMaterialPool } from '../src/effect-material-pool.js';
import { createEffectShaderWarmup, warmCurrentEffectVariant } from '../src/effect-shader-warmup.js';

function fixture({ failRender = false, throwFactory = false } = {}) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 2, .1, 1400);
  camera.layers.set(2);
  scene.fog = new THREE.FogExp2(0xcdb6a7, .0021);
  scene.environment = new THREE.Texture(); scene.environmentIntensity = .7;
  scene.environmentRotation.set(.1, .2, .3);
  const parent = new THREE.Group(); parent.position.set(3, 2, 1); scene.add(parent);
  const sun = new THREE.DirectionalLight(); sun.castShadow = true; sun.layers.set(2);
  sun.position.set(4, 5, 6); sun.target.position.set(1, 2, 3); scene.add(sun.target); parent.add(sun);
  const hidden = new THREE.PointLight(); hidden.visible = false; hidden.layers.set(2); scene.add(hidden);
  const wrongLayer = new THREE.PointLight(); scene.add(wrongLayer);
  const texture = new THREE.Texture(); let textureDisposals = 0;
  texture.addEventListener('dispose', () => textureDisposals++);
  let materialDisposals = 0;
  const factories = {
    flash: () => new THREE.SpriteMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    shell: () => new THREE.MeshStandardMaterial({ metalness: .75, roughness: .38 }),
    tracer: () => new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }),
    particle: () => { if (throwFactory) throw Error('factory failure'); return new THREE.MeshBasicMaterial({ transparent: true }); },
  };
  for (const [kind, create] of Object.entries(factories)) factories[kind] = () => {
    const value = create(); value.addEventListener('dispose', () => materialDisposals++); return value;
  };
  const materials = createEffectMaterialPool(factories);
  const originalTarget = new THREE.WebGLRenderTarget(2, 2), xr = { enabled: true };
  const shadowMap = { enabled: true, type: THREE.PCFSoftShadowMap, autoUpdate: true, needsUpdate: true };
  let currentTarget = originalTarget, face = 3, mip = 2, contextLost = false;
  const captures = [], resourceDisposals = { target: 0, geometry: 0, spriteGeometry: 0 };
  const renderer = {
    xr, shadowMap,
    getContext: () => ({ isContextLost: () => contextLost }),
    getRenderTarget: () => currentTarget, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(target, nextFace = 0, nextMip = 0) {
      currentTarget = target; face = nextFace; mip = nextMip;
      if (target !== originalTarget) target.addEventListener('dispose', () => resourceDisposals.target++);
    },
    render(warm, view) {
      const objects = warm.children.filter(child => !child.isLight);
      const lights = warm.children.filter(child => child.isLight);
      for (const object of objects) object.geometry.addEventListener('dispose', () => resourceDisposals[object.isSprite ? 'spriteGeometry' : 'geometry']++);
      captures.push({ warm, view, objects, lights, target: currentTarget });
      assert.equal(warm.fog, scene.fog); assert.equal(warm.environment, scene.environment);
      assert.equal(warm.environmentIntensity, .7); assert.deepEqual(warm.environmentRotation.toArray(), scene.environmentRotation.toArray());
      assert.equal(currentTarget.texture.type, THREE.HalfFloatType); assert.equal(currentTarget.width, 1); assert.equal(currentTarget.height, 1);
      assert.equal(xr.enabled, false); assert.equal(shadowMap.enabled, true); assert.equal(shadowMap.type, THREE.PCFSoftShadowMap);
      assert.equal(shadowMap.autoUpdate, false); assert.equal(shadowMap.needsUpdate, false);
      assert.equal(lights.length, 1); assert.notEqual(lights[0], sun); assert.equal(lights[0].castShadow, true);
      assert.deepEqual(lights[0].position.toArray(), [7, 7, 7]); assert.deepEqual(lights[0].target.position.toArray(), [1, 2, 3]);
      assert.equal(lights[0].shadow.map, null);
      assert.equal(objects.length, 4); assert.equal(new Set(objects.map(o => o.material)).size, 4);
      for (const object of objects) { assert.equal(object.layers.mask, view.layers.mask); assert.equal(object.frustumCulled, false); }
      assert.equal(sun.parent, parent); assert.equal(scene.children.includes(warm), false);
      if (failRender) throw Error('render failure');
    },
  };
  return { renderer, scene, camera, materials, captures, resourceDisposals, originalTarget, sun, parent,
    materialDisposals: () => materialDisposals, textureDisposals: () => textureDisposals,
    setLost: value => { contextLost = value; } };
}

function assertRestored(f) {
  assert.equal(f.renderer.getRenderTarget(), f.originalTarget);
  assert.equal(f.renderer.getActiveCubeFace(), 3); assert.equal(f.renderer.getActiveMipmapLevel(), 2);
  assert.equal(f.renderer.xr.enabled, true); assert.equal(f.renderer.shadowMap.autoUpdate, true);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
  assert.equal(f.sun.parent, f.parent); assert.equal(f.materialDisposals(), 0); assert.equal(f.textureDisposals(), 0);
}

test('warmup draws only four isolated effects using actual scene lighting and retains their materials', () => {
  const f = fixture();
  assert.equal(warmCurrentEffectVariant(f), true);
  assertRestored(f); assert.equal(f.captures.length, 1);
  assert.equal(f.captures[0].warm.children.length, 0);
  assert.deepEqual(f.resourceDisposals, { target: 1, geometry: 3, spriteGeometry: 0 });
  const retained = new Set(f.captures[0].objects.map(object => object.material));
  for (const kind of ['flash', 'shell', 'tracer', 'particle']) assert.ok(retained.has(f.materials.acquire(kind)));
  f.materials.dispose(); assert.equal(f.materialDisposals(), 4); assert.equal(f.textureDisposals(), 0);
});

test('a draw failure restores renderer state and releases leases/owned GPU resources', () => {
  const f = fixture({ failRender: true });
  assert.throws(() => warmCurrentEffectVariant(f), /render failure/);
  assertRestored(f);
  assert.deepEqual(f.resourceDisposals, { target: 1, geometry: 3, spriteGeometry: 0 });
  assert.equal(f.captures[0].warm.children.length, 0);
  f.materials.dispose(); assert.equal(f.materialDisposals(), 4);
});

test('partial material acquisition failure returns earlier leases without drawing', () => {
  const f = fixture({ throwFactory: true });
  assert.throws(() => warmCurrentEffectVariant(f), /factory failure/);
  assertRestored(f); assert.equal(f.captures.length, 0);
  f.materials.dispose(); assert.equal(f.materialDisposals(), 3);
});

test('lost context or disposed pool does not draw or create new material owners', () => {
  const f = fixture(); f.setLost(true);
  assert.equal(warmCurrentEffectVariant(f), false); assert.equal(f.captures.length, 0);
  f.setLost(false); f.materials.dispose();
  assert.equal(warmCurrentEffectVariant(f), false); assert.equal(f.captures.length, 0);
  assertRestored(f); assert.equal(f.materialDisposals(), 0);
});

test('boot and each successful environment revision warm once; normal frames and restart do not', () => {
  let calls = 0, lost = false;
  const renderer = { getContext: () => ({ isContextLost: () => lost }) };
  const warmup = createEffectShaderWarmup({ renderer, prepare: () => { calls++; return true; } });
  assert.equal(warmup.update(1), true);
  for (let i = 0; i < 10; i++) assert.equal(warmup.update(1), true);
  assert.equal(calls, 1);
  lost = true; assert.equal(warmup.update(2), false); assert.equal(calls, 1);
  lost = false; assert.equal(warmup.update(2), true); assert.equal(calls, 2);
  assert.deepEqual(warmup.getInfo(), { ready: true, revision: 2, warms: 2, error: null, disposed: false });
});

test('context loss during a preparation remains recoverable and cannot mark it complete', () => {
  let calls = 0, lost = false;
  const renderer = { getContext: () => ({ isContextLost: () => lost }) };
  const warmup = createEffectShaderWarmup({ renderer, prepare: () => { calls++; if (calls === 1) { lost = true; throw Error('context lost'); } return true; } });
  assert.equal(warmup.update(1), false); assert.equal(warmup.getInfo().error, null); assert.equal(warmup.getInfo().warms, 0);
  lost = false; assert.equal(warmup.update(2), true); assert.equal(warmup.getInfo().warms, 1);
});

test('noncontext failures permit normal rendering, report once, and retry after an environment rebuild', () => {
  let calls = 0; const failures = [];
  const renderer = { getContext: () => ({ isContextLost: () => false }) };
  const warmup = createEffectShaderWarmup({ renderer, prepare: () => { if (++calls === 1) throw Error('shader failure'); return true; }, onError: error => failures.push(error.message) });
  assert.equal(warmup.update(1), true); assert.equal(warmup.getInfo().error, 'shader failure');
  assert.equal(warmup.getInfo().ready, false); assert.equal(warmup.update(1), true); assert.equal(calls, 1);
  assert.deepEqual(failures, ['shader failure']);
  assert.equal(warmup.update(2), true); assert.equal(calls, 2); assert.equal(warmup.getInfo().error, null);
});

test('false preparation result latches safely and final disposal prevents later work', () => {
  let calls = 0;
  const renderer = { getContext: () => ({ isContextLost: () => false }) };
  const warmup = createEffectShaderWarmup({ renderer, prepare: () => { calls++; return false; } });
  assert.equal(warmup.update(1), true); assert.match(warmup.getInfo().error, /prepare shot effects/);
  assert.equal(warmup.update(1), true); assert.equal(calls, 1);
  warmup.dispose(); warmup.dispose(); assert.equal(warmup.update(2), false); assert.equal(calls, 1);
});
