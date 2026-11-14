/** @typedef {import('./practice.service.js').PracticeState} PracticeState */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @typedef {import('../types/data.js').CurrentState} CurrentState */
/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
/** @typedef {import('../../../shared/v2/state.js').QuestionState} QuestionState */
/** @typedef {import('../utils/errors.js').V2Error} V2Error */
import { cloneJson, shallowCopyJson, patchJson, fingerprint } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { integer, increment, invalid } from '../utils/state.js';
import { appendReceipt, replayed } from '../utils/receipts.js';
import { statusAfterResult, validateResult } from './practice-result.service.js';
/**
 * @param {PracticeState} store
 * @param {Snapshot} snapshot
 * @param {unknown} input
 */
export function finishRound(store, snapshot, input) {
  if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) {
    throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
  }
  const root = /** @type {CurrentState} */ (store.load(snapshot.directory));
  // Completion itself is the idempotency marker: repeated calls never create
  // new locks or roll scores back, and the response reflects current scores.
  if (root.completedAt != null) {
    return root;
  }
  const questions = shallowCopyJson(root.questions);
  for (const [id, item] of snapshot.items) {
    const old = store.get(snapshot, id);
    if (old.submissionId !== null) {
      continue;
    }
    const next = lockQuestion(store, item, old);
    Object.defineProperty(questions, id, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const completedAt = store.now();
  if (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))) {
    throw invalid();
  }
  const candidate = patchJson(root, {
    questions,
    contentFingerprint: snapshot.contentFingerprint,
    completedAt,
  });
  store.total(snapshot, candidate);
  store.commit(snapshot.directory, candidate);
  return candidate;
}
/**
 * @param {PracticeState} store
 * @param {Snapshot} snapshot
 * @param {unknown} input
 */
export function recordResults(store, snapshot, input) {
  if (
    !object(input) ||
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    !Array.isArray(input.results)
  ) {
    throw problem('INVALID_REQUEST', '批量评分请求无效。', {}, 400);
  }
  const root = /** @type {CurrentState} */ (store.load(snapshot.directory)),
    signature = fingerprint({ op: 'results', input }, 'quizforge-v2-receipt'),
    /** @type {Set<string>} */ seen = new Set(),
    entries = [];
  for (const entry of input.results) {
    const checked = checkResultEntry(store, snapshot, input, entry, seen, signature);
    entries.push(checked);
  }
  if (!entries.length || entries.every((entry) => entry.replay)) {
    return root;
  }
  // A batch is one atomic write. Never replay only a subset after another
  // write has pushed some of the per-question receipts out of their window.
  if (entries.some((entry) => entry.replay)) {
    throw problem('RESULT_CONFLICT', '部分题目的请求凭据已变化，请重新读取待评分题。', {}, 409);
  }
  const questions = shallowCopyJson(root.questions);
  for (const { id, old, result } of entries) {
    const next = patchJson(old, {
      status: statusAfterResult(
        /** @type {OutlineItem} */ (snapshot.items.get(id)),
        old.status,
        result,
      ),
      result: cloneJson(result),
      revision: increment(old.revision),
      receipts: appendReceipt(old.receipts, input.requestId, signature),
    });
    Object.defineProperty(questions, id, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const candidate = patchJson(root, {
    questions,
    contentFingerprint: snapshot.contentFingerprint,
  });
  store.total(snapshot, candidate);
  store.commit(snapshot.directory, candidate);
  return candidate;
}

/**
 * @param {PracticeState} store
 * @param {OutlineItem} item
 * @param {QuestionState} old
 * @returns {QuestionState}
 */
function lockQuestion(store, item, old) {
  const answered =
    typeof old.status === 'string'
      ? old.status === 'answered'
      : Object.values(old.status).some((value) => value === 'answered');
  const result = answered
    ? null
    : {
        score: 0,
        parts: item.parts ? Object.fromEntries(item.parts.map((part) => [part.id, 0])) : null,
        message: null,
      };
  const next = patchJson(old, {
    submissionId: store.uuid(),
    revision: increment(old.revision),
    ...(result
      ? {
          result,
          status: item.parts
            ? Object.fromEntries(item.parts.map((part) => [part.id, 'wrong']))
            : 'wrong',
        }
      : {}),
  });
  return /** @type {QuestionState} */ (next);
}
/**
 * @param {PracticeState} store
 * @param {Snapshot} snapshot
 * @param {Record<string, unknown>} input
 * @param {unknown} entry
 * @param {Set<string>} seen
 * @param {string} signature
 */
function checkResultEntry(store, snapshot, input, entry, seen, signature) {
  const id = /** @type {{questionId?: unknown} | null} */ (entry)?.questionId,
    context = { questionId: typeof id === 'string' ? id : null };
  if (!object(entry) || typeof id !== 'string' || !snapshot.items.has(id) || seen.has(id)) {
    throw problem('INVALID_REQUEST', '批量评分的题号不存在或重复。', context, 400);
  }
  seen.add(id);
  const old = store.get(snapshot, id);
  if (old.submissionId === null || old.submissionId !== entry.submissionId) {
    throw problem('SUBMISSION_STALE', '评分不属于当前锁定的答案。', context, 409);
  }
  let replay;
  try {
    replay = replayed(old.receipts, /** @type {string} */ (input.requestId), signature);
  } catch (error) {
    /** @type {V2Error} */ (error).context = {
      .../** @type {V2Error} */ (error).context,
      ...context,
    };
    throw error;
  }
  if (!replay && (!integer(entry.expectedRevision) || entry.expectedRevision !== old.revision)) {
    throw problem('RESULT_CONFLICT', '作答记录已变化，请重新读取待评分题。', context, 409);
  }
  try {
    validateResult(/** @type {OutlineItem} */ (snapshot.items.get(id)), entry.result);
  } catch (error) {
    /** @type {V2Error} */ (error).context = {
      .../** @type {V2Error} */ (error).context,
      ...context,
    };
    throw error;
  }
  return { id, old, result: entry.result, replay };
}
