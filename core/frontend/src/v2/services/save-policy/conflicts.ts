import type { ApiErrorCode } from '../../../../../shared/v2/api.js';
export function isSaveConflict(error: unknown): boolean {
  const value = error as { status?: number; code?: string } | null;
  if (!value) {
    return false;
  }
  if (value.status !== undefined && value.status >= 400 && value.status < 500) {
    return value.status !== 401;
  }
  if (
    (value.status !== undefined && value.status >= 500) ||
    value.code === ('STATE_WRITE_FAILED' satisfies ApiErrorCode)
  ) {
    return false;
  }
  const conflicts: readonly string[] = [
    'REVISION_CONFLICT',
    'RESULT_CONFLICT',
    'SUBMISSION_STALE',
    'ANSWER_LOCKED',
    'SNAPSHOT_STALE',
    'BANK_NOT_OPEN',
    'BANK_NOT_FOUND',
    'QUESTION_NOT_FOUND',
  ] satisfies ApiErrorCode[];
  return conflicts.includes(value.code ?? '');
}
export const saveRecoveryMessage = (error: unknown) =>
  (error as { status?: number; code?: string } | null)?.status === 413 ||
  (error as { code?: string } | null)?.code === ('STATE_SIZE_LIMIT' satisfies ApiErrorCode)
    ? '作答文件已达上限，本次输入未保存，已载入最新内容。'
    : '本题已在别处修改，已载入最新内容';
