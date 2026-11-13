import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBytes, replaceFile, checkPath, checkedStat } from '../platform/files.js';
import { cloneJson, shallowCopyJson, projectJson, patchJson, freezeJson, fingerprint, parseJson, jsonBytes, jsonEqual, decimalSum } from '../platform/json.js';
import { statIdentity } from '../platform/file-cache.js';
import { object, problem } from './errors.js';
import { measureSave } from './timing.js';
import { PracticeInk } from './ink.js';

// Owner-approved limit. V2 never reads the v1 settings or state directories.
export const STATE_BYTES = 32 * 1024 * 1024;
export const RECEIPT_LIMIT = 4;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const own = (value, key) => Object.hasOwn(value, key);
const invalid = () => problem('STATE_INVALID', '作答记录无法读取，原文件已保留。', {}, 503);
const identity = file => { const { stat } = checkedStat(file, { optional: true, bigint: true }); return stat ? statIdentity(stat) : null; };
const increment = value => {
  if (!integer(value + 1)) throw problem('STATE_INVALID', '作答记录版本无法继续递增，原文件已保留。', {}, 503);
  return value + 1;
};
export class PracticeState {
  constructor({ write = replaceFile, uuid = randomUUID, inkStore = new PracticeInk() } = {}) { this.write = write; this.uuid = uuid; this.loaded = new Map(); this.identities = new Map(); this.ink = inkStore; }
  remember(file, value) {
    this.loaded.delete(file); this.loaded.set(file, value);
  }
  file(directory, { atomic = false } = {}) {
    const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
    // replaceFile's safeDirectory checks this very directory (including links
    // and canonical paths) immediately before creating its temporary file.
    // Still check the bank here so a deleted/moved bank is never recreated.
    if (!atomic) checkedStat(local, { directory: true, optional: true });
    return path.join(local, 'state.json');
  }
  load(directory, { refresh = false } = {}) {
    // A warm immutable graph needs no repeated filesystem resolution. Explicit
    // open/refresh checks identity; every commit still checks the destination.
    const key = path.join(directory, '.qf-v2', 'state.json');
    if (!refresh && this.loaded.has(key)) return this.loaded.get(key);
    const file = this.file(directory);
    if (!refresh && this.loaded.has(file)) return this.loaded.get(file);
    let value, observed;
    try {
      observed = identity(file);
      if (this.loaded.has(file) && this.identities.has(file) && this.identities.get(file) === observed) return this.loaded.get(file);
      const bytes = readBytes(file, STATE_BYTES, true);
      if (identity(file) !== observed) throw invalid();
      // The persisted questions/id envelope is deeper than the HTTP envelope.
      const cached = this.loaded.get(file);
      value = bytes && cached && jsonBytes(cached).equals(bytes) ? cached : bytes ? parseJson(bytes, { maxDepth: 68 }) : { formatVersion: 2, questions: {}, historyIndex: [] };
      if (!object(value) || value.formatVersion !== 2 || !object(value.questions) || !Array.isArray(value.historyIndex)) throw invalid();
      for (const state of Object.values(value.questions)) {
        if (!object(state) || !integer(state.revision) || !integer(state.answerVersion) || !integer(state.resultRevision) || !object(state.receipts)) throw invalid();
        if (Object.values(state.receipts).some(value => typeof value !== 'string')) throw invalid();
        if (own(state, 'receiptOrder') && (!Array.isArray(state.receiptOrder) || state.receiptOrder.length > RECEIPT_LIMIT || new Set(state.receiptOrder).size !== state.receiptOrder.length || state.receiptOrder.some(key => typeof key !== 'string' || !own(state.receipts, key)) || state.receiptOrder.length !== Object.keys(state.receipts).length)) throw invalid();
        if (state.submission !== null && (!object(state.submission) || typeof state.submission.submissionId !== 'string' || state.submission.answerVersion !== state.answerVersion || typeof value.contentFingerprint === 'string' && state.submission.contentFingerprint !== value.contentFingerprint)) throw invalid();
        if (!['unanswered', 'drafting', 'submitted-pending', 'graded', 'pending-review', 'ungradable'].includes(state.status) || Boolean(state.submission) !== !['unanswered', 'drafting'].includes(state.status)) throw invalid();
      }
    } catch { this.loaded.delete(file); this.identities.delete(file); throw invalid(); }
    freezeJson(value); this.remember(file, value); this.identities.set(file, observed); return value;
  }
  commit(directory, value) {
    const bytes = measureSave('serialize', () => jsonBytes(value));
    if (bytes.length > STATE_BYTES) throw problem('STATE_SIZE_LIMIT', '作答记录超过 32 MiB，本次未保存，原记录保留。', { details: { limit: STATE_BYTES } }, 413);
    const file = this.file(directory, { atomic: this.write === replaceFile });
    try { measureSave('write', () => this.write(file, bytes)); } catch { throw problem('STATE_WRITE_FAILED', '作答未能保存，请重试；原记录保持不变。', {}, 503); }
    freezeJson(value); this.remember(file, value);
    // A post-write stat could already describe an external replacement rather
    // than these bytes. Confirm identity AND bytes at the next explicit open;
    // normal question reads and writes continue borrowing the committed graph.
    this.identities.delete(file);
  }
  reconcile(snapshot) {
    const old = this.load(snapshot.directory, { refresh: true });
    const exists = this.identities.get(path.join(snapshot.directory, '.qf-v2', 'state.json')) !== null;
    const changed = exists && old.contentFingerprint !== snapshot.contentFingerprint;
    if (changed) {
      this.ink.clear(snapshot);
      this.commit(snapshot.directory, { formatVersion: 2, questions: {}, historyIndex: old.historyIndex, contentFingerprint: snapshot.contentFingerprint, lastQuestionId: null });
    }
    const inkChanged = this.ink.open(snapshot);
    return changed || inkChanged;
  }
  evict(directory) { const file = path.join(directory, '.qf-v2', 'state.json'); this.loaded.delete(file); this.identities.delete(file); this.ink.evict(directory); }
  get(snapshot, id) {
    const root = this.load(snapshot.directory);
    return own(root.questions, id) ? root.questions[id] : freezeJson({ status: 'unanswered', revision: 0, answerVersion: 0, answer: null, draft: null, submission: null, resultRevision: 0, result: null, receipts: {} });
  }
  summary(snapshot, id) {
    const s = this.get(snapshot, id);
    return { questionId: id, status: s.status, revision: s.revision, answerVersion: s.answerVersion, hasSavedAnswer: s.status !== 'unanswered', locked: s.submission !== null, resultRevision: s.resultRevision, score: s.result?.score ?? null, maxScore: snapshot.maxScores.get(id), gradingStatus: s.result?.status ?? null, hasDraft: s.draft !== null, hasInk: this.ink.has(snapshot, id) };
  }
  apply(snapshot, id, op, input) {
    if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
    const root = this.load(snapshot.directory), old = this.get(snapshot, id), key = input.requestId;
    const signature = fingerprint({ op, input }, 'quizforge-v2-receipt');
    // Check the current lock/generation before replay; never resurrect an old lock.
    if (op === 'result' && (!old.submission || !jsonEqual(old.submission, input.submission))) throw problem('SUBMISSION_STALE', '评分不属于当前锁定的答案。', {}, 409);
    if (own(old.receipts, key)) {
      if (old.receipts[key] !== signature) throw problem('REQUEST_CONFLICT', '请求标识已用于不同内容。', {}, 409);
      return old;
    }
    let next;
    if (op !== 'result') {
      if (!integer(input.expectedRevision) || input.expectedRevision !== old.revision) throw problem('REVISION_CONFLICT', '作答记录已变化，请重新打开本题。', {}, 409);
    }
    if (op === 'draft') {
      if (!own(input, 'answer') && !own(input, 'draft')) throw problem('INVALID_REQUEST', '缺少待保存的作答或笔记。', {}, 400);
      if (own(input, 'answer') && old.submission) throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
      const fields = cloneJson(projectJson(input, ['answer', 'draft']));
      next = patchJson(old, fields); next.revision = increment(old.revision);
      if (own(input, 'answer')) {
        if (!jsonEqual(projectJson(old, ['answer']), projectJson(input, ['answer']))) next.answerVersion = increment(old.answerVersion);
        next.status = input.answer === null ? 'unanswered' : 'drafting';
      }
    } else if (op === 'retry') {
      this.ink.remove(snapshot, id);
      next = patchJson(old, { status: 'unanswered', revision: increment(old.revision), answerVersion: increment(old.answerVersion), answer: null, draft: null, submission: null, resultRevision: 0, result: null });
    } else if (op === 'submit') {
      if (old.submission) throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
      if (!own(input, 'answer')) throw problem('INVALID_REQUEST', '缺少待提交的作答。', {}, 400);
      const answerVersion = increment(old.answerVersion);
      next = patchJson(patchJson(old, cloneJson(projectJson(input, ['answer']))), { status: 'submitted-pending', revision: increment(old.revision), answerVersion, result: null, resultRevision: 0,
        submission: { submissionId: this.uuid(), answerVersion, contentFingerprint: snapshot.contentFingerprint } });
    } else if (op === 'result') {
      if (!integer(input.expectedResultRevision) || input.expectedResultRevision !== old.resultRevision) throw problem('RESULT_CONFLICT', '评分结果已变化，请重新读取本题。', {}, 409);
      if (input.source !== 'grader') throw problem('INVALID_RESULT', '当前仅接受题型评分结果。');
      validateResult(snapshot.items.get(id), input.result);
      next = patchJson(old, { status: { graded: 'graded', pending: 'pending-review', ungradable: 'ungradable' }[input.result.status], revision: increment(old.revision), resultRevision: increment(old.resultRevision), result: cloneJson(input.result) });
    } else throw problem('INVALID_REQUEST', '未知的作答操作。', {}, 400);
    const order = op === 'retry' ? [] : [...(old.receiptOrder ?? Object.keys(old.receipts))];
    order.push(key); const receiptOrder = order.slice(-RECEIPT_LIMIT), receipts = {};
    for (const id of receiptOrder) Object.defineProperty(receipts, id, { value: id === key ? signature : old.receipts[id], enumerable: true, configurable: true, writable: true });
    next.receipts = receipts; next.receiptOrder = receiptOrder;
    const questions = shallowCopyJson(root.questions);
    Object.defineProperty(questions, id, { value: next, enumerable: true, configurable: true, writable: true });
    this.commit(snapshot.directory, patchJson(root, { questions, contentFingerprint: snapshot.contentFingerprint, ...(op !== 'result' ? { lastQuestionId: id } : {}) })); return next;
  }
}
export function validateResult(item, result) {
  const fail = () => { throw problem('INVALID_RESULT', '评分格式或分数与本题大纲不符。'); };
  if (!object(result) || !['graded', 'pending', 'ungradable'].includes(result.status)) fail();
  if (own(result, 'feedback') && typeof result.feedback !== 'string' || own(result, 'reason') && typeof result.reason !== 'string') fail();
  const finiteScore = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const max = item.parts ? decimalSum(item.parts.map(part => part.maxScore)) : item.maxScore;
  if (result.status !== 'graded') { if (result.score !== null || own(result, 'outlineScores')) fail(); return; }
  if (!finiteScore(result.score, max)) fail();
  if (item.parts) {
    if (!Array.isArray(result.outlineScores) || result.outlineScores.length !== item.parts.length) fail();
    const seen = new Set();
    for (const score of result.outlineScores) {
      const part = object(score) && item.parts.find(p => p.id === score.id);
      if (!part || seen.has(score.id) || !finiteScore(score.score, part.maxScore)) fail(); seen.add(score.id);
    }
    if (decimalSum(result.outlineScores.map(score => score.score)) !== result.score) fail();
  } else if (own(result, 'outlineScores')) fail();
}
