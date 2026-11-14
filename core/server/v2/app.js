import http from 'node:http';
import os from 'node:os';
import express from 'express';
import { createHandlers } from './controllers/http.controller.js';
import {
  apiAccess,
  checkTarget,
  defaultHeaders,
  fallback,
  readJson,
  requireJson,
  saveTiming,
  writeError,
} from './middleware/http.middleware.js';
import {
  registerBankListeningRoute,
  registerBankOverviewRoute,
  registerBankWriteRoutes,
} from './routes/bank.routes.js';
import { registerExtensionRoutes } from './routes/extension.routes.js';
import {
  registerQuestionReadRoutes,
  registerQuestionWriteRoutes,
} from './routes/question.routes.js';
import { registerSystemRoutes } from './routes/system.routes.js';
import { LibrarySnapshots } from './services/bank.service.js';
import { PracticeState } from './services/practice.service.js';
import { readResource } from './services/resource.service.js';
import { problem } from './utils/errors.js';
import { writeBinary, immutable } from './utils/http-response.js';

const loopback = (value) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);

function validateListener(host, port, token) {
  if (
    typeof host !== 'string' ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (token !== null && (typeof token !== 'string' || token.length < 8 || token.length > 256))
  ) {
    throw problem('INVALID_CONFIGURATION', '监听地址、端口或访问令牌无效。', {}, 400);
  }
  if (!loopback(host) && host !== 'localhost' && !token) {
    throw problem(
      'AUTH_REQUIRED',
      '开放非回环地址必须显式设置访问令牌；V2 不继承旧局域网设置。',
      {},
      403,
    );
  }
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
  registerSystemRoutes(app, handlers);
  registerBankOverviewRoute(app, handlers);
  registerQuestionReadRoutes(app, handlers);
  registerBankListeningRoute(app, handlers);
  registerExtensionRoutes(app, handlers);
  registerBankWriteRoutes(app, handlers, body);
  registerQuestionWriteRoutes(app, handlers, body);

  app.use(fallback, writeError);
  return app;
}

export class V2Server {
  constructor({
    root,
    codeRoot,
    host = '127.0.0.1',
    port = 0,
    token = null,
    development = false,
    timings = true,
  }) {
    validateListener(host, port, token);
    this.host = host;
    this.requestedPort = port;
    this.token = token;
    this.timings = timings;
    this.codeRoot = codeRoot;
    this.library = new LibrarySnapshots(root, codeRoot, {
      development,
      stateStore: new PracticeState(),
    });
    this.hosts = new Set([
      'localhost',
      '127.0.0.1',
      '::1',
      ...Object.values(os.networkInterfaces())
        .flat()
        .filter(Boolean)
        .map((row) => row.address),
    ]);
    if (!['0.0.0.0', '::'].includes(host)) {
      this.hosts.add(host);
    }
    this.server = http.createServer(createApp(this));
    this.server.requestTimeout = 30000;
    this.server.headersTimeout = 15000;
  }
  async start() {
    this.library.rebuildIndexes();
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.requestedPort, this.host, resolve);
    });
    return this;
  }
  port() {
    return this.server.address()?.port;
  }
  async close() {
    if (!this.server.listening) {
      return;
    }
    await new Promise((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
      this.server.closeIdleConnections();
    });
  }
  // The browser timing probe can still substitute the UI bundle or disable its cache.
  binary(request, response, file, options) {
    const entry = readResource(this.library, file);
    return writeBinary(this, request, response, file, entry, options);
  }
  immutable(response) {
    immutable(response);
  }
}
