import { unavailable } from './results.js';
import { runBatch } from './task.js';
import type { GradingInput, GradingOutput, Pool } from './types.js';

export function enqueue(
  pool: Pool,
  artifactId: string,
  items: GradingInput[],
): Promise<GradingOutput[]> {
  if (pool.closed) {
    return Promise.resolve(unavailable(items, '评分环境已关闭。'));
  }
  let slot = pool.slots.get(artifactId);
  if (!slot) {
    slot = { environment: null, tail: Promise.resolve(), cancel: null, idleTimer: null };
    pool.slots.set(artifactId, slot);
  }
  const current = slot;
  const task = current.tail.then(() => runBatch(pool, current, artifactId, items));
  current.tail = task.catch(() => {});
  return task;
}

export function dispose(pool: Pool): void {
  pool.closed = true;
  for (const slot of pool.slots.values()) {
    slot.cancel?.();
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
    }
    slot.environment?.destroy();
  }
  pool.slots.clear();
}
