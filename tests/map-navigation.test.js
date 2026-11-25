import assert from 'node:assert/strict';
import test from 'node:test';
import { cityMapCenter, cityMapScale, mapClickPosition, mapRoute, nextMapTurn } from '../src/map-navigation.js';

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

test('a street turn stays ahead of the player and points toward the objective', () => {
  const goal = { x: 28, z: -126 };
  assert.equal(nextMapTurn(mapRoute(roads, { x: 4, z: -70 }, goal), 48), null);
  assert.deepEqual(nextMapTurn(mapRoute(roads, { x: 4, z: -95 }, goal), 48),
    { x: 0, z: -126, heading: Math.PI / 2 });
  assert.equal(nextMapTurn(mapRoute(roads, { x: 0, z: -10 }, { x: 0, z: -30 }), 48), null);
});

test('map taps preserve street coordinates for wide and tall letterboxed canvases', () => {
  for (const [width, height] of [[850, 410], [300, 440]]) {
    const canvas = { width: 1000, height: 800, getBoundingClientRect: () => ({ left: 20, top: 50, width, height }) };
    const scale = Math.min(width / canvas.width, height / canvas.height) * cityMapScale(canvas.width, canvas.height);
    const click = mapClickPosition(canvas, 20 + width / 2 + (80 - cityMapCenter.x) * scale,
      50 + height / 2 + (90 - cityMapCenter.z) * scale);
    assert.ok(Math.abs(click.x - 80) < 1e-10 && Math.abs(click.z - 90) < 1e-10);
  }
});
