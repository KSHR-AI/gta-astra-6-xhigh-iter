import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNightShiftFreight } from '../src/night-shift-freight.js';
import { SHIFT_STOPS } from '../src/night-shift.js';

function fixture() {
  const root = new THREE.Group(), colliders = [];
  const freight = createNightShiftFreight({ root, colliders, canvasTexture: () => new THREE.Texture(),
    ground: { heightAt: () => .22 } });
  const carrier = new THREE.Group(), chassis = new THREE.Group();
  chassis.name = 'vehicle_damage_effects'; carrier.add(chassis);
  return { root, colliders, freight, carrier, chassis };
}
test('curb stocks unlock clear of pickup bays and the same cargo meshes follow the vehicle', () => {
  const { root, freight, colliders, carrier, chassis } = fixture();
  const display = root.getObjectByName('Night Shift loading stocks');
  assert.equal(display.visible, false);
  freight.update({ orders: [] });
  assert.equal(display.visible, true);
  assert.equal(colliders.length, 3);
  for (const { x, z } of SHIFT_STOPS) for (const c of colliders)
    assert.ok(x < c.minX - 1.15 || x > c.maxX + 1.15 || z < c.minZ - 2.3 || z > c.maxZ + 2.3);
  const pier = root.getObjectByName('Freight · pier'), glass = root.getObjectByName('Freight · sunline');
  const manifest = { orders: ['pier', 'sunline'], carrier };
  freight.update(manifest); freight.update(manifest);
  const rack = chassis.getObjectByName('Detachable freight rack');
  assert.ok(pier.parent === rack); assert.ok(glass.parent === rack);
  assert.equal(rack.children.length, 2);
  assert.ok(pier.position.x < glass.position.x);
  assert.equal(colliders.length, 3);
  carrier.position.set(15, 0, 67); carrier.rotation.y = Math.PI / 3;
  const offset = pier.getWorldPosition(new THREE.Vector3()).distanceTo(carrier.position);
  assert.ok(offset > 1 && offset < 3);
  freight.update({ orders: [] });
  assert.equal(chassis.children.length, 0);
  assert.ok(root.getObjectByName('Freight · pier') === pier);
  assert.ok(root.getObjectByName('Freight · sunline') === glass);
  freight.update(null);
  assert.equal(display.visible, false); assert.equal(colliders.length, 0);
});

test('a recovered two-package manifest waits at the most recent stop and transfers onto the replacement car', () => {
  const { root, freight, carrier } = fixture();
  const orders = ['paloma', 'pier'];
  freight.update({ orders, carrier: null, recovering: true });
  assert.equal(root.getObjectByName('Freight · paloma').visible, false);
  assert.equal(root.getObjectByName('Freight · pier').visible, true);
  freight.update({ orders, carrier });
  const rack = carrier.getObjectByName('Detachable freight rack');
  assert.deepEqual(rack.children.map(c => c.name), ['Freight · paloma', 'Freight · pier']);
  assert.ok(rack.children.every(c => c.visible));
});
