// The host supplies only answers returned by a successful submit/lock request.
// Author code is evaluated only inside the opaque iframe's dedicated Worker.
import { dispose, enqueue } from './grading/pool.js';
import type { GradingInput, GradingOptions, Pool } from './grading/types.js';
export type { GradeResult, GradingInput, GradingOptions, GradingOutput } from './grading/types.js';
export { ungradable } from './grading/results.js';

export function createGradingService(options: GradingOptions) {
  const pool: Pool = {
    options,
    doc: options.document ?? document,
    timeoutMs: options.timeoutMs ?? 10_000,
    idleMs: options.idleMs ?? 60_000,
    slots: new Map(),
    closed: false,
  };
  return {
    grade: (artifactId: string, items: GradingInput[]) => enqueue(pool, artifactId, items),
    dispose: () => dispose(pool),
  };
}
