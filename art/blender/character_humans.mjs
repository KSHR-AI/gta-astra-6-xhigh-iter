/**
 * Fit the CC0 MakeHuman heads to the existing civilian animation rigs.
 * Rebuild after exporting the editable Blender library:
 *   node art/blender/character_humans.mjs /tmp/astra-head-export
 *
 * The original skeleton nodes, hierarchy, and inverse-bind prefix are copied
 * verbatim; two calibrated eye children are appended under Head. Only visible head geometry is replaced; locomotion stays compatible.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { transformMorphDeltas, matchNeckBoundaryNormal } from './character_morphs.mjs';
import { createHeadFit, HEAD_FITS } from './character_head_fit.mjs';
import { fitEyeMetadata, appendEyeRig } from './character_eyes.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const INPUT = resolve(process.argv[2] ?? '/tmp/astra-human-source');
let bodyDirectory = resolve(ROOT, 'public/models'), outputDirectory = resolve(ROOT, 'public/models');
for (let i = 3; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  if (flag === '--body-dir') bodyDirectory = resolve(value);
  else if (flag === '--output-dir') outputDirectory = resolve(value);
  else throw new Error(`Unknown option ${flag}`);
}
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

class GLB {
  constructor(bytes) {
    const jsonLength = bytes.readUInt32LE(12);
    this.json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
    this.bin = bytes.subarray(28 + jsonLength);
    this.parts = [this.bin]; this.length = this.bin.length;
  }
  view(bytes) {
    const pad = (4 - this.length % 4) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.length += pad; }
    const index = this.json.bufferViews.length;
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length });
    this.parts.push(bytes); this.length += bytes.length;
    return index;
  }
  read(index) {
    if (this.bin.length < this.length) this.bin = Buffer.concat(this.parts);
    const a = this.json.accessors[index], v = this.json.bufferViews[a.bufferView];
    const Typed = ARRAYS[a.componentType], size = COMPONENTS[a.type];
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const stride = v.byteStride ?? size * Typed.BYTES_PER_ELEMENT;
    const values = new Typed(a.count * size);
    for (let i = 0; i < a.count; i++) {
      const start = offset + i * stride;
      const bytes = this.bin.subarray(start, start + size * Typed.BYTES_PER_ELEMENT);
      new Uint8Array(values.buffer, i * size * Typed.BYTES_PER_ELEMENT, bytes.length).set(bytes);
    }
    return { values, size, accessor: a };
  }
  attribute(values, type, componentType = 5126, normalized = false) {
    const array = new ARRAYS[componentType](values);
    const accessor = { bufferView: this.view(Buffer.from(array.buffer)), componentType,
      count: array.length / COMPONENTS[type], type };
    if (normalized) accessor.normalized = true;
    if (type === 'VEC3') {
      accessor.min = [Infinity, Infinity, Infinity]; accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < array.length; i++) {
        const k = i % 3;
        accessor.min[k] = Math.min(accessor.min[k], array[i]);
        accessor.max[k] = Math.max(accessor.max[k], array[i]);
      }
    }
    this.json.accessors.push(accessor);
    return this.json.accessors.length - 1;
  }
  encode() {
    const binary = Buffer.concat(this.parts);
    this.json.buffers = [{ byteLength: binary.length }];
    const text = Buffer.from(JSON.stringify(this.json));
    const json = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
    const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
    const output = Buffer.alloc(28 + json.length + bin.length);
    output.write('glTF'); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(json.length, 12); output.write('JSON', 16); json.copy(output, 20);
    output.writeUInt32LE(bin.length, 20 + json.length); output.write('BIN\0', 24 + json.length);
    bin.copy(output, 28 + json.length);
    return output;
  }
}

function nodeWorld(json) {
  const parents = new Map();
  json.nodes.forEach((node, i) => node.children?.forEach((child) => parents.set(child, i)));
  const matrices = [];
  function matrix(index) {
    if (matrices[index]) return matrices[index];
    const node = json.nodes[index];
    const local = node.matrix ? new THREE.Matrix4().fromArray(node.matrix) : new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]));
    matrices[index] = parents.has(index) ? matrix(parents.get(index)).clone().multiply(local) : local;
    return matrices[index];
  }
  json.nodes.forEach((_, i) => matrix(i));
  return { matrices, parents };
}

function interpolate(a, b, t) {
  const result = {};
  for (const key of Object.keys(a)) {
    if (key === 'JOINTS_0' || key === 'WEIGHTS_0') continue;
    result[key] = a[key].map((value, i) => THREE.MathUtils.lerp(value, b[key][i], t));
  }
  if (a.JOINTS_0) {
    const influences = new Map();
    for (const [vertex, amount] of [[a, 1 - t], [b, t]]) vertex.JOINTS_0.forEach((joint, k) => {
      influences.set(joint, (influences.get(joint) ?? 0) + vertex.WEIGHTS_0[k] * amount);
    });
    const ranked = [...influences].sort((x, y) => y[1] - x[1]).slice(0, 4);
    while (ranked.length < 4) ranked.push([0, 0]);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    result.JOINTS_0 = ranked.map(([joint]) => joint);
    result.WEIGHTS_0 = ranked.map(([, weight]) => weight / total);
  }
  return result;
}

function trimOriginalHead(glb, primitive, bind, cut, radius, discardHeadJoint) {
  // A fitted crew collar deliberately covers the low head-graft seam. Its
  // geometry has already been fitted to the unchanged natural neck.
  if (primitive.extras?.authoredGarment) return [];
  const replacedGarment = new Set(primitive.extras?.replacedGarmentTriangles ?? []);
  const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([key, index]) => [key, glb.read(index)]));
  const count = attributes.POSITION.accessor.count;
  const indices = primitive.indices === undefined ? Array.from({ length: count }, (_, i) => i) : glb.read(primitive.indices).values;
  const output = Object.fromEntries(Object.keys(attributes).map((key) => [key, []]));
  const point = new THREE.Vector3();
  const world = (vertex) => point.fromArray(vertex.POSITION).applyMatrix4(bind);
  const vertexAt = (index) => Object.fromEntries(Object.entries(attributes).map(([key, attr]) => [key, Array.from(attr.values.subarray(index * attr.size, (index + 1) * attr.size))]));
  const contour = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [vertexAt(indices[i]), vertexAt(indices[i + 1]), vertexAt(indices[i + 2])];
    // Michelle's headphone rims extend fractionally below the neck cut. They
    // must not survive as clothing or become part of the new neck's contour.
    if (discardHeadJoint !== undefined && triangle.every(vertex => vertex.JOINTS_0.reduce(
      (weight, joint, k) => weight + (joint === discardHeadJoint ? vertex.WEIGHTS_0[k] : 0), 0) > 0.9)) continue;
    const nearHead = triangle.some((vertex) => Math.abs(world(vertex).x) < radius);
    let polygon = triangle;
    if (nearHead) {
      polygon = [];
      for (let k = 0; k < 3; k++) {
        const a = triangle[k], b = triangle[(k + 1) % 3];
        const ay = world(a).y, by = world(b).y;
        if (ay <= cut) polygon.push(a);
        if ((ay <= cut) !== (by <= cut)) {
          const intersection = interpolate(a, b, (cut - ay) / (by - ay));
          polygon.push(intersection);
          contour.push(Object.assign(world(intersection).clone(), { skinVertex: intersection }));
        }
      }
    }
    // The original shirt is only a contour reference for this graft. Keep its
    // exact intersections above, but never render it beneath the replacement.
    if (replacedGarment.has(i / 3)) continue;
    for (let k = 1; k < polygon.length - 1; k++) for (const vertex of [polygon[0], polygon[k], polygon[k + 1]]) {
      for (const key of Object.keys(output)) output[key].push(...vertex[key]);
    }
  }
  primitive.attributes = Object.fromEntries(Object.entries(output).map(([key, values]) => {
    const { type, componentType, normalized } = attributes[key].accessor;
    return [key, glb.attribute(values, type, componentType, normalized)];
  }));
  delete primitive.indices;
  if (primitive.extras) delete primitive.extras.replacedGarmentTriangles;
  return contour;
}

/** Merge the replacement textile into the original body draw batch. */
function mergeAuthoredGarment(glb, mesh) {
  if (!mesh.primitives.some(primitive => primitive.extras?.authoredGarment)) return;
  const material = mesh.primitives[0].material;
  if (!mesh.primitives.every(primitive => primitive.material === material)) throw new Error('Crew shirt must share the body material');
  const keys = Object.keys(mesh.primitives[0].attributes);
  const output = Object.fromEntries(keys.map(key => [key, []]));
  const formats = {};
  for (const primitive of mesh.primitives) {
    if (Object.keys(primitive.attributes).sort().join() !== keys.slice().sort().join()) throw new Error('Crew shirt attributes must match retained body');
    const attributes = Object.fromEntries(keys.map(key => [key, glb.read(primitive.attributes[key])]));
    const count = attributes.POSITION.accessor.count;
    const indices = primitive.indices === undefined ? Array.from({ length: count }, (_, i) => i) : glb.read(primitive.indices).values;
    for (const key of keys) {
      const attr = attributes[key]; formats[key] ??= attr.accessor;
      for (const vertex of indices) for (let k = 0; k < attr.size; k++) output[key].push(attr.values[vertex * attr.size + k]);
    }
  }
  mesh.primitives = [{ material, mode: 4, extras: { crewShirtAuthored: true },
    attributes: Object.fromEntries(keys.map(key => {
      const { type, componentType, normalized } = formats[key];
      return [key, glb.attribute(output[key], type, componentType, normalized)];
    })) }];
}

function smoothFittedNeckNormals(points, normals, indices, blendWeights) {
  const sums = new Map(), keys = [];
  for (let i = 0; i < points.length; i += 3) keys.push(points.slice(i, i + 3).map(v => Math.round(v * 1e6)).join(','));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    a.fromArray(points, indices[i] * 3); b.fromArray(points, indices[i + 1] * 3); c.fromArray(points, indices[i + 2] * 3);
    const normal = b.sub(a).cross(c.sub(a));
    for (const vertex of [indices[i], indices[i + 1], indices[i + 2]]) {
      if (!blendWeights[vertex]) continue;
      if (!sums.has(keys[vertex])) sums.set(keys[vertex], new THREE.Vector3());
      sums.get(keys[vertex]).add(normal);
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const normal = sums.get(keys[i]);
    if (!normal || normal.lengthSq() < 1e-16) continue;
    a.fromArray(normals, i * 3).lerp(normal.clone().normalize(), blendWeights[i]).normalize().toArray(normals, i * 3);
  }
}

function mergeMaterials(target, source) {
  const json = target.json, from = source.json;
  const viewOffset = json.bufferViews.length;
  const sourceView = target.view(source.bin), base = json.bufferViews[sourceView].byteOffset;
  // Preserve the actual image byte ranges without decoding/re-encoding textures.
  const views = from.bufferViews.map((v) => { json.bufferViews.push({ ...v, buffer: 0, byteOffset: base + (v.byteOffset ?? 0) }); return json.bufferViews.length - 1; });
  json.images ??= []; json.samplers ??= []; json.textures ??= []; json.materials ??= [];
  const images = json.images.length, samplers = json.samplers.length, textures = json.textures.length;
  for (const image of from.images ?? []) json.images.push({ ...image, bufferView: views[image.bufferView] });
  json.samplers.push(...from.samplers ?? []);
  for (const texture of from.textures ?? []) json.textures.push({ ...texture, source: texture.source + images,
    ...(texture.sampler !== undefined ? { sampler: texture.sampler + samplers } : {}) });
  function remapTextures(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase().includes('texture') && child && Number.isInteger(child.index)) child.index += textures;
      else remapTextures(child);
    }
  }
  const materials = [];
  for (const original of from.materials ?? []) {
    const material = structuredClone(original); remapTextures(material);
    material.name = `Natural_${material.name ?? 'Human'}`;
    material.extras = { ...material.extras, naturalHuman: true };
    material.doubleSided = /hair|brow|lash/i.test(material.name) || material.alphaMode === 'MASK';
    materials.push(json.materials.length); json.materials.push(material);
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), ...(from.extensionsUsed ?? [])])];
  return materials;
}

const configs = [
  { gender: 'male', body: 'CivilianMale.glb', out: 'CivilianMaleNatural.glb', cut: 70, radius: 20,
    sourceCut: 6.62, ...HEAD_FITS.male, offset: [-0.70831424, 70 - 6.62 * HEAD_FITS.male.scale[1], -0.72], blendHeight: 7.08 },
  { gender: 'female', body: 'Michelle-crowd.glb', out: 'CivilianFemaleNatural.glb', cut: 1.32, radius: 0.3,
    sourceCut: 5.16, ...HEAD_FITS.female, offset: [0, 1.32 - 5.16 * HEAD_FITS.female.scale[1], -0.028], blendHeight: 5.63 },
];

const report = [];
for (const config of configs) {
  const fit = createHeadFit(config);
  const body = new GLB(await readFile(resolve(bodyDirectory, config.body)));
  let headPath = resolve(INPUT, `soft_${config.gender}_head.glb`);
  let headBytes;
  try { headBytes = await readFile(headPath); } catch { headPath = resolve(INPUT, `${config.gender}_head.glb`); headBytes = await readFile(headPath); }
  const head = new GLB(headBytes), json = body.json;
  const { matrices, parents } = nodeWorld(json);
  const bodyNodeIndex = json.nodes.findIndex((node) => node.skin !== undefined);
  const bodyNode = json.nodes[bodyNodeIndex], skin = json.skins[bodyNode.skin];
  const inverse = body.read(skin.inverseBindMatrices).values;
  const bind = matrices[skin.joints[0]].clone().multiply(new THREE.Matrix4().fromArray(inverse, 0));
  const inverseBind = bind.clone().invert();
  const headJoint = skin.joints.findIndex((index) => /mixamorig[:_]?Head$/i.test(json.nodes[index].name));
  const neckJoint = skin.joints.findIndex((index) => /mixamorig[:_]?Neck$/i.test(json.nodes[index].name));
  if (headJoint < 0 || neckJoint < 0) throw new Error('Source rig must provide weighted Head and Neck bones');
  const originalPositions = body.read(json.meshes[bodyNode.mesh].primitives[0].attributes.POSITION).values;
  let originalMinY = Infinity, originalMaxY = -Infinity;
  for (let i = 1; i < originalPositions.length; i += 3) { originalMinY = Math.min(originalMinY, originalPositions[i]); originalMaxY = Math.max(originalMaxY, originalPositions[i]); }
  json.meshes[bodyNode.mesh].extras = { ...json.meshes[bodyNode.mesh].extras,
    originalBodyHeight: [originalMinY, originalMaxY] };
  const intersections = [];
  for (const primitive of json.meshes[bodyNode.mesh].primitives) intersections.push(...trimOriginalHead(body, primitive, bind, config.cut, config.radius, config.gender === 'female' ? headJoint : undefined));
  // Shared edges and UV seams contribute repeated intersections. Keep the
  // female neck's actual inner loop, with no accessory rim or density bias.
  const contour = config.gender === 'female'
    ? [...new Map(intersections.filter(v => Math.abs(v.x) < 0.045 && Math.abs(v.z) < 0.05)
      .map(v => [v.toArray().map(value => Math.round(value * 1e6)).join(','), v])).values()]
    : intersections;
  if (contour.length < 8) throw new Error(`Cannot identify the ${config.gender} neck boundary`);
  mergeAuthoredGarment(body, json.meshes[bodyNode.mesh]);
  const center = contour.reduce((sum, v) => sum.add(v), new THREE.Vector3()).multiplyScalar(1 / contour.length);
  const ring = contour.map((v) => ({ angle: Math.atan2(v.z - center.z, v.x - center.x), radius: Math.hypot(v.x - center.x, v.z - center.z), skinVertex: v.skinVertex })).sort((a, b) => a.angle - b.angle);
  function contourSample(angle) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], next = ring[(i + 1) % ring.length];
      const bAngle = i + 1 === ring.length ? next.angle + Math.PI * 2 : next.angle;
      const sample = angle < ring[0].angle ? angle + Math.PI * 2 : angle;
      if (sample >= a.angle && sample <= bAngle) {
        const t = (sample - a.angle) / Math.max(bAngle - a.angle, 1e-8);
        return { radius: THREE.MathUtils.lerp(a.radius, next.radius, t), skinVertex: interpolate(a.skinVertex, next.skinVertex, t) };
      }
    }
    return ring[0];
  }
  const neckBoundaryProof = [];
  const materials = mergeMaterials(body, head);
  const headWorld = nodeWorld(head.json).matrices;
  let eyeRig;
  for (const [nodeIndex, node] of head.json.nodes.entries()) {
    const eyes = node.mesh === undefined ? null : head.json.meshes[node.mesh].extras?.astraEyes;
    if (!eyes) continue;
    if (eyeRig) throw new Error('Eye metadata must occur on one source head mesh');
    eyeRig = appendEyeRig(body, { skin, headJoint, headWorldMatrix: matrices[skin.joints[headJoint]],
      eyes: fitEyeMetadata(eyes, headWorld[nodeIndex], fit) });
  }
  for (const [nodeIndex, node] of head.json.nodes.entries()) {
    if (node.mesh === undefined) continue;
    const isSkin = /(?:^|_)head$/i.test(node.name);
    const isHair = /hair|brow/i.test(node.name);
    const primitives = [];
    for (const primitive of head.json.meshes[node.mesh].primitives) {
      const attributes = {};
      const p = head.read(primitive.attributes.POSITION), n = head.read(primitive.attributes.NORMAL);
      const points = [], normals = [], joints = [], weights = [], skinMask = [], hairMask = [], neckNormalBlend = [];
      const existingSkin = primitive.attributes._SKIN_MASK === undefined ? null : head.read(primitive.attributes._SKIN_MASK).values;
      const existingHair = primitive.attributes._HAIR_MASK === undefined ? null : head.read(primitive.attributes._HAIR_MASK).values;
      const eyeSides = primitive.attributes._EYE_SIDE === undefined ? null : head.read(primitive.attributes._EYE_SIDE).values;
      const morphTransform = inverseBind.clone().multiply(new THREE.Matrix4().makeScale(...config.scale)).multiply(headWorld[nodeIndex]);
      const normalMatrix = new THREE.Matrix3(), fittedLinear = new THREE.Matrix4();
      for (let i = 0; i < p.accessor.count; i++) {
        const native = new THREE.Vector3().fromArray(p.values, i * 3).applyMatrix4(headWorld[nodeIndex]);
        const isHeadSkin = existingSkin ? existingSkin[i] > 0.5 : isSkin;
        const world = fit.position(native, isHeadSkin);
        let boundary, boundaryBlend = 0;
        const contourEnd = config.neckContourEnd ?? config.blendHeight;
        if (isHeadSkin && native.y < contourEnd) {
          // Fit the female source clavicle flare through the upper neck. Ending
          // this radial blend early leaves a vase-shaped bulge above the cut.
          const blend = 1 - THREE.MathUtils.smoothstep(native.y, config.sourceCut, contourEnd);
          const angle = Math.atan2(world.z - center.z, world.x - center.x), sample = contourSample(angle);
          const radius = sample.radius * (config.gender === 'female' ? 0.985 : 1);
          world.x = THREE.MathUtils.lerp(world.x, center.x + Math.cos(angle) * radius, blend);
          world.z = THREE.MathUtils.lerp(world.z, center.z + Math.sin(angle) * radius, blend);
          if (config.gender === 'female') {
            // A slight overlap conceals the cut, while matching its actual body
            // weights prevents the two surfaces separating during head turns.
            world.y -= 0.0015 * blend;
          }
          boundary = sample.skinVertex; boundaryBlend = blend;
        }
        const neckWeight = isHeadSkin ? 1 - THREE.MathUtils.smoothstep(native.y, config.sourceCut, config.blendHeight + 0.35) : 0;
        points.push(...world.applyMatrix4(inverseBind).toArray());
        fittedLinear.copy(inverseBind).multiply(fit.linear(native, isHeadSkin)).multiply(headWorld[nodeIndex]);
        normalMatrix.getNormalMatrix(fittedLinear);
        const fittedNormal = new THREE.Vector3().fromArray(n.values, i * 3).applyMatrix3(normalMatrix).normalize();
        // Both normals are in the same bind-mesh space. Match the cut exactly,
        // restoring the authored head normal smoothly above the boundary.
        if (boundary && config.gender === 'male') {
          const boundaryNormal = new THREE.Vector3().fromArray(boundary.NORMAL).normalize();
          const before = fittedNormal.angleTo(boundaryNormal);
          fittedNormal.copy(matchNeckBoundaryNormal(fittedNormal, boundaryNormal, boundaryBlend));
          if (boundaryBlend > 0.99999) neckBoundaryProof.push({ beforeDegrees: THREE.MathUtils.radToDeg(before), afterDegrees: THREE.MathUtils.radToDeg(fittedNormal.angleTo(boundaryNormal)) });
        }
        normals.push(...fittedNormal.toArray());
        let influence = { JOINTS_0: [headJoint, neckJoint, 0, 0], WEIGHTS_0: [1 - neckWeight, neckWeight, 0, 0] };
        if (boundary) influence = interpolate(influence, boundary, boundaryBlend);
        if (eyeSides?.[i]) {
          const joint = eyeRig?.jointsByLabel[eyeSides[i]];
          if (!Number.isInteger(joint)) throw new Error('Labeled eye vertex has no appended eye joint');
          influence = { JOINTS_0: [joint, 0, 0, 0], WEIGHTS_0: [1, 0, 0, 0] };
        }
        joints.push(...influence.JOINTS_0); weights.push(...influence.WEIGHTS_0);
        skinMask.push(isHeadSkin ? 1 : 0); hairMask.push(existingHair ? existingHair[i] : isHair ? 1 : 0);
        neckNormalBlend.push(boundaryBlend);
      }
      if (config.gender === 'female') smoothFittedNeckNormals(points, normals,
        primitive.indices === undefined ? Array.from({ length: p.accessor.count }, (_, i) => i) : head.read(primitive.indices).values, neckNormalBlend);
      attributes.POSITION = body.attribute(points, 'VEC3'); attributes.NORMAL = body.attribute(normals, 'VEC3');
      attributes.JOINTS_0 = body.attribute(joints, 'VEC4', 5123); attributes.WEIGHTS_0 = body.attribute(weights, 'VEC4');
      attributes._SKIN_MASK = body.attribute(skinMask, 'SCALAR'); attributes._HAIR_MASK = body.attribute(hairMask, 'SCALAR');
      for (const [name, index] of Object.entries(primitive.attributes)) {
        if (name in attributes || name === 'TANGENT') continue;
        const attr = head.read(index);
        attributes[name] = body.attribute(attr.values, attr.accessor.type, attr.accessor.componentType, attr.accessor.normalized);
      }
      const packed = { attributes, material: materials[primitive.material], mode: 4 };
      if (primitive.targets?.length) {
        packed.targets = primitive.targets.map(target => {
          const unsupported = Object.keys(target).filter(name => !['POSITION', 'NORMAL'].includes(name));
          if (unsupported.length) throw new Error(`Unsupported head morph semantics: ${unsupported}`);
          const positionDeltas = target.POSITION === undefined ? null : head.read(target.POSITION).values;
          const normalDeltas = target.NORMAL === undefined ? null : head.read(target.NORMAL).values;
          for (const deltas of [positionDeltas, normalDeltas]) if (deltas && deltas.length !== p.values.length) throw new Error('Morph vertex count differs from head');
          if (positionDeltas) for (let i = 0; i < p.accessor.count; i++) {
            const native = new THREE.Vector3().fromArray(p.values, i * 3).applyMatrix4(headWorld[nodeIndex]);
            if (native.y < Math.max(config.neckContourEnd ?? config.blendHeight, fit.affineFrom) && positionDeltas.subarray(i * 3, i * 3 + 3).some(value => Math.abs(value) > 1e-7)) throw new Error('Facial morph must remain above the non-affine fitted neck');
          }
          return Object.fromEntries(Object.entries(transformMorphDeltas(positionDeltas, normalDeltas, n.values, morphTransform))
            .map(([name, values]) => [name, body.attribute(values, 'VEC3')]));
        });
      }
      if (primitive.indices !== undefined) { const idx = head.read(primitive.indices); packed.indices = body.attribute(idx.values, 'SCALAR', idx.accessor.componentType); }
      primitives.push(packed);
    }
    const newNode = { name: `Natural_${node.name}`, mesh: json.meshes.length, skin: bodyNode.skin,
      extras: { naturalHuman: true, appearancePart: isSkin ? 'skin' : isHair ? 'hair' : 'eyes' } };
    for (const name of ['translation', 'rotation', 'scale', 'matrix']) if (bodyNode[name]) newNode[name] = [...bodyNode[name]];
    const sourceMesh = head.json.meshes[node.mesh];
    const morphCount = primitives[0]?.targets?.length ?? 0;
    if (morphCount && sourceMesh.extras?.targetNames?.length !== morphCount) throw new Error('Head morph names must match target count');
    if (node.weights) newNode.weights = [...node.weights];
    json.meshes.push({ name: newNode.name, primitives,
      ...(sourceMesh.extras ? { extras: structuredClone(sourceMesh.extras) } : {}),
      ...(sourceMesh.weights ? { weights: [...sourceMesh.weights] } : {}) });
    const index = json.nodes.length; json.nodes.push(newNode);
    if (parents.has(bodyNodeIndex)) json.nodes[parents.get(bodyNodeIndex)].children.push(index);
    else json.scenes[json.scene ?? 0].nodes.push(index);
  }
  json.asset.extras = { ...json.asset.extras, characterAppearance: 'MakeHuman CC0 head + original civilian body',
    source: 'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
    license: 'CC0-1.0 (MakeHuman head assets); original body license unchanged' };
  delete json.animations;
  const output = body.encode();
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, config.out), output);
  const triangles = json.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((n, p) => n + (p.indices === undefined ? json.accessors[p.attributes.POSITION].count : json.accessors[p.indices].count) / 3, 0), 0);
  report.push({ output: config.out, sourceHead: headPath, eyeRigProof: eyeRig?.proof ?? [], bytes: output.length, triangles, bodyCut: config.cut, headJoint, neckJoint, neckBoundaryProof,
    headFit: { scale: config.scale, neckShift: config.neckShift, neckEnd: config.neckEnd,
      neckContourEnd: config.neckContourEnd ?? config.blendHeight, sourceCut: config.sourceCut },
    originalNodesPreserved: bodyNodeIndex, primitives: json.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0) });
}
await writeFile(resolve(INPUT, 'integrated-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
