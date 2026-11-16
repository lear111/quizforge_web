import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkedStat, readBytes, replaceFile, safeDirectory } from '../../host/platform/files.js';
import { problem } from '../utils/errors.js';

export const archiveError = () =>
  problem('ARCHIVE_FAILED', '练习未能归档，原记录已保留，请重试。', {}, 503);
export const writeFile = replaceFile;

/** Unknown practice files must never be discarded as temporary backups.
 * @param {string} root */
export function checkPractice(root) {
  checkedStat(root, { directory: true });
  if (fs.readdirSync(root).some((name) => !['state.json', 'ink'].includes(name))) {
    throw archiveError();
  }
  filesIn(root);
}

/** @param {string} file */
export function exists(file) {
  return checkedStat(file, { optional: true }).stat !== null;
}

/** @param {string} directory */
export function directory(directory) {
  safeDirectory(directory, true);
  if (!checkedStat(directory).stat.isDirectory()) {
    throw archiveError();
  }
}

/** @param {string} source @param {string} target @param {number} limit
 * @param {string} [expectedHash] */
export function copyFile(source, target, limit, expectedHash) {
  const bytes = readBytes(source, limit);
  if (expectedHash && createHash('sha256').update(bytes).digest('hex') !== expectedHash) {
    throw problem('SNAPSHOT_STALE', '题库或题型文件已变化，请保留本轮记录并检查原文件。', {}, 409);
  }
  replaceFile(target, bytes);
}

/** Walk and validate the entire tree before any deletion; never follow links.
 * @param {string} root @returns {string[]} */
export function filesIn(root) {
  /** @type {string[]} */
  const files = [];
  const visit = (/** @type {string} */ file) => {
    const { stat } = checkedStat(file);
    files.push(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) {
        visit(path.join(file, name));
      }
    }
  };
  if (exists(root)) {
    visit(root);
  }
  return files;
}

/** @param {string} root */
export function removeTree(root) {
  for (const file of filesIn(root).reverse()) {
    const { stat } = checkedStat(file);
    if (stat.isDirectory()) {
      fs.rmdirSync(file);
    } else {
      fs.unlinkSync(file);
    }
  }
}

/** @param {string} source @param {string} target @param {number} limit */
export function copyTree(source, target, limit) {
  const entries = filesIn(source);
  for (const file of entries) {
    const to = path.join(target, path.relative(source, file));
    if (checkedStat(file).stat.isDirectory()) {
      directory(to);
    } else {
      copyFile(file, to, limit);
    }
  }
}

/** @param {string} source @param {string} target */
export function move(source, target) {
  checkedStat(source);
  checkedStat(path.dirname(target));
  if (exists(target)) {
    throw archiveError();
  }
  fs.renameSync(source, target);
}
