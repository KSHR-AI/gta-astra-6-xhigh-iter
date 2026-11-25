import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const models = ['CivilianMaleNatural', 'CivilianFemaleNatural'];

function previewImage(bytes) {
  // Our authored character atlases are square power-of-two PNGs. Box filtering
  // averages each original texel exactly once, including alpha and mask channels.
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width !== height || width <= 512 || width % 512 !== 0) return null;
  const image = PNG.sync.read(bytes);
  const stride = width / 512, area = stride * stride;
  const preview = new PNG({ width: 512, height: 512 });
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const dest = (y * 512 + x) * 4;
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0;
      for (let dy = 0; dy < stride; dy++) {
        const row = ((y * stride + dy) * width + x * stride) * 4;
        for (let dx = 0; dx < stride; dx++) sum += image.data[row + dx * 4 + channel];
      }
      preview.data[dest + channel] = Math.round(sum / area);
    }
  }
  return PNG.sync.write(preview);
}

// Strip earlier export stages while retaining every consumed geometry byte.
export function compactCharacterModel(input, emitTexture) {
  const jsonLength = input.readUInt32LE(12);
  const gltf = JSON.parse(input.toString('utf8', 20, 20 + jsonLength));
  if (gltf.buffers.length !== 1 || gltf.buffers[0].uri ||
      gltf.extensionsUsed?.some(name => !['KHR_materials_ior', 'KHR_materials_specular'].includes(name))) {
    // An unfamiliar extension may own additional buffer views or accessors.
    return input;
  }
  const binary = input.subarray(28 + jsonLength);
  const accessorRefs = [], viewRefs = [];
  function reference(list, object, key) {
    if (object[key] !== undefined) list.push([object, key]);
  }
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    reference(accessorRefs, primitive, 'indices');
    for (const attributes of [primitive.attributes, ...(primitive.targets ?? [])]) {
      for (const key of Object.keys(attributes)) reference(accessorRefs, attributes, key);
    }
  }
  for (const skin of gltf.skins ?? []) reference(accessorRefs, skin, 'inverseBindMatrices');
  for (const animation of gltf.animations ?? []) for (const sampler of animation.samplers) {
    reference(accessorRefs, sampler, 'input');
    reference(accessorRefs, sampler, 'output');
  }
  function reachable(entries, refs) {
    const indices = [...new Set(refs.map(([object, key]) => object[key]))].sort((a, b) => a - b);
    const remap = new Map(indices.map((index, next) => [index, next]));
    for (const [object, key] of refs) object[key] = remap.get(object[key]);
    return indices.map(index => entries[index]);
  }
  gltf.accessors = reachable(gltf.accessors, accessorRefs);
  for (const accessor of gltf.accessors) {
    reference(viewRefs, accessor, 'bufferView');
    if (accessor.sparse) {
      reference(viewRefs, accessor.sparse.indices, 'bufferView');
      reference(viewRefs, accessor.sparse.values, 'bufferView');
    }
  }
  const geometryViews = new Set(viewRefs.map(([object, key]) => object[key]));
  for (const image of gltf.images ?? []) reference(viewRefs, image, 'bufferView');
  const previews = new Map();
  for (const image of gltf.images ?? []) {
    if (!emitTexture || image.mimeType !== 'image/png' || image.bufferView === undefined || geometryViews.has(image.bufferView)) continue;
    const view = gltf.bufferViews[image.bufferView], start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const preview = previewImage(bytes);
    if (!preview) continue;
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const uri = `character-textures/${digest}.png`;
    emitTexture(uri, bytes);
    image.extras = { ...image.extras, fullResolutionUri: uri };
    previews.set(view, preview);
  }
  gltf.bufferViews = reachable(gltf.bufferViews, viewRefs);
  const chunks = [], locations = new Map();
  let offset = 0;
  for (const view of gltf.bufferViews) {
    const start = view.byteOffset ?? 0;
    const original = binary.subarray(start, start + view.byteLength);
    if (view.buffer !== 0 || original.length !== view.byteLength) throw new Error('Invalid character buffer view');
    const bytes = previews.get(view) ?? original;
    view.byteLength = bytes.length;
    // Alternate primitives can share the same encoded attribute bytes. Keep all
    // view definitions (including targets and strides) and reuse the BIN range.
    const hash = createHash('sha256').update(bytes).digest('hex');
    const previous = locations.get(hash);
    if (previous !== undefined) {
      view.byteOffset = previous;
      continue;
    }
    locations.set(hash, offset);
    const padding = (4 - bytes.length % 4) % 4;
    chunks.push(bytes, Buffer.alloc(padding));
    view.byteOffset = offset;
    offset += bytes.length + padding;
  }
  gltf.buffers[0].byteLength = offset;
  const text = Buffer.from(JSON.stringify(gltf));
  const jsonPadding = (4 - text.length % 4) % 4;
  const header = Buffer.from(input.subarray(0, 20));
  header.writeUInt32LE(28 + text.length + jsonPadding + offset, 8);
  header.writeUInt32LE(text.length + jsonPadding, 12);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(offset);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, text, Buffer.alloc(jsonPadding, 32), binaryHeader, ...chunks]);
}

// Strip earlier export stages while retaining every consumed geometry byte.
export function compactCharacterModels() {
  let publicDir;
  return {
    name: 'compact-character-models',
    apply: 'build',
    configResolved(config) { publicDir = config.publicDir; },
    async generateBundle() {
      for (const model of models) {
        const fileName = `models/${model}.glb`;
        const source = compactCharacterModel(await readFile(resolve(publicDir, fileName)), (uri, bytes) => {
          this.emitFile({ type: 'asset', fileName: `models/${uri}`, source: bytes });
        });
        this.emitFile({ type: 'asset', fileName, source });
        const lodFile = `models/${model}.lod.json`;
        const lod = JSON.parse(await readFile(resolve(publicDir, lodFile), 'utf8'));
        // The LOD index arrays address identical vertices in the smaller file.
        // Keep optimization proof with its authored GLB, and identify the delivery file here.
        const delivered = { ...lod };
        delete delivered.indexOptimization;
        delivered.authoringSha256 = lod.sha256;
        delivered.sha256 = createHash('sha256').update(source).digest('hex');
        this.emitFile({ type: 'asset', fileName: lodFile, source: JSON.stringify(delivered) });
      }
    },
  };
}
