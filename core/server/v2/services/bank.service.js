/** @typedef {import('../types/data.js').OverviewResult} OverviewResult */
/** @typedef {import('../../../shared/v2/api.js').RefreshResponse} RefreshResponse */
/** @typedef {import('./practice.service.js').PracticeState} PracticeState */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @import { QuestionCandidate } from '../../../shared/v2/api.js' */
/** @typedef {import('../../../shared/v2/api.js').QuestionReadResponse} QuestionReadResponse */
/** @typedef {import('../../../shared/v2/api.js').CompletionResponse} CompletionResponse */
/** @typedef {import('../../../shared/v2/api.js').FinishResponse} FinishResponse */
/** @typedef {import('../../../shared/v2/state.js').StateSummary} StateSummary */
/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
/** @import { TailArgs } from '../types/data.js' */
/** @typedef {import('../../../shared/v2/api.js').QuestionResponse} QuestionResponse */
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
  /**
   * @param {string} root
   * @param {string} codeRoot
   * @param {{development?: boolean, stateStore?: PracticeState | null}} [options]
   */
  constructor(root, codeRoot, { development = false, stateStore = null } = {}) {
    this.root = bankRoot(root);
    this.codeRoot = bankRoot(codeRoot);
    this.cache = newCache();
    this.types = new TypeRegistry(root, this.cache);
    this.sharedSdks = new SharedSdks(this.codeRoot, this.cache);
    this.indexed = false;
    this.development = development;
    /** @type {Map<string, Snapshot>} */
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
  /** @overload
   * @param {string} bankId @param {unknown} requestedQuestionId
   * @param {{refresh: true, includeInitial?: boolean}} options
   * @returns {RefreshResponse}
   */
  /** @overload
   * @param {string} bankId @param {unknown} [requestedQuestionId]
   * @param {{refresh?: boolean, includeInitial?: boolean}} [options]
   * @returns {OverviewResult}
   */
  /**
   * @param {string} bankId
   * @param {unknown} [requestedQuestionId]
   * @param {{refresh?: boolean, includeInitial?: boolean}} [options]
   * @returns {OverviewResult}
   */
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
    const lastQuestionId = snapshot.items.has(/** @type {string} */ (savedPosition))
      ? /** @type {string} */ (savedPosition)
      : null;

    return measureOverview('assemble', () => {
      this.rememberSnapshot(bankId, snapshot);
      return overviewResponse(this, snapshot, {
        requestedQuestionId: /** @type {string | undefined} */ (requestedQuestionId),
        lastQuestionId,
        includeInitial,
        refresh,
        previous,
      });
    });
  }
  /**
   * @param {string} bankId
   * @param {Snapshot} snapshot
   */
  rememberSnapshot(bankId, snapshot) {
    this.opened.delete(bankId);
    this.opened.set(bankId, snapshot);
    while (this.opened.size > OPEN_BANK_LIMIT) {
      const first = /** @type {string} */ (this.opened.keys().next().value),
        old = /** @type {Snapshot} */ (this.opened.get(first));
      this.opened.delete(first);
      this.stateStore?.evict(old.directory);
    }
  }
  /**
   * @param {string} bankId
   * @param {unknown} input
   * @returns {RefreshResponse}
   */
  refresh(bankId, input) {
    if (!object(input) || (Object.hasOwn(input, 'questionId') && !validId(input.questionId))) {
      throw problem('INVALID_REQUEST', '刷新请求或当前题号无效。', {}, 400);
    }
    if (Object.hasOwn(input, 'expectedSnapshotId')) {
      this.snapshot(bankId, input.expectedSnapshotId);
    }
    return this.open(bankId, input.questionId, { refresh: true });
  }
  /**
   * @param {string} bankId
   * @param {unknown} snapshotId @returns {Snapshot}
   */
  snapshot(bankId, snapshotId) {
    let value = this.opened.get(bankId);
    if (!value) {
      if (typeof snapshotId !== 'string') {
        throw problem('BANK_NOT_OPEN', '请先打开该题库的概览。', { bankId }, 409);
      }
      this.open(bankId, undefined, { includeInitial: false });
      value = /** @type {Snapshot} */ (this.opened.get(bankId));
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
  /**
   * @param {Snapshot} snapshot
   * @param {string} id
   */
  needsGrading(snapshot, id) {
    const state = /** @type {PracticeState} */ (this.stateStore).get(snapshot, id);
    return state.submissionId !== null && state.result === null;
  }
  /**
   * @overload
   * @param {Snapshot} snapshot
   * @param {{includeInk?: true}} [options]
   * @returns {QuestionCandidate<QuestionReadResponse>[]}
   */
  /**
   * @overload
   * @param {Snapshot} snapshot
   * @param {{includeInk?: boolean}} [options]
   * @returns {QuestionCandidate[]}
   */
  /**
   * @param {Snapshot} snapshot
   * @param {{includeInk?: boolean}} [options]
   * @returns {QuestionCandidate[]}
   */
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
  /**
   * @param {Snapshot} snapshot @returns {CompletionResponse}
   */
  completion(snapshot) {
    return {
      completedAt: this.stateStore?.load(snapshot.directory).completedAt ?? null,
      total: this.stateStore
        ? this.stateStore.total(snapshot)
        : { score: 0, maxScore: decimalSum([...snapshot.maxScores.values()]) },
      states: [...snapshot.items.keys()].map((id) => this.state(snapshot, id)),
    };
  }
  /**
   * @param {string} bankId
   * @param {unknown} input @returns {FinishResponse}
   */
  finish(bankId, input) {
    const snapshot = this.snapshot(
      bankId,
      /** @type {{snapshotId?: unknown} | null} */ (input)?.snapshotId,
    );
    /** @type {PracticeState} */ (this.stateStore).finish(snapshot, input);
    // Neither answer nor solution is built until the entire lock transaction
    // has committed. Individual unavailable pages stay recoverable entries.
    return {
      ...this.completion(snapshot),
      pendingGrading: this.pendingGrading(snapshot, { includeInk: false }),
    };
  }
  /**
   * @param {string} bankId
   * @param {unknown} input
   */
  results(bankId, input) {
    const snapshot = this.snapshot(
      bankId,
      /** @type {{snapshotId?: unknown} | null} */ (input)?.snapshotId,
    );
    /** @type {PracticeState} */ (this.stateStore).results(snapshot, input);
    return this.completion(snapshot);
  }
  /**
   * @param {Snapshot} snapshot
   * @param {string} id @returns {StateSummary}
   */
  state(snapshot, id) {
    if (this.stateStore) {
      return this.stateStore.summary(snapshot, id);
    }
    return {
      questionId: id,
      status: emptyOutlineStatus(/** @type {OutlineItem} */ (snapshot.items.get(id))),
      revision: 0,
      hasSavedAnswer: false,
      locked: false,
      score: null,
      maxScore: /** @type {number} */ (snapshot.maxScores.get(id)),
      hasInk: false,
    };
  }

  /**
   * @param {Snapshot} snapshot
   * @param {Record<string, unknown>} record
   */
  resolution(snapshot, record) {
    return questions.resolution(this, snapshot, record);
  }
  /**
   * @param {TailArgs<Parameters<typeof questions.visibleAssets>>} args
   */
  visibleAssets(...args) {
    return questions.visibleAssets(this, ...args);
  }
  /**
   * @overload
   * @param {string} bankId
   * @param {string} id
   * @param {unknown} snapshotId
   * @param {{includeInk?: true}} [options]
   * @returns {QuestionReadResponse}
   */
  /**
   * @overload
   * @param {string} bankId
   * @param {string} id
   * @param {unknown} snapshotId
   * @param {{includeInk?: boolean}} [options]
   * @returns {QuestionResponse}
   */
  /**
   * @param {TailArgs<Parameters<typeof questions.question>>} args
   */
  question(...args) {
    return questions.question(this, ...args);
  }
  /**
   * @param {TailArgs<Parameters<typeof questions.write>>} args
   */
  write(...args) {
    return questions.write(this, ...args);
  }
  /**
   * @param {TailArgs<Parameters<typeof questions.asset>>} args
   */
  asset(...args) {
    return questions.asset(this, ...args);
  }
  /**
   * @param {TailArgs<Parameters<typeof questions.listening>>} args
   */
  listening(...args) {
    return questions.listening(this, ...args);
  }
  /**
   * @param {TailArgs<Parameters<typeof questions.artifact>>} args
   */
  artifact(...args) {
    return questions.artifact(this, ...args);
  }
}
