import fs from 'node:fs';
import path from 'node:path';
import { checkPath } from '../../host/platform/files.js';
import { hash } from '../../host/platform/json.js';
import { publicError } from '../utils/errors.js';
import { directories, readJson, READ_LIMITS } from '../utils/io.js';
import { relativeFile } from './resource.repository.js';
export const bankRoot = (directory) => checkPath(directory, { directory: true });
export function bankLocations(root) {
  const base = path.join(root, 'question-banks'),
    result = [];
  const add = (directory, group) => {
    const relative = path.relative(base, directory).replaceAll('\\', '/');
    result.push({
      directory,
      group,
      name: path.basename(directory),
      bankId: 'b_' + hash(Buffer.from(relative)),
    });
  };
  for (const group of directories(base)) {
    const directory = path.join(base, group);
    if (fs.existsSync(path.join(directory, 'bank.json'))) {
      add(directory, '未分组');
    } else {
      for (const name of directories(directory)) {
        const bank = path.join(directory, name);
        if (fs.existsSync(path.join(bank, 'bank.json'))) {
          add(bank, group);
        }
      }
    }
  }
  return result;
}
export function bankCatalog(root, cache) {
  const groups = new Map();
  for (const row of bankLocations(root)) {
    let item;
    try {
      const raw = readJson(relativeFile(row.directory, 'bank.json'), cache, READ_LIMITS.bankBytes, {
        bankId: row.bankId,
        field: 'bank.json',
      });
      item = {
        bankId: row.bankId,
        sourceId: typeof raw?.id === 'string' ? raw.id : null,
        title: typeof raw?.title === 'string' ? raw.title : row.name,
        kind: 'bank',
        availability: 'available',
        error: null,
      };
    } catch (error) {
      item = {
        bankId: row.bankId,
        sourceId: null,
        title: row.name,
        kind: 'bank',
        availability: 'unavailable',
        error: publicError(error),
      };
    }
    if (!groups.has(row.group)) {
      groups.set(row.group, {
        id: 'g_' + hash(Buffer.from(row.group)),
        name: row.group,
        items: [],
      });
    }
    groups.get(row.group).items.push(item);
  }
  return { groups: [...groups.values()] };
}
