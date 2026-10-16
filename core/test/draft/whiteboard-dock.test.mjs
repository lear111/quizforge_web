import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOOLBAR_DOCK, TOOLBAR_EDGE_MARGIN, dockFromPoint, dockedPosition, normalizeDock, popupPosition } from '../../web/draft/whiteboard-dock.js';

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
