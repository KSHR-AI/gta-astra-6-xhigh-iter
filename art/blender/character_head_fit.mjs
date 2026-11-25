import * as THREE from 'three';

/** Body-specific fitting in source bind space. The lower neck stays at its
 * original cut while the cranium, eyes, hair and eyelid deltas share one affine
 * transform. A monotone C1 neck compression avoids a new shelf below the chin.
 * These dimensions are calibrated against posed shoulder/chin/skull landmarks,
 * rather than changing the animation skeleton or its inverse bind matrices. */
export const HEAD_FITS = {
  male: { scale: [10.8, 10.8, 11.0], neckShift: -.1, neckEnd: 7.02 },
  female: { scale: [.088, .098, .095], neckShift: -.0154, neckEnd: 5.76, neckContourEnd: 5.76 },
};

export function createHeadFit({ scale, offset, sourceCut, neckShift = 0, neckEnd = sourceCut + 1 }) {
  const span = neckEnd - sourceCut;
  if (!(span > 0) || !scale.every(value => Number.isFinite(value) && value > 0)
    || !offset.every(Number.isFinite) || !Number.isFinite(neckShift)
    || scale[1] + Math.min(0, neckShift) * 1.5 / span <= 0) {
    throw new Error('Head fit must retain a positive, finite neck Jacobian');
  }
  const factors = new THREE.Vector3(...scale), translation = new THREE.Vector3(...offset);
  return {
    position(native, isSkin, out = new THREE.Vector3()) {
      const t = isSkin ? THREE.MathUtils.clamp((native.y - sourceCut) / span, 0, 1) : 1;
      return out.copy(native).multiply(factors).add(translation)
        .addScaledVector(THREE.Object3D.DEFAULT_UP, neckShift * t * t * (3 - 2 * t));
    },
    linear(native, isSkin, out = new THREE.Matrix4()) {
      const t = isSkin ? THREE.MathUtils.clamp((native.y - sourceCut) / span, 0, 1) : 1;
      const dy = scale[1] + (isSkin ? neckShift * 6 * t * (1 - t) / span : 0);
      return out.makeScale(scale[0], dy, scale[2]);
    },
    affineFrom: neckEnd,
  };
}
