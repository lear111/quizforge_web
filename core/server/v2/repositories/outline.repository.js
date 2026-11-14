import { decimalSum } from '../../host/platform/json.js';
import { problem } from '../utils/errors.js';
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
function fail(bankId, field, reason, questionId) {
  throw problem('BANK_STRUCTURE_INVALID', '题库的大纲或信息有误：' + field + '，' + reason, {
    bankId,
    ...(questionId === undefined ? {} : { questionId }),
    field,
  });
}
function itemScore(item, field, bankId) {
  if (!Object.hasOwn(item, 'parts')) {
    if (!positive(item.maxScore)) {
      fail(bankId, field + '.maxScore', '必须为大于 0 的有限数', item.id);
    }
    return item.maxScore;
  }
  const ids = new Set();
  for (const [index, part] of item.parts.entries()) {
    const path = field + '.parts[' + index + ']';
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
export function outlineIndex(outline, bankId) {
  if (!Array.isArray(outline)) {
    fail(bankId, 'outline', '必须是分组数组');
  }
  const items = new Map(),
    maxScores = new Map();
  for (const [groupIndex, group] of outline.entries()) {
    for (const [itemIndex, item] of (group.items ?? []).entries()) {
      const field = 'outline[' + groupIndex + '].items[' + itemIndex + ']';
      if (items.has(item.id)) {
        fail(bankId, field + '.id', '大题题号在全库重复', item.id);
      }
      maxScores.set(item.id, itemScore(item, field, bankId));
      items.set(item.id, item);
    }
  }
  return { items, maxScores };
}
