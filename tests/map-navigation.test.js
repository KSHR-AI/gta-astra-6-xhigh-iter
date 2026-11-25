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

test('Sunline routes use its two real intersections for trips to and from the south crossing', () => {
  const lane = { x:55, z:-45, axis:'z', length:90 };
  const network = [...roads, lane];
  const start = { x:55, z:-25 }, goal = { x:67, z:90 };
  const expected = [start, start, {x:55,z:0}, {x:80,z:0}, {x:80,z:90}, goal, goal];
  assert.deepEqual(mapRoute(network,start,goal),expected);
  assert.deepEqual(mapRoute(network,goal,start),[...expected].reverse());
  assert.deepEqual(mapRoute(network,start,{x:52,z:-90}).slice(2,3),[{x:55,z:-90}]);
});

test('every pair of grid pins has a route whose interior legs stay on paved centre lines', () => {
  const network = [...roads, { x:55, z:-45, axis:'z', length:90 }];
  const pins = [];
  for (const x of [-132,3,43,54,70,85,140,194]) {
    for (const z of [-230,-126,-89,-35,1,58,90,180]) pins.push({x,z});
  }
  function contains(road, point) {
    const across = road.axis === 'x' ? 'z' : 'x';
    return road[across] === point[across] && Math.abs(road[road.axis] - point[road.axis]) <= road.length / 2;
  }
  for (const from of pins) for (const to of pins) {
    const route = mapRoute(network,from,to);
    assert.equal(route.at(-1),to);
    for (let i = 2; i < route.length - 1; i++) {
      assert.ok(network.some(road => contains(road,route[i-1]) && contains(road,route[i])));
    }
  }
});

test('both fork cues and map lines follow the two drivable departures', async () => {
  const { Group, Mesh, MeshBasicMaterial } = await import('three');
  const { createLastLightForkCues, drawLastLightFork, showLastLightFork } = await import('../src/last-light-map.js');
  const template = new Mesh(undefined,new MeshBasicMaterial());
  template.visible = false;
  const cues = createLastLightForkCues(template,() => 0);
  new Group().add(...cues);
  assert.deepEqual(cues.map(c => [Math.round(c.position.x),Math.round(c.position.z),c.material.color.getHexString()]),
    [[3,-8,'ffc56d'],[11,0,'84dfd1']]);
  assert.equal(showLastLightFork('fork'),true);
  assert.equal(showLastLightFork('drive'),false);
  const paths = [];
  const ctx = {
    save() {}, restore() {}, stroke() {}, beginPath() { paths.push([]); },
    moveTo(x,z) { paths.at(-1).push([x,z]); }, lineTo(x,z) { paths.at(-1).push([x,z]); },
  };
  drawLastLightFork(ctx,x => x,z => z,true);
  assert.deepEqual(paths[1],[[3,0],[55,0],[55,-90],[4,-90]]);
  assert.deepEqual(paths[0].at(-1),paths[1].at(-1));
});
