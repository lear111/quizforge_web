/** @typedef {import('../../../shared/v2/state.js').GradeResult} GradeResult */
/** @typedef {import('../../../shared/v2/state.js').QuestionState} QuestionState */
/** @typedef {import('../types/data.js').LoadedState} LoadedState */
import { projectJson } from '../../host/platform/json.js';
import { object } from '../utils/errors.js';
import { integer, own, invalid } from '../utils/state.js';
import { validOldReceipts, validReceipts } from '../utils/receipts.js';
import { validateAnswered, isOutlineStatus } from '../../../shared/v2/answered.js';
/**
 * @param {unknown} result
 * @returns {result is GradeResult}
 */
export const validResultShape = (result) =>
  object(result) &&
  Object.keys(result).length === 3 &&
  (result.score === null
    ? result.parts === null &&
      (result.message === null || (typeof result.message === 'string' && !!result.message.trim()))
    : Number.isFinite(result.score) &&
      result.message === null &&
      (result.parts === null ||
        (object(result.parts) && Object.values(result.parts).every(Number.isFinite))));
/**
 * @param {unknown} state
 * @param {unknown} contentFingerprint
 */
export function validOldQuestion(state, contentFingerprint) {
  if (
    !object(state) ||
    !integer(state.revision) ||
    !integer(state.answerVersion) ||
    !integer(state.resultRevision) ||
    !validOldReceipts(state)
  ) {
    return false;
  }
  if (own(state, 'answered')) {
    validateAnswered(state.answered);
  }
  if (
    state.submission !== null &&
    (!object(state.submission) ||
      typeof state.submission.submissionId !== 'string' ||
      state.submission.answerVersion !== state.answerVersion ||
      state.submission.contentFingerprint !== contentFingerprint)
  ) {
    return false;
  }
  return (
    [
      'unanswered',
      'drafting',
      'submitted-pending',
      'graded',
      'pending-review',
      'ungradable',
    ].includes(/** @type {string} */ (state.status)) &&
    Boolean(state.submission) !==
      ['unanswered', 'drafting'].includes(/** @type {string} */ (state.status))
  );
}
/**
 * @param {unknown} state
 * @returns {state is QuestionState}
 */
export function validQuestion(state) {
  if (
    !object(state) ||
    Object.keys(state).length !== 6 ||
    !integer(state.revision) ||
    !validReceipts(state.receipts) ||
    !own(state, 'answer')
  ) {
    return false;
  }
  if (
    !isOutlineStatus(state.status) &&
    !(object(state.status) && Object.values(state.status).every(isOutlineStatus))
  ) {
    return false;
  }
  if (
    state.submissionId !== null &&
    (typeof state.submissionId !== 'string' || !state.submissionId.trim())
  ) {
    return false;
  }
  return state.result === null || (state.submissionId !== null && validResultShape(state.result));
}

/**
 * @param {unknown} value
 * @returns {asserts value is LoadedState}
 */
export function validateState(value) {
  if (!object(value) || value.formatVersion !== 2 || !object(value.questions)) {
    throw invalid();
  }
  if (
    own(value, 'completedAt') &&
    value.completedAt !== null &&
    (typeof value.completedAt !== 'string' || !Number.isFinite(Date.parse(value.completedAt)))
  ) {
    throw invalid();
  }
  if (own(value, 'historyIndex')) {
    // Only a recognizable older development record is reset on open.
    if (
      !Array.isArray(value.historyIndex) ||
      !Object.values(value.questions).every((state) =>
        validOldQuestion(state, value.contentFingerprint),
      )
    ) {
      throw invalid();
    }
  } else {
    for (const [id, raw] of Object.entries(value.questions)) {
      // D36: obsolete notes are omitted without rewriting on a read.
      const state =
        object(raw) && own(raw, 'draft')
          ? projectJson(
              raw,
              Object.keys(raw).filter((key) => key !== 'draft'),
            )
          : raw;
      if (!validQuestion(state)) {
        throw invalid();
      }
      if (state !== raw) {
        value.questions[id] = state;
      }
    }
  }
}
