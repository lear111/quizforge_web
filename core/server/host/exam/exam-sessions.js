import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, bad, id, routeId } from '../platform/errors.js';
import { cloneJson, fingerprint, integralField, jsonBytes, jsonEqual } from '../platform/json.js';
import { checkPath, exists, readJson, replaceFile, safeDirectory, safeFile, walkFiles, within } from '../platform/files.js';
import { Collection } from '../library/collections.js';
import { BankFeatures } from '../library/features.js';
import { readOutlineItems } from '../practice/outline.js';
import { snapshotPage, markedDevelopment } from '../extensions/extension-packages.js';
import { StateStore } from '../practice/state-store.js';
import { bindListening, readMaterial, snapshotListening } from '../resources/listening.js';
import { ResourceStore } from '../resources/resources.js';
import { OpenAiCompatibleProvider } from '../ai/ai-provider.js';
import { CollectionRoutes } from '../practice/collection-routes.js';
import { TemporaryExamSessions, requireOwner } from './temporary-exams.js';
import { SerialTransactions } from '../platform/transactions.js';

const privateFields = new Set(['packages', 'questions', 'features', 'requestId', 'description', 'pageSession', 'listening']);
const packageIdentity = extension => extension.referencePath ? fingerprint(extension.referencePath, extension.fingerprint) : extension.fingerprint;
export class ExamSessions {
  constructor(root, library, states, ai, routes, writes, automaticAi, { now = () => Date.now(), resourceGateway = null } = {}) {
    Object.assign(this, { root, library, states, ai, routes, writes, automaticAi, now, resourceGateway }); this.directory = path.join(root, '.state', 'exams'); this.records = new Map(); this.collections = new Map(); this.temporary = new TemporaryExamSessions(now); this.transactions = new SerialTransactions(); this.closed = false;
    safeDirectory(this.directory, true);
    for (const name of fs.readdirSync(this.directory).filter(name => /^[a-f0-9-]{36}$/.test(name))) {
      const folder = path.join(this.directory, name); checkPath(folder, { directory: true }); const recordFile = path.join(folder, 'exam.json'); if (!exists(recordFile)) continue;
      try { const value = readJson(recordFile, 32 * 1024 * 1024); if (value.id !== name) throw new Error('Invalid exam identity'); if (value.status !== 'deleted') { const snapshot = path.join(folder, 'snapshot.json'), source = exists(snapshot) ? readJson(snapshot, 32 * 1024 * 1024) : value; this.restore(source); value.questionCount = source.questions.length; if (exists(snapshot)) for (const key of ['packages', 'questions', 'description']) delete value[key]; } this.records.set(name, value); } catch { /* Preserve unreadable snapshots; never overwrite them. */ }
    }
    library.examResolver = id => this.collection(id);
    for (const name of ['start', 'list', 'submit', 'delete', 'appendHistory', 'history', 'route', 'tick']) { const method = this[name]; this[name] = (...args) => this.transactions.run(() => method.apply(this, args)); }
  }
  publicRecord(record) { return { ...Object.fromEntries(Object.entries(record).filter(([key]) => !privateFields.has(key)).map(([key, value]) => [key, cloneJson(value)])), serverTime: new Date(this.now()).toISOString() }; }
  require(id) { const record = this.records.get(id); if (!record || record.status === 'deleted') throw new ApiError(404, 'COLLECTION_NOT_FOUND', '考试记录不存在。'); return record; }
  cache(collection) { this.collections.delete(collection.id); this.collections.set(collection.id, collection); while (this.collections.size > 8) { const oldest = [...this.collections.keys()].find(id => !this.temporary.contains(id)); if (!oldest) break; this.collections.delete(oldest); } }
  collection(id) {
    const record = this.require(id); if (this.collections.has(id)) { const value = this.collections.get(id); this.cache(value); return value; }
    try { const value = this.restore(record.packages ? record : readJson(path.join(this.directory, id, 'snapshot.json'), 32 * 1024 * 1024)); this.cache(value); return value; } catch { throw new ApiError(503, 'EXAM_SNAPSHOT_UNAVAILABLE', '考试快照暂不可读取，已保存的数据仍保留。'); }
  }
  restore(record) {
    if (typeof record.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.id) || !Array.isArray(record.packages) || !Array.isArray(record.questions) || !record.questions.length || record.questions.length > 10000) throw new Error('Invalid exam snapshot');
    const base = path.join(this.directory, record.id), extensions = new Map();
    for (const pkg of record.packages) {
      routeId(pkg.id); routeId(pkg.version); if (!/^[a-f0-9]{64}$/.test(pkg.fingerprint) || typeof pkg.folder !== 'string' || pkg.folder.includes('\\') || pkg.folder.split('/').some(piece => piece === '..' || piece === '.' || !piece)) throw new Error('Invalid exam package');
      const directory = path.resolve(base, pkg.folder); if (!within(base, directory) || directory === base) throw new Error('Unsafe exam package'); checkPath(directory, { directory: true });
      const extension = { id: pkg.id, version: pkg.version, name: pkg.name, description: pkg.description ?? '', directory, fingerprint: pkg.fingerprint, dependencies: cloneJson(pkg.dependencies ?? []), contentApi: cloneJson(pkg.contentApi ?? null), providerRevision: pkg.providerRevision ?? '', outlineItemsDeclared: pkg.outlineItemsDeclared === true, answerStateDeclared: pkg.answerStateDeclared === true, answerAreasDeclared: pkg.answerAreasDeclared === true, examples: null, development: pkg.id.startsWith('dev.') && pkg.version === '0.0.0' && markedDevelopment(directory) ? { folder: path.basename(directory) } : null };
      for (const key of ['entry', 'script', 'style', 'rules', 'questionSchema', 'answerSchema']) extension[key] = typeof pkg[key] === 'string' ? safeFile(directory, pkg[key]) : null;
      if (pkg.referencePath) extension.referencePath = pkg.referencePath;
      const key = pkg.key ?? pkg.fingerprint;
      if (!/^[a-f0-9]{64}$/.test(key) || extensions.has(key)) throw new Error('Duplicate exam extension'); extensions.set(key, extension);
    }
    const seen = new Set(), questions = record.questions.map(row => {
      routeId(row.id); if (seen.has(row.id) || typeof row.title !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint) || !Object.hasOwn(row, 'data')) throw new Error('Invalid frozen exam question'); seen.add(row.id);
      const extension = extensions.get(row.package); if (!extension) throw new Error('Missing exam extension');
      return { ...(row.listening ? { listening: cloneJson(row.listening) } : {}), id: row.id, title: row.title, data: cloneJson(row.data), fingerprint: row.fingerprint, extension, outlineItems: readOutlineItems(row.outlineItems ?? []), outline: cloneJson(row.outline ?? null) };
    });
    return bindListening(new Collection({ listening: cloneJson(record.listening ?? null), id: record.id, title: record.title, description: record.description ?? '', kind: 'exam', extension: null, questions, features: new BankFeatures({ editing: false, whiteboard: record.features?.whiteboard ?? true, history: record.features?.history ?? true, exam: false }) }), base);
  }
  describe(extension) {
    const value = { id: extension.id, version: extension.version, name: extension.name, description: extension.description, fingerprint: extension.fingerprint, providerRevision: extension.providerRevision, outlineItemsDeclared: extension.outlineItemsDeclared, ...(extension.answerStateDeclared ? {answerStateDeclared:true} : {}), ...(extension.answerAreasDeclared ? {answerAreasDeclared:true} : {}), dependencies: cloneJson(extension.dependencies) };
    if (extension.referencePath) { value.referencePath = extension.referencePath; value.key = packageIdentity(extension); }
    for (const key of ['entry', 'script', 'style', 'rules', 'questionSchema', 'answerSchema']) if (extension[key]) value[key] = path.relative(extension.directory, extension[key]).replaceAll('\\', '/'); if (extension.contentApi) value.contentApi = cloneJson(extension.contentApi); return value;
  }
  copyPackage(source, target) {
    const files = walkFiles(source, 8192); let bytes = 0, count = 0;
    for (const file of files) if (fs.lstatSync(file).isFile()) { if (++count > 4096 || (bytes += fs.statSync(file).size) > 128 * 1024 * 1024) throw new Error('Exam package snapshot is too large'); }
    for (const file of files) { const destination = path.resolve(target, path.relative(source, file)); if (!within(target, destination)) throw new Error('Unsafe exam package'); if (fs.lstatSync(file).isDirectory()) safeDirectory(destination, true); else fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL); }
  }
  copyImages(node) {
    if (node && typeof node === 'object') { for (const value of Object.values(node)) this.copyImages(value); }
    else if (typeof node === 'string' && /^[a-f0-9]{64}$/.test(node)) try { const image = this.library.developmentResources.read(node); this.library.resources.store(image.mime, image.bytes); } catch (error) { if (error.code !== 'RESOURCE_NOT_FOUND') throw error; }
  }
  persist(record) {
    if (record.features?.history === false) return;
    try {
      const folder = path.join(this.directory, record.id); safeDirectory(folder, true);
      if (record.packages) { const snapshot = path.join(folder, 'snapshot.json'); if (!exists(snapshot)) { const bytes = jsonBytes(record); if (bytes.length > 32 * 1024 * 1024) throw new Error('Exam snapshot too large'); const fd = fs.openSync(snapshot, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } }
      const metadata = cloneJson(record); for (const key of ['packages', 'questions', 'description']) delete metadata[key]; const bytes = jsonBytes(metadata); if (bytes.length > 32 * 1024 * 1024) throw new Error('Exam record too large'); replaceFile(path.join(folder, 'exam.json'), bytes); for (const key of ['packages', 'questions', 'description']) delete record[key];
    } catch { throw new ApiError(500, 'EXAM_SAVE_FAILED', '考试记录保存失败，已保存的答案仍保留。'); }
  }
  store(record) { return this.temporary.runtime(record.id)?.states ?? this.states; }
  grading(record) { return this.temporary.runtime(record.id)?.ai ?? this.ai; }
  dispatch(record) { return this.temporary.runtime(record.id)?.routes ?? this.routes; }
  async start(source, request, pageSession = null) {
    if (!['bank', 'development-bank'].includes(source.kind) || !source.features.exam) throw new ApiError(403, 'EXAM_DISABLED', '题库未开启考试模式。'); const requestId = id(request, 'requestId'); if (requestId.length < 8) throw bad('Invalid requestId');
    if (!Object.hasOwn(request, 'durationMinutes') || !(request.durationMinutes === null || integralField(request, 'durationMinutes') && request.durationMinutes >= 1 && request.durationMinutes <= 1440)) throw bad('考试时长须为 1–1440 分钟或 null（不限时）。');
    this.expireTemporary(); if (!source.features.history) { requireOwner(pageSession); this.temporary.touchPage(pageSession, false); }
    for (const record of this.records.values()) if (record.requestId === requestId) { if (record.bankKind !== source.kind || record.bankId !== source.id || record.durationMinutes !== request.durationMinutes || record.features?.history === false && record.pageSession !== pageSession) throw new ApiError(409, 'REQUEST_ID_REUSED', '考试请求编号已使用。'); if (record.status === 'deleted') throw new ApiError(409, 'EXAM_DELETED', '这次考试已删除，请重新开始考试。'); return this.publicRecord(record); }
    if (!source.features.history) this.temporary.checkAdmission(0);
    const examId = randomUUID(), now = this.now(), record = { id: examId, bankKind: source.kind, bankId: source.id, title: source.title, description: source.description, requestId, startedAt: new Date(now).toISOString(), status: 'in-progress', durationMinutes: request.durationMinutes, features: source.features.json(), ...(!source.features.history ? { pageSession } : {}), deadline: request.durationMinutes === null ? null : new Date(now + request.durationMinutes * 60000).toISOString(), packages: [], questions: [], ...(source.listening ? { listening: cloneJson(source.listening) } : {}) };
    try {
      snapshotListening(source, path.join(this.directory, examId));
      for (const extension of source.extensions) { const pkg = this.describe(extension); pkg.folder = 'packages/' + packageIdentity(extension) + '/' + path.basename(extension.directory); this.copyPackage(extension.directory, path.join(this.directory, examId, pkg.folder)); record.packages.push(pkg); }
      for (const question of source.questions) { if (source.kind.startsWith('development')) this.copyImages(question.data); record.questions.push({ id: question.id, title: question.title, fingerprint: question.fingerprint, package: packageIdentity(source.extensionFor(question)), data: cloneJson(question.data), ...(question.outline ? { outline: cloneJson(question.outline) } : {}), outlineItems: cloneJson(question.outlineItems), ...(question.listening ? { listening: cloneJson(question.listening) } : {}) }); }
      const frozen = this.restore(record);
      if (!source.features.history) {
        const resources = new ResourceStore(this.root, { memory: true, fallback: this.library.resources }), memory = StateStore.memory(this.root, this.states.rules, resources), gateway = this.resourceGateway ? this.resourceGateway(resources) : this.ai.gateway, ai = this.ai.temporary(this.root, memory, gateway), routes = new CollectionRoutes(this.library, memory, ai, this.writes, this.automaticAi), runtime = { states: memory, ai, resources, routes, bytes: () => memory.memoryBytes() + ai.memoryBytes() + resources.memoryBytes(), close: () => { ai.close(); memory.clearMemory(); resources.clearMemory(); } };
        try { this.temporary.add(examId, pageSession, runtime, 2 * jsonBytes(record).length); } catch (error) { runtime.close(); throw error; }
      }
      record.questionCount = record.questions.length; await this.store(record).overview(frozen); this.persist(record); this.records.set(examId, record); this.cache(frozen); return this.publicRecord(record);
    } catch (error) { this.temporary.discard(examId); if (!source.features.history) this.cleanupTemporarySnapshot(examId); if (error instanceof ApiError) throw error; throw new ApiError(500, 'EXAM_START_FAILED', '无法保存考试快照，原练习进度未改变。'); }
  }
  bankFor(record) { return this.library.bankLocations?.historical(record.bankId, record.startedAt) ?? record.bankId; }
  async list(kind, bankId, pageSession = null) { await this.tick(); this.temporary.touchPage(pageSession, false); return { records: [...this.records.values()].filter(record => record.status !== 'deleted' && (record.bankKind === kind || record.bankKind === 'development-bank' && kind === 'bank') && this.bankFor(record) === bankId && (record.features?.history !== false || record.pageSession === pageSession)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(record => this.publicRecord(record)) }; }
  async submit(id) { const record = this.require(id); await this.advance(record); await this.handIn(record, 'manual'); return this.publicRecord(record); }
  delete(id, pageSession) {
    this.expireTemporary(); const record = this.records.get(id); if (!record || record.features?.history === false && record.pageSession !== pageSession) throw new ApiError(404, 'COLLECTION_NOT_FOUND', '考试记录不存在。'); if (record.features?.history === false) requireOwner(pageSession);
    if (record.status === 'completed') throw new ApiError(409, 'EXAM_COMPLETED', '考试已完成，请在历史记录中查看或删除。');
    if (record.status !== 'deleted') { const deleted = { ...cloneJson(record), status: 'deleted', deletedAt: new Date(this.now()).toISOString() }; for (const key of ['packages', 'questions', 'description', 'summary', 'gradingErrors', 'aiErrors']) delete deleted[key]; this.persist(deleted); this.records.set(id, deleted); this.collections.delete(id); this.temporary.deleted(id, jsonBytes(deleted).length, id => this.invalidateTemporary(id)); }
    if (record.features?.history === false) this.cleanupTemporarySnapshot(id); return { deleted: id };
  }
  async advance(record) { if (record.status === 'in-progress' && typeof record.deadline === 'string' && this.now() >= Date.parse(record.deadline)) await this.handIn(record, 'timeout'); else if (record.status === 'grading' && !record.gradingErrors?.length) { if (!record.submissionComplete) await this.handIn(record, record.submissionReason ?? 'manual'); else await this.complete(record); } }
  async tick() { if (this.closed) return; this.expireTemporary(); for (const record of this.records.values()) try { await this.advance(record); } catch { /* Other attempts remain usable; preserve the failed record. */ } }
  async handIn(record, reason) {
    if (record.status === 'completed') return; if (record.status === 'in-progress') Object.assign(record, { status: 'grading', submittedAt: new Date(this.now()).toISOString(), submissionReason: reason, submissionComplete: false }); this.persist(record);
    const collection = this.collection(record.id), states = this.store(record), ai = this.grading(record), errors = record.gradingErrors = [];
    for (const question of collection.questions) try {
      let payload = await states.question(collection, question);
      if (payload.state.status !== 'submitted' && payload.state.answer !== null) payload = await states.act(collection, question, { requestId: 'exam-submit-' + fingerprint({ id: question.id }, collection.id), revision: payload.state.revision, action: 'submit', data: { answer: cloneJson(payload.state.answer) } });
      if (this.automaticAi() && payload.capabilities.canAiGrade) {
        const tasks = await states.currentAiTaskIds(collection, question);
        if (!tasks.length && payload.state.result.gradingSource !== 'manual') await ai.startAutomatic(collection, question, { requestId: 'exam-auto-' + fingerprint({ id: question.id, contentVersion: payload.stamp.contentVersion }, collection.id), contentVersion: payload.stamp.contentVersion });
        else for (const taskId of tasks) if ((await ai.get(collection, question, taskId)).status === 'failed') await ai.retry(collection, question, taskId, { requestId: 'exam-retry-' + randomUUID() });
      }
    } catch (error) { errors.push({ questionId: question.id, code: error instanceof ApiError ? error.code : 'GRADING_FAILED', message: '该题评分未完成，已保存的答案仍保留。' }); }
    record.submissionComplete = errors.length === 0; this.persist(record); if (!errors.length) await this.complete(record);
  }
  async complete(record) {
    const collection = this.collection(record.id), states = this.store(record), ai = this.grading(record), before = record.aiErrors ?? [], failures = record.aiErrors = []; let pending = false;
    for (const question of collection.questions) for (const taskId of await states.currentAiTaskIds(collection, question)) { const status = (await ai.get(collection, question, taskId)).status; if (['queued', 'running', 'succeeded'].includes(status)) pending = true; if (status === 'failed') failures.push({ questionId: question.id, taskId, message: 'AI 评分失败，请重试或人工评分。' }); }
    if (!jsonEqual(before, failures)) this.persist(record); if (pending || failures.length) return;
    const summary = await states.summary(collection); if (summary.pendingCount > 0) return;
    record.summary = summary.finished ? { ...summary, historyId: collection.features.history ? summary.roundId : null } : await states.finish(collection, { requestId: 'exam-finish-' + collection.id, summaryVersion: summary.summaryVersion, roundId: summary.roundId }); Object.assign(record, { status: 'completed', finishedAt: new Date(this.now()).toISOString() }); this.persist(record);
  }
  static isHistoryId(id) { return /^exam-[a-f0-9-]{36}$/.test(id); }
  belongsToHistory(record, kind, bankId) { return (record.bankKind === kind || record.bankKind === 'development-bank' && kind === 'bank') && this.bankFor(record) === bankId && record.status === 'completed' && record.features?.history !== false && typeof record.summary?.historyId === 'string'; }
  historyRecord(exam, entry) { return { ...cloneJson(entry), id: 'exam-' + exam.id, mode: 'exam', examId: exam.id, createdAt: exam.startedAt, updatedAt: exam.finishedAt }; }
  async appendHistory(kind, bankId, history) { await this.tick(); const records = [...history.records]; for (const record of this.records.values()) if (this.belongsToHistory(record, kind, bankId)) for (const row of (await this.states.history('exam', record.id)).records) if (row.id === record.summary.historyId) records.push(this.historyRecord(record, row)); records.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); return { ...history, records }; }
  async history(kind, bankId, id, remove) { const record = this.records.get(id.slice(5)); if (!record || !this.belongsToHistory(record, kind, bankId)) throw new ApiError(404, 'HISTORY_NOT_FOUND', '考试历史记录不存在。'); if (remove) { await this.states.deleteHistory('exam', record.id, record.summary.historyId); return { deleted: id }; } return this.historyRecord(record, await this.states.history('exam', record.id, record.summary.historyId)); }
  async route(context, method, parts) {
    this.expireTemporary(); const id = routeId(parts[3]), owner = context.request.headers['x-quizforge-practice-session'];
    if (parts.length === 5 && parts[4] === 'exam' && method === 'DELETE') { this.writes.validateOrigin(context); return this.delete(id, owner); }
    const record = this.require(id); if (record.features?.history === false) this.temporary.access(id, owner, method !== 'GET'); await this.advance(record); const collection = this.collection(id), active = record.status === 'in-progress';
    if (parts.length === 6 && parts[4] === 'listening' && method === 'GET') return readMaterial(collection, routeId(parts[5]));
    if (parts[4] === 'resources') { const resources = this.temporary.runtime(id)?.resources ?? this.library.resources; if (parts.length === 5 && method === 'POST') { const request = await this.writes.read(context); if (!active) throw new ApiError(403, 'EXAM_ACTION_DISABLED', '交卷后不能上传作答图片。'); return resources.upload(request); } if (parts.length === 6 && method === 'GET') { const image = resources.read(parts[5]); return { id: image.id, mime: image.mime, size: image.bytes.length, data: image.bytes.toString('base64') }; } }
    if (parts.length === 5 && parts[4] === 'exam') { if (method === 'GET') return this.publicRecord(record); if (method === 'POST') { await this.writes.read(context); return this.submit(id); } }
    if (parts.length === 7 && parts[4] === 'questions' && parts[6] === 'page' && method === 'GET') { const extension = collection.extensionFor(collection.question(parts[5])), page = snapshotPage(extension); if (extension.id === 'quizforge.single-choice' && extension.version === '1.0.0' || extension.id === 'quizforge.short-answer' && extension.version === '1.3.0') page.examActionSelectors = ['#submit-button', '#retry-button']; return page; }
    if (method !== 'GET') {
      if (parts.length === 7 && parts[6] === 'actions') { const action = await this.writes.read(context), review = action.action === 'review' && record.status === 'grading' && !record.gradingErrors?.length; if (!review && (!active || !['draft', 'whiteboard'].includes(action.action))) throw new ApiError(403, 'EXAM_ACTION_DISABLED', '考试只允许保存答案和草稿，请使用宿主的交卷按钮。'); return { ...await this.store(record).act(collection, collection.question(parts[5]), action), exam: this.publicRecord(record) }; }
      if (parts.length >= 8 && parts[6] === 'ai' && !active && record.status !== 'completed') return this.dispatch(record).route(context, method, parts); throw new ApiError(403, 'EXAM_ACTION_DISABLED', '考试期间不能编辑、重做或单题提交。');
    }
    if (parts.length >= 7 && ['editor', 'edit'].includes(parts[6]) || parts[4] === 'summary' && active) throw new ApiError(403, 'EXAM_ACTION_DISABLED', '交卷后才能查看答案和分值。');
    const response = await this.dispatch(record).route(context, method, parts); if (record.gradingErrors?.length && parts.length === 6 && parts[4] === 'questions') throw new ApiError(409, 'EXAM_GRADING_FAILED', '交卷已锁定，请重试评分；答案仍保留。'); return { ...response, exam: this.publicRecord(record) };
  }
  expireTemporary() { this.temporary.expire(id => this.invalidateTemporary(id)); }
  invalidateTemporary(id) { this.records.delete(id); this.collections.delete(id); this.cleanupTemporarySnapshot(id); }
  cleanupTemporarySnapshot(id) {
    try {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return; const folder = path.resolve(this.directory, id); if (path.dirname(folder) !== path.resolve(this.directory) || !exists(folder)) return; checkPath(this.directory, { directory: true }); checkPath(folder, { directory: true });
      if (fs.readdirSync(folder).some(name => !['packages', 'media'].includes(name))) return; for (const file of walkFiles(folder, 16384)) { if (!within(folder, file)) throw new Error('Unsafe temporary exam path'); checkPath(file); }
      fs.rmSync(folder, { recursive: true });
    } catch { /* Unrelated or redirected files are preserved. */ }
  }
  close() { this.closed = true; this.temporary.close(); for (const record of [...this.records.values()]) if (record.features?.history === false) this.invalidateTemporary(record.id); }
}
