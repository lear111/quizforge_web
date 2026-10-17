// Toolbar docking geometry. All boxes are in pixels relative to the toolbar area.
// Like a tablet annotation toolbar it rests at one of eight fixed stops: the
// middle of each edge (open bar) or a corner (a small ball, opened on tap).
export const TOOLBAR_EDGE_MARGIN = 12;
const POPUP_GAP = 10, POPUP_MARGIN = 8, OBSTACLE_GAP = 6;
// Stops on a 3 x 3 grid without its centre: [column, row].
const ANCHORS = Object.freeze({
  'top-left': [0, 0], top: [1, 0], 'top-right': [2, 0],
  left: [0, 1], right: [2, 1],
  'bottom-left': [0, 2], bottom: [1, 2], 'bottom-right': [2, 2],
});
export const TOOLBAR_ANCHORS = Object.freeze(Object.keys(ANCHORS));
export const DEFAULT_TOOLBAR_DOCK = Object.freeze({ anchor: 'right' });

const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
export const isCornerAnchor = anchor => anchor.includes('-');

// How a stop is drawn. Corners open as a vertical bar along their left or right edge.
export function anchorLayout(anchor, open = false) {
  const [column, row] = ANCHORS[anchor];
  const corner = isCornerAnchor(anchor);
  const side = corner ? (column === 0 ? 'left' : 'right') : anchor;
  return { side, vertical: side === 'left' || side === 'right', collapsed: corner && !open, column, row };
}

export function normalizeDock(value) {
  if (value && typeof value === 'object' && Object.hasOwn(ANCHORS, value.anchor)) return { anchor: value.anchor };
  // Positions saved before the fixed stops: a collapsed tab goes to the nearer corner.
  if (value && typeof value === 'object' && ['left', 'right', 'top', 'bottom'].includes(value.side)) {
    if (value.collapsed !== true) return { anchor: value.side };
    const late = Number.isFinite(value.along) && value.along > 0.5;
    if (value.side === 'left' || value.side === 'right') return { anchor: `${late ? 'bottom' : 'top'}-${value.side}` };
    return { anchor: `${value.side}-${late ? 'right' : 'left'}` };
  }
  return { ...DEFAULT_TOOLBAR_DOCK };
}

export function anchorPoint(anchor, area) {
  const [column, row] = ANCHORS[anchor];
  return { x: column / 2 * area.width, y: row / 2 * area.height };
}

// The stop nearest a release point, measured in proportion to the pane so the
// stops act like a 3 x 3 grid on wide and tall screens alike.
export function nearestAnchor(point, area) {
  let best = null, distance = Infinity;
  for (const anchor of TOOLBAR_ANCHORS) {
    const stop = anchorPoint(anchor, area);
    const next = Math.hypot((stop.x - point.x) / (area.width || 1), (stop.y - point.y) / (area.height || 1));
    if (next < distance) { best = anchor; distance = next; }
  }
  return { anchor: best };
}

// Keyboard moves: one step on the grid, jumping over the empty centre.
export function stepAnchor(anchor, dx, dy) {
  const [column, row] = ANCHORS[anchor];
  let nextColumn = clamp(column + dx, 0, 2), nextRow = clamp(row + dy, 0, 2);
  if (nextColumn === 1 && nextRow === 1) { nextColumn = clamp(nextColumn + dx, 0, 2); nextRow = clamp(nextRow + dy, 0, 2); }
  return TOOLBAR_ANCHORS.find(name => ANCHORS[name][0] === nextColumn && ANCHORS[name][1] === nextRow) || anchor;
}

// Obstacles are host controls such as the question arrows. A bar on that edge
// moves inward past them; a corner ball or a bar opened from a corner slides away along the edge.
export function dockedPosition(dock, area, size, obstacles = [], { open = false } = {}) {
  const layout = anchorLayout(dock.anchor, open), corner = isCornerAnchor(dock.anchor), margin = TOOLBAR_EDGE_MARGIN;
  const place = (index, extent, length) => index === 0 ? margin : index === 2 ? extent - length - margin : extent / 2 - length / 2;
  const position = {
    left: clamp(place(layout.column, area.width, size.width), 0, area.width - size.width),
    top: clamp(place(layout.row, area.height, size.height), 0, area.height - size.height),
  };
  const vertical = layout.vertical;
  const [start, length, side, depth, extent] = vertical ? ['top', 'height', 'left', 'width', area.height] : ['left', 'width', 'top', 'height', area.width];
  const hits = item => item[start] < position[start] + size[length] + OBSTACLE_GAP && item[start] + item[length] > position[start] - OBSTACLE_GAP
    && item[side] < position[side] + size[depth] && item[side] + item[depth] > position[side];
  for (const item of obstacles) {
    if (!hits(item)) continue;
    if (corner) {
      const atStart = (vertical ? layout.row : layout.column) === 0;
      position[start] = atStart ? Math.min(item[start] + item[length] + OBSTACLE_GAP, extent - size[length] - margin)
        : Math.max(margin, item[start] - OBSTACLE_GAP - size[length]);
    } else if (layout.side === 'right' || layout.side === 'bottom') position[side] = Math.max(0, item[side] - OBSTACLE_GAP - size[depth]);
    else position[side] = item[side] + item[depth] + OBSTACLE_GAP;
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
  if (Math.hypot(velocity.x, velocity.y) < TOOLBAR_FLING_SPEED) return nearestAnchor(point, area);
  return nearestAnchor({
    x: clamp(point.x + velocity.x * FLING_PROJECTION_MS, 0, area.width),
    y: clamp(point.y + velocity.y * FLING_PROJECTION_MS, 0, area.height),
  }, area);
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

// The bar shrinks into the drag ball over this long (transform only).
export const TOOLBAR_SHRINK_MS = 240;
