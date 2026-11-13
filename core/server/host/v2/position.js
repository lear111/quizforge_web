import path from 'node:path';
import { checkPath, checkedStat, readBytes, replaceFile } from '../platform/files.js';
import { jsonBytes, parseJson } from '../platform/json.js';
import { object, problem } from './errors.js';
import { READ_LIMITS } from './io.js';

// Independent from answer-state commits, revisions and receipts. Never cached:
// moving a bank carries this file, and external deletion takes effect on open.
export class PracticePosition {
  constructor({ write = replaceFile } = {}) { this.write = write; }
  file(directory) {
    const local = path.join(checkPath(directory, { directory: true }), '.qf-v2');
    checkedStat(local, { directory: true, optional: true });
    return path.join(local, 'position.json');
  }
  read(directory) {
    try {
      const bytes = readBytes(this.file(directory), READ_LIMITS.bankBytes, true);
      if (!bytes) return null;
      const value = parseJson(bytes);
      if (!object(value) || value.formatVersion !== 2 || typeof value.questionId !== 'string') throw new Error();
      return value.questionId;
    } catch { throw problem('POSITION_UNAVAILABLE', '上次位置无法读取，原文件已保留。', {}, 503); }
  }
  save(directory, questionId) {
    try { this.write(this.file(directory), jsonBytes({ formatVersion: 2, questionId })); }
    catch { throw problem('POSITION_UNAVAILABLE', '上次位置未能保存，请重试。', {}, 503); }
    return { questionId };
  }
}
