/** @typedef {import('../types/data.js').OverviewResult} OverviewResult */
/** @typedef {import('../types/data.js').OpenedSnapshot} OpenedSnapshot */
/** @typedef {import('../types/data.js').OverviewOptions} OverviewOptions */
/** @typedef {import('./bank.service.js').LibrarySnapshots} LibrarySnapshots */
/** @typedef {import('../types/data.js').ReadBank} ReadBank */
/** @typedef {import('../types/data.js').SdkEntry} SdkEntry */
/** @typedef {import('../types/data.js').Resolution} Resolution */
/** @typedef {import('../types/data.js').BankLocation} BankLocation */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @import { QuestionCandidate } from '../../../shared/v2/api.js' */
/** @typedef {import('../../../shared/v2/api.js').QuestionReadResponse} QuestionReadResponse */
import { cloneJson, fingerprint } from '../../host/platform/json.js';
import { object, publicError, problem } from '../utils/errors.js';
import { treeIdentity, READ_LIMITS } from '../utils/io.js';
import { relativeFile } from '../repositories/resource.repository.js';
import { readBank, validId } from '../repositories/bank.repository.js';
import { measureOverview } from '../utils/timing.js';
import { optionalProperty } from '../utils/properties.js';
import { activeExam, examNow } from './exam.service.js';
import { recoverRestart } from '../repositories/restart-journal.repository.js';
/**
 * @param {LibrarySnapshots} library
 * @param {ReadBank} bank
 * @param {boolean} rebuild
 */
function resolveTypes(library, bank, rebuild) {
  const types = measureOverview('extension-resolve', () => {
    const /** @type {Set<string>} */ ids = new Set();
    for (const raw of Object.values(bank.raw.questions ?? {})) {
      if (object(raw) && typeof raw.type === 'string') {
        ids.add(raw.type);
      }
    }
    return ids;
  });
  const resolutions = library.types.resolutions(types, { scanOnMiss: !rebuild }),
    /** @type {Map<string, SdkEntry>} */ sdk = new Map();
  resolveSdks(library, resolutions, sdk);
  return { resolutions, sdk };
}
/**
 * @param {string} bankId
 * @param {string} tree
 * @param {Map<string, Resolution>} resolutions
 * @param {Map<string, SdkEntry>} sdk
 * @param {string | null} practiceEpoch
 * @param {Snapshot['exam']} exam
 */
function snapshotIdentity(bankId, tree, resolutions, sdk, practiceEpoch, exam) {
  const snapshotId = measureOverview('snapshot-id', () =>
    fingerprint(
      {
        bankId,
        ...(practiceEpoch ? { practiceEpoch } : {}),
        ...(exam ? { exam } : {}),
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
/**
 * @param {LibrarySnapshots} library
 * @param {BankLocation} location
 * @param {Map<string, Resolution>} resolutions
 */
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
          .map(
            /** @returns {[string, string | undefined]} */ ([id, value]) => [
              id,
              value.artifact?.contentDigest ?? value.error?.code,
            ],
          )
          .sort(([a], [b]) => a.localeCompare(b)),
      },
      'quizforge-v2-content',
    ),
  );
  return contentFingerprint;
}
/**
 * @param {LibrarySnapshots} library
 * @param {BankLocation} location
 * @param {string} bankId
 * @param {boolean} rebuild
 * @returns {Snapshot}
 */
export function readSnapshot(library, location, bankId, rebuild) {
  const { epoch: practiceEpoch } = recoverRestart(location.directory);
  const { digest: tree, hashes } = measureOverview('bank-tree', () =>
    treeIdentity(location.directory, library.cache, { bankId, field: 'bank.files' }),
  );
  const bank = measureOverview('bank-json', () =>
    readBank(location.directory, library.cache, bankId),
  );

  const { resolutions, sdk } = resolveTypes(library, bank, rebuild);
  const exam = activeExam(library.stateStore, location.directory);
  const snapshotId = snapshotIdentity(bankId, tree, resolutions, sdk, practiceEpoch, exam);
  const contentFingerprint = contentIdentity(library, location, resolutions);
  const snapshot = {
    ...bank,
    ...location,
    snapshotId,
    practiceEpoch,
    ...(exam ? { exam } : {}),
    contentFingerprint,
    resolutions,
    sdk,
    hashes,
  };
  return snapshot;
}
/**
 * @param {LibrarySnapshots} library
 * @param {OpenedSnapshot} snapshot
 * @param {OverviewOptions} options
 * @returns {OverviewResult}
 */
export function overviewResponse(
  library,
  bank,
  {
    requestedQuestionId,
    lastQuestionId,
    includeInitial,
    refresh,
    previous,
    activeRoundInterrupted,
  },
) {
  const { bankId, snapshotId, activeCleared } = bank;
  const questionId = requestedQuestionId ?? lastQuestionId ?? bank.items.keys().next().value;
  // Reading the initial ink can clear a recognized legacy record before outline summaries.
  const initial = initialCandidate(
    library,
    bankId,
    snapshotId,
    includeInitial ? questionId : undefined,
  );
  return {
    bank: cloneJson(bank.info),
    snapshotId,
    exam: examClock(library, bank),
    outline: cloneJson(bank.raw.outline),
    listening: [...bank.listening.values()].map(({ id, title }) => ({ id, title })),
    questionTypes: [...bank.items.keys()].map((id) => {
      const type =
        object(bank.raw.questions) && Object.hasOwn(bank.raw.questions, id)
          ? optionalProperty(bank.raw.questions[id], 'type')
          : undefined;
      return { questionId: id, type: typeof type === 'string' ? type : null };
    }),
    ...library.completion(bank),
    lastQuestionId,
    initial,
    activeCleared,
    notice: activeCleared ? '题库或题型已变化，本轮作答已清空' : null,
    pendingGrading: includeInitial ? library.pendingGrading(bank) : [],
    ...(refresh
      ? {
          changes: {
            activeCleared,
            addedQuestionIds: [...bank.items.keys()].filter((id) => !previous?.items.has(id)),
            removedQuestionIds: previous
              ? [...previous.items.keys()].filter((id) => !bank.items.has(id))
              : [],
            activeRoundInterrupted,
          },
        }
      : {}),
  };
}

/** @param {LibrarySnapshots} library @param {Snapshot} snapshot */
function examClock(library, snapshot) {
  return snapshot.exam && library.stateStore
    ? { ...snapshot.exam, now: examNow(library.stateStore) }
    : null;
}

/** @param {LibrarySnapshots} library @param {string} bankId @param {string} snapshotId
 * @param {string | undefined} questionId */
function initialCandidate(library, bankId, snapshotId, questionId) {
  /** @type {QuestionCandidate<QuestionReadResponse>} */
  let initial = { question: null, error: null };
  if (questionId !== undefined) {
    try {
      initial.question = library.question(bankId, questionId, snapshotId);
    } catch (error) {
      initial.error = publicError(error);
    }
  }
  return initial;
}

/**
 * @param {LibrarySnapshots} library
 * @param {Map<string, Resolution>} resolutions
 * @param {Map<string, SdkEntry>} sdk
 */
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

/**
 * @param {Snapshot} snapshot
 * @param {unknown} requestedQuestionId
 * @param {boolean} refresh
 * @returns {string | undefined}
 */
export function startingQuestion(snapshot, requestedQuestionId, refresh) {
  const bankId = snapshot.bankId;
  if (requestedQuestionId === undefined) {
    return undefined;
  }
  if (!validId(requestedQuestionId) || !snapshot.items.has(requestedQuestionId)) {
    if (!refresh) {
      throw problem(
        'QUESTION_NOT_FOUND',
        '指定的起始题不在题库大纲中。',
        { bankId, questionId: requestedQuestionId },
        404,
      );
    }
    return undefined;
  }

  return requestedQuestionId;
}
