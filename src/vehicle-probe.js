import { CubeUVReflectionMapping, DataTexture, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat } from 'three';
import { assetUrl } from './asset-url.js';

// Three r180 packs the PMREM of a 128px cubemap into this half-float atlas.
export const PROBE_WIDTH = 384;
export const PROBE_HEIGHT = 512;
const pixels = PROBE_WIDTH * PROBE_HEIGHT;
const sampleCount = pixels * 4;
const magic = [65, 85, 80, 49]; // AUP1

export async function decodeVehicleProbe(buffer, quality) {
  const bytes = new Uint8Array(buffer);
  if (!magic.every((v, i) => bytes[i] === v) || bytes[4] !== Number(quality === 'high')) {
    throw new Error('Unexpected vehicle reflection probe header');
  }
  const stream = new Blob([bytes.subarray(5)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const planes = new Uint8Array(await new Response(stream).arrayBuffer());
  if (planes.length !== sampleCount * 2) throw new Error('Incomplete vehicle reflection atlas');
  const rgba = new Uint16Array(sampleCount);
  for (let channel = 0; channel < 4; channel++) {
    const lo = channel * 2 * pixels, hi = lo + pixels;
    for (let row = 0; row < pixels; row += PROBE_WIDTH) {
      let previous = 0;
      for (let i = row; i < row + PROBE_WIDTH; i++) {
        previous = (previous + planes[lo + i] + (planes[hi + i] << 8)) & 65535;
        rgba[4 * i + channel] = previous;
      }
    }
  }
  return rgba;
}

export function loadVehicleProbe(quality) {
  let data;
  const ready = (async () => {
    if (typeof DecompressionStream === 'undefined') return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(assetUrl(`textures/sky/vehicle-probe-${quality}.bin`), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await decodeVehicleProbe(await response.arrayBuffer(), quality);
    } catch (error) {
      console.warn('Using live vehicle reflection capture.', error);
    } finally {
      clearTimeout(timeout);
    }
  })();
  return {
    ready,
    createTarget(shadows, sky) {
      // A changed preset or a procedural fallback sky needs its own live capture.
      if (!data || shadows !== (quality === 'high') || sky.solarSeparationStats?.skipped) return null;
      const texture = new DataTexture(data, PROBE_WIDTH, PROBE_HEIGHT, RGBAFormat, HalfFloatType);
      texture.name = `Auto Works · ${quality} daylight reflections`;
      texture.mapping = CubeUVReflectionMapping;
      texture.colorSpace = LinearSRGBColorSpace;
      texture.minFilter = texture.magFilter = LinearFilter;
      texture.needsUpdate = true;
      return { texture, dispose: () => texture.dispose() };
    },
  };
}
