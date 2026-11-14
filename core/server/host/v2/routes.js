import express from 'express';
import { problem } from './errors.js';
import {
  apiAccess,
  checkTarget,
  defaultHeaders,
  readJson,
  requireJson,
  saveTiming,
} from './http-middleware.js';
import { createHandlers } from './http-handlers.js';
import { rootPage, writeError } from './http-response.js';

const API = '/api/v2';
const BANK = `${API}/banks/:bankId`;
const QUESTION = `${BANK}/questions/:questionId`;
const EXTENSION = `${API}/extensions/:artifactId`;

function fallback(request, response) {
  if (response.locals.parts[0] !== 'api') {
    throw problem('RESOURCE_NOT_FOUND', '页面或资源不存在。', {}, 404);
  }
  if (['GET', 'HEAD'].includes(request.method)) {
    throw problem('FEATURE_NOT_IMPLEMENTED', '此接口尚未实现。', {}, 501);
  }
  request.resume();
  throw problem('FEATURE_NOT_IMPLEMENTED', '此功能将在后续阶段开放。', {}, 501);
}

export function createApp(server) {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  app.disable('query parser');
  app.enable('case sensitive routing');
  app.use(saveTiming(server), defaultHeaders, checkTarget(server), apiAccess(server));

  const handlers = createHandlers(server);
  const body = [requireJson, readJson];
  app.get('/', rootPage);
  app.get(['/ui/quizforge-ui.js', '/ui/quizforge-web-local.css'], handlers.ui);
  app.get(`${API}/health`, handlers.health);
  app.get(`${API}/catalog`, handlers.catalog);
  app.get(`${BANK}/overview`, handlers.overview);
  app.get(QUESTION, handlers.question);
  app.get(`${QUESTION}/assets/:assetId`, handlers.asset);
  app.get(`${BANK}/listening/:materialId`, handlers.listening);
  app.get(`${EXTENSION}/manifest`, handlers.manifest);
  app.get(`${EXTENSION}/files/:entryId`, handlers.extensionFile);
  app.get(`${EXTENSION}/*rest`, handlers.unknownExtensionRoute);
  app.get(`${API}/sdk/:component/:version/*entry`, handlers.sdk);
  app.post(`${BANK}/refresh`, body, handlers.refresh);
  app.post(`${BANK}/finish`, body, handlers.finish);
  app.put(`${BANK}/results`, body, handlers.results);
  app.put(`${QUESTION}/answer`, body, handlers.answer);
  app.put(`${QUESTION}/ink`, body, handlers.ink);
  app.post(`${QUESTION}/submit`, body, handlers.submit);
  app.put(`${QUESTION}/result`, body, handlers.result);
  app.post(`${QUESTION}/retry`, body, handlers.retry);

  app.use(fallback, writeError);
  return app;
}
