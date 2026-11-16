import fs from 'node:fs';
import path from 'node:path';
import { checkPath, checkedStat, readBytes } from '../../host/platform/files.js';
import { parseJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { integer } from '../utils/state.js';
import { STATE_BYTES } from '../utils/limits.js';
import { validReceipts, validOldReceipts } from '../utils/receipts.js';
import { validateState } from './state-shape.repository.js';

/** @typedef {{file: string, stat: fs.BigIntStats}} LegacyEntry */

/** FileCache's identity fields, also applicable to preflight directories.
 * @param {fs.BigIntStats} stat
 */
const identity = (stat) =>
  [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');

/** @param {string} file @returns {LegacyEntry | null} */
function entry(file) {
  const { stat } = checkedStat(file, { optional: true, bigint: true });
  return stat ? { file, stat } : null;
}

/** @param {LegacyEntry} observed @param {boolean} [removingDirectory] */
function verify(observed, removingDirectory = false) {
  const current = entry(observed.file);
  if (!current) {
    throw Error('Legacy record disappeared');
  }
  const sameDirectory =
    current.stat.isDirectory() &&
    observed.stat.isDirectory() &&
    current.stat.dev === observed.stat.dev &&
    current.stat.ino === observed.stat.ino &&
    current.stat.birthtimeNs === observed.stat.birthtimeNs;
  if (removingDirectory ? !sameDirectory : identity(current.stat) !== identity(observed.stat)) {
    throw Error('Legacy record changed');
  }
}

/** @param {LegacyEntry} observed */
function read(observed) {
  if (!observed.stat.isFile()) {
    throw Error('Legacy record must be a file');
  }
  const value = parseJson(readBytes(observed.file, STATE_BYTES), { maxDepth: 68 });
  verify(observed);
  return value;
}

/** @param {string} local @returns {LegacyEntry[]} */
function stateEntries(local) {
  const observed = entry(path.join(local, 'state.json'));
  if (!observed) {
    return [];
  }
  const value = read(observed);
  const known = [
    'formatVersion',
    'questions',
    'contentFingerprint',
    'lastQuestionId',
    'completedAt',
    'historyIndex',
  ];
  if (!object(value) || Object.keys(value).some((key) => !known.includes(key))) {
    throw Error('Unrecognized legacy state');
  }
  if (
    (value.contentFingerprint !== undefined &&
      (typeof value.contentFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.contentFingerprint))) ||
    (value.lastQuestionId !== undefined &&
      value.lastQuestionId !== null &&
      typeof value.lastQuestionId !== 'string')
  ) {
    throw Error('Unrecognized legacy state metadata');
  }
  validateState(value);
  return [observed];
}

/** @param {LegacyEntry} observed */
function validateInk(observed) {
  const value = read(observed);
  if (!object(value) || !integer(value.inkRevision) || !Object.hasOwn(value, 'ink')) {
    throw Error('Unrecognized legacy ink');
  }
  const names = Object.keys(value);
  const current = names.length === 3 && validReceipts(value.receipts);
  const old =
    names.length === 4 && Object.hasOwn(value, 'receiptOrder') && validOldReceipts(value, true);
  if (!current && !old) {
    throw Error('Unrecognized legacy ink receipts');
  }
}

/** @param {string} local @returns {LegacyEntry[]} */
function inkEntries(local) {
  const root = entry(path.join(local, 'ink'));
  if (!root) {
    return [];
  }
  if (!root.stat.isDirectory()) {
    throw Error('Legacy ink must be a directory');
  }
  const entries = [];
  for (const name of fs.readdirSync(root.file).sort()) {
    const directory = entry(path.join(root.file, name));
    if (!/^[a-f0-9]{64}$/.test(name) || !directory?.stat.isDirectory()) {
      throw Error('Unrecognized legacy ink directory');
    }
    for (const name of fs.readdirSync(directory.file).sort()) {
      const file = entry(path.join(directory.file, name));
      if (!/^[a-f0-9]{64}\.json$/.test(name) || !file) {
        throw Error('Unrecognized legacy ink filename');
      }
      validateInk(file);
      entries.push(file);
    }
    entries.push(directory);
  }
  return [...entries, root];
}

/** Only open/refresh removes positively identified old development records.
 * Never scan or remove practice/, exam/, rounds/ or the private parent.
 * @param {string} directory
 */
export function clearLegacyPractice(directory) {
  /** @type {LegacyEntry[]} */
  let entries;
  try {
    const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
    checkedStat(local, { directory: true, optional: true });
    entries = [...inkEntries(local), ...stateEntries(local)];
    for (const observed of entries) {
      verify(observed);
    }
  } catch {
    throw problem(
      'STATE_INVALID',
      '旧开发练习记录无法安全识别或读取，原文件已保留；请检查 .qf-v2/state.json 和 .qf-v2/ink/。',
      {},
      503,
    );
  }
  try {
    for (const observed of entries) {
      verify(observed, observed.stat.isDirectory());
      if (observed.stat.isDirectory()) {
        fs.rmdirSync(observed.file);
      } else {
        fs.unlinkSync(observed.file);
      }
    }
  } catch {
    throw problem(
      'STATE_WRITE_FAILED',
      '旧开发练习记录未能清除，请检查旧位置后重试；未处理的文件已保留。',
      {},
      503,
    );
  }
}
