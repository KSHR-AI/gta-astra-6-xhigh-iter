import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Original, editable Blender source: art/blender/city_streetscape.blend/.py.
// Each library part is already joined by material; repeated placements share
// one InstancedMesh, including all five cafe sets, for 21 additional draw calls.
export const CITY_PROP_PLACEMENTS = [
  { asset: 'BusShelter', x: 14.45, z: -39.5, yaw: -Math.PI / 2 },
  { asset: 'BusShelter', x: -14.45, z: 63, yaw: Math.PI / 2 },
  { asset: 'NewsKiosk', x: 15, z: 14.9, yaw: -Math.PI / 2 },
  ...[-46, -52, -58].map(z => ({ asset: 'CafeSet', x: -14.7, z, yaw: Math.PI / 2 })),
  ...[42, 49].map(z => ({ asset: 'CafeSet', x: -22.2, y: .035, z, yaw: .08 })),
];

const LOCAL_COLLIDERS = {
  BusShelter: [
    { x: -.35, z: -.85, w: 4.5, d: .12, h: 2.7, occludesSight: false },
    { x: -2.55, z: 0, w: .12, d: 1.8, h: 2.7, occludesSight: false },
    { x: 2.18, z: 0, w: .4, d: 1.6, h: 2.7 },
    { x: -.56, z: -.1, w: 3.75, d: .9, h: 1.2 },
  ],
  NewsKiosk: [{ x: 0, z: .15, w: 2.4, d: 2.0, h: 2.5 }],
  CafeSet: [
    { x: 0, z: 0, w: 1.05, d: 1.05, h: .9 },
    { x: -.98, z: 0, w: .68, d: .62, h: 1.05 },
    { x: .98, z: 0, w: .68, d: .62, h: 1.05 },
  ],
};

export function createCityProps(parent) {
  const root = new THREE.Group();
  root.name = 'Blender-authored Los Pacificos streetscape';
  parent.add(root);
  const colliders = [];
  for (const placement of CITY_PROP_PLACEMENTS) {
    const y = placement.y ?? .225;
    const cos = Math.cos(placement.yaw), sin = Math.sin(placement.yaw);
    for (const local of LOCAL_COLLIDERS[placement.asset]) {
      const x = placement.x + local.x * cos + local.z * sin;
      const z = placement.z - local.x * sin + local.z * cos;
      const w = Math.abs(local.w * cos) + Math.abs(local.d * sin);
      const d = Math.abs(local.w * sin) + Math.abs(local.d * cos);
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: local.h + y, occludesSight: local.occludesSight ?? local.h > 1.3 });
    }
  }
  const ownedGeometries = new Set(), ownedMaterials = new Set();
  let disposed = false;
  const stats = { drawCalls: 0, triangles: 0, placements: CITY_PROP_PLACEMENTS.length };
  const ready = new GLTFLoader().loadAsync('/models/city/city-streetscape.glb').then(gltf => {
    gltf.scene.updateMatrixWorld(true);
    for (const assetName of new Set(CITY_PROP_PLACEMENTS.map(p => p.asset))) {
      const source = gltf.scene.getObjectByName(assetName);
      if (!source) throw new Error(`City prop library is missing ${assetName}`);
      const placements = CITY_PROP_PLACEMENTS.filter(p => p.asset === assetName);
      const inverseRoot = source.matrixWorld.clone().invert();
      source.traverse(part => {
        if (!part.isMesh) return;
        const material = part.material;
        ownedGeometries.add(part.geometry); ownedMaterials.add(material);
        if (material.map) material.map.anisotropy = 4;
        material.envMapIntensity = material.metalness > .3 ? .65 : .35;
        if (material.name.includes('glass')) {
          material.transparent = true; material.opacity = .22;
          material.depthWrite = false; material.side = THREE.DoubleSide;
        }
        if (material.name.includes('fabric') || material.name.includes('linen')) material.side = THREE.DoubleSide;
        const instanced = new THREE.InstancedMesh(part.geometry, material, placements.length);
        instanced.name = part.name;
        instanced.castShadow = !material.transparent;
        instanced.receiveShadow = true;
        const local = inverseRoot.clone().multiply(part.matrixWorld);
        const transform = new THREE.Object3D();
        placements.forEach((placement, index) => {
          transform.position.set(placement.x, placement.y ?? .225, placement.z);
          transform.rotation.y = placement.yaw;
          transform.updateMatrix();
          instanced.setMatrixAt(index, transform.matrix.clone().multiply(local));
        });
        instanced.instanceMatrix.needsUpdate = true;
        instanced.computeBoundingBox(); instanced.computeBoundingSphere();
        root.add(instanced);
        stats.drawCalls++;
        stats.triangles += (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3 * placements.length;
      });
    }
    if (disposed) dispose();
    return stats;
  });
  function dispose() {
    disposed = true;
    root.removeFromParent();
    for (const geometry of ownedGeometries) geometry.dispose();
    const textures = new Set();
    for (const material of ownedMaterials) {
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      material.dispose();
    }
    for (const texture of textures) texture.dispose();
    root.clear(); ownedGeometries.clear(); ownedMaterials.clear();
  }
  return { root, ready, colliders, stats, dispose };
}
