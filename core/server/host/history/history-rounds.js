import { cloneJson, decimalSum, fingerprint, jsonEqual } from '../platform/json.js';
import { requireHistoryApi, normalizeHistoryApi } from '../extensions/extension-api.js';
import { readOutlineItems, readOutlineConfiguration, validateAnswerState, validateOutlineStates } from '../practice/outline.js';
import { validateDraft } from '../practice/whiteboard.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const invalid = message => { throw new Error(message); };
export const gradingStatus = result => typeof result?.gradingStatus === 'string' ? result.gradingStatus : 'graded';
export function pageKey(id, version, fingerprintValue, typeId = null, referencePath = null) { return fingerprint({ id, version, ...(typeId === null ? {} : { typeId }), ...(referencePath === null ? {} : { path: referencePath }) }, fingerprintValue); }
export function matchesId(record, id) { return record.id === id || record.legacyIds?.includes(id) === true; }
// borrowState is only for StateStore's private immutable-history builders.
// Public/legacy callers keep independent state snapshots by default.
export function summarize(round, { borrowState = false } = {}) {
  const scores = [], maxima = [], states = {}; let submitted = 0, graded = 0, pending = 0;
  for (const { payload } of round.questions) {
    Object.defineProperty(states, payload.question.id, { value: borrowState ? payload.state : cloneJson(payload.state), enumerable: true, writable: true, configurable: true });
    if (payload.state.status !== 'submitted') continue;
    submitted++; maxima.push(payload.state.result.maxScore);
    if (gradingStatus(payload.state.result) === 'pending') pending++;
    else { graded++; scores.push(payload.state.result.score); }
  }
  Object.assign(round, { questionCount: round.questions.length, submittedCount: submitted, gradedCount: graded, pendingCount: pending, score: round.summary?.score ?? decimalSum(scores), maxScore: round.summary?.maxScore ?? decimalSum(maxima) });
  round.collection.states = states;
  if (!round.explicitCompletion && round.status === 'in-progress' && submitted === round.questions.length && pending === 0) round.status = 'completed';
  return round;
}
export function legacyRounds(history = [], kind, collectionId) {
  const rounds = []; let round = null; const ids = new Set();
  for (const record of history) {
    if (round === null || (record.legacyRoundId && record.legacyRoundId !== round.id) || ids.has(record.questionId)) {
      round = { schemaVersion: 2, id: record.id, createdAt: record.createdAt, status: 'legacy', legacy: true, incomplete: true, questionCountKnown: false, collectionTitle: record.collectionTitle, extension: cloneJson(record.extension), page: cloneJson(record.page), questions: [], legacyIds: [], collection: { id: collectionId, kind, title: record.collectionTitle, extension: cloneJson(record.extension), questions: [], states: {} } };
      rounds.push(round); ids.clear();
    }
    ids.add(record.questionId);
    round.questions.push({ payload: cloneJson(record.payload), ...(!jsonEqual(record.page, round.page) ? { page: cloneJson(record.page) } : {}) });
    round.legacyIds.push(record.id); round.collection.questions.push({ id: record.questionId, title: record.questionTitle, type: cloneJson(record.extension) });
    round.updatedAt = record.createdAt; summarize(round);
  }
  return rounds;
}
export function deleteLegacy(state, rounds, deleted) {
  const boundaries = new Map(rounds.filter(round => round !== deleted).flatMap(round => round.legacyIds.map(id => [id, round.id])));
  state.history = state.history.filter(record => boundaries.has(record.id)).map(record => ({ ...cloneJson(record), legacyRoundId: boundaries.get(record.id) }));
}
export function publicRecord(source, summary = false) {
  const value = cloneJson(source);
  for (const field of ['fingerprints', 'extensionFingerprint', 'legacyIds', 'completionVersions']) delete value[field];
  normalizeHistoryApi(value); value.gradedCount ??= value.submittedCount; value.pendingCount ??= 0;
  if (summary) for (const field of ['questions', 'collection', 'page', 'pages']) delete value[field];
  return value;
}
function extensionIdentity(extension) { return `${extension.id}@${extension.version}${extension.typeId === undefined ? '' : ':' + extension.typeId}${extension.path === undefined ? '' : ':' + extension.path}`; }
function sameExtension(left, right) { return left && right && left.id === right.id && left.version === right.version && left.typeId === right.typeId && left.path === right.path; }
function validateExtension(extension) {
  if (!object(extension) || !identifier(extension.id) || !identifier(extension.version) || (Object.hasOwn(extension, 'typeId') && (typeof extension.typeId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(extension.typeId)))) invalid('Invalid frozen extension');
}
export function validatePage(page) {
  if (!object(page)) invalid('Invalid frozen page'); requireHistoryApi(page);
  if (['html', 'script', 'style'].some(field => typeof page[field] !== 'string')) invalid('Invalid frozen page');
}
export function validateResult(result) {
  const status = gradingStatus(result);
  if (!object(result) || !['pending', 'graded'].includes(status) || (Object.hasOwn(result, 'gradingStatus') && typeof result.gradingStatus !== 'string') || !finite(result.maxScore) || result.maxScore < 0) invalid('Invalid grade result');
  if (status === 'pending') { if (result.score !== null || result.correct !== null) invalid('Invalid pending grade result'); }
  else if (!finite(result.score) || typeof result.correct !== 'boolean') invalid('Invalid grade result');
}
function outlineStates(value, submitted) { if (Object.hasOwn(value, 'outlineStates')) validateOutlineStates(value.outlineStates, submitted); if (Object.hasOwn(value, 'answerState')) validateAnswerState(value.answerState); }
function timestamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) invalid('Invalid round timestamp'); }
export function validateRound(record) {
  requireHistoryApi(record); const mixed = Object.hasOwn(record, 'pages');
  if (!object(record) || record.schemaVersion !== 2 || !identifier(record.id) || !['in-progress', 'completed', 'interrupted'].includes(record.status) || typeof record.collectionTitle !== 'string' || !object(record.collection) || (mixed ? record.extension !== null || !object(record.pages) || !Object.keys(record.pages).length || record.collection.extension !== null || !Array.isArray(record.extensions) || !record.extensions.length : !object(record.extension) || !object(record.page)) || !Array.isArray(record.questions) || !record.questions.length || record.questions.length > 10000 || !object(record.fingerprints) || !digest(record.extensionFingerprint)) invalid('Invalid history round');
  timestamp(record.createdAt); timestamp(record.updatedAt);
  if (mixed) {
    const declared = new Set(), identities = new Set();
    for (const extension of record.extensions) { validateExtension(extension); const identity = extensionIdentity(extension); if (declared.has(identity)) invalid('Duplicate frozen extension'); declared.add(identity); }
    for (const [key, page] of Object.entries(record.pages)) {
      validatePage(page); validateExtension(page.extension); const extension = page.extension, identity = extensionIdentity(extension);
      if (!digest(extension.fingerprint) || key !== pageKey(extension.id, extension.version, extension.fingerprint, extension.typeId ?? null, extension.path ?? null) || identities.has(identity) || !declared.has(identity)) invalid('Invalid frozen page identity');
      identities.add(identity);
    }
    if (identities.size !== declared.size || !jsonEqual(record.extensions, record.collection.extensions)) invalid('Frozen extension outline mismatch');
  } else validatePage(record.page);
  const outline = record.collection.questions, usedPages = new Set(), ids = new Set(), scores = [], maxima = []; let submitted = 0, graded = 0, pending = 0;
  if (!Array.isArray(outline) || outline.length !== record.questions.length) invalid('Invalid frozen outline');
  for (let i = 0; i < outline.length; i++) {
    const row = outline[i], entry = record.questions[i], payload = entry?.payload, state = payload?.state, id = payload?.question?.id;
    if (Object.hasOwn(row, 'outlineLabel')) { readOutlineConfiguration({ level: 'question', label: row.outlineLabel }, {}); if (Object.hasOwn(row, 'outlineItems')) invalid('Mutually exclusive frozen outline entries'); }
    if (Object.hasOwn(row, 'outlineItems')) readOutlineItems(row.outlineItems);
    if (Object.hasOwn(entry, 'page')) validatePage(entry.page);
    if (!object(payload) || !identifier(id) || ids.has(id) || id !== row.id || typeof payload.question.title !== 'string' || !Object.hasOwn(payload.question, 'data') || !object(payload.extension) || !object(state) || !['unanswered', 'draft', 'submitted'].includes(state.status) || !Object.hasOwn(state, 'answer') || !Object.hasOwn(state, 'result') || !Object.hasOwn(payload, 'draft') || !digest(record.fingerprints[id])) invalid('Invalid frozen question');
    ids.add(id);
    if (mixed || Object.hasOwn(entry, 'pageKey')) {
      validateExtension(payload.extension); const page = record.pages?.[entry.pageKey];
      if (!digest(entry.pageKey) || !object(page) || !sameExtension(payload.extension, page.extension) || !sameExtension(payload.extension, row.type) || Object.hasOwn(entry, 'page')) invalid('Invalid frozen question page reference'); usedPages.add(entry.pageKey);
    }
    if (payload.draft !== null) validateDraft(payload.draft); outlineStates(state, state.status === 'submitted');
    if (state.status === 'submitted') { validateResult(state.result); submitted++; maxima.push(state.result.maxScore); if (gradingStatus(state.result) === 'pending') pending++; else { graded++; scores.push(state.result.score); } }
    else if (state.result !== null) invalid('Unsubmitted question has a result');
    if (!jsonEqual(state, record.collection.states?.[id])) invalid('Frozen outline state mismatch');
  }
  if (mixed && usedPages.size !== Object.keys(record.pages).length) invalid('Unused frozen page');
  let score = decimalSum(scores), maxScore = decimalSum(maxima);
  if (Object.hasOwn(record, 'summary')) {
    const summary = record.summary;
    if (!object(summary) || !Array.isArray(summary.questions) || summary.questions.length !== outline.length || summary.questionCount !== outline.length || summary.submittedCount !== submitted || pending > 0 || (Object.hasOwn(summary, 'pendingCount') && summary.pendingCount !== 0) || (Object.hasOwn(summary, 'gradedCount') && summary.gradedCount !== graded) || summary.roundId !== record.id || summary.finished !== true || record.status !== 'completed') invalid('Invalid frozen score summary');
    timestamp(record.finishedAt); const summaryScores = [], summaryMaxima = [];
    for (let i = 0; i < outline.length; i++) {
      const row = summary.questions[i], answered = record.questions[i].payload.state.status === 'submitted'; outlineStates(row, answered);
      if (row.id !== outline[i].id || !finite(row.score) || !finite(row.maxScore) || row.maxScore < 0 || typeof row.submitted !== 'boolean' || row.submitted !== answered || (Object.hasOwn(row, 'status') && row.status !== record.questions[i].payload.state.status) || (Object.hasOwn(row, 'gradingStatus') && row.gradingStatus !== (answered ? 'graded' : 'unsubmitted')) || (!answered && row.score !== 0)) invalid('Invalid frozen question score');
      summaryScores.push(row.score); summaryMaxima.push(row.maxScore);
    }
    score = decimalSum(summaryScores); maxScore = decimalSum(summaryMaxima);
    if (summary.score !== score || summary.maxScore !== maxScore) invalid('Invalid frozen summary totals');
  }
  if (record.questionCount !== outline.length || record.submittedCount !== submitted || (Object.hasOwn(record, 'gradedCount') && record.gradedCount !== graded) || (Object.hasOwn(record, 'pendingCount') && record.pendingCount !== pending) || (record.status === 'completed' && pending > 0) || record.score !== score || record.maxScore !== maxScore || (record.explicitCompletion ? record.status === 'completed' && !Object.hasOwn(record, 'summary') : (record.status === 'completed') !== (submitted === outline.length && pending === 0))) invalid('Invalid round totals');
}
