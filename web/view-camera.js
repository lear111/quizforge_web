import { DRAFT_LIMITS } from './whiteboard-model.js';

const dimension = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > DRAFT_LIMITS.coordinate) {
    throw new TypeError(`${name} must be a finite non-negative dimension`);
  }
  return value;
};

// Practice lays out the card without changing the persisted draft viewport.
// Its scale follows width only: long questions use ordinary document scrolling.
export function practiceViewport({
  width, height, cardHeight, worldWidth = 760, cardTop = 34,
  horizontalGutter = 24, verticalGutter = 24,
}) {
  for (const [name, value] of Object.entries({ width, height, cardHeight, worldWidth, cardTop, horizontalGutter, verticalGutter })) {
    dimension(value, name);
  }
  if (!worldWidth) throw new TypeError('worldWidth must be positive');
  const zoom = Math.max(DRAFT_LIMITS.minZoom, Math.min(1, (width - horizontalGutter) / worldWidth));
  const x = (width / zoom - worldWidth) / 2;
  const fitsVertically = cardHeight > 0 && cardHeight * zoom + verticalGutter <= height;
  const y = fitsVertically ? (height / zoom - cardHeight) / 2 - cardTop : 0;
  return { x, y, zoom };
}
