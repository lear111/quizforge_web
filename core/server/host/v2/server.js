import http from 'node:http';
import os from 'node:os';
import { LibrarySnapshots } from './snapshots.js';
import { problem } from './errors.js';
import { PracticeState } from './state.js';
import { createApp } from './routes.js';
import { writeBinary, immutable } from './http-response.js';

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
    return writeBinary(this, request, response, file, options);
  }
  immutable(response) {
    immutable(response);
  }
}
