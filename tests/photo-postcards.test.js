import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createPhotoMode } from '../src/photo-mode.js';
import { createPostcardAlbum } from '../src/postcards.js';

test('postcard awards follow the rendered exposure and successful download', t => {
  const values = new Map();
  const link = { click() {} };
  for (const [name, value] of Object.entries({
    devicePixelRatio: 1, document: { createElement: () => link },
    localStorage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  t.mock.method(globalThis, 'setTimeout', () => 0);
  const camera = new PerspectiveCamera(50, 1.6, .1, 1000);
  const sign = new Vector3(-18.08, 8.05, 56.4);
  camera.position.set(0, 3, 56.4);
  camera.lookAt(sign);
  let status, caption, processBlob;
  const mode = createPhotoMode({
    camera, canvas: { toBlob: callback => { processBlob = callback; } },
    renderer: { getPixelRatio: () => 1, setPixelRatio() {}, toneMappingExposure: 1 },
    rendering: { setPhotoQuality() {}, resize() {}, setLens() {} },
    ui: { setPhotoMode() {}, updatePhoto() {}, photoStatus: s => { status = s; }, postcardCaption: s => { caption = s; } },
  });
  mode.enter();
  assert.match(caption, /0\/3.*Paloma/);
  mode.capture(); mode.afterRender(); processBlob(null);
  assert.match(caption, /0\/3/);
  mode.capture(); mode.afterRender();
  camera.lookAt(40, 10, 56.4);
  processBlob(new Blob());
  assert.match(status, /Postcard collected · Vacancy/);
  assert.match(createPostcardAlbum().caption(), /1\/3.*SUNLINE/);
  camera.lookAt(sign);
  mode.capture(); mode.afterRender(); processBlob(new Blob());
  assert.match(status, /Photograph saved/);
  assert.equal(values.size, 1);
});

test('postcard framing requires a nearby camera facing the front of the subject', () => {
  const album = createPostcardAlbum();
  const cam = new PerspectiveCamera(50, 1, .1, 1000);
  for (const [x, y, z, targetX] of [[-32, 8, 56, -18], [0, 8, 56, 20], [150, 8, 56, -18]]) {
    cam.position.set(x, y, z);
    cam.lookAt(targetX, 8, 56);
    assert.equal(album.frame(cam), undefined);
  }
  cam.position.set(-130, 3, 0);
  cam.lookAt(-193, 24, 0);
  assert.equal(album.frame(cam)?.id, 'wheel');
});
