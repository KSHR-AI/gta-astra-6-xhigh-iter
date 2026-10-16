import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../src/character-animation.js';
import { createPoseTools } from '../src/character-pose.js';

const RIGS = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];

async function actor({ model, motion, height }) {
  const bytes = await readFile(new URL(`../public/models/${model}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = new THREE.Group(), visual = new THREE.Group();
  mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {};
  asset.scene.traverse(object => {
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, '');
    bones[name] = object; restPose[name] = object.quaternion.clone();
  });
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion());
  const clips = JSON.parse(await readFile(new URL(`../public/models/${motion}`, import.meta.url), 'utf8'));
  const mixer = new THREE.AnimationMixer(asset.scene);
  const actions = Object.fromEntries(clips.map(clip => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(asset.scene, true);
  visual.scale.setScalar(height / (bounds.max.y - bounds.min.y));
  asset.scene.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);
  const weapon = new THREE.Group(), magazine = new THREE.Group();
  weapon.userData.gripCenter = [0, -0.046, -0.037];
  mesh.add(weapon, magazine);
  const animation = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine,
    soleProbes: [], restPose, bindHeadOrientation, npc: false });
  const pose = createPoseTools(mesh, bones);
  function frame(options = {}, count = 1, dt = 1 / 60) {
    for (let i = 0; i < count; i++) animation.update(dt, options);
    return animation.getPoseInfo();
  }
  return { mesh, visual, bones, weapon, magazine, animation, pose, frame };
}


let vehiclesReady;
async function aurora() {
  vehiclesReady ??= (async () => {
    const vehicles = await import('../src/vehicles.js');
    await vehicles.loadVehicleAssets({ async loadAsync(path) {
      const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
      return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    } });
    return vehicles;
  })();
  const { createCar } = await vehiclesReady;
  return createCar({ type: 'sport' });
}

for (const rig of RIGS) {
  test(`${rig.model}: seated torso and palms stay attached to the real suspended Aurora cockpit`, async () => {
    const driver = await actor(rig), reference = await actor(rig), car = await aurora();
    const chassis = car.mesh.getObjectByName('suspended_chassis');
    const wheel = car.mesh.getObjectByName('steering_wheel');
    assert.ok(chassis && wheel, 'the authored vehicle provides its real cockpit transforms');
    car.mesh.position.set(14, 0.1, -23);
    let maximumPalmError = 0, maximumTorsoError = 0;
    for (let i = 0; i < 240; i++) {
      const steering = Math.sin(i * 0.037);
      // Include headings on either side of the Euler-y gimbal boundary. The
      // cockpit frame must remain coherent when its quaternion crosses it.
      car.mesh.rotation.y = 1.2 + i * 0.012;
      car.setDynamics({ roll: Math.sin(i * 0.041) * 0.07, pitch: Math.cos(i * 0.029) * 0.055, heave: Math.sin(i * 0.05) * 0.03 });
      car.update(1 / 60, 7, steering);
      const seat = car.mesh.localToWorld(car.getDriverSeat());
      driver.mesh.position.copy(seat);
      car.getDriverOrientation(driver.mesh.quaternion);
      const info = driver.frame({ seated: true, steering });
      reference.frame({ seated: true, steering });
      assert.ok(driver.bones.Hips.getWorldPosition(new THREE.Vector3()).distanceTo(seat) < 1e-6, 'pelvis follows the suspended seat position exactly');
      for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck']) {
        maximumTorsoError = Math.max(maximumTorsoError, driver.pose.position(name).distanceTo(reference.pose.position(name)));
      }
      for (const [side, sign] of [['right', -1], ['left', 1]]) {
        const actual = driver.mesh.localToWorld(new THREE.Vector3().fromArray(info.grip.hands[side].palmGripCenter));
        const target = wheel.localToWorld(new THREE.Vector3(sign * 0.15, 0, 0));
        maximumPalmError = Math.max(maximumPalmError, actual.distanceTo(target));
        assert.equal(info.grip.hands[side].mode, 'steering');
      }
    }
    assert.ok(maximumTorsoError < 1e-5, `cockpit transforms do not add the on-foot turn lean (${maximumTorsoError} m)`);
    assert.ok(maximumPalmError < 0.002, `both actual-rig palm centers track the moving steering rim within 2 mm (${maximumPalmError} m)`);
    driver.mesh.traverse(object => {
      if (!object.isSkinnedMesh) return;
      const point = new THREE.Vector3();
      for (let index = 0; index < object.geometry.attributes.position.count; index += 73) {
        object.getVertexPosition(index, point);
        assert.ok(point.toArray().every(Number.isFinite), 'suspension and grip correction retain valid posed skin');
      }
    });
  });

  test(`${rig.model}: entering and leaving the seat retains a continuous hand transition`, async () => {
    const driver = await actor(rig);
    driver.frame({}, 60);
    const positions = () => ['Left', 'Right'].map(side => driver.pose.position(`${side}Hand`));
    let previous = positions(), largestStep = 0;
    for (const phase of ['enter', 'exit']) {
      for (let i = 0; i <= 102; i++) {
        driver.frame({ interactionPhase: phase, interactionProgress: i / 102, steering: 0.5 });
        const current = positions();
        for (let side = 0; side < current.length; side++) largestStep = Math.max(largestStep, current[side].distanceTo(previous[side]));
        previous = current;
      }
    }
    assert.ok(largestStep < 0.055, `the palm correction blends through the reach instead of snapping to the wheel (${largestStep} m)`);
    driver.frame({}, 90);
    const info = driver.animation.getPoseInfo();
    assert.equal(info.state, 'idle');
    assert.equal(info.grip.hands.left.mode, 'relaxed');
    assert.equal(info.grip.hands.right.mode, 'relaxed');
    assert.ok(info.pelvis[1] > 0.8, 'standing restores the normal pelvis height');
  });
}

for (const rig of RIGS) {
  test(`${rig.model}: disabled seated driver slumps into the lap and releases the wheel`, async () => {
    const driver = await actor(rig);
    driver.mesh.position.set(14, 0.5, -17);
    driver.mesh.rotation.set(0.055, 1.2, -0.07);
    driver.frame({ seated: true, steering: 0.6 }, 90);
    const uprightHead = driver.pose.position('Head');
    for (let i = 0; i < 180; i++) {
      const info = driver.frame({ seated: true, dead: true, steering: 0.6 });
      assert.ok(new THREE.Vector3().fromArray(info.pelvis).length() < 1e-6, 'disabled driver pelvis remains at the suspended seat');
      assert.ok(Math.abs(driver.visual.rotation.z) < 0.01, 'the seated body never uses the sideways ground-fall rotation');
    }
    const down = driver.animation.getPoseInfo(), slumpedHead = driver.pose.position('Head');
    assert.equal(down.state, 'down');
    assert.ok(slumpedHead.y < uprightHead.y - 0.05, `neck joint descends as the torso folds (${uprightHead.y - slumpedHead.y} m)`);
    assert.ok(slumpedHead.z > uprightHead.z + 0.16, 'torso folds forward over the lap');
    for (const side of ['left', 'right']) {
      assert.equal(down.grip.hands[side].mode, 'relaxed', 'disabled driver no longer grips the wheel');
      const palm = new THREE.Vector3().fromArray(down.grip.hands[side].palmGripCenter);
      assert.ok(palm.y < 0.18, 'relaxed hands drop below the steering wheel into the lap');
    }
    const recovered = driver.frame({ seated: true, steering: 0.6 }, 240);
    assert.equal(recovered.state, 'driving');
    assert.ok(driver.pose.position('Head').distanceTo(uprightHead) < 0.01, 'recovery restores the seated posture');
    assert.equal(recovered.grip.hands.left.mode, 'steering');
    assert.equal(recovered.grip.hands.right.mode, 'steering');
  });
}
