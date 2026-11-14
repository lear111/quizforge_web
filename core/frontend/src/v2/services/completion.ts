import type { GradingInput, GradingOutput, GradeResult } from './grading';
import { ungradable } from './grading';
import type { Overview, Question, Completion } from '../types/practice-types';

// The same batch/body/request id is retained after an uncertain transport
// failure. Author code only runs in the existing browser grading service.
export function createCompletionGrader(options: {
  grade(artifact: string, items: GradingInput[]): Promise<GradingOutput[]>;
  send(body: string): Promise<Completion>;
  requestId(): string;
}) {
  let pending: {
    snapshotId: string;
    body: string;
    rows: {
      questionId: string;
      submissionId: string | null;
      expectedRevision: number;
      result: GradeResult;
    }[];
  } | null = null;
  return {
    clear() {
      pending = null;
    },
    async run(value: Pick<Overview, 'snapshotId' | 'pendingGrading'>): Promise<Completion | null> {
      if (pending?.snapshotId !== value.snapshotId) {
        pending = null;
      }
      if (!pending) {
        const groups = new Map<string, Question[]>();
        for (const candidate of value.pendingGrading) {
          if (candidate.question) {
            const q = candidate.question,
              id = q.extension.artifactId;
            if (!groups.has(id)) {
              groups.set(id, []);
            }
            groups.get(id)!.push(q);
          }
        }
        const rows = [];
        for (const [id, questions] of groups) {
          const graded = await options.grade(
            id,
            questions.map((q) => ({
              questionId: q.questionId,
              question: q.question,
              solution: q.solution,
              answer: q.answer,
              item: q.item,
            })),
          );
          for (const q of questions) {
            rows.push({
              questionId: q.questionId,
              submissionId: q.submissionId,
              expectedRevision: q.state.revision,
              result:
                graded.find((row) => row.questionId === q.questionId)?.result ??
                ungradable('题型没有返回本题的评分结果。'),
            });
          }
        }
        if (!rows.length) {
          return null;
        }
        pending = {
          snapshotId: value.snapshotId,
          rows,
          body: JSON.stringify({
            requestId: options.requestId(),
            snapshotId: value.snapshotId,
            results: rows,
          }),
        };
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
          const info = error as { code?: string; questionId?: string };
          // Match single-question scoring: a rejected author result becomes
          // ungradable. The server has saved none of the rejected batch.
          const row = batch.rows.find((row) => row.questionId === info.questionId);
          if (
            info.code !== 'INVALID_RESULT' ||
            !row ||
            (row.result.score === null && row.result.message)
          ) {
            throw error;
          }
          row.result = ungradable('题型返回的评分格式或分数无效。');
          batch.body = JSON.stringify({
            requestId: options.requestId(),
            snapshotId: batch.snapshotId,
            results: batch.rows,
          });
        }
      }
    },
  };
}
