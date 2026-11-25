/** Exact character vertex reuse and cache ordering; no attribute or rig changes.
 * npm install --prefix /tmp/astra-lod-tool meshoptimizer@0.24.0 --no-audit --no-fund
 * node art/blender/character_indices.mjs /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_encoder.module.js
 * Run after character_humans.mjs and character_lod.mjs. The sidecar proof makes
 * repeated runs a verified no-op. A stale proof requires rebuilding those inputs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOL_VERSION = '0.24.0';
const markerKey = 'indexOptimization';
const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const maximumIndex = { 5121: 255, 5123: 65535, 5125: 4294967295 };
const integer = (value, name) => assert(Number.isSafeInteger(value) && value >= 0, `Invalid ${name}`);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseGLB(input) {
  assert(Buffer.isBuffer(input) || input instanceof Uint8Array, 'Expected GLB bytes');
  const bytes = Buffer.from(input);
  assert(bytes.length >= 28, 'Truncated GLB');
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Invalid GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'Only GLB version 2 is supported');
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'Invalid GLB length');
  let json, binary, offset = 12;
  while (offset < bytes.length) {
    assert(offset + 8 <= bytes.length, 'Truncated GLB chunk');
    const length = bytes.readUInt32LE(offset), kind = bytes.readUInt32LE(offset + 4);
    assert(length % 4 === 0 && offset + 8 + length <= bytes.length, 'Invalid GLB chunk length');
    if (kind === 0x4e4f534a) {
      assert(offset === 12 && !json, 'GLB must start with one JSON chunk');
      json = JSON.parse(bytes.toString('utf8', offset + 8, offset + 8 + length));
    } else if (kind === 0x004e4942) {
      assert(json && !binary, 'GLB must contain one binary chunk after its JSON');
      binary = Buffer.from(bytes.subarray(offset + 8, offset + 8 + length));
    } else assert.fail('Unsupported GLB chunk');
    offset += 8 + length;
  }
  assert(json && binary, 'Missing GLB JSON or binary chunk');
  assert.equal(json.asset?.version, '2.0', 'Only glTF 2.0 is supported');
  assert(Array.isArray(json.buffers) && json.buffers.length === 1 && !json.buffers[0].uri, 'Expected one embedded buffer');
  integer(json.buffers[0].byteLength, 'buffer length');
  assert(json.buffers[0].byteLength <= binary.length && binary.length - json.buffers[0].byteLength <= 3, 'Invalid binary padding');
  assert(Array.isArray(json.accessors) && Array.isArray(json.bufferViews) && Array.isArray(json.meshes), 'Missing geometry tables');
  for (const view of json.bufferViews) {
    assert.equal(view.buffer, 0, 'External buffers are unsupported');
    assert(!view.extensions?.EXT_meshopt_compression, 'Compressed geometry is unsupported');
    integer(view.byteOffset ?? 0, 'buffer view offset'); integer(view.byteLength, 'buffer view length');
    assert((view.byteOffset ?? 0) + view.byteLength <= json.buffers[0].byteLength, 'Buffer view exceeds buffer');
  }
  for (let id = 0; id < json.accessors.length; id++) accessorLayout(json, id);
  return { json, binary };
}

function accessorLayout(json, id) {
  integer(id, 'accessor index');
  const accessor = json.accessors[id];
  assert(accessor && !accessor.sparse, 'Missing or sparse accessor is unsupported');
  integer(accessor.bufferView, 'accessor buffer view');
  const view = json.bufferViews[accessor.bufferView];
  assert(view, 'Missing accessor buffer view');
  assert(sizes[accessor.componentType] && widths[accessor.type], 'Unsupported accessor format');
  assert(accessor.type !== 'MAT4' || accessor.componentType === 5126, 'Only float matrix accessors are supported');
  integer(accessor.count, 'accessor count'); integer(accessor.byteOffset ?? 0, 'accessor offset');
  const size = sizes[accessor.componentType] * widths[accessor.type], stride = view.byteStride ?? size;
  integer(stride, 'accessor stride');
  assert(stride >= size && stride % sizes[accessor.componentType] === 0, 'Invalid accessor stride');
  const offset = accessor.byteOffset ?? 0;
  const end = offset + (accessor.count ? (accessor.count - 1) * stride + size : 0);
  assert(end <= view.byteLength, 'Accessor exceeds its buffer view');
  const start = (view.byteOffset ?? 0) + offset;
  assert(start % sizes[accessor.componentType] === 0, 'Misaligned accessor');
  return { accessor, start, stride, size };
}

function accessorBytes(binary, layout) {
  const result = Buffer.alloc(layout.accessor.count * layout.size);
  for (let i = 0; i < layout.accessor.count; i++) binary.copy(result, i * layout.size,
    layout.start + i * layout.stride, layout.start + i * layout.stride + layout.size);
  return result;
}

function readIndices(binary, layout) {
  const { accessor, size, start, stride } = layout;
  assert(accessor.type === 'SCALAR' && maximumIndex[accessor.componentType], 'Invalid index accessor');
  assert(!accessor.normalized, 'Normalized indices are unsupported');
  const read = size === 1 ? 'readUInt8' : size === 2 ? 'readUInt16LE' : 'readUInt32LE';
  return Uint32Array.from({ length: accessor.count }, (_, i) => binary[read](start + i * stride));
}

function packIndices(indices, componentType) {
  const size = sizes[componentType], bytes = Buffer.alloc(indices.length * size);
  const write = size === 1 ? 'writeUInt8' : size === 2 ? 'writeUInt16LE' : 'writeUInt32LE';
  indices.forEach((value, i) => { assert(value < maximumIndex[componentType], 'Primitive restart index is unsupported'); bytes[write](value, i * size); });
  return bytes;
}

function attributesOf(primitive) {
  return [...Object.entries(primitive.attributes).map(([name, id]) => ({ name, id })),
    ...(primitive.targets || []).flatMap((target, i) => Object.entries(target).map(([name, id]) => ({ name: `MORPH_${i}_${name}`, id })))];
}

function validateGeometry(json, binary) {
  const entries = [], owners = new Map();
  for (const [meshIndex, mesh] of json.meshes.entries()) {
    assert(Array.isArray(mesh.primitives), 'Missing mesh primitives');
    for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
      assert(!primitive.extensions?.KHR_draco_mesh_compression, 'Compressed geometry is unsupported');
      assert(primitive.attributes && primitive.attributes.POSITION !== undefined, 'Missing POSITION');
      const position = accessorLayout(json, primitive.attributes.POSITION);
      assert(position.accessor.type === 'VEC3' && position.accessor.componentType === 5126 && position.accessor.count > 0, 'Invalid POSITION accessor');
      const vertices = position.accessor.count;
      for (const { id } of attributesOf(primitive)) assert.equal(accessorLayout(json, id).accessor.count, vertices, 'Attribute vertex counts differ');
      const mode = primitive.mode ?? 4; integer(mode, 'primitive mode'); assert(mode <= 6, 'Unknown primitive mode');
      const material = primitive.material === undefined ? {} : json.materials?.[primitive.material];
      assert(material, 'Missing primitive material');
      const alphaMode = material.alphaMode ?? 'OPAQUE'; assert(['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode), 'Invalid alpha mode');
      if (alphaMode !== 'BLEND' && mode === 4) {
        // Without authored normals a loader may generate flat/smooth normals
        // differently after indexing. Such geometry is outside this exact pass.
        assert(primitive.attributes.NORMAL !== undefined, 'Authored NORMAL is required for exact index optimization');
        const normal = accessorLayout(json, primitive.attributes.NORMAL).accessor;
        assert(normal.type === 'VEC3' && normal.componentType === 5126, 'Unsupported NORMAL accessor');
      }
      const indices = primitive.indices === undefined ? Uint32Array.from({ length: vertices }, (_, i) => i)
        : readIndices(binary, accessorLayout(json, primitive.indices));
      for (const value of indices) {
        assert(value < vertices, 'Index exceeds vertex count');
        if (primitive.indices !== undefined) assert(value < maximumIndex[json.accessors[primitive.indices].componentType], 'Primitive restart index is unsupported');
      }
      if (mode === 4) assert(indices.length > 0 && indices.length % 3 === 0, 'Invalid triangle index count');
      const entry = { mesh: meshIndex, primitive: primitiveIndex, data: primitive, vertices, indices, eligible: alphaMode !== 'BLEND' && mode === 4, alphaMode };
      entries.push(entry);
      if (primitive.indices !== undefined) {
        if (!owners.has(primitive.indices)) owners.set(primitive.indices, []);
        owners.get(primitive.indices).push(entry);
      }
    }
  }
  // Distinct accessors can alias the same bytes even when each primitive owns
  // its accessor ID. Reordering one would then corrupt the other's triangles.
  // Sharing one ID remains supported; overlapping spans, including gaps in
  // strided index storage, are deliberately outside this exact authoring pass.
  const indexRanges = [...owners.keys()].map(id => {
    const { accessor, start, stride, size } = accessorLayout(json, id);
    return { id, start, end: start + (accessor.count ? (accessor.count - 1) * stride + size : 0) };
  }).filter(range => range.end > range.start).sort((a, b) => a.start - b.start);
  for (let i = 1; i < indexRanges.length; i++) {
    assert(indexRanges[i].start >= indexRanges[i - 1].end,
      `Overlapping index accessor byte spans are unsupported (${indexRanges[i - 1].id}, ${indexRanges[i].id})`);
  }
  return { entries, owners };
}

function validateSidecar(data, json, entries, sourceHash) {
  assert(data && data.version === 1 && typeof data.source === 'string' && data.source.length && Array.isArray(data.meshes), 'Invalid LOD sidecar');
  assert.equal(data.sha256, sourceHash, 'LOD source hash is stale; rebuild character heads and LODs');
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data, 'Sidecar must contain only JSON data');
  const keys = new Set();
  for (const entry of data.meshes) {
    integer(entry.mesh, 'LOD mesh'); integer(entry.primitive, 'LOD primitive');
    const source = entries.find(item => item.mesh === entry.mesh && item.primitive === entry.primitive);
    assert(source && (source.data.mode ?? 4) === 4, 'LOD references a missing or non-triangle primitive');
    const key = `${entry.mesh}:${entry.primitive}`; assert(!keys.has(key), 'Duplicate LOD primitive'); keys.add(key);
    assert.equal(entry.vertices, source.vertices, 'LOD vertex count changed');
    assert.equal(entry.triangles, source.indices.length / 3, 'LOD source triangle count changed');
    assert(Array.isArray(entry.levels), 'Missing LOD levels');
    for (const level of entry.levels) {
      assert(Array.isArray(level.indices) && level.indices.length > 0 && level.indices.length % 3 === 0, 'Invalid LOD triangle indices');
      for (const index of level.indices) assert(Number.isInteger(index) && index >= 0 && index < entry.vertices && index < 4294967295, 'Invalid LOD vertex index');
      assert.equal(level.triangles, level.indices.length / 3, 'LOD triangle count is stale');
      if (level.error !== undefined) assert(Number.isFinite(level.error) && level.error >= 0, 'Invalid LOD error');
    }
  }
}

function orientedTriangles(indices, canonical) {
  const result = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = canonical ? canonical[indices[i]] : indices[i], b = canonical ? canonical[indices[i + 1]] : indices[i + 1], c = canonical ? canonical[indices[i + 2]] : indices[i + 2];
    result.push([`${a},${b},${c}`, `${b},${c},${a}`, `${c},${a},${b}`].sort()[0]);
  }
  return result.sort();
}

function cacheOrder(indices, encoder) {
  const result = Uint32Array.from(indices), [remap, unique] = encoder.reorderMesh(result, true, false);
  integer(unique, 'remapped vertex count'); assert(unique <= result.length, 'Invalid vertex remap');
  const inverse = new Uint32Array(unique).fill(0xffffffff);
  remap.forEach((next, original) => {
    if (next === 0xffffffff) return;
    assert(Number.isInteger(next) && next >= 0 && next < unique && inverse[next] === 0xffffffff, 'Invalid vertex remap'); inverse[next] = original;
  });
  for (let i = 0; i < result.length; i++) {
    assert(result[i] < inverse.length && inverse[result[i]] !== 0xffffffff, 'Incomplete vertex remap');
    result[i] = inverse[result[i]];
  }
  assert.deepEqual(orientedTriangles(indices), orientedTriangles(result), 'Optimizer changed oriented triangles');
  return result;
}

function exactVertexMap(json, binary, primitive) {
  const attributes = attributesOf(primitive).sort((a, b) => a.name.localeCompare(b.name)).map(({ id }) => accessorLayout(json, id));
  const count = json.accessors[primitive.attributes.POSITION].count, first = new Map(), remap = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const key = attributes.map(layout => binary.toString('hex', layout.start + i * layout.stride, layout.start + i * layout.stride + layout.size)).join('|');
    if (!first.has(key)) first.set(key, i); remap[i] = first.get(key);
  }
  return { remap, unique: first.size };
}

function extrema(values) {
  let min = Infinity, max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  return { min, max };
}

function encodeGLB(json, binary) {
  const text = Buffer.from(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4, binaryLength = Math.ceil(binary.length / 4) * 4;
  const output = Buffer.alloc(28 + jsonLength + binaryLength);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(jsonLength, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + jsonLength); text.copy(output, 20);
  output.writeUInt32LE(binaryLength, 20 + jsonLength); output.writeUInt32LE(0x004e4942, 24 + jsonLength); binary.copy(output, 28 + jsonLength);
  return output;
}

function sidecarHash(sidecar) {
  const content = { ...sidecar }; delete content[markerKey];
  return sha256(JSON.stringify(content));
}

/** Pure transformation. The caller supplies a ready meshoptimizer encoder.
 * All source vertex numbers and bytes remain valid, including morphs, skinning,
 * custom masks and sole probes. Only indices of exact duplicate vertices merge.
 */
export function optimizeCharacterAsset(input, inputSidecar, encoder) {
  const sourceBytes = Buffer.from(input), { json: original, binary: originalBinary } = parseGLB(sourceBytes);
  const { entries, owners } = validateGeometry(original, originalBinary), inputHash = sha256(sourceBytes);
  validateSidecar(inputSidecar, original, entries, inputHash);
  const proof = inputSidecar[markerKey];
  if (proof !== undefined) {
    assert(proof && proof.version === 1 && proof.tool === 'meshoptimizer' && proof.toolVersion === TOOL_VERSION, 'Unsupported optimization proof; rebuild character heads and LODs');
    assert.equal(proof.outputGlbSha256, inputHash, 'Optimization GLB proof is stale; rebuild character heads and LODs');
    assert.equal(proof.sidecarContentSha256, sidecarHash(inputSidecar), 'Optimization LOD proof is stale; rebuild character heads and LODs');
    assert(/^[0-9a-f]{64}$/.test(proof.sourceGlbSha256), 'Invalid optimization source proof');
    return { glb: sourceBytes, sidecar: structuredClone(inputSidecar), report: { unchanged: true, proof }, changed: false };
  }
  assert(encoder && typeof encoder.reorderMesh === 'function', 'A ready meshoptimizer encoder is required');
  const json = structuredClone(original), sidecar = structuredClone(inputSidecar);
  let binary = Buffer.from(originalBinary);
  const changedAccessors = new Set(), allowed = new Uint8Array(originalBinary.length), report = { primitives: [], lods: [] };
  for (const entry of entries) {
    const source = entry.data, target = json.meshes[entry.mesh].primitives[entry.primitive];
    const item = { mesh: entry.mesh, primitive: entry.primitive, alphaMode: entry.alphaMode, verticesRetained: entry.vertices, triangles: entry.indices.length / 3 };
    report.primitives.push(item);
    if (!entry.eligible) { item.operation = 'preserved'; continue; }
    if (source.indices !== undefined && !owners.get(source.indices).every(owner => owner.eligible)) {
      item.operation = 'preserved-shared-index-accessor'; continue;
    }
    let optimized;
    if (source.indices === undefined) {
      const exact = exactVertexMap(original, originalBinary, source);
      optimized = cacheOrder(entry.indices.map(index => exact.remap[index]), encoder);
      assert.deepEqual(orientedTriangles(entry.indices, exact.remap), orientedTriangles(optimized, exact.remap), 'Welding changed complete-attribute triangles');
      const componentType = entry.vertices > 65535 ? 5125 : 5123, addition = packIndices(optimized, componentType), start = Math.ceil(binary.length / 4) * 4;
      const next = Buffer.alloc(Math.ceil((start + addition.length) / 4) * 4); binary.copy(next); addition.copy(next, start); binary = next;
      const bufferView = json.bufferViews.length; json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: addition.length, target: 34963 });
      const { min, max } = extrema(optimized);
      target.indices = json.accessors.length; json.accessors.push({ bufferView, componentType, count: optimized.length, type: 'SCALAR', min: [min], max: [max] });
      item.operation = 'exact-attribute-weld-and-cache-order'; item.referencedVertices = exact.unique; item.exactDuplicateVertices = entry.vertices - exact.unique;
    } else {
      optimized = cacheOrder(entry.indices, encoder);
      const layout = accessorLayout(json, source.indices), packed = packIndices(optimized, layout.accessor.componentType);
      // Repeated opaque owners receive the same deterministic order from the
      // immutable source. Never run the optimizer on an already-reordered index.
      for (let i = 0; i < optimized.length; i++) {
        packed.copy(binary, layout.start + i * layout.stride, i * layout.size, (i + 1) * layout.size);
        allowed.fill(1, layout.start + i * layout.stride, layout.start + i * layout.stride + layout.size);
      }
      changedAccessors.add(source.indices); item.operation = 'cache-order'; item.referencedVertices = new Set(optimized).size;
    }
    item.indexSha256 = sha256(packIndices(optimized, json.accessors[target.indices].componentType));
  }
  json.buffers[0].byteLength = binary.length;
  for (let i = 0; i < originalBinary.length; i++) if (originalBinary[i] !== binary[i]) assert.equal(allowed[i], 1, 'Unexpected non-index binary change');
  for (let id = 0; id < original.accessors.length; id++) if (!changedAccessors.has(id)) {
    assert(accessorBytes(originalBinary, accessorLayout(original, id)).equals(accessorBytes(binary, accessorLayout(json, id))), 'An unrelated accessor changed');
  }
  for (const entry of entries) {
    for (const { id } of attributesOf(entry.data)) assert(accessorBytes(originalBinary, accessorLayout(original, id)).equals(accessorBytes(binary, accessorLayout(json, id))), 'Vertex or morph attribute changed');
    if (!entry.eligible && entry.data.indices !== undefined) assert(accessorBytes(originalBinary, accessorLayout(original, entry.data.indices)).equals(accessorBytes(binary, accessorLayout(json, entry.data.indices))), 'Transparent or non-triangle indices changed');
  }
  const restored = structuredClone(json);
  restored.accessors.length = original.accessors.length; restored.bufferViews.length = original.bufferViews.length; restored.buffers = structuredClone(original.buffers);
  for (const entry of entries) if (entry.data.indices === undefined) delete restored.meshes[entry.mesh].primitives[entry.primitive].indices;
  assert.deepEqual(restored, original, 'Unexpected rig, material, animation or scene metadata change');
  const glb = encodeGLB(json, binary), outputHash = sha256(glb);
  for (const definition of sidecar.meshes) {
    const source = entries.find(entry => entry.mesh === definition.mesh && entry.primitive === definition.primitive);
    if (!source.eligible) continue;
    for (const [levelIndex, level] of definition.levels.entries()) {
      const before = Uint32Array.from(level.indices), optimized = cacheOrder(before, encoder); level.indices = Array.from(optimized);
      report.lods.push({ mesh: definition.mesh, primitive: definition.primitive, level: levelIndex + 1, triangles: optimized.length / 3 });
    }
  }
  sidecar.sha256 = outputHash;
  const restoredSidecar = structuredClone(sidecar); restoredSidecar.sha256 = inputSidecar.sha256;
  for (const [i, definition] of restoredSidecar.meshes.entries()) for (const [j, level] of definition.levels.entries()) level.indices = inputSidecar.meshes[i].levels[j].indices;
  assert.deepEqual(restoredSidecar, inputSidecar, 'Unexpected LOD metadata change');
  const outputParsed = parseGLB(glb), outputGeometry = validateGeometry(outputParsed.json, outputParsed.binary);
  validateSidecar(sidecar, outputParsed.json, outputGeometry.entries, outputHash);
  report.validation = { everyVertexAndMorphAttributeByteExact: true, everyOriginalNonIndexBinaryByteExact: true,
    orientedTrianglesByCompleteAttributeIdentityExact: true, blendGeometryUntouched: true,
    rigsAnimationsMaterialsAndSceneMetadataExact: true, sidecarOrientedTrianglesExact: true };
  sidecar[markerKey] = { version: 1, tool: 'meshoptimizer', toolVersion: TOOL_VERSION, sourceGlbSha256: inputHash,
    outputGlbSha256: outputHash, sidecarContentSha256: sidecarHash(sidecar), validation: report.validation };
  return { glb, sidecar, report, changed: true };
}

async function main(args) {
  const modulePath = args.shift();
  assert(modulePath && !modulePath.startsWith('--'), 'Usage: node character_indices.mjs <meshopt_encoder.module.js> [--input-dir directory] [--output-dir directory]');
  let inputDir = fileURLToPath(new URL('../../public/models/', import.meta.url)), outputDir;
  while (args.length) {
    const flag = args.shift(), value = args.shift(); assert(value, `Missing value for ${flag}`);
    if (flag === '--input-dir') inputDir = path.resolve(value);
    else if (flag === '--output-dir') outputDir = path.resolve(value);
    else assert.fail(`Unknown option ${flag}`);
  }
  outputDir ??= inputDir;
  const resolvedModule = path.resolve(modulePath), packageInfo = JSON.parse(await readFile(path.join(path.dirname(resolvedModule), 'package.json'), 'utf8'));
  assert(packageInfo.name === 'meshoptimizer' && packageInfo.version === TOOL_VERSION, `Use meshoptimizer@${TOOL_VERSION}`);
  const imported = await import(pathToFileURL(resolvedModule).href), encoder = imported.MeshoptEncoder ?? imported.default;
  assert(encoder?.supported !== false && encoder?.ready, 'Unsupported meshoptimizer encoder'); await encoder.ready;
  const prepared = [];
  for (const sex of ['Male', 'Female']) {
    const basename = `Civilian${sex}Natural`, glbPath = path.join(inputDir, `${basename}.glb`), sidecarPath = path.join(inputDir, `${basename}.lod.json`);
    const original = await readFile(glbPath), originalSidecar = await readFile(sidecarPath);
    const sidecar = JSON.parse(originalSidecar);
    if (!Object.hasOwn(sidecar, markerKey)) {
      // Rebuilding only the LOD sidecar erases its proof while leaving optimized
      // GLB indices behind. The natural-human authoring step emits an unindexed
      // body, so this state must be rebuilt from heads -> LODs -> indices.
      const { json } = parseGLB(original);
      assert(json.meshes[0]?.primitives?.[0]?.indices === undefined,
        'Natural body is already indexed without its optimization proof; rebuild character heads and LODs');
    }
    const output = optimizeCharacterAsset(original, sidecar, encoder);
    prepared.push({ basename, glbPath, sidecarPath, original, originalSidecar, output });
  }
  // Both sexes must validate before either file is written. Recheck shared
  // workspace inputs before staging, so another author's edits are preserved.
  for (const item of prepared) {
    assert((await readFile(item.glbPath)).equals(item.original), 'Input GLB changed during optimization');
    assert((await readFile(item.sidecarPath)).equals(item.originalSidecar), 'Input sidecar changed during optimization');
  }
  await mkdir(outputDir, { recursive: true });
  const staged = [];
  try {
    for (const item of prepared) {
      if (!item.output.changed && path.resolve(inputDir) === path.resolve(outputDir)) continue;
      for (const [suffix, data] of [['.glb', item.output.glb], ['.lod.json', JSON.stringify(item.output.sidecar)]]) {
        const target = path.join(outputDir, item.basename + suffix), temporary = `${target}.index-tmp-${process.pid}`;
        await writeFile(temporary, data, { flag: 'wx' }); staged.push({ temporary, target });
      }
    }
    for (const item of staged) await rename(item.temporary, item.target);
  } finally { await Promise.all(staged.map(item => unlink(item.temporary).catch(() => {}))); }
  for (const item of prepared) console.log(JSON.stringify({ asset: item.basename, changed: item.output.changed, ...item.output.report }));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
