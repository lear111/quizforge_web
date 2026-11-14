import { BANK } from './paths.js';

export function registerBankOverviewRoute(app, handlers) {
  app.get(`${BANK}/overview`, handlers.overview);
}

export function registerBankListeningRoute(app, handlers) {
  app.get(`${BANK}/listening/:materialId`, handlers.listening);
}

export function registerBankWriteRoutes(app, handlers, body) {
  app.post(`${BANK}/refresh`, body, handlers.refresh);
  app.post(`${BANK}/finish`, body, handlers.finish);
  app.put(`${BANK}/results`, body, handlers.results);
}
