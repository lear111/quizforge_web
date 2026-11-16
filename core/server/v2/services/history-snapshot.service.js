/** @typedef {import('./bank.service.js').LibrarySnapshots} Library */
/** @typedef {import('../types/history.js').HistoryRound} HistoryRound */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
/** @typedef {import('../types/data.js').SdkEntry} SdkEntry */
import { hash, fingerprint } from '../../host/platform/json.js';
import { TypeRegistry } from '../repositories/extension.repository.js';
import { object, publicError } from '../utils/errors.js';

/** @param {Library} library @param {HistoryRound} round */
function archivedTypes(library, round) {
  const registry = new TypeRegistry(round.directory, library.cache);
  registry.rebuild();
  const types = new Set(
    Object.values(round.raw.questions ?? {}).flatMap((q) =>
      object(q) && typeof q.type === 'string' ? [q.type] : [],
    ),
  );
  const resolutions = registry.resolutions(types, { scanOnMiss: false });
  /** @type {Map<string, SdkEntry>} */
  const sdk = new Map();
  for (const [type, value] of resolutions) {
    if (!value.artifact) {
      continue;
    }
    try {
      for (const [component, version] of Object.entries(value.artifact.sdkVersions)) {
        sdk.set(`${component}@${version}`, library.sharedSdks.get(component, version));
      }
      // An archived development extension is frozen too; never re-resolve it
      // through the current installed registry, nor alias its live artifact ID.
      value.artifact.development = false;
      value.artifact.descriptor = {
        ...value.artifact.descriptor,
        artifactId:
          'e_' +
          hash(
            Buffer.from(
              round.bankId + '\0' + round.roundId + '\0' + value.artifact.descriptor.artifactId,
            ),
          ),
      };
    } catch (error) {
      resolutions.set(type, { error: publicError(error) });
    }
  }
  return { resolutions, sdk };
}

/** @param {Library} library @param {HistoryRound} round @returns {Snapshot} */
export function historySnapshot(library, round) {
  const { resolutions, sdk } = archivedTypes(library, round);
  return {
    ...round,
    directory: round.sourceDirectory,
    practiceEpoch: null,
    snapshotId: fingerprint(
      {
        roundId: round.roundId,
        bank: round.raw,
        types: [...resolutions].map(([id, value]) => [
          id,
          value.artifact?.descriptor ?? value.error,
        ]),
      },
      'quizforge-v2-history',
    ),
    contentFingerprint: round.state.contentFingerprint,
    resolutions,
    sdk,
    hashes: new Map(),
  };
}
