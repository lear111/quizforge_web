import fs from 'node:fs';
import path from 'node:path';
import { checkedStat, checkPath, within } from '../platform/files.js';
import { FileCache } from '../platform/file-cache.js';
import { fingerprint, parseJson } from '../platform/json.js';
import { problem } from './errors.js';

// Reading limits only. State/write limits require the P1-2 review.
export const READ_LIMITS = Object.freeze({ treeItems: 1000, bankBytes: 8 * 1024 * 1024, manifestBytes: 64 * 1024, assetBytes: 64 * 1024 * 1024 });
export const newCache = () => new FileCache();
export function directories(directory) {
  try { checkPath(directory, { directory: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const names = fs.readdirSync(directory).filter(name => name.toLowerCase() !== '.qf-v2').sort();
  if (names.length > READ_LIMITS.treeItems) throw tooMany({ field: 'directory' });
  return names.filter(name => !name.startsWith('.') && checkedStat(path.join(directory, name)).stat.isDirectory());
}
export function tooMany(context) {
  return problem('FILE_COUNT_LIMIT', '该题库或拓展的文件项目过多：至少 1001 项，上限 1000 项，请减少文件后重试。',
    { ...context, details: { lowerBound: 1001, limit: READ_LIMITS.treeItems } });
}
export function treeDigest(directory, cache, context = {}) {
  return treeIdentity(directory, cache, context).digest;
}
export function treeIdentity(directory, cache, context = {}) {
  const entries = [];
  function visit(file) {
    if (entries.length >= READ_LIMITS.treeItems) throw tooMany(context);
    const { stat } = checkedStat(file, { bigint: true });
    const relative = path.relative(directory, file).replaceAll('\\', '/');
    const entry = { path: relative, directory: stat.isDirectory() };
    // The lstat observation is used synchronously, not carried across an await.
    if (stat.isFile()) entry.hash = cache.hash(file, relative === 'bank.json' ? READ_LIMITS.bankBytes : READ_LIMITS.assetBytes, stat);
    entries.push(entry);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) if (name.toLowerCase() !== '.qf-v2') visit(path.join(file, name));
  }
  try { visit(directory); }
  catch (error) {
    if (error.code === 'FILE_COUNT_LIMIT') throw error;
    throw problem('ASSET_PATH_INVALID', '题库或拓展包含不安全、不可读或超过大小上限的文件。', context);
  }
  // Keep deterministic traversal order: swapping two entry bodies must change
  // the identity too. Physical paths themselves are never hashed here.
  const files = entries.filter(entry => !entry.directory);
  return { digest: fingerprint(entries, 'quizforge-v2-tree'), contentDigest: fingerprint(files.map(entry => entry.hash), 'quizforge-v2-file-contents'), hashes: new Map(files.map(entry => [entry.path, entry.hash])) };
}
export function relativePath(directory, relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 1000 || /[\\:\x00-\x1f\x7f?#]/.test(relative) || path.isAbsolute(relative)) throw problem('ASSET_PATH_INVALID', '资源必须使用题库目录内的安全相对路径。');
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.qf-v2' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw problem('ASSET_PATH_INVALID', '资源路径包含越界或系统保留名称。');
  const base = path.resolve(directory), file = path.resolve(base, relative);
  if (!within(base, file)) throw problem('ASSET_PATH_INVALID', '资源路径不能越出所属目录。');
  return file;
}
export function relativeFile(directory, relative) {
  relativePath(directory, relative);
  const parts = relative.split('/'), base = checkPath(directory, { directory: true });
  let file = base;
  try {
    for (let i = 0; i < parts.length; i++) { file = path.join(file, parts[i]); checkedStat(file, { directory: i < parts.length - 1 }); }
    if (!within(base, file) || !checkedStat(file).stat.isFile()) throw new Error('Not a file');
  } catch { throw problem('ASSET_PATH_INVALID', '资源不存在，或路径包含链接、越界及非普通文件。'); }
  return file;
}
export function readJson(file, cache, maximum, context = {}) {
  let bytes;
  try { bytes = cache.entry(file, maximum).content; }
  catch { throw problem('STORAGE_UNAVAILABLE', '文件无法读取或超过读取大小上限。', context, 503); }
  try { return parseJson(bytes); }
  catch (error) {
    const offset = Number(/JSON offset (\d+)/.exec(error.message)?.[1] ?? 0);
    const text = bytes.toString('utf8').slice(0, offset), lines = text.split('\n');
    const duplicate = error.message.startsWith('Duplicate property');
    throw problem(duplicate ? 'JSON_DUPLICATE_KEY' : 'JSON_INVALID', duplicate ? 'JSON 中存在重复的键，请检查指出的位置。' : '文件不是有效的 UTF-8 JSON，请检查指出的位置。',
      { ...context, details: { offset, line: lines.length, column: lines.at(-1).length + 1 } }, 400);
  }
}
