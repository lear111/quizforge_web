import { BANK } from './paths.js';

export function registerHistoryRoutes(app, handlers) {
  const round = `${BANK}/rounds/:roundId`;
  app.get(`${BANK}/rounds`, handlers.rounds);
  app.get(`${round}/overview`, handlers.roundOverview);
  app.get(`${round}/questions/:questionId`, handlers.roundQuestion);
  app.get(`${round}/questions/:questionId/assets/:assetId`, handlers.roundAsset);
  // No answer, submit, retry, result, ink write or delete route exists here.
}
