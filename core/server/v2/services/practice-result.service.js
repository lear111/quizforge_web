import { decimalSum } from '../../host/platform/json.js';
import { object, problem } from '../utils/errors.js';
import { own } from '../utils/state.js';
import { validResultShape } from '../repositories/state-shape.repository.js';
export function statusAfterResult(item, status, result) {
  if (result.score === null && result.message === null) {
    return status;
  }
  const value = (score, max) =>
    result.score === null ? 'ungradable' : score === max ? 'correct' : 'wrong';
  return item.parts
    ? Object.fromEntries(
        item.parts.map((part) => [part.id, value(result.parts?.[part.id], part.maxScore)]),
      )
    : value(result.score, item.maxScore);
}

export function validateResult(item, result) {
  const fail = () => {
    throw problem('INVALID_RESULT', '评分格式或分数与本题大纲不符。');
  };
  if (!validResultShape(result)) {
    fail();
  }
  if (result.score === null) {
    return;
  }
  const finiteScore = (value, max) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const max = item.parts ? decimalSum(item.parts.map((part) => part.maxScore)) : item.maxScore;
  if (!finiteScore(result.score, max)) {
    fail();
  }
  if (item.parts) {
    if (!object(result.parts) || Object.keys(result.parts).length !== item.parts.length) {
      fail();
    }
    const scores = item.parts.map((part) => {
      if (!own(result.parts, part.id) || !finiteScore(result.parts[part.id], part.maxScore)) {
        fail();
      }
      return result.parts[part.id];
    });
    if (decimalSum(scores) !== result.score) {
      fail();
    }
  } else if (result.parts !== null) {
    fail();
  }
}
