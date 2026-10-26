import { ApiError, bad, id, text, requireObject } from '../platform/errors.js';
import { cloneJson, fingerprint } from '../platform/json.js';
import { BankFeatures } from './features.js';
import { requireBankFormat } from '../extensions/extension-api.js';
import { outlineQuestions, readOutlineConfiguration, runRuleBatches } from '../practice/outline.js';
import { readListening, readQuestionListening } from '../resources/listening.js';
import { referenceIdentity } from './identity.js';

export function optional(raw, field, max) {
  if (!Object.hasOwn(raw, field)) return '';
  if (typeof raw[field] !== 'string' || raw[field].length > max) throw bad(`Invalid ${field}`);
  return raw[field];
}
export function developmentRuleFailure(error) { return error instanceof ApiError && ['DEVELOPMENT_NOT_IMPLEMENTED', 'RULE_REJECTED', 'RULE_TIMEOUT', 'RULE_UNAVAILABLE', 'SCORE_UNAVAILABLE'].includes(error.code); }
export function resolveExtension(reference, available) {
  requireObject(reference, 'Extension references identify a single extension; typeId is unsupported');
  if (Object.hasOwn(reference, 'typeId')) throw bad('Extension references identify a single extension; typeId is unsupported');
  const key = referenceIdentity(reference);
  const result = available.get(key);
  if (!result) throw bad('Missing extension');
  return result;
}
export function developmentFolders(raw) { return [...new Set([raw?.extension, ...(raw?.questions ?? []).map(question => question.extension)].filter(reference => reference && Object.hasOwn(reference, 'development')).map(reference => id(reference, 'development')))].sort(); }
export function ruleIdentity(questions) { return fingerprint(questions.map(question => ({ id: question.extension.id, version: question.extension.version, fingerprint: question.extension.fingerprint, directory: question.extension.directory, outlineItems: question.extension.outlineItemsDeclared })), 'quizforge-library-rules-v1'); }
export class Collection {
  constructor({ id, title, description, kind, extension = null, questions, listening = null, features = new BankFeatures() }) {
    Object.assign(this, { id, title, description, kind, extension, features, listening });
    this.questions = questions.map(question => question.extension || !extension ? question : { ...question, extension });
    const bindings = new Map();
    this.questionIndex = new Map();
    for (const question of this.questions) {
      if (!question.extension) throw bad('Question extension is missing');
      const owner = question.extension;
      const binding = `${owner.id}@${owner.version}:${owner.fingerprint}:${owner.referencePath ?? ''}`;
      if (!bindings.has(binding)) bindings.set(binding, owner);
      this.questionIndex.set(question.id, question);
    }
    this.extensions = [...bindings.values()];
    this.extensionFingerprint = extension ? extension.fingerprint : fingerprint([...this.extensions].sort((left, right) => (left.id + '@' + left.version) < (right.id + '@' + right.version) ? -1 : 1).map(owner => ({ id: owner.id, version: owner.version, fingerprint: owner.fingerprint })), 'quizforge-mixed-extensions-v1');
  }
  stateKey() { return this.storageKey ?? `${this.kind}:${this.id}:${this.kind === 'bank' && (this.id.startsWith('g.') || /^[a-f0-9-]{36}$/i.test(this.id)) ? 'mixed' : this.extension ? this.id.startsWith('p.') ? 'path:' + this.extension.referencePath : this.extension.id + ':' + this.extension.version : 'mixed'}`; }
  question(id) { const question = this.questionIndex.get(id); if (!question) throw new ApiError(404, 'QUESTION_NOT_FOUND', 'Question does not exist'); return question; }
  extensionFor(question) { const extension = question.extension ?? this.extension; if (!extension) throw bad('Question extension is missing'); return extension; }
}
export function catalogRevision(collection) {
  const value = { title: collection.title, description: collection.description, stateKey: collection.stateKey(), features: collection.features.json(), ...(collection.listening ? { listening: collection.listening } : {}), questions: collection.questions.map(question => ({ id: question.id, title: question.title, fingerprint: question.fingerprint, extensionId: question.extension.id, extensionVersion: question.extension.version, providerRevision: question.extension.providerRevision, outline: question.outline, outlineItems: question.outlineItems })) };
  return fingerprint(value, 'quizforge-library-content-v1');
}
export function prepareCollection(raw, kind, extension, collectionId, available, sourceId = collectionId) {
  requireObject(raw, 'Invalid bank ID');
  if (['bank', 'development-bank'].includes(kind) && sourceId !== id(raw, 'id')) throw bad('Invalid bank ID');
  requireBankFormat(raw);
  const listening = readListening(raw), features = BankFeatures.read(raw), fallback = Object.hasOwn(raw, 'extension') ? resolveExtension(raw.extension, available) : null;
  if (extension && fallback && (extension.id !== fallback.id || extension.version !== fallback.version)) throw bad('Extension mismatch');
  if (!Array.isArray(raw.questions) || !raw.questions.length || raw.questions.length > 10000) throw bad('Invalid questions');
  const questions = [], seen = new Set(); let perQuestion = false;
  for (const question of raw.questions) {
    const questionId = id(question, 'id');
    if (Object.hasOwn(question, 'features')) throw bad('features belong at the bank root');
    if (seen.has(questionId) || !Object.hasOwn(question, 'data')) throw bad('Duplicate question or missing data');
    seen.add(questionId);
    const owner = Object.hasOwn(question, 'extension') ? resolveExtension(question.extension, available) : fallback;
    if (!owner) throw bad('Missing question extension');
    if (['extension', 'development'].includes(kind) && (!extension || owner.id !== extension.id || owner.version !== extension.version)) throw bad('Example extension mismatch');
    perQuestion ||= Object.hasOwn(question, 'extension');
    const data = cloneJson(question.data), outline = Object.hasOwn(question, 'outline') ? readOutlineConfiguration(question.outline, owner) : null;
    const questionListening = readQuestionListening(question, listening);
    questions.push({ ...(questionListening ? { listening: questionListening } : {}), id: questionId, title: text(question, 'title', 300), data, fingerprint: fingerprint(data, owner.fingerprint), extension: owner, outlineItems: outline?.items ?? [], outline });
  }
  return { id: collectionId, title: text(raw, 'title', 300), description: optional(raw, 'description', 4000), kind, extension: ['extension', 'development'].includes(kind) ? extension : perQuestion || !fallback ? null : fallback, questions, features, listening, checkKey: fingerprint(raw, kind + ':' + ruleIdentity(questions)) };
}
export async function finishCollection(engine, prepared, cached = null, validated = false, validationFailure = null) {
  let questions = prepared.questions, successfulCheck = cached;
  if (cached) questions = questions.map((question, index) => ({ ...question, outlineItems: cloneJson(cached.outlineItems[index]) }));
  else {
    let valid = true;
    try {
      if (validationFailure) throw validationFailure;
      if (!validated) await runRuleBatches(engine, questions, 'validateBank', null, questions.map(question => question.data));
    } catch (error) { if (!prepared.kind.startsWith('development') || !developmentRuleFailure(error)) throw error; valid = false; }
    try { questions = await outlineQuestions(engine, questions); }
    catch (error) { if (!prepared.kind.startsWith('development') || !developmentRuleFailure(error)) throw error; valid = false; }
    if (valid) successfulCheck = { outlineItems: questions.map(question => cloneJson(question.outlineItems)) };
  }
  return { collection: new Collection({ ...prepared, questions }), successfulCheck };
}
