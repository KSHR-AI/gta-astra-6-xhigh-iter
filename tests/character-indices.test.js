import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { optimizeCharacterAsset } from '../art/blender/character_indices.mjs';

// These readers are independent of the optimizer: compare authored surfaces,
// not its own reports or the triangle sequence it chooses.
const hash = data => createHash('sha256').update(data).digest('hex');
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function parse(buffer) {
  let json, binary;
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset), kind = buffer.readUInt32LE(offset + 4);
    if (kind === 0x4e4f534a) json = JSON.parse(buffer.toString('utf8', offset + 8, offset + 8 + length));
    if (kind === 0x004e4942) binary = buffer.subarray(offset + 8, offset + 8 + length);
    offset += length + 8;
  }
  return { json, binary };
}
function accessor(asset, id) {
  const a = asset.json.accessors[id], view = asset.json.bufferViews[a.bufferView];
  const size = widths[a.type] * sizes[a.componentType], result = Buffer.alloc(a.count * size);
  for (let i = 0; i < a.count; i++) {
    const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? size);
    asset.binary.copy(result, i * size, offset, offset + size);
  }
  return result;
}
function indexes(asset, primitive) {
  if (primitive.indices === undefined) return Array.from({ length: asset.json.accessors[primitive.attributes.POSITION].count }, (_, i) => i);
  const a = asset.json.accessors[primitive.indices], bytes = accessor(asset, primitive.indices), size = sizes[a.componentType];
  const read = { 1: 'readUInt8', 2: 'readUInt16LE', 4: 'readUInt32LE' }[size];
  return Array.from({ length: a.count }, (_, i) => bytes[read](i * size));
}
function attributes(primitive) {
  return [...Object.entries(primitive.attributes), ...(primitive.targets ?? []).flatMap((target, i) =>
    Object.entries(target).map(([name, id]) => [`morph${i}:${name}`, id]))].sort(([a], [b]) => a.localeCompare(b));
}
function oriented(values) {
  const triangles = [];
  for (let i = 0; i < values.length; i += 3) {
    const [a, b, c] = values.slice(i, i + 3);
    // Cyclic rotation preserves winding; reversing a face does not.
    triangles.push([`${a},${b},${c}`, `${b},${c},${a}`, `${c},${a},${b}`].sort()[0]);
  }
  return triangles.sort();
}
function fingerprint(asset) {
  const attributeHash = createHash('sha256'), surfaceHash = createHash('sha256'), blendHash = createHash('sha256');
  for (const mesh of asset.json.meshes) for (const primitive of mesh.primitives) {
    const count = asset.json.accessors[primitive.attributes.POSITION].count;
    const payloads = attributes(primitive).map(([name, id]) => {
      const a = asset.json.accessors[id], bytes = accessor(asset, id), size = bytes.length / a.count;
      attributeHash.update(JSON.stringify([name, a.count, a.componentType, a.type, a.normalized ?? false]));
      attributeHash.update(bytes); return { bytes, size };
    });
    const keys = Array.from({ length: count }, (_, i) => hash(Buffer.concat(
      payloads.map(({ bytes, size }) => bytes.subarray(i * size, (i + 1) * size)))));
    surfaceHash.update(JSON.stringify(oriented(indexes(asset, primitive).map(i => keys[i]))));
    if (asset.json.materials[primitive.material]?.alphaMode === 'BLEND') blendHash.update(JSON.stringify(indexes(asset, primitive)));
  }
  const json = asset.json;
  const rig = { nodes: json.nodes, skins: json.skins, animations: json.animations, scenes: json.scenes, scene: json.scene,
    inverseBind: json.skins?.map(skin => skin.inverseBindMatrices === undefined ? null : accessor(asset, skin.inverseBindMatrices).toString('base64')) };
  const material = { materials: json.materials, textures: json.textures, images: json.images, samplers: json.samplers,
    imageBytes: json.images?.map(image => {
      const view = json.bufferViews[image.bufferView];
      return view ? hash(asset.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)) : null;
    }), extensions: json.extensions, extensionsRequired: json.extensionsRequired, extensionsUsed: json.extensionsUsed };
  return { attributes: attributeHash.digest('hex'), orientedSurfaces: surfaceHash.digest('hex'), blendOrder: blendHash.digest('hex'),
    rig: hash(JSON.stringify(rig)), materials: hash(JSON.stringify(material)) };
}

function encode(json, binary) {
  const text = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonLength + binaryLength);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12); output.writeUInt32LE(0x4e4f534a, 16);
  output.fill(32, 20, 20 + jsonLength); text.copy(output, 20);
  output.writeUInt32LE(binaryLength, 20 + jsonLength); output.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(output, 28 + jsonLength); return output;
}

const definitions = {
  POSITION: [Float32Array, 5126, 'VEC3'], NORMAL: [Float32Array, 5126, 'VEC3'],
  TEXCOORD_0: [Float32Array, 5126, 'VEC2'], JOINTS_0: [Uint16Array, 5123, 'VEC4'],
  WEIGHTS_0: [Float32Array, 5126, 'VEC4'], COLOR_0: [Uint8Array, 5121, 'VEC4', true],
  TANGENT: [Float32Array, 5126, 'VEC4'], _SKIN_MASK: [Float32Array, 5126, 'SCALAR'],
  _HAIR_MASK: [Float32Array, 5126, 'SCALAR'], _CUSTOM_VECTOR: [Float32Array, 5126, 'VEC2'],
  'morph0:POSITION': [Float32Array, 5126, 'VEC3'], 'morph0:NORMAL': [Float32Array, 5126, 'VEC3'],
  'morph0:TANGENT': [Float32Array, 5126, 'VEC3'],
};
function vertex(corner) {
  const [x, y] = [[0, 0], [1, 0], [0, 1]][corner];
  return { POSITION: [x, y, 0], NORMAL: [0, 0, 1], TEXCOORD_0: [x, y], JOINTS_0: [0, 1, 0, 0],
    WEIGHTS_0: [.75, .25, 0, 0], COLOR_0: [255, 128, 64, 255], TANGENT: [1, 0, 0, 1],
    _SKIN_MASK: [.5], _HAIR_MASK: [0], _CUSTOM_VECTOR: [.25, .75],
    'morph0:POSITION': [0, .1, 0], 'morph0:NORMAL': [0, 0, 0], 'morph0:TANGENT': [0, 0, 0] };
}
function fixture({ variants = [], primitives = [{ alphaMode: 'OPAQUE' }], sharedIndex = false, includeSidecar = false } = {}) {
  // Two identical triangles, then a seam for each independently changed attribute.
  const vertices = [...[0, 1, 2, 0, 1, 2].map(vertex)];
  for (const name of variants) {
    const triangle = [0, 1, 2].map(vertex);
    if (name === 'WEIGHTS_0') triangle[0][name] = [.5, .5, 0, 0];
    else if (name === 'NORMAL') triangle[0][name] = [1, 0, 0];
    else if (name === 'TANGENT') triangle[0][name] = [0, 1, 0, 1];
    else triangle[0][name][0] += name === 'COLOR_0' ? -1 : 1;
    vertices.push(...triangle);
  }
  const json = { asset: { version: '2.0', generator: 'independent index fixture' }, buffers: [{ byteLength: 0 }],
    bufferViews: [], accessors: [], materials: primitives.map(p => ({ name: p.alphaMode, alphaMode: p.alphaMode })),
    meshes: [{ name: 'Body', primitives: [] }], nodes: [{ name: 'Actor', mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  let binary = Buffer.alloc(0);
  function append(array, componentType, type, normalized = false, target = 34962) {
    const start = Math.ceil(binary.length / 4) * 4, raw = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const next = Buffer.alloc(start + raw.length); binary.copy(next); raw.copy(next, start); binary = next;
    const bufferView = json.bufferViews.length; json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: raw.length, target });
    const id = json.accessors.length;
    json.accessors.push({ bufferView, componentType, type, count: array.length / widths[type], ...(normalized ? { normalized } : {}) }); return id;
  }
  const attrs = {}, morph = {};
  for (const [name, [Type, componentType, type, normalized]] of Object.entries(definitions)) {
    const id = append(new Type(vertices.flatMap(v => v[name])), componentType, type, normalized);
    if (name.startsWith('morph0:')) morph[name.slice(7)] = id; else attrs[name] = id;
  }
  let shared;
  for (const [i, p] of primitives.entries()) {
    const primitive = { attributes: { ...attrs }, targets: [{ ...morph }], material: i, mode: p.mode ?? 4 };
    if (p.indexed) {
      if (!sharedIndex || shared === undefined) shared = append(Uint16Array.from({ length: vertices.length }, (_, k) => k), 5123, 'SCALAR', false, 34963);
      primitive.indices = shared;
    }
    json.meshes[0].primitives.push(primitive);
  }
  json.buffers[0].byteLength = binary.length;
  const glb = encode(json, binary);
  const sidecar = { version: 1, source: 'Fixture.glb', sha256: hash(glb), meshes: includeSidecar ? primitives.map((_, primitive) => ({
    mesh: 0, primitive, vertices: vertices.length, triangles: vertices.length / 3,
    levels: [1, 2].map(() => ({ indices: Array.from({ length: vertices.length }, (_, i) => i), error: 0, triangles: vertices.length / 3 })),
  })) : [] };
  return { glb, sidecar, variants };
}

// Deliberately reorder faces and remap vertex IDs, exercising restoration of
// IDs independently of meshoptimizer's heuristic or any temporary installation.
function encoderFixture() {
  let calls = 0;
  return {
    get calls() { return calls; },
    reorderMesh(indices) {
      calls++;
      const order = [];
      for (let i = indices.length - 3; i >= 0; i -= 3) order.push(indices[i + 1], indices[i + 2], indices[i]);
      const remap = new Uint32Array(Math.max(...indices) + 1).fill(0xffffffff); let unique = 0;
      for (let i = 0; i < order.length; i++) {
        if (remap[order[i]] === 0xffffffff) remap[order[i]] = unique++;
        indices[i] = remap[order[i]];
      }
      return [remap, unique];
    },
  };
}

function immutableAttributes(before, after) {
  for (const mesh of before.json.meshes) for (const primitive of mesh.primitives) for (const [, id] of attributes(primitive)) {
    assert.deepEqual(after.json.accessors[id], before.json.accessors[id]);
    assert.deepEqual(accessor(after, id), accessor(before, id));
  }
}

test('exact body indexing keeps seams in every attribute and morph target while retaining every original vertex ID', () => {
  const input = fixture({ variants: Object.keys(definitions) }), original = Buffer.from(input.glb), sidecar = structuredClone(input.sidecar);
  const result = optimizeCharacterAsset(input.glb, input.sidecar, encoderFixture());
  const before = parse(original), after = parse(result.glb), primitive = after.json.meshes[0].primitives[0];
  immutableAttributes(before, after);
  assert.equal(after.json.accessors[primitive.attributes.POSITION].count, 6 + Object.keys(definitions).length * 3);
  // Vertex IDs 3,4,5 and each later B/C are exact duplicates; seam vertices
  // must retain their own old ID even when POSITION alone is identical.
  const expected = new Set([0, 1, 2, ...Object.keys(definitions).map((_, i) => 6 + i * 3)]);
  assert.deepEqual(new Set(indexes(after, primitive)), expected);
  assert.equal(fingerprint(before).orientedSurfaces, fingerprint(after).orientedSurfaces);
  assert.deepEqual(input.glb, original, 'the caller buffer is immutable');
  assert.deepEqual(input.sidecar, sidecar, 'the caller sidecar is immutable');
});

test('indexing rejects missing authored normals rather than changing loader-generated smoothing', () => {
  const input = fixture(), parsed = parse(input.glb);
  delete parsed.json.meshes[0].primitives[0].attributes.NORMAL;
  const glb = encode(parsed.json, parsed.binary), sidecar = { ...input.sidecar, sha256: hash(glb) };
  const encoder = encoderFixture();
  assert.throws(() => optimizeCharacterAsset(glb, sidecar, encoder), /normal/i);
  assert.equal(encoder.calls, 0, 'shading prerequisites are checked before geometry is reordered');
});

test('both indexed and nonindexed alpha-BLEND geometry retain draw order and topology', () => {
  const input = fixture({ primitives: [{ alphaMode: 'BLEND', indexed: true }, { alphaMode: 'BLEND' }], includeSidecar: true });
  const encoder = encoderFixture(), before = parse(input.glb), result = optimizeCharacterAsset(input.glb, input.sidecar, encoder), after = parse(result.glb);
  assert.equal(encoder.calls, 0, 'transparent faces must not enter the optimizer');
  assert.deepEqual(after.json.meshes, before.json.meshes);
  assert.deepEqual(after.binary.subarray(0, before.binary.length), before.binary);
  assert.deepEqual(result.sidecar.meshes, input.sidecar.meshes);
});

test('opaque and alpha-MASK index ordering preserve oriented faces and sidecar vertex references', () => {
  const input = fixture({ primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'MASK', indexed: true }], includeSidecar: true });
  const before = parse(input.glb), encoder = encoderFixture(), result = optimizeCharacterAsset(input.glb, input.sidecar, encoder), after = parse(result.glb);
  assert.ok(encoder.calls > 0);
  for (let i = 0; i < 2; i++) {
    const a = before.json.meshes[0].primitives[i], b = after.json.meshes[0].primitives[i];
    assert.deepEqual(oriented(indexes(after, b)), oriented(indexes(before, a)));
    for (let level = 0; level < 2; level++) assert.deepEqual(oriented(result.sidecar.meshes[i].levels[level].indices), oriented(input.sidecar.meshes[i].levels[level].indices));
  }
  immutableAttributes(before, after);
  assert.equal(fingerprint(before).orientedSurfaces, fingerprint(after).orientedSurfaces);
  assert.equal(result.sidecar.sha256, hash(result.glb));
});

test('a shared accessor cannot reorder a transparent primitive through an opaque owner', () => {
  const input = fixture({ sharedIndex: true, primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'BLEND', indexed: true }] });
  const before = parse(input.glb), result = optimizeCharacterAsset(input.glb, input.sidecar, encoderFixture()), after = parse(result.glb);
  assert.deepEqual(indexes(after, after.json.meshes[0].primitives[1]), indexes(before, before.json.meshes[0].primitives[1]));
  assert.equal(fingerprint(before).orientedSurfaces, fingerprint(after).orientedSurfaces);
  immutableAttributes(before, after);
});

test('shared opaque and MASK accessors preserve both owners without remapping vertex attributes', () => {
  const input = fixture({ sharedIndex: true, primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'MASK', indexed: true }] });
  const before = parse(input.glb), result = optimizeCharacterAsset(input.glb, input.sidecar, encoderFixture()), after = parse(result.glb);
  for (let i = 0; i < 2; i++) assert.deepEqual(oriented(indexes(before, before.json.meshes[0].primitives[i])), oriented(indexes(after, after.json.meshes[0].primitives[i])));
  immutableAttributes(before, after);
});

test('a shared accessor used by line geometry retains its endpoint sequence', () => {
  const input = fixture({ sharedIndex: true, primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'OPAQUE', indexed: true, mode: 1 }] });
  const before = parse(input.glb), result = optimizeCharacterAsset(input.glb, input.sidecar, encoderFixture()), after = parse(result.glb);
  for (let i = 0; i < 2; i++) assert.deepEqual(indexes(after, after.json.meshes[0].primitives[i]), indexes(before, before.json.meshes[0].primitives[i]));
  immutableAttributes(before, after);
});

test('distinct index accessors with overlapping byte spans are rejected before encoding', () => {
  for (const variant of ['exact alias', 'partial offset', 'separate views', 'offset and stride']) {
    const input = fixture({ variants: ['POSITION'], primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'OPAQUE', indexed: true }] });
    const asset = parse(input.glb), primitives = asset.json.meshes[0].primitives;
    const first = asset.json.accessors[primitives[0].indices], second = asset.json.accessors[primitives[1].indices];
    assert.notEqual(primitives[0].indices, primitives[1].indices, 'reproduction uses distinct accessor IDs');
    second.bufferView = first.bufferView;
    if (variant === 'partial offset' || variant === 'separate views') {
      first.count = second.count = 6;
      second.byteOffset = 6;
      // The first accessor covers indices 0..5, the second covers 3..8.
      // Reordering the second must not silently overwrite the first's tail.
      if (variant === 'separate views') {
        const originalView = asset.json.bufferViews[first.bufferView];
        second.bufferView = asset.json.bufferViews.length;
        asset.json.bufferViews.push({ ...originalView, byteOffset: originalView.byteOffset + 6, byteLength: 12 });
        second.byteOffset = 0;
      }
    } else if (variant === 'offset and stride') {
      asset.json.bufferViews[first.bufferView].byteStride = 4;
      first.count = second.count = 3;
      second.byteOffset = 4;
    }
    const glb = encode(asset.json, asset.binary), original = Buffer.from(glb);
    const sidecar = { ...input.sidecar, sha256: hash(glb) }, encoder = encoderFixture();
    assert.throws(() => optimizeCharacterAsset(glb, sidecar, encoder), /overlap|alias/i, variant);
    assert.equal(encoder.calls, 0, `${variant}: reject aliasing before any index transformation`);
    assert.deepEqual(glb, original);
  }
});

test('distinct accessors with disjoint spans in one index buffer view remain supported', () => {
  const input = fixture({ variants: ['POSITION'], primitives: [{ alphaMode: 'OPAQUE', indexed: true }, { alphaMode: 'MASK', indexed: true }] });
  const asset = parse(input.glb), primitives = asset.json.meshes[0].primitives;
  const first = asset.json.accessors[primitives[0].indices], second = asset.json.accessors[primitives[1].indices];
  first.count = second.count = 3;
  second.bufferView = first.bufferView; second.byteOffset = 6;
  const glb = encode(asset.json, asset.binary), encoder = encoderFixture();
  const result = optimizeCharacterAsset(glb, { ...input.sidecar, sha256: hash(glb) }, encoder), after = parse(result.glb);
  assert.equal(encoder.calls, 2);
  for (let i = 0; i < 2; i++) assert.deepEqual(oriented(indexes(after, after.json.meshes[0].primitives[i])), oriented(indexes(asset, primitives[i])));
  immutableAttributes(asset, after);
});

test('invalid encoder output cannot silently reverse or discard an authored triangle', () => {
  for (const corruption of ['winding', 'degenerate']) {
    const input = fixture(), original = Buffer.from(input.glb);
    const encoder = { reorderMesh(indices) {
      if (corruption === 'winding') [indices[0], indices[1]] = [indices[1], indices[0]];
      else indices[0] = indices[1];
      return [Uint32Array.from([0, 1, 2]), 3];
    } };
    assert.throws(() => optimizeCharacterAsset(input.glb, input.sidecar, encoder), /triangle/i);
    assert.deepEqual(input.glb, original);
  }
});

test('repeating the transform is byte-stable and stale optimization metadata is rejected', () => {
  const input = fixture({ includeSidecar: true }), first = optimizeCharacterAsset(input.glb, input.sidecar, encoderFixture()), encoder = encoderFixture();
  const second = optimizeCharacterAsset(first.glb, first.sidecar, encoder);
  assert.equal(second.changed, false); assert.equal(encoder.calls, 0);
  assert.deepEqual(second.glb, first.glb); assert.deepEqual(second.sidecar, first.sidecar);
  const stale = structuredClone(first.sidecar); stale.meshes[0].levels[0].indices[0] = 1;
  assert.throws(() => optimizeCharacterAsset(first.glb, stale, encoderFixture()), /hash|stale|changed|fingerprint|proof|integrity/i);
  const wrongSource = structuredClone(input.sidecar); wrongSource.sha256 = '0'.repeat(64);
  assert.throws(() => optimizeCharacterAsset(input.glb, wrongSource, encoderFixture()), /hash|sha256|match|source/i);
});

// Reviewed appearance baseline: fitted head/neck proportions, authored apparel,
// head micro-surface maps, and exposed-ankle skin masks. PRE-index exports were
// independently compared with production; rig fingerprints remain unchanged.
// Index order and exact duplicate references may change, while altered skinning,
// seams, morphs, surface winding, textures or rigs still fail these assertions.
const baselines = {
  Male: { attributes: 'b7db6715521d74700c346f7c51a0e189fc1fdd0aeb6157c8b718a43f9246c0b7', orientedSurfaces: '2ffa337ea86fdc71ece9587da14f853aeb730565024a3d43fa7df8e333451617', blendOrder: '0b1c45160791e0924e37b88036f2eafd1927cbc7e156121552868f3a62b4a260', rig: '3f7087b99cde7bc508fa63461ab37154f8d50f08898ec328186d771dac561be9', materials: '90d5586564658d00c31d9db010d44dfc426b1fc02670f4afc646d5dfb57bdf3b' },
  Female: { attributes: 'c3f013f8f8b30f2922c4b2fc285104d58e671521e4e336db66678d604ecfb8ef', orientedSurfaces: '0dc950a667875bfedc26306be58a57ffa0e548b8fbd553d49afb9189397df769', blendOrder: '1b2397b4b23db70f8447e687c207a8e9b48d074d3f7b4d08cf64e6107b802669', rig: '5e66e1d0f0590a9ee999c3fa40a25722f5cc371a3a825686e1a4a803d36a52f4', materials: '58823dfd0b3fcb809bf8826a797fc41e9244012a3c2a043255a689e00896fec6' },
};
for (const sex of ['Male', 'Female']) test(`${sex}: production asset retains its authored surfaces, vertex payloads, materials and rig`, async () => {
  const bytes = await readFile(new URL(`../public/models/Civilian${sex}Natural.glb`, import.meta.url));
  const asset = parse(bytes);
  assert.deepEqual(fingerprint(asset), baselines[sex]);
  const body = asset.json.meshes[0].primitives[0];
  assert.notEqual(body.indices, undefined, 'near body uses a shared-vertex index stream');
  assert.equal(new Set(indexes(asset, body)).size, sex === 'Male' ? 5642 : 3540,
    'exact welding reduces repeated vertex skinning without changing any authored surface');
});
