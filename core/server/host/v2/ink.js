import fs from 'node:fs';
import path from 'node:path';
import { checkPath, checkedStat, readBytes, replaceFile, within } from '../platform/files.js';
import {
  cloneJson,
  fingerprint,
  freezeJson,
  hash,
  jsonBytes,
  parseJson,
  projectJson,
} from '../platform/json.js';
import { object, problem } from './errors.js';
import { measureSave } from './timing.js';
import { statIdentity } from '../platform/file-cache.js';
import { appendReceipt, replayed, validOldReceipts, validReceipts } from './receipts.js';

const LIMIT = 32 * 1024 * 1024;
const empty = () => ({ ink: null, inkRevision: 0, receipts: [] });
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
// No ink bodies are cached. The bank LRU owns only a directory-name index.
export class PracticeInk {
  constructor({ write = replaceFile } = {}) {
    this.write = write;
    this.indexes = new Map();
  }
  directory(snapshot) {
    const base = checkPath(snapshot.directory, { directory: true }),
      local = path.join(base, '.qf-v2');
    checkedStat(local, { directory: true, optional: true });
    const ink = path.join(local, 'ink');
    checkedStat(ink, { directory: true, optional: true });
    return ink;
  }
  file(snapshot, id) {
    const directory = path.join(this.directory(snapshot), snapshot.contentFingerprint);
    checkedStat(directory, { directory: true, optional: true });
    return path.join(directory, hash(Buffer.from(id)) + '.json');
  }
  clear(snapshot) {
    const root = this.directory(snapshot),
      entries = [];
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
      this.indexes.delete(snapshot.directory);
    } catch {
      throw problem('STATE_WRITE_FAILED', '草稿笔迹未能清除，请重试。', {}, 503);
    }
  }
  open(snapshot) {
    const root = this.directory(snapshot);
    if (!fs.existsSync(root)) {
      this.indexes.set(snapshot.directory, new Set());
      return false;
    }
    const names = fs.readdirSync(root);
    if (names.some((name) => name !== snapshot.contentFingerprint)) {
      this.clear(snapshot);
      this.indexes.set(snapshot.directory, new Set());
      return true;
    }
    const directory = path.join(root, snapshot.contentFingerprint);
    const index = new Set();
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
    this.indexes.set(snapshot.directory, index);
    return false;
  }
  has(snapshot, id) {
    return this.indexes.get(snapshot.directory)?.has(hash(Buffer.from(id))) ?? false;
  }
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
      return freezeJson(value);
    } catch (error) {
      if (error.code === 'STATE_WRITE_FAILED') {
        throw error;
      }
      throw problem('STATE_INVALID', '草稿笔迹无法读取，原文件已保留。', {}, 503);
    }
  }
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
      this.indexes.get(snapshot.directory)?.delete(hash(Buffer.from(id)));
    } catch {
      throw problem('STATE_WRITE_FAILED', '草稿笔迹未能清除，请重试。', {}, 503);
    }
  }
  apply(snapshot, id, input) {
    if (
      !object(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      !Object.hasOwn(input, 'ink')
    ) {
      throw problem('INVALID_REQUEST', '请求标识无效或缺少草稿笔迹。', {}, 400);
    }
    const old = this.read(snapshot, id),
      signature = fingerprint({ op: 'ink', input }, 'quizforge-v2-receipt'),
      key = input.requestId;
    if (replayed(old.receipts, key, signature)) {
      return old;
    }
    if (!integer(input.expectedInkRevision) || input.expectedInkRevision !== old.inkRevision) {
      throw problem('REVISION_CONFLICT', '草稿笔迹已变化，请重新打开本题。', {}, 409);
    }
    if (!integer(old.inkRevision + 1)) {
      throw problem('STATE_INVALID', '笔迹版本无法继续递增。', {}, 503);
    }
    const value = Object.assign(cloneJson(projectJson(input, ['ink'])), {
      inkRevision: old.inkRevision + 1,
      receipts: appendReceipt(old.receipts, key, signature),
    });
    const bytes = measureSave('serialize', () => jsonBytes(value));
    if (bytes.length > LIMIT) {
      throw problem(
        'STATE_SIZE_LIMIT',
        '本题草稿笔迹超过 32 MiB，本次未保存，原记录保留。',
        {},
        413,
      );
    }
    try {
      measureSave('write', () => this.write(this.file(snapshot, id), bytes));
    } catch {
      throw problem('STATE_WRITE_FAILED', '草稿笔迹未能保存，请重试；原记录保持不变。', {}, 503);
    }
    this.indexes.get(snapshot.directory)?.add(hash(Buffer.from(id)));
    return freezeJson(value);
  }
  evict(directory) {
    this.indexes.delete(directory);
  }
}
