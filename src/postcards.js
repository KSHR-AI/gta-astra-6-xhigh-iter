import { Vector3 } from 'three';

const collectionKey = 'astra.coast-postcards.v1';
const subjects = [
  { id: 'paloma', title: 'Vacancy', hint: 'Center the Paloma Lodge roadside sign from the boulevard.', point: new Vector3(-18.08, 8.05, 56.4), range: 38, side: 1 },
  { id: 'sunline', title: 'Breakfast All Day', hint: 'Center the SUNLINE diner sign from the boulevard.', point: new Vector3(17.24, 5.25, 25), range: 32, side: -1 },
  { id: 'wheel', title: 'Last Light', hint: 'Center the Pacific Wheel from the beach at the end of Ocean Drive.', point: new Vector3(-193, 24, 0), range: 106, side: 1 },
];

export function createPostcardAlbum() {
  let collected = new Set();
  try {
    const ids = JSON.parse(globalThis.localStorage.getItem(collectionKey));
    if (Array.isArray(ids)) collected = new Set(ids.filter(id => subjects.some(shot => shot.id === id)));
  } catch { /* Keep a session album when browser storage is unavailable. */ }
  const projection = new Vector3();
  return {
    caption() {
      const next = subjects.find(shot => !collected.has(shot.id));
      const count = `Coast postcards · ${collected.size}/${subjects.length}`;
      return next ? `${count} · ${next.title} — ${next.hint}` : `${count} · Collection complete`;
    },
    frame(camera) {
      camera.updateMatrixWorld();
      return subjects.find(({ id, point, range, side }) => {
        if (collected.has(id) || (camera.position.x - point.x) * side < 4 || camera.position.distanceTo(point) > range) return false;
        projection.copy(point).project(camera);
        return projection.z > -1 && projection.z < 1 && Math.abs(projection.x) < .42 && Math.abs(projection.y) < .42;
      });
    },
    collect(shot) {
      if (!shot || collected.has(shot.id)) return;
      collected.add(shot.id);
      try { globalThis.localStorage.setItem(collectionKey, JSON.stringify([...collected])); } catch {}
      return shot.title;
    },
  };
}
