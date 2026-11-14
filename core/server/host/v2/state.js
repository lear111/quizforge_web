import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBytes, replaceFile, checkPath, checkedStat } from '../platform/files.js';
import {
  cloneJson,
  shallowCopyJson,
  projectJson,
  patchJson,
  freezeJson,
  fingerprint,
  parseJson,
  jsonBytes,
  decimalSum,
} from '../platform/json.js';
import { statIdentity } from '../platform/file-cache.js';
import { object, problem } from './errors.js';
import { measureSave, measureOverview } from './timing.js';
import { PracticeInk } from './ink.js';
import {
  emptyOutlineStatus,
  isOutlineStatus,
  reportOutlineStatus,
  validateAnswered,
} from '../../../shared/v2/answered.js';
import { appendReceipt, replayed, validOldReceipts, validReceipts } from './receipts.js';
export { RECEIPT_LIMIT } from './receipts.js';

// Owner-approved limit. V2 never reads the v1 settings or state directories.
export const STATE_BYTES = 32 * 1024 * 1024;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const own = (value, key) => Object.hasOwn(value, key);
const invalid = () => problem('STATE_INVALID', '作答记录无法读取，原文件已保留。', {}, 503);
const identity = (file) => {
  const { stat } = checkedStat(file, { optional: true, bigint: true });
  return stat ? statIdentity(stat) : null;
};
const increment = (value) => {
  if (!integer(value + 1)) {
    throw problem('STATE_INVALID', '作答记录版本无法继续递增，原文件已保留。', {}, 503);
  }
  return value + 1;
};
const empty = () => ({ formatVersion: 2, questions: {} });
const validResultShape = (result) =>
  object(result) &&
  Object.keys(result).length === 3 &&
  (result.score === null
    ? result.parts === null &&
      (result.message === null || (typeof result.message === 'string' && !!result.message.trim()))
    : Number.isFinite(result.score) &&
      result.message === null &&
      (result.parts === null ||
        (object(result.parts) && Object.values(result.parts).every(Number.isFinite))));
function validOldQuestion(state, contentFingerprint) {
  if (
    !object(state) ||
    !integer(state.revision) ||
    !integer(state.answerVersion) ||
    !integer(state.resultRevision) ||
    !validOldReceipts(state)
  ) {
    return false;
  }
  if (own(state, 'answered')) {
    validateAnswered(state.answered);
  }
  if (
    state.submission !== null &&
    (!object(state.submission) ||
      typeof state.submission.submissionId !== 'string' ||
      state.submission.answerVersion !== state.answerVersion ||
      state.submission.contentFingerprint !== contentFingerprint)
  ) {
    return false;
  }
  return (
    [
      'unanswered',
      'drafting',
      'submitted-pending',
      'graded',
      'pending-review',
      'ungradable',
    ].includes(state.status) &&
    Boolean(state.submission) !== ['unanswered', 'drafting'].includes(state.status)
  );
}
function validQuestion(state) {
  if (
    !object(state) ||
    Object.keys(state).length !== 6 ||
    !integer(state.revision) ||
    !validReceipts(state.receipts) ||
    !own(state, 'answer')
  ) {
    return false;
  }
  if (
    !isOutlineStatus(state.status) &&
    !(object(state.status) && Object.values(state.status).every(isOutlineStatus))
  ) {
    return false;
  }
  if (
    state.submissionId !== null &&
    (typeof state.submissionId !== 'string' || !state.submissionId.trim())
  ) {
    return false;
  }
  return state.result === null || (state.submissionId !== null && validResultShape(state.result));
}
function statusAfterResult(item, status, result) {
  if (result.score === null && result.message === null) {
    return status;
  }
  const value = (score, max) =>
    result.score === null ? 'ungradable' : score === max ? 'correct' : 'wrong';
  return item.parts
    ? Object.fromEntries(
        item.parts.map((part) => [part.id, value(result.parts?.[part.id], part.maxScore)]),
      )
    : value(result.score, item.maxScore);
}
export class PracticeState {
  constructor({
    write = replaceFile,
    uuid = randomUUID,
    now = () => new Date().toISOString(),
    inkStore = new PracticeInk(),
  } = {}) {
    this.write = write;
    this.uuid = uuid;
    this.now = now;
    this.loaded = new Map();
    this.identities = new Map();
    this.ink = inkStore;
  }
  remember(file, value) {
    this.loaded.delete(file);
    this.loaded.set(file, value);
  }
  file(directory, { atomic = false } = {}) {
    const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
    // replaceFile's safeDirectory checks this very directory (including links
    // and canonical paths) immediately before creating its temporary file.
    // Still check the bank here so a deleted/moved bank is never recreated.
    if (!atomic) {
      checkedStat(local, { directory: true, optional: true });
    }
    return path.join(local, 'state.json');
  }
  load(directory, { refresh = false } = {}) {
    // A warm immutable graph needs no repeated filesystem resolution. Explicit
    // open/refresh checks identity; every commit still checks the destination.
    const key = path.join(directory, '.qf-v2', 'state.json');
    if (!refresh && this.loaded.has(key)) {
      return this.loaded.get(key);
    }
    const file = this.file(directory);
    if (!refresh && this.loaded.has(file)) {
      return this.loaded.get(file);
    }
    let value, observed;
    try {
      observed = identity(file);
      if (
        this.loaded.has(file) &&
        this.identities.has(file) &&
        this.identities.get(file) === observed
      ) {
        return this.loaded.get(file);
      }
      const bytes = readBytes(file, STATE_BYTES, true);
      if (identity(file) !== observed) {
        throw invalid();
      }
      // The persisted questions/id envelope is deeper than the HTTP envelope.
      const cached = this.loaded.get(file);
      value =
        bytes && cached && jsonBytes(cached).equals(bytes)
          ? cached
          : bytes
            ? parseJson(bytes, { maxDepth: 68 })
            : empty();
      if (!object(value) || value.formatVersion !== 2 || !object(value.questions)) {
        throw invalid();
      }
      if (
        own(value, 'completedAt') &&
        value.completedAt !== null &&
        (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)))
      ) {
        throw invalid();
      }
      if (own(value, 'historyIndex')) {
        // Only a recognizable older development record is reset on open.
        if (
          !Array.isArray(value.historyIndex) ||
          !Object.values(value.questions).every((state) =>
            validOldQuestion(state, value.contentFingerprint),
          )
        ) {
          throw invalid();
        }
      } else {
        for (const [id, raw] of Object.entries(value.questions)) {
          // D36: obsolete notes are omitted without rewriting on a read.
          const state =
            object(raw) && own(raw, 'draft')
              ? projectJson(
                  raw,
                  Object.keys(raw).filter((key) => key !== 'draft'),
                )
              : raw;
          if (!validQuestion(state)) {
            throw invalid();
          }
          if (state !== raw) {
            value.questions[id] = state;
          }
        }
      }
    } catch {
      this.loaded.delete(file);
      this.identities.delete(file);
      throw invalid();
    }
    freezeJson(value);
    this.remember(file, value);
    this.identities.set(file, observed);
    return value;
  }
  commit(directory, value) {
    const bytes = measureSave('serialize', () => jsonBytes(value));
    if (bytes.length > STATE_BYTES) {
      throw problem(
        'STATE_SIZE_LIMIT',
        '作答记录超过 32 MiB，本次未保存，原记录保留。',
        { details: { limit: STATE_BYTES } },
        413,
      );
    }
    const file = this.file(directory, { atomic: this.write === replaceFile });
    try {
      measureSave('write', () => this.write(file, bytes));
    } catch {
      throw problem('STATE_WRITE_FAILED', '作答未能保存，请重试；原记录保持不变。', {}, 503);
    }
    freezeJson(value);
    this.remember(file, value);
    // A post-write stat could already describe an external replacement rather
    // than these bytes. Confirm identity AND bytes at the next explicit open;
    // normal question reads and writes continue borrowing the committed graph.
    this.identities.delete(file);
  }
  reconcile(snapshot) {
    const old = this.load(snapshot.directory, { refresh: true });
    const exists =
      this.identities.get(path.join(snapshot.directory, '.qf-v2', 'state.json')) !== null;
    const changed =
      exists &&
      (own(old, 'historyIndex') || old.contentFingerprint !== snapshot.contentFingerprint);
    if (changed) {
      this.ink.clear(snapshot);
      this.commit(snapshot.directory, {
        ...empty(),
        contentFingerprint: snapshot.contentFingerprint,
        lastQuestionId: null,
      });
    }
    const inkChanged = measureOverview('ink-index', () => this.ink.open(snapshot));
    return changed || inkChanged;
  }
  evict(directory) {
    const file = path.join(directory, '.qf-v2', 'state.json');
    this.loaded.delete(file);
    this.identities.delete(file);
    this.ink.evict(directory);
  }
  get(snapshot, id) {
    const root = this.load(snapshot.directory);
    if (own(root, 'historyIndex')) {
      throw invalid();
    }
    return own(root.questions, id)
      ? root.questions[id]
      : freezeJson({
          status: emptyOutlineStatus(snapshot.items.get(id)),
          answer: null,
          result: null,
          submissionId: null,
          revision: 0,
          receipts: [],
        });
  }
  summary(snapshot, id) {
    const s = this.get(snapshot, id);
    return {
      questionId: id,
      status: cloneJson(s.status),
      revision: s.revision,
      hasSavedAnswer: s.answer !== null || s.submissionId !== null,
      locked: s.submissionId !== null,
      score: s.result?.score ?? null,
      maxScore: snapshot.maxScores.get(id),
      hasInk: this.ink.has(snapshot, id),
    };
  }
  total(snapshot, root = this.load(snapshot.directory)) {
    try {
      return {
        score: decimalSum(
          [...snapshot.items.keys()].map((id) => root.questions[id]?.result?.score ?? 0),
        ),
        maxScore: decimalSum([...snapshot.maxScores.values()]),
      };
    } catch {
      throw problem('INVALID_RESULT', '题库总分无法表示为有限数，本次未保存。');
    }
  }
  finish(snapshot, input) {
    if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) {
      throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
    }
    const root = this.load(snapshot.directory);
    // Completion itself is the idempotency marker: repeated calls never create
    // new locks or roll scores back, and the response reflects current scores.
    if (root.completedAt != null) {
      return root;
    }
    const questions = shallowCopyJson(root.questions);
    for (const [id, item] of snapshot.items) {
      const old = this.get(snapshot, id);
      if (old.submissionId !== null) {
        continue;
      }
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
        submissionId: this.uuid(),
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
      Object.defineProperty(questions, id, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    const completedAt = this.now();
    if (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))) {
      throw invalid();
    }
    const candidate = patchJson(root, {
      questions,
      contentFingerprint: snapshot.contentFingerprint,
      completedAt,
    });
    this.total(snapshot, candidate);
    this.commit(snapshot.directory, candidate);
    return candidate;
  }
  results(snapshot, input) {
    if (
      !object(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      !Array.isArray(input.results)
    ) {
      throw problem('INVALID_REQUEST', '批量评分请求无效。', {}, 400);
    }
    const root = this.load(snapshot.directory),
      signature = fingerprint({ op: 'results', input }, 'quizforge-v2-receipt'),
      seen = new Set(),
      entries = [];
    for (const entry of input.results) {
      const id = entry?.questionId,
        context = { questionId: typeof id === 'string' ? id : null };
      if (!object(entry) || typeof id !== 'string' || !snapshot.items.has(id) || seen.has(id)) {
        throw problem('INVALID_REQUEST', '批量评分的题号不存在或重复。', context, 400);
      }
      seen.add(id);
      const old = this.get(snapshot, id);
      if (old.submissionId === null || old.submissionId !== entry.submissionId) {
        throw problem('SUBMISSION_STALE', '评分不属于当前锁定的答案。', context, 409);
      }
      let replay;
      try {
        replay = replayed(old.receipts, input.requestId, signature);
      } catch (error) {
        error.context = { ...error.context, ...context };
        throw error;
      }
      if (
        !replay &&
        (!integer(entry.expectedRevision) || entry.expectedRevision !== old.revision)
      ) {
        throw problem('RESULT_CONFLICT', '作答记录已变化，请重新读取待评分题。', context, 409);
      }
      try {
        validateResult(snapshot.items.get(id), entry.result);
      } catch (error) {
        error.context = { ...error.context, ...context };
        throw error;
      }
      entries.push({ id, old, result: entry.result, replay });
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
        status: statusAfterResult(snapshot.items.get(id), old.status, result),
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
    this.total(snapshot, candidate);
    this.commit(snapshot.directory, candidate);
    return candidate;
  }
  apply(snapshot, id, op, input) {
    if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) {
      throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
    }
    const root = this.load(snapshot.directory),
      old = this.get(snapshot, id),
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
    const item = snapshot.items.get(id);
    let next;
    if (op === 'answer') {
      if (!own(input, 'answer')) {
        throw problem('INVALID_REQUEST', '缺少待保存的答案。', {}, 400);
      }
      if (old.submissionId !== null) {
        throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
      }
      const fields = cloneJson(projectJson(input, ['answer']));
      if (own(input, 'answered')) {
        try {
          fields.status = reportOutlineStatus(input.answered, item, old.status);
        } catch (error) {
          throw problem('INVALID_REQUEST', error.message, {}, 400);
        }
      }
      next = patchJson(old, fields);
    } else if (op === 'retry') {
      this.ink.remove(snapshot, id);
      next = patchJson(old, {
        status: emptyOutlineStatus(item),
        answer: null,
        result: null,
        submissionId: null,
      });
    } else if (op === 'submit') {
      if (old.submissionId !== null) {
        throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
      }
      if (!own(input, 'answer')) {
        throw problem('INVALID_REQUEST', '缺少待提交的作答。', {}, 400);
      }
      next = patchJson(patchJson(old, cloneJson(projectJson(input, ['answer']))), {
        result: null,
        submissionId: this.uuid(),
      });
    } else if (op === 'result') {
      if (input.source !== 'grader') {
        throw problem('INVALID_RESULT', '当前仅接受题型评分结果。');
      }
      validateResult(item, input.result);
      next = patchJson(old, {
        status: statusAfterResult(item, old.status, input.result),
        result: cloneJson(input.result),
      });
    } else {
      throw problem('INVALID_REQUEST', '未知的作答操作。', {}, 400);
    }
    next.revision = increment(old.revision);
    next.receipts = appendReceipt(op === 'retry' ? [] : old.receipts, key, signature);
    const questions = shallowCopyJson(root.questions);
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
      this.total(snapshot, candidate);
    }
    this.commit(snapshot.directory, candidate);
    return next;
  }
}
export function validateResult(item, result) {
  const fail = () => {
    throw problem('INVALID_RESULT', '评分格式或分数与本题大纲不符。');
  };
  if (!validResultShape(result)) {
    fail();
  }
  if (result.score === null) {
    return;
  }
  const finiteScore = (value, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const max = item.parts ? decimalSum(item.parts.map((part) => part.maxScore)) : item.maxScore;
  if (!finiteScore(result.score, max)) {
    fail();
  }
  if (item.parts) {
    if (!object(result.parts) || Object.keys(result.parts).length !== item.parts.length) {
      fail();
    }
    const scores = item.parts.map((part) => {
      if (!own(result.parts, part.id) || !finiteScore(result.parts[part.id], part.maxScore)) {
        fail();
      }
      return result.parts[part.id];
    });
    if (decimalSum(scores) !== result.score) {
      fail();
    }
  } else if (result.parts !== null) {
    fail();
  }
}
