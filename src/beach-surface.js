import * as THREE from 'three';

// Original fine-grain sand at a physical scale. The existing terrain meshes,
// ground queries and shadows stay unchanged; this replaces only their finish.
export function applyBeachSurface(material, { textureRoot = '/textures/beach', loader = new THREE.TextureLoader() } = {}) {
  const loaded = [];
  const load = (name, color = false) => new Promise(resolve => {
    loader.load(`${textureRoot}/${name}.jpg`, texture => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 4;
      loaded.push(texture);
      resolve(texture);
    }, undefined, error => {
      console.warn(`Beach surface failed to load: ${name}`, error);
      resolve(null);
    });
  });
  material.roughness = 1;
  material.metalness = 0;
  material.normalScale = new THREE.Vector2(1, 1);
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 vBeachSurface;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `
      #include <uv_vertex>
      mat4 beachTransform = modelMatrix;
      #ifdef USE_INSTANCING
        beachTransform = modelMatrix * instanceMatrix;
      #endif
      vBeachSurface = (beachTransform * vec4(position, 1.)).xyz;
      vec3 beachNormal = normalize(mat3(beachTransform) * normal);
      vec2 beachUv = abs(beachNormal.y) > .5 ? vBeachSurface.xz
        : (abs(beachNormal.x) > .5 ? vBeachSurface.zy : vBeachSurface.xy);
      beachUv /= 2.4;
      #ifdef USE_MAP
        vMapUv = beachUv;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = beachUv;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = beachUv;
      #endif
    `);
    shader.fragmentShader = `varying vec3 vBeachSurface;
      float beachHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float beachNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(beachHash(i), beachHash(i + vec2(1., 0.)), f.x),
          mix(beachHash(i + vec2(0., 1.)), beachHash(i + vec2(1., 1.)), f.x), f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      // Several-metre deposits do not repeat with the fine 2.4 m surface tile.
      float beachDeposits = beachNoise(vBeachSurface.xz * .085);
      float beachWeather = beachNoise(vBeachSurface.xz * .021 + vec2(28.7, 6.2));
      diffuseColor.rgb *= .92 + .105 * beachDeposits + .055 * beachWeather;
      // The ocean ends at X=-150. A softly wandering, damp band lies only
      // beside that waterline; dry sand around the boardwalk stays matte.
      float beachShoreOffset = sin(vBeachSurface.z * .067) * .75
        + sin(vBeachSurface.z * .171 + 2.4) * .24;
      float beachWet = 1. - smoothstep(-150.8, -143.8, vBeachSurface.x + beachShoreOffset);
      diffuseColor.rgb *= mix(vec3(1.), vec3(.66, .65, .62), beachWet);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor *= mix(1., .77, beachWet);
    `);
  };
  material.customProgramCacheKey = () => 'astra-beach-world-sand-v1';
  material.needsUpdate = true;
  const ready = Promise.all([
    load('sand-color', true), load('sand-normal'), load('sand-rough'),
  ]).then(([map, normalMap, roughnessMap]) => {
    if (map) {
      material.map = map;
      // A mild warm mineral tint keeps the cool sky from reading as concrete.
      material.color.set('#fff4df');
    }
    if (normalMap) material.normalMap = normalMap;
    if (roughnessMap) material.roughnessMap = roughnessMap;
    material.needsUpdate = true;
  });
  return { ready, dispose() { for (const texture of loaded) texture.dispose(); } };
}
