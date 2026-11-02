import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../platform/errors.js';
import { checkPath, exists, readJson, replaceFile, safeDirectory } from '../platform/files.js';
import { jsonBytes } from '../platform/json.js';
import { ResourceStore } from '../resources/resources.js';
import { declaration } from '../extensions/extension-packages.js';
import { scanBanks, scanExtensions, bankItem } from './directories.js';
import { folderName } from './library-management.js';
import { INSTANCE_FILE, BUNDLE_FILE, relativeExtension, eachReference, findExtension } from './identity.js';
import { MANIFEST, FORMAT, MAX_UPLOAD, MAX_FILE } from './library-archive.js';
import { packageFormat4, parseLossless, losslessBytes, UUID } from './format4.js';

export const PACKAGE_VERSION = 4;
const invalid = message => new ApiError(422, 'INVALID_LIBRARY_ARCHIVE', message);
function uniqueName(name, used) {
  folderName(name); let result = name, suffix = 2;
  while (used.has(result.toLowerCase())) result = name.slice(0, 105) + '（' + suffix++ + '）';
  used.add(result.toLowerCase()); return result;
}
const occupied = directory => new Set(exists(directory) ? fs.readdirSync(directory).map(name => name.toLowerCase()) : []);
function inventory(root) {
  return scanExtensions(path.join(root, 'extensions')).map(source => {
    const manifest = declaration(source);
    return { source, extensionId: manifest.id ?? 'extension', version: manifest.version ?? '0.0.0', referencePath: relativeExtension(root, source) };
  });
}
function rewrite(raw, rows, paths) {
  eachReference(raw, (owner, reference) => {
    const target = paths.get(findExtension(reference, rows).source);
    if (!target) throw invalid('题库引用了包外或未包含的拓展');
    owner.extension = { path: target };
  });
}
export async function exportPackage(archive, group, singleFile = null) {
  const base = path.join(archive.root, 'question-banks'), selected = path.join(base, group), work = archive.workspace();
  try {
    const content = path.join(work, 'content'), banks = path.join(content, 'question-banks', group), extensions = path.join(content, 'extensions', group);
    safeDirectory(banks, true); safeDirectory(extensions, true);
    const rows = inventory(archive.root), required = new Map(), documents = [];
    for (const file of singleFile ? [singleFile] : scanBanks(base).banks.filter(file => path.dirname(bankItem(base, file)) === selected)) {
      if (path.basename(file) !== 'bank.json' || bankItem(base, file) === file) throw new ApiError(422, 'BANK_LAYOUT_UPGRADE_REQUIRED', '请先将旧独立 JSON 迁移到题库文件夹中的 bank.json，再导出。');
      const raw = parseLossless(fs.readFileSync(file),file);
      if (!UUID.test(raw.id ?? '') || raw.formatVersion?.literal !== '2') throw new ApiError(422,'BANK_FORMAT_UPGRADE_REQUIRED','请先执行“升级本地题库”，将 UUID 永久保存后再导出格式 4。');
      eachReference(raw, (_owner, reference) => { const row = findExtension(reference, rows); required.set(row.source, row); });
      documents.push({ file, raw });
    }
    if (!documents.length) throw invalid('分组中没有可导出的题库');
    const paths = new Map(), extensionNames = new Set(), bankNames = new Set();
    for (const row of required.values()) {
      const name = uniqueName(path.basename(row.source), extensionNames);
      archive.copyExtension(row.source, path.join(extensions, name), 'extensions/' + group + '/' + name);
      paths.set(row.source, 'extensions/' + group + '/' + name);
    }
    for (const { file, raw } of documents) {
      const item = bankItem(base, file), name = uniqueName(fs.lstatSync(item).isDirectory() ? path.basename(item) : path.basename(item, '.json'), bankNames);
      const destination = path.join(banks, name);
      archive.copyBank(file, destination); rewrite(raw, rows, paths);
      replaceFile(path.join(destination, 'bank.json'), losslessBytes(raw));
    }
    replaceFile(path.join(content, MANIFEST), jsonBytes({ format: FORMAT, formatVersion: PACKAGE_VERSION, group, ...(singleFile ? { scope: 'bank' } : {}) }));
    packageFormat4(content);
    const file = path.join(work, 'group.qbank'); await archive.zip(content, file);
    if (fs.statSync(file).size > MAX_UPLOAD) throw new ApiError(413, 'LIBRARY_ARCHIVE_LIMIT', '导出的题库包超过 128 MiB');
    return { workspace: work, file, name: group, close: () => archive.removeWorkspace(work) };
  } catch (error) { archive.removeWorkspace(work); throw error; }
}
function incomingGroup(staging, marker) {
  if (marker?.format !== FORMAT) throw invalid('不是 QuizForge 题库包：格式标识不正确');
  if (marker.formatVersion !== PACKAGE_VERSION) throw new ApiError(422, 'UNSUPPORTED_LIBRARY_ARCHIVE', '支持格式 4，格式 3 会在导入前自动升级；其他旧格式请联系制作者。');
  if (marker.scope !== undefined && !['group', 'bank'].includes(marker.scope)) throw invalid('题库包 scope 必须为 group 或 bank');
  if (typeof marker.group !== 'string') throw invalid('题库包缺少分组名称');
  folderName(marker.group);
  for (const kind of ['question-banks', 'extensions']) {
    const directory = path.join(staging, kind);
    if (!exists(directory)) throw invalid('题库包缺少 question-banks 或 extensions');
    checkPath(directory, { directory: true });
    const names = fs.readdirSync(directory);
    if (names.length !== 1 || names[0] !== marker.group) throw invalid('题库包的题库和拓展目录必须各包含一个配套物理分组');
    checkPath(path.join(directory, marker.group), { directory: true });
  }
  return marker.group;
}
function importName(filename, fallback) {
  if (filename === undefined || filename === null) return fallback;
  if (typeof filename !== 'string' || filename.length > 1000 || !filename.toLowerCase().endsWith('.qbank')) throw invalid('请选择 .qbank 文件');
  const value = filename.slice(0, -6).replace(/[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/g, '_').trim().replace(/[ .]+$/, '').slice(0, 105);
  try { folderName(value); return value; } catch { return fallback; }
}
export async function installPackage(archive, staging, marker, validator, filename) {
  const group = incomingGroup(staging, marker), bankRoot = path.join(staging, 'question-banks'), extensionRoot = path.join(staging, 'extensions');
  const files = scanBanks(bankRoot).banks, rows = inventory(staging), extensions = scanExtensions(extensionRoot);
  const sourceBanks = path.join(bankRoot, group), sourceExtensions = path.join(extensionRoot, group);
  if (!files.length || files.some(file => path.dirname(bankItem(bankRoot, file)) !== sourceBanks || path.basename(file) !== 'bank.json')
      || extensions.some(directory => path.dirname(directory) !== sourceExtensions)) throw invalid('题库和拓展必须分别放在配套分组的独立文件夹内');
  const single = marker.scope === 'bank';
  if (single && files.length !== 1) throw invalid('单题库包必须恰好包含一本题库');
  archive.validatePrivatePaths(staging, files, extensions);
  replaceFile(path.join(sourceExtensions, BUNDLE_FILE), jsonBytes({ schemaVersion: 1, kind: 'extension-bundle' }));
  // Local namespaces are allocated even for byte-identical repeated imports.
  // Host instance files are not accepted from an archive or exported.
  for (const file of files) {
    const raw = parseLossless(fs.readFileSync(file),file);
    eachReference(raw, (_owner, reference) => { if (!reference?.path) throw invalid('新版题库包必须使用准确的拓展相对路径'); });
    replaceFile(file, losslessBytes(raw));
    replaceFile(path.join(path.dirname(file), INSTANCE_FILE), jsonBytes({ schemaVersion: 1, id: randomUUID() }));
  }
  await validator(staging);
  const resources = new ResourceStore(staging);
  for (const file of files) resources.exportReferences(path.dirname(file), readJson(file, MAX_FILE));
  for (const row of rows) {
    const manifest = declaration(row.source), file = path.join(row.source, manifest.examples);
    resources.exportReferences(path.dirname(file), readJson(file, MAX_FILE));
  }
  const name = importName(filename, group), targetBankBase = path.join(archive.root, 'question-banks'), targetExtensionBase = path.join(archive.root, 'extensions');
  safeDirectory(targetBankBase, true); safeDirectory(targetExtensionBase, true);
  const bankGroup = uniqueName(name, occupied(targetBankBase)), extensionGroup = uniqueName(name, occupied(targetExtensionBase));
  const paths = new Map(rows.map(row => [row.source, 'extensions/' + extensionGroup + '/' + path.basename(row.source)]));
  for (const file of files) { const raw = parseLossless(fs.readFileSync(file),file); rewrite(raw, rows, paths); replaceFile(file, losslessBytes(raw)); }
  for (const row of rows) {
    const file = path.join(row.source, declaration(row.source).examples), raw = parseLossless(fs.readFileSync(file),file);
    rewrite(raw, rows, paths); replaceFile(file, losslessBytes(raw));
  }
  const moves = [{ source: sourceExtensions, destination: path.join(targetExtensionBase, extensionGroup) }, { source: single ? path.dirname(files[0]) : sourceBanks, destination: path.join(targetBankBase, bankGroup) }], installed = [];
  try {
    for (const move of moves) {
      if (exists(move.destination)) throw new ApiError(409, 'LIBRARY_TARGET_EXISTS', '导入目标已被占用，请重试');
      fs.renameSync(move.source, move.destination); installed.push(move);
    }
  } catch (error) { for (const move of installed.reverse()) fs.renameSync(move.destination, move.source); throw error; }
  return { scope: single ? 'bank' : 'group', name: bankGroup, group: single ? '' : bankGroup, path: bankGroup, extensionGroup, importedBanks: files.length, importedExtensions: rows.length };
}
