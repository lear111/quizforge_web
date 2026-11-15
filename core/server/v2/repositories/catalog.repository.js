/** @typedef {import('../types/data.js').BankLocation} BankLocation */
/** @typedef {import('../../host/platform/file-cache.js').FileCache} FileCache */
/** @typedef {import('../../../shared/v2/api.js').CatalogResponse} Catalog */
import fs from 'node:fs';
import path from 'node:path';
import { checkPath } from '../../host/platform/files.js';
import { hash } from '../../host/platform/json.js';
import { publicError } from '../utils/errors.js';
import { directories, readJson, READ_LIMITS } from '../utils/io.js';
import { relativeFile } from './resource.repository.js';
import { optionalProperty } from '../utils/properties.js';
/**
 * @param {string} directory
 */
export const bankRoot = (directory) => checkPath(directory, { directory: true });
/**
 * @param {string} root
 * @returns {BankLocation[]}
 */
export function bankLocations(root) {
  const base = path.join(root, 'question-banks'),
    /** @type {BankLocation[]} */ result = [];
  /** @param {string} directory @param {string} group */
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
/**
 * @param {string} root
 * @param {FileCache} cache
 * @returns {Catalog}
 */
export function bankCatalog(root, cache) {
  const /** @type {Map<string, Catalog['groups'][number]>} */ groups = new Map();
  for (const row of bankLocations(root)) {
    /** @type {Catalog['groups'][number]['items'][number]} */
    let item;
    try {
      const raw = readJson(relativeFile(row.directory, 'bank.json'), cache, READ_LIMITS.bankBytes, {
        bankId: row.bankId,
        field: 'bank.json',
      });
      const sourceId = optionalProperty(raw, 'id'),
        title = optionalProperty(raw, 'title');
      item = {
        bankId: row.bankId,
        sourceId: typeof sourceId === 'string' ? sourceId : null,
        title: typeof title === 'string' ? title : row.name,
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
    let group = groups.get(row.group);
    if (group === undefined) {
      group = {
        id: 'g_' + hash(Buffer.from(row.group)),
        name: row.group,
        items: [],
      };
      groups.set(row.group, group);
    }
    group.items.push(item);
  }
  return { groups: [...groups.values()] };
}
