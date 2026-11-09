import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, bad, text, requireObject } from '../platform/errors.js';
import { checkPath, exists, readBytes, readJson, replaceFile, safeDirectory, safeFile, walkFiles, within } from '../platform/files.js';
import { cloneJson, jsonBytes } from '../platform/json.js';
import { bankItem, scanBanks, scanExtensions } from './directories.js';
import { GROUP_FILE, freshUuid } from './identity.js';
import { archiveMove } from './archive-move.js';
import { removeBank } from './library-removal.js';
import { parseLossless, losslessBytes } from './format4.js';

const relative = (base, item) => path.relative(base, item).replaceAll('\\', '/');
export function folderName(name) {
  if (['bank.json', 'manifest.json', 'development.json'].includes(name.toLowerCase())) throw bad('此名称用于题库或拓展文件，不能作为分组名称');
  if (typeof name !== 'string' || !name.trim() || name.startsWith('.') || name.endsWith(' ') || name.length > 120 || /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/.test(name) || name.endsWith('.') || ['.', '..'].includes(name) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(name)) throw bad('分组名称不能包含路径、特殊字符或 Windows 保留名称');
}
export class LibraryManagement {
  constructor(root) { this.root = path.resolve(root); }
  base(kind) { return path.join(this.root, kind === 'bank' ? 'question-banks' : 'extensions'); }
  groups(kind, folders = null) {
    if (kind === 'bank') return scanBanks(this.base(kind)).groups;
    const base = this.base(kind), leaves = new Set(folders ?? scanExtensions(base));
    if (!exists(base)) return [];
    return fs.readdirSync(base).sort().map(name => path.join(base, name)).filter(item => fs.lstatSync(item).isDirectory() && !leaves.has(item)).map(item => checkPath(item));
  }
  catalog(source, tree = null) {
    try {
      const result = cloneJson(source);
      result.groups = { banks: (tree?.bankGroups ?? this.groups('bank')).map(item => relative(this.base('bank'), item)), extensions: this.groups('extension', tree?.extensionFolders).map(item => relative(this.base('extension'), item)) };
      return result;
    } catch (error) { throw new ApiError(503, 'LIBRARY_UNAVAILABLE', '无法读取目录设置', { cause: error }); }
  }
  resolve(base, value) {
    if (typeof value !== 'string' || value.includes('\\') || value.includes(':') || value.includes('\0') || path.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw bad('Invalid library path');
    const result = path.resolve(base, value);
    if (result === base || !within(base, result)) throw bad('Invalid library path');
    checkPath(result); return result;
  }
  requireUnused(removed) {
    const paths = new Set();
    for (const extension of scanExtensions(this.base('extension')).filter(directory => within(removed, directory))) {
      paths.add('extensions/' + relative(this.base('extension'), extension));
    }
    const used = [];
    const matches = reference => {
      if (!reference) return false;
      if (!reference.path) throw new ApiError(409, 'BANK_DEPENDENCIES_UNKNOWN', '请先升级仍使用旧拓展绑定的题库，再删除拓展。');
      return paths.has(reference.path);
    };
    for (const bank of scanBanks(this.base('bank')).banks) {
      let raw;
      try { raw = readJson(bank, 8 * 1024 * 1024); }
      catch { throw new ApiError(409, 'BANK_DEPENDENCIES_UNKNOWN', '请先修复无法读取的题库，再删除拓展：' + relative(this.base('bank'), bank)); }
      if (matches(raw.extension) || (raw.questions ?? []).some(question => matches(question.extension))) used.push(raw.title ?? relative(this.base('bank'), bank));
    }
    if (used.length) throw new ApiError(409, 'EXTENSION_IN_USE', '仍被以下题库使用，不能删除：' + used.join('、'));
  }
  change(request, catalog) {
    requireObject(request);
    const kind = text(request, 'kind', 20), action = text(request, 'action', 20), target = text(request, 'target', 20);
    if (!['bank', 'extension'].includes(kind) || !['create', 'update', 'delete'].includes(action) || !['item', 'group'].includes(target)) throw bad('Invalid library operation');
    if (Object.keys(request).some(key => !['kind', 'action', 'target', 'path', 'name', 'group'].includes(key))) throw bad('Unknown library field');
    if (kind === 'extension') return this.changeExtension(request, catalog);
    const base = checkPath(this.base(kind), { directory: true });
    if (action === 'create' && target !== 'group') throw bad('Only groups can be created here');
    const sourcePath = action === 'create' ? '' : text(request, 'path', 1000), source = sourcePath ? this.resolve(base, sourcePath) : null;
    let row = null;
    if (source) {
      if (target === 'group') { if (!this.groups(kind).includes(source)) throw new ApiError(404, 'GROUP_NOT_FOUND', '分组已不存在，请刷新列表'); }
      else {
        row = catalog[kind === 'bank' ? 'banks' : 'extensions'].find(row => row.path === sourcePath);
        if (!row) throw new ApiError(404, 'ITEM_NOT_FOUND', '目录项目已不存在，请刷新列表');
      }
      if (fs.lstatSync(source).isDirectory()) walkFiles(source, 20000); else checkPath(source);
    }
    if (action === 'delete') {
      return removeBank(this.root, source, target, sourcePath);
    }
    const name = text(request, 'name', 300).trim(); if (!name) throw bad('名称不能为空');
    const group = Object.hasOwn(request, 'group') ? request.group : '';
    if (typeof group !== 'string') throw bad('Invalid group');
    if (target === 'group' && group) throw bad('分组只支持一层，不能移入其他分组');
    const parent = group ? this.resolve(base, group) : base;
    if (parent !== base && !this.groups(kind).includes(parent)) throw bad('请选择现有分组');
    if (target === 'item') {
      const siblings = catalog.banks.filter(candidate => candidate.path !== sourcePath && (candidate.group ?? '') === group);
      if (siblings.some(candidate => candidate.title === name)) throw new ApiError(409, 'BANK_NAME_CONFLICT', '该分组内已有同名题库，请修改名称');
    }
    let filename;
    if (target === 'group') { folderName(name); filename = name; }
    else {
      folderName(name); filename = fs.lstatSync(source).isDirectory() ? name : name + '.json';
    }
    const destination = path.join(parent, filename);
    if (destination !== source && exists(destination)) throw new ApiError(409, 'LIBRARY_TARGET_EXISTS', '目标分组已有同名文件或文件夹');
    if (!source) {
      if (this.groups(kind).length + (kind === 'extension' ? scanExtensions(base).length : 0) >= 1000) throw bad('目录数量已达到上限');
      fs.mkdirSync(destination);
      // Local continuity for already-installed legacy banks; never used for import matching.
      replaceFile(path.join(destination, GROUP_FILE), jsonBytes({ schemaVersion: 1, kind: 'bank-group', id: freshUuid() }));
      return {};
    }
    let nameFile, before;
    if (target === 'item') {
      if (kind === 'bank') {
        nameFile = fs.lstatSync(source).isDirectory() ? path.join(source, 'bank.json') : source;
        before = readBytes(nameFile, 8 * 1024 * 1024); const raw = parseLossless(before, 'bank.json'); raw.title = name;
        replaceFile(nameFile, losslessBytes(raw));
      }
    }
    try { if (source !== destination) fs.renameSync(source, destination); }
    catch (error) { if (before) replaceFile(nameFile, before); throw error; }
    return { path: relative(base, destination) };
  }
  changeExtension(request, catalog) {
    const { action, target } = request;
    if (action !== 'delete') throw new ApiError(403, 'EXTENSION_STRUCTURE_READ_ONLY', '拓展按实际路径引用，不能在应用中改名、移动或编辑；请导入完整题库包。');
    const base = checkPath(this.base('extension'), { directory: true }), sourcePath = text(request, 'path', 1000), source = this.resolve(base, sourcePath);
    if (target === 'group') {
      if (!this.groups('extension').includes(source)) throw new ApiError(404, 'GROUP_NOT_FOUND', '拓展分组已不存在');
    } else if (!(catalog.extensions ?? []).some(row => row.path === sourcePath)) throw new ApiError(404, 'ITEM_NOT_FOUND', '拓展已不存在');
    this.requireUnused(source);
    const receipt = path.join(safeDirectory(path.join(this.root, '.trash', 'library'), true), randomUUID());
    fs.mkdirSync(receipt);
    replaceFile(path.join(receipt, 'receipt.json'), jsonBytes({ kind: 'extension', target, path: sourcePath, deletedAt: new Date().toISOString() }));
    fs.mkdirSync(path.join(receipt, 'content')); archiveMove(this.root, source, path.join(receipt, 'content', path.basename(source)));
    return { archivedTo: relative(this.root, receipt) };
  }
}
