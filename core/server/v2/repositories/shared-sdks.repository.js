import fs from 'node:fs';
import path from 'node:path';
import { checkPath } from '../../host/platform/files.js';
import { problem } from '../utils/errors.js';
import { treeIdentity } from '../utils/io.js';

const components = ['richtext', 'answer-area', 'ink'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class SharedSdks {
  constructor(codeRoot, cache) {
    this.root = path.join(codeRoot, 'shared');
    this.cache = cache;
    this.versions = new Map();
  }

  rebuild() {
    // Each boundary builds a fresh generation; removed versions never linger.
    const versions = new Map();
    for (const component of components) {
      const directory = path.join(this.root, component);
      let names;
      try {
        names = fs.readdirSync(checkPath(directory, { directory: true })).sort();
      } catch {
        continue;
      }
      for (const version of names.filter((name) => versionPattern.test(name))) {
        const key = `${component}@${version}`;
        try {
          const location = checkPath(path.join(directory, version), { directory: true });
          const { digest, hashes } = treeIdentity(location, this.cache, { field: 'sdk' });
          versions.set(key, { directory: location, digest, hashes });
        } catch (error) {
          if (error.code === 'FILE_COUNT_LIMIT') {
            versions.set(key, error);
          }
        }
      }
    }
    this.versions = versions;
  }

  get(component, version) {
    const value = this.versions.get(`${component}@${version}`);
    if (value instanceof Error) {
      throw value;
    }
    if (!value) {
      throw problem('SDK_UNAVAILABLE', '题型所需的公共组件未安装或无法读取。', {}, 404);
    }
    return value;
  }
}
