import path from 'node:path';
import { hash } from '../platform/json.js';
import { object, problem, publicError } from './errors.js';
import { directories, readJson, relativeFile, treeIdentity, READ_LIMITS } from './io.js';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const typePattern = /^([A-Za-z][A-Za-z0-9._-]{0,119})@(0|[1-9]\d*)$/;
const sdkVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export class TypeRegistry {
  constructor(root, cache) { this.root = path.join(root, 'extensions'); this.cache = cache; }
  scan() {
    const result = [];
    for (const group of directories(this.root)) for (const name of directories(path.join(this.root, group))) {
      const directory = path.join(this.root, group, name);
      try {
        const manifest = readJson(relativeFile(directory, 'manifest.json'), this.cache, READ_LIMITS.manifestBytes, { field: 'manifest.json' });
        result.push({ directory, manifest });
      } catch { /* An unreadable unrelated extension must not prevent other questions opening. */ }
    }
    return result;
  }
  resolve(type, rows) {
    const match = typeof type === 'string' && typePattern.exec(type);
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw problem('EXTENSION_NOT_FOUND', '题型须以 id@主版本号 指定已安装的拓展。', { field: 'type' }, 404);
    const candidates = rows.filter(({ manifest: m }) => m?.id === match[1] && typeof m.version === 'string' && versionPattern.test(m.version) && m.version.split('.')[0] === match[2]);
    if (!candidates.length) throw problem('EXTENSION_NOT_FOUND', '未安装该 id 和主版本号对应的题型。', { field: 'type' }, 404);
    if (candidates.length !== 1) throw problem('EXTENSION_AMBIGUOUS', '该题型 id 和主版本号对应多个已安装拓展，请移除重复项后刷新；不会自动选择。', { field: 'type', details: { matches: candidates.length } });
    const { directory, manifest: m } = candidates[0];
    if (m.apiVersion !== 2 || typeof m.name !== 'string' || !m.name.trim() || !object(m.entries) || !object(m.entries.practice)) throw problem('EXTENSION_INVALID', '拓展声明必须包含 apiVersion:2、name 和 entries.practice。', { field: 'manifest' });
    const files = new Map();
    for (const [name, relative] of Object.entries({ 'practice-html': m.entries.practice.html, 'practice-js': m.entries.practice.js, 'practice-css': m.entries.practice.css, 'grade-js': m.entries.grade })) files.set(name, relativeFile(directory, relative));
    const sdkVersions = m.sdkVersions ?? {};
    if (!object(sdkVersions) || Object.entries(sdkVersions).some(([id, value]) => !['richtext', 'answer-area', 'ink'].includes(id) || typeof value !== 'string' || !sdkVersionPattern.test(value))) throw problem('EXTENSION_INVALID', 'sdkVersions 须使用已支持组件名和三段数字版本。', { field: 'manifest.sdkVersions' });
    if (m.development !== undefined && typeof m.development !== 'boolean') throw problem('EXTENSION_INVALID', 'development 必须是布尔值。', { field: 'manifest.development' });
    const { digest, contentDigest } = treeIdentity(directory, this.cache, { field: 'extension' });
    const artifactId = 'e_' + hash(Buffer.from(path.relative(this.root, directory) + '\0' + digest));
    return { directory, manifest: m, files, sdkVersions, contentDigest, development: m.development === true,
      descriptor: { artifactId, id: m.id, version: m.version, apiVersion: 2, digest } };
  }
  resolutions(types) {
    const rows = this.scan(), result = new Map();
    for (const type of types) {
      try { result.set(type, { artifact: this.resolve(type, rows) }); }
      catch (error) { result.set(type, { error: publicError(error) }); }
    }
    return result;
  }
}
