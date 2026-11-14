import path from 'node:path';
import { checkPath, checkedStat, within } from '../../host/platform/files.js';
import { problem } from '../utils/errors.js';
import { READ_LIMITS, relativePath } from '../utils/io.js';

export function relativeFile(directory, relative) {
  relativePath(directory, relative);
  const parts = relative.split('/'),
    base = checkPath(directory, { directory: true });
  let file = base;
  try {
    for (let i = 0; i < parts.length; i++) {
      file = path.join(file, parts[i]);
      checkedStat(file, { directory: i < parts.length - 1 });
    }
    if (!within(base, file) || !checkedStat(file).stat.isFile()) {
      throw new Error('Not a file');
    }
  } catch {
    throw problem('ASSET_PATH_INVALID', '资源不存在，或路径包含链接、越界及非普通文件。');
  }
  return file;
}

export function resourceEntry(cache, file) {
  return cache.entry(file, READ_LIMITS.assetBytes);
}
