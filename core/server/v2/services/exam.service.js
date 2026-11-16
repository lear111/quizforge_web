/** @import { PracticeLibrary, CurrentState } from '../types/data.js' */
/** @import { PracticeState } from './practice.service.js' */
import { empty, invalid } from '../utils/state.js';
import { object, problem } from '../utils/errors.js';
import { checkPractice, exists, removeTree } from '../repositories/restart-files.repository.js';
import { practiceDirectory } from '../repositories/practice-directory.repository.js';

/** @param {PracticeState | null} store @param {string} directory */
export function activeExam(store, directory) {
  return store?.records.load(directory, { refresh: true, scope: 'exam' }).exam;
}

/** @param {PracticeState} store @returns {string} */
export function examNow(store) {
  const now = store.now();
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) {
    throw invalid();
  }
  return now;
}

const ANSWER_GRACE_MS = 5000;

/** @param {PracticeState} store @param {import('../../../shared/v2/state.js').ExamTimes} exam */
export function examAnswerClosed(store, exam) {
  return Date.parse(examNow(store)) >= Date.parse(exam.endsAt);
}

/** @param {PracticeState} store @param {CurrentState} state @param {string} op */
export function guardExamAction(store, state, op) {
  if (!state.exam) {
    return;
  }
  if (op === 'submit' || op === 'retry') {
    throw problem('EXAM_IN_PROGRESS', '考试中不能单题提交或重做，请统一交卷。', {}, 409);
  }
  if (
    op === 'answer' &&
    Date.parse(examNow(store)) >= Date.parse(state.exam.endsAt) + ANSWER_GRACE_MS
  ) {
    throw problem('EXAM_ENDED', '考试时间已到，本次答案未保存。', {}, 409);
  }
}

/** @param {PracticeState} store @param {string} directory */
export function clearExam(store, directory) {
  const folder = practiceDirectory(directory, { scope: 'exam' });
  if (exists(folder)) {
    checkPractice(folder);
    removeTree(folder);
  }
  store.records.evict(directory, 'exam');
  store.ink.evict(directory);
}

/** @param {PracticeLibrary} library @param {string} bankId @param {unknown} input */
export function startExam(library, bankId, input) {
  if (
    !object(input) ||
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    typeof input.snapshotId !== 'string' ||
    typeof input.durationMinutes !== 'number' ||
    !Number.isSafeInteger(input.durationMinutes) ||
    input.durationMinutes <= 0
  ) {
    throw invalidDuration();
  }
  const location = library.locations().find((bank) => bank.bankId === bankId);
  if (!location) {
    throw problem('BANK_NOT_FOUND', '题库不存在。', { bankId }, 404);
  }
  const store = library.stateStore;
  if (activeExam(store, location.directory)) {
    throw problem('EXAM_EXISTS', '该题库已有考试，请继续当前考试。', { bankId }, 409);
  }
  const snapshot = library.snapshot(bankId, input.snapshotId);
  if (snapshot.info.features.exam === false) {
    throw problem('INVALID_REQUEST', '该题库不支持考试。', { bankId }, 400);
  }
  const startedAt = examNow(store);
  const end = new Date(Date.parse(startedAt) + input.durationMinutes * 60000);
  if (!Number.isFinite(end.getTime())) {
    throw invalidDuration();
  }
  const exam = { startedAt, endsAt: end.toISOString() };
  store.commitRound(
    { ...snapshot, exam },
    {
      ...empty(),
      completedAt: null,
      contentFingerprint: snapshot.contentFingerprint,
      exam,
    },
  );
  library.opened.delete(bankId);
  return library.open(bankId);
}

function invalidDuration() {
  return problem('INVALID_REQUEST', '考试请求标识、快照或时长无效。请输入正整数分钟。', {}, 400);
}
