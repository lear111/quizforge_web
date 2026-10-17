import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOLBAR_DOCK, TOOLBAR_ANCHORS, TOOLBAR_DRAG_THRESHOLD, TOOLBAR_EDGE_MARGIN, anchorLayout, dockedPosition, isToolbarDrag, nearestAnchor, normalizeDock, popupPosition, releaseDock, releaseVelocity, springSettled, springStep, stepAnchor } from '../../web/draft/whiteboard-dock.js';

const area = { width: 1000, height: 700 };
const bar = { width: 46, height: 400 }, ball = { width: 44, height: 44 };

test('a released toolbar snaps to the nearest of eight fixed stops', () => {
  assert.equal(TOOLBAR_ANCHORS.length, 8);
  assert.deepEqual(nearestAnchor({ x: 950, y: 330 }, area), { anchor: 'right' });
  assert.deepEqual(nearestAnchor({ x: 520, y: 40 }, area), { anchor: 'top' });
  assert.deepEqual(nearestAnchor({ x: 60, y: 620 }, area), { anchor: 'bottom-left' });
  assert.deepEqual(nearestAnchor({ x: 880, y: 110 }, area), { anchor: 'top-right' }, 'near a corner, even slightly off, lands in the corner');
  assert.deepEqual(nearestAnchor({ x: 420, y: 330 }, area), { anchor: 'left' });
});

test('edge stops are open bars and corner stops are balls that open along their side', () => {
  assert.deepEqual(anchorLayout('right'), { side: 'right', vertical: true, collapsed: false, column: 2, row: 1 });
  assert.deepEqual(anchorLayout('bottom'), { side: 'bottom', vertical: false, collapsed: false, column: 1, row: 2 });
  assert.equal(anchorLayout('top-left').collapsed, true);
  assert.deepEqual(anchorLayout('top-left', true), { side: 'left', vertical: true, collapsed: false, column: 0, row: 0 });
  assert.equal(anchorLayout('bottom-right', true).side, 'right');
});

test('each stop has one fixed position', () => {
  const m = TOOLBAR_EDGE_MARGIN;
  assert.deepEqual(dockedPosition({ anchor: 'right' }, area, bar), { left: 1000 - 46 - m, top: 150 });
  assert.deepEqual(dockedPosition({ anchor: 'top' }, area, { width: 400, height: 46 }), { left: 300, top: m });
  assert.deepEqual(dockedPosition({ anchor: 'top-left' }, area, ball), { left: m, top: m });
  assert.deepEqual(dockedPosition({ anchor: 'bottom-right' }, area, ball), { left: 1000 - 44 - m, top: 700 - 44 - m });
  assert.deepEqual(dockedPosition({ anchor: 'bottom-right' }, area, bar, [], { open: true }), { left: 1000 - 46 - m, top: 700 - 400 - m }, 'an opened corner grows away from its corner');
  assert.deepEqual(dockedPosition({ anchor: 'right' }, { width: 300, height: 200 }, bar).top, 0, 'a bar taller than the pane starts at the top and scrolls');
});

test('docked toolbars keep clear of host controls', () => {
  const arrow = { left: 946, top: 324, width: 44, height: 52 };
  assert.deepEqual(dockedPosition({ anchor: 'right' }, area, bar, [arrow]), { left: 946 - 6 - 46, top: 150 });
  assert.deepEqual(dockedPosition({ anchor: 'left' }, area, bar, [arrow]), { left: TOOLBAR_EDGE_MARGIN, top: 150 }, 'controls elsewhere are ignored');
  const corner = { left: 946, top: 640, width: 44, height: 52 };
  assert.deepEqual(dockedPosition({ anchor: 'bottom-right' }, area, ball, [corner]), { left: 944, top: 640 - 6 - 44 }, 'a corner ball slides along its edge');
});

test('popups open towards the page beside their button and remain visible', () => {
  const toolbar = { left: 942, top: 150, width: 46, height: 400 }, anchor = { left: 948, top: 200, width: 34, height: 34 };
  assert.deepEqual(popupPosition('right', area, toolbar, anchor, { width: 130, height: 90 }), { left: 802, top: 172 });
  assert.deepEqual(popupPosition('left', area, { ...toolbar, left: 12 }, { ...anchor, left: 18 }, { width: 130, height: 90 }), { left: 68, top: 172 });
  assert.deepEqual(popupPosition('top', area, { left: 300, top: 12, width: 400, height: 46 }, { left: 320, top: 18, width: 34, height: 34 }, { width: 260, height: 900 }), { left: 207, top: 8 });
  assert.deepEqual(popupPosition('bottom', area, { left: 300, top: 642, width: 400, height: 46 }, { left: 320, top: 648, width: 34, height: 34 }, { width: 130, height: 90 }), { left: 272, top: 542 });
});

test('stored toolbar positions are validated and older ones mapped to a stop', () => {
  for (const value of [null, 'right', {}, { anchor: 'middle' }, { side: 'middle', along: 0.5 }]) assert.deepEqual(normalizeDock(value), DEFAULT_TOOLBAR_DOCK);
  assert.deepEqual(normalizeDock({ anchor: 'top-left' }), { anchor: 'top-left' });
  assert.deepEqual(normalizeDock({ side: 'top', along: 0.3, collapsed: false }), { anchor: 'top' });
  assert.deepEqual(normalizeDock({ side: 'right', along: 0.8, collapsed: true }), { anchor: 'bottom-right' });
  assert.deepEqual(normalizeDock({ side: 'bottom', along: 0.2, collapsed: true }), { anchor: 'bottom-left' });
});

test('keyboard steps move between neighbouring stops and skip the empty centre', () => {
  assert.equal(stepAnchor('right', 0, -1), 'top-right');
  assert.equal(stepAnchor('top-right', -1, 0), 'top');
  assert.equal(stepAnchor('left', 1, 0), 'right');
  assert.equal(stepAnchor('top-left', -1, 0), 'top-left', 'edges of the grid stay put');
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

test('a fling goes to the stop the throw is heading for, while a slow drop uses the nearest stop', () => {
  const centre = { x: 500, y: 350 };
  assert.deepEqual(releaseDock({ x: 300, y: 350 }, { x: 0.1, y: 0 }, area), { anchor: 'left' }, 'slow drops use the nearest stop');
  assert.deepEqual(releaseDock(centre, { x: 3, y: 0 }, area), { anchor: 'right' });
  assert.deepEqual(releaseDock(centre, { x: 0, y: -2 }, area), { anchor: 'top' });
  assert.deepEqual(releaseDock(centre, { x: 2, y: 1.4 }, area), { anchor: 'bottom-right' }, 'a diagonal throw reaches a corner');
});

test('the spring overshoots slightly and settles at its target', () => {
  let state = { value: 100, velocity: 0 }, lowest = 100, frames = 0;
  while (!springSettled(state) && frames < 200) { state = springStep(state, 16); lowest = Math.min(lowest, state.value); frames++; }
  assert.ok(frames < 60, `settles within a second (${frames} frames)`);
  assert.ok(lowest < 0 && lowest > -15, `small overshoot (${lowest})`);
  assert.deepEqual(springStep({ value: 0, velocity: 0 }, 16), { value: 0, velocity: 0 });
});
