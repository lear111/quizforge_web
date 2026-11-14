import path from 'node:path';
import { hash } from '../platform/json.js';
import { fileIdentity } from '../platform/file-cache.js';
import { object, problem, publicError } from './errors.js';
import { directories, readJson, relativeFile, treeIdentity, READ_LIMITS } from './io.js';
import { measureOverview } from './timing.js';

const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const typePattern = /^([A-Za-z][A-Za-z0-9._-]{0,119})@(0|[1-9]\d*)$/;
const sdkVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MANIFEST_CACHE_LIMIT = 256;

function validType(type) {
  const match = typeof type === 'string' && typePattern.exec(type);
  return Boolean(match && Number.isSafeInteger(Number(match[2])));
}

function manifestType(manifest) {
  if (typeof manifest?.id !== 'string' || typeof manifest.version !== 'string') {
    return null;
  }
  if (!versionPattern.test(manifest.version)) {
    return null;
  }
  const type = `${manifest.id}@${manifest.version.split('.')[0]}`;
  return validType(type) ? type : null;
}

export class TypeRegistry {
  constructor(root, cache) {
    this.root = path.join(root, 'extensions');
    this.cache = cache;
    this.index = new Map();
    this.manifests = new Map();
    this.scanError = null;
  }

  manifest(directory) {
    const file = path.join(directory, 'manifest.json');
    const identity = fileIdentity(file);
    const cached = this.manifests.get(directory);
    this.manifests.delete(directory);
    const manifest =
      cached?.identity === identity
        ? cached.manifest
        : readJson(
            relativeFile(directory, 'manifest.json'),
            this.cache,
            READ_LIMITS.manifestBytes,
            { field: 'manifest.json' },
          );
    this.manifests.set(directory, { identity, manifest });
    if (this.manifests.size > MANIFEST_CACHE_LIMIT) {
      this.manifests.delete(this.manifests.keys().next().value);
    }
    return manifest;
  }

  scan() {
    const result = [];
    for (const group of directories(this.root)) {
      for (const name of directories(path.join(this.root, group))) {
        const directory = path.join(this.root, group, name);
        try {
          result.push({ directory, type: manifestType(this.manifest(directory)) });
        } catch {
          /* An unreadable unrelated extension must not prevent other questions opening. */
        }
      }
    }
    return result;
  }

  rebuild() {
    this.manifests.clear();
    const index = new Map();
    let scanError = null;
    try {
      for (const candidate of measureOverview('extension-scan', () => this.scan())) {
        const { directory, type } = candidate;
        if (type !== null) {
          if (!index.has(type)) {
            index.set(type, []);
          }
          index.get(type).push(directory);
        }
      }
    } catch (error) {
      // Installing a broken directory must not take down health or catalog.
      scanError = error;
    }
    this.index = index;
    this.scanError = scanError;
  }

  candidates(type) {
    const matches = [];
    for (const directory of this.index.get(type) ?? []) {
      try {
        const manifest = this.manifest(directory);
        if (manifestType(manifest) === type) {
          matches.push({ directory, manifest });
        }
      } catch {
        // A removed or unreadable manifest is no longer a candidate.
      }
    }
    return matches;
  }

  resolve(type) {
    if (!validType(type)) {
      throw problem(
        'EXTENSION_NOT_FOUND',
        '题型须以 id@主版本号 指定已安装的拓展。',
        { field: 'type' },
        404,
      );
    }
    const candidates = this.candidates(type);
    if (!candidates.length) {
      throw problem(
        'EXTENSION_NOT_FOUND',
        '未安装该 id 和主版本号对应的题型。',
        { field: 'type' },
        404,
      );
    }
    if (candidates.length !== 1) {
      throw problem(
        'EXTENSION_AMBIGUOUS',
        '该题型 id 和主版本号对应多个已安装拓展，请移除重复项后刷新；不会自动选择。',
        { field: 'type', details: { matches: candidates.length } },
      );
    }
    const { directory, manifest: m } = candidates[0];
    if (
      m.apiVersion !== 2 ||
      typeof m.name !== 'string' ||
      !m.name.trim() ||
      !object(m.entries) ||
      !object(m.entries.practice)
    ) {
      throw problem(
        'EXTENSION_INVALID',
        '拓展声明必须包含 apiVersion:2、name 和 entries.practice。',
        { field: 'manifest' },
      );
    }
    const files = new Map();
    for (const [name, relative] of Object.entries({
      'practice-html': m.entries.practice.html,
      'practice-js': m.entries.practice.js,
      'practice-css': m.entries.practice.css,
      'grade-js': m.entries.grade,
    })) {
      files.set(name, relativeFile(directory, relative));
    }
    const sdkVersions = m.sdkVersions ?? {};
    if (
      !object(sdkVersions) ||
      Object.entries(sdkVersions).some(
        ([id, value]) =>
          !['richtext', 'answer-area', 'ink'].includes(id) ||
          typeof value !== 'string' ||
          !sdkVersionPattern.test(value),
      )
    ) {
      throw problem('EXTENSION_INVALID', 'sdkVersions 须使用已支持组件名和三段数字版本。', {
        field: 'manifest.sdkVersions',
      });
    }
    if (m.development !== undefined && typeof m.development !== 'boolean') {
      throw problem('EXTENSION_INVALID', 'development 必须是布尔值。', {
        field: 'manifest.development',
      });
    }
    const { digest, contentDigest, hashes } = treeIdentity(directory, this.cache, {
      field: 'extension',
    });
    const artifactId =
      'e_' + hash(Buffer.from(path.relative(this.root, directory) + '\0' + digest));
    return {
      directory,
      manifest: m,
      files,
      hashes,
      sdkVersions,
      contentDigest,
      development: m.development === true,
      descriptor: { artifactId, id: m.id, version: m.version, apiVersion: 2, digest },
    };
  }
  resolveAll(types) {
    if (this.scanError) {
      throw this.scanError;
    }
    return new Map([...types].map((type) => [type, this.resolveEntry(type)]));
  }

  resolutions(types, { scanOnMiss = true } = {}) {
    const result = this.resolveAll(types);
    if (
      scanOnMiss &&
      [...result].some(
        ([type, value]) => value.error?.code === 'EXTENSION_NOT_FOUND' && validType(type),
      )
    ) {
      this.rebuild();
      return this.resolveAll(types);
    }
    return result;
  }

  resolveEntry(type) {
    try {
      return { artifact: measureOverview('extension-resolve', () => this.resolve(type)) };
    } catch (error) {
      return { error: publicError(error) };
    }
  }
}
