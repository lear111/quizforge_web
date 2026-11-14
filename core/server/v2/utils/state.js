import { problem } from './errors.js';
export const integer = (value) => Number.isSafeInteger(value) && value >= 0;
export const own = (value, key) => Object.hasOwn(value, key);
export const invalid = () => problem('STATE_INVALID', '作答记录无法读取，原文件已保留。', {}, 503);
export const increment = (value) => {
  if (!integer(value + 1)) {
    throw problem('STATE_INVALID', '作答记录版本无法继续递增，原文件已保留。', {}, 503);
  }
  return value + 1;
};
export const empty = () => ({ formatVersion: 2, questions: {} });
