import { cloneJson, hash, projectJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { questionRecord } from '../repositories/bank.repository.js';
import { relativePath } from '../utils/io.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { measureOverview } from '../utils/timing.js';
export function resolution(library, snapshot, record) {
  let value = snapshot.resolutions.get(record.type);
  if (library.development && value?.artifact?.development) {
    value = library.types.resolutions([record.type]).get(record.type);
    snapshot.resolutions.set(record.type, value);
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
export function visibleAssets(
  library,
  snapshot,
  id,
  record,
  includeSolution = Boolean(library.stateStore?.get(snapshot, id).submissionId),
) {
  const assets = new Map();
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
      snapshotId,
      questionId: id,
      type: record.type,
      extension: cloneJson(artifact.descriptor),
      item: cloneJson(snapshot.items.get(id)),
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
    if (error.context) {
      error.context = { ...error.context, bankId, questionId: id };
    }
    throw error;
  }
}
export function write(library, bankId, id, op, input) {
  const snapshot = library.snapshot(bankId, input?.snapshotId);
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
