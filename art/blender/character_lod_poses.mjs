import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const POSE_SAMPLES = [['Idle', .5], ...['Walk', 'Run'].flatMap(name => [.1, .35, .6, .85].map(phase => [name, phase]))];

/** Nine clip samples form a 27-channel deformation metric. Coordinates remain
 * in the original skinned mesh space and are normalized by character extent.
 * They influence simplification only; shipped weights/vertices are untouched. */
export async function poseSamples(bytes, clips) {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'OFFLINE_SKIP_TEXTURE_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mixer = new THREE.AnimationMixer(asset.scene), result = new Map(), objects = [];
  asset.scene.traverse(object => {
    if (!object.isSkinnedMesh) return;
    const association = asset.parser.associations.get(object);
    objects.push(object);
    result.set(`${association.meshes}:${association.primitives}`, new Float32Array(object.geometry.attributes.position.count * 27));
  });
  const extent = Math.max(...objects.map(object => {
    object.geometry.computeBoundingBox();
    return object.geometry.boundingBox.getSize(new THREE.Vector3()).length();
  }));
  if (!Number.isFinite(extent) || extent <= 0) throw new Error('Character must have a finite positive extent');
  const vertex = new THREE.Vector3(), base = new THREE.Vector3();
  for (const [sampleIndex, [name, phase]] of POSE_SAMPLES.entries()) {
    const source = clips.find(clip => clip.name === name);
    if (!source) throw new Error(`Missing deformation sample clip ${name}`);
    mixer.stopAllAction();
    const clip = THREE.AnimationClip.parse(source);
    mixer.clipAction(clip).play(); mixer.setTime(clip.duration * phase);
    asset.scene.updateMatrixWorld(true);
    for (const object of objects) {
      const association = asset.parser.associations.get(object);
      const output = result.get(`${association.meshes}:${association.primitives}`), position = object.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        object.getVertexPosition(i, vertex); base.fromBufferAttribute(position, i);
        vertex.sub(base).divideScalar(extent).toArray(output, i * 27 + sampleIndex * 3);
      }
    }
  }
  return result;
}
