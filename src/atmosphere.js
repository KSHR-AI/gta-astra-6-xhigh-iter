import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { separateSolarEnvironment } from './solar-environment.js';

// Poly Haven / Greg Zaal + Jarod Guest, CC0. A photographic, terrain-free sky.
const SKY_URL = '/textures/sky/qwantani_sunset_puresky_2k.hdr';
export const SKY_ROTATION = -1.25;
// Measured from the brightest source pixel, then rotated with the visible sky.
export const SUN_DIRECTION = new THREE.Vector3(-0.3000497, 0.1056472, 0.9480547);

function configureTexture(texture) {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

// Only used if an asset request is interrupted; normal rendering uses the HDR.
function fallbackTexture() {
  const width = 128, height = 64, data = new Float32Array(width * height * 4);
  const horizon = new THREE.Color('#c8d9dc');
  const zenith = new THREE.Color('#507fba');
  const color = new THREE.Color();
  for (let y = 0; y < height; y += 1) {
    const elevation = Math.max(0, Math.cos((y + 0.5) / height * Math.PI));
    color.copy(horizon).lerp(zenith, Math.pow(elevation, 0.4));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = color.r; data[offset + 1] = color.g; data[offset + 2] = color.b; data[offset + 3] = 1;
    }
  }
  return configureTexture(new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType));
}

// Keep the same cloud shapes after dark. Compress the solar radiance before
// cooling it: merely dimming an HDR leaves its sun burning white. Half-size,
// half-float storage keeps the additional night texture to 4 MB of GPU memory.
function makeNightTexture(source) {
  const { data: original, width: sourceWidth, height: sourceHeight } = source.image;
  const width = Math.min(1024, sourceWidth), height = Math.min(512, sourceHeight);
  const data = new Uint16Array(width * height * 4);
  const toHalf = THREE.DataUtils.toHalfFloat;
  const read = source.type === THREE.HalfFloatType ? THREE.DataUtils.fromHalfFloat : value => value;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceOffset = (Math.floor(y * sourceHeight / height) * sourceWidth + Math.floor(x * sourceWidth / width)) * 4;
    const offset = (y * width + x) * 4;
    const r = read(original[sourceOffset]), g = read(original[sourceOffset + 1]), b = read(original[sourceOffset + 2]);
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const radiance = luminance / (1 + luminance / 6);
    data[offset] = toHalf(0.001 + radiance * 0.017);
    data[offset + 1] = toHalf(0.003 + radiance * 0.024);
    data[offset + 2] = toHalf(0.007 + radiance * 0.045);
    data[offset + 3] = toHalf(1);
  }
  const texture = configureTexture(new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType));
  texture.name = 'Qwantani Sunset · derived moonlit sky';
  return texture;
}

/**
 * Visible sky and lighting share the HDR orientation; the lighting derivative
 * excludes the solar disc represented by the shadowed directional light.
 *
 * const atmosphere = createAtmosphere(scene);
 * const { lightingTexture, nightTexture } = await atmosphere.ready;
 * atmosphere.setEnvironment(pmrem.fromEquirectangular(lightingTexture).texture,
 *                           pmrem.fromEquirectangular(nightTexture).texture);
 *
 * The caller owns PMREM render targets and directional/hemisphere lighting.
 */
export function createAtmosphere(scene) {
  const rotation = new THREE.Euler(0, SKY_ROTATION, 0);
  const sunDirection = SUN_DIRECTION.clone();
  let night = false, dayTexture, nightTexture, dayEnvironment, nightEnvironment;
  let photographicSky = true;
  scene.background = new THREE.Color('#9bbbd2');
  scene.backgroundRotation.copy(rotation);
  scene.environmentRotation.copy(rotation);
  scene.backgroundBlurriness = 0;

  function applyMode() {
    if (dayTexture) scene.background = night ? nightTexture : dayTexture;
    scene.backgroundIntensity = night ? 1 : 0.65;
    scene.environmentIntensity = night ? .55 : .85;
    if (dayEnvironment) scene.environment = night ? (nightEnvironment || dayEnvironment) : dayEnvironment;
    // A caller providing only the day PMREM still gets subdued reflections.
    if (night && !nightEnvironment) scene.environmentIntensity = 0.035;
  }

  const ready = new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(SKY_URL)
    .catch(error => {
      photographicSky = false;
      console.warn('Photographic sky unavailable; using local sky fallback.', error);
      return fallbackTexture();
    })
    .then(texture => {
      dayTexture = configureTexture(texture);
      dayTexture.name = 'Qwantani Sunset Pure Sky · Poly Haven CC0';
      nightTexture = makeNightTexture(dayTexture);
      // The source equirectangular pixels precede the scene's sky rotation.
      // Invert that rotation to locate the same solar disc in source space.
      const sourceSun = sunDirection.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(rotation).invert()).normalize();
      const separated = photographicSky ? separateSolarEnvironment(dayTexture, sourceSun) : null;
      applyMode();
      return { texture: dayTexture, lightingTexture: separated?.texture ?? dayTexture,
        solarSeparationStats: separated?.stats ?? { skipped: 'procedural fallback has no solar disc' },
        nightTexture, sunDirection, rotation };
    });

  applyMode();
  return {
    ready, sunDirection, rotation,
    get texture() { return dayTexture; },
    get nightTexture() { return nightTexture; },
    setNight(value) { night = Boolean(value); applyMode(); },
    setEnvironment(day, nightMap) {
      dayEnvironment = day;
      nightEnvironment = nightMap;
      scene.environmentRotation.copy(rotation);
      applyMode();
    },
  };
}
