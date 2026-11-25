import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRoute } from '../src/map-navigation.js';

const roads = [
  ...[0, 80].map(x => ({ x, z: -20, length: 440, axis: 'z' })),
  ...[-90, 0, 90].map(z => ({ x: 37, z, length: 290, axis: 'x' })),
];

test('the east avenue circuit leg turns at the east avenue crossing', () => {
  const start = { x: 69, z: 94 }, goal = { x: 85, z: -77 };
  assert.deepEqual(mapRoute(roads, start, goal), [
    start, { x: 69, z: 90 }, { x: 80, z: 90 }, { x: 80, z: -77 }, goal,
  ]);
});

test('nearby parallel lanes connect through the shortest crossing', () => {
  const route = mapRoute(roads, { x: 3, z: -23 }, { x: 79, z: -16 });
  assert.deepEqual(route.slice(2, 4), [{ x: 0, z: 0 }, { x: 80, z: 0 }]);
});
