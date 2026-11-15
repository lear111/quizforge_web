import type { ResultEntry, ApiErrorCode } from '../../../../../shared/v2/api.js';
import { ungradable } from '../grading';
import type { Overview } from '../../types/practice-types';
import { createRequestId, writeBody } from '../../api/requests';

export interface PendingBatch {
  snapshotId: string;
  body: string;
  rows: ResultEntry[];
}
interface RequestOptions {
  requestId?(): string;
}

export function createBatch(
  value: Pick<Overview, 'snapshotId'>,
  rows: ResultEntry[],
  options: RequestOptions,
): PendingBatch {
  return {
    snapshotId: value.snapshotId,
    rows,
    body: writeBody(value.snapshotId, { results: rows }, (options.requestId ?? createRequestId)()),
  };
}

export function replaceInvalidResult(
  batch: PendingBatch,
  error: unknown,
  options: RequestOptions,
): void {
  const info = error as { code?: string; questionId?: string };
  // A rejected batch saved nothing. Downgrade only the reported author result;
  // other errors and a repeated rejection of an already ungradable row escape.
  const row = batch.rows.find((row) => row.questionId === info.questionId);
  if (
    info.code !== ('INVALID_RESULT' satisfies ApiErrorCode) ||
    !row ||
    (row.result.score === null && row.result.message)
  ) {
    throw error;
  }
  row.result = ungradable('题型返回的评分格式或分数无效。');
  batch.body = writeBody(
    batch.snapshotId,
    { results: batch.rows },
    (options.requestId ?? createRequestId)(),
  );
}
