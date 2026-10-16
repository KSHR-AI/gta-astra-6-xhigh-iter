/** Generate deterministic, rig-preserving LOD index buffers for our authored humans.
 * npm install --prefix /tmp/astra-lod-tool meshoptimizer@0.24.0 --no-audit --no-fund
 * node art/blender/character_lod.mjs /tmp/astra-lod-tool/node_modules/meshoptimizer/meshopt_simplifier.module.js
 * The MIT-licensed build tool is not shipped to clients. LODs reference original
 * vertices, preserving textures, skin weights, bind matrices and animation probes.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { prepareMorphVertices, suppressibleBlinkTargets } from './character_morphs.mjs';
let inputDirectory = fileURLToPath(new URL('../../public/models/', import.meta.url)), outputDirectory;
for (let i = 3; i < process.argv.length; i += 2) {
  const flag = process.argv[i], value = process.argv[i + 1];
  if (!value) throw new Error(`Missing value for ${flag}`);
  if (flag === '--input-dir') inputDirectory = resolve(value);
  else if (flag === '--output-dir') outputDirectory = resolve(value);
  else throw new Error(`Unknown option ${flag}`);
}
outputDirectory ??= inputDirectory;
await mkdir(outputDirectory, { recursive: true });
const { MeshoptSimplifier: simplifier } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'meshoptimizer');
await simplifier.ready;
const types = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
for (const sex of ['Male', 'Female']) {
  const filename = `Civilian${sex}Natural.glb`;
  const bytes = await readFile(resolve(inputDirectory, filename));
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length));
  const binary = bytes.subarray(28 + length);
  const read = (index) => {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView], Type = types[a.componentType], width = widths[a.type];
    const result = new Type(a.count * width);
    for (let i = 0; i < a.count; i++) {
      const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * (view.byteStride ?? width * Type.BYTES_PER_ELEMENT);
      new Uint8Array(result.buffer, i * width * Type.BYTES_PER_ELEMENT, width * Type.BYTES_PER_ELEMENT).set(binary.subarray(offset, offset + width * Type.BYTES_PER_ELEMENT));
    }
    return { values: result, width };
  };
  const output = { version: 1, source: filename, sha256: createHash('sha256').update(bytes).digest('hex'), meshes: [] };
  for (const [meshIndex, mesh] of json.meshes.entries()) for (const [primitiveIndex, primitive] of mesh.primitives.entries()) {
    const attributes = Object.fromEntries(Object.entries(primitive.attributes).map(([name, index]) => [name, read(index)]));
    const positions = attributes.POSITION.values, count = positions.length / 3;
    const morphs = prepareMorphVertices((primitive.targets ?? []).map(target => Object.fromEntries(Object.entries(target).map(([name, index]) => [name, read(index).values]))), count);
    const source = primitive.indices === undefined ? Uint32Array.from({ length: count }, (_, i) => i) : Uint32Array.from(read(primitive.indices).values);
    const blinkTargets = suppressibleBlinkTargets(mesh.extras?.targetNames, primitive.targets?.length ?? 0,
      [mesh.weights, ...json.nodes.filter(node => node.mesh === meshIndex).map(node => node.weights)]);
    const levels = [];
    for (const [levelIndex, [ratio, error]] of [[0.42, 0.008], [0.19, 0.018]].entries()) {
      const disabledMorphTargets = levelIndex === 1 ? blinkTargets : [];
      const levelMorphs = disabledMorphTargets.length ? prepareMorphVertices([], count) : morphs;
      // Weld only exact attribute matches. Texture seams and different skin
      // influences remain separate, and original vertex numbering is retained.
      const unique = new Map(), remap = new Uint32Array(count);
      for (let i = 0; i < count; i++) {
        const key = Object.values(attributes).map(a => Array.from(a.values.subarray(i * a.width, (i + 1) * a.width)).join(',')).join('|') + '|' + levelMorphs.signatures[i];
        if (!unique.has(key)) unique.set(key, i);
        remap[i] = unique.get(key);
      }
      const indices = source.map(i => remap[i]);
      // Preserve normals/UVs and explicitly lock mixed-influence vertices to
      // protect bending regions. Categorical joint IDs cannot be interpolated.
      const surface = new Float32Array(count * 5), lock = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        surface.set(attributes.NORMAL.values.subarray(i * 3, i * 3 + 3), i * 5);
        surface.set(attributes.TEXCOORD_0.values.subarray(i * 2, i * 2 + 2), i * 5 + 3);
        const weights = attributes.WEIGHTS_0.values.subarray(i * 4, i * 4 + 4);
        if (Math.max(...weights) < 0.97 || levelMorphs.locked[i]) lock[i] = 1;
      }
      const [reduced, actualError] = simplifier.simplifyWithAttributes(indices, positions, 3, surface, 5, [0.25, 0.25, 0.25, 0.2, 0.2], lock, Math.floor(indices.length * ratio / 3) * 3, error, ['LockBorder']);
      levels.push({ indices: Array.from(reduced), error: actualError, triangles: reduced.length / 3, ...(disabledMorphTargets.length ? { disabledMorphTargets } : {}) });
    }
    output.meshes.push({ mesh: meshIndex, primitive: primitiveIndex, vertices: count, triangles: source.length / 3, levels });
  }
  await writeFile(resolve(outputDirectory, `Civilian${sex}Natural.lod.json`), JSON.stringify(output));
  console.log(filename, output.meshes.map(m => [m.triangles, ...m.levels.map(l => l.triangles)]));
}
