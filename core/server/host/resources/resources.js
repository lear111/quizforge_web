import fs from 'node:fs';
import path from 'node:path';
import { ApiError, bad, text, requireObject } from '../platform/errors.js';
import { checkPath, exists, readBytes, replaceFile, safeDirectory, safeFile, walkFiles } from '../platform/files.js';
import { hash } from '../platform/json.js';
import { resourceType } from '../library/format4.js';

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
export function decodeBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}(?:==)?|[A-Za-z0-9+/]{3}=?|)?$/.test(value)) throw bad('Invalid base64 image');
  return Buffer.from(value, 'base64');
}
export function detectImageMime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 10 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}
export function imageReferences(document) {
  const result = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.type === 'image' && value.attrs && Object.hasOwn(value.attrs, 'assetId')) {
      if (typeof value.attrs.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(value.attrs.assetId)) throw bad('Invalid image resource reference');
      result.add(value.attrs.assetId);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(document); return result;
}
export class ResourceStore {
  constructor(root, { memory = false, fallback = null } = {}) {
    this.root = path.resolve(root); this.directory = path.join(this.root, '.state', 'resources');
    this.fallback = fallback; this.memory = memory ? new Map() : null; this.bytes = 0;
  }
  memoryBytes() { return this.bytes; }
  clearMemory() { this.memory?.clear(); this.bytes = 0; }
  upload(request) {
    requireObject(request, 'Image upload requires mime and base64 data');
    if (Object.keys(request).length !== 2 || !Object.hasOwn(request, 'mime') || !Object.hasOwn(request, 'data')) throw bad('Image upload requires mime and base64 data');
    const mime = text(request, 'mime', 80);
    if (!TYPES.has(mime)) throw new ApiError(415, 'IMAGE_TYPE_UNSUPPORTED', 'Only PNG, JPEG, WebP and GIF images are supported');
    if (typeof request.data !== 'string' || !request.data || request.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new ApiError(413, 'IMAGE_SIZE_LIMIT', 'Image exceeds 4 MiB');
    const resource = this.store(mime, decodeBase64(request.data));
    return { id: resource.id, mime: resource.mime, size: resource.bytes.length };
  }
  store(mime, bytes) {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ApiError(413, 'IMAGE_SIZE_LIMIT', 'Image exceeds 4 MiB');
    if (mime !== detectImageMime(bytes)) throw new ApiError(415, 'IMAGE_TYPE_MISMATCH', 'Image bytes do not match the declared type');
    const resource = { id: hash(bytes), mime, bytes: Buffer.from(bytes) };
    if (this.memory) {
      if (this.memory.has(resource.id)) return this.memory.get(resource.id);
      if (this.memory.size >= 200 || this.bytes + bytes.length > 32 * 1024 * 1024) throw new ApiError(413, 'RESOURCE_SESSION_LIMIT', '当前页面的临时图片已达到上限，请刷新页面开始新的练习。');
      this.memory.set(resource.id, resource); this.bytes += bytes.length; return resource;
    }
    safeDirectory(this.directory, true);
    const file = path.join(this.directory, resource.id + '.' + TYPES.get(mime));
    if (!exists(file)) replaceFile(file, bytes);
    else if (!readBytes(file, MAX_IMAGE_BYTES).equals(bytes)) throw new Error('Stored image has unrelated changes');
    return resource;
  }
  read(id) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) throw bad('Invalid image resource ID');
    if (this.memory) {
      const resource = this.memory.get(id);
      if (resource) return { ...resource, bytes: Buffer.from(resource.bytes) };
      if (this.fallback) return this.fallback.read(id);
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Image resource does not exist in this page session');
    }
    safeDirectory(this.directory);
    for (const [mime, extension] of TYPES) {
      const file = path.join(this.directory, `${id}.${extension}`);
      if (!exists(file)) continue;
      let bytes;
      try { bytes = readBytes(file, MAX_IMAGE_BYTES); }
      catch (error) { throw new ApiError(503, 'RESOURCE_UNAVAILABLE', 'Stored image is invalid', { cause: error }); }
      if (hash(bytes) !== id || detectImageMime(bytes) !== mime) throw new ApiError(503, 'RESOURCE_UNAVAILABLE', 'Stored image checksum or type is invalid');
      return { id, mime, bytes };
    }
    if (this.fallback) return this.fallback.read(id);
    throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Image resource does not exist');
  }
  importAssets(directory, staticAssets = [], extension = false) {
    const allowed = new Set(staticAssets.map(relative => safeFile(directory, relative))), assets = path.join(directory, 'assets');
    if (!exists(assets)) return;
    checkPath(assets, { directory: true });
    for (const file of walkFiles(assets)) {
      if (fs.lstatSync(file).isDirectory()) continue;
      if (/\.(mp3|m4a)$/i.test(file)) { resourceType(file,readBytes(file,(extension?8:32)*1024*1024)); continue; }
      const bytes = readBytes(file, MAX_IMAGE_BYTES), mime = detectImageMime(bytes);
      if (!mime && (extension || allowed.has(file))) continue;
      if (!mime) throw new Error('Bank assets support only PNG, JPEG, WebP and GIF');
      this.store(mime, bytes);
    }
  }
  importExtensionAssets(directory, assets) { return this.importAssets(directory, assets, true); }
  exportReferences(directory, document) {
    const ids = imageReferences(document);
    if (!ids.size) return;
    checkPath(directory, { directory: true });
    const assets = safeDirectory(path.join(directory, 'assets'), true);
    const existingHashes = new Set();
    for (const name of fs.readdirSync(assets)) {
      const file=path.join(assets,name); if (!fs.lstatSync(file).isFile() || !/\.(png|jpe?g|webp|gif)$/i.test(name)) continue;
      const bytes=readBytes(file,MAX_IMAGE_BYTES); if (detectImageMime(bytes)) existingHashes.add(hash(bytes));
    }
    for (const id of ids) {
      if (existingHashes.has(id)) continue;
      let resource;
      try { resource = this.read(id); }
      catch (error) { if (error instanceof ApiError) throw new ApiError(422, 'IMAGE_REFERENCE_UNAVAILABLE', 'A referenced image is unavailable; the question was not saved'); throw error; }
      const file = path.join(assets, `${id}.${TYPES.get(resource.mime)}`);
      if (!exists(file)) replaceFile(file, resource.bytes);
      else if (!readBytes(file, MAX_IMAGE_BYTES).equals(resource.bytes)) throw new Error('Bank image has unrelated changes');
    }
  }
}
