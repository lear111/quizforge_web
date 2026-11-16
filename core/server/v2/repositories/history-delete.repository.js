import fs from 'node:fs';
import path from 'node:path';
import { checkedStat, readBytes, replaceFile } from '../../host/platform/files.js';
import { jsonBytes, parseJson } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';

const markerName = 'deleted.json';
export const roundPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** @param {string} directory @param {string} roundId */
function markerStatus(directory, roundId) {
  const bytes = readBytes(path.join(directory, markerName), 1024, true);
  if (!bytes) {
    return 'absent';
  }
  try {
    const value = parseJson(bytes);
    if (
      object(value) &&
      Object.keys(value).length === 2 &&
      value.formatVersion === 1 &&
      value.roundId === roundId
    ) {
      return 'valid';
    }
  } catch {
    // A malformed marker is never evidence of a committed deletion.
  }
  return 'invalid';
}

/** @param {string} directory @param {string} roundId */
export function deletedRound(directory, roundId) {
  const status = markerStatus(directory, roundId);
  if (status === 'invalid') {
    throw problem('STATE_INVALID', '历史删除标记损坏，无法确认轮次状态。', {}, 503);
  }
  return status === 'valid';
}

/** @param {string} file */
function observe(file) {
  const { stat } = checkedStat(file, { bigint: true, optional: true });
  return (
    stat && {
      file,
      directory: stat.isDirectory(),
      identity: `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`,
    }
  );
}

/** @typedef {NonNullable<ReturnType<typeof observe>>} Entry */

/** @param {Entry} entry */
function verify(entry) {
  const current = observe(entry.file);
  if (current?.identity !== entry.identity || current.directory !== entry.directory) {
    throw new Error('Archive entry changed during removal');
  }
}

/** Preflight every entry with canonical path checks before any change.
 * @param {Entry} root */
function contents(root) {
  const entries = [];
  const stack = [root];
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    entries.push(entry);
    if (entry.directory) {
      verify(entry);
      for (const name of fs.readdirSync(entry.file)) {
        const child = observe(path.join(entry.file, name));
        if (!child) {
          throw new Error('Archive entry disappeared during inspection');
        }
        stack.push(child);
      }
    }
  }
  return entries
    .reverse()
    .filter(({ file }) => file !== root.file && file !== path.join(root.file, markerName));
}

/** @param {Entry} root @param {Entry[]} entries */
function clearContents(root, entries) {
  for (const entry of entries) {
    verify(root);
    verify(entry);
    if (entry.directory) {
      fs.rmdirSync(entry.file);
    } else {
      fs.unlinkSync(entry.file);
    }
  }
  verify(root);
  const remaining = fs.readdirSync(root.file);
  if (remaining.length !== 1 || remaining[0] !== markerName) {
    throw new Error('Archive contents changed during removal');
  }
}

/** @param {string} directory @param {string} roundId
 * @param {() => void} [afterPreflight] */
export function deleteRoundFiles(directory, roundId, afterPreflight = () => {}) {
  let marked = false;
  try {
    const root = observe(directory);
    if (!root) {
      return;
    }
    if (!root.directory) {
      throw new Error('Expected an archive directory');
    }
    const marker = markerStatus(directory, roundId);
    marked = marker === 'valid';
    const entries = contents(root);
    afterPreflight();
    verify(root);
    if (!marked) {
      replaceFile(path.join(directory, markerName), jsonBytes({ formatVersion: 1, roundId }));
      marked = true;
    }
    if (!deletedRound(directory, roundId)) {
      throw new Error('Deletion marker disappeared');
    }
    clearContents(root, entries);
  } catch {
    throw problem(
      'STATE_WRITE_FAILED',
      marked
        ? '历史记录已标记删除，但文件清理未完成。请检查目录和权限后重试。'
        : '历史记录未删除。请检查归档目录是否包含链接、重定向或不可访问的文件。',
      {},
      503,
    );
  }
}

/** @param {string} directory @param {string} roundId */
export function cleanDeletedRound(directory, roundId) {
  try {
    const root = observe(directory);
    if (root?.directory && deletedRound(directory, roundId)) {
      const entries = contents(root);
      verify(root);
      if (deletedRound(directory, roundId)) {
        clearContents(root, entries);
      }
    }
  } catch {
    // A committed deletion stays hidden. Explicit DELETE reports cleanup errors.
  }
}
