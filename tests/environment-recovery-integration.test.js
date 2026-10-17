import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

// Execute the real main entry points with a renderer boundary fixture. Browser
// restoration still verifies the actual WebGL uploads and resulting lighting.
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const captureStart = main.indexOf('function captureVehicleCube(');
const captureEnd = main.indexOf('async function boot(){', captureStart);
const frameStart = main.indexOf('function frame(now){');
const frameEnd = main.indexOf('\nboot();', frameStart);
assert.ok(captureStart >= 0 && captureEnd > captureStart && frameStart >= 0 && frameEnd > frameStart);

for (const fail of [false, true]) test(`static recovery capture preserves actor and photo state${fail ? ' on render failure' : ''}`, () => {
  const scene = new THREE.Scene(), sun = new THREE.DirectionalLight();
  const actors = [true, false].map(visible => { const mesh = new THREE.Group(); mesh.visible = visible; return { mesh }; });
  const vehicles = [true, false].map(visible => { const mesh = new THREE.Group(); mesh.visible = visible; return { model: { mesh } }; });
  const effects = [{ mesh: new THREE.Group() }], marker = new THREE.Group(); marker.visible = false;
  const roots = [...actors.map(actor => actor.mesh), ...vehicles.map(car => car.model.mesh), effects[0].mesh, marker];
  const visibility = roots.map(root => root.visible);
  scene.background = { name: 'night sky' }; scene.environment = { name: 'night map' };
  scene.environmentRotation.set(.1, .2, .3); sun.position.set(80, 30, -90); sun.target.position.set(40, 0, -70);
  const saved = { background: scene.background, environment: scene.environment, rotation: scene.environmentRotation.clone(),
    sun: sun.position.clone(), target: sun.target.position.clone() };
  let captureTarget, restoreCalls = 0, target = { name: 'previous pass' }, face = 3, mip = 2;
  const originalTarget = target;
  const renderer = { shadowMap: { needsUpdate: false }, toneMappingExposure: 1.43, xr: { enabled: true },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, nextFace, nextMip) { target = value; face = nextFace; mip = nextMip; } };
  const day = { name: 'new day PMREM' }, sky = { texture: {}, lightingTexture: {}, rotation: new THREE.Euler(0, -.7, 0) };
  const context = { THREE: { ...THREE,
    WebGLCubeRenderTarget: class { constructor() { captureTarget = this; this.disposals = 0; } dispose() { this.disposals++; } },
    CubeCamera: class {
      constructor() { this.position = new THREE.Vector3(); }
      update() {
        assert.ok(roots.every(root => root.visible === false), 'hide actual meshes, including actor roots');
        assert.ok(actors.every(actor => !Object.hasOwn(actor, 'visible')), 'actor wrappers are not visibility owners');
        assert.equal(scene.environment, day); assert.equal(scene.background, sky.lightingTexture);
        assert.equal(restoreCalls, 1); assert.equal(sun.shadow.needsUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
        assert.deepEqual(sun.target.position.toArray(), [0, 0, 20]);
        renderer.xr.enabled = false; renderer.setRenderTarget(captureTarget, 5, 0);
        if (fail) throw new Error('capture failed');
      }
    },
  }, scene, sun, sunOffset: new THREE.Vector3(3, 4, 5), renderer, vehicles, effects, marker,
  night: true, photoShadowActors: () => actors,
  world: { restoreInstances() { restoreCalls++; } },
  setTime(value) { context.night = value; renderer.toneMappingExposure = 1; scene.background = {}; scene.environment = {}; },
  };
  vm.createContext(context); vm.runInContext(main.slice(captureStart, captureEnd), context);
  if (fail) assert.throws(() => context.captureVehicleCube(day, sky), /capture failed/);
  else assert.equal(context.captureVehicleCube(day, sky), captureTarget);
  assert.deepEqual(roots.map(root => root.visible), visibility);
  assert.equal(context.night, true); assert.equal(renderer.toneMappingExposure, 1.43);
  assert.equal(scene.background, saved.background); assert.equal(scene.environment, saved.environment);
  assert.ok(scene.environmentRotation.equals(saved.rotation)); assert.ok(sun.position.equals(saved.sun)); assert.ok(sun.target.position.equals(saved.target));
  assert.equal(target, originalTarget); assert.equal(face, 3); assert.equal(mip, 2); assert.equal(renderer.xr.enabled, true);
  assert.equal(captureTarget.disposals, fail ? 1 : 0);
});

test('actual frame gate freezes simulation while unavailable and charges no synchronous rebuild time', () => {
  const updates = [], scheduled = []; let available = false, clock = 1000;
  const environmentLighting = { revision: 0, update: () => available, getInfo: () => ({ error: null }) };
  const context = { environmentLighting, lastEnvironmentBuild: 0, environmentError: null, lastFrame: 10,
    renderFrame: 0, frameCount: 0, fpsTimer: 0, state: { started: true, paused: false, mapOpen: false },
    performance: { now: () => clock }, requestAnimationFrame: callback => scheduled.push(callback),
    ui: { toast() { assert.fail('no failure UI during ordinary context loss'); } },
    updateGame: dt => updates.push(dt), updatePresentation() {}, keys: new Set(), camera: {}, drawingSize: {}, night: false,
    photo: { active: false, update() {}, afterRender() {} },
    renderer: { shadowMap: { enabled: false }, getDrawingBufferSize: value => value },
    world: { updateWires() {}, updateInstanceVisibility() {} }, localSelfShadow: { update() {} }, rendering: { render() {} },
  };
  vm.createContext(context); vm.runInContext(main.slice(frameStart, frameEnd), context);
  context.frame(100); context.frame(200);
  assert.deepEqual(updates, []); assert.equal(context.renderFrame, 0); assert.equal(context.lastFrame, 200);
  available = true; environmentLighting.revision = 1; context.frame(300);
  assert.deepEqual(updates, [0], 'rebuild wall time is excluded from simulation');
  assert.equal(context.lastFrame, 1000);
  clock = 1020; context.frame(1020);
  assert.deepEqual(updates, [0, .02]); assert.equal(scheduled.length, 4);
});

// Exercise the real environment setup and ready commit around the independent
// character/mission initialization, which is outside this failure contract.
const setupStart = main.indexOf('  const [skyData]=', captureEnd);
const setupEnd = main.indexOf('  player=createCharacter', setupStart);
const readyStart = main.indexOf('  updateDrivers(0);ui.update(state);', setupEnd);
const readyEnd = main.indexOf(' }catch(error)', readyStart);
assert.ok(setupStart >= 0 && setupEnd > setupStart && readyStart > setupEnd && readyEnd > readyStart);

for (const mode of ['graphics-error', 'context-lost', 'fallback', 'normal']) {
  test(`boot readiness handles ${mode} without confusing a recoverable loss with a graphics failure`, async () => {
    const texture = { name: mode === 'fallback' ? 'procedural fallback' : 'photographic HDR' };
    const skyData = { texture, lightingTexture: texture, sunDirection: new THREE.Vector3(0, 1, 0) };
    const registrations = [], updates = [], readiness = [];
    const failure = mode === 'graphics-error' ? 'PMREM capture failed' : null;
    const context = { atmosphere: { ready: Promise.resolve(skyData) },
      world: { ready: Promise.resolve(), setSky: value => registrations.push(value) },
      loadCharacterAssets: () => Promise.resolve(),
      sunOffset: new THREE.Vector3(), shadowAnchor: new THREE.Vector3(), sun: new THREE.DirectionalLight(),
      environmentLighting: { setSky: value => registrations.push(value), update: () => { updates.push(1); return mode === 'normal' || mode === 'fallback'; }, getInfo: () => ({ error: failure }) },
      state: { ready: false }, updateDrivers() {},
      ui: { update() {}, setReady: value => readiness.push(value) },
    };
    vm.createContext(context);
    vm.runInContext(`async function checkBootReadiness(){\n${main.slice(setupStart, setupEnd)}\n${main.slice(readyStart, readyEnd)}\n}`, context);
    if (failure) {
      await assert.rejects(context.checkBootReadiness(), /PMREM capture failed/);
      assert.equal(context.state.ready, false); assert.deepEqual(readiness, []);
    } else {
      await context.checkBootReadiness();
      assert.equal(context.state.ready, true); assert.deepEqual(readiness, [true]);
    }
    assert.deepEqual(registrations, [skyData, skyData]); assert.deepEqual(updates, [1]);
  });
}
