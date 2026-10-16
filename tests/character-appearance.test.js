import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function glb(name) {
  const bytes = await readFile(new URL(`../public/models/${name}`, import.meta.url));
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString());
  const binary = bytes.subarray(28 + length);
  function accessor(index) {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    const values = new type(a.count * width);
    for (let i = 0; i < a.count; i++) {
      const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * type.BYTES_PER_ELEMENT);
      new Uint8Array(values.buffer, i * width * type.BYTES_PER_ELEMENT, width * type.BYTES_PER_ELEMENT)
        .set(binary.subarray(start, start + width * type.BYTES_PER_ELEMENT));
    }
    return values;
  }
  return { json, accessor };
}

for (const [sourceName, naturalName, triangleBudget] of [
  ['CivilianMale.glb', 'CivilianMaleNatural.glb', 20500],
  ['Michelle-crowd.glb', 'CivilianFemaleNatural.glb', 21500],
]) {
  test(`${naturalName}: replacement appearance preserves the exact animation skeleton`, async () => {
    const [source, natural] = await Promise.all([glb(sourceName), glb(naturalName)]);
    assert.equal(natural.json.skins.length, source.json.skins.length);
    for (let i = 0; i < source.json.skins.length; i++) {
      const before = source.json.skins[i], after = natural.json.skins[i];
      assert.deepEqual(after.joints, before.joints, 'joint order must match every source motion track');
      assert.deepEqual(natural.accessor(after.inverseBindMatrices), source.accessor(before.inverseBindMatrices));
      for (const index of before.joints) assert.deepEqual(natural.json.nodes[index], source.json.nodes[index], 'head graft must not rewrite the bind pose');
    }
  });

  test(`${naturalName}: textured head has valid skinning, soft brows, and a bounded geometry budget`, async () => {
    const asset = await glb(naturalName), { json, accessor } = asset;
    const primitives = json.meshes.flatMap(mesh => mesh.primitives);
    assert.equal(primitives.length, 3, 'body plus opaque head and translucent brow/lash batches');
    const triangles = primitives.reduce((sum, p) => sum + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);
    assert.ok(triangles <= triangleBudget);
    const heads = primitives.filter(p => json.materials[p.material].extras?.naturalHuman);
    assert.equal(heads.length, 2);
    const headMaterials = heads.map(p => json.materials[p.material]);
    assert.deepEqual(new Set(headMaterials.map(m => m.alphaMode)), new Set(['MASK', 'BLEND']));
    assert.equal(headMaterials[0].pbrMetallicRoughness.baseColorTexture.index, headMaterials[1].pbrMetallicRoughness.baseColorTexture.index, 'both head passes share one atlas');
    for (const primitive of heads) {
      const attributes = primitive.attributes;
      for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'WEIGHTS_0', '_SKIN_MASK', '_HAIR_MASK']) {
        assert.ok(accessor(attributes[key]).every(Number.isFinite), `${key} contains only finite values`);
        assert.equal(json.accessors[attributes[key]].count, json.accessors[attributes.POSITION].count);
      }
      const skin = json.skins[0], weights = accessor(attributes.WEIGHTS_0), joints = accessor(attributes.JOINTS_0), positions = accessor(attributes.POSITION);
      for (let i = 0; i < weights.length; i += 4) {
        assert.ok(Math.abs(weights[i] + weights[i + 1] + weights[i + 2] + weights[i + 3] - 1) < 1e-6);
        for (let k = 0; k < 4; k++) if (weights[i + k] > 0) {
          const name = json.nodes[skin.joints[joints[i + k]]].name;
          if (naturalName.includes('Female') && positions[i / 4 * 3 + 1] < 1.371) {
            assert.match(name, /mixamorig[:_]?(Head|Neck|Spine2|LeftShoulder|RightShoulder)$/i, 'lower neck preserves the original body joint mixture');
          } else assert.match(name, /mixamorig[:_]?(Head|Neck)$/i, 'the face and upper neck retain their original neck/head joints');
        }
      }
    }
  });
}

test('female neck boundary excludes headphone rims and follows the body at the join', async () => {
  const { json, accessor } = await glb('CivilianFemaleNatural.glb');
  const primitive = json.meshes.flatMap(mesh => mesh.primitives).find(p => json.materials[p.material].extras?.naturalHuman);
  const a = primitive.attributes, positions = accessor(a.POSITION), weights = accessor(a.WEIGHTS_0), joints = accessor(a.JOINTS_0), mask = accessor(a._SKIN_MASK);
  const spine = json.skins[0].joints.findIndex(index => /Spine2$/.test(json.nodes[index].name));
  let boundaryVertices = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || positions[i * 3 + 1] > 1.319) continue;
    boundaryVertices++;
    assert.ok(Math.abs(positions[i * 3]) < 0.036, 'the base stays inside the actual neck, away from old headphone rims');
    let spineWeight = 0;
    for (let k = 0; k < 4; k++) if (joints[i * 4 + k] === spine) spineWeight += weights[i * 4 + k];
    assert.ok(spineWeight > 0.65, 'the lower neck follows the body rather than floating with the head');
  }
  assert.ok(boundaryVertices > 12, 'the assertion exercised the complete neck boundary');
});
