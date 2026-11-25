import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { localSunLightingChunk, cloneLocalSunReceiver, fitLocalSunCamera, makeDepthProxy, syncDepthProxy, createCharacterSelfShadow } from '../src/character-self-shadow.js';

const box = new THREE.Box3(new THREE.Vector3(-.45, 0, -.35), new THREE.Vector3(.45, 1.85, .35));
const sun = new THREE.Vector3(-.3, .106, .948).normalize();
const args = () => ({ active: true, bounds: box, sunDirection: sun });

test('bias edits affect receiver uniforms without changing the cached capture or shader key', () => {
  const renderer = makeRenderer(), { root, body } = fixture(), helper = createCharacterSelfShadow(renderer);
  helper.select(root); helper.update(args());
  const material = body.material, key = material.customProgramCacheKey();
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader, renderer);
  helper.setBiases({ normalBias: .0015, depthBias: .0003 });
  assert.equal(shader.uniforms.astraLocalSunNormalBias.value, .0015); assert.equal(shader.uniforms.astraLocalSunDepthBias.value, .0003);
  assert.equal(helper.update(args()), false); assert.equal(helper.getInfo().captures, 1); assert.equal(helper.getInfo().reason, 'cache');
  assert.equal(body.material, material); assert.equal(material.customProgramCacheKey(), key);
  assert.throws(() => helper.setBiases({ normalBias: .002, depthBias: NaN }), /Nonnegative/);
  assert.equal(helper.getInfo().normalBias, .0015); assert.equal(helper.getInfo().depthBias, .0003);
  assert.throws(() => helper.setBiases({ normalBias: null }), /Nonnegative/);
  helper.dispose(); assert.throws(() => helper.setBiases({ normalBias: .001 }), /disposed/);
});

function makeRenderer() {
  let target = { name: 'prior-target' }, face = 4, mip = 2;
  const color = new THREE.Color(.12, .14, .17); let alpha = .3;
  return {
    capabilities: {}, autoClear: true, xr: { enabled: true }, shadowMap: { enabled: true, autoUpdate: false, needsUpdate: true },
    info: { autoReset: true, render: { frame: 30, calls: 20, triangles: 400 } },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    getClearColor: result => result.copy(color), getClearAlpha: () => alpha,
    setRenderTarget(t, f = 0, m = 0) { target = t; face = f; mip = m; },
    setClearColor(c, a) { color.set(c); alpha = a; },
    clear(c, d, s) { assert.deepEqual([c, d, s], [true, true, false]); },
    render(scene, camera) {
      assert.equal(this.shadowMap.enabled, false);
      assert.equal(this.xr.enabled, false);
      assert.equal(this.info.autoReset, false);
      assert.equal(this.autoClear, false);
      assert.equal(scene.isScene, true);
      assert.equal(scene.matrixWorldAutoUpdate, false);
      assert.equal(scene.children.every(child => child.isMesh), true);
      assert.equal(camera.isOrthographicCamera, true);
      assert.equal(target.viewport.z, target.width);
      assert.equal(target.scissorTest, false);
      this.info.render.frame++;
      for (const proxy of scene.children) if (proxy.visible && (Array.isArray(proxy.material) ? proxy.material : [proxy.material]).some(material => material.visible)) { this.info.render.calls++; this.info.render.triangles += proxy.geometry.index.count / 3; }
      this.lastScene = scene;
      if (this.throwRender) throw new Error('simulated GPU failure');
    },
  };
}
function fixture() {
  const root = new THREE.Group(); root.name = 'selected-actor';
  const geometry = new THREE.BoxGeometry(.5, 1.8, .3);
  const material = new THREE.MeshPhysicalMaterial({ color: 0x977c6b, alphaTest: .42 });
  const body = new THREE.Mesh(geometry, material); root.add(body); root.updateMatrixWorld(true);
  return { root, body, geometry, material };
}
function snapshot(renderer) {
  return {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    clear: renderer.getClearColor(new THREE.Color()).toArray(), alpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear, xr: renderer.xr.enabled, shadow: { ...renderer.shadowMap }, infoAutoReset: renderer.info.autoReset,
  };
}

test('the receiver changes only directional RE_Direct; original chunk and indirect terms stay intact', () => {
  const original = THREE.ShaderChunk.lights_fragment_begin;
  const patched = localSunLightingChunk();
  const start = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
  const end = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';
  assert.equal(patched.slice(0, patched.indexOf(start)), original.slice(0, original.indexOf(start)));
  assert.equal(patched.slice(patched.indexOf(end)), original.slice(original.indexOf(end)));
  assert.equal(patched.match(/directLight.color \*= astraLocalSunVisibility/g).length, 1);
  assert.ok(patched.indexOf('getShadow( directionalShadowMap') < patched.indexOf('directLight.color *= astraLocalSunVisibility'));
  assert.match(patched, /UNROLLED_LOOP_INDEX == astraLocalSunIndex/);
  assert.equal(THREE.ShaderChunk.lights_fragment_begin, original);
  assert.throws(() => localSunLightingChunk('changed upstream chunk'), /Unsupported/);
});

test('material shader/cache hook composition preserves tint closures without mutating the shared source', () => {
  const original = new THREE.MeshPhysicalMaterial();
  let calls = 0, callbackThis;
  original.onBeforeCompile = function(shader) { calls++; callbackThis = this; shader.uniforms.wardrobeColor = { value: 'blue' }; shader.fragmentShader = '// wardrobe still runs\n' + shader.fragmentShader; };
  original.customProgramCacheKey = () => 'original-wardrobe-v4';
  const shared = { astraLocalSunEnabled: { value: 0 } };
  const clone = cloneLocalSunReceiver(original, shared);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  clone.onBeforeCompile(shader, {});
  assert.equal(calls, 1); assert.equal(callbackThis, clone); assert.equal(shader.uniforms.wardrobeColor.value, 'blue');
  assert.equal(shader.uniforms.astraLocalSunEnabled, shared.astraLocalSunEnabled);
  assert.match(clone.customProgramCacheKey(), /^original-wardrobe-v4\|astra-local-sun/);
  assert.equal(original.customProgramCacheKey(), 'original-wardrobe-v4');
  assert.ok(shader.vertexShader.indexOf('#include <skinning_vertex>') < shader.vertexShader.indexOf('vec3 astraLocalWorldNormal'));
  assert.ok(shader.vertexShader.indexOf('#include <displacementmap_vertex>') < shader.vertexShader.indexOf('vec3 astraLocalWorldNormal'));
  assert.match(shader.fragmentShader, /if \( astraLocalSunEnabled < 0.5 \) return 1.0;/);
  assert.match(shader.fragmentShader, /coord.z <= 0.0 \|\| coord.z >= 1.0/);
  assert.match(shader.fragmentShader, /visibility \/ 9.0/);
});

test('fit encloses all corners and sunward points have smaller depth at arbitrary directions and world offsets', () => {
  for (const resolution of [512, 1024]) for (const offset of [new THREE.Vector3(), new THREE.Vector3(120.3, -12, 84)]) for (const direction of [sun, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, .3, -1).normalize()]) {
    const bounds = box.clone().translate(offset), camera = new THREE.OrthographicCamera();
    const fit = fitLocalSunCamera(camera, bounds, direction, { resolution });
    assert.equal(fit.texelWorld, fit.span / resolution);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(fit.matrix);
      assert.ok(p.toArray().every(v => v > 0 && v < 1), `${p.toArray()} outside capture`);
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const centerDepth = center.clone().applyMatrix4(fit.matrix).z;
    const sunward = center.clone().addScaledVector(direction, .01).applyMatrix4(fit.matrix).z;
    assert.ok(sunward < centerDepth, `${sunward} should precede ${centerDepth}`);
  }
});

test('subtexel movement keeps the snapped lateral capture stable; large actor expands instead of clips', () => {
  const direction = new THREE.Vector3(0, 0, 1), camera = new THREE.OrthographicCamera();
  const a = fitLocalSunCamera(camera, box, direction);
  const b = fitLocalSunCamera(camera, box.clone().translate(new THREE.Vector3(.0001, 0, 0)), direction);
  assert.deepEqual(a.matrix.elements, b.matrix.elements);
  const big = new THREE.Box3(new THREE.Vector3(-2, 0, -.2), new THREE.Vector3(2, 1.8, .2));
  const fit = fitLocalSunCamera(camera, big, direction);
  assert.ok(fit.span > 4); assert.equal(fit.expanded, true);
  assert.throws(() => fitLocalSunCamera(camera, box, new THREE.Vector3()), /nonzero/);
});

test('shared skinned proxy yields identical CPU deformed vertices through morph, bone and nonuniform world transforms', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .2, .5, .1, -.3, 1, .2], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, .3, .7, 0, 0, 1, 0, 0, 0], 4));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([.01, .02, 0, 0, .03, .01, .02, 0, .03], 3)];
  const source = new THREE.SkinnedMesh(geometry, new THREE.MeshPhysicalMaterial());
  const hip = new THREE.Bone(), head = new THREE.Bone(); hip.add(head); head.position.y = .5; source.add(hip);
  source.updateMatrixWorld(true); source.bind(new THREE.Skeleton([hip, head]));
  source.position.set(5, .2, -4); source.scale.set(1.2, .9, 1.1); source.rotation.y = .3;
  head.rotation.x = .2; source.morphTargetInfluences[0] = .7; source.updateMatrixWorld(true);
  const proxy = makeDepthProxy(source, new THREE.MeshDepthMaterial());
  assert.equal(proxy.skeleton, source.skeleton); assert.equal(proxy.geometry, source.geometry);
  assert.equal(proxy.morphTargetInfluences, source.morphTargetInfluences); assert.equal(proxy.bindMode, source.bindMode);
  for (const mode of [THREE.AttachedBindMode, THREE.DetachedBindMode]) {
    source.bindMode = mode; head.rotation.z += .2; source.updateMatrixWorld(true); syncDepthProxy(source, proxy);
    for (let i = 0; i < 3; i++) {
      const a = source.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(source.matrixWorld);
      const b = proxy.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(proxy.matrixWorld);
      assert.ok(a.distanceTo(b) < 1e-12);
    }
  }
});

test('selected materials are isolated, depth masks match, frozen frames cache, explicit disable cannot use stale map', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture();
  const otherActor = new THREE.Mesh(body.geometry, material);
  const helper = createCharacterSelfShadow(renderer); helper.select(root);
  assert.notEqual(body.material, material); assert.equal(otherActor.material, material);
  const before = snapshot(renderer);
  assert.equal(helper.update(args()), true);
  assert.deepEqual(snapshot(renderer), before);
  const proxy = renderer.lastScene.children[0];
  assert.equal(proxy.material.alphaTest, .42); assert.equal(proxy.material.side, material.side);
  assert.equal(proxy.material.opacity, material.opacity); assert.equal(proxy.material.depthPacking, THREE.BasicDepthPacking);
  assert.equal(helper.getInfo().captures, 1); assert.equal(helper.getInfo().calls, 1);
  assert.equal(helper.update(args()), false); assert.equal(helper.getInfo().cacheHits, 1);
  assert.equal(helper.update({ ...args(), enabled: false }), false); assert.equal(helper.getInfo().enabled, false);
  assert.equal(helper.update(args()), false); assert.equal(helper.getInfo().enabled, true);
  assert.equal(helper.update({ active: false }), false); assert.equal(helper.getInfo().enabled, false);
  assert.equal(body.material, material); assert.equal(helper.getInfo().selected, null);
  helper.select(root); assert.equal(helper.update(args()), true);
  helper.dispose(); assert.equal(body.material, material); assert.equal(otherActor.material, material);
});

test('pose, morph, geometry, texture transform, mask cutoff and visibility changes invalidate depth capture', () => {
  const renderer = makeRenderer(), { root, body, geometry } = fixture();
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.array.length), 3)];
  body.updateMorphTargets(); body.material.map = new THREE.Texture();
  const helper = createCharacterSelfShadow(renderer); helper.select(root); helper.update(args());
  const changes = [
    () => { body.position.x += .1; root.updateMatrixWorld(true); },
    () => { body.morphTargetInfluences[0] = .4; },
    () => { geometry.attributes.position.needsUpdate = true; },
    () => { body.material.map.offset.x += .1; },
    () => { body.material.alphaTest = .5; },
    () => { body.visible = false; },
    () => { body.visible = true; },
  ];
  changes.forEach((change, i) => { change(); assert.equal(helper.update(args()), true, `change ${i}`); });
  assert.equal(helper.getInfo().captures, changes.length + 1);
  helper.dispose();
});

test('source skeleton changes invalidate even when caller revision is omitted', () => {
  const renderer = makeRenderer(), { root, geometry, material } = fixture(); root.clear();
  const count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const body = new THREE.SkinnedMesh(geometry, material), bone = new THREE.Bone(); body.add(bone); root.add(body); root.updateMatrixWorld(true); body.bind(new THREE.Skeleton([bone]));
  const helper = createCharacterSelfShadow(renderer); helper.select(root); assert.equal(helper.update(args()), true); assert.equal(helper.update(args()), false);
  bone.rotation.y = .05; root.updateMatrixWorld(true); assert.equal(helper.update(args()), true); helper.dispose();
});

test('render failure restores target, clear state, XR, shadow configuration and counter policy; receiver remains disabled', () => {
  const renderer = makeRenderer(), { root } = fixture(), helper = createCharacterSelfShadow(renderer);
  helper.select(root); const before = snapshot(renderer); renderer.throwRender = true;
  assert.throws(() => helper.update(args()), /simulated GPU failure/);
  assert.deepEqual(snapshot(renderer), before); assert.equal(helper.getInfo().enabled, false); assert.equal(helper.getInfo().captures, 0);
  renderer.throwRender = false; assert.equal(helper.update(args()), true); helper.dispose();
});

test('actor switches restore old materials, reject unsupported depth conventions and leave unrelated shared material intact', () => {
  const renderer = makeRenderer(), a = fixture(), b = fixture(), helper = createCharacterSelfShadow(renderer);
  helper.select(a.root); helper.update(args()); helper.select(b.root);
  assert.equal(a.body.material, a.material); assert.notEqual(b.body.material, b.material);
  assert.equal(helper.getInfo().enabled, false); assert.equal(helper.update(args()), true);
  helper.select(null); assert.equal(b.body.material, b.material); helper.dispose();
  assert.throws(() => createCharacterSelfShadow({ capabilities: { logarithmicDepthBuffer: true } }), /ordinary linear depth/);
  assert.throws(() => createCharacterSelfShadow({ capabilities: { reversedDepthBuffer: true } }), /ordinary linear depth/);
});

test('release preserves an external material-array slot and disposes every owned receiver exactly once', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture();
  const second = new THREE.MeshStandardMaterial(), external = new THREE.MeshStandardMaterial();
  body.material = [material, second];
  const helper = createCharacterSelfShadow(renderer); helper.select(root);
  const receivers = [...body.material], disposals = new Map();
  for (const item of [material, second, external, ...receivers]) item.addEventListener('dispose', () => disposals.set(item, (disposals.get(item) ?? 0) + 1));
  body.material[0] = external;
  helper.release();
  assert.deepEqual(body.material, [external, second]);
  assert.equal(disposals.get(external) ?? 0, 0, 'external replacement remains caller-owned');
  assert.equal(disposals.get(receivers[0]), 1, 'the displaced receiver is still released');
  assert.equal(disposals.get(receivers[1]), 1);
  helper.release(); helper.dispose();
  assert.equal(disposals.get(receivers[0]), 1); assert.equal(disposals.get(receivers[1]), 1);
  assert.equal(disposals.get(material) ?? 0, 0); assert.equal(disposals.get(second) ?? 0, 0);
});

test('an in-place array replacement recaptures using the new appearance and restores it on exit', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture();
  const second = new THREE.MeshStandardMaterial(), external = new THREE.MeshStandardMaterial({ alphaTest: .61 });
  external.map = new THREE.Texture(); body.material = [material, second];
  const helper = createCharacterSelfShadow(renderer); helper.select(root); helper.update(args());
  const displaced = body.material[0]; let displacedDisposals = 0, externalDisposals = 0;
  displaced.addEventListener('dispose', () => displacedDisposals++);
  external.addEventListener('dispose', () => externalDisposals++);
  body.material[0] = external;
  assert.equal(helper.update(args()), true);
  assert.notEqual(body.material[0], external); assert.notEqual(body.material[0], displaced);
  assert.equal(body.material[0].map, external.map); assert.equal(body.material[0].alphaTest, .61);
  assert.equal(renderer.lastScene.children[0].material[0].map, external.map);
  assert.equal(renderer.lastScene.children[0].material[0].alphaTest, .61);
  assert.equal(displacedDisposals, 1); assert.equal(externalDisposals, 0);
  assert.equal(helper.update(args()), false, 'new frozen appearance can reuse its capture');
  helper.release(); assert.deepEqual(body.material, [external, second]);
  helper.dispose(); assert.equal(externalDisposals, 0);
});

test('replaced and reordered arrays restore only owned slots while retaining external edits', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture();
  const second = new THREE.MeshStandardMaterial(), external = new THREE.MeshStandardMaterial();
  body.material = [material, second, material];
  const helper = createCharacterSelfShadow(renderer); helper.select(root);
  const [firstReceiver, secondReceiver] = body.material; let firstDisposals = 0;
  firstReceiver.addEventListener('dispose', () => firstDisposals++);
  body.material = [secondReceiver, external, firstReceiver, firstReceiver];
  helper.release();
  assert.deepEqual(body.material, [second, external, material, material]);
  assert.equal(firstDisposals, 1, 'shared receivers are disposed once despite repeated slots');
  helper.dispose();
});

test('actual character skin/hair and authored-wardrobe hooks compose with the auxiliary visibility patch', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/characters.js', import.meta.url), 'utf8');
  const start = source.indexOf('function prepareCharacterMaterial('), end = source.indexOf('\nfunction prepareMaleClothMask', start);
  assert.ok(start >= 0 && end > start);
  const prepare = new Function('THREE', 'white', `${source.slice(start, end)}; return prepareCharacterMaterial;`)(THREE, new THREE.Color(0xffffff));
  for (const naturalHead of [true, false]) {
    const original = new THREE.MeshPhysicalMaterial({ roughnessMap: new THREE.Texture() });
    original.userData = naturalHead ? { naturalHuman: true } : { clothingAuthored: true, trousersAuthored: true, shirtDyeLuminance: .2 };
    const prepared = prepare(original, { civilian: true, male: true, natural: true, skinTint: new THREE.Color(0xdac4b2), hairTint: new THREE.Color(0x73635a), npc: false, color: 0x384c58, police: false });
    const sourceKey = prepared.customProgramCacheKey();
    const wrapped = cloneLocalSunReceiver(prepared, { astraLocalSunEnabled: { value: 1 } });
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    wrapped.onBeforeCompile(shader, {});
    assert.ok(wrapped.customProgramCacheKey().startsWith(`${sourceKey}|`));
    assert.ok(shader.uniforms.skinTint.value.isColor);
    if (naturalHead) {
      assert.match(shader.vertexShader, /vSkinRegion = _skin_mask;/);
      assert.match(shader.fragmentShader, /diffuseColor.rgb \*= mix\(vec3\(1.0\), hairTint/);
    } else {
      assert.match(shader.vertexShader, /vClothDye = clothDye;/);
      assert.ok(shader.uniforms.wardrobeColor.value.isColor);
      assert.match(shader.fragmentShader, /vec3 matchedSkin/);
    }
    assert.equal(shader.fragmentShader.match(/directLight.color \*= astraLocalSunVisibility/g).length, 1);
  }
});

test('a failed recapture cannot later re-enable the old cache after returning to the earlier pose', () => {
  const renderer = makeRenderer(), { root, body } = fixture(), helper = createCharacterSelfShadow(renderer);
  helper.select(root); helper.update(args());
  body.position.x = .2; root.updateMatrixWorld(true); renderer.throwRender = true;
  assert.throws(() => helper.update(args()), /simulated GPU failure/);
  body.position.x = 0; root.updateMatrixWorld(true); renderer.throwRender = false;
  assert.equal(helper.update(args()), true, 'old state must recapture after partial texture overwrite');
  assert.equal(helper.getInfo().cacheHits, 0); helper.dispose();
});

test('material onBeforeRender retains callback identity, invocation arguments and receiver this', () => {
  const source = new THREE.MeshPhysicalMaterial();
  const input = [{ renderer: true }, { scene: true }, { camera: true }, { geometry: true }, { object: true }, { group: true }];
  let received;
  source.onBeforeRender = function(...args) { received = { self: this, args }; this.userData.callbackRan = true; };
  const clone = cloneLocalSunReceiver(source, {});
  assert.equal(clone.onBeforeRender, source.onBeforeRender);
  clone.onBeforeRender(...input);
  assert.equal(received.self, clone); assert.deepEqual(received.args, input);
  assert.equal(clone.userData.callbackRan, true); assert.equal(source.userData.callbackRan, undefined);
});

test('real player camera visibility controller keeps working across photo entry, A/B, exit and reentry', async () => {
  const { createPlayerCameraVisibility } = await import('../src/player-camera-visibility.js');
  const renderer = makeRenderer(), { root, body, material } = fixture();
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.48, .2); camera.updateMatrixWorld(true);
  const visibility = createPlayerCameraVisibility(root);
  const cachedControllerMaterial = body.material;
  const helper = createCharacterSelfShadow(renderer);
  assert.notEqual(cachedControllerMaterial, material);
  visibility.update(camera, { photoActive: false }); assert.equal(body.material.colorWrite, false);
  // Required order: photo mode first restores the controller-owned originals.
  visibility.update(camera, { photoActive: true }); assert.equal(body.material.colorWrite, true);
  helper.select(root); helper.update(args());
  const photoMaterial = body.material;
  assert.notEqual(photoMaterial, cachedControllerMaterial); assert.equal(photoMaterial.colorWrite, true);
  helper.update({ ...args(), enabled: false }); assert.equal(body.material, photoMaterial);
  helper.update(args()); assert.equal(body.material, photoMaterial);
  helper.update({ active: false });
  assert.equal(body.material, cachedControllerMaterial, 'exit must reconnect cached visibility material');
  visibility.update(camera, { photoActive: false, paused: true });
  assert.equal(visibility.getState().hidden, true); assert.equal(body.material.colorWrite, false); assert.equal(body.material.depthWrite, false);
  visibility.update(camera, { photoActive: true }); helper.select(root); helper.update(args());
  assert.equal(body.material.colorWrite, true); assert.equal(body.material.depthWrite, true);
  helper.release(); assert.equal(body.material, cachedControllerMaterial);
  visibility.dispose(); assert.equal(body.material, material); helper.dispose();
});

test('temporary receiver draw flags track the original controller-owned material before update', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture(), helper = createCharacterSelfShadow(renderer);
  helper.select(root); helper.update(args());
  material.colorWrite = false; material.depthWrite = false;
  helper.update(args()); assert.equal(body.material.colorWrite, false); assert.equal(body.material.depthWrite, false);
  material.colorWrite = true; material.depthWrite = true;
  helper.update(args()); assert.equal(body.material.colorWrite, true); assert.equal(body.material.depthWrite, true);
  helper.release(); assert.equal(body.material, material); helper.dispose();
});

test('full actor root includes weapon and magazine siblings while Basic contact patches remain untouched', () => {
  const renderer = makeRenderer(), { root, body } = fixture(); root.remove(body);
  const visual = new THREE.Group(); visual.name = 'visual'; visual.add(body); root.add(visual);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(.02, .1, .2), new THREE.MeshStandardMaterial()); weapon.name = 'pistol'; root.add(weapon);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(.02, .08, .03), new THREE.MeshStandardMaterial()); magazine.name = 'Reload magazine'; magazine.visible = false; root.add(magazine);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true })); contact.name = 'contact-shadow'; root.add(contact);
  root.updateMatrixWorld(true);
  const originals = [body.material, weapon.material, magazine.material, contact.material];
  const helper = createCharacterSelfShadow(renderer); helper.select(root); helper.update(args());
  assert.notEqual(body.material, originals[0]); assert.notEqual(weapon.material, originals[1]); assert.notEqual(magazine.material, originals[2]); assert.equal(contact.material, originals[3]);
  assert.deepEqual(renderer.lastScene.children.map(mesh => mesh.name), ['local-depth:', 'local-depth:pistol', 'local-depth:Reload magazine']);
  assert.equal(helper.getInfo().calls, 2); magazine.visible = true; assert.equal(helper.update(args()), true); assert.equal(helper.getInfo().calls, 3);
  helper.release(); assert.deepEqual([body.material, weapon.material, magazine.material, contact.material], originals); helper.dispose();
});

test('explicit extra casters include siblings without changing their materials; receiver/caster filters remain separate', () => {
  const renderer = makeRenderer(), { root, body, material } = fixture(); root.remove(body);
  const visual = new THREE.Group(); visual.add(body); root.add(visual);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(.02, .1, .2), new THREE.MeshStandardMaterial()); weapon.name = 'weapon'; root.add(weapon);
  const weaponMaterial = weapon.material;
  root.updateMatrixWorld(true);
  const helper = createCharacterSelfShadow(renderer);
  helper.select(visual, { extraCasters: [weapon, weapon] }); helper.update(args());
  assert.equal(renderer.lastScene.children.length, 2); assert.notEqual(body.material, material); assert.equal(weapon.material, weaponMaterial);
  weapon.position.y = .1; root.updateMatrixWorld(true); assert.equal(helper.update(args()), true);
  helper.release();
  const receiverFilter = mesh => mesh === body, casterFilter = mesh => mesh === weapon;
  helper.select(root, { receiverFilter, casterFilter }); helper.update(args());
  assert.notEqual(body.material, material); assert.equal(weapon.material, weaponMaterial);
  assert.deepEqual(renderer.lastScene.children.map(mesh => mesh.name), ['local-depth:weapon']);
  helper.dispose(); assert.equal(body.material, material); assert.equal(weapon.material, weaponMaterial);
});

test('DoubleSide transparent display-pass material version churn does not invalidate frozen depth', () => {
  const renderer = makeRenderer(), { root, body } = fixture();
  const brows = new THREE.Mesh(new THREE.BoxGeometry(.1, .01, .01), new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide }));
  root.add(brows); root.updateMatrixWorld(true);
  const helper = createCharacterSelfShadow(renderer); helper.select(root); helper.update(args());
  assert.equal(helper.getInfo().calls, 1); assert.equal(helper.getInfo().submittedMeshes, 1);
  const previousVersion = brows.material.version;
  for (let i = 0; i < 5; i++) {
    // Exactly the persistent version churn caused by Three's two-sided blend pass.
    brows.material.side = THREE.BackSide; brows.material.needsUpdate = true;
    brows.material.side = THREE.FrontSide; brows.material.needsUpdate = true;
    brows.material.side = THREE.DoubleSide;
    assert.equal(helper.update(args()), false);
  }
  assert.equal(brows.material.version, previousVersion + 10);
  assert.equal(helper.getInfo().captures, 1);
  body.material.needsUpdate = true; assert.equal(helper.update(args()), false, 'program version alone does not change depth');
  brows.material.alphaTest = .4; assert.equal(helper.update(args()), true, 'becoming an alpha-tested caster does change depth');
  assert.equal(helper.getInfo().calls, 2); helper.dispose();
});

test('lazy posed bounds are evaluated only for a capture, never frozen camera-only frames or A/B off', () => {
  const renderer = makeRenderer(), { root, body } = fixture(), helper = createCharacterSelfShadow(renderer);
  let reads = 0;
  const bounds = () => { reads++; return box; };
  helper.select(root); helper.update({ ...args(), bounds });
  for (let i = 0; i < 5; i++) helper.update({ ...args(), bounds });
  assert.equal(reads, 1);
  helper.update({ ...args(), bounds, enabled: false }); helper.update({ ...args(), bounds }); assert.equal(reads, 1);
  body.position.x = .1; root.updateMatrixWorld(true); helper.update({ ...args(), bounds }); assert.equal(reads, 2);
  helper.dispose();
});

test('neutral RGBA vertex alpha is accepted, but versioned alpha changes and alpha morphs fail closed', () => {
  const renderer = makeRenderer(), { root, body, geometry } = fixture();
  const colors = new Float32Array(geometry.attributes.position.count * 4); colors.fill(1);
  const attribute = new THREE.Float32BufferAttribute(colors, 4); geometry.setAttribute('color', attribute); body.material.vertexColors = true;
  const helper = createCharacterSelfShadow(renderer); helper.select(root); assert.equal(helper.update(args()), true);
  attribute.setW(0, .5); attribute.needsUpdate = true;
  assert.throws(() => helper.update(args()), /Nonopaque vertex alpha/); assert.equal(helper.getInfo().enabled, false);
  attribute.setW(0, 1); attribute.needsUpdate = true; assert.equal(helper.update(args()), true);
  geometry.morphAttributes.color = [attribute.clone()];
  assert.throws(() => helper.update(args()), /Morphed vertex alpha/); helper.dispose();
});


test('receiver-plane correction is present after actor switches and look-away reselection without any runtime wrapper', () => {
  const renderer = makeRenderer(), a = fixture(), b = fixture(), helper = createCharacterSelfShadow(renderer);
  for (const actor of [a, b, a]) {
    helper.select(actor.root); helper.update(args());
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    actor.body.material.onBeforeCompile(shader, renderer);
    const fragment = shader.fragmentShader;
    const start = fragment.indexOf('float astraLocalSunVisibility()');
    const firstBranch = fragment.indexOf('if (', start);
    assert.ok(fragment.indexOf('dFdx( coord )', start) < firstBranch);
    assert.ok(fragment.indexOf('dFdy( coord )', start) < firstBranch);
    assert.match(fragment, /floor\( coord\.xy \/ astraLocalSunTexel \)/);
    assert.match(fragment, /dot\( receiverGradient, sampleUV - coord\.xy \)/);
    assert.match(fragment, /texture2D\( astraLocalSunDepth, sampleUV \)/);
    assert.match(fragment, /coord\.z \+ planeCorrection - astraLocalSunDepthBias/);
    assert.match(actor.body.material.customProgramCacheKey(), /astra-local-sun-receiver-plane-v1/);
    assert.equal(shader.uniforms.astraLocalSunNormalBias.value, .0008);
    assert.equal(shader.uniforms.astraLocalSunDepthBias.value, .00015);
    helper.release(); assert.equal(actor.body.material, actor.material);
  }
  helper.dispose();
});
