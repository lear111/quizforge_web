/** @typedef {import('../types/data.js').PracticeOptions} PracticeOptions */
/** @typedef {typeof import('../../host/platform/files.js').replaceFile} ReplaceFileFn */
/** @typedef {import('../types/data.js').LoadedState} LoadedState */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @typedef {import('../../../shared/v2/state.js').QuestionState} QuestionState */
/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
/** @typedef {import('../../../shared/v2/state.js').StateSummary} StateSummary */
/** @typedef {import('../types/data.js').CurrentState} CurrentState */
import { randomUUID } from 'node:crypto';
import { finishRound, recordResults } from './practice-completion.service.js';
import { applyAction } from './practice-actions.service.js';
import { cloneJson, freezeJson, decimalSum } from '../../host/platform/json.js';
import { problem } from '../utils/errors.js';
import { own, invalid, empty } from '../utils/state.js';
import { measureOverview } from '../utils/timing.js';
import { PracticeInk } from '../repositories/ink.repository.js';
import { StateRepository } from '../repositories/state.repository.js';
import { emptyOutlineStatus } from '../../../shared/v2/answered.js';
export { validateResult } from './practice-result.service.js';
export { STATE_BYTES } from '../utils/limits.js';
export { RECEIPT_LIMIT } from '../utils/receipts.js';
export class PracticeState {
  /**
   * @param {PracticeOptions} [options]
   */
  constructor({
    write,
    uuid = randomUUID,
    now = () => new Date().toISOString(),
    inkStore = new PracticeInk(),
  } = {}) {
    this.records = new StateRepository({ write });
    this.uuid = uuid;
    this.now = now;
    this.ink = inkStore;
  }
  get loaded() {
    return this.records.loaded;
  }
  get identities() {
    return this.records.identities;
  }
  get write() {
    return this.records.write;
  }
  /**
   * @param {ReplaceFileFn} value
   */
  set write(value) {
    this.records.write = value;
  }
  /**
   * @param {string} directory
   * @param {{atomic?: boolean}} [options]
   */
  file(directory, options) {
    return this.records.file(directory, options);
  }
  /**
   * @param {string} directory
   * @param {{refresh?: boolean}} [options]
   */
  load(directory, options) {
    return this.records.load(directory, options);
  }
  /**
   * @param {string} directory
   * @param {LoadedState} value
   */
  commit(directory, value) {
    return this.records.commit(directory, value);
  }
  /**
   * @param {Snapshot} snapshot
   */
  reconcile(snapshot) {
    const old = this.load(snapshot.directory, { refresh: true });
    const exists = this.records.exists(snapshot.directory);
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
  /**
   * @param {string} directory
   */
  evict(directory) {
    this.records.evict(directory);
    this.ink.evict(directory);
  }
  /**
   * @param {Snapshot} snapshot
   * @param {string} id @returns {QuestionState}
   */
  get(snapshot, id) {
    const root = this.load(snapshot.directory);
    if (own(root, 'historyIndex')) {
      throw invalid();
    }
    return own(root.questions, id)
      ? root.questions[id]
      : freezeJson({
          status: emptyOutlineStatus(/** @type {OutlineItem} */ (snapshot.items.get(id))),
          answer: null,
          result: null,
          submissionId: null,
          revision: 0,
          receipts: [],
        });
  }
  /**
   * @param {Snapshot} snapshot
   * @param {string} id @returns {StateSummary}
   */
  summary(snapshot, id) {
    const s = this.get(snapshot, id);
    return {
      questionId: id,
      status: cloneJson(s.status),
      revision: s.revision,
      hasSavedAnswer: s.answer !== null || s.submissionId !== null,
      locked: s.submissionId !== null,
      score: s.result?.score ?? null,
      maxScore: /** @type {number} */ (snapshot.maxScores.get(id)),
      hasInk: this.ink.has(snapshot, id),
    };
  }
  /**
   * @param {Snapshot} snapshot
   * @param {CurrentState} [root]
   */
  total(snapshot, root = /** @type {CurrentState} */ (this.load(snapshot.directory))) {
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
  /**
   * @param {Snapshot} snapshot
   * @param {unknown} input
   */
  finish(snapshot, input) {
    return finishRound(this, snapshot, input);
  }
  /**
   * @param {Snapshot} snapshot
   * @param {unknown} input
   */
  results(snapshot, input) {
    return recordResults(this, snapshot, input);
  }
  /**
   * @param {Snapshot} snapshot
   * @param {string} id
   * @param {string} op
   * @param {unknown} input
   */
  apply(snapshot, id, op, input) {
    return applyAction(this, snapshot, id, op, input);
  }
}
