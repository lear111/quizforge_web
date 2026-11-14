/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
import { decimalSum } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
/**
 * @param {unknown} value
 * @returns {value is number}
 */
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
/**
 * @param {string} bankId
 * @param {string} field
 * @param {string} reason
 * @param {unknown} [questionId]
 * @returns {never}
 */
function fail(bankId, field, reason, questionId) {
  throw problem('BANK_STRUCTURE_INVALID', '题库的大纲或信息有误：' + field + '，' + reason, {
    bankId,
    ...(questionId === undefined ? {} : { questionId }),
    field,
  });
}
/**
 * @param {unknown} value
 * @param {string} bankId
 * @param {string} field
 * @param {unknown} [questionId]
 * @returns {asserts value is Record<string, unknown>}
 */
function requireObject(value, bankId, field, questionId) {
  if (!object(value)) {
    fail(bankId, field, '必须是对象', questionId);
  }
}
/**
 * @param {unknown} value
 * @param {string} bankId
 * @param {string} field
 * @param {unknown} [questionId]
 * @returns {asserts value is string}
 */
function requireId(value, bankId, field, questionId) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(bankId, field, '题号必须是非空字符串', questionId);
  }
}
/**
 * @param {Record<string, unknown>} item
 * @param {string} field
 * @param {string} bankId
 * @returns {number}
 */
function itemScore(item, field, bankId) {
  if (!Object.hasOwn(item, 'parts')) {
    if (!positive(item.maxScore)) {
      fail(bankId, field + '.maxScore', '必须为大于 0 的有限数', item.id);
    }
    return item.maxScore;
  }
  if (!Array.isArray(item.parts)) {
    fail(bankId, field + '.parts', '必须是小题数组', item.id);
  }
  const ids = new Set();
  for (const [index, part] of item.parts.entries()) {
    const path = field + '.parts[' + index + ']';
    requireObject(part, bankId, path, item.id);
    requireId(part.id, bankId, path + '.id', item.id);
    if (ids.has(part.id)) {
      fail(bankId, path + '.id', '小题题号须在该大题内唯一', item.id);
    }
    ids.add(part.id);
    if (!positive(part.maxScore)) {
      fail(bankId, path + '.maxScore', '必须为大于 0 的有限数', item.id);
    }
  }
  // A valid score per part can still overflow when summed; never persist an infinite maximum.
  let total;
  try {
    total = decimalSum(item.parts.map((part) => part.maxScore));
  } catch {
    fail(bankId, field + '.parts', '小题满分之和必须为有限数', item.id);
  }
  if (!positive(total)) {
    fail(bankId, field + '.parts', '小题满分之和必须为有限数', item.id);
  }
  return total;
}
/**
 * @param {unknown} outline
 * @param {string} bankId
 * @returns {{items: Map<string, OutlineItem>, maxScores: Map<string, number>}}
 */
export function outlineIndex(outline, bankId) {
  if (!Array.isArray(outline)) {
    fail(bankId, 'outline', '必须是分组数组');
  }
  const items = /** @type {Map<string, OutlineItem>} */ (new Map()),
    maxScores = /** @type {Map<string, number>} */ (new Map());
  for (const [groupIndex, group] of outline.entries()) {
    const groupField = 'outline[' + groupIndex + ']';
    requireObject(group, bankId, groupField);
    if (!Array.isArray(group.items)) {
      fail(bankId, groupField + '.items', '必须是大题数组');
    }
    for (const [itemIndex, item] of group.items.entries()) {
      const field = groupField + '.items[' + itemIndex + ']';
      requireObject(item, bankId, field);
      requireId(item.id, bankId, field + '.id');
      if (items.has(item.id)) {
        fail(bankId, field + '.id', '大题题号在全库重复', item.id);
      }
      maxScores.set(item.id, itemScore(item, field, bankId));
      items.set(item.id, /** @type {Record<string, unknown> & OutlineItem} */ (item));
    }
  }
  return { items, maxScores };
}
