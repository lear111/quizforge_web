import * as questions from './question.service.js';
import { readSnapshot, overviewResponse, startingQuestion } from './bank-open.service.js';
import { bankLocations, bankCatalog, bankRoot } from '../repositories/catalog.repository.js';
import { decimalSum } from '../../host/platform/json.js';
import { validId } from '../repositories/bank.repository.js';
import { object, problem, publicError } from '../utils/errors.js';
import { newCache } from '../utils/io.js';
import { TypeRegistry } from '../repositories/extension.repository.js';
import { SharedSdks } from '../repositories/shared-sdks.repository.js';
import { measureOverview } from '../utils/timing.js';
import { emptyOutlineStatus } from '../../../shared/v2/answered.js';

export const OPEN_BANK_LIMIT = 8;

export class LibrarySnapshots {
  constructor(root, codeRoot, { development = false, stateStore = null } = {}) {
    this.root = bankRoot(root);
    this.codeRoot = bankRoot(codeRoot);
    this.cache = newCache();
    this.types = new TypeRegistry(root, this.cache);
    this.sharedSdks = new SharedSdks(this.codeRoot, this.cache);
    this.indexed = false;
    this.development = development;
    this.opened = new Map();
    this.stateStore = stateStore;
  }
  rebuildIndexes() {
    this.types.rebuild();
    measureOverview('sdk-digest', () => this.sharedSdks.rebuild());
    this.indexed = true;
  }
  locations() {
    return bankLocations(this.root);
  }
  catalog() {
    this.rebuildIndexes();
    return bankCatalog(this.root, this.cache);
  }
  open(bankId, requestedQuestionId, { refresh = false, includeInitial = true } = {}) {
    const rebuild = refresh || !this.indexed;
    if (rebuild) {
      this.rebuildIndexes();
    }
    const previous = this.opened.get(bankId);
    const location = measureOverview('locate-bank', () =>
      this.locations().find((row) => row.bankId === bankId),
    );
    if (!location) {
      throw problem('BANK_NOT_FOUND', '题库不存在，请刷新题库列表。', { bankId }, 404);
    }
    const snapshot = readSnapshot(this, location, bankId, rebuild);
    requestedQuestionId = startingQuestion(snapshot, requestedQuestionId, refresh);
    let activeCleared;
    try {
      activeCleared = measureOverview(
        'state-check',
        () => this.stateStore?.reconcile(snapshot) ?? false,
      );
    } catch (error) {
      if (!previous) {
        this.stateStore?.evict(location.directory);
      }
      throw error;
    }
    snapshot.activeCleared = activeCleared;
    const savedPosition = measureOverview(
      'state-check',
      () => this.stateStore?.load(location.directory).lastQuestionId,
    );
    const lastQuestionId = snapshot.items.has(savedPosition) ? savedPosition : null;

    return measureOverview('assemble', () => {
      this.rememberSnapshot(bankId, snapshot);
      return overviewResponse(this, snapshot, {
        requestedQuestionId,
        lastQuestionId,
        includeInitial,
        refresh,
        previous,
      });
    });
  }
  rememberSnapshot(bankId, snapshot) {
    this.opened.delete(bankId);
    this.opened.set(bankId, snapshot);
    while (this.opened.size > OPEN_BANK_LIMIT) {
      const first = this.opened.keys().next().value,
        old = this.opened.get(first);
      this.opened.delete(first);
      this.stateStore?.evict(old.directory);
    }
  }
  refresh(bankId, input) {
    if (!object(input) || (Object.hasOwn(input, 'questionId') && !validId(input.questionId))) {
      throw problem('INVALID_REQUEST', '刷新请求或当前题号无效。', {}, 400);
    }
    if (Object.hasOwn(input, 'expectedSnapshotId')) {
      this.snapshot(bankId, input.expectedSnapshotId);
    }
    return this.open(bankId, input.questionId, { refresh: true });
  }
  snapshot(bankId, snapshotId) {
    let value = this.opened.get(bankId);
    if (!value) {
      if (typeof snapshotId !== 'string') {
        throw problem('BANK_NOT_OPEN', '请先打开该题库的概览。', { bankId }, 409);
      }
      this.open(bankId, undefined, { includeInitial: false });
      value = this.opened.get(bankId);
    }
    if (typeof snapshotId !== 'string' || snapshotId !== value.snapshotId) {
      throw problem(
        'SNAPSHOT_STALE',
        value.activeCleared
          ? '题库或题型已变化，本轮作答已清空'
          : '题库快照已变化，请重新打开或刷新。',
        { bankId },
        409,
      );
    }
    this.opened.delete(bankId);
    this.opened.set(bankId, value);
    return value;
  }
  needsGrading(snapshot, id) {
    const state = this.stateStore.get(snapshot, id);
    return state.submissionId !== null && state.result === null;
  }
  pendingGrading(snapshot, { includeInk = true } = {}) {
    return [...snapshot.items.keys()]
      .filter((id) => this.stateStore && this.needsGrading(snapshot, id))
      .map((id) => {
        try {
          return {
            question: this.question(snapshot.bankId, id, snapshot.snapshotId, { includeInk }),
            error: null,
          };
        } catch (error) {
          return { question: null, error: publicError(error) };
        }
      });
  }
  completion(snapshot) {
    return {
      completedAt: this.stateStore?.load(snapshot.directory).completedAt ?? null,
      total: this.stateStore
        ? this.stateStore.total(snapshot)
        : { score: 0, maxScore: decimalSum([...snapshot.maxScores.values()]) },
      states: [...snapshot.items.keys()].map((id) => this.state(snapshot, id)),
    };
  }
  finish(bankId, input) {
    const snapshot = this.snapshot(bankId, input?.snapshotId);
    this.stateStore.finish(snapshot, input);
    // Neither answer nor solution is built until the entire lock transaction
    // has committed. Individual unavailable pages stay recoverable entries.
    return {
      ...this.completion(snapshot),
      pendingGrading: this.pendingGrading(snapshot, { includeInk: false }),
    };
  }
  results(bankId, input) {
    const snapshot = this.snapshot(bankId, input?.snapshotId);
    this.stateStore.results(snapshot, input);
    return this.completion(snapshot);
  }
  state(snapshot, id) {
    if (this.stateStore) {
      return this.stateStore.summary(snapshot, id);
    }
    return {
      questionId: id,
      status: emptyOutlineStatus(snapshot.items.get(id)),
      revision: 0,
      hasSavedAnswer: false,
      locked: false,
      score: null,
      maxScore: snapshot.maxScores.get(id),
      hasInk: false,
    };
  }

  resolution(snapshot, record) {
    return questions.resolution(this, snapshot, record);
  }
  visibleAssets(...args) {
    return questions.visibleAssets(this, ...args);
  }
  question(...args) {
    return questions.question(this, ...args);
  }
  write(...args) {
    return questions.write(this, ...args);
  }
  asset(...args) {
    return questions.asset(this, ...args);
  }
  listening(...args) {
    return questions.listening(this, ...args);
  }
  artifact(...args) {
    return questions.artifact(this, ...args);
  }
}
