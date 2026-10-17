import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/core/Animations/animatable.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/loaders/glTF/index.js';

// The harness owns requestAnimationFrame and supplies the same absolute time to
// every engine. There is deliberately no Babylon render loop or input handler.
export async function createScene(canvas, config) {
  const engine = new Engine(canvas, false, {
    alpha: false,
    antialias: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    disableWebGL2Support: false,
    adaptToDeviceRatio: false,
  }, false);
  engine.setHardwareScalingLevel(1);
  engine.setSize(config.width, config.height);
  if (engine.webGLVersion !== 2) {
    engine.dispose();
    throw new Error('The Babylon benchmark requires WebGL2; a WebGL1 fallback would not be comparable.');
  }

  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = Color4.FromHexString(`${config.background}ff`);
  scene.shadowsEnabled = Boolean(config.shadows);
  scene.environmentTexture = null;
  scene.skipPointerMovePicking = true;
  const imageProcessing = scene.imageProcessingConfiguration;
  imageProcessing.toneMappingEnabled = false;
  imageProcessing.exposure = 1;
  imageProcessing.contrast = 1;
  imageProcessing.applyByPostProcess = false;
  imageProcessing.vignetteEnabled = false;
  imageProcessing.colorCurvesEnabled = false;
  imageProcessing.colorGradingEnabled = false;

  const camera = new FreeCamera('benchmark-camera', new Vector3(0, config.camera.height, config.camera.radius), scene);
  camera.fov = config.camera.fovDegrees * Math.PI / 180;
  camera.minZ = config.camera.near;
  camera.maxZ = config.camera.far;
  camera.inputs.clear();
  const cameraTarget = Vector3.FromArray(config.camera.target);
  camera.setTarget(cameraTarget);
  scene.activeCamera = camera;

  const lightPosition = Vector3.FromArray(config.sun.position);
  const sun = new DirectionalLight('benchmark-sun', lightPosition.negate().normalize(), scene);
  sun.position.copyFrom(lightPosition);
  sun.diffuse = Color3.FromHexString(config.sun.color).toLinearSpace();
  sun.specular.copyFrom(sun.diffuse);
  sun.intensity = config.sun.intensity;
  sun.shadowFrustumSize = config.ground.size;
  sun.shadowMinZ = 0.1;
  sun.shadowMaxZ = config.camera.far;
  sun.autoUpdateExtends = false;

  // Equal upper/lower hemisphere colors remove the directional gradient. PBR
  // ambient-light math still differs by engine and is disclosed in info.notes.
  const ambient = new HemisphericLight('benchmark-ambient', Vector3.Up(), scene);
  ambient.diffuse = Color3.FromHexString(config.ambient.color).toLinearSpace();
  ambient.groundColor.copyFrom(ambient.diffuse);
  ambient.specular = Color3.Black();
  ambient.intensity = config.ambient.intensity;
  const shadows = config.shadows ? new ShadowGenerator(config.shadowMapSize, sun) : null;
  if (shadows) {
    shadows.filter = ShadowGenerator.FILTER_NONE;
    shadows.bias = 0.003;
    shadows.normalBias = 0.1;
  }

  function pbr(name, hex) {
    const material = new PBRMaterial(name, scene);
    material.albedoColor = Color3.FromHexString(hex).toLinearSpace();
    material.metallic = 0;
    material.roughness = 0.85;
    material.environmentIntensity = 0;
    return material;
  }
  function registerMesh(mesh) {
    if (!mesh.getTotalVertices()) return;
    mesh.receiveShadows = Boolean(config.shadows);
    shadows?.addShadowCaster(mesh, false);
  }
  const ground = CreateBox('ground', { width: config.ground.size, height: 0.2, depth: config.ground.size }, scene);
  ground.position.y = -0.1;
  ground.material = pbr('ground-material', config.ground.color);
  registerMesh(ground);

  const buildingMaterials = config.buildings.colors.map((color, i) => pbr(`building-material-${i}`, color));
  let firstBuilding;
  for (let row = 0; row < config.buildings.rows; row++) {
    for (let column = 0; column < config.buildings.columns; column++) {
      const name = `building-${row}-${column}`;
      // clone() shares geometry, while producing a real Mesh and separate draw
      // call. Do not replace this with createInstance() or thin instances.
      const building = firstBuilding
        ? firstBuilding.clone(name, null, true)
        : CreateBox(name, { width: config.buildings.width, height: 1, depth: config.buildings.depth }, scene);
      firstBuilding ||= building;
      const height = 4 + ((row * 13 + column * 7) % 14);
      const x = (column - (config.buildings.columns - 1) / 2) * config.buildings.spacing;
      const z = (row - (config.buildings.rows - 1) / 2) * config.buildings.spacing;
      const roadOffset = config.buildings.roadOffset ?? 0;
      building.scaling.set(1, height, 1);
      building.position.set(
        x + Math.sign(x) * roadOffset,
        height / 2,
        z + Math.sign(z) * roadOffset,
      );
      building.material = buildingMaterials[(row + column) % buildingMaterials.length];
      registerMesh(building);
    }
  }

  const containers = [];
  const walks = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const container of containers) container.dispose();
    scene.dispose();
    engine.dispose();
  }
  try {
    const load = async url => {
      const container = await LoadAssetContainerAsync(url, scene, {
        pluginOptions: { gltf: { animationStartMode: 0 } },
      });
      containers.push(container);
      return container;
    };
    // Await both loads even if one fails so disposal cannot race a late asset.
    const loaded = await Promise.allSettled([load(config.assets.car.url), load(config.assets.character.url)]);
    const failed = loaded.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [carContainer, characterContainer] = loaded.map(result => result.value);
    function cloneAt(container, name, position, yaw = 0) {
      const entries = container.instantiateModelsToScene(sourceName => `${name}-${sourceName}`, false, { doNotInstantiate: true });
      const wrapper = new TransformNode(name, scene);
      wrapper.position.copyFromFloats(...position);
      wrapper.rotation.y = yaw;
      for (const root of entries.rootNodes) {
        root.parent = wrapper;
        root.setEnabled(true);
      }
      for (const mesh of wrapper.getChildMeshes()) registerMesh(mesh);
      return entries;
    }
    config.assets.car.positions.forEach((position, index) => {
      cloneAt(carContainer, `car-${index}`, position, config.assets.car.yaw);
    });
    config.assets.character.positions.forEach((position, index) => {
      const entries = cloneAt(characterContainer, `character-${index}`, position);
      const group = entries.animationGroups.find(animation => animation.name === `character-${index}-${config.assets.character.clip}`);
      if (!group) throw new Error(`Character asset has no ${config.assets.character.clip} animation.`);
      group.start(true);
      group.pause();
      walks.push({ group, fps: group.targetedAnimations[0].animation.framePerSecond });
    });

    return {
      render(timeSeconds) {
        if (disposed) return;
        const time = Number.isFinite(timeSeconds) ? timeSeconds : 0;
        const angle = time * config.camera.orbitRadiansPerSecond;
        camera.position.set(Math.sin(angle) * config.camera.radius, config.camera.height, Math.cos(angle) * config.camera.radius);
        camera.setTarget(cameraTarget);
        for (const { group, fps } of walks) {
          const frameCount = group.to - group.from;
          const frame = frameCount > 0 ? ((time * fps) % frameCount + frameCount) % frameCount : 0;
          group.goToFrame(group.from + frame);
        }
        engine.beginFrame();
        scene.render();
        engine.endFrame();
      },
      dispose,
      info: {
        engine: 'Babylon.js',
        version: Engine.Version,
        buildings: config.buildings.rows * config.buildings.columns,
        cars: config.assets.car.positions.length,
        characters: config.assets.character.positions.length,
        animatedCharacters: walks.length,
        backend: 'WebGL2',
        notes: [
          'Ambient uses equal-color upper/lower hemispheric illumination; PBR ambient response is not numerically identical across engines.',
          'Original GLB materials, independent character skeletons, shared mesh geometry without instancing, and no post-processing or environment reflections.',
          config.shadows ? 'One 1024px directional hard-shadow map; 110m orthographic width; bias 0.003 and normal bias 0.1 to suppress surface acne.' : 'Shadows disabled.',
        ],
      },
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
