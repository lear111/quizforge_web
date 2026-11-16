/** @typedef {import('../types/history.js').HistoryRound} HistoryRound */
/** @typedef {import('../../../shared/v2/state.js').StateSummary} StateSummary */
import { cloneJson, decimalSum } from '../../host/platform/json.js';
import { hasHistoryInk, invalidHistory } from '../repositories/history.repository.js';

/** @param {HistoryRound} round @param {string} id */
export function historicalState(round, id) {
  const state = round.state.questions[id];
  if (!state || !state.submissionId || state.result?.score == null) {
    throw invalidHistory();
  }
  return state;
}

/** @param {HistoryRound} round @param {string} id @returns {StateSummary} */
export function historySummary(round, id) {
  const state = historicalState(round, id);
  return {
    questionId: id,
    status: cloneJson(state.status),
    revision: state.revision,
    hasSavedAnswer: state.answer !== null || state.submissionId !== null,
    locked: true,
    score: state.result?.score ?? null,
    maxScore: round.maxScores.get(id) ?? 0,
    hasInk: hasHistoryInk(round, id),
  };
}

/** @param {HistoryRound} round */
export function historyTotal(round) {
  return {
    score: decimalSum(
      [...round.items.keys()].map((id) => historicalState(round, id).result?.score ?? 0),
    ),
    maxScore: decimalSum([...round.maxScores.values()]),
  };
}
