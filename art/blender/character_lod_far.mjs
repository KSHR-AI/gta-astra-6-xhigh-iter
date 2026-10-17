/** Compact only the simplifier's working set. Unused duplicate vertices can
 * otherwise be classified as complex seam wedges and prevent simplification.
 * The returned map restores original IDs; no shipped attribute changes. */
export function compactReferencedVertices(indices, positions, surface, stride, locks) {
  const original = [...new Set(indices)], lookup = new Map(original.map((value, index) => [value, index]));
  return {
    original,
    indices: Uint32Array.from(indices, index => lookup.get(index)),
    positions: Float32Array.from(original.flatMap(index => Array.from(positions.subarray(index * 3, index * 3 + 3)))),
    surface: Float32Array.from(original.flatMap(index => Array.from(surface.subarray(index * stride, index * stride + stride)))),
    locks: Uint8Array.from(original, index => locks[index]),
  };
}

/** Preserve physical open edges, including the grafted neck and clothing hems.
 * Coincident UV/normal splits count as one geometric edge. Hair cards may
 * simplify within the surface error metric; their texture seams remain attrs. */
export function lockPhysicalBoundaries(indices, positions, locks, skinMask) {
  const ids = new Map(), canonical = new Map(), edges = new Map();
  for (const index of indices) {
    const key = Array.from(positions.subarray(index * 3, index * 3 + 3)).join(',');
    if (!ids.has(key)) ids.set(key, ids.size);
    canonical.set(index, ids.get(key));
  }
  for (let i = 0; i < indices.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const x = canonical.get(indices[i + a]), y = canonical.get(indices[i + b]);
    const key = x < y ? `${x}:${y}` : `${y}:${x}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const boundary = new Set();
  for (const [key, count] of edges) if (count === 1) key.split(':').forEach(index => boundary.add(Number(index)));
  for (const [index, id] of canonical) if (boundary.has(id) && (!skinMask || skinMask[index] > .5)) locks[index] = 1;
}

export function simplifyFarCharacter({ simplifier, indices, positions, attributes, morphLocks, poses }) {
  const count = positions.length / 3, stride = 32;
  if (!(poses instanceof Float32Array) || poses.length !== count * 27 || !poses.every(Number.isFinite)) throw new Error('Expected nine finite posed delta samples per vertex');
  const surface = new Float32Array(count * stride), locks = new Uint8Array(morphLocks);
  for (let i = 0; i < count; i++) {
    surface.set(attributes.NORMAL.values.subarray(i * 3, i * 3 + 3), i * stride);
    surface.set(attributes.TEXCOORD_0.values.subarray(i * 2, i * 2 + 2), i * stride + 3);
    surface.set(poses.subarray(i * 27, i * 27 + 27), i * stride + 5);
  }
  lockPhysicalBoundaries(indices, positions, locks, attributes._SKIN_MASK?.values);
  const compact = compactReferencedVertices(indices, positions, surface, stride, locks);
  const [reduced, error] = simplifier.simplifyWithAttributes(compact.indices, compact.positions, 3, compact.surface,
    stride, [.25, .25, .25, .2, .2, ...Array(27).fill(.5)], compact.locks,
    Math.floor(indices.length * .18 / 3) * 3, .018, []);
  return { indices: Array.from(reduced, index => compact.original[index]), error, triangles: reduced.length / 3 };
}
