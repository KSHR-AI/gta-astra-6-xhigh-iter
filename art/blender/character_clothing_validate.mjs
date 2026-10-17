/** Validate deliberate staged apparel edits against the exact source rig.
 * node art/blender/character_clothing_validate.mjs /tmp/astra-clothing-stage
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../../src/character-animation.js';
import { measureCharacterScale } from '../../src/character-scale.js';
import { makeSoleProbes } from '../../src/characters.js';

const root = resolve(import.meta.dirname, '../..');
const stage = resolve(process.argv[2] ?? '/tmp/astra-clothing-stage');
const constructors = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
async function load(path) {
  const bytes = await readFile(path), n = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + n)), binary = bytes.subarray(28 + n);
  const accessor = id => {
    const a = json.accessors[id], view = json.bufferViews[a.bufferView], Type = constructors[a.componentType], width = widths[a.type];
    const out = new Type(a.count * width);
    for (let i = 0; i < a.count; i++) {
      const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * Type.BYTES_PER_ELEMENT);
      new Uint8Array(out.buffer, i * width * Type.BYTES_PER_ELEMENT, width * Type.BYTES_PER_ELEMENT)
        .set(binary.subarray(offset, offset + width * Type.BYTES_PER_ELEMENT));
    }
    return out;
  };
  return { bytes, json, accessor };
}
const report = [];
for (const [sex, name, motion, height] of [
  ['male', 'CivilianMale.glb', 'civilian-male-motion.json', 1.82],
  ['female', 'Michelle-crowd.glb', 'pedestrian-motion.json', 1.76],
]) {
  const original = await load(resolve(root, 'public/models', name)), authored = await load(resolve(stage, name));
  const shaping = JSON.parse(await readFile(resolve(stage, `${sex}-apparel-shaping.json`)));
  assert.deepEqual(authored.json.nodes, original.json.nodes);
  assert.deepEqual(authored.json.skins, original.json.skins);
  for (const skin of original.json.skins) assert.deepEqual(authored.accessor(skin.inverseBindMatrices), original.accessor(skin.inverseBindMatrices));
  const before = original.json.meshes[0].primitives[0], after = authored.json.meshes[0].primitives[0];
  const garment = authored.json.meshes[0].primitives.find(primitive => primitive.extras?.authoredGarment);
  const originalVertices = original.json.accessors[before.attributes.POSITION].count;
  const vertices = authored.json.accessors[after.attributes.POSITION].count;
  const selected = new Set(shaping.editedSourceVertexIds);
  assert.equal(selected.size, shaping.editedSourceVertices);
  assert.ok(selected.size > 0 && selected.size < originalVertices, 'the edit is a bounded garment selection');
  for (const i of selected) assert.ok(Number.isInteger(i) && i >= 0 && i < originalVertices);
  const protectedVertices = new Set(shaping.pinnedShirtBoundaryVertices);
  for (const i of protectedVertices) assert.ok(!selected.has(i), 'neck/cuff/hem source contact anchors stay fixed');
  const sourceJoints = original.accessor(before.attributes.JOINTS_0), sourceWeights = original.accessor(before.attributes.WEIGHTS_0);
  const jointNames = original.json.skins[0].joints.map(i => original.json.nodes[i].name);
  for (let i = 0; i < originalVertices; i++) {
    let protectedInfluence = 0;
    for (let k = 0; k < 4; k++) if (/Hand|Foot|Toe|Thumb|Index|Middle|Ring|Pinky/.test(jointNames[sourceJoints[i * 4 + k]])) protectedInfluence += sourceWeights[i * 4 + k];
    if (protectedInfluence > .5) assert.ok(!selected.has(i), 'hands, fingers, feet and soles are outside the authored garment selection');
  }
  for (const [key, id] of Object.entries(before.attributes)) {
    const values = original.accessor(id), edited = authored.accessor(after.attributes[key]);
    const width = widths[original.json.accessors[id].type];
    if (!['POSITION', 'NORMAL'].includes(key)) assert.deepEqual(edited.slice(0, values.length), values, `${name}: original ${key} must remain exact`);
    else for (let i = 0; i < originalVertices; i++) for (let k = 0; k < width; k++) {
      assert.ok(Number.isFinite(edited[i * width + k]));
      if (!selected.has(i)) assert.equal(edited[i * width + k], values[i * width + k], `${name}: unselected ${key} at ${i} changed`);
    }
  }
  const sourceIndices = before.indices === undefined ? Uint32Array.from({ length: originalVertices }, (_, i) => i) : original.accessor(before.indices);
  const indices = authored.accessor(after.indices);
  assert.deepEqual(Array.from(indices.slice(0, sourceIndices.length)), Array.from(sourceIndices), 'tailoring retains every original triangle and vertex ID');
  const triangles = indices.length / 3, sourceTriangles = sourceIndices.length / 3;
  assert.ok(triangles - sourceTriangles < 1200, 'existing garment edging remains a bounded addition');
  const weights = authored.accessor(after.attributes.WEIGHTS_0), joints = authored.accessor(after.attributes.JOINTS_0);
  for (let i = 0; i < vertices; i++) {
    assert.ok(Math.abs(weights[i * 4] + weights[i * 4 + 1] + weights[i * 4 + 2] + weights[i * 4 + 3] - 1) < 1e-6);
    for (let k = 0; k < 4; k++) assert.ok(joints[i * 4 + k] < authored.json.skins[0].joints.length);
  }
  const material = authored.json.materials[after.material];
  assert.equal(material.extras.clothingAuthored, true);
  assert.equal(material.extras.trousersAuthored, true);
  assert.equal(material.extras.apparelShapeAuthored, true);
  assert.ok(material.extras.shirtDyeLuminance > .03 && material.extras.shirtDyeLuminance < .5);
  assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
  assert.equal(material.pbrMetallicRoughness.roughnessFactor, 1);
  let garmentVertices = 0, garmentIndices, garmentRestAreas, garmentPositions, garmentMask;
  const garmentSeams = [];
  if (garment) {
    assert.equal(sex, 'male', 'the replacement contract currently applies only to the male shirt');
    assert.equal(authored.json.meshes[0].primitives.length, 2, 'one reference body and one authored garment');
    assert.equal(garment.material, after.material, 'replacement reuses the body surface batch');
    const replaced = after.extras?.replacedGarmentTriangles;
    assert.ok(Array.isArray(replaced) && replaced.length > 200);
    assert.equal(new Set(replaced).size, replaced.length, 'replacement source face IDs are unique');
    for (const face of replaced) assert.ok(Number.isInteger(face) && face >= 0 && face < sourceTriangles);
    const ga = Object.fromEntries(Object.entries(garment.attributes).map(([key, id]) => [key, authored.accessor(id)]));
    garmentVertices = ga.POSITION.length / 3; garmentPositions = ga.POSITION; garmentMask = ga._GARMENT_MASK;
    garmentIndices = authored.accessor(garment.indices);
    assert.ok(garmentVertices > 100 && garmentIndices.length > 600);
    assert.equal(garmentIndices.length % 3, 0);
    for (const [key, value] of Object.entries(ga)) assert.ok(value.every(Number.isFinite), `replacement ${key} is finite`);
    assert.equal(garmentMask.length, garmentVertices);
    assert.ok(garmentMask.some(value => value === 1) && garmentMask.some(value => value === 0), 'cloth and original-source skin extension are separate semantic regions');
    for (let i = 0; i < garmentVertices; i++) {
      assert.ok(garmentMask[i] === 0 || garmentMask[i] === 1);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const weight = ga.WEIGHTS_0[i * 4 + k], joint = ga.JOINTS_0[i * 4 + k];
        assert.ok(weight >= 0 && weight <= 1);
        assert.ok(Number.isInteger(joint) && joint >= 0 && joint < authored.json.skins[0].joints.length);
        sum += weight;
      }
      assert.ok(Math.abs(sum - 1) < 1e-6, 'replacement influences are normalized');
      const length = Math.hypot(...ga.NORMAL.slice(i * 3, i * 3 + 3));
      assert.ok(Math.abs(length - 1) < 2e-4, 'replacement normals are unit length');
    }
    garmentRestAreas = new Float64Array(garmentIndices.length / 3);
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let i = 0; i < garmentIndices.length; i += 3) {
      const ids = garmentIndices.slice(i, i + 3);
      assert.ok(ids.every(id => id < garmentVertices));
      assert.equal(garmentMask[ids[0]], garmentMask[ids[1]]);
      assert.equal(garmentMask[ids[0]], garmentMask[ids[2]], 'faces cannot blend shirt and exposed skin classification');
      va.fromArray(ga.POSITION, ids[0] * 3); vb.fromArray(ga.POSITION, ids[1] * 3); vc.fromArray(ga.POSITION, ids[2] * 3);
      const area = vb.sub(va).cross(vc.sub(va)).length();
      assert.ok(area > 1e-12, 'replacement has no collapsed rest triangle');
      garmentRestAreas[i / 3] = area;
    }
    // Retained lower-arm endpoints survive as duplicated UV aliases around the
    // deliberately refitted upper-arm region. Match by position and influences, not by atlas coordinates.
    const referencePositions = original.accessor(before.attributes.POSITION);
    const sourceByPoint = new Map();
    const key = (values, i) => Array.from(values.slice(i * 3, i * 3 + 3), value => Math.round(value * 1e7)).join(',');
    for (let i = 0; i < originalVertices; i++) {
      const point = key(referencePositions, i);
      if (!sourceByPoint.has(point)) sourceByPoint.set(point, []);
      sourceByPoint.get(point).push(i);
    }
    for (let i = 0; i < garmentVertices; i++) {
      if (garmentMask[i]) continue;
      const aliases = sourceByPoint.get(key(ga.POSITION, i)) ?? [];
      const match = aliases.find(source => {
        for (let k = 0; k < 4; k++) if (ga.JOINTS_0[i * 4 + k] !== sourceJoints[source * 4 + k]
          || ga.WEIGHTS_0[i * 4 + k] !== sourceWeights[source * 4 + k]) return false;
        return true;
      });
      if (match !== undefined) garmentSeams.push({ garment: i, source: match });
    }
    assert.ok(garmentSeams.length >= 40, 'both upper-arm replacements retain lower-arm contact endpoints and skin influences');
  } else assert.equal(sex, 'female', 'male clothing validation must include the replacement shirt primitive');
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'VALIDATE_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(authored.bytes.buffer.slice(authored.bytes.byteOffset, authored.bytes.byteOffset + authored.bytes.byteLength), '');
  const mesh = new THREE.Group(), visual = new THREE.Group(); mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {}; let body, garmentBody;
  asset.scene.traverse(object => {
    if (object.isSkinnedMesh && object.geometry.attributes.position.count === vertices) body = object;
    if (object.isSkinnedMesh && object.geometry.attributes.position.count === garmentVertices) garmentBody = object;
    if (!/^mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, ''); bones[name] = object; restPose[name] = object.quaternion.clone();
  });
  assert.ok(body);
  if (garment) assert.ok(garmentBody, 'runtime loader includes the authored shirt and skin bridge');
  const normalization = measureCharacterScale(asset.scene, height);
  assert.ok(normalization);
  visual.scale.setScalar(normalization.scale); asset.scene.position.y += normalization.offsetY; mesh.updateMatrixWorld(true);
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion()), mixer = new THREE.AnimationMixer(asset.scene);
  const clips = JSON.parse(await readFile(resolve(root, 'public/models', motion), 'utf8'));
  const actions = Object.fromEntries(clips.map(c => [c.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(c))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  const soleProbes = makeSoleProbes(asset.scene);
  const weapon = new THREE.Group(), magazine = new THREE.Group(); weapon.userData.gripCenter = [0, -.046, -.037]; mesh.add(weapon, magazine);
  const animator = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, bindHeadOrientation, npc: false });
  const states = [{ speed: 0 }, { speed: 2.35 }, { speed: 5.8 }, { lookYawRadians: -Math.PI / 6 }, { lookYawRadians: Math.PI / 6 },
    { armed: true, aiming: true, aimPitch: .45 }, { armed: true, aiming: true, aimPitch: -.3 }, { reloading: true, reloadProgress: .55 },
    { seated: true, steering: .7 }, { interactionPhase: 'enter', interactionProgress: .5 }, { interactionPhase: 'exit', interactionProgress: .6 }];
  const authoredAttribute = body.geometry.attributes.position;
  const referenceValues = authoredAttribute.array.slice(); referenceValues.set(original.accessor(before.attributes.POSITION));
  const referenceAttribute = new THREE.BufferAttribute(referenceValues, 3), point = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normalBefore = new THREE.Vector3(), normalAfter = new THREE.Vector3();
  let maximumPosedDisplacement = 0, minimumNormalDot = 1, protectedMotionError = 0, maximumCuffSeamError = 0;
  let minimumReplacementAreaRatio = Infinity;
  const stateResults = [], reversedStateFaces = [];
  const stateSamples = states.flatMap(state => [15, 30, 45, 60].map(frame => ({ state, frame })));
  let totalReversed = 0;
  for (const { state, frame: sampleFrame } of stateSamples) {
    for (let frame = 0; frame < 15; frame++) {
      mesh.position.z += (state.speed ?? 0) / 60;
      const lookTarget = state.lookYawRadians === undefined ? undefined : new THREE.Vector3(
        Math.sin(state.lookYawRadians) * 4, 1.6, Math.cos(state.lookYawRadians) * 4).add(mesh.position);
      animator.update(1 / 60, lookTarget ? { ...state, lookTarget } : state);
    }
    mesh.updateMatrixWorld(true);
    const posed = new Float64Array(vertices * 3), reference = new Float64Array(originalVertices * 3);
    for (let i = 0; i < vertices; i++) { body.getVertexPosition(i, point); body.localToWorld(point); assert.ok(point.toArray().every(Number.isFinite)); point.toArray(posed, i * 3); }
    body.geometry.setAttribute('position', referenceAttribute);
    for (let i = 0; i < originalVertices; i++) { body.getVertexPosition(i, point); body.localToWorld(point); point.toArray(reference, i * 3); }
    body.geometry.setAttribute('position', authoredAttribute);
    if (garmentBody) {
      garmentBody.skeleton.update();
      const garmentPosed = new Float64Array(garmentVertices * 3);
      for (let i = 0; i < garmentVertices; i++) {
        garmentBody.getVertexPosition(i, point); garmentBody.localToWorld(point);
        assert.ok(point.toArray().every(Number.isFinite), 'replacement garment deforms finitely');
        point.toArray(garmentPosed, i * 3);
      }
      for (const pair of garmentSeams) maximumCuffSeamError = Math.max(maximumCuffSeamError,
        a.fromArray(garmentPosed, pair.garment * 3).distanceTo(b.fromArray(reference, pair.source * 3)));
      // Compare each posed area against its own bind-world area, so arms may
      // rotate freely without treating a valid rotation as a flipped face.
      const worldScale = garmentBody.getWorldScale(new THREE.Vector3());
      assert.ok(Math.abs(worldScale.x - worldScale.y) < 1e-5 && Math.abs(worldScale.y - worldScale.z) < 1e-5);
      for (let i = 0; i < garmentIndices.length; i += 3) {
        const ids = garmentIndices.slice(i, i + 3);
        a.fromArray(garmentPosed, ids[0] * 3); b.fromArray(garmentPosed, ids[1] * 3); c.fromArray(garmentPosed, ids[2] * 3);
        const area = b.sub(a).cross(c.sub(a)).length();
        const ratio = area / (garmentRestAreas[i / 3] * worldScale.x * worldScale.y);
        minimumReplacementAreaRatio = Math.min(minimumReplacementAreaRatio, ratio);
        assert.ok(ratio > .0025, `replacement face ${i / 3} collapses in ${JSON.stringify(state)}`);
      }
    }
    for (let i = 0; i < originalVertices; i++) {
      const distance = a.fromArray(posed, i * 3).distanceTo(b.fromArray(reference, i * 3));
      maximumPosedDisplacement = Math.max(maximumPosedDisplacement, distance);
      if (!selected.has(i)) protectedMotionError = Math.max(protectedMotionError, distance);
    }
    let reversed = 0, testedTriangles = 0; const reversedFaces = [];
    for (let i = 0; i < sourceIndices.length; i += 3) {
      const ids = sourceIndices.slice(i, i + 3); if (!ids.some(id => selected.has(id))) continue;
      const faceNormal = (values, out) => out.crossVectors(b.fromArray(values, ids[1] * 3).sub(a.fromArray(values, ids[0] * 3)), c.fromArray(values, ids[2] * 3).sub(a));
      faceNormal(reference, normalBefore); faceNormal(posed, normalAfter);
      if (normalBefore.lengthSq() < 1e-14) continue;
      assert.ok(normalAfter.lengthSq() > normalBefore.lengthSq() * .0025, `${name}: authored face ${i / 3} collapses in ${JSON.stringify(state)} frame ${sampleFrame}`);
      const dot = normalBefore.normalize().dot(normalAfter.normalize());
      minimumNormalDot = Math.min(minimumNormalDot, dot); if (dot < -.05) { reversed++; reversedFaces.push({ triangle: i / 3, indices: Array.from(ids), dot, reference: Array.from(ids).map(id => Array.from(reference.slice(id * 3, id * 3 + 3))), authored: Array.from(ids).map(id => Array.from(posed.slice(id * 3, id * 3 + 3))) }); } testedTriangles++;
    }
    if (reversed) reversedStateFaces.push({ state, sampleFrame, faces: reversedFaces });
    totalReversed += reversed;
    stateResults.push({ state, sampleFrame, testedTriangles, reversedTriangles: reversed });
  }
  if (totalReversed) await writeFile(resolve(stage, `${sex}-reversed-faces.json`), JSON.stringify(reversedStateFaces, null, 2));
  assert.equal(totalReversed, 0, `${name}: authored cloth reverses ${totalReversed} source-facing triangles across the posed states`);
  assert.ok(protectedMotionError < 1e-9, 'unselected skin, seams and shoes deform exactly like the source');
  if (garment) assert.ok(maximumCuffSeamError < 2e-7, 'new upper-arm skin stays joined to the original cuff endpoints through every pose');
  assert.ok(maximumPosedDisplacement < (sex === 'male' ? .025 : .075), 'intentional fabric tailoring stays within measured garment bounds');
  report.push({ source: name, originalVertices, authoredSourceVertices: selected.size, addedVertices: vertices - originalVertices, addedTriangles: triangles - sourceTriangles,
    unselectedPositionsNormalsExact: true, originalJointWeightUvAttributesExact: true, rigAndInverseBindExact: true,
    originalTopologyExact: true, protectedMotionError, maximumPosedDisplacement, minimumNormalDot,
    ...(garment ? { replacementVertices: garmentVertices, replacementTriangles: garmentIndices.length / 3,
      verifiedCuffEndpointAliases: garmentSeams.length, maximumCuffSeamError, minimumReplacementAreaRatio } : {}),
    neutralHeightNormalization: normalization, statesExercised: states.length, posedSamples: stateSamples.length, stateResults, materialBatches: authored.json.meshes[0].primitives.length, bytes: authored.bytes.length });
}
await writeFile(resolve(stage, 'clothing-validation.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
