/** @typedef {import('../types/data.js').LoadedState} LoadedState */
import path from 'node:path';
import { readBytes, replaceFile, checkPath, checkedStat } from '../../host/platform/files.js';
import { freezeJson, jsonBytes, parseJson } from '../../host/platform/json.js';
import { problem } from '../utils/errors.js';
import { invalid, empty } from '../utils/state.js';
import { validateState } from './state-shape.repository.js';
import { measureSave } from '../utils/timing.js';
import { STATE_BYTES } from '../utils/limits.js';
import { statIdentity } from '../../host/platform/file-cache.js';
/**
 * @param {string} file
 */
const identity = (file) => {
  const { stat } = checkedStat(file, { optional: true, bigint: true });
  return stat ? statIdentity(stat) : null;
};

export class StateRepository {
  /** @param {{write?: typeof replaceFile}} [options] */
  constructor({ write = replaceFile } = {}) {
    this.write = write;
    /** @type {Map<string, LoadedState>} */
    this.loaded = new Map();
    /** @type {Map<string, string | null>} */
    this.identities = new Map();
  }
  /** @param {string} file @param {LoadedState} value */
  remember(file, value) {
    this.loaded.delete(file);
    this.loaded.set(file, value);
  }
  /** @param {string} directory @param {{atomic?: boolean}} [options] */
  file(directory, { atomic = false } = {}) {
    const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
    // replaceFile's safeDirectory checks this very directory (including links
    // and canonical paths) immediately before creating its temporary file.
    // Still check the bank here so a deleted/moved bank is never recreated.
    if (!atomic) {
      checkedStat(local, { directory: true, optional: true });
    }
    return path.join(local, 'state.json');
  }
  /** @param {string} directory @param {{refresh?: boolean}} [options]
   * @returns {LoadedState} */
  load(directory, { refresh = false } = {}) {
    // A warm immutable graph needs no repeated filesystem resolution. Explicit
    // open/refresh checks identity; every commit still checks the destination.
    const key = path.join(directory, '.qf-v2', 'state.json');
    if (!refresh && this.loaded.has(key)) {
      return /** @type {LoadedState} */ (this.loaded.get(key));
    }
    const file = this.file(directory);
    if (!refresh && this.loaded.has(file)) {
      return /** @type {LoadedState} */ (this.loaded.get(file));
    }
    let value, observed;
    try {
      observed = identity(file);
      if (
        this.loaded.has(file) &&
        this.identities.has(file) &&
        this.identities.get(file) === observed
      ) {
        return /** @type {LoadedState} */ (this.loaded.get(file));
      }
      value = this.readState(file, observed);
      validateState(value);
    } catch {
      this.loaded.delete(file);
      this.identities.delete(file);
      throw invalid();
    }
    freezeJson(value);
    this.remember(file, value);
    this.identities.set(file, observed);
    return value;
  }
  /** @param {string} file @param {string | null} observed @returns {unknown} */
  readState(file, observed) {
    const bytes = readBytes(file, STATE_BYTES, true);
    if (identity(file) !== observed) {
      throw invalid();
    }
    // The persisted questions/id envelope is deeper than the HTTP envelope.
    const cached = this.loaded.get(file);
    const value =
      bytes && cached && jsonBytes(cached).equals(bytes)
        ? cached
        : bytes
          ? parseJson(bytes, { maxDepth: 68 })
          : empty();
    return value;
  }
  /** @param {string} directory @param {LoadedState} value */
  commit(directory, value) {
    const bytes = measureSave('serialize', () => jsonBytes(value));
    if (bytes.length > STATE_BYTES) {
      throw problem(
        'STATE_SIZE_LIMIT',
        '作答记录超过 32 MiB，本次未保存，原记录保留。',
        { details: { limit: STATE_BYTES } },
        413,
      );
    }
    const file = this.file(directory, { atomic: this.write === replaceFile });
    try {
      measureSave('write', () => this.write(file, bytes));
    } catch {
      throw problem('STATE_WRITE_FAILED', '作答未能保存，请重试；原记录保持不变。', {}, 503);
    }
    // Publish only after the atomic replacement succeeds: failures keep both
    // the previous frozen graph and the durable record available for retry.
    freezeJson(value);
    this.remember(file, value);
    // A post-write stat could already describe an external replacement rather
    // than these bytes. Confirm identity AND bytes at the next explicit open;
    // normal question reads and writes continue borrowing the committed graph.
    this.identities.delete(file);
  }

  /** @param {string} directory */
  exists(directory) {
    return this.identities.get(path.join(directory, '.qf-v2', 'state.json')) !== null;
  }
  /** @param {string} directory */
  evict(directory) {
    const file = path.join(directory, '.qf-v2', 'state.json');
    this.loaded.delete(file);
    this.identities.delete(file);
  }
}
