import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WhiteboardModel, DRAFT_LIMITS, emptyDraft, normalizeDraft,
  worldToScreen, screenToWorld, zoomAt, translateCamera, strokeTouchesPath,
} from '../web/whiteboard-model.js';

const point = (x, y, pressure = 0.5) => ({ x, y, pressure });
const stroke = (id, points, width = 4) => ({ id, points, width, color: '#334155' });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} differs from ${expected}`);

test('JSON round trip preserves world ink, pressure, camera and paper without exposing live state', () => {
  const draft = {
    schemaVersion: 1,
    viewport: { x: -43.25, y: 105.5, zoom: 1.7 },
    paper: { color: '#fff4d6', pattern: 'dots' },
    strokes: [stroke('s1', [point(-12.5, 29, 0.2), point(42, 68, 0.9)], 7.5)],
  };
  const model = new WhiteboardModel(JSON.parse(JSON.stringify(draft)));
  assert.deepEqual(model.getDraft(), draft);
  draft.strokes[0].points[0].x = 900;
  const exported = model.getDraft();
  exported.strokes[0].points[0].x = 800;
  exported.viewport.zoom = 4;
  assert.equal(model.getDraft().strokes[0].points[0].x, -12.5);
  assert.equal(model.viewport.zoom, 1.7);
});

test('camera transforms invert and anchored zoom keeps the same world point under the pointer', () => {
  const camera = { x: -123, y: 84.5, zoom: 0.65 }, world = { x: 290.5, y: -80 };
  const screen = worldToScreen(world, camera);
  const recovered = screenToWorld(screen, camera);
  near(recovered.x, world.x); near(recovered.y, world.y);
  const zoomed = zoomAt(camera, 2.4, screen);
  const after = worldToScreen(world, zoomed);
  near(after.x, screen.x); near(after.y, screen.y);
  const moved = translateCamera(zoomed, 30, -25);
  const movedScreen = worldToScreen(world, moved);
  near(movedScreen.x, screen.x + 30); near(movedScreen.y, screen.y - 25);
  assert.equal(zoomAt(camera, 100, screen).zoom, DRAFT_LIMITS.maxZoom);
  assert.equal(zoomAt(camera, 0.01, screen).zoom, DRAFT_LIMITS.minZoom);
});

test('camera and paper changes leave stroke geometry intact through undo and redo', () => {
  const model = new WhiteboardModel();
  model.appendStroke(stroke('a', [point(10, 20), point(30, 50)]));
  const originalInk = model.getDraft().strokes;
  model.setViewport({ x: -150, y: 200, zoom: 3 });
  model.setPaper({ color: '#e5efff', pattern: 'grid' });
  assert.deepEqual(model.getDraft().strokes, originalInk);
  assert.equal(model.undo(), true);
  assert.equal(model.getDraft().strokes.length, 0);
  assert.deepEqual(model.viewport, { x: -150, y: 200, zoom: 3 });
  assert.deepEqual(model.paper, { color: '#e5efff', pattern: 'grid' });
  assert.equal(model.redo(), true);
  assert.deepEqual(model.getDraft().strokes, originalInk);
});

test('undo redo groups each stroke, eraser sweep and clear and discards abandoned redo', () => {
  const model = new WhiteboardModel();
  model.appendStroke(stroke('left', [point(0, 0), point(0, 20)]));
  model.appendStroke(stroke('right', [point(40, 0), point(40, 20)]));
  assert.equal(model.eraseAlong([point(-10, 10), point(10, 10)], 1), true);
  assert.deepEqual(model.getDraft().strokes.map(item => item.id), ['right']);
  model.undo();
  assert.deepEqual(model.getDraft().strokes.map(item => item.id), ['left', 'right']);
  model.redo();
  assert.deepEqual(model.getDraft().strokes.map(item => item.id), ['right']);
  model.clear();
  assert.equal(model.getDraft().strokes.length, 0);
  model.undo();
  assert.deepEqual(model.getDraft().strokes.map(item => item.id), ['right']);
  model.appendStroke(stroke('new', [point(75, 20)]));
  assert.equal(model.canRedo, false);
  assert.equal(model.redo(), false);
});

test('loading another question resets undo and redo and default draft has no prior geometry', () => {
  const model = new WhiteboardModel();
  model.appendStroke(stroke('old', [point(1, 2)]));
  model.undo();
  const next = emptyDraft();
  next.strokes.push(stroke('next', [point(7, 8)]));
  model.load(next);
  assert.equal(model.canUndo, false);
  assert.equal(model.canRedo, false);
  assert.equal(model.undo(), false);
  assert.deepEqual(model.getDraft(), next);
  model.load(null);
  assert.deepEqual(model.getDraft(), emptyDraft());
});

test('eraser sweep hits crossed segments between samples and respects thickness and dots', () => {
  const line = stroke('long', [point(0, 0), point(100, 0)], 4);
  assert.equal(strokeTouchesPath(line, [point(50, -20), point(50, 20)], 1), true);
  assert.equal(strokeTouchesPath(line, [point(20, 2.9), point(80, 2.9)], 1), true);
  assert.equal(strokeTouchesPath(line, [point(20, 3.1), point(80, 3.1)], 1), false);
  assert.equal(strokeTouchesPath(line, [point(130, 0)], 1), false);
  const dot = stroke('dot', [point(5, 5)], 8);
  assert.equal(strokeTouchesPath(dot, [point(11, 5)], 2), true);
  assert.equal(strokeTouchesPath(dot, [point(11.1, 5)], 2), false);
  assert.equal(strokeTouchesPath(line, [], 10), false);
});

test('no-op eraser and clear do not consume undo or wipe redo history', () => {
  const model = new WhiteboardModel();
  assert.equal(model.clear(), false);
  model.appendStroke(stroke('keep', [point(10, 10)]));
  model.undo();
  assert.equal(model.eraseAlong([point(100, 100)], 2), false);
  assert.equal(model.clear(), false);
  assert.equal(model.canRedo, true);
  model.redo();
  assert.equal(model.getDraft().strokes[0].id, 'keep');
});

test('draft boundary rejects unsupported schema, unsafe colors, nonfinite and oversized geometry', () => {
  const invalid = [
    { ...emptyDraft(), schemaVersion: 2 },
    { ...emptyDraft(), viewport: { x: Infinity, y: 0, zoom: 1 } },
    { ...emptyDraft(), viewport: { x: 0, y: 0, zoom: 0 } },
    { ...emptyDraft(), viewport: { x: DRAFT_LIMITS.coordinate + 1, y: 0, zoom: 1 } },
    { ...emptyDraft(), paper: { color: 'url(secret)', pattern: 'plain' } },
    { ...emptyDraft(), paper: { color: '#ffffff\n', pattern: 'plain' } },
    { ...emptyDraft(), paper: { color: '#ffffff', pattern: 'unknown' } },
    { ...emptyDraft(), strokes: [stroke('a', [point(NaN, 0)])] },
    { ...emptyDraft(), strokes: [stroke('a', [point(0, 0, 2)])] },
    { ...emptyDraft(), strokes: [stroke('a', [], 4)] },
    { ...emptyDraft(), strokes: [stroke('a', [point(0, 0)], 100)] },
    { ...emptyDraft(), strokes: [stroke('same', [point(0, 0)]), stroke('same', [point(1, 1)])] },
    { ...emptyDraft(), strokes: [stroke('../bad id', [point(0, 0)])] },
    { ...emptyDraft(), strokes: [stroke('newline\n', [point(0, 0)])] },
    { ...emptyDraft(), strokes: [stroke('huge', Array.from({ length: DRAFT_LIMITS.maxPointsPerStroke + 1 }, () => point(0, 0)))] },
    { ...emptyDraft(), strokes: Array.from({ length: DRAFT_LIMITS.maxStrokes + 1 }, (_, i) => stroke(`s${i}`, [point(0, 0)])) },
  ];
  for (const draft of invalid) assert.throws(() => normalizeDraft(draft), TypeError);
  const missingPressure = emptyDraft();
  missingPressure.strokes.push(stroke('legacy', [{ x: 1, y: 2 }]));
  assert.equal(normalizeDraft(missingPressure).strokes[0].points[0].pressure, 0.5);
});

test('failed append or malformed load preserves the current drawing and its undo history', () => {
  const model = new WhiteboardModel();
  model.appendStroke(stroke('safe', [point(4, 8)]));
  const before = model.getDraft();
  assert.throws(() => model.appendStroke(stroke('safe', [point(10, 10)])), TypeError);
  assert.throws(() => model.load({ ...emptyDraft(), viewport: { x: 0, y: 0, zoom: NaN } }), TypeError);
  assert.deepEqual(model.getDraft(), before);
  assert.equal(model.canUndo, true);
});

test('draft limits bound total samples and serialized size even when each individual stroke fits', () => {
  const tooMany = emptyDraft();
  tooMany.strokes = Array.from({ length: 11 }, (_, index) => stroke(`many-${index}`, Array.from({ length: 10_000 }, () => point(0, 0))));
  assert.throws(() => normalizeDraft(tooMany), /too many points/);
  const tooLarge = emptyDraft();
  tooLarge.strokes = Array.from({ length: 10 }, (_, index) => stroke(`large-${index}`, Array.from({ length: 10_000 }, () =>
    point(-0.0000012345678901234567, -0.0000012345678901234567, 0.9999999999999999))));
  assert.ok(JSON.stringify(tooLarge).length > DRAFT_LIMITS.maxBytes);
  assert.throws(() => normalizeDraft(tooLarge), /size limit/);
});
