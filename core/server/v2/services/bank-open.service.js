import { cloneJson, fingerprint } from '../../host/platform/json.js';
import { object, publicError, problem } from '../utils/errors.js';
import { treeIdentity, READ_LIMITS } from '../utils/io.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { readBank, validId } from '../repositories/bank.repository.js';
import { measureOverview } from '../utils/timing.js';
function resolveTypes(library, bank, rebuild) {
  const types = measureOverview('extension-resolve', () => {
    const ids = new Set();
    for (const raw of Object.values(bank.raw.questions ?? {})) {
      if (object(raw) && typeof raw.type === 'string') {
        ids.add(raw.type);
      }
    }
    return ids;
  });
  const resolutions = library.types.resolutions(types, { scanOnMiss: !rebuild }),
    sdk = new Map();
  resolveSdks(library, resolutions, sdk);
  return { resolutions, sdk };
}
function snapshotIdentity(bankId, tree, resolutions, sdk) {
  const snapshotId = measureOverview('snapshot-id', () =>
    fingerprint(
      {
        bankId,
        tree,
        types: [...resolutions].map(([id, value]) => [
          id,
          value.artifact?.descriptor ?? value.error,
        ]),
        sdk: [...sdk].map(([id, value]) => [id, value.digest]),
      },
      'quizforge-v2-snapshot',
    ),
  );
  return snapshotId;
}
function contentIdentity(library, location, resolutions) {
  // Active-answer identity excludes storage paths, assets and shared SDKs.
  // File bodies follow deterministic traversal order; physical directory names
  // are absent. bank.json's exact bytes always participate.
  const contentFingerprint = measureOverview('content-fingerprint', () =>
    fingerprint(
      {
        bank: library.cache.hash(
          relativeFile(location.directory, 'bank.json'),
          READ_LIMITS.bankBytes,
        ),
        types: [...resolutions]
          .map(([id, value]) => [id, value.artifact?.contentDigest ?? value.error?.code])
          .sort(([a], [b]) => a.localeCompare(b)),
      },
      'quizforge-v2-content',
    ),
  );
  return contentFingerprint;
}
export function readSnapshot(library, location, bankId, rebuild) {
  const { digest: tree, hashes } = measureOverview('bank-tree', () =>
    treeIdentity(location.directory, library.cache, { bankId, field: 'bank.files' }),
  );
  const bank = measureOverview('bank-json', () =>
    readBank(location.directory, library.cache, bankId),
  );

  const { resolutions, sdk } = resolveTypes(library, bank, rebuild);
  const snapshotId = snapshotIdentity(bankId, tree, resolutions, sdk);
  const contentFingerprint = contentIdentity(library, location, resolutions);
  const snapshot = {
    ...bank,
    ...location,
    snapshotId,
    contentFingerprint,
    resolutions,
    sdk,
    hashes,
  };
  return snapshot;
}
export function overviewResponse(
  library,
  snapshot,
  { requestedQuestionId, lastQuestionId, includeInitial, refresh, previous },
) {
  const { bankId, snapshotId, activeCleared } = snapshot;
  const bank = snapshot;
  const questionId = requestedQuestionId ?? lastQuestionId ?? bank.items.keys().next().value;
  let initial = { question: null, error: null };
  if (includeInitial && questionId !== undefined) {
    try {
      initial.question = library.question(bankId, questionId, snapshotId);
    } catch (error) {
      initial.error = publicError(error);
    }
  }
  return {
    bank: cloneJson(bank.info),
    snapshotId,
    outline: cloneJson(bank.raw.outline),
    listening: [...bank.listening.values()].map(({ id, title }) => ({ id, title })),
    questionTypes: [...bank.items.keys()].map((id) => ({
      questionId: id,
      type:
        object(bank.raw.questions) &&
        Object.hasOwn(bank.raw.questions, id) &&
        typeof bank.raw.questions[id]?.type === 'string'
          ? bank.raw.questions[id].type
          : null,
    })),
    ...library.completion(snapshot),
    lastQuestionId,
    initial,
    activeCleared,
    notice: activeCleared ? '题库或题型已变化，本轮作答已清空' : null,
    pendingGrading: includeInitial ? library.pendingGrading(snapshot) : [],
    ...(refresh
      ? {
          changes: {
            activeCleared,
            addedQuestionIds: [...bank.items.keys()].filter((id) => !previous?.items.has(id)),
            removedQuestionIds: previous
              ? [...previous.items.keys()].filter((id) => !bank.items.has(id))
              : [],
            activeRoundInterrupted: false,
          },
        }
      : {}),
  };
}

function resolveSdks(library, resolutions, sdk) {
  for (const [type, resolution] of resolutions) {
    if (resolution.artifact) {
      try {
        for (const [component, version] of Object.entries(resolution.artifact.sdkVersions)) {
          const key = `${component}@${version}`;
          if (!sdk.has(key)) {
            sdk.set(key, library.sharedSdks.get(component, version));
          }
        }
      } catch (error) {
        resolutions.set(type, { error: publicError(error) });
      }
    }
  }
}

export function startingQuestion(snapshot, requestedQuestionId, refresh) {
  const bankId = snapshot.bankId;
  if (
    requestedQuestionId !== undefined &&
    (!validId(requestedQuestionId) || !snapshot.items.has(requestedQuestionId))
  ) {
    if (!refresh) {
      throw problem(
        'QUESTION_NOT_FOUND',
        '指定的起始题不在题库大纲中。',
        { bankId, questionId: requestedQuestionId },
        404,
      );
    }
    requestedQuestionId = undefined;
  }

  return requestedQuestionId;
}
