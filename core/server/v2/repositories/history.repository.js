/** @typedef {import('../services/bank.service.js').LibrarySnapshots} Library */
/** @typedef {import('../types/history.js').HistoryRound} HistoryRound */
/** @typedef {import('../../../shared/v2/state.js').InkFile} InkFile */
import fs from 'node:fs';
import path from 'node:path';
import { checkedStat, readBytes } from '../../host/platform/files.js';
import { cloneJson, freezeJson, hash, parseJson } from '../../host/platform/json.js';
import { statIdentity } from '../../host/platform/file-cache.js';
import { readBank } from './bank.repository.js';
import { validateState } from './state-shape.repository.js';
import { readJournal } from './restart-journal.repository.js';
import { readJson } from '../utils/io.js';
import { STATE_BYTES } from '../utils/limits.js';
import { problem, object } from '../utils/errors.js';
import { integer } from '../utils/state.js';
import { validReceipts } from '../utils/receipts.js';

const roundPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const invalidHistory = () =>
  problem('STATE_INVALID', '历史记录损坏或无法读取，原文件未改动。', {}, 503);

/** @param {Library} library @param {string} bankId */
export function historyLocation(library, bankId) {
  const location = library.locations().find((row) => row.bankId === bankId);
  if (!location) {
    throw problem('BANK_NOT_FOUND', '题库不存在。', {}, 404);
  }
  checkedStat(location.directory, { directory: true });
  checkedStat(path.join(location.directory, '.qf-v2'), { directory: true, optional: true });
  const directory = path.join(location.directory, '.qf-v2', 'rounds');
  const { stat } = checkedStat(directory, { directory: true, optional: true });
  // Observe, never recover or rewrite, the existing restart transaction.
  const journal = readJournal(location.directory);
  return {
    location,
    directory,
    exists: Boolean(stat),
    pending: journal?.phase === 'prepared' ? journal.roundId : null,
  };
}

/** @param {Library} library @param {string} bankId */
export function roundIds(library, bankId) {
  const scope = historyLocation(library, bankId);
  return scope.exists
    ? fs.readdirSync(scope.directory).filter((id) => roundPattern.test(id) && id !== scope.pending)
    : [];
}

/** @param {unknown} raw @returns {asserts raw is HistoryRound['state']} */
function validateRoundState(raw) {
  validateState(raw);
  if (
    'historyIndex' in raw ||
    typeof raw.completedAt !== 'string' ||
    typeof raw.contentFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.contentFingerprint)
  ) {
    throw invalidHistory();
  }
}

/**
 * @param {Library} library @param {string} bankId @param {string} roundId
 * @returns {HistoryRound}
 */
export function readRound(library, bankId, roundId) {
  if (!roundPattern.test(roundId)) {
    throw problem('INVALID_REQUEST', '历史轮次编号无效。', {}, 400);
  }
  const scope = historyLocation(library, bankId);
  const directory = path.join(scope.directory, roundId);
  if (
    roundId === scope.pending ||
    !checkedStat(directory, { directory: true, optional: true }).stat
  ) {
    throw problem('RESOURCE_NOT_FOUND', '历史轮次不存在或尚未归档完成。', {}, 404);
  }
  try {
    const raw = cloneJson(readJson(path.join(directory, 'state.json'), library.cache, STATE_BYTES));
    validateRoundState(raw);
    return {
      ...scope.location,
      directory,
      sourceDirectory: scope.location.directory,
      roundId,
      state: raw,
      ...readBank(directory, library.cache, bankId),
    };
  } catch {
    throw invalidHistory();
  }
}

/** @param {HistoryRound} round @param {string} id */
export function historyInkFile(round, id) {
  const directory = path.join(round.directory, 'ink', round.state.contentFingerprint);
  checkedStat(path.join(round.directory, 'ink'), { directory: true, optional: true });
  checkedStat(directory, { directory: true, optional: true });
  return path.join(directory, hash(Buffer.from(id)) + '.json');
}

/** @param {HistoryRound} round @param {string} id */
export function hasHistoryInk(round, id) {
  return Boolean(checkedStat(historyInkFile(round, id), { optional: true }).stat);
}

/** @param {unknown} raw @returns {asserts raw is Record<string, unknown> & InkFile} */
function validateInkRecord(raw) {
  if (
    !object(raw) ||
    Object.keys(raw).length !== 3 ||
    !Object.hasOwn(raw, 'ink') ||
    !integer(raw.inkRevision) ||
    !validReceipts(raw.receipts)
  ) {
    throw invalidHistory();
  }
}

/** @param {HistoryRound} round @param {string} id
 * @returns {InkFile} */
export function readHistoryInkRecord(round, id) {
  try {
    const file = historyInkFile(round, id);
    const identity = () => {
      const { stat } = checkedStat(file, { optional: true, bigint: true });
      return stat ? statIdentity(stat) : null;
    };
    const before = identity(),
      bytes = readBytes(file, STATE_BYTES, true);
    if (before !== identity()) {
      throw invalidHistory();
    }
    if (!bytes) {
      return { ink: null, inkRevision: 0, receipts: [] };
    }
    const raw = parseJson(bytes, { maxDepth: 68 });
    validateInkRecord(raw);
    return freezeJson(raw);
  } catch {
    throw invalidHistory();
  }
}

/** @param {HistoryRound} round @param {string} id */
export function readHistoryInk(round, id) {
  const { ink, inkRevision } = readHistoryInkRecord(round, id);
  return { ink, inkRevision };
}
