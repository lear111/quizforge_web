/** @typedef {import('../types/restart.js').RestartJournal} RestartJournal */
import fs from 'node:fs';
import path from 'node:path';
import { readBytes, replaceFile, checkedStat } from '../../host/platform/files.js';
import { parseJson, jsonBytes } from '../../host/platform/json.js';
import { object } from '../utils/errors.js';
import { archiveError, directory, exists, move, removeTree } from './restart-files.repository.js';
import { deletedRound, roundPattern } from './history-delete.repository.js';

/** @param {string} bank @param {string} roundId */
export function restartPaths(bank, roundId) {
  if (!roundPattern.test(roundId)) {
    throw archiveError();
  }
  const root = path.join(bank, '.qf-v2');
  return {
    root,
    journal: path.join(root, 'restart.json'),
    practice: path.join(root, 'practice'),
    stage: path.join(root, `.restart-${roundId}`),
    archive: path.join(root, `.restart-${roundId}`, 'archive'),
    fresh: path.join(root, `.restart-${roundId}`, 'fresh'),
    backup: path.join(root, `.restart-${roundId}`, 'previous-practice'),
    round: path.join(root, 'rounds', roundId),
  };
}

/** @param {unknown} value @returns {value is import('../types/restart.js').RestartReceipt} */
function receipt(value) {
  return (
    object(value) &&
    typeof value.requestKey === 'string' &&
    /^[0-9a-f]{64}$/.test(value.requestKey) &&
    typeof value.snapshotId === 'string' &&
    typeof value.roundId === 'string' &&
    roundPattern.test(value.roundId)
  );
}

/** @param {string} bank @returns {RestartJournal | null} */
export function readJournal(bank) {
  checkedStat(bank);
  checkedStat(path.join(bank, '.qf-v2'), { optional: true });
  const bytes = readBytes(path.join(bank, '.qf-v2', 'restart.json'), 64 * 1024, true);
  if (!bytes) {
    return null;
  }
  const value = parseJson(bytes);
  if (
    !receipt(value) ||
    !object(value) ||
    !['prepared', 'committed'].includes(String(value.phase)) ||
    !(value.previous === null || receipt(value.previous))
  ) {
    throw archiveError();
  }
  return {
    requestKey: value.requestKey,
    snapshotId: value.snapshotId,
    roundId: value.roundId,
    phase: value.phase === 'prepared' ? 'prepared' : 'committed',
    previous: receipt(value.previous) ? value.previous : null,
  };
}

/** @param {string} bank @param {RestartJournal} value */
export function writeJournal(bank, value) {
  replaceFile(restartPaths(bank, value.roundId).journal, jsonBytes(value));
}

/** Recover before opening state or accepting writes. Prepared means rollback;
 * committed means cleanup only, and its epoch remains the durable replay key.
 * @param {string} bank @returns {{epoch: string | null, cleanupPending: boolean}} */
export function recoverRestart(bank) {
  const record = readJournal(bank);
  if (!record) {
    return { epoch: null, cleanupPending: false };
  }
  const p = restartPaths(bank, record.roundId);
  if (record.phase === 'prepared') {
    rollback(p);
    if (record.previous) {
      writeJournal(bank, { ...record.previous, phase: 'committed', previous: null });
    } else {
      fs.unlinkSync(p.journal);
    }
    return { epoch: record.previous?.roundId ?? null, cleanupPending: false };
  }
  // A tombstone proves a deliberate deletion without changing the replay epoch.
  // Leave residue cleanup to the history endpoints; it cannot block practice.
  if (!deletedRound(p.round, record.roundId)) {
    for (const file of ['bank.json', 'state.json', 'extensions']) {
      checkedStat(path.join(p.round, file));
    }
  }
  try {
    removeTree(p.stage);
    return { epoch: record.roundId, cleanupPending: false };
  } catch {
    // Do not turn a committed restart into an apparent failure, nor remove the
    // new practice. A later open retries safe cleanup of this one staging tree.
    return { epoch: record.roundId, cleanupPending: true };
  }
}

/** @param {ReturnType<typeof restartPaths>} p */
function rollback(p) {
  directory(p.root);
  if (exists(p.backup)) {
    if (exists(p.practice)) {
      if (fs.readdirSync(p.practice).length) {
        throw archiveError();
      }
      removeTree(p.practice);
    }
    move(p.backup, p.practice);
  }
  if (exists(p.round)) {
    // Only the journal's exact round can have been published before commit.
    removeTree(p.round);
  }
  removeTree(p.stage);
}
