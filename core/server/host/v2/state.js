import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readBytes, replaceFile } from '../platform/files.js';
import { cloneJson, shallowCopyJson, freezeJson, fingerprint, parseJson, jsonBytes, jsonEqual, decimalSum } from '../platform/json.js';
import { object, problem } from './errors.js';

// Owner-approved limit. V2 never reads the v1 settings or state directories.
export const STATE_BYTES = 32 * 1024 * 1024;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const own = (value, key) => Object.hasOwn(value, key);
const invalid = () => problem('STATE_INVALID', '作答记录无法读取，原文件已保留。', {}, 503);
export class PracticeState {
  constructor(root, { write = replaceFile, uuid = randomUUID } = {}) { this.root = root; this.write = write; this.uuid = uuid; this.loaded = new Map(); }
  file(id) { return path.join(this.root, '.qf-v2', 'state', id + '.json'); }
  load(id) {
    if (this.loaded.has(id)) return this.loaded.get(id);
    let value;
    try {
      const bytes = readBytes(this.file(id), STATE_BYTES, true);
      // The persisted questions/id envelope is deeper than the HTTP envelope.
      value = bytes ? parseJson(bytes, { maxDepth: 68 }) : { formatVersion: 2, bankId: id, questions: {}, historyIndex: [] };
      if (!object(value) || value.formatVersion !== 2 || value.bankId !== id || !object(value.questions) || !Array.isArray(value.historyIndex)) throw invalid();
      for (const state of Object.values(value.questions)) {
        if (!object(state) || typeof state.fingerprint !== 'string' || !integer(state.revision) || !integer(state.answerVersion) || !integer(state.resultRevision) || !object(state.receipts)) throw invalid();
        if (state.submission !== null && (!object(state.submission) || typeof state.submission.submissionId !== 'string' || state.submission.answerVersion !== state.answerVersion || state.submission.questionFingerprint !== state.fingerprint)) throw invalid();
        if (!['unanswered', 'drafting', 'submitted-pending', 'graded', 'pending-review', 'ungradable'].includes(state.status) || Boolean(state.submission) !== !['unanswered', 'drafting'].includes(state.status)) throw invalid();
      }
    } catch { throw invalid(); }
    freezeJson(value); this.loaded.set(id, value); return value;
  }
  commit(id, value) {
    const bytes = jsonBytes(value);
    if (bytes.length > STATE_BYTES) throw problem('STATE_SIZE_LIMIT', '作答记录超过 32 MiB，本次未保存，原记录保留。', { details: { limit: STATE_BYTES } }, 413);
    try { this.write(this.file(id), bytes); } catch { throw problem('STATE_WRITE_FAILED', '作答未能保存，请重试；原记录保持不变。', {}, 503); }
    freezeJson(value); this.loaded.set(id, value);
  }
  reconcile(snapshot) {
    const old = this.load(snapshot.bankId), questions = shallowCopyJson(old.questions);
    let changed = false;
    for (const [id, state] of Object.entries(questions)) if (snapshot.questionFingerprints.get(id) !== state.fingerprint) { delete questions[id]; changed = true; }
    if (changed) this.commit(snapshot.bankId, { ...old, questions });
  }
  get(snapshot, id) {
    const root = this.load(snapshot.bankId);
    return own(root.questions, id) ? root.questions[id] : freezeJson({ fingerprint: snapshot.questionFingerprints.get(id), status: 'unanswered', revision: 0, answerVersion: 0, answer: null, draft: null, ink: null, submission: null, resultRevision: 0, result: null, receipts: {} });
  }
  summary(snapshot, id) {
    const s = this.get(snapshot, id);
    return { questionId: id, status: s.status, revision: s.revision, answerVersion: s.answerVersion, hasSavedAnswer: s.answerVersion > 0, locked: s.submission !== null, resultRevision: s.resultRevision, score: s.result?.score ?? null, maxScore: snapshot.maxScores.get(id), gradingStatus: s.result?.status ?? null, hasDraft: s.draft !== null, hasInk: s.ink !== null };
  }
  apply(snapshot, id, op, input) {
    if (!object(input) || typeof input.requestId !== 'string' || !input.requestId.trim()) throw problem('INVALID_REQUEST', '请求标识无效。', {}, 400);
    const root = this.load(snapshot.bankId), old = this.get(snapshot, id), key = input.requestId;
    const signature = fingerprint({ op, input }, 'quizforge-v2-receipt');
    // Check the current lock/generation before replay; never resurrect an old lock.
    if (op === 'result' && (!old.submission || !jsonEqual(old.submission, input.submission))) throw problem('SUBMISSION_STALE', '评分不属于当前锁定的答案。', {}, 409);
    if (own(old.receipts, key)) {
      if (old.receipts[key] !== signature) throw problem('REQUEST_CONFLICT', '请求标识已用于不同内容。', {}, 409);
      return old;
    }
    let next;
    if (op === 'submit') {
      if (!integer(input.expectedRevision) || input.expectedRevision !== old.revision) throw problem('REVISION_CONFLICT', '作答记录已变化，请重新打开本题。', {}, 409);
      if (old.submission) throw problem('ANSWER_LOCKED', '答案已经提交，不能修改。', {}, 409);
      if (!own(input, 'answer')) throw problem('INVALID_REQUEST', '缺少待提交的作答。', {}, 400);
      const answerVersion = old.answerVersion + 1;
      next = { ...old, status: 'submitted-pending', revision: old.revision + 1, answerVersion, answer: cloneJson(input.answer), result: null, resultRevision: 0,
        submission: { submissionId: this.uuid(), answerVersion, questionFingerprint: old.fingerprint } };
    } else {
      if (!integer(input.expectedResultRevision) || input.expectedResultRevision !== old.resultRevision) throw problem('RESULT_CONFLICT', '评分结果已变化，请重新读取本题。', {}, 409);
      if (input.source !== 'grader') throw problem('INVALID_RESULT', '当前仅接受题型评分结果。');
      validateResult(snapshot.items.get(id), input.result);
      next = { ...old, status: { graded: 'graded', pending: 'pending-review', ungradable: 'ungradable' }[input.result.status], revision: old.revision + 1, resultRevision: old.resultRevision + 1, result: cloneJson(input.result) };
    }
    const receipts = shallowCopyJson(old.receipts);
    Object.defineProperty(receipts, key, { value: signature, enumerable: true, configurable: true, writable: true }); next.receipts = receipts;
    const questions = shallowCopyJson(root.questions);
    Object.defineProperty(questions, id, { value: next, enumerable: true, configurable: true, writable: true });
    this.commit(snapshot.bankId, { ...root, questions }); return next;
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
