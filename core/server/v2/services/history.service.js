/** @typedef {import('./bank.service.js').LibrarySnapshots} Library */
/** @typedef {import('../types/history.js').HistorySnapshot} HistorySnapshot */
/** @typedef {import('../../../shared/v2/api.js').HistoryOverviewResponse} Overview */
/** @typedef {import('../../../shared/v2/api.js').HistoryQuestionResponse} Question */
import { cloneJson } from '../../host/platform/json.js';
import { questionRecord } from '../repositories/bank.repository.js';
import {
  readRound,
  roundIds,
  readHistoryInk,
  deleteHistoryRound,
} from '../repositories/history.repository.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { historySnapshot } from './history-snapshot.service.js';
import { historicalState, historySummary, historyTotal } from './history-state.service.js';
import { resolution, visibleAssets } from './question.service.js';
import { object, problem, publicError } from '../utils/errors.js';
import { optionalProperty } from '../utils/properties.js';
import { HistoryInk } from '../repositories/history-ink.repository.js';
import { deletedRound } from '../repositories/history-delete.repository.js';

export class HistoryRounds {
  /** @param {Library} library */
  constructor(library) {
    this.library = library;
    this.ink = new HistoryInk();
    /** @type {Map<string, HistorySnapshot>} */
    this.opened = new Map();
  }
  /** @param {string} bankId */
  list(bankId) {
    return roundIds(this.library, bankId)
      .map((roundId) => {
        const round = readRound(this.library, bankId, roundId);
        return { roundId, completedAt: round.state.completedAt, ...historyTotal(round) };
      })
      .sort(
        (a, b) =>
          Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
          a.roundId.localeCompare(b.roundId),
      );
  }
  /** @param {string} bankId @param {string} roundId */
  delete(bankId, roundId) {
    deleteHistoryRound(this.library, bankId, roundId);
    this.opened.delete(bankId + ':' + roundId);
  }
  /** @param {string} bankId @param {string} roundId */
  load(bankId, roundId) {
    const round = readRound(this.library, bankId, roundId);
    if (!this.library.indexed) {
      this.library.sharedSdks.rebuild();
    }
    const value = { round, snapshot: historySnapshot(this.library, round) };
    const key = bankId + ':' + roundId;
    this.opened.delete(key);
    this.opened.set(key, value);
    // Same bounded lifetime as the existing eight-bank snapshot cache, but
    // never evict or reconcile the active practice snapshots/state cache.
    if (this.opened.size > 8) {
      this.opened.delete(this.opened.keys().next().value ?? '');
    }
    return value;
  }
  /** @param {string} bankId @param {string} roundId */
  context(bankId, roundId) {
    // Revalidate archived files on every read; a corrupt file must not be
    // hidden by an earlier successful response. This never opens live practice.
    return this.load(bankId, roundId);
  }
  /** @param {string} bankId @param {string} roundId @returns {Overview} */
  overview(bankId, roundId) {
    const { round, snapshot } = this.load(bankId, roundId);
    const first = round.items.keys().next().value;
    /** @type {Overview['initial']} */
    let initial = { question: null, error: null };
    if (first !== undefined) {
      try {
        initial.question = this.question(bankId, roundId, first);
      } catch (error) {
        initial.error = publicError(error);
      }
    }
    return {
      readOnly: true,
      roundId,
      bank: cloneJson(round.info),
      snapshotId: snapshot.snapshotId,
      completedAt: round.state.completedAt,
      total: historyTotal(round),
      outline: cloneJson(round.raw.outline),
      states: [...round.items.keys()].map((id) => historySummary(round, id)),
      questionTypes: [...round.items.keys()].map((id) => ({
        questionId: id,
        type:
          object(round.raw.questions) &&
          typeof optionalProperty(round.raw.questions[id], 'type') === 'string'
            ? String(optionalProperty(round.raw.questions[id], 'type'))
            : null,
      })),
      listening: [...round.listening.values()].map(({ id, title }) => ({ id, title })),
      initial,
      lastQuestionId: first ?? null,
      pendingGrading: [],
      activeCleared: false,
      notice: null,
    };
  }
  /** @param {string} bankId @param {string} roundId @param {string} id @returns {Question} */
  question(bankId, roundId, id) {
    const { round, snapshot } = this.context(bankId, roundId);
    const record = questionRecord(snapshot, id);
    const artifact = resolution(this.library, snapshot, record);
    const saved = historicalState(round, id);
    const resources = [...visibleAssets(this.library, snapshot, id, record, true)].map(
      ([assetId, { reference }]) => ({ assetId, reference }),
    );
    const item = round.items.get(id);
    if (!item) {
      throw problem('QUESTION_NOT_FOUND', '历史题目不存在。', {}, 404);
    }
    return {
      readOnly: true,
      roundId,
      bankId,
      snapshotId: snapshot.snapshotId,
      questionId: id,
      type: String(record.type),
      extension: cloneJson(artifact.descriptor),
      item: cloneJson(item),
      question: cloneJson(record.question),
      solution: cloneJson(record.solution),
      answer: cloneJson(saved.answer),
      submissionId: saved.submissionId,
      result: cloneJson(saved.result),
      state: historySummary(round, id),
      resources,
      ...readHistoryInk(round, id),
    };
  }
  /** @param {string} bankId @param {string} roundId @param {string} id @param {string} assetId */
  asset(bankId, roundId, id, assetId) {
    const { snapshot } = this.context(bankId, roundId);
    const record = questionRecord(snapshot, id);
    const asset = visibleAssets(this.library, snapshot, id, record, true).get(assetId);
    if (asset) {
      try {
        return relativeFile(snapshot.directory, asset.relative);
      } catch {
        /* Missing or unsafe referenced material is never replaced. */
      }
    }
    throw problem('RESOURCE_NOT_FOUND', '素材已不存在', {}, 404);
  }
  /** @param {string} bankId @param {string} roundId @param {string} id @param {unknown} input */
  saveInk(bankId, roundId, id, input) {
    const { round, snapshot } = this.context(bankId, roundId);
    if (optionalProperty(input, 'snapshotId') !== snapshot.snapshotId) {
      throw problem('SNAPSHOT_STALE', '历史快照已变化，请重新打开。', { bankId }, 409);
    }
    questionRecord(snapshot, id);
    const saved = this.ink.apply(round, id, input);
    return { inkRevision: saved.inkRevision, state: historySummary(round, id) };
  }
  /** @param {string} artifactId */
  artifact(artifactId) {
    for (const { round, snapshot } of this.opened.values()) {
      for (const value of snapshot.resolutions.values()) {
        if (value.artifact?.descriptor.artifactId === artifactId) {
          return deletedRound(round.directory, round.roundId) ? undefined : value.artifact;
        }
      }
    }
    return undefined;
  }
}
