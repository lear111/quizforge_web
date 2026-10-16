import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOLBAR_DOCK, TOOLBAR_DRAG_THRESHOLD, TOOLBAR_EDGE_MARGIN, dockFromPoint, dockedPosition, isToolbarDrag, normalizeDock, popupPosition, releaseDock, releaseVelocity, springSettled, springStep } from '../../web/draft/whiteboard-dock.js';

const area = { width: 1000, height: 700 };

test('a dropped toolbar snaps to the edge nearest the release point and keeps its place along it', () => {
  assert.deepEqual(dockFromPoint({ x: 420, y: 100 }, area), { side: 'top', along: 0.42, collapsed: false });
  assert.deepEqual(dockFromPoint({ x: 900, y: 300 }, area), { side: 'right', along: 300 / 700, collapsed: false });
  assert.deepEqual(dockFromPoint({ x: 60, y: 520 }, area), { side: 'left', along: 520 / 700, collapsed: false });
  assert.deepEqual(dockFromPoint({ x: 500, y: 600 }, area), { side: 'bottom', along: 0.5, collapsed: false });
});

test('releasing the toolbar at an edge collapses it there', () => {
  assert.deepEqual(dockFromPoint({ x: 990, y: 350 }, area), { side: 'right', along: 0.5, collapsed: true });
  assert.equal(dockFromPoint({ x: 3, y: 200 }, area).collapsed, true);
  assert.equal(dockFromPoint({ x: 40, y: 200 }, area).collapsed, false);
});

test('docked toolbars rest against their edge and stay inside the pane', () => {
  const size = { width: 46, height: 400 };
  assert.deepEqual(dockedPosition({ side: 'right', along: 0.5, collapsed: false }, area, size), { left: 1000 - 46 - TOOLBAR_EDGE_MARGIN, top: 150 });
  assert.deepEqual(dockedPosition({ side: 'right', along: 0.5, collapsed: true }, area, { width: 44, height: 44 }), { left: 956, top: 328 });
  assert.deepEqual(dockedPosition({ side: 'left', along: 0, collapsed: false }, area, size), { left: TOOLBAR_EDGE_MARGIN, top: TOOLBAR_EDGE_MARGIN });
  assert.deepEqual(dockedPosition({ side: 'bottom', along: 1, collapsed: false }, area, { width: 400, height: 46 }), { left: 1000 - 400 - TOOLBAR_EDGE_MARGIN, top: 700 - 46 - TOOLBAR_EDGE_MARGIN });
  assert.deepEqual(dockedPosition({ side: 'right', along: 0.5, collapsed: false }, { width: 300, height: 200 }, size).top, TOOLBAR_EDGE_MARGIN, 'a tall toolbar starts at the top and scrolls');
});

test('popups open towards the page beside their button and remain visible', () => {
  const toolbar = { left: 942, top: 150, width: 46, height: 400 }, anchor = { left: 948, top: 200, width: 34, height: 34 };
  assert.deepEqual(popupPosition('right', area, toolbar, anchor, { width: 130, height: 90 }), { left: 802, top: 172 });
  assert.deepEqual(popupPosition('left', area, { ...toolbar, left: 12 }, { ...anchor, left: 18 }, { width: 130, height: 90 }), { left: 68, top: 172 });
  assert.deepEqual(popupPosition('top', area, { left: 300, top: 12, width: 400, height: 46 }, { left: 320, top: 18, width: 34, height: 34 }, { width: 260, height: 900 }), { left: 207, top: 8 });
  assert.deepEqual(popupPosition('bottom', area, { left: 300, top: 642, width: 400, height: 46 }, { left: 320, top: 648, width: 34, height: 34 }, { width: 130, height: 90 }), { left: 272, top: 542 });
});

test('stored toolbar positions are validated', () => {
  for (const value of [null, 'right', {}, { side: 'middle', along: 0.5 }]) assert.deepEqual(normalizeDock(value), DEFAULT_TOOLBAR_DOCK);
  assert.deepEqual(normalizeDock({ side: 'top', along: 3, collapsed: 'yes' }), { side: 'top', along: 1, collapsed: false });
  assert.deepEqual(normalizeDock({ side: 'left', along: NaN, collapsed: true }), { side: 'left', along: 0.5, collapsed: true });
});

test('docked toolbars keep clear of host controls on the same edge', () => {
  const arrow = { left: 946, top: 324, width: 44, height: 52 }, size = { width: 46, height: 400 };
  assert.deepEqual(dockedPosition({ side: 'right', along: 0.5, collapsed: false }, area, size, [arrow]), { left: 946 - 6 - 46, top: 150 });
  assert.deepEqual(dockedPosition({ side: 'right', along: 0.5, collapsed: true }, area, { width: 44, height: 44 }, [arrow]), { left: 956, top: 324 - 6 - 44 });
  assert.deepEqual(dockedPosition({ side: 'right', along: 0, collapsed: true }, area, { width: 44, height: 44 }, [{ ...arrow, top: 12 }]), { left: 956, top: 70 });
  assert.deepEqual(dockedPosition({ side: 'left', along: 0.5, collapsed: false }, area, size, [arrow]), { left: TOOLBAR_EDGE_MARGIN, top: 150 }, 'controls on the other edge are ignored');
});

test('small movements stay taps and only a real move starts a drag', () => {
  assert.equal(isToolbarDrag(3, 4), false);
  assert.equal(isToolbarDrag(0, TOOLBAR_DRAG_THRESHOLD), true);
});

test('release velocity uses only the most recent pointer samples', () => {
  assert.deepEqual(releaseVelocity([]), { x: 0, y: 0 });
  assert.deepEqual(releaseVelocity([{ x: 0, y: 0, t: 0 }, { x: 500, y: 0, t: 400 }, { x: 520, y: 10, t: 450 }, { x: 600, y: 50, t: 490 }]), { x: 100 / 90, y: 50 / 90 });
  assert.deepEqual(releaseVelocity([{ x: 10, y: 10, t: 5 }, { x: 10, y: 10, t: 5 }]), { x: 0, y: 0 });
});

test('a fling docks where the throw is heading, while a slow drop uses the release point', () => {
  const centre = { x: 500, y: 350 };
  assert.equal(releaseDock({ x: 300, y: 350 }, { x: 0.1, y: 0 }, area).side, 'left', 'slow drops use the nearest edge');
  assert.deepEqual(releaseDock(centre, { x: 3, y: 0 }, area), { side: 'right', along: 0.5, collapsed: false });
  assert.deepEqual(releaseDock(centre, { x: 0, y: -2 }, area), { side: 'top', along: 0.5, collapsed: false });
  assert.equal(releaseDock({ x: 995, y: 350 }, { x: 2, y: 0 }, area).collapsed, false, 'throwing never collapses');
  assert.equal(releaseDock({ x: 995, y: 350 }, { x: 0, y: 0 }, area).collapsed, true);
});

test('the spring overshoots slightly and settles at its target', () => {
  let state = { value: 100, velocity: 0 }, lowest = 100, frames = 0;
  while (!springSettled(state) && frames < 200) { state = springStep(state, 16); lowest = Math.min(lowest, state.value); frames++; }
  assert.ok(frames < 60, `settles within a second (${frames} frames)`);
  assert.ok(lowest < 0 && lowest > -15, `small overshoot (${lowest})`);
  assert.deepEqual(springStep({ value: 0, velocity: 0 }, 16), { value: 0, velocity: 0 });
});
