import fs from 'node:fs';
import path from 'node:path';
import { ApiError, bad, requireObject } from '../platform/errors.js';
import { safeFile, readBytes, safeDirectory } from '../platform/files.js';
import { cloneJson, hash, fingerprint } from '../platform/json.js';

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const key = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const fail = () => bad('Invalid listening configuration');
export function readListening(raw) {
  if (!Object.hasOwn(raw, 'listening')) return null;
  const value = requireObject(raw.listening);
  if (Object.keys(value).some(k => !['materials', 'examMaterialId'].includes(k)) || !Array.isArray(value.materials) || !value.materials.length || value.materials.length > 32) throw fail();
  const seen = new Set();
  for (const row of value.materials) {
    requireObject(row);
    if (Object.keys(row).some(k => !['id', 'title', 'file'].includes(k)) || !key(row.id) || seen.has(row.id) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 160 || typeof row.file !== 'string' || !/^media\/[^/\\:\x00-\x1f]+\.(mp3|wav|ogg|m4a)$/i.test(row.file) || row.file.includes('..')) throw fail();
    seen.add(row.id);
  }
  if (value.examMaterialId !== undefined && !seen.has(value.examMaterialId)) throw fail();
  return cloneJson(value);
}
export function readQuestionListening(raw, config) {
  if (!Object.hasOwn(raw, 'listening')) return null;
  const row = requireObject(raw.listening);
  if (Object.keys(row).length !== 1 || !key(row.materialId) || !config?.materials.some(material => material.id === row.materialId)) throw fail();
  return { materialId: row.materialId };
}
function audioMime(bytes, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mp3' && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes.length > 2 && bytes[0] === 255 && (bytes[1] & 224) === 224)) return 'audio/mpeg';
  if (ext === '.wav' && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
  if (ext === '.ogg' && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (ext === '.m4a' && bytes.toString('ascii', 4, 8) === 'ftyp') return 'audio/mp4';
  throw new ApiError(422, 'AUDIO_TYPE_UNSUPPORTED', '听力材料必须是有效的 MP3、WAV、OGG 或 M4A 音频。');
}
export function readMaterial(collection, id) {
  const material = collection.listening?.materials.find(row => row.id === id);
  if (!material || !collection.mediaDirectory) throw new ApiError(404, 'AUDIO_NOT_FOUND', '听力材料不存在。');
  try {
    const bytes = readBytes(safeFile(collection.mediaDirectory, material.file), MAX_AUDIO_BYTES);
    if (!bytes.length) throw new Error('Empty audio');
    return { bytes, mime: audioMime(bytes, material.file) };
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(422, 'AUDIO_UNAVAILABLE', '听力材料不可读取或超过 8 MiB。'); }
}
export function bindListening(collection, directory) {
  collection.mediaDirectory = directory;
  if (!collection.listening) return collection;
  let total = 0;
  for (const material of collection.listening.materials) {
    const { bytes } = readMaterial(collection, material.id);
    if ((total += bytes.length) > 32 * 1024 * 1024) throw new ApiError(413, 'AUDIO_TOTAL_LIMIT', '题库听力材料总量超过 32 MiB。');
    material.revision = hash(bytes);
  }
  for (const question of collection.questions) if (question.listening) {
    const material = collection.listening.materials.find(row => row.id === question.listening.materialId);
    question.fingerprint = fingerprint({ data: question.data, listening: { materialId: material.id, revision: material.revision } }, question.extension.fingerprint);
  }
  return collection;
}
export function snapshotListening(collection, destination) {
  if (!collection.listening) return;
  const copied = new Set();
  for (const material of collection.listening.materials) {
    if (copied.has(material.file)) continue;
    const { bytes } = readMaterial(collection, material.id), target = path.join(destination, material.file);
    safeDirectory(path.dirname(target), true); fs.writeFileSync(target, bytes, { flag: 'wx' }); copied.add(material.file);
  }
}
export function publicListening(collection) {
  if (!collection.listening) return {};
  return { listening: { materials: collection.listening.materials.map(({ id, title, revision }) => ({ id, title, revision })), ...(collection.listening.examMaterialId ? { examMaterialId: collection.listening.examMaterialId } : {}) } };
}
