/** @typedef {import('../types/http.js').ServerContext} ServerContext */
/** @typedef {import('../types/http.js').Handler} Handler */
import { json } from '../utils/http-response.js';

/**
 * @param {ServerContext} server
 * @returns {Record<'rounds' | 'roundOverview' | 'roundQuestion' | 'roundAsset', Handler>}
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
  };
}
