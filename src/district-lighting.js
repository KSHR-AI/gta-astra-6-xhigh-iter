import { CubeUVReflectionMapping, ShaderChunk, Vector3 } from 'three';

// All six local fixtures are unshadowed and have no projector maps. Use the same
// lighting equations as Three, with the number of active fixtures supplied by
// a uniform. This avoids compiling (and executing by day) six unrolled BRDFs.
const localLights = `
#if defined( RE_Direct ) && NUM_POINT_LIGHTS > 0
  for (int i = 0; i < districtLightCounts.x; ++i) {
    getPointLightInfo(pointLights[i], geometryPosition, directLight);
    RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
#endif
#if defined( RE_Direct ) && NUM_SPOT_LIGHTS > 0
  for (int i = 0; i < districtLightCounts.y; ++i) {
    getSpotLightInfo(spotLights[i], geometryPosition, directLight);
    RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }
#endif
`;
const lights = ShaderChunk.lights_fragment_begin;
const originalLocalLights = lights.slice(lights.indexOf('#if ( NUM_POINT_LIGHTS'), lights.indexOf('#if ( NUM_DIR_LIGHTS'));

// The scene sky, night sky and local vehicle probe have different native PMREM
// resolutions. Keep every texel. Three's atlas lookup uses three layout constants;
// substituting the corresponding uniforms requires no resampling or extra targets.
const cubeUV = ShaderChunk.cube_uv_reflection_fragment
  .replaceAll('CUBEUV_TEXEL_WIDTH', 'districtAtlas.x')
  .replaceAll('CUBEUV_TEXEL_HEIGHT', 'districtAtlas.y')
  .replaceAll('CUBEUV_MAX_MIP', 'districtAtlas.z');
const physical = ShaderChunk.envmap_physical_pars_fragment
  .replaceAll('textureCubeUV( envMap,', 'textureCubeUV( districtEnvironment,');

export function createDistrictLighting(renderer, scene) {
  const lightCounts = { value: new Int32Array(2) };
  const materials = new WeakMap(), layouts = new WeakMap();
  let day, night, vehicle;
  function layout(texture) {
    let value = layouts.get(texture);
    if (!value) {
      const { width, height } = texture.image;
      value = new Vector3(1 / width, 1 / height, Math.log2(height) - 2);
      layouts.set(texture, value);
    }
    return value;
  }
  function prepare(material) {
    let uniforms = materials.get(material);
    if (uniforms) return uniforms;
    uniforms = { map: { value: null }, atlas: { value: null } };
    materials.set(material, uniforms);
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer);
      // Photo receiver clones compose this callback before adding their custom
      // directional shadow. The clone receives its own district bindings afterward.
      if (this !== material) return;
      shader.uniforms.districtLightCounts = lightCounts;
      shader.uniforms.districtEnvironment = uniforms.map;
      shader.uniforms.districtAtlas = uniforms.atlas;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <cube_uv_reflection_fragment>',
          'uniform vec3 districtAtlas;\nuniform sampler2D districtEnvironment;\n' + cubeUV)
        .replace('#include <envmap_physical_pars_fragment>', physical);
      if (shader.numPointLights === 4 && shader.numSpotLights === 2 &&
          !shader.numPointLightShadows && !shader.numSpotLightShadows && !shader.numSpotLightMaps) {
        shader.fragmentShader = 'uniform ivec2 districtLightCounts;\n' +
          shader.fragmentShader.replace('#include <lights_fragment_begin>', lights).replace(originalLocalLights, localLights);
      }
    };
    material.customProgramCacheKey = () => key + '|district-lighting-v1';
    material.needsUpdate = true;
    return uniforms;
  }
  const draw = renderer.renderBufferDirect;
  renderer.renderBufferDirect = function(camera, passScene, geometry, material, object, group) {
    const hasOwnMap = Boolean(material.envMap);
    const actual = hasOwnMap ? material.envMap : passScene?.environment;
    if (!material.isMeshStandardMaterial || actual?.mapping !== CubeUVReflectionMapping) {
      return draw.call(this, camera, passScene, geometry, material, object, group);
    }
    const uniforms = prepare(material);
    uniforms.map.value = actual;
    uniforms.atlas.value = layout(actual);

    // The renderer includes the environment's height in its program key. During
    // the scene draw, select the same key as daylight while binding the real map
    // above. Reflection strength, rotation, render targets and camera are untouched.
    if (actual !== night || passScene !== scene) {
      return draw.call(this, camera, passScene, geometry, material, object, group);
    }
    const owner = hasOwnMap ? material : passScene, property = hasOwnMap ? 'envMap' : 'environment';
    owner[property] = hasOwnMap ? vehicle : day;
    try { return draw.call(this, camera, passScene, geometry, material, object, group); }
    finally { owner[property] = actual; }
  };
  return {
    setLightCounts(points, spots) { lightCounts.value[0] = points; lightCounts.value[1] = spots; },
    setMaps(maps) { ({ day, night, vehicle } = maps); },
  };
}
