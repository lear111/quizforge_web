/** @typedef {import('../types/data.js').PracticeLibrary} PracticeLibrary */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { jsonBytes, patchJson, shallowCopyJson, fingerprint } from '../../host/platform/json.js';
import { READ_LIMITS, treeIdentity } from '../utils/io.js';
import { scopeOf } from '../utils/round.js';
import { STATE_BYTES } from '../utils/limits.js';
import { object, problem, V2Error } from '../utils/errors.js';
import { statusAfterResult } from './practice-result.service.js';
import { readSnapshot } from './bank-open.service.js';
import {
  archiveError,
  copyFile,
  copyTree,
  directory,
  move,
  removeTree,
  writeFile,
  checkPractice,
} from '../repositories/restart-files.repository.js';
import {
  readJournal,
  restartPaths,
  writeJournal,
  recoverRestart,
} from '../repositories/restart-journal.repository.js';

/** Only unresolved scores change, in a detached candidate, never the practice.
 * @param {PracticeLibrary} library @param {Snapshot} snapshot */
function finalState(library, snapshot) {
  const store = library.stateStore;
  const root = store.loadRound(snapshot, { refresh: true });
  if (!root.completedAt) {
    throw problem('PRACTICE_NOT_COMPLETED', '请先完成练习，再归档并开始新一轮。', {}, 409);
  }
  if (root.contentFingerprint !== snapshot.contentFingerprint) {
    throw problem('SNAPSHOT_STALE', '本轮作答与题库快照不一致，原记录已保留。', {}, 409);
  }
  const questions = shallowCopyJson(root.questions);
  for (const [id, item] of snapshot.items) {
    const old = store.get(snapshot, id);
    if (old.result?.score != null) {
      continue;
    }
    const result = {
      score: 0,
      parts: item.parts ? Object.fromEntries(item.parts.map((p) => [p.id, 0])) : null,
      message: null,
    };
    Object.defineProperty(questions, id, {
      value: patchJson(old, { result, status: statusAfterResult(item, old.status, result) }),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return patchJson(root, { questions });
}

/** @param {PracticeLibrary} library @param {Snapshot} snapshot @param {string} target */
function copyExtensions(library, snapshot, target) {
  directory(target);
  const copied = new Set();
  for (const { artifact } of snapshot.resolutions.values()) {
    if (!artifact) {
      throw problem('EXTENSION_NOT_FOUND', '本轮使用的题型拓展缺失，原练习已保留。', {}, 409);
    }
    if (copied.has(artifact.directory)) {
      continue;
    }
    copied.add(artifact.directory);
    const current = treeIdentity(artifact.directory, library.cache).hashes;
    if (jsonBytes([...current]).compare(jsonBytes([...artifact.hashes])) !== 0) {
      throw problem('SNAPSHOT_STALE', '本轮使用的题型拓展已变化，不能用新版本替代归档。', {}, 409);
    }
    const relative = path.relative(library.types.root, artifact.directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw archiveError();
    }
    for (const [name, expected] of artifact.hashes) {
      copyFile(
        path.join(artifact.directory, name),
        path.join(target, relative, name),
        READ_LIMITS.assetBytes,
        expected,
      );
    }
  }
}

/** @param {PracticeLibrary} library @param {Snapshot} snapshot
 * @param {ReturnType<typeof restartPaths>} p */
function prepare(library, snapshot, p) {
  const bytes = jsonBytes(finalState(library, snapshot));
  checkPractice(p.active);
  if (bytes.length > STATE_BYTES) {
    throw archiveError();
  }
  directory(p.archive);
  if (p.scope === 'practice') {
    directory(p.fresh);
  }
  copyFile(
    path.join(snapshot.directory, 'bank.json'),
    path.join(p.archive, 'bank.json'),
    READ_LIMITS.bankBytes,
    snapshot.hashes.get('bank.json'),
  );
  writeFile(path.join(p.archive, 'state.json'), bytes);
  copyExtensions(library, snapshot, path.join(p.archive, 'extensions'));
  copyTree(path.join(p.active, 'ink'), path.join(p.archive, 'ink'), STATE_BYTES);
  directory(path.join(p.archive, 'ink'));
}

/** Injection is instance-local for deterministic failure/crash tests only.
 * @param {PracticeLibrary} library @param {Snapshot} snapshot
 * @param {{requestId: string, snapshotId: string}} input
 * @param {(phase: string) => void} [checkpoint] */
export function archivePractice(library, snapshot, input, checkpoint = () => {}) {
  const previous = readJournal(snapshot.directory);
  const p = restartPaths(snapshot.directory, randomUUID(), scopeOf(snapshot));
  const receipt = {
    requestKey: fingerprint(input.requestId, 'quizforge-v2-restart-request'),
    snapshotId: input.snapshotId,
    roundId: path.basename(p.round),
    ...(snapshot.exam ? { scope: /** @type {const} */ ('exam') } : {}),
    previous: previous
      ? {
          requestKey: previous.requestKey,
          snapshotId: previous.snapshotId,
          roundId: previous.roundId,
          ...(previous.scope ? { scope: previous.scope } : {}),
        }
      : null,
  };
  try {
    prepare(library, snapshot, p);
    checkpoint('copied');
    writeJournal(snapshot.directory, { ...receipt, phase: 'prepared' });
    checkpoint('prepared');
    move(p.active, p.backup);
    checkpoint('backed-up');
    if (p.scope === 'practice') {
      move(p.fresh, p.active);
    }
    checkpoint('fresh');
    directory(path.dirname(p.round));
    move(p.archive, p.round);
    checkpoint('published');
    writeJournal(snapshot.directory, { ...receipt, phase: 'committed' });
  } catch (error) {
    // A failure before journaling never touched practice. A prepared journal
    // remains recoverable if rollback itself cannot finish (e.g. permissions).
    recoverRestart(snapshot.directory);
    removeTree(p.stage);
    if (error instanceof V2Error) {
      throw error;
    }
    throw archiveError();
  }
  checkpoint('committed');
  library.stateStore.evict(snapshot.directory);
  library.opened.delete(snapshot.bankId);
  const recovery = recoverRestart(snapshot.directory);
  return recovery.cleanupPending;
}

/** A cold restart must not call open(): normal open reconciles changed content
 * by clearing practice, which is forbidden before a failed archive.
 * @param {PracticeLibrary} library @param {import('../types/data.js').BankLocation} location
 * @param {string} snapshotId */
function restartSnapshot(library, location, snapshotId) {
  if (library.opened.has(location.bankId)) {
    return library.snapshot(location.bankId, snapshotId);
  }
  if (!library.indexed) {
    library.rebuildIndexes();
  }
  const snapshot = readSnapshot(library, location, location.bankId, false);
  if (snapshot.snapshotId !== snapshotId) {
    throw problem('SNAPSHOT_STALE', '归档快照已变化，原练习已保留，请检查原题库和拓展。', {}, 409);
  }
  library.rememberSnapshot(location.bankId, snapshot);
  return snapshot;
}

/** @param {PracticeLibrary} library @param {string} bankId @param {unknown} input */
export function restartPractice(library, bankId, input) {
  if (
    !object(input) ||
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    typeof input.snapshotId !== 'string'
  ) {
    throw problem('INVALID_REQUEST', '归档请求标识或快照无效。', {}, 400);
  }
  const location = library.locations().find((row) => row.bankId === bankId);
  if (!location) {
    throw problem('BANK_NOT_FOUND', '题库不存在。', {}, 404);
  }
  const recovery = recoverRestart(location.directory);
  const receipt = readJournal(location.directory);
  if (receipt?.requestKey === fingerprint(input.requestId, 'quizforge-v2-restart-request')) {
    if (receipt.snapshotId !== input.snapshotId) {
      throw problem('REQUEST_CONFLICT', '同一请求标识不能用于不同归档。', {}, 409);
    }
    const overview = library.open(bankId);
    if (recovery.cleanupPending) {
      overview.notice = '归档成功，临时备份尚未清理；原记录和新练习均已保留。';
    }
    return overview;
  }
  if (recovery.cleanupPending) {
    throw archiveError();
  }
  const snapshot = restartSnapshot(library, location, input.snapshotId);
  const cleanupPending = archivePractice(library, snapshot, {
    requestId: input.requestId,
    snapshotId: input.snapshotId,
  });
  const overview = library.open(bankId);
  if (cleanupPending) {
    overview.notice = '归档成功，临时备份尚未清理；原记录和新练习均已保留。';
  }
  return overview;
}
