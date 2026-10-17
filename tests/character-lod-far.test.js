import test from 'node:test';
import assert from 'node:assert/strict';
import { compactReferencedVertices, lockPhysicalBoundaries, simplifyFarCharacter } from '../art/blender/character_lod_far.mjs';

test('temporary compaction removes unused seam aliases and roundtrips original oriented vertex IDs', () => {
  const indices = Uint32Array.from([4, 2, 6, 6, 2, 1]);
  const positions = Float32Array.from({ length: 24 }, (_, i) => i / 10);
  const surface = Float32Array.from({ length: 40 }, (_, i) => i / 20);
  const locks = Uint8Array.from([0, 1, 0, 0, 1, 0, 0, 0]);
  const before = { positions: positions.slice(), surface: surface.slice(), indices: indices.slice() };
  const compact = compactReferencedVertices(indices, positions, surface, 5, locks);
  assert.deepEqual(compact.original, [4, 2, 6, 1]);
  assert.deepEqual(Array.from(compact.indices, i => compact.original[i]), Array.from(indices));
  for (const [i, original] of compact.original.entries()) {
    assert.deepEqual(compact.positions.slice(i * 3, i * 3 + 3), positions.slice(original * 3, original * 3 + 3));
    assert.deepEqual(compact.surface.slice(i * 5, i * 5 + 5), surface.slice(original * 5, original * 5 + 5));
    assert.equal(compact.locks[i], locks[original]);
  }
  assert.deepEqual(positions, before.positions); assert.deepEqual(surface, before.surface); assert.deepEqual(indices, before.indices);
});

test('physical boundary locks ignore coincident UV seams but protect every open skin edge', () => {
  // Four triangles around an interior center; its duplicated UV alias must
  // not make it an apparent open border, while all four outside corners lock.
  const positions = new Float32Array([0, 0, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0, 0, 0]);
  const indices = new Uint32Array([0, 1, 2, 5, 2, 3, 0, 3, 4, 5, 4, 1]);
  const locks = new Uint8Array(6);
  lockPhysicalBoundaries(indices, positions, locks);
  assert.deepEqual(Array.from(locks), [0, 1, 1, 1, 1, 0]);
  const hairLocks = new Uint8Array(6);
  lockPhysicalBoundaries(indices, positions, hairLocks, new Float32Array(6));
  assert.deepEqual(Array.from(hairLocks), [0, 0, 0, 0, 0, 0]);
});

test('far simplifier receives posed error channels and restores original IDs without rewriting attributes', () => {
  const positions = new Float32Array([99, 99, 99, 0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array(12), uv = new Float32Array(8), poses = new Float32Array(108);
  poses[27] = .3;
  const attributes = { NORMAL: { values: normals }, TEXCOORD_0: { values: uv } };
  let invoked = false;
  const simplifier = { simplifyWithAttributes(indices, vertices, positionStride, surface, stride, weights, locks) {
    invoked = true; assert.equal(vertices.length, 9); assert.equal(positionStride, 3); assert.equal(stride, 32);
    assert.equal(surface[5], poses[27]); assert.equal(weights.length, 32); assert.equal(weights[5], .5);
    assert.deepEqual(Array.from(locks), [1, 1, 1]);
    return [indices, .01];
  } };
  const result = simplifyFarCharacter({ simplifier, positions, indices: new Uint32Array([1, 2, 3]), attributes, morphLocks: new Uint8Array(4), poses });
  assert.ok(invoked); assert.deepEqual(result.indices, [1, 2, 3]); assert.equal(result.error, .01);
  assert.equal(positions[0], 99, 'unused original source vertex remains untouched');
  assert.throws(() => simplifyFarCharacter({ simplifier, positions, indices: new Uint32Array([1, 2, 3]), attributes, morphLocks: new Uint8Array(4), poses: new Float32Array(3) }), /nine finite/);
});

// Pin the reviewed combined garment/hair/eye rebuild. The fitted male shirt
// intentionally adds surface topology; all original joint prefixes remain
// protected by the appearance/eye tests. Later far-only changes must preserve
// this reviewed near/mid data.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const midFingerprints = {
  Male: 'fd35414f36a8c6262fc67ba47b1ded29e2df606a20bee294d849f12ef78955e1',
  Female: 'a37d2b2a756755281553dbfe9371db6b53044c0a03931d026ab1b59ed19bbe72',
};
for (const sex of ['Male', 'Female']) test(`${sex}: far rebuild preserves authored near/mid data and meets bounded geometry budget`, async () => {
  const directory = process.env.ASTRA_CHARACTER_ASSET_DIR ?? resolve(import.meta.dirname, '../public/models');
  const bytes = await readFile(resolve(directory, `Civilian${sex}Natural.glb`));
  const data = JSON.parse(await readFile(resolve(directory, `Civilian${sex}Natural.lod.json`)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), data.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(data.meshes.map(mesh => mesh.levels[0]))).digest('hex'), midFingerprints[sex]);
  assert.ok(data.meshes.reduce((sum, mesh) => sum + mesh.levels[1].triangles, 0) < (sex === 'Male' ? 5300 : 5000));
  for (const mesh of data.meshes) {
    const far = mesh.levels[1];
    assert.ok(far.indices.every(index => Number.isInteger(index) && index >= 0 && index < mesh.vertices));
    assert.ok(far.error <= .018);
  }
});
