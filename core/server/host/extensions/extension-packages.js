import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError, bad, id, text, requireObject } from '../platform/errors.js';
import { exists, readBytes, readJson, safeFile, within, walkFiles } from '../platform/files.js';
import { cloneJson, fingerprint, hash } from '../platform/json.js';
import { answerStateDeclared, answerAreasDeclared, declareApi, outlineItemsDeclared, requireManifestApi } from './extension-api.js';
import { answerAreaComponent } from './answer-area-component.js';
import { optional } from '../library/collections.js';

const FIELDS = ['entry', 'script', 'style', 'rules', 'questionSchema', 'answerSchema', 'examples'];
const MEDIA = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['webp', 'image/webp'], ['gif', 'image/gif'], ['svg', 'image/svg+xml'], ['woff', 'font/woff'], ['woff2', 'font/woff2'], ['ttf', 'font/ttf'], ['otf', 'font/otf'], ['wav', 'audio/wav'], ['mp3', 'audio/mpeg'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'], ['ogg', 'audio/ogg'], ['oga', 'audio/ogg'], ['flac', 'audio/flac']]);
const AUDIO = new Set(['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac']);
const assetLimit = mime => AUDIO.has(mime) ? 4 * 1024 * 1024 : 1024 * 1024;
export const markedDevelopment = directory => exists(path.join(directory, 'development.json'));
export const runtimeId = folder => 'dev.' + (/^[A-Za-z0-9][A-Za-z0-9._-]{0,115}$/.test(folder) ? folder : hash(Buffer.from(folder)));
export function declaration(directory, development = false) {
  const file = path.join(directory, 'manifest.json');
  const result = exists(file) ? readJson(file, 256 * 1024) : {};
  requireObject(result, 'Invalid development manifest');
  if (!development) return result;
  const marker = readJson(safeFile(directory, 'development.json'), 256 * 1024);
  for (const field of FIELDS) if (!Object.hasOwn(result, field) && Object.hasOwn(marker, field)) result[field] = cloneJson(marker[field]);
  return result;
}
export function staticAssets(directory, manifest, development = false) {
  const declarations = [manifest.assets];
  if (development) declarations.push(readJson(safeFile(directory, 'development.json'), 256 * 1024).assets);
  const result = new Set();
  for (const values of declarations) {
    if (values === undefined) continue;
    if (!Array.isArray(values)) throw bad('Static assets must be a list of relative paths');
    for (const relative of values) { if (typeof relative !== 'string') throw bad('Invalid static asset path'); result.add(relative); }
  }
  if (result.size > 100) throw bad('Too many static assets');
  return [...result];
}
const assetText = file => file ? new TextDecoder('utf-8', { fatal: true }).decode(readBytes(file, 1024 * 1024)) : '';
export function pageAssets(directory, config, media) {
  requireObject(config, 'Invalid development page');
  const result = { html: assetText(safeFile(directory, text(config, 'entry', 240))), entryPath: config.entry };
  for (const field of ['script', 'style']) {
    result[field] = Object.hasOwn(config, field) ? assetText(safeFile(directory, text(config, field, 240))) : '';
    if (Object.hasOwn(config, field)) result[field + 'Path'] = config[field];
  }
  if (media !== undefined) {
    if (!Array.isArray(media) || media.length > 100) throw bad('Development assets must be a bounded list');
    const seen = new Set(); let total = 0; result.assets = [];
    for (const relative of media) {
      if (typeof relative !== 'string' || !relative.trim() || relative.length > 240 || seen.has(relative)) throw bad('Invalid development asset path');
      seen.add(relative);
      const mime = MEDIA.get(relative.slice(relative.lastIndexOf('.') + 1).toLowerCase());
      if (!mime) throw bad('Development assets support image, font and audio files');
      const bytes = readBytes(safeFile(directory, relative), assetLimit(mime));
      if ((total += bytes.length) > 8 * 1024 * 1024) throw new Error('Inline static assets must be at most 1 MiB each (4 MiB for audio) and 8 MiB in total; use QF.resources for larger images');
      result.assets.push({ path: relative, mime, base64: bytes.toString('base64') });
    }
  }
  return result;
}
export function snapshotPage(extension) {
  const config = declaration(extension.directory), media = staticAssets(extension.directory, config);
  if (!extension.script) delete config.script;
  if (!extension.style) delete config.style;
  let result;
  if (extension.development) {
    if (!extension.script) delete config.script;
    if (!extension.style) delete config.style;
    result = pageAssets(extension.directory, config, media.length ? media : undefined);
    const marker = readJson(safeFile(extension.directory, 'development.json'), 256 * 1024);
    if (marker.mode === 'ui') result.legacyPage = true;
  } else result = pageAssets(extension.directory, config, media.length ? media : undefined);
  if (extension.answerStateDeclared) result.answerStateDeclared = true;
  if (extension.answerAreasDeclared) {result.answerAreasDeclared=true;result.answerAreaComponent=answerAreaComponent();}
  return withDependencies(result, extension);
}
export function editorPage(extension) {
  try {
    const file = path.join(extension.directory, 'editor.json'), development = false;
    const marker = development ? readJson(safeFile(extension.directory, 'development.json'), 256 * 1024) : null;
    if (!exists(file) && !Object.hasOwn(marker ?? {}, 'editor')) return null;
    const config = exists(file) ? readJson(file, 256 * 1024) : marker.editor;
    const media = staticAssets(extension.directory, declaration(extension.directory, development));
    const page = development || media.length ? pageAssets(extension.directory, config, media) : { html: assetText(safeFile(extension.directory, text(config, 'entry', 240))), script: assetText(safeFile(extension.directory, text(config, 'script', 240))), style: assetText(safeFile(extension.directory, text(config, 'style', 240))) };
    if (marker?.mode === 'ui') page.legacyPage = true;
    return withDependencies(page, extension);
  } catch (error) { throw new ApiError(422, 'INVALID_EDITOR', 'Extension editor declaration or assets are invalid', { cause: error }); }
}
export function withDependencies(page, extension) {
  declareApi(page);
  if (extension.contentApi) page.contentApi = cloneJson(extension.contentApi);
  if (extension.dependencies.length) page.dependencies = cloneJson(extension.dependencies);
  return page;
}
function modificationTime(stat) {
  const seconds = stat.mtimeNs / 1_000_000_000n, nanos = stat.mtimeNs % 1_000_000_000n;
  const fraction = nanos.toString().padStart(9, '0').replace(/0+$/, '');
  return new Date(Number(seconds * 1000n)).toISOString().slice(0, 19) + (fraction ? '.' + fraction : '') + 'Z';
}
export function developmentRevision(directory) {
  let value = '';
  for (const file of walkFiles(directory).sort()) {
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile()) continue;
    value += path.relative(directory, file) + ':' + stat.size + ':' + modificationTime(stat) + ';';
  }
  return hash(Buffer.from(value));
}
export function packageSnapshot(directory) {
  const result = new Map(); let total = 0;
  for (const file of walkFiles(directory).sort()) {
    if (!fs.lstatSync(file).isFile()) continue;
    const bytes = readBytes(file, 8 * 1024 * 1024);
    if ((total += bytes.length) > 32 * 1024 * 1024) throw new Error('Development package exceeds 32 MiB');
    result.set(path.relative(directory, file).replaceAll('\\', '/'), bytes);
  }
  return result;
}
export function snapshotRevision(files) { return fingerprint(Object.fromEntries([...files].map(([file, bytes]) => [file, hash(bytes)])), 'quizforge-development-publish-v1'); }
export function readDevelopment(directory) {
  const folder = path.basename(directory); id({ folder }, 'folder');
  const marker = readJson(safeFile(directory, 'development.json'), 256 * 1024);
  requireObject(marker, 'Invalid development marker');
  if (Object.hasOwn(marker, 'mode') && !['ui', 'runtime'].includes(marker.mode)) throw bad('Invalid legacy development mode');
  if (Object.hasOwn(marker, 'types') || Object.hasOwn(marker, 'packageFormatVersion')) throw bad('Each development extension provides one question type; use folders to group extensions');
  const manifest = exists(path.join(directory, 'manifest.json')) ? readJson(safeFile(directory, 'manifest.json'), 256 * 1024) : {};
  const name = Object.hasOwn(marker, 'name') ? text(marker, 'name', 300) : Object.hasOwn(manifest, 'name') ? text(manifest, 'name', 300) : folder;
  if (!exists(path.join(directory, 'manifest.json'))) pageAssets(directory, marker, marker.assets);
  if (Object.hasOwn(marker, 'editor')) pageAssets(directory, marker.editor, marker.assets);
  return { folder, mode: 'runtime', name, description: optional(marker, 'description', 4000), directory, marker, revision: developmentRevision(directory) };
}
export function readExtension(directory, richtext, sdk, developmentPackage = null) {
  // Markers are legacy configuration only, never a runtime or publication state.
  const development = developmentPackage != null, config = declaration(directory, development);
  if (Object.hasOwn(config, 'types') || Object.hasOwn(config, 'packageFormatVersion')) throw bad('Each extension provides one question type; group independent extensions in folders');
  requireManifestApi(config);
  const fields = {};
  for (const field of FIELDS) {
    if (!Object.hasOwn(config, field)) {
      if (field === 'entry') throw bad('Extension page requires an entry');
      fields[field] = null; continue;
    }
    const relative = text(config, field, 240), candidate = path.resolve(directory, relative);
    if (relative.includes('\\') || relative.includes(':') || relative.includes('\0') || path.isAbsolute(relative) || !within(directory, candidate)) throw new Error('Invalid development asset path');
    if (development && field !== 'entry' && !exists(candidate)) { fields[field] = null; continue; }
    fields[field] = safeFile(directory, relative); readBytes(fields[field], field === 'examples' ? 8 * 1024 * 1024 : 1024 * 1024);
  }
  if (development) for (const field of ['script', 'style']) if (!fields[field]) delete config[field];
  const resolution = richtext.resolve(config);
  for (const dependency of resolution.dependencies) sdk(dependency.id, dependency.version);
  const media = staticAssets(directory, config, development);
  pageAssets(directory, config, media);
  let identity;
  {
    const digest = createHash('sha256').update('quizforge-extension-v1');
    for (const file of [safeFile(directory, 'manifest.json'), ...FIELDS.slice(0, 6).map(field => fields[field]), ...media.map(relative => safeFile(directory, relative))].filter(Boolean)) {
      const bytes = readBytes(file, 8 * 1024 * 1024), length = Buffer.alloc(4); length.writeInt32BE(bytes.length); digest.update(length); digest.update(bytes);
    }
    identity = digest.digest('hex');
  }
  return { id: Object.hasOwn(config, 'id') ? id(config, 'id') : development ? runtimeId(developmentPackage.folder) : id(config, 'id'), version: Object.hasOwn(config, 'version') ? id(config, 'version') : development ? '0.0.0' : id(config, 'version'), name: Object.hasOwn(config, 'name') || !development ? text(config, 'name', 300) : developmentPackage.name, description: development ? developmentPackage.description : optional(config, 'description', 4000), directory, ...fields, fingerprint: identity, dependencies: resolution.dependencies, contentApi: resolution.contentApi, providerRevision: resolution.revision, outlineItemsDeclared: outlineItemsDeclared(config), answerStateDeclared: answerStateDeclared(config), answerAreasDeclared: answerAreasDeclared(config), development: null };
}
export function runtimeExtension(original, packageValue) {
  const contract = { outlineItems: original.outlineItemsDeclared };
  if (original.contentApi) contract.contentApi = original.contentApi;
  if (original.answerStateDeclared) contract.answerState = true;
  if (original.answerAreasDeclared) contract.answerAreas = 1;
  for (const field of ['rules', 'questionSchema', 'answerSchema']) contract[field] = original[field] ? hash(readBytes(original[field])) : '';
  return { ...original, id: runtimeId(packageValue.folder), version: '0.0.0', fingerprint: fingerprint(contract, 'quizforge-development-rules-v2'), providerRevision: original.providerRevision + ':' + packageValue.revision, development: { folder: packageValue.folder } };
}
export function bindRuntimeExamples(raw, original, runtime) {
  const copy = cloneJson(raw);
  for (const item of [copy, ...(copy.questions ?? [])]) {
    if (!Object.hasOwn(item, 'extension')) continue;
    const reference = requireObject(item.extension, 'Invalid example extension reference');
    if (Object.hasOwn(reference, 'typeId')) throw bad('Invalid example extension reference');
    const own = Object.hasOwn(reference, 'development');
    if (own && (Object.keys(reference).length !== 1 || reference.development !== path.basename(original.directory))) throw bad('Examples must reference their own development extension');
    if (own || reference.id === original.id && reference.version === original.version) item.extension = { id: runtime.id, version: runtime.version };
  }
  return copy;
}
