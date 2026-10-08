// Geometry is stored in world coordinates. The camera never rewrites ink.
export const DRAFT_LIMITS = Object.freeze({
  coordinate: 1_000_000, minZoom: 0.25, maxZoom: 4,
  minWidth: 0.5, maxWidth: 32, maxStrokes: 2_000,
  maxPointsPerStroke: 10_000, maxPoints: 100_000, maxBytes: 8 * 1024 * 1024, history: 60,
});

const COLOR = /^#[0-9a-f]{6}$/i;
const STROKE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const PATTERNS = new Set(['plain', 'grid', 'dots']);
const validColor = value => typeof value === 'string' && value.length === 7 && COLOR.test(value);
const clone = value => JSON.parse(JSON.stringify(value));
const finite = (value, min, max, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
};

export function emptyDraft() {
  return { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, strokes: [], paper: { color: '#ffffff', pattern: 'plain' } };
}

export function normalizeViewport(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Missing whiteboard viewport');
  return {
    x: finite(value.x, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'viewport.x'),
    y: finite(value.y, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'viewport.y'),
    zoom: finite(value.zoom, DRAFT_LIMITS.minZoom, DRAFT_LIMITS.maxZoom, 'viewport.zoom'),
  };
}

export function normalizePaper(value) {
  if (!value || !validColor(value.color) || !PATTERNS.has(value.pattern)) throw new TypeError('Invalid whiteboard paper');
  return { color: value.color.toLowerCase(), pattern: value.pattern };
}

export function normalizeStroke(value) {
  if (!value || typeof value.id !== 'string' || value.id !== value.id.trim() || !STROKE_ID.test(value.id) || !validColor(value.color)) {
    throw new TypeError('Invalid whiteboard stroke');
  }
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > DRAFT_LIMITS.maxPointsPerStroke) {
    throw new TypeError('Invalid whiteboard stroke points');
  }
  return {
    id: value.id, color: value.color.toLowerCase(),
    width: finite(value.width, DRAFT_LIMITS.minWidth, DRAFT_LIMITS.maxWidth, 'stroke.width'),
    points: value.points.map(point => ({
      x: finite(point?.x, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'point.x'),
      y: finite(point?.y, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'point.y'),
      pressure: finite(point?.pressure ?? 0.5, 0, 1, 'point.pressure'),
    })),
  };
}

export function normalizeDraft(value) {
  if (value == null) return emptyDraft();
  if (value.schemaVersion !== 1 || !Array.isArray(value.strokes) || value.strokes.length > DRAFT_LIMITS.maxStrokes) {
    throw new TypeError('Invalid whiteboard draft');
  }
  const strokes = value.strokes.map(normalizeStroke);
  if (strokes.reduce((count, stroke) => count + stroke.points.length, 0) > DRAFT_LIMITS.maxPoints) {
    throw new TypeError('Whiteboard contains too many points');
  }
  if (new Set(strokes.map(stroke => stroke.id)).size !== strokes.length) throw new TypeError('Duplicate whiteboard stroke IDs');
  const normalized = { schemaVersion: 1, viewport: normalizeViewport(value.viewport), strokes, paper: normalizePaper(value.paper) };
  // All persisted keys, IDs and colors are ASCII, so JSON length equals UTF-8 bytes.
  if (JSON.stringify(normalized).length > DRAFT_LIMITS.maxBytes) throw new TypeError('Whiteboard draft exceeds the size limit');
  return normalized;
}

export function worldToScreen(point, camera) {
  return { x: (point.x + camera.x) * camera.zoom, y: (point.y + camera.y) * camera.zoom };
}

export function screenToWorld(point, camera) {
  return { x: point.x / camera.zoom - camera.x, y: point.y / camera.zoom - camera.y };
}

export function zoomAt(camera, zoom, anchor) {
  const nextZoom = Math.max(DRAFT_LIMITS.minZoom, Math.min(DRAFT_LIMITS.maxZoom, zoom));
  const world = screenToWorld(anchor, camera);
  const bound = value => Math.max(-DRAFT_LIMITS.coordinate, Math.min(DRAFT_LIMITS.coordinate, value));
  return { x: bound(anchor.x / nextZoom - world.x), y: bound(anchor.y / nextZoom - world.y), zoom: nextZoom };
}

export function translateCamera(camera, dx, dy) {
  const bound = value => Math.max(-DRAFT_LIMITS.coordinate, Math.min(DRAFT_LIMITS.coordinate, value));
  return { x: bound(camera.x + dx / camera.zoom), y: bound(camera.y + dy / camera.zoom), zoom: camera.zoom };
}

function distanceSquaredToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared)) : 0;
  return (point.x - from.x - t * dx) ** 2 + (point.y - from.y - t * dy) ** 2;
}

function orientation(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
function segmentsDistanceSquared(a, b, c, d) {
  const abC = orientation(a, b, c), abD = orientation(a, b, d);
  const cdA = orientation(c, d, a), cdB = orientation(c, d, b);
  // Strict crossing; touching and collinear segments are covered by endpoint distances.
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(distanceSquaredToSegment(a, c, d), distanceSquaredToSegment(b, c, d),
    distanceSquaredToSegment(c, a, b), distanceSquaredToSegment(d, a, b));
}

export function strokeTouchesPath(stroke, path, radius) {
  if (!path.length) return false;
  const hitRadius = radius + stroke.width / 2;
  const hitRadiusSquared = hitRadius ** 2;
  for (let i = 0; i < Math.max(1, stroke.points.length - 1); i++) {
    const a = stroke.points[i], b = stroke.points[Math.min(i + 1, stroke.points.length - 1)];
    for (let j = 0; j < Math.max(1, path.length - 1); j++) {
      const c = path[j], d = path[Math.min(j + 1, path.length - 1)];
      if (Math.max(a.x, b.x) + hitRadius < Math.min(c.x, d.x) || Math.min(a.x, b.x) - hitRadius > Math.max(c.x, d.x) ||
          Math.max(a.y, b.y) + hitRadius < Math.min(c.y, d.y) || Math.min(a.y, b.y) - hitRadius > Math.max(c.y, d.y)) continue;
      if (segmentsDistanceSquared(a, b, c, d) <= hitRadiusSquared) return true;
    }
  }
  return false;
}

export class WhiteboardModel {
  constructor(draft = null) { this.load(draft); }

  load(draft) {
    this.draft = normalizeDraft(draft);
    this.undoStack = [];
    this.redoStack = [];
  }

  getDraft() { return clone(this.draft); }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get strokes() { return this.draft.strokes; }
  get viewport() { return { ...this.draft.viewport }; }
  get paper() { return { ...this.draft.paper }; }

  replaceStrokes(strokes) {
    if (strokes === this.draft.strokes) return false;
    this.undoStack.push({ before: this.draft.strokes, after: strokes });
    if (this.undoStack.length > DRAFT_LIMITS.history) this.undoStack.shift();
    this.redoStack = [];
    this.draft.strokes = strokes;
    return true;
  }

  appendStroke(value) {
    const stroke = normalizeStroke(value);
    if (this.draft.strokes.length >= DRAFT_LIMITS.maxStrokes ||
        this.draft.strokes.reduce((count, item) => count + item.points.length, 0) + stroke.points.length > DRAFT_LIMITS.maxPoints) {
      throw new RangeError('Whiteboard ink limit reached; erase or clear some strokes');
    }
    if (this.draft.strokes.some(item => item.id === stroke.id)) throw new TypeError('Duplicate whiteboard stroke ID');
    const strokes = [...this.draft.strokes, stroke];
    if (JSON.stringify({ ...this.draft, strokes }).length > DRAFT_LIMITS.maxBytes) throw new RangeError('Whiteboard draft exceeds the size limit');
    return this.replaceStrokes(strokes);
  }

  eraseAlong(points, radius) {
    finite(radius, 0, DRAFT_LIMITS.coordinate, 'eraser radius');
    if (!Array.isArray(points) || points.length > DRAFT_LIMITS.maxPointsPerStroke) throw new TypeError('Invalid eraser path');
    const path = points.map(point => ({
      x: finite(point?.x, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'eraser.x'),
      y: finite(point?.y, -DRAFT_LIMITS.coordinate, DRAFT_LIMITS.coordinate, 'eraser.y'),
    }));
    const strokes = this.draft.strokes.filter(stroke => !strokeTouchesPath(stroke, path, radius));
    return strokes.length !== this.draft.strokes.length && this.replaceStrokes(strokes);
  }

  clear() { return this.draft.strokes.length > 0 && this.replaceStrokes([]); }

  undo() {
    const change = this.undoStack.pop();
    if (!change) return false;
    this.draft.strokes = change.before;
    this.redoStack.push(change);
    return true;
  }

  redo() {
    const change = this.redoStack.pop();
    if (!change) return false;
    this.draft.strokes = change.after;
    this.undoStack.push(change);
    return true;
  }

  setViewport(value) {
    const next = normalizeViewport(value), current = this.draft.viewport;
    if (next.x === current.x && next.y === current.y && next.zoom === current.zoom) return false;
    this.draft.viewport = next;
    return true;
  }

  setPaper(value) {
    const next = normalizePaper(value), current = this.draft.paper;
    if (next.color === current.color && next.pattern === current.pattern) return false;
    this.draft.paper = next;
    return true;
  }
}
