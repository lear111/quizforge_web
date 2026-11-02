import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { ApiError, text } from '../platform/errors.js';
import { hash, jsonBytes } from '../platform/json.js';
import { checkPath, exists, readBytes, readJson, replaceFile, safeDirectory, safeFile, walkFiles, within } from '../platform/files.js';
import { scanBanks, scanExtensions, bankItem } from './directories.js';
import { folderName } from './library-management.js';
import { markedDevelopment, declaration, staticAssets } from '../extensions/extension-packages.js';
import { ResourceStore, imageReferences, detectImageMime, MAX_IMAGE_BYTES } from '../resources/resources.js';
import { eachReference, extensionPath } from './identity.js';
import { exportPackage, installPackage } from './library-package.js';
import { packageFormat4, parseLossless, losslessBytes, UUID, resourceType } from './format4.js';

export const MAX_UPLOAD = 128 * 1024 * 1024, MAX_EXPANDED = 256 * 1024 * 1024, MAX_FILE = 8 * 1024 * 1024, MAX_ENTRY = 32 * 1024 * 1024, MAX_ENTRIES = 10000;
export const MANIFEST = 'quizforge-package.json', FORMAT = 'quizforge-bank-group', MIME = 'application/vnd.quizforge.qbank';
const invalid = message => new ApiError(422, 'INVALID_LIBRARY_ARCHIVE', message), limit = message => new ApiError(413, 'LIBRARY_ARCHIVE_LIMIT', message);
const relative = (base, file) => path.relative(base, file).replaceAll('\\', '/');
const imageTypes = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
function privatePath(name) { return name.split('/').some(part => part.startsWith('.') || ['node_modules', 'target'].includes(part)); }
function declaredPaths(extension) {
  const result = new Set(), permit = name => { let file = safeFile(extension, name); while (file !== extension) { result.add(relative(extension, file)); file = path.dirname(file); } }, manifest = declaration(extension);
  for (const field of ['entry', 'script', 'style', 'rules', 'questionSchema', 'answerSchema', 'examples']) permit(text(manifest, field, 240)); for (const asset of staticAssets(extension, manifest)) { if (typeof asset !== 'string') throw invalid('题库包的拓展文件声明无效'); permit(asset); }
  if (exists(path.join(extension, 'editor.json'))) { const editor = readJson(safeFile(extension, 'editor.json'), 256 * 1024); for (const field of ['entry', 'script', 'style']) permit(text(editor, field, 240)); } return result;
}
function crcUpdate(crc, bytes) { for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return crc >>> 0; }
export class LibraryArchive {
  constructor(root, resources) { this.root = path.resolve(root); this.resources = resources; this.copiedBytes = 0; this.copiedEntries = 0; }
  workspace() { const base = path.join(this.root, '.temp'); safeDirectory(base, true); return fs.mkdtempSync(path.join(base, 'library-transfer-')); }
  removeWorkspace(work) { const base = path.join(this.root, '.temp'); if (path.dirname(work) !== base || !path.basename(work).startsWith('library-transfer-')) throw new Error('Invalid archive workspace'); for (const file of walkFiles(work, MAX_ENTRIES * 4 + 1)) { if (!within(work, file)) throw new Error('Unsafe archive workspace'); checkPath(file); } fs.rmSync(work, { recursive: true }); }
  account(file) { this.copiedBytes += fs.statSync(file).size; if (this.copiedBytes > MAX_EXPANDED) throw limit('复制内容超过 256 MiB，请缩小题库分组'); }
  copyTree(source, destination, declared = new Set()) {
    for (const file of walkFiles(source, MAX_ENTRIES + 1)) {
      const name = relative(source, file); if (privatePath(name) && !declared.has(name)) continue; if (++this.copiedEntries > MAX_ENTRIES) throw limit('复制文件数量超过上限'); checkPath(file); const target = path.resolve(destination, name); if (!within(destination, target)) throw invalid('目录路径越界');
      if (fs.lstatSync(file).isDirectory()) safeDirectory(target, true); else { if (fs.statSync(file).size > MAX_ENTRY) throw limit('目录中有过大的文件：' + name); this.account(file); safeDirectory(path.dirname(target), true); fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL); }
    }
  }
  exportImages(directory, document, resourceDirectories = []) {
    const ids = imageReferences(document);
    if (!ids.size) return;
    const assets = safeDirectory(path.join(directory, 'assets'), true);
    for (const id of ids) {
      let image, present = false;
      // Copied assets belong to the package; exporting must not require a prior
      // collection load to register them in the host's global resource store.
      for (const source of new Set([directory, ...resourceDirectories])) {
        const sourceAssets = path.join(source, 'assets');
        if (!exists(sourceAssets)) continue;
        checkPath(sourceAssets, { directory: true });
        for (const file of fs.readdirSync(sourceAssets).map(name=>path.join(sourceAssets,name))) {
          if (!fs.lstatSync(file).isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(file)) continue;
          let bytes;
          try { bytes = readBytes(file, MAX_IMAGE_BYTES); }
          catch { throw invalid('题库包图片无法读取或超过 4 MiB：' + id); }
          let type; try { type=resourceType(file,bytes); } catch { throw invalid('题库包图片格式不正确：' + id); }
          if (hash(bytes) !== id) { if(path.basename(file).startsWith(id+'.')) throw invalid('题库包图片内容与引用不符：'+id); continue; }
          const mime=detectImageMime(bytes); if (!mime || type!=='image') throw invalid('题库包图片格式不正确：' + id);
          image ??= { mime, bytes };
          if (source === directory) present = true;
        }
      }
      if (present) continue;
      // Older standalone JSON banks may have their images only in .state.
      image ??= this.resources.read(id);
      this.copiedBytes += image.bytes.length;
      if (this.copiedBytes > MAX_EXPANDED || ++this.copiedEntries > MAX_ENTRIES) throw limit('图片及文件超过导出大小或数量上限');
      replaceFile(path.join(assets, `${id}.${imageTypes.get(image.mime)}`), image.bytes);
    }
  }
  copyBank(file, destination) { if (path.basename(file) === 'bank.json' && path.dirname(file) !== path.join(this.root, 'question-banks')) this.copyTree(path.dirname(file), destination); else { safeDirectory(destination, true); this.account(file); fs.copyFileSync(file, path.join(destination, 'bank.json'), fs.constants.COPYFILE_EXCL); } this.exportImages(destination, readJson(path.join(destination, 'bank.json'), MAX_FILE)); }
  copyExtension(source, destination, referencePath) {
    extensionPath(referencePath);
    this.copyTree(source, destination, declaredPaths(source));
    const manifest = declaration(source), assets = staticAssets(source, manifest);
    const examples = safeFile(destination, text(manifest, 'examples', 240)), raw = parseLossless(fs.readFileSync(examples),examples);
    if (raw.formatVersion?.literal!=='2' || !UUID.test(raw.id??'')) throw new ApiError(422,'BANK_FORMAT_UPGRADE_REQUIRED','请先升级拓展示例，再导出格式 4。');
    eachReference(raw, owner => { owner.extension = { path: referencePath }; });
    replaceFile(examples, losslessBytes(raw)); this.exportImages(path.dirname(examples), raw, [destination]);
    const legacyMarker = path.join(destination, 'development.json');
    if (exists(legacyMarker)) fs.unlinkSync(legacyMarker);
  }
  async zip(content, destination) {
    const archive = new yazl.ZipFile(); let total = 0, count = 0; const output = fs.createWriteStream(destination, { flags: 'wx' }); archive.on('error', error => archive.outputStream.destroy(error)); const writing = pipeline(archive.outputStream, output); writing.catch(() => {});
    try {
      for (const file of walkFiles(content, MAX_ENTRIES + 1).sort()) { if (file === content) continue; if (++count > MAX_ENTRIES) throw limit('导出文件数量超过上限'); const stat = fs.statSync(file), name = relative(content, file); if (stat.size > MAX_ENTRY && stat.isFile() || stat.isFile() && (total += stat.size) > MAX_EXPANDED) throw limit('导出内容超过大小上限'); if (stat.isDirectory()) archive.addEmptyDirectory(name); else archive.addFile(file, name); }
      archive.end(); await writing;
    } catch (error) { archive.outputStream.destroy(error); output.destroy(); await writing.catch(() => {}); throw error; }
  }
  async exportGroup(group) {
    folderName(group); const bankRoot = path.join(this.root, 'question-banks'), selected = path.join(bankRoot, group);
    if (!scanBanks(bankRoot).groups.includes(selected)) throw new ApiError(404, 'GROUP_NOT_FOUND', '题库分组已不存在，请刷新列表');
    return exportPackage(this, group);
  }
  async exportBank(bank) {
    const base = path.join(this.root, 'question-banks');
    const file = scanBanks(base).banks.find(file => relative(base, bankItem(base, file)) === bank);
    if (!file) throw new ApiError(404, 'BANK_NOT_FOUND', '题库已不存在，请刷新列表');
    const name = path.basename(bankItem(base, file)); folderName(name);
    return exportPackage(this, name, file);
  }
  async unzip(file, staging) {
    let archive, total = 0, count = 0; const seen = new Set();
    try {
      archive = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
      for await (const entry of archive.eachEntry()) {
        if (!(entry.generalPurposeBitFlag & 0x800) && entry.fileNameRaw.some(byte=>byte>127)) throw invalid('非 ASCII 文件名未声明 UTF-8；不猜测旧文件名编码');
        if (entry.generalPurposeBitFlag & 0x800) { try { new TextDecoder('utf-8',{fatal:true}).decode(entry.fileNameRaw); } catch { throw invalid('压缩包文件名不是有效 UTF-8'); } }
        if (++count > MAX_ENTRIES) throw limit('压缩包文件数量超过上限'); const directory = entry.fileName.endsWith('/'), name = directory ? entry.fileName.slice(0, -1) : entry.fileName, parts = name.split('/'), mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (parts.length > 32 || (!['question-banks', 'extensions'].includes(parts[0]) && !(parts.length === 1 && name === MANIFEST && !directory))) throw invalid('题库包顶层只允许格式标识、question-banks 和 extensions');
        if (parts.some(part => !part.trim() || ['.', '..'].includes(part) || /[\\:*?"<>|\x00-\x1f\x7f-\x9f]/.test(part) || /[ .]$/.test(part) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part)) || (entry.generalPurposeBitFlag & 1) || ![0, 0x8000, 0x4000].includes(mode) || mode === 0x4000 && !directory || mode === 0x8000 && directory) throw invalid('压缩包包含无效或越界路径');
        if (seen.has(name.toLowerCase())) throw invalid('压缩包包含重复路径'); seen.add(name.toLowerCase()); const target = path.resolve(staging, name); if (!within(staging, target)) throw invalid('压缩包路径越界');
        if (directory) { safeDirectory(target, true); continue; }
        if (entry.uncompressedSize > MAX_ENTRY) throw limit('压缩包单个文件超过 32 MiB'); safeDirectory(path.dirname(target), true); let bytes = 0, crc = 0xffffffff;
        const stream = await archive.openReadStreamPromise(entry), bound = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; if (bytes > MAX_ENTRY || total + bytes > MAX_EXPANDED) return callback(limit('压缩包超过解压大小上限')); crc = crcUpdate(crc, chunk); callback(null, chunk); } });
        await pipeline(stream, bound, fs.createWriteStream(target, { flags: 'wx' })); if (((crc ^ 0xffffffff) >>> 0) !== (entry.crc32 >>> 0)) throw invalid('压缩包文件校验失败'); total += bytes;
      }
    } catch (error) { if (error instanceof ApiError) throw error; throw invalid('压缩包损坏或不是有效的 ZIP 文件'); } finally { archive?.close(); }
  }
  validatePrivatePaths(staging, banks, extensions) {
    const leaves = new Set(), declared = new Set();
    for (const extension of extensions) { leaves.add(extension); for (const name of declaredPaths(extension)) declared.add(path.resolve(extension, name)); }
    for (const bank of banks) { const item = bankItem(path.join(staging, 'question-banks'), bank); if (fs.lstatSync(item).isDirectory()) leaves.add(item); declared.add(bank); }
    for (const file of walkFiles(staging, MAX_ENTRIES + 1)) { const parts = relative(staging, file).split('/'); if (parts.length <= 2) continue; let base = path.resolve(staging, ...parts.slice(0, 2)); const leaf = path.resolve(staging, ...parts.slice(0, 3)); if (leaves.has(leaf)) base = leaf; if (privatePath(relative(base, file)) && !declared.has(file)) throw invalid('题库包包含未声明的私有文件或目录'); }
  }
  async importPackage(input, validator, filename) {
    const work = this.workspace();
    try {
      const zip = path.join(work, 'upload.qbank'), staging = path.join(work, 'content'); let uploaded = 0;
      const bound = new Transform({ transform(chunk, encoding, callback) { if ((uploaded += chunk.length) > MAX_UPLOAD) return callback(limit('压缩包超过上传大小上限')); callback(null, chunk); } });
      await pipeline(Buffer.isBuffer(input) ? Readable.from([input]) : input, bound, fs.createWriteStream(zip, { flags: 'wx' }));
      safeDirectory(staging, true); await this.unzip(zip, staging);
      let marker; try { marker = readJson(path.join(staging, MANIFEST), 256 * 1024); } catch { throw invalid('不是 QuizForge 题库包：缺少格式标识'); }
        if (![3,4].includes(marker.formatVersion)) throw new ApiError(422,'UNSUPPORTED_LIBRARY_ARCHIVE','仅支持格式 3 自动升级及格式 4 题库包');
      const upgraded = marker.formatVersion === 3;
      const upgradeReport = packageFormat4(staging,{upgrade:upgraded});
      if (upgraded) marker={...marker,formatVersion:4};
      const installed=await installPackage(this, staging, marker, validator, filename);
      return {...installed,upgradedFrom:upgraded?3:null,...(upgraded?{upgradeReport}:{})};
    } finally { this.removeWorkspace(work); }
  }
}
