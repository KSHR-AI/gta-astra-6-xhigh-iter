import { Source } from 'three';

// Material clones share their source textures. Upgrade their pixels in place so
// every live actor keeps its authored sampler, color space, UVs and appearance.
const pending = [];
let running;

export function registerCharacterTextures(asset, modelUrl) {
  const textures = new Map();
  asset.scene.traverse(object => {
    for (const material of [].concat(object.material ?? [])) {
      for (const texture of Object.values(material)) {
        const uri = texture?.isTexture && texture.userData?.fullResolutionUri;
        if (!uri) continue;
        if (!textures.has(uri)) textures.set(uri, new Set());
        textures.get(uri).add(texture);
      }
    }
  });
  for (const [uri, targets] of textures) {
    const url = new URL(uri, new URL(modelUrl, document.baseURI)).href;
    pending.push(async () => {
      // Match GLTFLoader's ImageBitmap or HTMLImageElement decoding path.
      const result = await asset.parser.textureLoader.loadAsync(url);
      const image = result.isTexture ? result.image : result;
      const source = new Source(image);
      for (const texture of targets) {
        // WebGL 2 texture storage is immutable after its first allocation.
        // Keep the sampler object held by every material and allocate a fresh source.
        texture.dispose();
        texture.source = source;
        texture.needsUpdate = true;
      }
      if (result.isTexture) result.dispose();
    });
  }
}

export function streamCharacterTextures() {
  if (running || !pending.length) return running;
  running = (async () => {
    const retries = [];
    while (pending.length) {
      const upgrade = pending.shift();
      // Limit uploads of large original atlases to one per gameplay frame.
      await new Promise(resolve => requestAnimationFrame(resolve));
      try { await upgrade(); }
      catch { retries.push(upgrade); }
    }
    pending.push(...retries);
    running = undefined;
    if (retries.length) window.addEventListener('online', streamCharacterTextures, { once: true });
  })();
  return running;
}
