import * as pc from 'playcanvas';

// The workload and camera path are defined by benchmarks/scene.json. In
// particular, buildings remain separate draws: no batching or instancing.
export async function createScene(canvas, config) {
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGL2],
    antialias: false,
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (device.deviceType !== pc.DEVICETYPE_WEBGL2) {
    device.destroy();
    throw new Error(`PlayCanvas benchmark requires WebGL2, received ${device.deviceType}`);
  }
  device.maxPixelRatio = 1;
  const app = new pc.Application(canvas, { graphicsDevice: device });
  app.autoRender = false;
  app.setCanvasResolution(pc.RESOLUTION_FIXED, config.width, config.height);
  app.scene.clusteredLightingEnabled = false;
  app.scene.exposure = 1;
  const materials = [];
  const characterEntities = [];
  let disposed = false;
  let previousTime = 0;
  let lastDrawCalls = 0;

  try {
    const color = value => new pc.Color().fromString(value);
    app.scene.ambientLight.copy(color(config.ambient.color).mulScalar(config.ambient.intensity));

    const camera = new pc.Entity('Benchmark camera');
    camera.addComponent('camera', {
      clearColor: color(config.background),
      fov: config.camera.fovDegrees,
      horizontalFov: false,
      nearClip: config.camera.near,
      farClip: config.camera.far,
      gammaCorrection: pc.GAMMA_SRGB,
      toneMapping: pc.TONEMAP_NONE,
    });
    app.root.addChild(camera);

    const sun = new pc.Entity('Benchmark sun');
    sun.addComponent('light', {
      type: 'directional',
      color: color(config.sun.color),
      intensity: config.sun.intensity,
      castShadows: Boolean(config.shadows),
      shadowResolution: config.shadowMapSize,
      shadowDistance: 110,
      numCascades: 1,
      shadowType: pc.SHADOW_PCF1_32F,
      shadowBias: .3,
      normalOffsetBias: .1,
    });
    const direction = new pc.Vec3(...config.sun.position).mulScalar(-1).normalize();
    sun.setRotation(new pc.Quat().setFromDirections(new pc.Vec3(0, -1, 0), direction));
    app.root.addChild(sun);

    const makeMaterial = hex => {
      const material = new pc.StandardMaterial();
      material.diffuse.copy(color(hex));
      material.useMetalness = true;
      material.metalness = 0;
      material.gloss = .15; // PlayCanvas gloss = 1 - roughness.
      material.update();
      materials.push(material);
      return material;
    };
    const boxMesh = pc.Mesh.fromGeometry(device, new pc.BoxGeometry());
    const box = (name, material, position, scale) => {
      const entity = new pc.Entity(name);
      entity.setLocalPosition(...position);
      entity.setLocalScale(...scale);
      const meshInstance = new pc.MeshInstance(boxMesh, material, entity);
      entity.addComponent('render', {
        meshInstances: [meshInstance],
        castShadows: true,
        receiveShadows: true,
      });
      app.root.addChild(entity);
    };
    box('Ground', makeMaterial(config.ground.color), [0, -.1, 0], [config.ground.size, .2, config.ground.size]);
    const buildingMaterials = config.buildings.colors.map(makeMaterial);
    const { rows, columns, spacing, width, depth, roadOffset = 0 } = config.buildings;
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const height = 4 + ((row * 13 + col * 7) % 14);
      const x = (col - (columns - 1) / 2) * spacing;
      const z = (row - (rows - 1) / 2) * spacing;
      box(`Building ${row}:${col}`, buildingMaterials[(row + col) % buildingMaterials.length],
        [x + Math.sign(x) * roadOffset, height / 2, z + Math.sign(z) * roadOffset],
        [width, height, depth]);
    }

    const loadContainer = url => new Promise((resolve, reject) => {
      app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (error) reject(new Error(`PlayCanvas could not load ${url}: ${error}`));
        else resolve(asset.resource);
      });
    });
    const [carAsset, characterAsset] = await Promise.all([
      loadContainer(config.assets.car.url),
      loadContainer(config.assets.character.url),
    ]);
    for (const position of config.assets.car.positions) {
      const entity = carAsset.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      entity.setLocalPosition(...position);
      entity.setLocalEulerAngles(0, config.assets.car.yaw * 180 / Math.PI, 0);
      app.root.addChild(entity);
    }
    const clipName = config.assets.character.clip;
    const animation = characterAsset.animations.find(asset => asset.resource.name === clipName || asset.name === clipName);
    if (!animation) throw new Error(`PlayCanvas character has no ${clipName} animation`);
    for (const position of config.assets.character.positions) {
      // Each instantiation creates its own graph and skin instances, sharing
      // only immutable meshes, material resources and the source AnimTrack.
      const entity = characterAsset.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
      entity.setLocalPosition(...position);
      app.root.addChild(entity);
      entity.addComponent('anim', { activate: true });
      entity.anim.assignAnimation(clipName, animation.resource);
      entity.anim.baseLayer.play(clipName);
      entity.anim.playing = true;
      characterEntities.push(entity);
    }

    const info = {
      engine: 'PlayCanvas',
      version: pc.version,
      buildings: rows * columns,
      cars: config.assets.car.positions.length,
      characters: characterEntities.length,
      animatedCharacters: characterEntities.length,
      backend: 'WebGL2',
      notes: [
        'Ambient uses PlayCanvas scene.ambientLight; ambient/PBR light calibration differs between engines.',
        'No antialiasing, tone mapping, post effects, environment reflections, batching or hardware instancing.',
        ...(config.shadows ? ['One 1024px directional PCF1 shadow map; 110m range, one cascade; shadowBias=0.3 and normalOffsetBias=0.1 to reduce self-shadow acne. PlayCanvas uses bilinear depth comparison even for PCF1, not exact nearest filtering.'] : []),
      ],
      get drawCalls() { return lastDrawCalls; },
    };

    return {
      info,
      render(timeSeconds) {
        if (disposed) return;
        const time = Math.max(0, timeSeconds);
        let delta = time - previousTime;
        if (delta < 0) {
          for (const entity of characterEntities) entity.anim.baseLayer.activeStateCurrentTime = time % animation.resource.duration;
          delta = 0;
        }
        previousTime = time;
        const angle = time * config.camera.orbitRadiansPerSecond;
        camera.setPosition(Math.sin(angle) * config.camera.radius, config.camera.height, Math.cos(angle) * config.camera.radius);
        camera.lookAt(...config.camera.target);
        // The harness owns requestAnimationFrame. Calling app.start() here would
        // create a second loop and invalidate the engine comparison.
        const before = device._drawCallsPerFrame;
        app.update(delta);
        app.render();
        lastDrawCalls = device._drawCallsPerFrame - before;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        app.destroy();
        for (const material of materials) material.destroy();
      },
    };
  } catch (error) {
    app.destroy();
    for (const material of materials) material.destroy();
    throw error;
  }
}
