/** @typedef {import('../types/http.js').ServerContext} ServerContext */
/** @typedef {import('../types/http.js').Handler} Handler */
/**
 * @typedef {'rounds' | 'roundOverview' | 'roundQuestion' |
 * 'roundAsset' | 'roundInk' | 'roundDelete'} HistoryHandler
 */
import { json } from '../utils/http-response.js';

/**
 * @param {ServerContext} server
 * @returns {Record<HistoryHandler, Handler>}
 */
export function historyHandlers(server) {
  const history = server.library.history;
  return {
    rounds(request, response) {
      json(response, 200, history.list(request.params.bankId));
    },
    roundOverview(request, response) {
      json(response, 200, history.overview(request.params.bankId, request.params.roundId));
    },
    roundQuestion(request, response) {
      const { bankId, roundId, questionId } = request.params;
      json(response, 200, history.question(bankId, roundId, questionId));
    },
    roundAsset(request, response) {
      const { bankId, roundId, questionId, assetId } = request.params;
      server.binary(request, response, history.asset(bankId, roundId, questionId, assetId));
    },
    roundInk(request, response) {
      const { bankId, roundId, questionId } = request.params;
      json(response, 200, history.saveInk(bankId, roundId, questionId, response.locals.input));
    },
    roundDelete(request, response) {
      history.delete(request.params.bankId, request.params.roundId);
      response.status(204).end();
    },
  };
}
