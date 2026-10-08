import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceViewport } from '../web/view-camera.js';
import { worldToScreen } from '../web/whiteboard-model.js';

test('practice centers the visible card at normal scale on a wide viewport', () => {
  const camera = practiceViewport({ width: 1300, height: 900, cardHeight: 600, horizontalGutter: 112 });
  assert.deepEqual(camera, { x: 270, y: 116, zoom: 1 });
  assert.deepEqual(worldToScreen({ x: 380, y: 34 + 300 }, camera), { x: 650, y: 450 });
});

test('practice fits narrow width with reserved navigation space and centers vertically', () => {
  const camera = practiceViewport({ width: 497, height: 900, cardHeight: 600, horizontalGutter: 112 });
  assert.equal(camera.zoom, 385 / 760);
  const cardCenter = worldToScreen({ x: 380, y: 334 }, camera);
  assert.ok(Math.abs(cardCenter.x - 248.5) < 1e-9);
  assert.ok(Math.abs(cardCenter.y - 450) < 1e-9);
  assert.ok(Math.abs(worldToScreen({ x: 0, y: 0 }, camera).x - 56) < 1e-9);
});

test('long or not-yet-measured cards keep the top margin and do not fit vertically', () => {
  assert.deepEqual(practiceViewport({ width: 1200, height: 500, cardHeight: 1200 }), { x: 220, y: 0, zoom: 1 });
  assert.equal(practiceViewport({ width: 497, height: 300, cardHeight: 2000 }).y, 0);
  assert.equal(practiceViewport({ width: 1200, height: 800, cardHeight: 0 }).y, 0);
});

test('practice scale stays within supported limits and rejects invalid layout measurements', () => {
  assert.equal(practiceViewport({ width: 0, height: 0, cardHeight: 0 }).zoom, 0.25);
  assert.equal(practiceViewport({ width: 2000, height: 800, cardHeight: 500 }).zoom, 1);
  for (const bad of [{ width: NaN }, { height: -1 }, { cardHeight: Infinity }, { worldWidth: 0 }, { horizontalGutter: -1 }]) {
    assert.throws(() => practiceViewport({ width: 1000, height: 800, cardHeight: 600, ...bad }), TypeError);
  }
});
