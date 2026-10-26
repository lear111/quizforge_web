import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { ApiError, bad, id, text, requireObject } from '../platform/errors.js';
import { cloneJson, decimalSum, fingerprint, hash, integralField, jsonBytes, jsonEqual, stringifyJson } from '../platform/json.js';
import { exists, readJson, replaceFile, safeDirectory } from '../platform/files.js';
import { EditJournal } from '../editor/edit-journal.js';
import { SerialTransactions } from '../platform/transactions.js';
import { attachOutline, runRuleBatches, validateAnswerState, validateOutlineStates, visibleOutlineStates } from './outline.js';
import { declareApi, requireHistoryApi } from '../extensions/extension-api.js';
import { snapshotPage } from '../extensions/extension-packages.js';
import { catalogRevision } from '../library/collections.js';
import { gradingStatus, legacyRounds, matchesId, publicRecord, pageKey, summarize, validatePage, validateResult, validateRound, deleteLegacy } from '../history/history-rounds.js';
import { validateDraft } from './whiteboard.js';
import { prepareAnswerAreasWithImages as prepareAnswerAreas, draftWithoutAnswerInk } from './answer-areas.js';
import { publicListening } from '../resources/listening.js';
import { ResourceStore } from '../resources/resources.js';
import { decorateReview, normalizeInput, targetId, validTargetId, validateInput } from '../ai/ai-protocol.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ownSet = (object, name, value) => Object.defineProperty(object, name, { value, enumerable: true, configurable: true, writable: true });
const increment = value => { if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) throw new ApiError(409, 'REVISION_LIMIT', 'Question revision limit reached; previous data is preserved'); return value + 1; };
export const extensionMetadata = extension => ({ id: extension.id, version: extension.version, name: extension.name, ...(extension.referencePath ? { path: extension.referencePath, pageId: extension.pageId ?? extension.id } : {}), ...(extension.development ? { development: cloneJson(extension.development) } : {}) });
function collectionMetadata(collection) { return { features: collection.features.json(), ...(collection.kind.startsWith('development') && collection.extension ? { development: cloneJson(collection.extension.development) } : {}), extension: collection.extension ? extensionMetadata(collection.extension) : null, extensions: collection.extensions.map(extensionMetadata) }; }
export const publicState = state => cloneJson({ status: state.status, revision: state.revision, answer: state.answer, result: state.result, ...(state.status !== 'submitted' && state.answerState ? {answerState: state.answerState} : {}) });
export function questionState(persisted, collection, question) { return Object.hasOwn(persisted.questions, question.id) ? persisted.questions[question.id] : { status: 'unanswered', revision: 0, fingerprint: question.fingerprint, answer: null, result: null, draft: null, receipts: [] }; }
export function unsubmittedState(state) { const value = cloneJson(state); if (state.status === 'submitted') delete value.answerState; value.status = value.answer === null ? 'unanswered' : 'draft'; value.result = null; delete value.outlineStates; return value; }
export function activeRound(persisted) { const last = persisted.historyRounds?.at(-1); return last?.status === 'in-progress' ? last : null; }
export function interruptRound(persisted, reason) { const active = activeRound(persisted); if (active) Object.assign(active, { status: 'interrupted', interruptionReason: reason, closedAt: new Date().toISOString() }); }
export function roundCompatible(round, collection) { return (round.extensionFingerprint === collection.extensionFingerprint && round.questions.length === collection.questions.length && collection.questions.every((question, index) => round.questions[index].payload.question.id === question.id && round.fingerprints[question.id] === question.fingerprint)) || !!collection.legacyCollection && roundCompatible(round, collection.legacyCollection); }
const manualResult = state => ['pending', 'graded'].includes(state.result?.gradingStatus);
function historyFailure(error) { return ['INVALID_HISTORY_API', 'UNSUPPORTED_HISTORY_API'].includes(error.code); }
function validateLegacy(record) {
  requireHistoryApi(record);
  if (!object(record) || typeof record.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(record.id) || ['createdAt', 'questionId', 'questionTitle', 'collectionTitle'].some(key => typeof record[key] !== 'string') || !object(record.extension) || typeof record.score !== 'number' || typeof record.maxScore !== 'number' || typeof record.correct !== 'boolean' || !object(record.payload) || record.payload.state?.status !== 'submitted' || !Number.isFinite(Date.parse(record.createdAt)) || (Object.hasOwn(record, 'legacyRoundId') && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(record.legacyRoundId))) throw new Error('Invalid history snapshot');
  validatePage(record.page);
}
export function validateStoredState(state) {
  if (Object.hasOwn(state, 'answerState')) validateAnswerState(state.answerState);
  if (!object(state) || !['unanswered', 'draft', 'submitted'].includes(state.status) || !integralField(state, 'revision') || state.revision < 0 || ['answer', 'result', 'draft'].some(key => !Object.hasOwn(state, key)) || !Array.isArray(state.receipts) || state.receipts.length > 32) throw new Error('Invalid state');
  if (state.draft !== null) validateDraft(state.draft);
  for (const key of ['submissionGeneration', 'gradingGeneration']) if (Object.hasOwn(state, key) && (!integralField(state, key) || state[key] < 0)) throw new Error('Invalid grading generation');
  if (Object.hasOwn(state, 'aiTaskId') && state.aiTaskId !== null && !digest(state.aiTaskId)) throw new Error('Invalid AI task ID');
  for (const key of ['aiTaskIds', 'aiTargetGenerations']) if (Object.hasOwn(state, key)) {
    if (!object(state[key]) || Object.keys(state[key]).length > 256) throw new Error('Invalid AI targets');
    for (const [target, value] of Object.entries(state[key])) if (!validTargetId(target) || (key === 'aiTaskIds' ? !digest(value) : !integralField(state[key], target) || value < 0)) throw new Error('Invalid AI target entry');
  }
  if (state.status === 'submitted') validateResult(state.result); else if (state.result !== null) throw new Error('Unsubmitted question has a result');
  for (const receipt of state.receipts) if (typeof receipt?.id !== 'string' || !object(receipt.request) || !object(receipt.response)) throw new Error('Invalid receipt');
}
function validateSaved(saved, key = null) {
  if (!object(saved) || saved.schemaVersion !== 1 || typeof saved.collection !== 'string' || (key !== null && saved.collection !== key) || !object(saved.questions)) throw new Error('Invalid state');
  for (const state of Object.values(saved.questions)) validateStoredState(state);
  for (const [field, validate] of [['history', validateLegacy], ['historyRounds', validateRound]]) if (Object.hasOwn(saved, field)) { if (!Array.isArray(saved[field])) throw new Error('Invalid history'); for (const record of saved[field]) validate(record); }
  if (saved.upgradedCompletion) { validateRound(saved.upgradedCompletion); if (!object(saved.upgradedCompletion.completionVersions) || saved.upgradedCompletion.status !== 'completed') throw new Error('Invalid upgraded completion'); }
  for (const field of ['editReceipts', 'finishReceipts', 'restartReceipts']) if (Object.hasOwn(saved, field)) {
    if (!Array.isArray(saved[field]) || saved[field].length > 32 || saved[field].some(receipt => typeof receipt?.id !== 'string' || !object(receipt.request) || !object(receipt.response) || field === 'editReceipts' && typeof receipt.questionId !== 'string')) throw new Error('Invalid receipts');
  }
}
function receiptResult(receipts, request, questionId = null) {
  const existing = receipts?.find(receipt => receipt.id === request.requestId); if (!existing) return null;
  if (!jsonEqual(existing.request, request) || questionId !== null && existing.questionId !== questionId) throw new ApiError(409, 'REQUEST_ID_REUSED', 'Request ID was already used with different data');
  return cloneJson(existing.response);
}
function requestId(request) { requireObject(request, 'Request must be an object'); const value = id(request, 'requestId'); if (value.length < 8) throw bad('requestId must have at least 8 characters'); return value; }
function retainReceipts(receipts, limitBytes = false) { while (receipts.length > 32 || limitBytes && receipts.length > 1 && jsonBytes(receipts).length > 16 * 1024 * 1024) receipts.shift(); }

export class StateStore {
  constructor(root, rules, { stateRoot = root, memoryOnly = false, resources = null } = {}) {
    this.root = root; this.directory = path.join(stateRoot, '.state'); this.rules = rules; this.memoryOnly = memoryOnly;
    this.resources=resources??new ResourceStore(root,{memory:memoryOnly});
    this.edits = new EditJournal(root, stateRoot); this.cache = new Map(); this.cachedBytes = 0; this.aiSupport = new Map(); this.outlineCache = new Map(); this.outlineCachedBytes = 0; this.stampKey = randomBytes(32); this.transactions = new SerialTransactions();
    if (!memoryOnly) safeDirectory(this.directory, true);
    for (const name of ['overview', 'stamp', 'question', 'summary', 'submitSaved', 'completionResult', 'saveCompletionResult', 'finish', 'restart', 'editor', 'edit', 'history', 'deleteHistory', 'act', 'prepareAiGrading', 'prepareAutomaticAiGrading', 'bindAiTask', 'aiCurrent', 'confirmAi', 'confirmedAiReceipt', 'currentAiTaskId', 'currentAiTaskIds']) {
      const method = this[name]; if (method) this[name] = (...args) => this.transactions.run(() => method.apply(this, args));
    }
  }
  static memory(root, rules, resources = null) { return new StateStore(root, rules, { memoryOnly: true, resources }); }
  temporary(collection) { return this.memoryOnly || !collection.features.history; }
  memoryBytes() { return this.cachedBytes + this.outlineCachedBytes; }
  clearMemory() { this.cache.clear(); this.cachedBytes = 0; this.outlineCache.clear(); this.outlineCachedBytes = 0; }
  file(collection) { return path.join(this.directory, hash(Buffer.from(typeof collection === 'string' ? collection : collection.stateKey())) + '.json'); }
  recoverEdits() {
    if (this.memoryOnly) return;
    try { if (this.edits.recover()) this.clearMemory(); } catch (error) { throw new ApiError(503, 'EDIT_RECOVERY_REQUIRED', 'Pending edit cannot be recovered safely; preserve the bank and state directories for recovery', { cause: error }); }
  }
  recover() { this.recoverEdits(); }
  load(collection) {
    if (!this.memoryOnly && !collection.features.history) throw new ApiError(409, 'PRACTICE_SESSION_REQUIRED', 'Temporary practice requires the current page session');
    this.recoverEdits(); const key = collection.stateKey(), cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); const value = this.adaptDevelopmentState(cached.value, collection); this.verifyCompatibility(value, collection); return value; }
    try {
      const fresh = { schemaVersion: 1, collection: key, extensionFingerprint: collection.extensionFingerprint, questions: {} }, file = this.file(collection);
      let value = this.memoryOnly || !exists(file) ? fresh : readJson(file, 32 * 1024 * 1024);
      if (!this.memoryOnly && !exists(file) && collection.legacyCollection) {
        const legacy = collection.legacyCollection, currentFile = this.file(legacy), oldFile = exists(currentFile) ? currentFile : path.join(this.root, '.development', '.state', hash(Buffer.from(legacy.stateKey())) + '.json');
        if (exists(oldFile)) {
          const old = readJson(oldFile, 32 * 1024 * 1024); validateSaved(old, legacy.stateKey());
          // Preserve the original file and frozen history; migrate only current
          // identities whose old content signature still matches.
          value = cloneJson(old); value.collection = key; value.extensionFingerprint = collection.extensionFingerprint;
          for (const question of collection.questions) {
            const saved = value.questions[question.id], previous = legacy.question(question.id);
            if (saved && saved.fingerprint === previous.fingerprint) saved.fingerprint = question.fingerprint;
          }
          replaceFile(oldFile + '.pre-unified.bak', jsonBytes(old));
          this.persist(collection, value);
        }
      }
      validateSaved(value, key); value = this.adaptDevelopmentState(value, collection); this.verifyCompatibility(value, collection); this.remember(key, value, jsonBytes(value).length); return value;
    } catch (error) { if (['COLLECTION_CHANGED', 'PRACTICE_SESSION_LIMIT'].includes(error.code) || historyFailure(error)) throw error; throw new ApiError(503, 'STATE_UNAVAILABLE', 'Saved state cannot be read; preserve the state directory for recovery', { cause: error }); }
  }
  verifyCompatibility(state, collection) {
    if (!Object.keys(state.questions).length) return;
    const changed = message => { throw new ApiError(409, 'COLLECTION_CHANGED', message); };
    if (!digest(state.extensionFingerprint)) changed('已保存练习来自不含内容签名的旧版，无法确认与当前题库一致。原数据仍保留，请为题库使用新的 ID 后重新打开。');
    if (state.extensionFingerprint !== collection.extensionFingerprint) changed('同一版本的题型拓展内容已更改，原练习数据仍保留。请为修改后的拓展使用新的版本号后重新打开。');
    for (const question of collection.questions) if (Object.hasOwn(state.questions, question.id) && state.questions[question.id].fingerprint !== question.fingerprint) changed('题库中已有练习的题目内容已更改，原练习数据仍保留。请为修改后的题库使用新的 ID 后重新打开。');
  }
  adaptDevelopmentState(state, collection) {
    if (collection.kind === 'exam') return state; let copy = null;
    for (const question of collection.questions) if (Object.hasOwn(state.questions, question.id) && state.questions[question.id].fingerprint !== question.fingerprint) { copy ??= cloneJson(state); delete copy.questions[question.id]; }
    if (!copy && state.extensionFingerprint === collection.extensionFingerprint) return state;
    // A source edit invalidates affected current answers, never frozen history.
    if (!this.memoryOnly && exists(this.file(collection))) {
      const bytes = jsonBytes(state), first = this.file(collection) + '.before-content-edit.bak';
      replaceFile(exists(first) ? this.file(collection) + '.before-content-edit-' + hash(bytes) + '.bak' : first, bytes);
    }
    copy ??= cloneJson(state); interruptRound(copy, 'content-edited'); for (const key of ['finishReceipts', 'restartReceipts', 'editReceipts', 'completionIntent', 'completionReceipts']) delete copy[key]; copy.extensionFingerprint = collection.extensionFingerprint;
    const bytes = this.persist(collection, copy); this.remember(collection.stateKey(), copy, bytes); return copy;
  }
  checkMemory(key, bytes) {
    if (this.cachedBytes + bytes - (this.cache.get(key)?.bytes ?? 0) > 32 * 1024 * 1024 || !this.cache.has(key) && this.cache.size >= 32) throw new ApiError(429, 'PRACTICE_SESSION_LIMIT', 'This page session reached its temporary practice limit');
  }
  remember(key, value, bytes) {
    if (this.memoryOnly) this.checkMemory(key, bytes);
    this.cachedBytes += bytes - (this.cache.get(key)?.bytes ?? 0); this.cache.delete(key); this.cache.set(key, { value, bytes });
    if (!this.memoryOnly) while (this.cache.size > 8 || this.cachedBytes > 64 * 1024 * 1024) { const oldest = this.cache.keys().next().value; this.cachedBytes -= this.cache.get(oldest).bytes; this.cache.delete(oldest); }
  }
  stateBytes(value) { const bytes = jsonBytes(value); if (bytes.length > 32 * 1024 * 1024) throw new ApiError(413, 'STATE_SIZE_LIMIT', 'Collection state and retained history exceed the size limit; previous data is preserved'); return bytes; }
  persist(collection, value) {
    const bytes = this.stateBytes(value);
    if (this.memoryOnly) this.checkMemory(typeof collection === 'string' ? collection : collection.stateKey(), bytes.length);
    else try { replaceFile(typeof collection === 'string' ? collection : this.file(collection), bytes); } catch (error) { throw new ApiError(503, 'STATE_WRITE_FAILED', 'Could not persist practice state', { cause: error }); }
    return bytes.length;
  }
  commit(collection, value) { const bytes = this.persist(collection, value); this.remember(collection.stateKey(), value, bytes); }
  opaqueVersion(...fields) {
    const mac = createHmac('sha256', this.stampKey);
    for (const field of fields) { const bytes = Buffer.from(field ?? ''), size = Buffer.alloc(4); size.writeUInt32BE(bytes.length); mac.update(size).update(bytes); } return mac.digest('hex');
  }
  stampValue(collection, question, state) { const extension = collection.extensionFor(question); return { revision: state.revision, contentVersion: this.opaqueVersion('question', collection.stateKey(), question.id, question.title, question.fingerprint), packageVersion: this.opaqueVersion('package', extension.id, extension.version, extension.fingerprint, extension.providerRevision, extension.referencePath ?? '') }; }
  async stamp(collection, question) { return this.stampValue(collection, question, questionState(this.load(collection), collection, question)); }
  outlineVersion(collection, question, state) { const visible = publicState(state); delete visible.revision; return fingerprint(visible, question.fingerprint + ':' + collection.extensionFor(question).fingerprint); }
  cacheOutline(collection, question, state, score) {
    const items = score.outlineStates; if (items !== undefined) validateOutlineStates(items, state.status === 'submitted'); if (!question.outlineItems.length) return;
    const key = collection.stateKey() + '\0' + question.id, bytes = items === undefined ? 0 : jsonBytes(items).length;
    this.outlineCachedBytes += bytes - (this.outlineCache.get(key)?.bytes ?? 0); this.outlineCache.delete(key); this.outlineCache.set(key, { version: this.outlineVersion(collection, question, state), items: items === undefined ? null : cloneJson(items), bytes });
    while (this.outlineCache.size > 512 || this.outlineCachedBytes > 2 * 1024 * 1024) { const oldest = this.outlineCache.keys().next().value; this.outlineCachedBytes -= this.outlineCache.get(oldest).bytes; this.outlineCache.delete(oldest); }
  }
  async publicStates(collection, questions, states) {
    const result = states.map(publicState), missing = [], inputs = [], indexes = [];
    for (let i = 0; i < questions.length; i++) {
      const question = questions[i], state = states[i];
      if (state.status !== 'submitted' && collection.extensionFor(question).answerStateDeclared) {
        if (state.answerState) { validateAnswerState(state.answerState, question); result[i].outlineStates = cloneJson(state.answerState.outlineStates); }
        continue;
      }
      if (!question.outlineItems.length) continue;
      const cached = this.outlineCache.get(collection.stateKey() + '\0' + question.id);
      if (cached?.version === this.outlineVersion(collection, question, state)) { if (cached.items !== null) result[i].outlineStates = visibleOutlineStates(cached.items, question, state.status === 'submitted'); }
      else { missing.push(question); indexes.push(i); inputs.push({ data: question.data, state: publicState(state) }); }
    }
    if (missing.length) {
      let scores;
      try { scores = await runRuleBatches(this.rules, missing, 'scoreBatch', 'scores', inputs); }
      catch (error) { if (collection.kind.startsWith('development') && error.code === 'DEVELOPMENT_NOT_IMPLEMENTED') return result; throw error; }
      for (let i = 0; i < missing.length; i++) { const index = indexes[i]; this.cacheOutline(collection, missing[i], states[index], scores[i]); if (scores[i].outlineStates !== undefined) result[index].outlineStates = visibleOutlineStates(scores[i].outlineStates, missing[i], states[index].status === 'submitted'); }
    }
    return result;
  }
  async overviewValue(collection, persisted) {
    const states = await this.publicStates(collection, collection.questions, collection.questions.map(question => questionState(persisted, collection, question)));
    return { id: collection.id, title: collection.title, kind: collection.kind, revision: catalogRevision(collection), ...collectionMetadata(collection), ...publicListening(collection), questions: collection.questions.map(question => attachOutline({ id: question.id, title: question.title, ...(question.listening ? { listening: cloneJson(question.listening) } : {}), type: extensionMetadata(collection.extensionFor(question)) }, question)), states: Object.fromEntries(collection.questions.map((question, index) => [question.id, states[index]])) };
  }
  overview(collection) { return this.overviewValue(collection, this.load(collection)); }
  rememberAiSupport(extension, evaluated) { if (typeof evaluated?.capabilities?.canAiGrade !== 'boolean') return; this.aiSupport.set(extension.fingerprint, evaluated.capabilities.canAiGrade); while (this.aiSupport.size > 32) this.aiSupport.delete(this.aiSupport.keys().next().value); }
  async supportsAi(extension) { if (!this.aiSupport.has(extension.fingerprint)) this.rememberAiSupport(extension, { capabilities: { canAiGrade: (await this.rules.run(extension, { op: 'capabilities' })).canAiGrade === true } }); return this.aiSupport.get(extension.fingerprint); }
  reviewAvailable(collection, question, state, persisted) {
    const active = activeRound(persisted); if (state.status !== 'submitted' || !active || !roundCompatible(active, collection)) return false;
    const frozen = active.questions.find(entry => entry.payload.question.id === question.id)?.payload.state; return frozen?.status === 'submitted' && jsonEqual(frozen.answer, state.answer);
  }
  async reviewCapabilities(collection, question, state, persisted) { const allowed = manualResult(state) && this.reviewAvailable(collection, question, state, persisted); return { canReview: allowed, canAiGrade: allowed && await this.supportsAi(collection.extensionFor(question)) }; }
  async response(collection, question, state, projected = undefined, visibleState = undefined) {
    if (projected === undefined || projected === null) { const evaluated = await this.rules.run(collection.extensionFor(question), { op: 'project', withCapabilities: true, data: question.data, state: { submitted: state.status === 'submitted', result: state.result } }); this.rememberAiSupport(collection.extensionFor(question), evaluated); projected = evaluated.projected; }
    const persisted = this.cache.get(collection.stateKey())?.value;
    return { features: collection.features.json(), question: { id: question.id, title: question.title, data: projected }, state: visibleState ?? (await this.publicStates(collection, [question], [state]))[0], draft: cloneJson(state.draft), stamp: this.stampValue(collection, question, state), capabilities: persisted ? await this.reviewCapabilities(collection, question, state, persisted) : { canReview: false, canAiGrade: false }, aiTask: typeof state.aiTaskId === 'string' ? { taskId: state.aiTaskId } : null, ...(object(state.aiTaskIds) ? { aiTasks: cloneJson(state.aiTaskIds) } : {}), extension: extensionMetadata(collection.extensionFor(question)) };
  }
  question(collection, question) { return this.response(collection, question, questionState(this.load(collection), collection, question)); }
  historyEntry(collection, question) { const extension = collection.extensionFor(question); return collection.extension ? {} : { pageKey: pageKey(extension.id, extension.version, extension.fingerprint, null, extension.referencePath ?? null) }; }
  freezePages(round, collection) {
    declareApi(round); Object.assign(round, collectionMetadata(collection));
    try {
      if (collection.extension) round.page = snapshotPage(collection.extension);
      else round.pages = Object.fromEntries(collection.extensions.map(extension => [pageKey(extension.id, extension.version, extension.fingerprint, null, extension.referencePath ?? null), { ...snapshotPage(extension), extension: { ...extensionMetadata(extension), fingerprint: extension.fingerprint } }]));
    } catch (error) { throw new ApiError(422, 'INVALID_EXTENSION', 'Practice page cannot be frozen for history; submission was not saved', { cause: error }); }
  }
  async freezeRound(collection, persisted, states) {
    const now = new Date().toISOString(), round = { schemaVersion: 2, id: randomUUID(), createdAt: now, updatedAt: now, status: 'in-progress', explicitCompletion: true, legacy: false, incomplete: false, questionCountKnown: true, collectionTitle: collection.title, extensionFingerprint: collection.extensionFingerprint, fingerprints: Object.fromEntries(collection.questions.map(question => [question.id, question.fingerprint])), questions: [] };
    this.freezePages(round, collection); round.collection = await this.overviewValue(collection, persisted);
    const projected = await runRuleBatches(this.rules, collection.questions, 'projectBatch', 'projected', collection.questions.map((question, index) => ({ data: question.data, state: { submitted: states[index].status === 'submitted', result: states[index].result } })));
    const visible = await this.publicStates(collection, collection.questions, states);
    for (let i = 0; i < collection.questions.length; i++) round.questions.push({ ...this.historyEntry(collection, collection.questions[i]), payload: await this.response(collection, collection.questions[i], states[i], projected[i], visible[i]) });
    return summarize(round);
  }
  async unsubmittedHistoryStates(collection, persisted, round, skip = null) {
    const questions = round.questions.filter(entry => entry.payload.question.id !== skip && entry.payload.state.status !== 'submitted').map(entry => collection.question(entry.payload.question.id));
    const states = await this.publicStates(collection, questions, questions.map(question => unsubmittedState(questionState(persisted, collection, question)))); return Object.fromEntries(questions.map((question, index) => [question.id, states[index]]));
  }
  async recordSubmission(collection, question, persisted, submitted) {
    let active = activeRound(persisted); if (active && !roundCompatible(active, collection)) { interruptRound(persisted, 'collection-changed'); active = null; }
    if (!active) {
      const states = collection.questions.map(item => unsubmittedState(questionState(persisted, collection, item)));
      active = await this.freezeRound(collection, persisted, states); active.collection.states = {};
      const entry = active.questions.find(entry => entry.payload.question.id === question.id); entry.payload = cloneJson(submitted); (persisted.historyRounds ??= []).push(active);
    } else {
      const visible = await this.unsubmittedHistoryStates(collection, persisted, active, question.id);
      for (const entry of active.questions) {
        const old = entry.payload, id = old.question.id;
        if (id === question.id) { entry.payload = cloneJson(submitted); entry.payload.question.title = old.question.title; }
        else if (old.state.status !== 'submitted') { old.state = visible[id]; old.draft = cloneJson(questionState(persisted, collection, collection.question(id)).draft); }
      }
      active.updatedAt = new Date().toISOString();
    }
    active.explicitCompletion = true; summarize(active);
  }
  recordReview(collection, question, persisted, reviewed) {
    const active = activeRound(persisted), entry = active.questions.find(entry => entry.payload.question.id === question.id), title = entry.payload.question.title;
    entry.payload = cloneJson(reviewed); entry.payload.question.title = title; active.updatedAt = new Date().toISOString(); summarize(active);
  }
  summaryRound(persisted, collection) {
    const active = activeRound(persisted); if (active) return roundCompatible(active, collection) ? active : null;
    const last = persisted.upgradedCompletion ?? persisted.historyRounds?.at(-1);
    if (!last || last.status !== 'completed' || !roundCompatible(last, collection)) return null;
    for (let i = 0; i < collection.questions.length; i++) {
      const question = collection.questions[i], current = questionState(persisted, collection, question), payload = last.questions[i].payload;
      if (object(last.completionVersions)) { if (last.completionVersions[question.id] !== current.revision) return null; }
      else if (payload.state.revision !== current.revision || payload.state.status !== current.status || !jsonEqual(payload.state.answer, current.answer) || !jsonEqual(payload.state.result, current.result) || !jsonEqual(payload.draft, current.draft)) return null;
    }
    return last;
  }
  summaryStates(persisted, collection, round) {
    const noHistory = !round && !persisted.historyRounds?.length && !persisted.history?.length;
    return collection.questions.map((question, index) => { const current = questionState(persisted, collection, question), frozen = round?.questions[index].payload.state; return frozen?.status === 'submitted' ? cloneJson(frozen) : noHistory ? cloneJson(current) : unsubmittedState(current); });
  }
  summaryVersion(collection, persisted, summary) {
    const versions = collection.extensionFingerprint + collection.questions.map(question => `:${question.id}:${question.title}:${question.fingerprint}:${questionState(persisted, collection, question).revision}`).join('');
    return this.opaqueVersion('summary', collection.stateKey(), versions, stringifyJson(summary));
  }
  async scoreSummary(collection, persisted, round) {
    if (typeof round?.finishedAt === 'string' && object(round.summary)) {
      const saved = cloneJson(round.summary); saved.gradedCount ??= saved.submittedCount; saved.pendingCount ??= 0; for (const row of saved.questions) row.gradingStatus ??= row.submitted ? 'graded' : 'unsubmitted'; return saved;
    }
    const states = this.summaryStates(persisted, collection, round), scores = await runRuleBatches(this.rules, collection.questions, 'scoreBatch', 'scores', collection.questions.map((question, index) => ({ data: question.data, state: publicState(states[index]) })));
    const summary = { questionCount: collection.questions.length, submittedCount: 0, answeredUnsubmittedCount: 0, finished: false, status: 'in-progress', roundId: round?.id ?? null, questions: [] }, earned = [], maxima = []; let submitted = 0, graded = 0, pending = 0;
    for (let i = 0; i < states.length; i++) {
      const state = states[i], value = scores[i], question = collection.questions[i], answered = state.status === 'submitted', status = answered ? gradingStatus(state.result) : 'unsubmitted';
      if (typeof value?.maxScore !== 'number' || !Number.isFinite(value.maxScore) || value.maxScore < 0 || (answered && status !== 'pending' && (typeof value.score !== 'number' || !Number.isFinite(value.score)))) throw new ApiError(422, 'SCORE_UNAVAILABLE', '题型拓展返回的分值无效。');
      const score = answered && status !== 'pending' ? value.score : 0; earned.push(score); maxima.push(value.maxScore);
      if (answered) { submitted++; if (status === 'pending') pending++; else graded++; }
      else if (this.hasSavedAnswer(state)) summary.answeredUnsubmittedCount++;
      const row = { id: question.id, maxScore: value.maxScore, submitted: answered, status: state.status, gradingStatus: status, score: status === 'pending' ? null : score };
      if (!answered && collection.extensionFor(question).answerStateDeclared) {
        if (state.answerState) { row.answerState = cloneJson(state.answerState); row.outlineStates = cloneJson(state.answerState.outlineStates); }
      } else { this.cacheOutline(collection, question, state, value); if (value.outlineStates !== undefined && question.outlineItems.length) row.outlineStates = visibleOutlineStates(value.outlineStates, question, answered); }
      summary.questions.push(row);
    }
    return Object.assign(summary, { score: decimalSum(earned), maxScore: decimalSum(maxima), submittedCount: submitted, gradedCount: graded, pendingCount: pending });
  }
  async summary(collection) { const persisted = this.load(collection), result = await this.scoreSummary(collection, persisted, this.summaryRound(persisted, collection)); result.summaryVersion = this.summaryVersion(collection, persisted, result); return result; }
  hasSavedAnswer(state) {
    if (state.status !== 'draft') return false;
    if (state.answerState) return state.answerState.status === 'draft' || state.answerState.outlineStates?.some(item => item.status === 'draft');
    // Legacy types have no explicit progress declaration. Their saved draft
    // answer is submitted as-is; the extension owns empty/partial-answer rules.
    return state.answer !== null && state.answer !== undefined;
  }
  async submitSaved(collection, request) {
    const key = requestId(request), persisted = this.load(collection);
    const receipt = receiptResult(persisted.completionReceipts, request);
    if (receipt) return this.summary(collection);
    const summary = await this.summary(collection);
    const intent = persisted.completionIntent;
    if (!intent || intent.request.requestId !== key) {
      this.checkSummaryRequest(request, summary, '练习内容已改变，请刷新分值卡后再完成练习。');
      if (summary.finished) return summary;
      const next = cloneJson(persisted);
      next.completionIntent = { request: cloneJson(request), questions: collection.questions.filter(q => this.hasSavedAnswer(questionState(persisted, collection, q))).map(q => q.id) };
      this.commit(collection, next);
    } else if (!jsonEqual(intent.request, request)) throw new ApiError(409, 'REQUEST_ID_REUSED', 'Completion request changed');
    for (const qid of this.load(collection).completionIntent.questions) {
      const question = collection.question(qid), current = questionState(this.load(collection), collection, question);
      if (current.status === 'submitted') continue;
      try { await this.act(collection, question, { requestId: 'complete-' + hash(Buffer.from(key + ':' + qid)), action: 'submit', revision: current.revision, data: { answer: cloneJson(current.answer) } }); }
      catch (error) { throw new ApiError(error.status ?? 422, error.code ?? 'SUBMISSION_FAILED', `「${question.title}」提交失败：${error.message}。已保存答案保留，请返回题目处理后重试。`, { cause: error }); }
    }
    const next = cloneJson(this.load(collection)), result = await this.summary(collection), submittedQuestions = [...next.completionIntent.questions];
    (next.completionReceipts ??= []).push({ id: key, request: cloneJson(request), response: { submittedQuestions } }); retainReceipts(next.completionReceipts);
    delete next.completionIntent; this.commit(collection, next); return result;
  }
  completionResult(collection, request) { return receiptResult(this.load(collection).completionReceipts, request); }
  saveCompletionResult(collection, request, response) {
    const next = cloneJson(this.load(collection));
    const receipt = next.completionReceipts?.find(row => row.id === request.requestId);
    if (receipt) { receipt.response = cloneJson(response); this.commit(collection, next); }
    return response;
  }
  async finish(collection, request) {
    const key = requestId(request), persisted = this.load(collection), receipt = receiptResult(persisted.finishReceipts, request); if (receipt) return receipt;
    const current = await this.summary(collection); this.checkSummaryRequest(request, current, '练习内容已改变，请刷新分值卡后再完成练习。');
    if (current.finished) {
      if (this.memoryOnly) return { ...current, historyId: null };
      try { await this.history(collection.kind, collection.id, current.roundId); return { ...current, historyId: current.roundId }; } catch (error) { if (error.code === 'HISTORY_NOT_FOUND') return { ...current, historyId: null }; throw error; }
    }
    if (current.pendingCount > 0) throw new ApiError(409, 'PENDING_REVIEW', '还有已提交的题目等待评分，请确认评分后再完成练习。');
    const replacement = cloneJson(persisted); let round = this.summaryRound(replacement, collection);
    if (!round) { interruptRound(replacement, 'collection-changed'); round = await this.freezeRound(collection, replacement, this.summaryStates(replacement, collection, null)); (replacement.historyRounds ??= []).push(round); }
    else if (round.status === 'in-progress') {
      const visible = await this.unsubmittedHistoryStates(collection, replacement, round);
      for (let i = 0; i < collection.questions.length; i++) { const payload = round.questions[i].payload, question = collection.questions[i]; if (payload.state.status !== 'submitted') payload.state = visible[question.id]; payload.draft = cloneJson(questionState(replacement, collection, question).draft); }
    }
    const now = new Date().toISOString(); Object.assign(round, { explicitCompletion: true, status: 'completed', finishedAt: now, updatedAt: now, completionVersions: Object.fromEntries(collection.questions.map(question => [question.id, questionState(replacement, collection, question).revision])) });
    const saved = cloneJson(current); delete saved.summaryVersion; Object.assign(saved, { roundId: round.id, finished: true, status: 'completed' }); round.summary = saved; summarize(round);
    const result = { ...cloneJson(saved), historyId: this.memoryOnly ? null : round.id, summaryVersion: this.summaryVersion(collection, replacement, saved) };
    const receipts = replacement.finishReceipts ??= []; receipts.push({ id: key, request: cloneJson(request), response: cloneJson(result) }); retainReceipts(receipts); this.commit(collection, replacement); return result;
  }
  checkSummaryRequest(request, summary, message) {
    if (!Object.hasOwn(request, 'roundId') || !(request.roundId === null || typeof request.roundId === 'string')) throw bad('Invalid roundId');
    if (request.roundId !== summary.roundId || text(request, 'summaryVersion', 64) !== summary.summaryVersion) throw new ApiError(409, 'SUMMARY_CONFLICT', message);
  }
  async restart(collection, request) {
    const key = requestId(request), persisted = this.load(collection), receipt = receiptResult(persisted.restartReceipts, request); if (receipt) return receipt;
    const current = await this.summary(collection); this.checkSummaryRequest(request, current, '练习数据已改变，请刷新分值卡后再开始新一轮。'); if (!current.finished) throw new ApiError(409, 'PRACTICE_NOT_FINISHED', '请先完成当前练习，再开始新一轮。');
    const replacement = cloneJson(persisted);
    for (const question of collection.questions) {
      const next = cloneJson(questionState(replacement, collection, question));
      for (const field of ['revision', 'submissionGeneration', 'gradingGeneration']) next[field] = increment(next[field] ?? 0);
      Object.assign(next, { status: 'unanswered', answer: null, result: null, draft: null, aiTaskId: null, receipts: [] }); for (const field of ['aiTaskIds', 'aiTargetGenerations', 'outlineStates', 'answerState']) delete next[field]; ownSet(replacement.questions, question.id, next);
    }
    delete replacement.upgradedCompletion; const result = { restarted: true }, receipts = replacement.restartReceipts ??= []; receipts.push({ id: key, request: cloneJson(request), response: result }); retainReceipts(receipts); this.commit(collection, replacement); return result;
  }
  async act(collection, question, action, trustedAi = null) {
    const key = requestId(action); if (!integralField(action, 'revision') || action.revision < 0) throw bad('Invalid revision'); const name = text(action, 'action', 30), data = requireObject(action.data, 'Action data must be an object');
    const persisted = this.load(collection), current = questionState(persisted, collection, question), receipt = receiptResult(current.receipts, action); if (receipt) return receipt;
    if (Object.hasOwn(action, 'contentVersion')) { if (!digest(action.contentVersion)) throw bad('Invalid contentVersion'); if (action.contentVersion !== this.stampValue(collection, question, current).contentVersion) throw new ApiError(409, 'CONTENT_CONFLICT', '题目内容或题型拓展已更新，请刷新题目后重试；本次修改未保存。'); }
    if (action.revision !== current.revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Question changed; reload its latest state');
    const next = cloneJson(current); next.revision = increment(current.revision); let projected;
    if (name === 'draft' || name === 'submit') {
      if (current.status === 'submitted') throw new ApiError(409, 'ALREADY_SUBMITTED', 'Retry before changing a submitted answer'); if (!Object.hasOwn(data, 'answer')) throw bad('Missing answer');
      const extension = collection.extensionFor(question);
      if (Object.hasOwn(data, 'answerState')) {
        if (name !== 'draft' || !extension.answerStateDeclared) throw bad('answerState requires an API 1.3 answer-state draft');
        validateAnswerState(data.answerState, question);
      }
      const answer=extension.answerAreasDeclared?await prepareAnswerAreas(data.answer,this.resources,{submit:name==='submit',targetIds:question.outlineItems.map(item=>item.id)}):data.answer;
      const evaluated = await this.rules.run(extension, { op: name === 'submit' ? 'submit' : 'validateAnswer', withCapabilities: true, data: question.data, answer, ...(name === 'draft' ? { projectAfterValidation: true, outlineAfterValidation: !extension.answerStateDeclared && question.outlineItems.length > 0, outlineRevision: next.revision } : {}) }); this.rememberAiSupport(extension, evaluated);
      next.answer = cloneJson(answer); next.status = name === 'submit' ? 'submitted' : 'draft'; next.result = name === 'submit' ? cloneJson(evaluated.result) : null; projected = evaluated.projected;
      if (name === 'draft' && evaluated.outlineScore) this.cacheOutline(collection, question, next, evaluated.outlineScore);
      if (name === 'draft') { if (data.answerState) next.answerState = cloneJson(data.answerState); else delete next.answerState; }
      else delete next.answerState;
      if (name === 'submit') { next.submissionGeneration = increment(current.submissionGeneration ?? 0); next.gradingGeneration = increment(current.gradingGeneration ?? 0); next.aiTaskId = null; delete next.aiTaskIds; delete next.aiTargetGenerations; }
    } else if (name === 'retry') {
      if(next.draft)next.draft=draftWithoutAnswerInk(next.draft,current.answer);
      Object.assign(next, { status: 'unanswered', answer: null, result: null, submissionGeneration: increment(current.submissionGeneration ?? 0), gradingGeneration: increment(current.gradingGeneration ?? 0), aiTaskId: null }); delete next.aiTaskIds; delete next.aiTargetGenerations; delete next.answerState;
    } else if (name === 'review') {
      if (!this.reviewAvailable(collection, question, current, persisted)) throw new ApiError(409, 'REVIEW_UNAVAILABLE', '只能调整当前未完成练习中已提交题目的评分。');
      const review = requireObject(data.review, 'Missing review'); if (typeof review.score !== 'number' || !Number.isFinite(review.score)) throw bad('Invalid score'); const target = targetId(review);
      const evaluated = await this.rules.run(collection.extensionFor(question), { op: 'review', withCapabilities: true, data: question.data, answer: current.answer, review, state: { ...publicState(current), submitted: true } }); this.rememberAiSupport(collection.extensionFor(question), evaluated); projected = evaluated.projected;
      if (target !== null && trustedAi === null) { next.result = cloneJson(evaluated.result); delete next.result.aiAssessment; const assessments = object(current.result?.aiAssessments) ? cloneJson(current.result.aiAssessments) : {}; delete assessments[target]; next.result.aiAssessments = assessments; next.result.gradingSource = 'manual'; }
      else next.result = decorateReview(evaluated.result, current.result, trustedAi);
      if (target === null) { next.gradingGeneration = increment(current.gradingGeneration ?? 0); delete next.aiTaskIds; delete next.aiTargetGenerations; if (trustedAi === null) next.aiTaskId = null; }
      else { ownSet(this.targetMap(next, 'aiTargetGenerations', target), target, increment(this.targetGeneration(current, target))); next.aiTaskId = null; if (trustedAi === null && object(next.aiTaskIds)) delete next.aiTaskIds[target]; }
    } else if (name === 'whiteboard') { collection.features.requireWhiteboard(); validateDraft(data.draft); next.draft = cloneJson(data.draft); }
    else throw bad('Unknown action');
    const result = await this.response(collection, question, next, projected), replacement = cloneJson(persisted);
    if (name === 'whiteboard' && object(replacement.upgradedCompletion)) ownSet(replacement.upgradedCompletion.completionVersions, question.id, next.revision); else delete replacement.upgradedCompletion;
    replacement.extensionFingerprint = collection.extensionFingerprint; ownSet(replacement.questions, question.id, next);
    result.capabilities = name === 'submit' ? { canReview: manualResult(next), canAiGrade: manualResult(next) && await this.supportsAi(collection.extensionFor(question)) } : await this.reviewCapabilities(collection, question, next, replacement);
    if (name === 'submit') await this.recordSubmission(collection, question, replacement, result); if (name === 'review') this.recordReview(collection, question, replacement, result);
    result.capabilities = await this.reviewCapabilities(collection, question, next, replacement);
    next.receipts.push({ id: key, request: cloneJson(action), response: cloneJson(result), ...(trustedAi ? { aiConfirmation: cloneJson(trustedAi.confirmation) } : {}) }); retainReceipts(next.receipts, true);
    this.commit(collection, replacement); return result;
  }
  historyFiles() { safeDirectory(this.directory); return fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().map(name => path.join(this.directory, name)); }
  async history(kind, id, historyId = null) {
    if (this.memoryOnly) throw new ApiError(403, 'HISTORY_DISABLED', 'Practice is temporary in this page session'); this.recoverEdits(); const records = [], prefix = `${kind}:${id}:`;
    try {
      for (const file of this.historyFiles()) {
        const saved = readJson(file, 32 * 1024 * 1024); if (!object(saved) || saved.schemaVersion !== 1 || typeof saved.collection !== 'string' || !object(saved.questions)) throw new Error('Invalid saved history state'); if (!saved.collection.startsWith(prefix)) continue;
        for (const [field, validate] of [['history', validateLegacy], ['historyRounds', validateRound]]) { if (Object.hasOwn(saved, field) && !Array.isArray(saved[field])) throw new Error('Invalid saved history'); for (const record of saved[field] ?? []) validate(record); }
        for (const record of [...legacyRounds(saved.history, kind, id), ...(saved.historyRounds ?? [])]) { if (historyId !== null && matchesId(record, historyId)) return publicRecord(record); records.push(record); }
      }
    } catch (error) { if (historyFailure(error)) throw error; throw new ApiError(503, 'HISTORY_UNAVAILABLE', 'Saved history cannot be read; preserve the state directory for recovery', { cause: error }); }
    if (historyId !== null) throw new ApiError(404, 'HISTORY_NOT_FOUND', 'History record does not exist'); records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)); return { records: records.map(record => publicRecord(record, true)) };
  }
  async deleteHistory(kind, id, historyId) {
    if (this.memoryOnly) throw new ApiError(403, 'HISTORY_DISABLED', 'Practice is temporary in this page session'); this.recoverEdits(); const prefix = `${kind}:${id}:`; let target, replacement;
    try {
      for (const file of this.historyFiles()) {
        const saved = readJson(file, 32 * 1024 * 1024); if (!object(saved) || typeof saved.collection !== 'string') throw new Error('Invalid saved history state'); if (!saved.collection.startsWith(prefix)) continue; validateSaved(saved);
        const legacy = legacyRounds(saved.history, kind, id), old = legacy.find(record => matchesId(record, historyId)), index = saved.historyRounds?.findIndex(record => matchesId(record, historyId)) ?? -1;
        if (old || index >= 0) { replacement = cloneJson(saved); if (old) deleteLegacy(replacement, legacy, old); else replacement.historyRounds.splice(index, 1); target = file; break; }
      }
    } catch (error) { if (historyFailure(error)) throw error; throw new ApiError(503, 'HISTORY_UNAVAILABLE', 'Saved history cannot be read; preserve the state directory for recovery', { cause: error }); }
    if (!target) throw new ApiError(404, 'HISTORY_NOT_FOUND', 'History record does not exist'); const bytes = this.persist(target, replacement); this.remember(replacement.collection, replacement, bytes); return { deleted: historyId };
  }
  targetMap(state, name, target) {
    const map = object(state[name]) ? state[name] : (state[name] = {}); if (!Object.hasOwn(map, target) && Object.keys(map).length >= 256) throw new ApiError(413, 'AI_TARGET_LIMIT', '当前题目的评分目标数量已达到上限。'); return map;
  }
  targetGeneration(state, target) { return Object.hasOwn(state.aiTargetGenerations ?? {}, target) ? state.aiTargetGenerations[target] : 0; }
  aiTaskId(state, target = null) { const value = target === null ? state.aiTaskId : Object.hasOwn(state.aiTaskIds ?? {}, target) ? state.aiTaskIds[target] : null; return typeof value === 'string' ? value : null; }
  currentAiTaskId(collection, question, target = null) { return this.aiTaskId(questionState(this.load(collection), collection, question), target); }
  currentAiTaskIds(collection, question) { const state = questionState(this.load(collection), collection, question), whole = this.aiTaskId(state); return [...(whole ? [whole] : []), ...Object.values(state.aiTaskIds ?? {}).filter(value => typeof value === 'string')]; }
  aiSnapshot(collection, question, persisted, state, document, target) {
    validateInput(document); const gradingInput = normalizeInput(document);
    return { stateKey: collection.stateKey(), roundId: activeRound(persisted).id, questionFingerprint: question.fingerprint, extensionFingerprint: collection.extensionFor(question).fingerprint, answerHash: fingerprint(state.answer, 'quizforge-ai-answer-v1'), submissionGeneration: state.submissionGeneration ?? 0, gradingGeneration: state.gradingGeneration ?? 0, gradingInput, targetId: target, targetGeneration: target === null ? 0 : this.targetGeneration(state, target) };
  }
  async prepareAiInputs(collection, question, request, automatic) {
    const target = targetId(request), persisted = this.load(collection), state = questionState(persisted, collection, question);
    if (!this.reviewAvailable(collection, question, state, persisted) || !await this.supportsAi(collection.extensionFor(question))) throw new ApiError(409, 'AI_GRADING_UNAVAILABLE', '当前题目不能进行 AI 评分，请先提交答案。');
    if (request && Object.hasOwn(request, 'contentVersion') && request.contentVersion !== this.stampValue(collection, question, state).contentVersion) throw new ApiError(409, 'CONTENT_CONFLICT', '题目已更新，请重新打开后评分。');
    const prepared = await this.rules.run(collection.extensionFor(question), { op: 'prepareAiGrading', data: question.data, answer: state.answer, ...(automatic ? { automatic: true } : {}), ...(target === null ? {} : { targetId: target }), state: { ...publicState(state), submitted: true } }), document = prepared.gradingInput;
    if (automatic && object(document) && Object.hasOwn(document, 'targets')) {
      if (Object.keys(document).length !== 1 || !Array.isArray(document.targets) || document.targets.length > 256) throw new ApiError(422, 'INVALID_AI_INPUT', '自动评分清单须为最多 256 个小题的 targets 数组。');
      const seen = new Set(); return document.targets.map(target => { if (!object(target) || Object.keys(target).length !== 2 || !validTargetId(target.targetId) || !Object.hasOwn(target, 'input') || seen.has(target.targetId)) throw new ApiError(422, 'INVALID_AI_INPUT', '自动评分的小题必须包含唯一有效的 targetId 和 input。'); seen.add(target.targetId); return this.aiSnapshot(collection, question, persisted, state, target.input, target.targetId); });
    }
    return [this.aiSnapshot(collection, question, persisted, state, document, target)];
  }
  async prepareAiGrading(collection, question, request) { return (await this.prepareAiInputs(collection, question, request, false))[0]; }
  prepareAutomaticAiGrading(collection, question, request) { return this.prepareAiInputs(collection, question, request, true); }
  assertAiCurrent(collection, question, snapshot, taskId = null) {
    const persisted = this.load(collection), state = questionState(persisted, collection, question), active = activeRound(persisted);
    if (collection.stateKey() !== snapshot.stateKey || question.fingerprint !== snapshot.questionFingerprint || collection.extensionFor(question).fingerprint !== snapshot.extensionFingerprint || active?.id !== snapshot.roundId || !this.reviewAvailable(collection, question, state, persisted) || (state.submissionGeneration ?? 0) !== snapshot.submissionGeneration || (state.gradingGeneration ?? 0) !== snapshot.gradingGeneration || (snapshot.targetId !== null && this.targetGeneration(state, snapshot.targetId) !== snapshot.targetGeneration) || fingerprint(state.answer, 'quizforge-ai-answer-v1') !== snapshot.answerHash || taskId !== null && taskId !== this.aiTaskId(state, snapshot.targetId)) throw new ApiError(409, 'AI_RESULT_STALE', '题目、答案或评分已变化，这份 AI 建议不能覆盖当前结果。');
  }
  bindAiTask(collection, question, snapshot, taskId) {
    this.assertAiCurrent(collection, question, snapshot); const replacement = cloneJson(this.load(collection)), next = cloneJson(questionState(replacement, collection, question));
    if (snapshot.targetId === null) { next.aiTaskId = taskId; delete next.aiTaskIds; } else { ownSet(this.targetMap(next, 'aiTaskIds', snapshot.targetId), snapshot.targetId, taskId); next.aiTaskId = null; }
    ownSet(replacement.questions, question.id, next); this.commit(collection, replacement);
  }
  aiCurrent(collection, question, snapshot, taskId = null) { try { this.assertAiCurrent(collection, question, snapshot, taskId); return true; } catch (error) { if (['AI_RESULT_STALE', 'COLLECTION_CHANGED'].includes(error.code)) return false; throw error; } }
  async confirmAi(collection, question, snapshot, taskId, requestIdValue, candidateVersion, score, assessment) {
    const confirmation = { taskId, candidateVersion, score }, current = questionState(this.load(collection), collection, question), existing = current.receipts.find(receipt => receipt.id === requestIdValue);
    if (existing) { if (!jsonEqual(existing.aiConfirmation, confirmation)) throw new ApiError(409, 'REQUEST_ID_REUSED', 'Request ID was already used with different confirmation data'); return cloneJson(existing.response); }
    this.assertAiCurrent(collection, question, snapshot, taskId);
    const action = { requestId: requestIdValue, revision: current.revision, action: 'review', contentVersion: this.stampValue(collection, question, current).contentVersion, data: { review: { score, ...(typeof assessment.feedback === 'string' ? { feedback: assessment.feedback } : {}), ...(snapshot.targetId === null ? {} : { targetId: snapshot.targetId }) } } };
    return this.act(collection, question, action, { confirmation, assessment: cloneJson(assessment) });
  }
  confirmedAiReceipt(collection, question, taskId, candidateVersion) { const receipt = questionState(this.load(collection), collection, question).receipts.find(receipt => receipt.aiConfirmation?.taskId === taskId && receipt.aiConfirmation.candidateVersion === candidateVersion); return receipt ? cloneJson(receipt.response) : null; }
  editorSourceVersion(collection) { return this.opaqueVersion('edit-source', collection.stateKey(), catalogRevision(collection)); }
  async editor(library, collection, question) {
    collection.features.requireEditing(); const state = questionState(this.load(collection), collection, question), raw = { id: question.id, title: question.title, data: cloneJson(question.data) }, extension = collection.extensionFor(question);
    return { question: raw, extension: extensionMetadata(extension), revision: state.revision, contentVersion: this.stampValue(collection, question, state).contentVersion, sourceVersion: this.editorSourceVersion(collection), draftVersion: fingerprint(raw, extension.fingerprint), editor: library.editorPage(extension) ?? null };
  }
  async edit(library, collection, question, request) {
    collection.features.requireEditing(); const key = requestId(request), persisted = this.load(collection), current = questionState(persisted, collection, question), receipt = receiptResult(persisted.editReceipts, request, question.id); if (receipt) return receipt;
    if (!integralField(request, 'revision') || request.revision < 0 || !digest(request.contentVersion)) throw bad('Invalid edit revision or contentVersion');
    const beforeSourceVersion = this.editorSourceVersion(collection);
    if (Object.hasOwn(request, 'sourceVersion')) { if (!digest(request.sourceVersion)) throw bad('Invalid sourceVersion'); if (request.sourceVersion !== beforeSourceVersion) throw new ApiError(409, 'CONTENT_CONFLICT', 'Collection content changed; reload the editor before saving'); }
    if (request.contentVersion !== this.stampValue(collection, question, current).contentVersion) throw new ApiError(409, 'CONTENT_CONFLICT', 'Question content changed; reload the editor before saving');
    if (request.revision !== current.revision) throw new ApiError(409, 'REVISION_CONFLICT', 'Question practice changed; reload the editor before saving');
    const revision = increment(current.revision), title = text(request, 'title', 300); if (!Object.hasOwn(request, 'data')) throw bad('Missing question data');
    const plan = await library.prepareEdit(collection, question.id, title, request.data), changed = !jsonEqual(question.data, plan.question.data), replacement = cloneJson(persisted), next = cloneJson(current);
    if (changed) { Object.assign(next, { status: 'unanswered', answer: null, result: null, draft: null, receipts: [], submissionGeneration: increment(current.submissionGeneration ?? 0) }); delete next.answerState; }
    Object.assign(next, { gradingGeneration: increment(current.gradingGeneration ?? 0), aiTaskId: null, revision, fingerprint: plan.question.fingerprint }); delete next.aiTaskIds; delete next.aiTargetGenerations;
    if (changed) interruptRound(replacement, 'content-edited'); ownSet(replacement.questions, question.id, next);
    const result = { previousSourceVersion: beforeSourceVersion, sourceVersion: this.editorSourceVersion(plan.collection), payload: await this.response(plan.collection, plan.question, next), collection: await this.overviewValue(plan.collection, replacement) };
    const receipts = replacement.editReceipts ??= []; receipts.push({ id: key, questionId: question.id, request: cloneJson(request), response: cloneJson(result) }); retainReceipts(receipts, true);
    // Source and state are committed together. Recovery only accepts either exact
    // pre-image or post-image, never overwriting a concurrent external edit.
    try {
      const bytes = this.stateBytes(replacement);
      if (this.memoryOnly) { this.checkMemory(plan.collection.stateKey(), bytes.length); this.edits.commitSource(plan); }
      else this.edits.commit(plan, this.file(collection), bytes);
      this.remember(plan.collection.stateKey(), replacement, bytes.length); library.invalidate();
    } catch (error) { this.clearMemory(); if (error instanceof ApiError && !['STATE_WRITE_FAILED'].includes(error.code)) throw error; throw new ApiError(503, 'EDIT_PENDING', 'Edit could not finish. Recovery journal is preserved; retry the same request after storage is available', { cause: error }); }
    return result;
  }
}
