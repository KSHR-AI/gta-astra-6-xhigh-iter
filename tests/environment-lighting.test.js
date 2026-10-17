import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentLighting } from '../src/environment-lighting.js';

function disposable(name) {
  return { name, disposals: 0, dispose() { this.disposals++; } };
}
function sky({ night = true, separated = true } = {}) {
  const texture = disposable('background HDR');
  return { texture, lightingTexture: separated ? disposable('lighting HDR') : texture,
    nightTexture: night ? disposable('night HDR') : undefined };
}
function setup() {
  const listeners = new Map();
  const canvas = new EventTarget();
  const add = canvas.addEventListener.bind(canvas), remove = canvas.removeEventListener.bind(canvas);
  canvas.addEventListener = (type, listener) => { listeners.set(type, listener); add(type, listener); };
  canvas.removeEventListener = (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); remove(type, listener); };
  let contextLost = false, currentTarget = { name: 'prior target' }, face = 3, mip = 2;
  const renderer = { domElement: canvas, shadowMap: { needsUpdate: false }, xr: { enabled: true },
    getContext: () => ({ isContextLost: () => contextLost }),
    getRenderTarget: () => currentTarget, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(target, nextFace = 0, nextMip = 0) { currentTarget = target; face = nextFace; mip = nextMip; } };
  const targets = [], generators = [], captures = [], publications = [], inputs = [], hooks = {};
  const target = name => { const value = { ...disposable(name), texture: { name: `${name} texture` } }; targets.push(value); return value; };
  const controller = createEnvironmentLighting({ renderer,
    createPMREM() {
      const generator = { ...disposable('generator'),
        fromEquirectangular(source) { inputs.push(source); hooks.equirect?.(source); return target(`environment ${targets.length}`); },
        fromCubemap(texture) { hooks.cubemap?.(texture); return target(`vehicle ${targets.length}`); } };
      generators.push(generator); return generator;
    },
    captureVehicleCube(day, source) {
      hooks.capture?.(day, source);
      const capture = { ...disposable('cube'), texture: { name: 'captured cube' }, day, source };
      captures.push(capture); return capture;
    },
    apply(maps) { publications.push(maps); hooks.apply?.(maps); },
  });
  function lose() {
    contextLost = true;
    const event = new Event('webglcontextlost', { cancelable: true }); canvas.dispatchEvent(event);
    return event;
  }
  function restore() { contextLost = false; canvas.dispatchEvent(new Event('webglcontextrestored')); }
  const state = () => ({ target: currentTarget, face, mip, xr: renderer.xr.enabled });
  return { controller, renderer, listeners, hooks, targets, generators, captures, publications, inputs, lose, restore, state };
}

test('a restore before sky arrival waits for retained sources and builds only once', () => {
  const f = setup();
  assert.equal(f.lose().defaultPrevented, true);
  assert.equal(f.controller.update(), false);
  f.restore(); assert.equal(f.controller.update(), false);
  assert.equal(f.generators.length, 0);
  const source = sky(); f.controller.setSky(source);
  assert.equal(f.controller.update(), true);
  assert.deepEqual(f.inputs, [source.lightingTexture, source.nightTexture]);
  assert.equal(f.captures[0].day, f.targets[0].texture, 'capture receives the newly rendered day environment');
  assert.equal(f.captures[0].source, source);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
  for (let frame = 0; frame < 10; frame++) assert.equal(f.controller.update(), true);
  assert.equal(f.generators.length, 1); assert.equal(f.publications.length, 1);
  assert.equal(f.generators[0].disposals, 1); assert.equal(f.captures[0].disposals, 1);
  assert.equal(source.lightingTexture.disposals, 1);
  assert.equal(source.texture.disposals, 0); assert.equal(source.nightTexture.disposals, 0);
  assert.deepEqual(f.controller.getInfo(), { ready: true, pending: false, builds: 1, restores: 1, error: null, disposed: false });
});

test('context restoration atomically replaces all maps and disposes previous targets once', () => {
  const f = setup(); f.controller.setSky(sky()); f.controller.update();
  const old = f.targets.slice();
  f.lose(); assert.equal(f.controller.update(), false);
  assert.equal(f.publications.length, 1); assert.ok(old.every(target => target.disposals === 0));
  f.restore();
  f.hooks.apply = maps => {
    assert.ok(old.every(target => target.disposals === 0), 'old maps remain owned until successful publication');
    assert.equal(maps.day, f.targets[3].texture);
    assert.equal(maps.night, f.targets[4].texture);
    assert.equal(maps.vehicle, f.targets[5].texture);
  };
  assert.equal(f.controller.update(), true);
  assert.ok(old.every(target => target.disposals === 1));
  assert.ok(f.targets.slice(3).every(target => target.disposals === 0));
  assert.equal(f.controller.revision, 2);
  f.controller.dispose(); f.controller.dispose();
  assert.ok(f.targets.every(target => target.disposals === 1));
});

test('a missing night source aliases the day target without double disposal or source destruction', () => {
  const f = setup(), source = sky({ night: false, separated: false });
  f.controller.setSky(source); f.controller.update();
  assert.equal(f.publications[0].night, f.publications[0].day);
  assert.equal(f.inputs.length, 1); assert.equal(f.targets.length, 2);
  f.controller.setSky(source); f.controller.update();
  assert.ok(f.targets.slice(0, 2).every(target => target.disposals === 1));
  f.controller.dispose();
  assert.ok(f.targets.every(target => target.disposals === 1));
  assert.equal(source.texture.disposals, 0);
});

test('capture failure cleans partial targets, restores renderer state and does not publish', t => {
  t.mock.method(console, 'error', () => {});
  const f = setup(), before = f.state();
  f.controller.setSky(sky());
  f.hooks.capture = () => { f.renderer.setRenderTarget({ temporary: true }, 5, 4); f.renderer.xr.enabled = false; throw Error('capture failed'); };
  assert.equal(f.controller.update(), false);
  assert.deepEqual(f.state(), before);
  assert.equal(f.targets.length, 2); assert.ok(f.targets.every(target => target.disposals === 1));
  assert.equal(f.publications.length, 0); assert.equal(f.generators[0].disposals, 1);
  assert.equal(f.controller.getInfo().error, 'capture failed');
  assert.equal(f.controller.update(), false); assert.equal(f.generators.length, 1, 'failure does not rebuild/log every frame');
});

test('PMREM filtering failure disposes the returned capture and all new maps', t => {
  t.mock.method(console, 'error', () => {});
  const f = setup(), before = f.state();
  f.controller.setSky(sky());
  f.hooks.cubemap = () => { f.renderer.setRenderTarget({ temporary: true }, 2, 3); f.renderer.xr.enabled = false; throw Error('filter failed'); };
  assert.equal(f.controller.update(), false); assert.deepEqual(f.state(), before);
  assert.equal(f.captures[0].disposals, 1); assert.equal(f.generators[0].disposals, 1);
  assert.ok(f.targets.every(target => target.disposals === 1)); assert.equal(f.publications.length, 0);
});

test('loss during capture never publishes the invalid output and a later restore can rebuild', () => {
  const f = setup(), before = f.state(); f.controller.setSky(sky());
  f.hooks.capture = () => { f.lose(); f.renderer.setRenderTarget({ invalid: true }, 4, 1); };
  assert.equal(f.controller.update(), false); assert.deepEqual(f.state(), before);
  assert.equal(f.publications.length, 0); assert.equal(f.controller.revision, 0);
  assert.equal(f.controller.getInfo().error, null);
  assert.ok(f.targets.every(target => target.disposals === 1));
  assert.equal(f.captures[0].disposals, 1); assert.equal(f.generators[0].disposals, 1);
  delete f.hooks.capture; f.restore();
  assert.equal(f.controller.update(), true); assert.equal(f.controller.revision, 1);
});

test('failed publication rolls bindings back and retains the previous owned targets', t => {
  t.mock.method(console, 'error', () => {});
  const f = setup(); f.controller.setSky(sky()); f.controller.update();
  const oldMaps = f.publications[0], old = f.targets.slice();
  f.controller.setSky(sky()); let fail = true;
  f.hooks.apply = () => { if (fail) { fail = false; throw Error('apply failed'); } };
  assert.equal(f.controller.update(), false);
  assert.deepEqual(f.publications.at(-1), oldMaps);
  assert.ok(old.every(target => target.disposals === 0));
  assert.ok(f.targets.slice(3).every(target => target.disposals === 1));
  assert.equal(f.controller.revision, 1);
  f.controller.dispose(); assert.ok(f.targets.every(target => target.disposals === 1));
});

test('disposal detaches listeners and prevents a late source or restoration from rebuilding', () => {
  const f = setup(); f.controller.setSky(sky()); f.controller.update();
  assert.equal(f.listeners.size, 2); f.controller.dispose();
  assert.equal(f.listeners.size, 0);
  const info = f.controller.getInfo(); info.builds = 50;
  f.lose(); f.restore(); f.controller.setSky(sky()); f.controller.dispose();
  assert.equal(f.controller.update(), false); assert.equal(f.generators.length, 1);
  assert.ok(f.targets.every(target => target.disposals === 1));
  assert.deepEqual(f.controller.getInfo(), { ready: false, pending: false, builds: 1, restores: 0, error: null, disposed: true });
});

test('disposal during capture cleans the in-flight build without publishing it', () => {
  const f = setup(); f.controller.setSky(sky());
  f.hooks.capture = () => f.controller.dispose();
  assert.equal(f.controller.update(), false);
  assert.equal(f.publications.length, 0); assert.equal(f.listeners.size, 0);
  assert.ok(f.targets.every(target => target.disposals === 1));
  assert.equal(f.captures[0].disposals, 1); assert.equal(f.generators[0].disposals, 1);
});
