import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, bad, id, requireObject } from '../platform/errors.js';
import { exists, readJson, checkPath, within } from '../platform/files.js';
import { hash } from '../platform/json.js';

export const GROUP_FILE = '.group.json';
export const INSTANCE_FILE = '.instance.json';
export const BUNDLE_FILE = '.bundle.json';
export const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const freshUuid = () => randomUUID();
// Host-local identity: never exported and freshly allocated for each import.
export function instanceIdentity(directory) {
  const file = path.join(directory, INSTANCE_FILE);
  if (!exists(file)) return null;
  const value = requireObject(readJson(file, 64 * 1024), 'Invalid bank instance');
  if (value.schemaVersion !== 1 || !isUuid(value.id)) throw bad('Invalid bank instance');
  return value.id.toLowerCase();
}
export function upgradedLocalIdentity(directory) {
  const file=path.join(directory,INSTANCE_FILE); if(!exists(file))return null;
  const value=readJson(file,64*1024);
  if(value.upgradeRoute===undefined && value.upgradeStateKey===undefined)return null;
  if(!isUuid(value.id)||typeof value.upgradeRoute!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(value.upgradeRoute)||typeof value.upgradeStateKey!=='string'||!value.upgradeStateKey.startsWith('bank:'+value.upgradeRoute+':')||value.upgradeStateKey.length>1500)throw bad('Invalid upgraded local identity');
  return {route:value.upgradeRoute,stateKey:value.upgradeStateKey};
}
export function groupIdentity(directory) {
  const file = path.join(directory, GROUP_FILE);
  if (!exists(file)) return null;
  const value = requireObject(readJson(file, 64 * 1024), 'Invalid group metadata');
  if (value.schemaVersion !== 1 || value.kind !== 'bank-group' || !isUuid(value.id)) throw new ApiError(422, 'INVALID_GROUP_IDENTITY', '题库分组 .group.json 必须包含 schemaVersion:1、kind:bank-group 和 UUID id');
  return value.id.toLowerCase();
}
export function extensionPath(value) {
  if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('extensions/') || value.includes('\\') || /[:\x00-\x1f]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part))) throw bad('Invalid extension path');
  if (value.split('/').length !== 3) throw new ApiError(422, 'EXTENSION_LAYOUT_UPGRADE_REQUIRED', '拓展路径须为 extensions/分组/拓展，请升级旧目录及题库绑定。');
  return value;
}
export function extensionDirectory(root, value) {
  const relative = extensionPath(value), base = path.join(root, 'extensions'), target = path.resolve(root, relative);
  if (target === base || !within(base, target)) throw bad('Invalid extension path');
  try { return checkPath(target, { directory: true }); }
  catch { throw new ApiError(422, 'EXTENSION_PATH_MISSING', '引用的拓展目录不存在或无效：' + relative); }
}
export const relativeExtension = (root, directory) => path.relative(root, directory).replaceAll('\\', '/');
// URL locators are derived from paths, not new persistent identities.
export const extensionLocator = relative => 'p.' + hash(Buffer.from(extensionPath(relative)));
export const bankLocator = (group, bank) => isUuid(bank) ? 'g.' + group + '.' + bank : 'g.' + hash(Buffer.from(group + '#' + bank));
export function referenceIdentity(reference) {
  requireObject(reference, 'Invalid extension reference');
  if (Object.hasOwn(reference, 'typeId')) throw bad('Invalid extension reference');
  if (Object.hasOwn(reference, 'path')) { if (Object.hasOwn(reference, 'id')) id(reference, 'id'); return 'path:' + extensionPath(reference.path); }
  throw new ApiError(422, 'EXTENSION_REFERENCE_UPGRADE_REQUIRED', '题库使用了旧拓展绑定，请升级为 {path:"extensions/分组/拓展"} 后再打开。');
}
export function eachReference(raw, visit) {
  if (Object.hasOwn(raw, 'extension')) visit(raw, raw.extension);
  for (const question of raw.questions ?? []) if (Object.hasOwn(question, 'extension')) visit(question, question.extension);
}
export function findExtension(reference, rows) {
  referenceIdentity(reference);
  const matches = rows.filter(row => row.referencePath === reference.path);
  if (matches.length !== 1) throw new ApiError(422, 'AMBIGUOUS_EXTENSION', '拓展缺失或绑定不明确，请使用准确的相对路径：' + (reference.path ?? reference.id ?? reference.development));
  const row = matches[0];
  if (reference.path && reference.id !== undefined && reference.id !== (row.extensionId ?? row.id)) throw new ApiError(422, 'EXTENSION_ID_MISMATCH', '拓展路径的身份与题库声明不一致：' + reference.path);
  return row;
}
