import * as THREE from 'three';

// Remove only the direct solar disc from an HDR lighting map. The photographic
// background stays untouched; an aligned shadowed directional light supplies
// direct solar illumination. This is not an exposure or whole-sky adjustment.
export function separateSolarEnvironment(source, sourceSunDirection, {
  coreRadius = .45, outerRadius = 1, annulusInner = 1.25, annulusOuter = 2,
} = {}) {
  if (!source?.image) throw new Error('Solar separation requires a finite RGBA HDR sky');
  const { data, width, height } = source.image;
  if (![THREE.HalfFloatType, THREE.FloatType].includes(source.type)
      || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || !(data instanceof Uint16Array || data instanceof Float32Array)
      || data.length !== width * height * 4 || !sourceSunDirection?.isVector3
      || ![...sourceSunDirection.toArray(), coreRadius, outerRadius, annulusInner, annulusOuter].every(Number.isFinite)
      || sourceSunDirection.lengthSq() < .99 || sourceSunDirection.lengthSq() > 1.01
      || !(coreRadius > 0 && coreRadius < outerRadius && outerRadius < annulusInner && annulusInner < annulusOuter && annulusOuter <= 5)) {
    throw new Error('Solar separation requires a finite RGBA HDR sky and bounded angular radii');
  }
  const half = source.type === THREE.HalfFloatType;
  if (half !== (data instanceof Uint16Array)) throw new Error('HDR storage type does not match texture type');
  const read = half ? THREE.DataUtils.fromHalfFloat : value => value;
  const write = half ? THREE.DataUtils.toHalfFloat : value => value;
  const center = sourceSunDirection.clone().normalize();
  const radians = Math.PI / 180;
  const outerCos = Math.cos(outerRadius * radians);
  const innerRingCos = Math.cos(annulusInner * radians);
  const outerRingCos = Math.cos(annulusOuter * radians);
  const ring = [], selected = [];
  const direction = new THREE.Vector3();
  const energyBefore = [0, 0, 0], energyRemoved = [0, 0, 0];
  let peakBefore = 0;
  for (let y = 0; y < height; y++) {
    const theta = (y + .5) / height * Math.PI, sinTheta = Math.sin(theta);
    const weight = sinTheta * 2 * Math.PI * Math.PI / (width * height);
    for (let x = 0; x < width; x++) {
      const phi = ((x + .5) / width - .5) * 2 * Math.PI;
      direction.set(Math.cos(phi) * sinTheta, Math.cos(theta), Math.sin(phi) * sinTheta);
      const offset = (y * width + x) * 4;
      const rgb = [read(data[offset]), read(data[offset + 1]), read(data[offset + 2])];
      if (!rgb.every(value => Number.isFinite(value) && value >= 0)) throw new Error('HDR sky contains invalid radiance');
      for (let k = 0; k < 3; k++) energyBefore[k] += rgb[k] * weight;
      peakBefore = Math.max(peakBefore, rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722);
      const dot = center.dot(direction);
      if (dot >= outerCos) selected.push({ offset, rgb, direction: direction.clone(), angle: Math.acos(Math.min(1, dot)) / radians, weight });
      else if (dot <= innerRingCos && dot >= outerRingCos) ring.push({ rgb, direction: direction.clone(), weight });
    }
  }
  if (!ring.length || !selected.length) throw new Error('HDR resolution does not resolve the solar neighborhood');
  const output = data.slice();
  let changedPixels = 0;
  for (const pixel of selected) {
    const replacement = [0, 0, 0]; let sum = 0;
    for (const sample of ring) {
      // A smooth local sky interpolation preserves the broad halo/gradient.
      const weight = sample.weight / (pixel.direction.distanceToSquared(sample.direction) + (.5 * radians) ** 2);
      sum += weight;
      for (let k = 0; k < 3; k++) replacement[k] += sample.rgb[k] * weight;
    }
    const t = THREE.MathUtils.clamp((pixel.angle - coreRadius) / (outerRadius - coreRadius), 0, 1);
    const retained = t * t * (3 - 2 * t);
    let changed = false;
    for (let k = 0; k < 3; k++) {
      const localSky = Math.min(pixel.rgb[k], replacement[k] / sum);
      output[pixel.offset + k] = write(localSky + (pixel.rgb[k] - localSky) * retained);
      const result = read(output[pixel.offset + k]);
      energyRemoved[k] += (pixel.rgb[k] - result) * pixel.weight;
      changed ||= output[pixel.offset + k] !== data[pixel.offset + k];
    }
    changedPixels += Number(changed);
  }
  const texture = new THREE.DataTexture(output, width, height, THREE.RGBAFormat, source.type);
  texture.mapping = source.mapping; texture.colorSpace = source.colorSpace;
  texture.minFilter = source.minFilter; texture.magFilter = source.magFilter;
  texture.flipY = source.flipY; texture.generateMipmaps = false; texture.needsUpdate = true;
  texture.name = `${source.name || 'HDR sky'} · separated solar disc`;
  return { texture, stats: { width, height, changedPixels, pixelCount: width * height,
    changedFraction: changedPixels / (width * height), selectedPixels: selected.length,
    annulusPixels: ring.length, coreRadius, outerRadius, annulusInner, annulusOuter,
    sourceSunDirection: center.toArray(), peakBefore, integratedRGBBefore: energyBefore,
    integratedRGBRemoved: energyRemoved,
    removedEnergyFraction: energyRemoved.map((value, k) => value / Math.max(energyBefore[k], 1e-12)) } };
}
