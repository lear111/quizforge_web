// Toolbar docking geometry. All boxes are in pixels relative to the toolbar area.
export const TOOLBAR_EDGE_MARGIN = 12;
// Releasing the toolbar with the pointer this close to an edge tucks it away as a tab.
export const TOOLBAR_COLLAPSE_DISTANCE = 24;
const POPUP_GAP = 10, POPUP_MARGIN = 8, OBSTACLE_GAP = 6;
const SIDES = ['left', 'right', 'top', 'bottom'];
export const DEFAULT_TOOLBAR_DOCK = Object.freeze({ side: 'right', along: 0.5, collapsed: false });

const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));

export function normalizeDock(value) {
  if (!value || typeof value !== 'object' || !SIDES.includes(value.side)) return { ...DEFAULT_TOOLBAR_DOCK };
  const along = Number.isFinite(value.along) ? clamp(value.along, 0, 1) : DEFAULT_TOOLBAR_DOCK.along;
  return { side: value.side, along, collapsed: value.collapsed === true };
}

// Snap a dropped toolbar to the edge nearest the release point, keeping its place along that edge.
export function dockFromPoint(point, area) {
  const distances = { left: point.x, right: area.width - point.x, top: point.y, bottom: area.height - point.y };
  const side = SIDES.reduce((best, next) => distances[next] < distances[best] ? next : best);
  const vertical = side === 'left' || side === 'right';
  const along = vertical ? point.y / (area.height || 1) : point.x / (area.width || 1);
  return normalizeDock({ side, along, collapsed: distances[side] <= TOOLBAR_COLLAPSE_DISTANCE });
}

// Obstacles are host controls on the same edge, such as the question arrows. An
// expanded toolbar moves inward past them; a collapsed tab slides along the edge.
export function dockedPosition(dock, area, size, obstacles = []) {
  const margin = dock.collapsed ? 0 : TOOLBAR_EDGE_MARGIN, vertical = dock.side === 'left' || dock.side === 'right';
  const position = vertical ? {
    left: dock.side === 'left' ? margin : Math.max(0, area.width - size.width - margin),
    top: clamp(dock.along * area.height - size.height / 2, TOOLBAR_EDGE_MARGIN, area.height - size.height - TOOLBAR_EDGE_MARGIN),
  } : {
    left: clamp(dock.along * area.width - size.width / 2, TOOLBAR_EDGE_MARGIN, area.width - size.width - TOOLBAR_EDGE_MARGIN),
    top: dock.side === 'top' ? margin : Math.max(0, area.height - size.height - margin),
  };
  const [start, length, across, depth, extent] = vertical ? ['top', 'height', 'left', 'width', area.height] : ['left', 'width', 'top', 'height', area.width];
  const hits = item => item[start] < position[start] + size[length] + OBSTACLE_GAP && item[start] + item[length] > position[start] - OBSTACLE_GAP
    && item[across] < position[across] + size[depth] && item[across] + item[depth] > position[across];
  for (const item of obstacles) {
    if (!hits(item)) continue;
    if (dock.collapsed) {
      const before = item[start] - OBSTACLE_GAP - size[length], after = item[start] + item[length] + OBSTACLE_GAP;
      position[start] = before >= TOOLBAR_EDGE_MARGIN ? before : Math.min(after, extent - size[length] - TOOLBAR_EDGE_MARGIN);
    } else if (dock.side === 'right' || dock.side === 'bottom') position[across] = Math.max(0, item[across] - OBSTACLE_GAP - size[depth]);
    else position[across] = item[across] + item[depth] + OBSTACLE_GAP;
  }
  return position;
}

// Open a popup beside its button, on the side of the toolbar that faces the page.
export function popupPosition(side, area, toolbar, anchor, size) {
  let left, top;
  if (side === 'left' || side === 'right') {
    left = side === 'right' ? toolbar.left - POPUP_GAP - size.width : toolbar.left + toolbar.width + POPUP_GAP;
    top = anchor.top + anchor.height / 2 - size.height / 2;
  } else {
    top = side === 'bottom' ? toolbar.top - POPUP_GAP - size.height : toolbar.top + toolbar.height + POPUP_GAP;
    left = anchor.left + anchor.width / 2 - size.width / 2;
  }
  return {
    left: clamp(left, POPUP_MARGIN, area.width - size.width - POPUP_MARGIN),
    top: clamp(top, POPUP_MARGIN, area.height - size.height - POPUP_MARGIN),
  };
}
