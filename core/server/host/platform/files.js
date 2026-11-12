import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseJson } from './json.js';

export function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export function within(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
export function checkedStat(file, { directory = false, optional = false, bigint = false, observed = null } = {}) {
  const absolute = path.resolve(file);
  let stat;
  // Only a synchronous caller's just-observed walkEntries stat may be reused.
  // Keep the per-file canonical/redirect check even when lstat is shared.
  try { stat = observed ?? fs.lstatSync(absolute, { bigint }); }
  catch (error) { if (optional && error.code === 'ENOENT') return { absolute, stat: null }; throw error; }
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Links and special files are not allowed');
  if (directory && !stat.isDirectory()) throw new Error('Expected a normal directory');
  if (path.normalize(fs.realpathSync.native(absolute)) !== absolute) throw new Error('Redirected paths are not allowed');
  return { absolute, stat };
}
export function checkPath(file, options) { return checkedStat(file, options).absolute; }
export function safeDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  let cursor = absolute;
  const missing = [];
  while (!exists(cursor)) {
    missing.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('No existing directory ancestor');
    cursor = parent;
  }
  checkPath(cursor, { directory: true });
  if (missing.length && !create) return absolute;
  for (const item of missing.reverse()) { fs.mkdirSync(item); checkPath(item, { directory: true }); }
  return absolute;
}
export function safeFile(directory, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative)) throw new Error('Invalid asset path');
  const base = checkPath(directory, { directory: true }), result = path.resolve(base, relative);
  if (!within(base, result)) throw new Error('Asset path escapes its directory');
  checkPath(result);
  if (!fs.lstatSync(result).isFile()) throw new Error('Asset must be a regular file');
  return result;
}
export function readBytes(file, max = 32 * 1024 * 1024, optional = false) {
  if (optional && !exists(file)) return null;
  checkPath(file);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > max) throw new Error('Invalid file or size');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > max) throw new Error('Invalid file or size');
    const result = fs.readFileSync(descriptor);
    if (result.length > max) throw new Error('File size changed while reading');
    return result;
  } finally { fs.closeSync(descriptor); }
}
export function readJson(file, max = 8 * 1024 * 1024) { return parseJson(readBytes(file, max)); }
export function replaceFile(file, bytes) {
  file = path.resolve(file);
  safeDirectory(path.dirname(file), true);
  if (exists(file)) checkPath(file);
  const temporary = path.join(path.dirname(file), `.write-${randomUUID()}.tmp`);
  try {
    const descriptor = fs.openSync(temporary, 'wx', 0o600);
    try {
      const buffer = Buffer.from(bytes);
      let offset = 0;
      while (offset < buffer.length) offset += fs.writeSync(descriptor, buffer, offset, buffer.length - offset);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    // Windows indexers can briefly hold a just-written target without sharing
    // delete access. Retry only the atomic rename; never unlink the old file.
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, [10, 30, 60][attempt]);
      }
    }
  }
  finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}
export function resolveLayout(requestedRoot) {
  const dataRoot = checkPath(requestedRoot, { directory: true }), core = path.join(dataRoot, 'core');
  return { dataRoot, codeRoot: exists(core) ? checkPath(core, { directory: true }) : dataRoot };
}
export function walkEntries(directory, max = 1000) {
  const result = [];
  function visit(item) {
    if (result.length >= max) throw new Error('Too many files');
    const { stat } = checkedStat(item, { bigint: true }); result.push({ file: item, stat });
    if (stat.isDirectory()) for (const name of fs.readdirSync(item).sort()) visit(path.join(item, name));
  }
  visit(directory);
  return result;
}
export function walkFiles(directory, max = 1000) { return walkEntries(directory, max).map(entry => entry.file); }
