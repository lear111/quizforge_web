import { BANK } from './paths.js';

export function registerHistoryRoutes(app, handlers, body) {
  const round = `${BANK}/rounds/:roundId`;
  app.get(`${BANK}/rounds`, handlers.rounds);
  app.get(`${round}/overview`, handlers.roundOverview);
  app.get(`${round}/questions/:questionId`, handlers.roundQuestion);
  app.get(`${round}/questions/:questionId/assets/:assetId`, handlers.roundAsset);
  app.put(`${round}/questions/:questionId/ink`, body, handlers.roundInk);
  app.delete(round, handlers.roundDelete);
  // Only host scratch ink is editable; no answer, submit, retry or result route.
}
