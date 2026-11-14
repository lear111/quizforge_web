/** @typedef {import('../types/data.js').ListeningResource} ListeningResource */
/** @typedef {import('./bank.service.js').LibrarySnapshots} LibrarySnapshots */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @typedef {import('../types/data.js').Artifact} Artifact */
/** @typedef {import('../types/data.js').Resolution} Resolution */
/** @typedef {import('../types/data.js').CheckedQuestion} CheckedQuestion */
/** @typedef {import('../../../shared/v2/api.js').QuestionReadResponse} QuestionReadResponse */
/** @typedef {import('../../../shared/v2/api.js').QuestionResponse} QuestionResponse */
/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
/** @typedef {import('../utils/errors.js').V2Error} V2Error */
/** @typedef {import('../../../shared/v2/api.js').InkResponse} InkResponse */
/** @typedef {import('./practice.service.js').PracticeState} PracticeState */
import { cloneJson, hash, projectJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { questionRecord } from '../repositories/bank.repository.js';
import { relativePath } from '../utils/io.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { measureOverview } from '../utils/timing.js';
/**
 * @param {LibrarySnapshots} library
 * @param {Snapshot} snapshot
 * @param {Record<string, unknown>} record
 * @returns {Artifact}
 */
export function resolution(library, snapshot, record) {
  let value = snapshot.resolutions.get(/** @type {string} */ (record.type));
  if (library.development && value?.artifact?.development) {
    value = library.types
      .resolutions([/** @type {string} */ (record.type)])
      .get(/** @type {string} */ (record.type));
    snapshot.resolutions.set(
      /** @type {string} */ (record.type),
      /** @type {Resolution} */ (value),
    );
  }
  if (!value) {
    throw problem(
      'EXTENSION_NOT_FOUND',
      '题型未安装或 type 不是 id@主版本号。',
      { field: 'type' },
      404,
    );
  }
  if (value.error) {
    throw problem(
      value.error.code,
      value.error.message,
      { field: value.error.field, details: value.error.details },
      value.error.code === 'EXTENSION_NOT_FOUND' ? 404 : 422,
    );
  }
  return value.artifact;
}
/**
 * @param {LibrarySnapshots} library
 * @param {Snapshot} snapshot
 * @param {string} id
 * @param {CheckedQuestion} record
 * @param {boolean} [includeSolution]
 * @returns {Map<string, {reference: string, file: string, relative: string}>}
 */
export function visibleAssets(
  library,
  snapshot,
  id,
  record,
  includeSolution = Boolean(library.stateStore?.get(snapshot, id).submissionId),
) {
  const /** @type {Map<string, {reference: string, file: string, relative: string}>} */ assets =
      new Map();
  /**
   * @param {unknown} value
   */
  const visit = (value) => {
    if (typeof value === 'string' && value.startsWith('qf-asset:')) {
      const relative = value.slice(9),
        file = relativePath(snapshot.directory, relative),
        assetId = hash(Buffer.from(id + '\0' + value));
      if (relative.toLowerCase() === 'bank.json') {
        throw problem('ASSET_PATH_INVALID', '题库数据文件不能作为提交前可见的资源。', {
          field: 'question',
        });
      }
      assets.set(assetId, { reference: value, file, relative });
    } else if (Array.isArray(value)) {
      for (const child of value) {
        visit(child);
      }
    } else if (object(value)) {
      for (const child of Object.values(value)) {
        visit(child);
      }
    }
  };
  visit(record.question);
  if (includeSolution) {
    visit(record.solution);
  }
  return assets;
}
/**
 * @overload
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {unknown} snapshotId
 * @param {{includeInk?: true}} [options]
 * @returns {QuestionReadResponse}
 */
/**
 * @overload
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {unknown} snapshotId
 * @param {{includeInk?: boolean}} [options]
 * @returns {QuestionResponse}
 */
/**
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {unknown} snapshotId
 * @param {{includeInk?: boolean}} [options]
 * @returns {QuestionResponse}
 */
export function question(library, bankId, id, snapshotId, { includeInk = true } = {}) {
  const snapshot = library.snapshot(bankId, snapshotId);
  try {
    const record = questionRecord(snapshot, id),
      artifact = library.resolution(snapshot, record),
      assets = library.visibleAssets(snapshot, id, record);
    const saved = library.stateStore?.get(snapshot, id);
    const ink = includeInk
      ? measureOverview(
          'ink-body',
          () => library.stateStore?.ink.read(snapshot, id) ?? { ink: null, inkRevision: 0 },
        )
      : null;
    return {
      bankId,
      snapshotId: /** @type {string} */ (snapshotId),
      questionId: id,
      type: /** @type {string} */ (record.type),
      extension: cloneJson(artifact.descriptor),
      item: cloneJson(/** @type {OutlineItem} */ (snapshot.items.get(id))),
      question: cloneJson(record.question),
      solution: saved?.submissionId ? cloneJson(record.solution) : null,
      answer: cloneJson(saved?.answer ?? null),
      ...(ink ? cloneJson(projectJson(ink, ['ink', 'inkRevision'])) : {}),
      state: library.state(snapshot, id),
      submissionId: saved?.submissionId ?? null,
      result: cloneJson(saved?.result ?? null),
      resources: [...assets].map(([assetId, { reference }]) => ({ assetId, reference })),
    };
  } catch (error) {
    if (/** @type {V2Error} */ (error).context) {
      /** @type {V2Error} */ (error).context = {
        .../** @type {V2Error} */ (error).context,
        bankId,
        questionId: id,
      };
    }
    throw error;
  }
}
/**
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {string} op
 * @param {unknown} input
 * @returns {QuestionResponse | InkResponse}
 */
export function write(library, bankId, id, op, input) {
  const snapshot = library.snapshot(
    bankId,
    /** @type {{snapshotId?: unknown} | null} */ (input)?.snapshotId,
  );
  // Validate the question and installed type before touching persistence.
  const record = questionRecord(snapshot, id);
  library.resolution(snapshot, record);
  library.visibleAssets(snapshot, id, record);
  if (op === 'ink') {
    const saved = /** @type {PracticeState} */ (library.stateStore).ink.apply(snapshot, id, input);
    return { inkRevision: saved.inkRevision, state: library.state(snapshot, id) };
  }
  /** @type {PracticeState} */ (library.stateStore).apply(snapshot, id, op, input);
  return library.question(bankId, id, snapshot.snapshotId, { includeInk: op === 'retry' });
}
/**
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {unknown} snapshotId
 * @param {string} assetId
 */
export function asset(library, bankId, id, snapshotId, assetId) {
  const snapshot = library.snapshot(bankId, snapshotId),
    record = questionRecord(snapshot, id);
  library.resolution(snapshot, record);
  const publicAssets = library.visibleAssets(snapshot, id, record, false);
  const publicAsset = publicAssets.get(assetId);
  const asset = publicAsset ?? library.visibleAssets(snapshot, id, record).get(assetId);
  if (!asset) {
    throw problem('RESOURCE_NOT_FOUND', '该题的可见资源不存在。', { bankId, questionId: id }, 404);
  }
  // Solution-only assets must never bypass the lock check via browser cache
  // after retry. Question assets remain public throughout this snapshot.
  return {
    file: relativeFile(snapshot.directory, asset.relative),
    expectedHash: publicAsset ? snapshot.hashes.get(asset.relative) : undefined,
  };
}
/**
 * @param {LibrarySnapshots} library
 * @param {string} bankId
 * @param {string} id
 * @param {unknown} snapshotId
 * @returns {ListeningResource}
 */
export function listening(library, bankId, id, snapshotId) {
  const snapshot = library.snapshot(bankId, snapshotId),
    material = snapshot.listening.get(id);
  if (!material) {
    throw problem('RESOURCE_NOT_FOUND', '听力材料不存在或未被大纲引用。', { bankId }, 404);
  }
  return material.remote
    ? { kind: 'remote', src: material.src, title: material.title }
    : { file: relativeFile(snapshot.directory, material.src) };
}
/**
 * @param {LibrarySnapshots} library
 * @param {string} id
 * @returns {Artifact}
 */
export function artifact(library, id) {
  for (const snapshot of library.opened.values()) {
    for (const value of snapshot.resolutions.values()) {
      if (value.artifact?.descriptor.artifactId === id) {
        return value.artifact;
      }
    }
  }
  throw problem('EXTENSION_NOT_FOUND', '拓展工件不存在，请重新打开题库。', {}, 404);
}
