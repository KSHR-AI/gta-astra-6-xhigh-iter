import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEffectMaterialPool } from '../src/effect-material-pool.js';

function fixture(options) {
  const made = [], events = new Map();
  const create = () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true });
    made.push(material); events.set(material, 0);
    material.addEventListener('dispose', () => events.set(material, events.get(material) + 1));
    return material;
  };
  return { pool: createEffectMaterialPool({ particle: create, tracer: create }, options), made, events };
}

test('overlapping effects retain independent opacity and colour, including after reuse', () => {
  const { pool } = fixture();
  const first = pool.acquire('particle', { opacity: .2, color: 0xff0000 });
  const second = pool.acquire('particle', { opacity: .8, color: 0x00ff00 });
  assert.notEqual(first, second);
  first.opacity = .1;
  assert.equal(second.opacity, .8);
  assert.equal(second.color.getHex(), 0x00ff00);
  pool.release(first);
  const reused = pool.acquire('particle', { color: 0x0000ff });
  assert.equal(reused, first);
  assert.equal(reused.opacity, 1);
  assert.equal(reused.color.getHex(), 0x0000ff);
  assert.equal(second.opacity, .8);
  assert.equal(second.color.getHex(), 0x00ff00);
  pool.dispose();
});

test('expiry and restart-style clearing retain material owners without dispose events', () => {
  const { pool, made, events } = fixture();
  const effects = Array.from({ length: 5 }, () => ({ material: pool.acquire('particle') }));
  for (const effect of effects) pool.release(effect.material);
  effects.length = 0;
  const reused = Array.from({ length: 5 }, () => pool.acquire('particle'));
  assert.equal(made.length, 5);
  assert.equal(new Set(reused).size, 5);
  for (const material of made) assert.equal(events.get(material), 0);
  pool.dispose();
});

test('idle retention is bounded per kind without evicting live effects', () => {
  const { pool, events } = fixture({ maxIdlePerKind: 2 });
  const particles = Array.from({ length: 7 }, () => pool.acquire('particle'));
  const tracer = pool.acquire('tracer');
  for (const material of particles) assert.equal(events.get(material), 0);
  particles.forEach(material => pool.release(material));
  assert.deepEqual(particles.map(material => events.get(material)), [0, 0, 1, 1, 1, 1, 1]);
  assert.equal(events.get(tracer), 0);
  assert.equal(pool.acquire('particle'), particles[1]);
  pool.dispose();
  for (const material of [...particles, tracer]) assert.equal(events.get(material), 1);
});

test('duplicate or foreign returns cannot lease an already live material twice', () => {
  const { pool, events } = fixture();
  const first = pool.acquire('particle');
  assert.equal(pool.release(first), true);
  assert.equal(pool.release(first), false);
  const foreign = new THREE.MeshBasicMaterial();
  assert.equal(pool.release(foreign), false);
  const a = pool.acquire('particle'), b = pool.acquire('particle');
  assert.equal(a, first); assert.notEqual(a, b);
  assert.equal(events.get(first), 0);
  pool.dispose(); foreign.dispose();
});

test('final teardown disposes active and idle materials exactly once and prevents resurrection', () => {
  const { pool, made, events } = fixture();
  const active = pool.acquire('particle'), idle = pool.acquire('tracer');
  pool.release(idle);
  pool.dispose(); pool.dispose();
  assert.equal(events.get(active), 1); assert.equal(events.get(idle), 1);
  assert.equal(pool.release(active), false);
  assert.equal(pool.acquire('particle'), null);
  assert.equal(made.length, 2);
});

test('teardown before lazy texture initialization never invokes a factory', () => {
  let calls = 0;
  const pool = createEffectMaterialPool({ flash: () => { calls++; throw new Error('Texture not initialized'); } });
  pool.dispose();
  assert.equal(pool.acquire('flash'), null);
  assert.equal(calls, 0);
});

test('retaining and disposing a sprite material never disposes its borrowed texture', () => {
  const texture = new THREE.Texture(); let textureDisposals = 0;
  texture.addEventListener('dispose', () => textureDisposals++);
  const pool = createEffectMaterialPool({ flash: () => new THREE.SpriteMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }) });
  const flash = pool.acquire('flash');
  assert.equal(flash.map, texture); assert.equal(flash.depthWrite, false);
  pool.release(flash); assert.equal(pool.acquire('flash'), flash);
  pool.dispose(); assert.equal(textureDisposals, 0);
  texture.dispose(); assert.equal(textureDisposals, 1);
});

test('opaque shell flags remain unchanged while reused tracer opacity is configurable', () => {
  const pool = createEffectMaterialPool({
    shell: () => new THREE.MeshStandardMaterial({ color: 0xc29c54, metalness: .75, roughness: .38 }),
    tracer: () => new THREE.LineBasicMaterial({ color: 0xffe5b5, transparent: true, depthWrite: false }),
  });
  const shell = pool.acquire('shell'); shell.opacity = .2; pool.release(shell);
  const nextShell = pool.acquire('shell');
  assert.equal(nextShell, shell); assert.equal(shell.opacity, 1);
  assert.equal(shell.transparent, false); assert.equal(shell.depthWrite, true);
  assert.equal(shell.metalness, .75); assert.equal(shell.roughness, .38);
  const tracer = pool.acquire('tracer', { opacity: .36 }); pool.release(tracer);
  assert.equal(pool.acquire('tracer', { opacity: .3 }), tracer);
  assert.equal(tracer.opacity, .3); assert.equal(tracer.transparent, true); assert.equal(tracer.depthWrite, false);
  pool.dispose();
});
