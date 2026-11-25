/** Explicit walkable slabs, shared with the geometry authoring calls.
 * Roofs, furniture, vegetation and decals are never registered as ground.
 * Coordinates are the fixed district world frame, with Y-up and yaw about Y.
 */
export function createWalkableGround({ fallback = 0 } = {}) {
  const surfaces = [];
  const EDGE_EPSILON = 1e-8;
  if (!Number.isFinite(fallback)) throw new TypeError('Ground fallback must be finite');

  function addBox({ x, y, z, width, height, depth, rotation = 0, kind = 'floor' }) {
    if (![x, y, z, width, height, depth, rotation].every(Number.isFinite)
      || width <= 0 || height <= 0 || depth <= 0) throw new TypeError('Walkable boxes require finite coordinates and positive dimensions');
    const surface = Object.freeze({ x, z, height: y + height / 2,
      halfWidth: width / 2, halfDepth: depth / 2,
      cosine: Math.cos(rotation), sine: Math.sin(rotation), kind, index: surfaces.length });
    surfaces.push(surface);
    return surface.index;
  }

  function sample(x, z, target = {}) {
    let highest = -Infinity, selected = null;
    if (Number.isFinite(x) && Number.isFinite(z)) for (const surface of surfaces) {
      const dx = x - surface.x, dz = z - surface.z;
      const localX = dx * surface.cosine - dz * surface.sine;
      const localZ = dx * surface.sine + dz * surface.cosine;
      if (Math.abs(localX) <= surface.halfWidth + EDGE_EPSILON
        && Math.abs(localZ) <= surface.halfDepth + EDGE_EPSILON
        && surface.height > highest) { highest = surface.height; selected = surface; }
    }
    target.height = selected ? highest : fallback;
    target.kind = selected?.kind ?? 'fallback';
    target.index = selected?.index ?? -1;
    return target;
  }

  const heightSample = {};
  return { addBox, sample, heightAt: (x, z) => sample(x, z, heightSample).height,
    getSurfaces: () => surfaces.slice() };
}
