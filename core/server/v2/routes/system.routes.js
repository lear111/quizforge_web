import { API } from './paths.js';

export function registerSystemRoutes(app, handlers) {
  app.get('/', handlers.rootPage);
  app.get(['/ui/quizforge-ui.js', '/ui/quizforge-web-local.css'], handlers.ui);
  app.get(`${API}/health`, handlers.health);
  app.get(`${API}/catalog`, handlers.catalog);
}
