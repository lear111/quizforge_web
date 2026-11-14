import path from 'node:path';
import { problem } from '../utils/errors.js';
import { relativeFile, resourceEntry } from '../repositories/resource.repository.js';

export function uiFile(codeRoot, entry) {
  return relativeFile(path.join(codeRoot, 'web', 'ui'), entry);
}

export function sdkResource(library, { component, version, entry }, snapshot) {
  const key = `${component}@${version}`;
  const sdk = [...library.opened.values()]
    .filter((value) => snapshot === null || value.snapshotId === snapshot)
    .map((value) => value.sdk.get(key))
    .find(Boolean);
  if (!sdk) {
    throw problem('SDK_UNAVAILABLE', '该公共组件未在已打开题库中声明。', {}, 404);
  }
  const relative = entry.join('/');
  return {
    file: relativeFile(sdk.directory, relative),
    expectedHash: snapshot === null ? undefined : sdk.hashes.get(relative),
  };
}

export function readResource(library, file) {
  return resourceEntry(library.cache, file);
}
