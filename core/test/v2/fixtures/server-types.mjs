import { PracticeState } from '../../../server/v2/services/practice.service.js';
/** @import { LibrarySnapshots } from '../../../server/v2/services/bank.service.js' */
import {
  validQuestion,
  validResultShape,
  validateState,
} from '../../../server/v2/repositories/state-shape.repository.js';
import { own } from '../../../server/v2/utils/state.js';
import { problem } from '../../../server/v2/utils/errors.js';
/** @import { Snapshot } from '../../../server/v2/types/data.js' */
/** @import { HttpResponse, ServerContext, SdkHandler } from '../../../server/v2/types/http.js' */

// This module is only input to tsc; tests never execute it or open real files.
/** @param {unknown} value */
export function checkedQuestion(value) {
  return validQuestion(value) ? value.revision.toFixed(0) : null;
}
/** @param {unknown} value */
export function checkedResult(value) {
  if (!validResultShape(value)) {
    return null;
  }
  return value.score === null ? value.message : value.score.toFixed(2);
}
/** @param {unknown} value */
export function checkedRecord(value) {
  validateState(value);
  return own(value, 'historyIndex') ? null : value.questions.q?.revision;
}
/** @param {LibrarySnapshots} library */
export function completeRead(library) {
  return library.question('bank', 'question', 'snapshot').inkRevision.toFixed(0);
}
/** @param {Snapshot} snapshot */
export function stateView(snapshot) {
  const state = new PracticeState();
  return state.get(snapshot, 'q').result?.score;
}

export { problem };
