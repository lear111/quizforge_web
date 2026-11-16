/** @typedef {import('../../../shared/v2/state.js').InkFile} InkFile */
/** @typedef {import('../types/data.js').Snapshot} Snapshot */
import fs from 'node:fs';
import path from 'node:path';
import {
  checkPath,
  checkedStat,
  readBytes,
  replaceFile,
  within,
} from '../../host/platform/files.js';
import { freezeJson, hash, parseJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { applyInkFile } from './ink-write.repository.js';
import { statIdentity } from '../../host/platform/file-cache.js';
import { validOldReceipts, validReceipts } from '../utils/receipts.js';
import { integer } from '../utils/state.js';
import { scopeOf } from '../utils/round.js';
import { practiceDirectory } from './practice-directory.repository.js';

/** @param {Snapshot} snapshot */
const inkKey = (snapshot) => path.join(snapshot.directory, scopeOf(snapshot));
const LIMIT = 32 * 1024 * 1024;
/**
 * @returns {InkFile}
 */
const empty = () => ({ ink: null, inkRevision: 0, receipts: [] });
// No ink bodies are cached. The bank LRU owns only a directory-name index.
export class PracticeInk {
  /** @param {{write?: typeof replaceFile}} [options] */
  constructor({ write = replaceFile } = {}) {
    this.write = write;
    /** @type {Map<string, Set<string>>} */
    this.indexes = new Map();
  }
  /** @param {Snapshot} snapshot */
  directory(snapshot) {
    const local = practiceDirectory(snapshot.directory, { scope: scopeOf(snapshot) });
    const ink = path.join(local, 'ink');
    checkedStat(ink, { directory: true, optional: true });
    return ink;
  }
  /** @param {Snapshot} snapshot @param {string} id */
  file(snapshot, id) {
    const directory = path.join(this.directory(snapshot), snapshot.contentFingerprint);
    checkedStat(directory, { directory: true, optional: true });
    return path.join(directory, hash(Buffer.from(id)) + '.json');
  }
  /** @param {Snapshot} snapshot */
  clear(snapshot) {
    const root = this.directory(snapshot),
      /** @type {{file: string, directory: boolean}[]} */ entries = [];
    /** @param {string} file */
    const walk = (file) => {
      if (!within(root, file)) {
        throw Error('Ink path escape');
      }
      const { stat } = checkedStat(file, { optional: true });
      if (!stat) {
        return;
      }
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(file)) {
          walk(path.join(file, name));
        }
      }
      entries.push({ file, directory: stat.isDirectory() });
    };
    try {
      walk(root); // Check the complete tree before deleting anything; never follow links.
      for (const entry of entries) {
        checkedStat(entry.file);
        if (entry.directory) {
          fs.rmdirSync(entry.file);
        } else {
          fs.unlinkSync(entry.file);
        }
      }
      this.indexes.delete(inkKey(snapshot));
    } catch {
      throw problem('STATE_WRITE_FAILED', '草稿笔迹未能清除，请重试。', {}, 503);
    }
  }
  /** @param {Snapshot} snapshot */
  open(snapshot) {
    const root = this.directory(snapshot);
    if (!fs.existsSync(root)) {
      this.indexes.set(inkKey(snapshot), new Set());
      return false;
    }
    const names = fs.readdirSync(root);
    if (names.some((name) => name !== snapshot.contentFingerprint)) {
      this.clear(snapshot);
      this.indexes.set(inkKey(snapshot), new Set());
      return true;
    }
    const directory = path.join(root, snapshot.contentFingerprint);
    const /** @type {Set<string>} */ index = new Set();
    if (names.length) {
      checkPath(directory, { directory: true });
      for (const name of fs.readdirSync(directory)) {
        if (/^[a-f0-9]{64}\.json$/.test(name)) {
          if (!checkedStat(path.join(directory, name)).stat.isFile()) {
            throw problem('STATE_INVALID', '草稿笔迹文件无效，原文件已保留。', {}, 503);
          }
          index.add(name.slice(0, 64));
        }
      }
    }
    this.indexes.set(inkKey(snapshot), index);
    return false;
  }
  /** @param {Snapshot} snapshot @param {string} id */
  has(snapshot, id) {
    return this.indexes.get(inkKey(snapshot))?.has(hash(Buffer.from(id))) ?? false;
  }
  /** @param {Snapshot} snapshot @param {string} id
   * @returns {InkFile} */
  read(snapshot, id) {
    try {
      const file = this.file(snapshot, id);
      const identity = () => {
        const { stat } = checkedStat(file, { optional: true, bigint: true });
        return stat ? statIdentity(stat) : null;
      };
      const before = identity(),
        bytes = readBytes(file, LIMIT, true);
      if (before !== identity()) {
        throw Error('Ink changed while reading');
      }
      if (!bytes) {
        return empty();
      }
      const value = parseJson(bytes, { maxDepth: 68 });
      if (!object(value) || !integer(value.inkRevision) || !Object.hasOwn(value, 'ink')) {
        throw Error();
      }
      if (!validReceipts(value.receipts) || Object.keys(value).length !== 3) {
        // Older ink-only records have no state.json to trigger a bank reset.
        // Recognize them on first access without reading all ink bodies at open.
        if (Object.keys(value).length !== 4 || !validOldReceipts(value, true)) {
          throw Error();
        }
        if (identity() !== before) {
          throw Error();
        }
        this.remove(snapshot, id);
        return empty();
      }
      return freezeJson(/** @type {Record<string, unknown> & InkFile} */ (value));
    } catch (error) {
      if (/** @type {{code?: unknown}} */ (error).code === 'STATE_WRITE_FAILED') {
        throw error;
      }
      throw problem('STATE_INVALID', '草稿笔迹无法读取，原文件已保留。', {}, 503);
    }
  }
  /** @param {Snapshot} snapshot @param {string} id */
  remove(snapshot, id) {
    try {
      const file = this.file(snapshot, id),
        { stat } = checkedStat(file, { optional: true });
      if (stat) {
        if (!stat.isFile()) {
          throw Error();
        }
        fs.unlinkSync(file);
      }
      this.indexes.get(inkKey(snapshot))?.delete(hash(Buffer.from(id)));
    } catch {
      throw problem('STATE_WRITE_FAILED', '草稿笔迹未能清除，请重试。', {}, 503);
    }
  }
  /** @param {Snapshot} snapshot @param {string} id @param {unknown} input */
  apply(snapshot, id, input) {
    return applyInkFile(
      {
        read: () => this.read(snapshot, id),
        file: () => this.file(snapshot, id),
        write: this.write,
        saved: () => this.indexes.get(inkKey(snapshot))?.add(hash(Buffer.from(id))),
      },
      input,
    );
  }
  /** @param {string} directory */
  evict(directory) {
    this.indexes.delete(path.join(directory, 'practice'));
    this.indexes.delete(path.join(directory, 'exam'));
  }
}
