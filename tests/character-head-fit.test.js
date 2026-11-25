import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadFit, HEAD_FITS } from '../art/blender/character_head_fit.mjs';

const landmarks = [
  { gender: 'male', cut: 70, sourceCut: 6.62, menton: 7.06330013, chin: 7.11670017, targetChin: [75.1, 75.6] },
  { gender: 'female', cut: 1.32, sourceCut: 5.16, menton: 5.78630018, chin: 5.82770014, targetChin: [1.367, 1.374] },
];

for (const landmark of landmarks) {
  const config = { ...HEAD_FITS[landmark.gender], sourceCut: landmark.sourceCut };
  config.offset = [0, landmark.cut - landmark.sourceCut * config.scale[1], 0];
  test(`${landmark.gender}: measured chin fit pins the body cut and remains affine above the jaw`, () => {
    const fit = createHeadFit(config);
    assert.ok(config.neckEnd < landmark.menton, 'the anatomical chin and every facial feature remain above the neck deformation');
    const cut = fit.position(new THREE.Vector3(0, landmark.sourceCut, 0), true);
    assert.ok(Math.abs(cut.y - landmark.cut) < 1e-12, 'the body contour stays at its existing cut plane');
    const chin = fit.position(new THREE.Vector3(0, landmark.chin, 0), true);
    assert.ok(chin.y >= landmark.targetChin[0] && chin.y <= landmark.targetChin[1], 'actual CC0 cage chin lands in the independently measured body fit range');
    const face = new THREE.Vector3(.3, landmark.menton + .5, 1.2), blinkDelta = new THREE.Vector3(.003, -.07, .004);
    const posedDelta = fit.position(face.clone().add(blinkDelta), true).sub(fit.position(face, true));
    const expected = blinkDelta.clone().applyMatrix4(fit.linear(face, true));
    assert.ok(posedDelta.distanceTo(expected) < 1e-12, 'fitted partial eyelid deformation shares the same affine transform as its face and eyeball');
    const tail = new THREE.Vector3(.2, landmark.sourceCut - .7, -.6);
    const expectedTailY = tail.y * config.scale[1] + config.offset[1] + config.neckShift;
    assert.ok(Math.abs(fit.position(tail, false).y - expectedTailY) < 1e-12, 'a ponytail below the cut follows the entire head instead of pinning itself to the shoulder');
  });

  test(`${landmark.gender}: compressed neck never folds and its normal Jacobian matches finite differences`, () => {
    const fit = createHeadFit(config), epsilon = 1e-6;
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const point = new THREE.Vector3(.2, landmark.sourceCut - .1 + i * (config.neckEnd - landmark.sourceCut + .2) / 100, .4);
      const fitted = fit.position(point, true);
      assert.ok(fitted.y > previous); previous = fitted.y;
      const numerical = fit.position(point.clone().add(new THREE.Vector3(0, epsilon, 0)), true)
        .sub(fit.position(point.clone().add(new THREE.Vector3(0, -epsilon, 0)), true)).multiplyScalar(.5 / epsilon);
      const analytic = new THREE.Vector3(0, 1, 0).applyMatrix4(fit.linear(point, true));
      assert.ok(numerical.distanceTo(analytic) < 1e-7, 'normal transformation follows the actual curved neck deformation');
    }
    assert.throws(() => createHeadFit({ ...config, neckShift: -10 * config.scale[1] }), /positive, finite neck Jacobian/);
  });
}
