/** @typedef {import('../../../shared/v2/bank.js').OutlineItem} OutlineItem */
/** @typedef {import('../../../shared/v2/answered.js').OutlineStatus} OutlineStatus */
/** @typedef {import('../../../shared/v2/state.js').GradeResult} GradeResult */
/** @typedef {import('../../../shared/v2/answered.js').OutlineValue} OutlineValue */
import { decimalSum } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { own } from '../utils/state.js';
import { validResultShape } from '../repositories/state-shape.repository.js';
/**
 * @param {OutlineItem} item
 * @param {OutlineStatus} status
 * @param {GradeResult} result
 * @returns {OutlineStatus}
 */
export function statusAfterResult(item, status, result) {
  if (result.score === null && result.message === null) {
    return status;
  }
  /**
   * @param {number | null | undefined} score
   * @param {number | undefined} max
   * @returns {OutlineValue}
   */
  const value = (score, max) =>
    result.score === null ? 'ungradable' : score === max ? 'correct' : 'wrong';
  return item.parts
    ? Object.fromEntries(
        item.parts.map((part) => [part.id, value(result.parts?.[part.id], part.maxScore)]),
      )
    : value(result.score, item.maxScore);
}

/**
 * @param {OutlineItem} item
 * @param {unknown} result
 * @returns {asserts result is GradeResult}
 */
export function validateResult(item, result) {
  /** @returns {never} */
  const fail = () => {
    throw problem('INVALID_RESULT', '评分格式或分数与本题大纲不符。');
  };
  if (!validResultShape(result)) {
    fail();
  }
  if (result.score === null) {
    return;
  }
  /**
   * @param {unknown} value
   * @param {unknown} max @returns {value is number}
   */
  const finiteScore = (value, max) =>
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= /** @type {number} */ (max);
  const max = item.parts ? decimalSum(item.parts.map((part) => part.maxScore)) : item.maxScore;
  if (!finiteScore(result.score, max)) {
    fail();
  }
  if (item.parts) {
    if (!object(result.parts) || Object.keys(result.parts).length !== item.parts.length) {
      fail();
    }
    const parts = result.parts;
    const scores = item.parts.map((part) => {
      if (!own(parts, part.id) || !finiteScore(parts[part.id], part.maxScore)) {
        fail();
      }
      return parts[part.id];
    });
    if (decimalSum(scores) !== result.score) {
      fail();
    }
  } else if (result.parts !== null) {
    fail();
  }
}
