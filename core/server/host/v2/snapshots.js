import fs from 'node:fs';
import path from 'node:path';
import { cloneJson, fingerprint, hash, projectJson, decimalSum } from '../platform/json.js';
import { checkPath } from '../platform/files.js';
import { readBank, questionRecord, validId } from './bank-reader.js';
import { object, problem, publicError } from './errors.js';
import { directories, newCache, readJson, relativeFile, relativePath, treeIdentity, READ_LIMITS } from './io.js';
import { TypeRegistry } from './type-registry.js';
import { measureOverview } from './timing.js';
import { emptyOutlineStatus } from '../../../shared/v2/answered.js';

export const OPEN_BANK_LIMIT = 8;

export class LibrarySnapshots {
  constructor(root, codeRoot, { development = false, stateStore = null } = {}) {
    this.root = checkPath(root, { directory: true }); this.codeRoot = checkPath(codeRoot, { directory: true });
    this.cache = newCache(); this.types = new TypeRegistry(root, this.cache); this.development = development;
    this.opened = new Map();
    this.stateStore = stateStore;
  }
  locations() {
    const base = path.join(this.root, 'question-banks'), result = [];
    const add = (directory, group) => { const relative = path.relative(base, directory).replaceAll('\\', '/'); result.push({ directory, group, name: path.basename(directory), bankId: 'b_' + hash(Buffer.from(relative)) }); };
    for (const group of directories(base)) {
      const directory = path.join(base, group);
      if (fs.existsSync(path.join(directory, 'bank.json'))) add(directory, '未分组');
      else for (const name of directories(directory)) {
        const bank = path.join(directory, name);
        if (fs.existsSync(path.join(bank, 'bank.json'))) add(bank, group);
      }
    }
    return result;
  }
  catalog() {
    const groups = new Map();
    for (const row of this.locations()) {
      let item;
      try {
        const raw = readJson(relativeFile(row.directory, 'bank.json'), this.cache, READ_LIMITS.bankBytes, { bankId: row.bankId, field: 'bank.json' });
        if (!object(raw) || raw.formatVersion !== 2) throw problem('BANK_FORMAT_UNSUPPORTED', '该题库尚未升级为 V2 题库文件。');
        item = { bankId: row.bankId, sourceId: typeof raw.id === 'string' ? raw.id : null, title: typeof raw.title === 'string' ? raw.title : row.name, kind: 'bank', availability: 'available', error: null };
      } catch (error) { item = { bankId: row.bankId, sourceId: null, title: row.name, kind: 'bank', availability: 'unavailable', error: publicError(error) }; }
      if (!groups.has(row.group)) groups.set(row.group, { id: 'g_' + hash(Buffer.from(row.group)), name: row.group, items: [] });
      groups.get(row.group).items.push(item);
    }
    return { groups: [...groups.values()] };
  }
  sdk(component, version) {
    if (!['richtext', 'answer-area', 'ink'].includes(component) || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw problem('SDK_UNAVAILABLE', '公共组件或版本不存在。', {}, 404);
    const directory = path.join(this.codeRoot, 'shared', component, version);
    try { const { digest, hashes } = treeIdentity(directory, this.cache, { field: 'sdk' }); return { directory, digest, hashes }; }
    catch (error) { if (error.code === 'FILE_COUNT_LIMIT') throw error; throw problem('SDK_UNAVAILABLE', '题型所需的公共组件未安装或无法读取。', {}, 404); }
  }
  open(bankId, requestedQuestionId, { refresh = false, includeInitial = true } = {}) {
    const previous = this.opened.get(bankId);
    const location = measureOverview('locate-bank', () => this.locations().find(row => row.bankId === bankId));
    if (!location) throw problem('BANK_NOT_FOUND', '题库不存在，请刷新题库列表。', { bankId }, 404);
    const { digest: tree, hashes } = measureOverview('bank-tree', () => treeIdentity(location.directory, this.cache, { bankId, field: 'bank.files' }));
    const bank = measureOverview('bank-json', () => readBank(location.directory, this.cache, bankId));
    const types = measureOverview('extension-resolve', () => {
      const ids = new Set();
      for (const raw of Object.values(bank.raw.questions)) if (object(raw) && typeof raw.type === 'string') ids.add(raw.type);
      return ids;
    });
    const resolutions = this.types.resolutions(types), sdk = new Map();
    for (const [type, resolution] of resolutions) if (resolution.artifact) {
      try { for (const [component, version] of Object.entries(resolution.artifact.sdkVersions)) sdk.set(`${component}@${version}`, measureOverview('sdk-digest', () => this.sdk(component, version))); }
      catch (error) { resolutions.set(type, { error: publicError(error) }); }
    }
    const snapshotId = measureOverview('snapshot-id', () => fingerprint({ bankId, tree, types: [...resolutions].map(([id, value]) => [id, value.artifact?.descriptor ?? value.error]), sdk: [...sdk].map(([id, value]) => [id, value.digest]) }, 'quizforge-v2-snapshot'));
    // Active-answer identity excludes storage paths, assets and shared SDKs.
    // File bodies follow deterministic traversal order; physical directory names
    // are absent. bank.json's exact bytes always participate.
    const contentFingerprint = measureOverview('content-fingerprint', () => fingerprint({ bank: this.cache.hash(relativeFile(location.directory, 'bank.json'), READ_LIMITS.bankBytes), types: [...resolutions].map(([id, value]) => [id, value.artifact?.contentDigest ?? value.error?.code]).sort(([a], [b]) => a.localeCompare(b)) }, 'quizforge-v2-content'));
    const snapshot = { ...bank, ...location, snapshotId, contentFingerprint, resolutions, sdk, hashes };
    if (requestedQuestionId !== undefined && (!validId(requestedQuestionId) || !bank.items.has(requestedQuestionId))) {
      if (!refresh) throw problem('QUESTION_NOT_FOUND', '指定的起始题不在题库大纲中。', { bankId, questionId: requestedQuestionId }, 404);
      requestedQuestionId = undefined;
    }
    let activeCleared;
    try { activeCleared = measureOverview('state-check', () => this.stateStore?.reconcile(snapshot) ?? false); }
    catch (error) { if (!previous) this.stateStore?.evict(location.directory); throw error; }
    snapshot.activeCleared = activeCleared;
    const savedPosition = measureOverview('state-check', () => this.stateStore?.load(location.directory).lastQuestionId);
    const lastQuestionId = bank.items.has(savedPosition) ? savedPosition : null;
    return measureOverview('assemble', () => {
      this.opened.delete(bankId); this.opened.set(bankId, snapshot);
      while (this.opened.size > OPEN_BANK_LIMIT) { const first = this.opened.keys().next().value, old = this.opened.get(first); this.opened.delete(first); this.stateStore?.evict(old.directory); }
      const questionId = requestedQuestionId ?? lastQuestionId ?? bank.items.keys().next().value;
      let initial = { question: null, error: null };
      if (includeInitial && questionId !== undefined) {
        try { initial.question = this.question(bankId, questionId, snapshotId); }
        catch (error) { initial.error = publicError(error); }
      }
      return { bank: cloneJson(bank.info), snapshotId, outline: cloneJson(bank.raw.outline), listening: [...bank.listening.values()].map(({ id, title }) => ({ id, title })),
        questionTypes: [...bank.items.keys()].map(id => ({ questionId: id, type: object(bank.raw.questions) && Object.hasOwn(bank.raw.questions, id) && typeof bank.raw.questions[id]?.type === 'string' ? bank.raw.questions[id].type : null })),
        ...this.completion(snapshot), lastQuestionId, initial, activeCleared,
        notice: activeCleared ? '题库或题型已变化，本轮作答已清空' : null,
        pendingGrading: includeInitial ? this.pendingGrading(snapshot) : [], ...(refresh ? { changes: { activeCleared, addedQuestionIds: [...bank.items.keys()].filter(id => !previous?.items.has(id)), removedQuestionIds: previous ? [...previous.items.keys()].filter(id => !bank.items.has(id)) : [], activeRoundInterrupted: false } } : {}) };
    });
  }
  refresh(bankId, input) {
    if (!object(input) || Object.hasOwn(input, 'questionId') && !validId(input.questionId)) throw problem('INVALID_REQUEST', '刷新请求或当前题号无效。', {}, 400);
    if (Object.hasOwn(input, 'expectedSnapshotId')) this.snapshot(bankId, input.expectedSnapshotId);
    return this.open(bankId, input.questionId, { refresh: true });
  }
  snapshot(bankId, snapshotId) {
    let value = this.opened.get(bankId);
    if (!value) {
      if (typeof snapshotId !== 'string') throw problem('BANK_NOT_OPEN', '请先打开该题库的概览。', { bankId }, 409);
      this.open(bankId, undefined, { includeInitial: false }); value = this.opened.get(bankId);
    }
    if (typeof snapshotId !== 'string' || snapshotId !== value.snapshotId) throw problem('SNAPSHOT_STALE', value.activeCleared ? '题库或题型已变化，本轮作答已清空' : '题库快照已变化，请重新打开或刷新。', { bankId }, 409);
    this.opened.delete(bankId); this.opened.set(bankId, value); return value;
  }
  needsGrading(snapshot, id) {
    const state = this.stateStore.get(snapshot, id);
    return state.submissionId !== null && state.result === null;
  }
  pendingGrading(snapshot, { includeInk = true } = {}) {
    return [...snapshot.items.keys()].filter(id => this.stateStore && this.needsGrading(snapshot, id)).map(id => {
      try { return { question: this.question(snapshot.bankId, id, snapshot.snapshotId, { includeInk }), error: null }; }
      catch (error) { return { question: null, error: publicError(error) }; }
    });
  }
  completion(snapshot) {
    return { completedAt: this.stateStore?.load(snapshot.directory).completedAt ?? null,
      total: this.stateStore ? this.stateStore.total(snapshot) : { score: 0, maxScore: decimalSum([...snapshot.maxScores.values()]) },
      states: [...snapshot.items.keys()].map(id => this.state(snapshot, id)) };
  }
  finish(bankId, input) {
    const snapshot = this.snapshot(bankId, input?.snapshotId);
    this.stateStore.finish(snapshot, input);
    // Neither answer nor solution is built until the entire lock transaction
    // has committed. Individual unavailable pages stay recoverable entries.
    return { ...this.completion(snapshot), pendingGrading: this.pendingGrading(snapshot, { includeInk: false }) };
  }
  results(bankId, input) {
    const snapshot = this.snapshot(bankId, input?.snapshotId);
    this.stateStore.results(snapshot, input);
    return this.completion(snapshot);
  }
  state(snapshot, id) {
    if (this.stateStore) return this.stateStore.summary(snapshot, id);
    return { questionId: id, status: emptyOutlineStatus(snapshot.items.get(id)), revision: 0, hasSavedAnswer: false, locked: false, score: null, maxScore: snapshot.maxScores.get(id), hasInk: false };
  }
  resolution(snapshot, record) {
    let value = snapshot.resolutions.get(record.type);
    if (this.development && value?.artifact?.development) {
      value = this.types.resolutions([record.type]).get(record.type);
      snapshot.resolutions.set(record.type, value);
    }
    if (!value) throw problem('EXTENSION_NOT_FOUND', '题型未安装或 type 不是 id@主版本号。', { field: 'type' }, 404);
    if (value.error) throw problem(value.error.code, value.error.message, { field: value.error.field, details: value.error.details }, value.error.code === 'EXTENSION_NOT_FOUND' ? 404 : 422);
    return value.artifact;
  }
  visibleAssets(snapshot, id, record, includeSolution = Boolean(this.stateStore?.get(snapshot, id).submissionId)) {
    const assets = new Map();
    const visit = value => {
      if (typeof value === 'string' && value.startsWith('qf-asset:')) {
        const relative = value.slice(9), file = relativePath(snapshot.directory, relative), assetId = hash(Buffer.from(id + '\0' + value));
        if (relative.toLowerCase() === 'bank.json') throw problem('ASSET_PATH_INVALID', '题库数据文件不能作为提交前可见的资源。', { field: 'question' });
        assets.set(assetId, { reference: value, file, relative });
      } else if (Array.isArray(value)) for (const child of value) visit(child);
      else if (object(value)) for (const child of Object.values(value)) visit(child);
    };
    visit(record.question);
    if (includeSolution) visit(record.solution);
    return assets;
  }
  question(bankId, id, snapshotId, { includeInk = true } = {}) {
    const snapshot = this.snapshot(bankId, snapshotId);
    try {
      const record = questionRecord(snapshot, id), artifact = this.resolution(snapshot, record), assets = this.visibleAssets(snapshot, id, record);
      const saved = this.stateStore?.get(snapshot, id);
      const ink = includeInk ? measureOverview('ink-body', () => this.stateStore?.ink.read(snapshot, id) ?? { ink: null, inkRevision: 0 }) : null;
      return { bankId, snapshotId, questionId: id, type: record.type, extension: cloneJson(artifact.descriptor), item: cloneJson(snapshot.items.get(id)), question: cloneJson(record.question),
        solution: saved?.submissionId ? cloneJson(record.solution) : null, answer: cloneJson(saved?.answer ?? null), ...(ink ? cloneJson(projectJson(ink, ['ink', 'inkRevision'])) : {}), state: this.state(snapshot, id), submissionId: saved?.submissionId ?? null, result: cloneJson(saved?.result ?? null),
        resources: [...assets].map(([assetId, { reference }]) => ({ assetId, reference })) };
    } catch (error) {
      if (error.context) error.context = { ...error.context, bankId, questionId: id };
      throw error;
    }
  }
  write(bankId, id, op, input) {
    const snapshot = this.snapshot(bankId, input?.snapshotId);
    // Validate the question and installed type before touching persistence.
    const record = questionRecord(snapshot, id);
    this.resolution(snapshot, record); this.visibleAssets(snapshot, id, record);
    if (op === 'ink') {
      const saved = this.stateStore.ink.apply(snapshot, id, input);
      return { inkRevision: saved.inkRevision, state: this.state(snapshot, id) };
    }
    this.stateStore.apply(snapshot, id, op, input);
    return this.question(bankId, id, snapshot.snapshotId, { includeInk: op === 'retry' });
  }
  asset(bankId, id, snapshotId, assetId) {
    const snapshot = this.snapshot(bankId, snapshotId), record = questionRecord(snapshot, id);
    this.resolution(snapshot, record);
    const publicAssets = this.visibleAssets(snapshot, id, record, false);
    const publicAsset = publicAssets.get(assetId);
    const asset = publicAsset ?? this.visibleAssets(snapshot, id, record).get(assetId);
    if (!asset) throw problem('RESOURCE_NOT_FOUND', '该题的可见资源不存在。', { bankId, questionId: id }, 404);
    // Solution-only assets must never bypass the lock check via browser cache
    // after retry. Question assets remain public throughout this snapshot.
    return { file: relativeFile(snapshot.directory, asset.relative), expectedHash: publicAsset ? snapshot.hashes.get(asset.relative) : undefined };
  }
  listening(bankId, id, snapshotId) {
    const snapshot = this.snapshot(bankId, snapshotId), material = snapshot.listening.get(id);
    if (!material) throw problem('RESOURCE_NOT_FOUND', '听力材料不存在或未被大纲引用。', { bankId }, 404);
    return material.remote ? { kind: 'remote', src: material.src, title: material.title } : { file: relativeFile(snapshot.directory, material.src) };
  }
  artifact(id) {
    for (const snapshot of this.opened.values()) for (const value of snapshot.resolutions.values()) if (value.artifact?.descriptor.artifactId === id) return value.artifact;
    throw problem('EXTENSION_NOT_FOUND', '拓展工件不存在，请重新打开题库。', {}, 404);
  }
}
