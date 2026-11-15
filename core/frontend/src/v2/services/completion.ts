import type { ResultEntry } from '../../../../shared/v2/api.js';
import type { GradingInput, GradingOutput } from './grading';
import type { Overview, Completion } from '../types/practice-types';
import { groupQuestions, gradingInputs, appendResults } from './completion/results';
import { createBatch, replaceInvalidResult, type PendingBatch } from './completion/batch';

// The same batch/body/request id is retained after an uncertain transport
// failure. Author code only runs in the existing browser grading service.
export function createCompletionGrader(options: {
  grade(artifact: string, items: GradingInput[]): Promise<GradingOutput[]>;
  send(body: string): Promise<Completion>;
  requestId?(): string;
}) {
  let pending: PendingBatch | null = null;
  return {
    clear() {
      pending = null;
    },
    async run(value: Pick<Overview, 'snapshotId' | 'pendingGrading'>): Promise<Completion | null> {
      if (pending?.snapshotId !== value.snapshotId) {
        pending = null;
      }
      if (!pending) {
        const groups = groupQuestions(value.pendingGrading);
        const rows: ResultEntry[] = [];
        for (const [id, questions] of groups) {
          const graded = await options.grade(id, gradingInputs(questions));
          appendResults(rows, questions, graded);
        }
        if (!rows.length) {
          return null;
        }
        pending = createBatch(value, rows, options);
      }
      const batch = pending;
      if (!batch) {
        return null;
      }
      for (;;) {
        try {
          const saved = await options.send(batch.body);
          pending = null;
          return saved;
        } catch (error) {
          replaceInvalidResult(batch, error, options);
        }
      }
    },
  };
}
