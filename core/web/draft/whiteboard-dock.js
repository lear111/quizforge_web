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

// A press becomes a drag only after this much movement, so taps stay taps.
export const TOOLBAR_DRAG_THRESHOLD = 6;
export const isToolbarDrag = (dx, dy) => Math.hypot(dx, dy) >= TOOLBAR_DRAG_THRESHOLD;

// Pointer velocity in px/ms from the samples of the last `window` ms ({x,y,t}, oldest first).
export function releaseVelocity(samples, window = 100) {
  if (samples.length < 2) return { x: 0, y: 0 };
  const last = samples[samples.length - 1];
  let first = last;
  for (let index = samples.length - 1; index >= 0 && last.t - samples[index].t <= window; index--) first = samples[index];
  const elapsed = last.t - first.t;
  return elapsed > 0 ? { x: (last.x - first.x) / elapsed, y: (last.y - first.y) / elapsed } : { x: 0, y: 0 };
}

// A fling is judged by where it would coast to, so the toolbar goes the way it was thrown.
export const TOOLBAR_FLING_SPEED = 0.5;
const FLING_PROJECTION_MS = 250;
export function releaseDock(point, velocity, area) {
  if (Math.hypot(velocity.x, velocity.y) < TOOLBAR_FLING_SPEED) return dockFromPoint(point, area);
  const projected = {
    x: clamp(point.x + velocity.x * FLING_PROJECTION_MS, 0, area.width),
    y: clamp(point.y + velocity.y * FLING_PROJECTION_MS, 0, area.height),
  };
  // Throwing never tucks the toolbar away; that needs a deliberate drop at the edge.
  return { ...dockFromPoint(projected, area), collapsed: false };
}

// One damped spring channel moving towards 0; slightly under-damped for a small overshoot.
export const TOOLBAR_SPRING = Object.freeze({ stiffness: 380, damping: 26 });
export function springStep(state, elapsedMs, { stiffness, damping } = TOOLBAR_SPRING) {
  let { value, velocity } = state;
  for (let left = Math.min(elapsedMs, 64); left > 0; left -= 8) {
    const step = Math.min(8, left) / 1000;
    velocity += (-stiffness * value - damping * velocity) * step;
    value += velocity * step;
  }
  return { value, velocity };
}
export const springSettled = (state, precision = 0.3) => Math.abs(state.value) < precision && Math.abs(state.velocity) < precision * 20;
