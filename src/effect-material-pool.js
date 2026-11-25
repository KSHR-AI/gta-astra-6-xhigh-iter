/**
 * Keep a bounded number of inactive material owners alive so transient effects
 * do not discard their last compiled shader program after every use. Live
 * effects always receive separate materials because their opacity may differ.
 */
export function createEffectMaterialPool(factories, { maxIdlePerKind = 16 } = {}) {
  if (!Number.isInteger(maxIdlePerKind) || maxIdlePerKind < 1) {
    throw new RangeError('At least one inactive material per kind must be retained');
  }
  const kinds = new Map(Object.entries(factories).map(([kind, create]) => {
    if (typeof create !== 'function') throw new TypeError('Material factories must be functions');
    return [kind, { create, idle: [] }];
  }));
  const owned = new Map();
  let disposed = false;
  return {
    acquire(kind, { opacity = 1, color } = {}) {
      if (disposed) return null;
      const bucket = kinds.get(kind);
      if (!bucket) throw new RangeError(`Unknown effect material kind: ${kind}`);
      const material = bucket.idle.pop() || bucket.create();
      owned.set(material, { bucket, active: true });
      material.opacity = opacity;
      if (color !== undefined) material.color.set(color);
      return material;
    },
    release(material) {
      const entry = owned.get(material);
      if (!entry?.active) return false;
      entry.active = false;
      if (entry.bucket.idle.length < maxIdlePerKind) entry.bucket.idle.push(material);
      else { owned.delete(material); material.dispose(); }
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of owned.keys()) material.dispose();
      owned.clear();
      for (const bucket of kinds.values()) bucket.idle.length = 0;
    },
  };
}
