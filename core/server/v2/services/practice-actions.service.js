/** @typedef {import('./practice.service.js').PracticeState} PracticeState */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @typedef {import('../../../shared/v2/state.js').QuestionState} QuestionState */
/** @typedef {import('../types/data.js').CurrentState} CurrentState */
/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
import { cloneJson, shallowCopyJson, patchJson, fingerprint } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { integer, increment, own } from '../utils/state.js';
import { appendReceipt, replayed } from '../utils/receipts.js';
import { emptyOutlineStatus, reportOutlineStatus } from '../../../shared/v2/answered.js';
import { projectJson } from '../../host/platform/json.js';
import { statusAfterResult, validateResult } from './practice-result.service.js';
/**
 * @param {PracticeState} store
 * @param {Snapshot} snapshot
 * @param {string} id
 * @param {string} op
 * @param {unknown} input
 * @returns {QuestionState}
 */
export function applyAction(store, snapshot, id, op, input) {
  if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) {
    throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
  }
  const root = /** @type {CurrentState} */ (store.load(snapshot.directory)),
    old = store.get(snapshot, id),
    key = input.requestId;
  // Completed rounds remain editable only through score and ink routes. This
  // precedes receipt replay so an old answer/retry can never bypass the lock.
  if (root.completedAt != null && ['answer', 'submit', 'retry'].includes(op)) {
    throw problem('ROUND_COMPLETED', '本轮练习已完成，不能修改答案或单题重做。', {}, 409);
  }
  const signature = fingerprint({ op, input }, 'quizforge-v2-receipt');
  // Check the current lock/generation before replay; never resurrect an old lock.
  if (op === 'result' && (old.submissionId === null || old.submissionId !== input.submissionId)) {
    throw problem('SUBMISSION_STALE', '评分不属于当前锁定的答案。', {}, 409);
  }
  if (replayed(old.receipts, key, signature)) {
    return old;
  }
  if (!integer(input.expectedRevision) || input.expectedRevision !== old.revision) {
    throw problem(
      op === 'result' ? 'RESULT_CONFLICT' : 'REVISION_CONFLICT',
      '作答记录已变化，请重新打开本题。',
      {},
      409,
    );
  }
  const next = actionValue(store, snapshot, id, op, input, old);
  next.revision = increment(old.revision);
  next.receipts = appendReceipt(op === 'retry' ? [] : old.receipts, key, signature);
  const questions = shallowCopyJson(root.questions);
  // A question ID may be "__proto__"; define a data property without invoking setters.
  Object.defineProperty(questions, id, {
    value: next,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const candidate = patchJson(root, {
    questions,
    contentFingerprint: snapshot.contentFingerprint,
    ...(op !== 'result' ? { lastQuestionId: id } : {}),
  });
  if (op === 'result') {
    store.total(snapshot, candidate);
  }
  store.commit(snapshot.directory, candidate);
  return next;
}
/**
 * @param {PracticeState} store
 * @param {Snapshot} snapshot
 * @param {string} id
 * @param {string} op
 * @param {Record<string, unknown>} input
 * @param {QuestionState} old
 * @returns {QuestionState}
 */
function actionValue(store, snapshot, id, op, input, old) {
  const item = /** @type {OutlineItem} */ (snapshot.items.get(id));
  if (op === 'answer') {
    return answerValue(item, input, old);
  } else if (op === 'retry') {
    store.ink.remove(snapshot, id);
    return patchJson(old, {
      status: emptyOutlineStatus(item),
      answer: null,
      result: null,
      submissionId: null,
    });
  } else if (op === 'submit') {
    return submissionValue(store, input, old);
  } else if (op === 'result') {
    if (input.source !== 'grader') {
      throw problem('INVALID_RESULT', '当前仅接受题型评分结果。');
    }
    validateResult(item, input.result);
    return patchJson(old, {
      status: statusAfterResult(item, old.status, input.result),
      result: cloneJson(input.result),
    });
  } else {
    throw problem('INVALID_REQUEST', '未知的作答操作。', {}, 400);
  }
}

/**
 * @param {OutlineItem} item
 * @param {Record<string, unknown>} input
 * @param {QuestionState} old
 */
function answerValue(item, input, old) {
  if (!own(input, 'answer')) {
    throw problem('INVALID_REQUEST', '缺少待保存的答案。', {}, 400);
  }
  if (old.submissionId !== null) {
    throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
  }
  const fields =
    /** @type {Pick<QuestionState, 'answer'> & Partial<Pick<QuestionState, 'status'>>} */ (
      cloneJson(projectJson(input, ['answer']))
    );
  if (own(input, 'answered')) {
    try {
      fields.status = reportOutlineStatus(input.answered, item, old.status);
    } catch (error) {
      throw problem('INVALID_REQUEST', /** @type {Error} */ (error).message, {}, 400);
    }
  }
  return /** @type {QuestionState} */ (patchJson(old, fields));
}

/**
 * @param {PracticeState} store
 * @param {Record<string, unknown>} input
 * @param {QuestionState} old
 */
function submissionValue(store, input, old) {
  if (old.submissionId !== null) {
    throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
  }
  if (!own(input, 'answer')) {
    throw problem('INVALID_REQUEST', '缺少待提交的作答。', {}, 400);
  }
  return patchJson(patchJson(old, cloneJson(projectJson(input, ['answer']))), {
    result: null,
    submissionId: store.uuid(),
  });
}
