export const DEFAULT_WIDTH = 360;
export const MIN_WIDTH = 300;
export const MAX_WIDTH = 560;

export function clampPosition(point, size, viewport, margin = 8) {
  const maxX = Math.max(margin, viewport.width - size.width - margin), maxY = Math.max(margin, viewport.height - size.height - margin);
  return { x: Math.min(maxX, Math.max(margin, Number.isFinite(point.x) ? point.x : maxX)), y: Math.min(maxY, Math.max(margin, Number.isFinite(point.y) ? point.y : margin)) };
}

// Resize the card width only. Text, controls and height are never scaled.
export function fitWidth(wanted, area) {
  const maxWidth = Math.min(MAX_WIDTH, Math.max(1, area.width - 16));
  const minWidth = Math.min(MIN_WIDTH, maxWidth);
  return { width: Math.min(maxWidth, Math.max(minWidth, Number.isFinite(wanted) ? wanted : DEFAULT_WIDTH)), minWidth, maxWidth };
}
