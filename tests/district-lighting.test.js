import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, MeshPhysicalMaterial, Texture, CubeUVReflectionMapping } from 'three';
import { cloneLocalSunReceiver } from '../src/character-self-shadow.js';
import { createDistrictLighting } from '../src/district-lighting.js';

function atlas(width, height) {
  const texture = new Texture({ width, height });
  texture.mapping = CubeUVReflectionMapping;
  return texture;
}

test('night draws retain daylight program keys and sample each native atlas with its actual dimensions', () => {
  const scene = new Scene(), material = new MeshPhysicalMaterial();
  const day = atlas(1536, 2048), night = atlas(768, 1024), vehicle = atlas(384, 512);
  let actual, canonical, counts, fail = false;
  material.onBeforeCompile = shader => { shader.uniforms.originalHook = true; };
  const renderer = {
    renderBufferDirect() {
      assert.equal(material.envMap || scene.environment, canonical);
      const shader = { uniforms: {}, numPointLights: 4, numSpotLights: 2, fragmentShader:
        '#include <cube_uv_reflection_fragment>\n#include <envmap_physical_pars_fragment>\n#include <lights_fragment_begin>' };
      material.onBeforeCompile(shader, renderer);
      assert.equal(shader.uniforms.originalHook, true);
      assert.equal(shader.uniforms.districtEnvironment.value, actual);
      assert.deepEqual(shader.uniforms.districtAtlas.value.toArray(), [1 / actual.image.width, 1 / actual.image.height, Math.log2(actual.image.height) - 2]);
      assert.deepEqual(Array.from(shader.uniforms.districtLightCounts.value), counts);
      assert.match(shader.fragmentShader, /textureCubeUV\( districtEnvironment,/);
      assert.match(shader.fragmentShader, /i < districtLightCounts\.x/);
      assert.match(shader.fragmentShader, /i < districtLightCounts\.y/);
      if (fail) throw Error('draw failed');
    },
  };
  const lighting = createDistrictLighting(renderer, scene);
  lighting.setMaps({ day, night, vehicle });
  function draw(texture, keyMap, ownMap, active) {
    actual = texture; canonical = keyMap; counts = active;
    material.envMap = ownMap ? texture : null;
    scene.environment = ownMap ? day : texture;
    lighting.setLightCounts(...active);
    renderer.renderBufferDirect(null, scene, null, material);
    assert.equal(material.envMap || scene.environment, texture);
  }
  draw(day, day, false, [0, 0]);
  const key = material.customProgramCacheKey(), version = material.version;
  draw(night, day, false, [4, 2]);
  draw(vehicle, vehicle, true, [0, 0]);
  draw(night, vehicle, true, [4, 0]);
  assert.equal(material.customProgramCacheKey(), key);
  assert.equal(material.version, version);
  fail = true;
  assert.throws(() => draw(night, vehicle, true, [4, 0]), /draw failed/);
  assert.equal(material.envMap, night);
});

test('photo receiver retains the local directional shadow alongside the native reflection and fixture hooks', () => {
  const scene = new Scene(), day = atlas(1536, 2048);
  scene.environment = day;
  let result;
  const renderer = {
    renderBufferDirect(camera, scene, geometry, material) {
      result = { uniforms: {}, numPointLights: 4, numSpotLights: 2,
        vertexShader: '#include <project_vertex>',
        fragmentShader: '#include <cube_uv_reflection_fragment>\n#include <envmap_physical_pars_fragment>\n#include <lights_fragment_begin>' };
      material.onBeforeCompile(result, renderer);
    },
  };
  const lighting = createDistrictLighting(renderer, scene);
  lighting.setMaps({ day });
  const source = new MeshPhysicalMaterial();
  renderer.renderBufferDirect(null, scene, null, source);
  const receiver = cloneLocalSunReceiver(source, {});
  renderer.renderBufferDirect(null, scene, null, receiver);
  assert.match(result.fragmentShader, /astraLocalSunDepth/);
  assert.match(result.fragmentShader, /i < districtLightCounts.x/);
  assert.equal(result.fragmentShader.match(/uniform ivec2 districtLightCounts/g).length, 1);
  assert.equal(result.uniforms.districtEnvironment.value, day);
});
