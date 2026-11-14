import { QUESTION } from './paths.js';

export function registerQuestionReadRoutes(app, handlers) {
  app.get(QUESTION, handlers.question);
  app.get(`${QUESTION}/assets/:assetId`, handlers.asset);
}

export function registerQuestionWriteRoutes(app, handlers, body) {
  app.put(`${QUESTION}/answer`, body, handlers.answer);
  app.put(`${QUESTION}/ink`, body, handlers.ink);
  app.post(`${QUESTION}/submit`, body, handlers.submit);
  app.put(`${QUESTION}/result`, body, handlers.result);
  app.post(`${QUESTION}/retry`, body, handlers.retry);
}
