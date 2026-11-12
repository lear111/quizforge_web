import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { jsonBytes, parseJson } from '../platform/json.js';
import { LibrarySnapshots } from './snapshots.js';
import { problem, publicError } from './errors.js';
import { relativeFile, READ_LIMITS } from './io.js';
import { PracticeState, STATE_BYTES } from './state.js';

const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);
const mime = file => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2' }[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
export class V2Server {
  constructor({ root, codeRoot, host = '127.0.0.1', port = 0, token = null, development = false }) {
    if (typeof host !== 'string' || !Number.isInteger(port) || port < 0 || port > 65535 || token !== null && (typeof token !== 'string' || token.length < 8 || token.length > 256)) throw problem('INVALID_CONFIGURATION', '监听地址、端口或访问令牌无效。', {}, 400);
    if (!loopback(host) && host !== 'localhost' && !token) throw problem('AUTH_REQUIRED', '开放非回环地址必须显式设置访问令牌；V2 不继承旧局域网设置。', {}, 403);
    this.host = host; this.requestedPort = port; this.token = token;
    this.codeRoot = codeRoot;
    this.library = new LibrarySnapshots(root, codeRoot, { development, stateStore: new PracticeState(root) });
    this.hosts = new Set(['localhost', '127.0.0.1', '::1', ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(row => row.address)]);
    if (!['0.0.0.0', '::'].includes(host)) this.hosts.add(host);
    this.server = http.createServer((request, response) => this.handle(request, response));
    this.server.requestTimeout = 30000; this.server.headersTimeout = 15000;
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.requestedPort, this.host, resolve); });
    return this;
  }
  port() { return this.server.address()?.port; }
  async close() {
    if (!this.server.listening) return;
    await new Promise((resolve, reject) => { this.server.close(error => error ? reject(error) : resolve()); this.server.closeIdleConnections(); });
  }
  validate(request) {
    let authority;
    try {
      if (typeof request.headers.host !== 'string' || /[\s/\\@?#]/.test(request.headers.host)) throw new Error();
      authority = new URL('http://' + request.headers.host);
      const hostname = authority.hostname.replace(/^\[|\]$/g, '');
      if (!this.hosts.has(hostname) || Number(authority.port || 80) !== this.port()) throw new Error();
      if (Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'))) throw new Error();
    } catch { throw problem('HOST_REJECTED', '请通过本机或已启用的连接地址访问。', {}, 403); }
    if (!request.url.startsWith('/') || request.url.startsWith('//')) throw problem('INVALID_REQUEST', '请求地址无效。', {}, 400);
    if (request.headers.origin !== undefined && request.headers.origin !== authority.origin || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) throw problem('ORIGIN_REJECTED', '请从应用自身页面访问接口。', {}, 403);
    return new URL(request.url, authority);
  }
  authenticate(request) {
    if (!this.token) return;
    const supplied = request.headers['x-quizforge-token'];
    const a = Buffer.from(typeof supplied === 'string' ? supplied : ''), b = Buffer.from(this.token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw problem('AUTH_REQUIRED', '请输入有效的连接令牌。', {}, 401);
  }
  json(response, status, value) {
    const bytes = jsonBytes(value);
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes.length });
    response.end(bytes);
  }
  async body(request) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw problem('INVALID_REQUEST', '请发送 JSON 请求。', {}, 400);
    let size = 0; const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > STATE_BYTES) throw problem('STATE_SIZE_LIMIT', '请求超过 32 MiB，本次未保存。', { details: { limit: STATE_BYTES } }, 413);
      chunks.push(chunk);
    }
    try { return parseJson(Buffer.concat(chunks)); } catch { throw problem('INVALID_REQUEST', '请求 JSON 无效或包含重复字段。', {}, 400); }
  }
  binary(request, response, file, { executable = false } = {}) {
    const entry = this.library.cache.entry(file, READ_LIMITS.assetBytes), bytes = entry.content;
    let start = 0, end = bytes.length - 1, status = 200;
    const headers = { 'Content-Type': mime(file), 'Accept-Ranges': 'bytes' };
    // A direct browser navigation to an extension HTML must not gain host origin.
    if (executable || /\.(?:html|svg)$/i.test(file)) headers['Content-Security-Policy'] = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:; frame-ancestors 'self'";
    if (request.headers.range !== undefined) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      const reject = () => { response.setHeader('Content-Range', `bytes */${bytes.length}`); throw problem('RANGE_NOT_SATISFIABLE', '请求的音频范围无效。', {}, 416); };
      if (!match || !bytes.length || !match[1] && !match[2]) reject();
      if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) reject(); start = Math.max(0, bytes.length - suffix); }
      else { start = Number(match[1]); end = match[2] ? Number(match[2]) : end; }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= bytes.length || start > end) reject();
      end = Math.min(end, bytes.length - 1); status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${bytes.length}`;
    }
    headers['Content-Length'] = Math.max(0, end - start + 1);
    response.writeHead(status, headers); response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1));
  }
  async handle(request, response) {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = this.validate(request);
      const parts = url.pathname.split('/').filter(Boolean).map(part => {
        let decoded; try { decoded = decodeURIComponent(part); } catch { throw problem('INVALID_REQUEST', '地址编码无效。', {}, 400); }
        if (/[\x00-\x1f/\\]/.test(decoded) || ['.', '..'].includes(decoded)) throw problem('INVALID_REQUEST', '地址字段无效。', {}, 400);
        return decoded;
      });
      if (url.pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
        const nonce = randomBytes(18).toString('base64');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'`);
        const bytes = Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QuizForge V2</title><link rel="stylesheet" href="/ui/quizforge-web-local.css"><div id="app"></div><script nonce="${nonce}" src="/ui/quizforge-ui.js"></script><script nonce="${nonce}">QuizForgeUI.mountV2App(document.getElementById('app'),${JSON.stringify(nonce)});</script></html>`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length }); response.end(request.method === 'HEAD' ? undefined : bytes); return;
      }
      if (parts.length === 2 && parts[0] === 'ui' && ['quizforge-ui.js', 'quizforge-web-local.css'].includes(parts[1]) && ['GET', 'HEAD'].includes(request.method)) return this.binary(request, response, relativeFile(path.join(this.codeRoot, 'web', 'ui'), parts[1]));
      if (parts[0] !== 'api') throw problem('RESOURCE_NOT_FOUND', '页面或资源不存在。', {}, 404);
      this.authenticate(request);
      if (parts[1] !== 'v2') throw problem('V1_API_REMOVED', 'V2 不提供旧作答接口，请使用 V2 页面或 v1-final。', {}, 410);
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (parts[2] === 'banks' && parts[4] === 'questions' && parts.length === 7 && (parts[6] === 'submit' && request.method === 'POST' || parts[6] === 'result' && request.method === 'PUT')) {
          const input = await this.body(request);
          return this.json(response, 200, this.library.write(parts[3], parts[5], parts[6], input));
        }
        request.resume(); throw problem('FEATURE_NOT_IMPLEMENTED', '此功能将在后续阶段开放。', {}, 501);
      }
      const snapshotId = url.searchParams.get('snapshotId');
      if (parts.length === 3 && parts[2] === 'health') return this.json(response, 200, { apiVersion: 2, phase: 'segment-1', availableFeatures: ['catalog', 'overview', 'question', 'resources', 'submit', 'result'] });
      if (parts.length === 3 && parts[2] === 'catalog') return this.json(response, 200, this.library.catalog());
      if (parts[2] === 'banks') {
        const bankId = parts[3];
        if (parts.length === 5 && parts[4] === 'overview') return this.json(response, 200, this.library.open(bankId, url.searchParams.get('questionId') ?? undefined));
        if (parts[4] === 'questions' && parts.length === 6) return this.json(response, 200, this.library.question(bankId, parts[5], snapshotId));
        if (parts[4] === 'questions' && parts.length === 8 && parts[6] === 'assets') return this.binary(request, response, this.library.asset(bankId, parts[5], snapshotId, parts[7]));
        if (parts[4] === 'listening' && parts.length === 6) { const material = this.library.listening(bankId, parts[5], snapshotId); return material.file ? this.binary(request, response, material.file) : this.json(response, 200, material); }
      }
      if (parts[2] === 'extensions' && parts.length >= 5) {
        const artifact = this.library.artifact(parts[3]);
        if (parts.length === 5 && parts[4] === 'manifest') return this.json(response, 200, { ...artifact.descriptor, name: artifact.manifest.name, entries: { practice: { html: 'practice-html', js: 'practice-js', css: 'practice-css' }, grade: 'grade-js' }, sdkVersions: artifact.sdkVersions });
        if (parts.length === 6 && parts[4] === 'files') { const file = artifact.files.get(parts[5]); if (!file) throw problem('RESOURCE_NOT_FOUND', '拓展入口不存在。', {}, 404); return this.binary(request, response, file, { executable: true }); }
      }
      if (parts[2] === 'sdk' && parts.length >= 6) {
        const key = `${parts[3]}@${parts[4]}`;
        const sdk = [...this.library.opened.values()].map(snapshot => snapshot.sdk.get(key)).find(Boolean);
        if (!sdk) throw problem('SDK_UNAVAILABLE', '该公共组件未在已打开题库中声明。', {}, 404);
        return this.binary(request, response, relativeFile(sdk.directory, parts.slice(5).join('/')), { executable: true });
      }
      throw problem('FEATURE_NOT_IMPLEMENTED', '此接口尚未实现。', {}, 501);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) this.json(response, error.status ?? 503, { error: publicError(error) });
      else response.destroy();
    }
  }
}
