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
/** @typedef {import('../types/data.js').PracticeLibrary} PracticeLibrary */
import { cloneJson, hash, projectJson } from '../../host/platform/json.js';
import { problem } from '../utils/errors.js';
import { resourceReferences } from '../utils/asset-references.js';
import { questionRecord } from '../repositories/bank.repository.js';
import { relativePath } from '../utils/io.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { measureOverview } from '../utils/timing.js';
import { examAnswerClosed } from './exam.service.js';
import { optionalProperty } from '../utils/properties.js';
/**
 * @param {LibrarySnapshots} library
 * @param {Snapshot} snapshot
 * @param {Record<string, unknown>} record
 * @returns {Artifact}
 */
export function resolution(library, snapshot, record) {
  const type = /** @type {string} */ (record.type);
  let value = snapshot.resolutions.get(type);
  if (library.development && value?.artifact?.development) {
    value = library.types.resolutions([type]).get(type);
    snapshot.resolutions.set(type, /** @type {Resolution} */ (value));
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
  includeSolution = mayReveal(library, snapshot, id),
) {
  const /** @type {Map<string, {reference: string, file: string, relative: string}>} */ assets =
      new Map();
  const references = resourceReferences(record.question);
  if (includeSolution) {
    for (const reference of resourceReferences(record.solution)) {
      references.add(reference);
    }
  }
  for (const value of references) {
    const relative = value.slice(9),
      file = relativePath(snapshot.directory, relative),
      assetId = hash(Buffer.from(id + '\0' + value));
    if (relative.toLowerCase() === 'bank.json') {
      throw problem('ASSET_PATH_INVALID', '题库数据文件不能作为提交前可见的资源。', {
        field: 'question',
      });
    }
    assets.set(assetId, { reference: value, file, relative });
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
      artifact = library.resolution(snapshot, record);
    const store = library.stateStore;
    const saved = store?.get(snapshot, id);
    const reveal = mayReveal(library, snapshot, id);
    const assets = library.visibleAssets(snapshot, id, record, reveal);
    const ink = includeInk
      ? measureOverview(
          'ink-body',
          () => library.stateStore?.ink.read(snapshot, id) ?? { ink: null, inkRevision: 0 },
        )
      : null;
    const state = library.state(snapshot, id);
    if (store && snapshot.exam && examAnswerClosed(store, snapshot.exam)) {
      state.locked = true;
    }
    return {
      bankId,
      snapshotId: snapshot.snapshotId,
      questionId: id,
      type: /** @type {string} */ (record.type),
      extension: cloneJson(artifact.descriptor),
      item: cloneJson(/** @type {OutlineItem} */ (snapshot.items.get(id))),
      question: cloneJson(record.question),
      solution: reveal ? cloneJson(record.solution) : null,
      answer: cloneJson(saved?.answer ?? null),
      ...(ink ? cloneJson(projectJson(ink, ['ink', 'inkRevision'])) : {}),
      state,
      submissionId: saved?.submissionId ?? null,
      result: reveal ? cloneJson(saved?.result ?? null) : null,
      resources: [...assets].map(([assetId, { reference }]) => ({ assetId, reference })),
    };
  } catch (error) {
    const failure = /** @type {V2Error} */ (error);
    if (failure.context) {
      failure.context = {
        ...failure.context,
        bankId,
        questionId: id,
      };
    }
    throw error;
  }
}
/**
 * @param {PracticeLibrary} library
 * @param {string} bankId
 * @param {string} id
 * @param {string} op
 * @param {unknown} input
 * @returns {QuestionResponse | InkResponse}
 */
export function write(library, bankId, id, op, input) {
  const snapshot = library.snapshot(bankId, optionalProperty(input, 'snapshotId'));
  // Validate the question and installed type before touching persistence.
  const record = questionRecord(snapshot, id);
  library.resolution(snapshot, record);
  library.visibleAssets(snapshot, id, record);
  if (op === 'ink') {
    const saved = library.stateStore.ink.apply(snapshot, id, input);
    return { inkRevision: saved.inkRevision, state: library.state(snapshot, id) };
  }
  library.stateStore.apply(snapshot, id, op, input);
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
  const historical = library.history.artifact(id);
  if (historical) {
    return historical;
  }
  for (const snapshot of library.opened.values()) {
    for (const value of snapshot.resolutions.values()) {
      if (value.artifact?.descriptor.artifactId === id) {
        return value.artifact;
      }
    }
  }
  throw problem('EXTENSION_NOT_FOUND', '拓展工件不存在，请重新打开题库。', {}, 404);
}

/** @param {LibrarySnapshots} library @param {Snapshot} snapshot @param {string} id */
function mayReveal(library, snapshot, id) {
  const store = library.stateStore;
  return Boolean(
    store?.get(snapshot, id).submissionId &&
    (!snapshot.exam || store.loadRound(snapshot).completedAt),
  );
}
