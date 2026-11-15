import { createEnvironment } from './environment.js';
import { normalize, unavailable } from './results.js';
import type { GradingInput, GradingOutput, Pool, Slot } from './types.js';

interface Batch {
  pool: Pool;
  slot: Slot;
  artifactId: string;
  items: GradingInput[];
  controller: AbortController;
  done: boolean;
  resolve(value: GradingOutput[]): void;
}
type Finish = (value: GradingOutput[], destroy?: boolean) => void;

function finishBatch(
  batch: Batch,
  timer: ReturnType<typeof setTimeout>,
  value: GradingOutput[],
  destroy: boolean,
): void {
  if (batch.done) {
    return;
  }
  batch.done = true;
  clearTimeout(timer);
  const { pool, slot, controller, artifactId } = batch;
  slot.cancel = null;
  controller.abort();
  if (destroy) {
    slot.environment?.destroy();
    slot.environment = null;
  }
  if (!pool.closed) {
    slot.idleTimer = setTimeout(() => {
      slot.environment?.destroy();
      slot.environment = null;
      if (pool.slots.get(artifactId) === slot) {
        pool.slots.delete(artifactId);
      }
    }, pool.idleMs);
  }
  batch.resolve(value);
}

async function execute(batch: Batch, finish: Finish): Promise<void> {
  const { pool, slot, artifactId, controller, items } = batch;
  try {
    if (!slot.environment) {
      const source = await pool.options.loadSource(artifactId, controller.signal);
      if (batch.done) {
        return;
      }
      slot.environment = createEnvironment(pool.doc, source, pool.options.scriptNonce);
    }
    const result = await slot.environment.run(items);
    finish(normalize(items, result));
  } catch {
    finish(unavailable(items, '评分环境执行失败，请重试。'), true);
  }
}

export function runBatch(pool: Pool, slot: Slot, artifactId: string, items: GradingInput[]) {
  return new Promise<GradingOutput[]>((resolve) => {
    if (pool.closed) {
      resolve(unavailable(items, '评分环境已关闭。'));
      return;
    }
    if (slot.idleTimer !== null) {
      clearTimeout(slot.idleTimer);
      slot.idleTimer = null;
    }
    const batch: Batch = {
      pool,
      slot,
      artifactId,
      items,
      controller: new AbortController(),
      done: false,
      resolve,
    };
    const finish: Finish = (value, destroy = false) => finishBatch(batch, timer, value, destroy);
    const timer = setTimeout(
      () => finish(unavailable(items, '评分超时，请重新评分。'), true),
      pool.timeoutMs,
    );
    slot.cancel = () => finish(unavailable(items, '评分环境已关闭。'), true);
    void execute(batch, finish);
  });
}
