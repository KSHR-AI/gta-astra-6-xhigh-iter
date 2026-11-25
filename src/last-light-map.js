import { LAST_LIGHT_FORK, LAST_LIGHT_ROUTES } from './last-light.js';

const colors = { boulevard: '#ffc56d', service: '#84dfd1' };

export function showLastLightFork(phase) {
  return phase === 'approach' || phase === 'fork';
}

export function drawLastLightFork(ctx, px, py, full) {
  const boulevard = LAST_LIGHT_ROUTES.boulevard;
  const service = LAST_LIGHT_ROUTES.service;
  const fork = LAST_LIGHT_FORK;
  const exit = service.at(-2);
  const reunion = { x: boulevard[0].x, z: exit.z };
  const lines = {
    boulevard: [fork, { x: reunion.x, z: fork.z }, reunion],
    service: [fork, { x: exit.x, z: fork.z }, exit, reunion],
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [branch, points] of Object.entries(lines)) {
    ctx.beginPath();
    ctx.moveTo(px(points[0].x), py(points[0].z));
    for (const p of points.slice(1)) ctx.lineTo(px(p.x), py(p.z));
    ctx.lineWidth = full ? 6 : 4;
    ctx.strokeStyle = '#213033';
    ctx.stroke();
    ctx.lineWidth = full ? 3.5 : 2;
    ctx.strokeStyle = colors[branch];
    ctx.stroke();
  }
  ctx.restore();
}

// The shared chevron geometry points towards +Z before rotation.
export function createLastLightForkCues(template, heightAt) {
  return Object.entries(LAST_LIGHT_ROUTES).map(([branch, gates]) => {
    const cue = template.clone();
    cue.material = template.material.clone();
    cue.material.color.set(colors[branch]);
    const heading = gates[0].heading;
    const x = LAST_LIGHT_FORK.x + 8 * Math.sin(heading);
    const z = LAST_LIGHT_FORK.z + 8 * Math.cos(heading);
    cue.position.set(x, heightAt(x,z) + .1, z);
    cue.rotation.y = heading;
    return cue;
  });
}
