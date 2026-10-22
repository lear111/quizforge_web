import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ApiError, bad, routeId, text, requireObject } from '../platform/errors.js';
import { jsonBytes, parseJson, hash, fingerprint } from '../platform/json.js';
import { checkPath, exists, readBytes, readJson, replaceFile, resolveLayout, safeDirectory, safeFile } from '../platform/files.js';
import { initializeContent } from '../platform/initial-content.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { Library } from '../library/library.js';
import { StateStore } from '../practice/state-store.js';
import { ResourceStore, MAX_IMAGE_BYTES } from '../resources/resources.js';
import { EditorDraftStore } from '../editor/editor-drafts.js';
import { DevelopmentSettings } from '../extensions/development-settings.js';
import { NetworkSettings } from './network-settings.js';
import { AiSettings } from '../ai/ai-settings.js';
import { OpenAiCompatibleProvider, AiProviderError } from '../ai/ai-provider.js';
import { AiGradingService } from '../ai/ai-grading-service.js';
import { CollectionRoutes } from '../practice/collection-routes.js';
import { PracticeSessions } from '../practice/practice-sessions.js';
import { ExamSessions } from '../exam/exam-sessions.js';
import { MIME as archiveMime } from '../library/library-archive.js';
import { LanCertificates, hostNames, permittedAddress } from './lan-certificates.js';
import qrcode from 'qrcode-generator';
import { TailscaleProbe } from './tailscale.js';
import { HubConnection } from '../ai/hub-connection.js';
import { hostKey, sameHost, url as addressUrl, privateAddress, ipv6Bytes, sameIpv6Subnet, interfaceAddresses, ipv6Available,displayAdapterMetadata,recommendedAddresses } from './network-addresses.js';

const loopback = host => hostKey(host) === hostKey('::1') || hostKey(host)?.startsWith('127.');
const equal = (left, right) => typeof left === 'string' && typeof right === 'string' && Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const forwarded = request => Object.keys(request.headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-'));
const mime = file => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json; charset=utf-8' })[path.extname(file).toLowerCase()];
// These pure models are also browser dependencies. Expose exact files only;
// the rest of shared/ and all server sources remain outside the web root.
const publicSharedModules = new Set(['shared/answer-area/1.3.0/model.js', 'shared/answer-area/1.4.0/model.js', 'shared/ink/1.0.0/renderer.js']);
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
export function queryValue(context, name) {
  const values = context.url.searchParams.getAll(name); if (values.length > 1) throw bad('Invalid query');
  if (!values.length) return null;
  for (const item of context.url.search.slice(1).split('&')) if (decodeURIComponent(item.split('=')[0].replaceAll('+', ' ')) === name && !item.includes('=')) throw bad('Invalid query');
  return values[0];
}
export const CA_PATH = '/quizforge-lan-ca.crt';
const HUB_CALLBACK = '/hub/connect/callback';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const callbackPage = (title, detail) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · QuizForge</title><style>body{margin:0;font-family:system-ui,'Microsoft YaHei',sans-serif;background:#f8f6fc;color:#40364f}main{max-width:480px;margin:72px auto;padding:28px;background:#fff;border:1px solid #e6ddf2;border-radius:14px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.7;margin:0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>`;
const qrImage = value => { const code = qrcode(0, 'M'); code.addData(value); code.make(); return 'data:image/svg+xml;base64,' + Buffer.from(code.createSvgTag({ cellSize: 4, margin: 16, scalable: true })).toString('base64'); };
function authority(value, secure = false) {
  try {
    if (typeof value !== 'string' || /[\s\\/?#@]/.test(value)) throw new Error();
    const uri = new URL((secure ? 'https://' : 'http://') + value); if (!hostKey(uri.hostname) || uri.username || uri.password) throw new Error();
    return uri;
  } catch { throw new ApiError(403, 'HOST_REJECTED', 'Use an enabled connection address'); }
}
const listen = (server, port, host) => new Promise((resolve, reject) => {
  const fail = error => { server.off('listening', ready); reject(error); };
  const ready = () => { server.off('error', fail); resolve(server); };
  server.once('error', fail); server.once('listening', ready); server.listen({ port, host, backlog: 64, ipv6Only: false });
});
const closeServer = (server, graceful = false) => new Promise(resolve => { if (!server?.listening) return resolve(); server.close(() => resolve()); if (!graceful) server.closeAllConnections(); });

export class QuizForgeServer {
  static async create({ root = '.', host = '127.0.0.1', port = 8080, token = null, node = process.execPath, codeRoot = null, initialContent = null, tailscale = new TailscaleProbe(), hub = {} } = {}) {
    if (token !== null && !/^[A-Za-z0-9._~-]{16,256}$/.test(token)) throw new Error('Token must contain 16..256 URL-safe characters');
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const layout = resolveLayout(root), service = new QuizForgeServer();
    Object.assign(service, layout, { root: layout.dataRoot, codeRoot: codeRoot === null ? layout.codeRoot : checkPath(codeRoot, { directory: true }), host, token, active: 0, ready: false, closed: false, tailscaleProbe: tailscale, tailscale: { state: 'unavailable' } });
    service.server = service.newListener(false);
    try {
      // Reserve the port and data directory before any state recovery or upgrade.
      await listen(service.server, port, host); service.claimRoot();
      if (initialContent !== null) initializeContent(service.root, initialContent);
      service.ipv6Supported = await ipv6Available();
      service.engine = await RuleEngine.create(service.codeRoot, { node });
      service.developmentSettings = new DevelopmentSettings(service.root);
      service.library = new Library(service.root, service.codeRoot, service.engine, service.developmentSettings);
      service.states = new StateStore(service.root, service.engine); service.resources = new ResourceStore(service.root, { fallback: new ResourceStore(path.join(service.root, '.development')) }); service.editorDrafts = new EditorDraftStore(service.root);
      service.aiSettings = new AiSettings(service.root); service.hub = new HubConnection(service.root, hub); service.aiSettings.attachHub(service.hub); service.aiGateway = new OpenAiCompatibleProvider(service.aiSettings, service.resources);
      service.ai = new AiGradingService(service.root, service.states, service.library, service.aiGateway);
      service.writes = { read: context => service.writeRequest(context), validateOrigin: context => service.validateOrigin(context) };
      service.automaticAi = () => service.aiSettings.profile.enabled && service.aiSettings.profile.autoGrade;
      service.routes = new CollectionRoutes(service.library, service.states, service.ai, service.writes, service.automaticAi);
      const developmentRoot = path.join(service.root, '.development');
      // Recover old journals, but route all live practice through one store.
      service.developmentStates = exists(developmentRoot) ? new StateStore(service.root, service.engine, { stateRoot: developmentRoot }) : service.states;
      service.developmentResources = service.resources; service.developmentEditorDrafts = new EditorDraftStore(developmentRoot);
      service.developmentAi = service.ai; service.developmentRoutes = service.routes;
      service.practiceSessions = new PracticeSessions(() => service.createPracticeSession());
      service.exams = new ExamSessions(service.root, service.library, service.states, service.ai, service.routes, service.writes, service.automaticAi, { resourceGateway: images => new OpenAiCompatibleProvider(service.aiSettings, images) });
      service.allowedHosts = new Set(['localhost', '127.0.0.1', hostKey('::1')]);
      const bound = service.server.address().address;
      if (bound === '0.0.0.0' || bound === '::') for (const local of interfaceAddresses()) service.allowedHosts.add(hostKey(local.address.split('%')[0]));
      else service.allowedHosts.add(hostKey(bound));
      service.certificates = new LanCertificates(service.root);
      service.networkSettings = new NetworkSettings(service.root, Math.max(1024, service.port() === 65535 ? 8788 : service.port() + 1));
      service.refreshAddresses(); return service;
    } catch (error) { await service.close(); throw error; }
  }
  newListener(remote, tls = null) {
    this.handlers ??= new Set();
    const options = { maxHeaderSize: 16 * 1024, requestTimeout: 120000, headersTimeout: 15000, ...this.listenerTimeouts }, secure = tls !== null;
    const server = (secure ? https : http).createServer(secure ? { ...options, key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' } : options, (request, response) => {
      const operation = this.handle({ request, response, remote, secure }); this.handlers.add(operation);
      operation.finally(() => this.handlers.delete(operation)).catch(() => {});
    });
    // Keep Node's default clientError reply: an unused browser preconnect that hits headersTimeout gets 408, which
    // Chromium retries on a new connection. A blanket 400 here reached the next navigation as an empty error page.
    return server;
  }
  claimRoot() {
    const directory = safeDirectory(path.join(this.root, '.state'), true); this.lockFile = path.join(directory, 'host.lock');
    for (let attempt = 0; attempt < 2; attempt++) {
      if (exists(this.lockFile)) {
        checkPath(this.lockFile, { directory: false }); const previous = readJson(this.lockFile, 4096);
        if (!Number.isInteger(previous.pid) || previous.pid <= 0 || typeof previous.nonce !== 'string') throw new Error('Host lock is invalid; preserve it for inspection');
        let alive = true; try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
        if (alive) throw new Error('This QuizForge data directory is already open by another host');
        fs.unlinkSync(this.lockFile);
      }
      this.lockNonce = randomUUID();
      try { fs.writeFileSync(this.lockFile, jsonBytes({ pid: process.pid, nonce: this.lockNonce }), { flag: 'wx' }); this.ownsLock = true; return; }
      catch (error) { if (error.code !== 'EEXIST' || attempt) throw error; }
    }
  }
  port() { return this.server.address().port; }
  async start() {
    if (this.started || this.closed) return; this.started = true;
    if (loopback(this.server.address().address) && this.networkSettings.config.remoteEnabled) try { this.networkServer = await listen(this.newListener(true), this.networkSettings.config.port, this.ipv6Supported ? '::' : '0.0.0.0'); } catch { this.networkError = 'Saved connection port is unavailable; select another port in settings'; }
    if (this.networkServer && this.networkSettings.config.enabled && this.networkSettings.config.httpsEnabled) try { this.httpsServer = await this.secureListener(this.networkSettings.config.httpsPort); } catch { this.networkError = 'Saved HTTPS port is unavailable or the certificate could not be prepared; select another port in settings'; }
    // Reissue the server certificate soon after LAN addresses change; the root stays the same.
    this.certificateTimer = setInterval(() => { if (this.httpsServer && !this.closed) this.networkSettings.transactions.run(() => this.renewCertificate()).catch(() => {}); }, 60000); this.certificateTimer.unref();
    // Keep the Tailscale name current so its address works without opening settings.
    if (this.networkServer && this.networkSettings.config.publicEnabled) this.refreshTailscale();
    this.tailscaleTimer = setInterval(() => { if (this.networkServer && this.networkSettings.config.publicEnabled && !this.closed) this.refreshTailscale(); }, 60000); this.tailscaleTimer.unref();
    this.ready = true;
    let ticking = false; this.timer = setInterval(async () => { if (ticking || this.closed) return; ticking = true; try { await this.exams.tick(); } finally { ticking = false; } }, 1000); this.timer.unref();
    // Metadata is listed immediately; collections validate only when opened.
    // Warm immutable runtime digests while the browser reads metadata. This
    // neither opens banks nor retains an unchecked environment across requests.
    this.runtimeWarmup = this.library.environment().catch(() => {});
  }
  close({ graceful = false } = {}) {
    if (this.closing) return this.closing;
    this.closed = true; this.ready = false; clearInterval(this.timer); clearInterval(this.certificateTimer); clearInterval(this.tailscaleTimer);
    const dispose = () => { this.library?.close(); this.exams?.close(); this.practiceSessions?.close(); this.ai?.close(); this.developmentAi?.close(); this.networkSettings?.invalidateSessions(); this.engine?.close(); };
    this.closing = (async () => {
      if (!graceful) dispose();
      await Promise.all([closeServer(this.server, graceful), closeServer(this.networkServer, graceful), closeServer(this.httpsServer, graceful)]);
      await Promise.allSettled([...this.handlers ?? [], this.states?.transactions.drain(), this.developmentStates?.transactions.drain(), this.exams?.transactions.drain(), this.library?.managementTransactions.drain()]);
      if (graceful) dispose();
      if (this.ownsLock && exists(this.lockFile)) { checkPath(this.lockFile); if (readJson(this.lockFile, 4096).nonce === this.lockNonce) fs.unlinkSync(this.lockFile); this.ownsLock = false; }
    })();
    return this.closing;
  }
  createPracticeSession() {
    const resources = new ResourceStore(this.root, { memory: true, fallback: this.resources }), states = StateStore.memory(this.root, this.engine, resources);
    const ai = AiGradingService.memory(this.root, states, this.library, new OpenAiCompatibleProvider(this.aiSettings, resources)), routes = new CollectionRoutes(this.library, states, ai, this.writes, this.automaticAi);
    return { states, resources, developmentResources: resources, ai, developmentAi: ai, routes, developmentRoutes: routes, bytes: () => states.memoryBytes() + resources.memoryBytes() + ai.memoryBytes(), close: () => { ai.close(); states.clearMemory(); resources.clearMemory(); } };
  }
  lease(context, create, writing) { return this.practiceSessions.acquire(context.request.headers['x-quizforge-practice-session'], create, writing); }
  canManage(context) { return !context.remote && !forwarded(context.request) && loopback(this.server.address().address) && loopback(context.request.socket.remoteAddress) && ['localhost', '127.0.0.1', hostKey('::1')].includes(hostKey(context.authority.hostname)); }
  requireLocal(context, message = '题库导入导出和设置只能在主机本机地址操作') { if (!this.canManage(context)) throw new ApiError(403, 'LOCAL_SETTINGS_ONLY', message); }
  refreshAddresses() {
    this.lanHosts = new Set(['localhost', '127.0.0.1']); this.lanUrls = new Set(); this.publicIpv6Hosts = new Set(); this.subnets = [];
    if (this.ipv6Supported) this.lanHosts.add(hostKey('::1'));
    for (const entry of interfaceAddresses()) {
      const host = entry.address.split('%')[0], bytes = ipv6Bytes(host);
      if (entry.internal || (!this.ipv6Supported && bytes) || host.startsWith('169.254.') || bytes && (bytes[0] === 0xff || bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)) continue;
      this.lanHosts.add(hostKey(host)); this.lanUrls.add(host);
      if (bytes && (bytes[0] & 0xe0) === 0x20) { this.publicIpv6Hosts.add(host); const prefix = Number(entry.cidr?.split('/')[1]); if (prefix >= 64 && prefix <= 128) this.subnets.push({ host, prefix }); }
    }
  }
  async refreshTailscale(force = false) {
    try { this.tailscale = await this.tailscaleProbe.read(this.networkSettings.config.port, { force }); } catch { this.tailscale = { state: 'unavailable' }; }
    return this.tailscale;
  }
  // Addresses reachable from outside the LAN once 外网连接 is on: detected public IPv6, Tailscale
  // (its HTTPS forward and its own IPs) and an optional address the user entered for port mapping.
  publicUrls() {
    const settings = this.networkSettings.config; if (!settings.publicEnabled) return [];
    const ts = this.tailscale?.state === 'running' ? this.tailscale : null;
    return [...new Set([settings.publicUrl, ts?.url, ts && addressUrl(ts.name, settings.port), ...(ts?.ips ?? []).map(ip => addressUrl(ip, settings.port)), ...[...this.publicIpv6Hosts].map(host => addressUrl(host, settings.port))].filter(Boolean))];
  }
  publicTarget(uri) {
    for (const value of this.publicUrls()) {
      const target = new URL(value), standard = target.protocol === 'https:' ? '443' : '80';
      // A Host header omits the default port of the public scheme (an HTTPS proxy forwards plain "quiz.example.com").
      if (sameHost(uri.hostname, target.hostname) && (uri.port || standard) === (target.port || standard)) return target;
    }
    return null;
  }
  validateHost(context) {
    const uri = authority(context.request.headers.host, context.secure); context.authority = uri; let accepted;
    if (context.remote) {
      if (!context.secure && this.publicTarget(uri)) return;
      const peer = context.request.socket.remoteAddress, settings = this.networkSettings.config;
      // HTTPS is LAN-only: it shares the LAN switch, peer check and password, and also accepts the host names in its certificate.
      accepted = settings.enabled && (!context.secure || settings.httpsEnabled) && (privateAddress(peer) || this.subnets.some(subnet => sameIpv6Subnet(subnet.host, peer, subnet.prefix))) && (this.lanHosts.has(hostKey(uri.hostname)) || context.secure && hostNames().includes(uri.hostname.toLowerCase()));
    } else accepted = this.allowedHosts.has(hostKey(uri.hostname)) && !(loopback(this.server.address().address) && forwarded(context.request));
    if (!accepted || Number(uri.port || (context.secure ? 443 : 80)) !== context.request.socket.localPort) throw new ApiError(403, 'HOST_REJECTED', 'Use an enabled connection address');
  }
  validateOrigin(context) {
    const site = context.request.headers['sec-fetch-site'], origin = context.request.headers.origin;
    if (site !== undefined && !['same-origin', 'none'].includes(site)) throw new ApiError(403, 'ORIGIN_REJECTED', 'Writes require the same origin');
    if (origin === undefined) return;
    try {
      if (typeof origin !== 'string' || !/^https?:\/\/[^/?#\\]+$/.test(origin)) throw new Error();
      const given = new URL(origin), expected = context.remote && this.publicTarget(context.authority) || context.authority;
      if (given.protocol !== expected.protocol || !sameHost(given.hostname, expected.hostname) || given.port !== expected.port || given.username || given.password) throw new Error();
    } catch { throw new ApiError(403, 'ORIGIN_REJECTED', 'Writes require the same origin'); }
  }
  authenticate(context) {
    const candidate = context.request.headers['x-quizforge-token'];
    if (context.remote) { if (!this.networkSettings.authenticated(candidate)) throw new ApiError(401, 'PASSWORD_REQUIRED', 'Enter the connection password'); }
    else if (this.token !== null && !equal(candidate, this.token)) throw new ApiError(401, 'TOKEN_REQUIRED', 'Enter a valid access token to use this server');
  }
  async writeRequest(context, resource = false) {
    this.validateOrigin(context);
    if (context.request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', 'Content-Type must be application/json');
    if (Object.hasOwn(context, 'body')) return context.body;
    let size = 0; const chunks = [];
    for await (const chunk of context.request) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request exceeds the size limit'); chunks.push(chunk); }
    try { context.body = parseJson(Buffer.concat(chunks), { maxStringLength: resource ? Math.ceil(MAX_IMAGE_BYTES / 3) * 4 : 2 * 1024 * 1024 }); return context.body; } catch { throw bad('Malformed JSON'); }
  }
  async secureListener(port) {
    this.refreshAddresses(); const material = await this.certificates.ensure([...this.lanUrls]);
    return listen(this.newListener(true, material), port, this.ipv6Supported ? '::' : '0.0.0.0');
  }
  async renewCertificate() {
    if (!this.httpsServer) return; this.refreshAddresses(); const material = await this.certificates.ensure([...this.lanUrls]);
    if (material.changed) this.httpsServer.setSecureContext({ key: material.key, cert: material.cert, minVersion: 'TLSv1.2' });
  }
  regenerateCertificates() {
    return this.networkSettings.transactions.run(async () => {
      if (!this.httpsServer) throw new ApiError(409, 'HTTPS_DISABLED', '请先开启局域网 HTTPS');
      this.refreshAddresses(); const material = await this.certificates.regenerate([...this.lanUrls]);
      this.httpsServer.setSecureContext({ key: material.key, cert: material.cert, minVersion: 'TLSv1.2' }); return this.networkStatus(true);
    });
  }
  httpsStatus(display) {
    const settings = this.networkSettings.config, running = !!this.httpsServer, status = running ? this.certificates.status() : null;
    const certificateUrls = running ? display.map(host => addressUrl(host, settings.port) + CA_PATH.slice(1)) : [], urls = running ? display.filter(permittedAddress).map(host => addressUrl(host, settings.httpsPort, 'https')) : [];
    return { enabled: running, configured: settings.httpsEnabled, port: settings.httpsPort, urls, certificateUrls, ...status, ...certificateUrls.length ? { certificateQr: qrImage(certificateUrls[0]) } : {}, ...urls.length ? { urlQr: qrImage(urls[0]) } : {} };
  }
  networkStatus(canManage) {
    this.refreshAddresses(); const settings = this.networkSettings.config;
    const display=recommendedAddresses(interfaceAddresses(),this.displayAdapters).map(entry=>entry.address).filter(host=>this.lanUrls.has(host));
    return { canManage, https: this.httpsStatus(display), enabled: !!this.networkServer && settings.enabled, publicEnabled: !!this.networkServer && settings.publicEnabled, publicUrl: settings.publicUrl, port: settings.port, passwordConfigured: settings.passwordConfigured, ipv6Supported: this.ipv6Supported, urls: this.networkServer && settings.enabled ? display.map(host=>addressUrl(host,settings.port)) : [], publicIpv6Urls: display.filter(host=>this.publicIpv6Hosts.has(host)).map(host=>addressUrl(host,settings.port)), tailscale: this.tailscaleStatus(), ...(!canManage ? { error: 'Network settings can only be changed through the local-only server' } : this.networkError ? { error: this.networkError } : {}) };
  }
  tailscaleStatus() {
    const value = this.tailscale ?? { state: 'unavailable' }, port = this.networkSettings.config.port;
    if (value.state !== 'running') return { state: value.state };
    // Without an HTTPS forward to this port, the MagicDNS name still reaches the connection port over HTTP.
    return { state: 'running', name: value.name, url: value.url || addressUrl(value.name, port) };
  }
  updateNetwork(request) {
    return this.networkSettings.transactions.run(async () => {
      const replacement = await this.networkSettings.candidate(request, this.port()), previous = this.networkServer, previousSecure = this.httpsServer, secureWanted = replacement.enabled && replacement.httpsEnabled; let candidate = previous, secure = previousSecure;
      try {
        if (replacement.remoteEnabled && (!previous || previous.address().port !== replacement.port)) { this.refreshAddresses(); candidate = await listen(this.newListener(true), replacement.port, this.ipv6Supported ? '::' : '0.0.0.0'); }
        if (secureWanted && (!previousSecure || previousSecure.address().port !== replacement.httpsPort)) secure = await this.secureListener(replacement.httpsPort);
        this.networkSettings.save(replacement);
      } catch {
        if (candidate && candidate !== previous) await closeServer(candidate); if (secure && secure !== previousSecure) await closeServer(secure);
        throw new ApiError(409, 'LAN_SETTINGS_UNAVAILABLE', 'Could not save connection settings or open this port; current settings remain active');
      }
      this.networkServer = replacement.remoteEnabled ? candidate : null; if (previous && previous !== this.networkServer) await closeServer(previous);
      // Turning HTTPS off stops its listener; certificates stay on disk so phones need not reinstall the root.
      this.httpsServer = secureWanted ? secure : null; if (previousSecure && previousSecure !== this.httpsServer) await closeServer(previousSecure);
      this.networkError = null; await this.refreshTailscale(true); return this.networkStatus(true);
    });
  }
  async uploadResource(context, development) {
    const flag = context.request.headers['x-quizforge-transient-resource']; if (flag !== undefined && flag !== 'true') throw bad('Invalid temporary resource flag');
    if (flag === undefined) return (development ? this.developmentResources : this.resources).upload(await this.writeRequest(context, true));
    const lease = await this.lease(context, true, true); try { return (development ? lease.session.developmentResources : lease.session.resources).upload(await this.writeRequest(context, true)); } finally { lease.close(); }
  }
  rejectTypeQuery(context) { if (context.url.searchParams.has('typeId')) throw bad('typeId routes are unsupported; each extension provides one question type'); }
  namespaceTransaction(callback) { return this.states.transactions.run(() => this.developmentStates.transactions.run(() => { this.states.recover(); this.developmentStates.recover(); return callback(); })); }
  async api(context, pathname) {
    const method = context.request.method, parts = pathname.slice(1).split('/'), session = context.request.headers['x-quizforge-practice-session'];
    if (pathname === '/api/auth/login' && method === 'POST') { const password = text(await this.writeRequest(context), 'password', 256); if (context.remote) return { token: await this.networkSettings.login(password, context.request.socket.remoteAddress) }; this.networkSettings.limitLogin(context.request.socket.remoteAddress); if (this.token === null || !equal(password, this.token)) throw new ApiError(401, 'PASSWORD_REQUIRED', 'Incorrect access password'); return { token: this.token }; }
    if (pathname === '/api/settings/network') {
      if (context.remote || !loopback(this.server.address().address) && !loopback(context.request.socket.remoteAddress)) throw new ApiError(403, 'LOCAL_SETTINGS_ONLY', 'Open settings on the host computer using its local address');
      if (method === 'GET') {this.refreshAddresses();this.displayAdapters=await displayAdapterMetadata();await this.refreshTailscale(context.url.searchParams.get('refresh') === '1');await this.networkSettings.transactions.run(() => this.renewCertificate()).catch(() => {});return this.networkStatus(this.canManage(context));}
      if (method === 'PUT') { this.requireLocal(context); return this.updateNetwork(await this.writeRequest(context)); }
    }
    if (pathname === '/api/settings/network/https/regenerate' && method === 'POST') { this.requireLocal(context); await this.writeRequest(context); return this.regenerateCertificates(); }
    if (pathname === '/api/settings/ai' || pathname === '/api/settings/ai/test' || pathname === '/api/settings/ai/credential') {
      if (pathname === '/api/settings/ai' && method === 'GET') return { ...this.aiSettings.status(), hub: this.hub.summary(), canManage: this.canManage(context) };
      this.requireLocal(context);
      if (pathname.endsWith('/credential') && method === 'GET') return this.aiSettings.credential();
      if (pathname === '/api/settings/ai' && method === 'PUT') return { ...await this.aiSettings.update(await this.writeRequest(context)), canManage: true };
      if (pathname.endsWith('/test') && method === 'POST') { await this.writeRequest(context); return this.aiGateway.testConnection(); }
    }
    // Hub account connection for official AI grading; only the host computer may log in or out.
    if (pathname.startsWith('/api/settings/ai/hub')) {
      this.requireLocal(context);
      if (pathname === '/api/settings/ai/hub' && method === 'GET') return this.hub.account();
      if (pathname === '/api/settings/ai/hub/login' && method === 'POST') { await this.writeRequest(context); return this.hub.start(`http://127.0.0.1:${this.port()}/hub/connect/callback`); }
      if (pathname === '/api/settings/ai/hub/logout' && method === 'POST') { await this.writeRequest(context); return this.hub.logout(); }
    }
    if (pathname === '/api/settings/development') { if (method === 'GET') return this.developmentSettings.status(this.canManage(context)); if (method === 'PUT') { this.requireLocal(context); const value = this.developmentSettings.update(await this.writeRequest(context)); this.library.invalidate(); return value; } }
    if (parts[1] === 'development') {
      this.rejectTypeQuery(context);
      if (parts.length === 3 && parts[2] === 'resources' && method === 'POST') return this.uploadResource(context, true);
      if (parts.length === 5 && parts[2] === 'editor-drafts') {
        const bank = routeId(parts[3]), question = routeId(parts[4]), kind = queryValue(context, 'kind') ?? 'development-bank';
        if (!['development-bank', 'development'].includes(kind)) throw bad('Invalid editor draft collection kind');
        const collection = await this.library.collection(kind, bank); collection.question(question); collection.features.requireEditing(); collection.features.requireHistory();
        const scope = 'development-' + hash(Buffer.from((kind === 'development' ? 'sample:' : '') + bank + ':' + collection.extensionFingerprint));
        return this.editorDraft(context, this.developmentEditorDrafts, scope, question);
      }
      if (parts.length >= 4 && parts[2] === 'extensions') {
        const folder = routeId(parts[3]);
        if (parts.length === 4 && method === 'GET') return { ...await this.library.development(folder), canPublish: false };
        if (parts.length === 5 && parts[4] === 'revision' && method === 'GET') return this.library.developmentRevision(folder);
        if (parts.length === 5 && parts[4] === 'page' && method === 'GET') return (await this.library.development(folder)).page;
        if (parts.length === 5 && parts[4] === 'publish') { this.requireLocal(context); if (method === 'GET') return this.library.developmentPublishPlan(folder); if (method === 'POST') return this.library.publishDevelopment(folder, await this.writeRequest(context)); }
      }
      if (parts.length >= 4 && parts[2] === 'banks') { const bank = routeId(parts[3]); if (parts.length === 4 && method === 'GET') return this.library.developmentBank(bank); if (parts.length === 5 && parts[4] === 'revision' && method === 'GET') return this.library.developmentBankRevision(bank); }
    }
    if (pathname === '/api/health' && method === 'GET') return { ok: true };
    if (pathname === '/api/resources' && method === 'POST') return this.uploadResource(context, false);
    if (parts[1] === 'sdk' && method === 'GET') { if (parts.length === 4) return this.library.sdk(routeId(parts[2]), routeId(parts[3])); if (parts.length === 5 && parts[4] === 'editor') return this.library.sdk(routeId(parts[2]), routeId(parts[3]), true); }
    if (parts.length === 4 && parts[1] === 'editor-drafts') {
      const bank = routeId(parts[2]), question = routeId(parts[3]), kind = queryValue(context, 'kind') ?? 'bank'; if (!['bank', 'extension'].includes(kind)) throw bad('Invalid editor draft collection kind');
      let collection;
      try { collection = await this.library.collection(kind, bank); collection.features.requireEditing(); collection.features.requireHistory(); if (kind === 'extension') collection.question(question); } catch (error) { if (kind !== 'bank' || error.code !== 'COLLECTION_NOT_FOUND') throw error; }
      const scope = kind === 'bank' ? bank : 'sample-' + hash(Buffer.from(bank));
      if (method === 'GET' && collection?.legacyCollection) {
        const target = this.editorDrafts.file(scope, question, true), marker = target + '.legacy-migrated';
        if (!exists(target) && !exists(marker)) {
          const legacy = collection.legacyCollection, oldScope = 'development-' + hash(Buffer.from((legacy.kind === 'development' ? 'sample:' : '') + legacy.id + ':' + legacy.extensionFingerprint)), saved = this.developmentEditorDrafts.get(oldScope, question);
          if (saved.draft) {
            const q = collection.question(question), oldQ = legacy.question(question), raw = { id: q.id, title: q.title, data: q.data };
            const contentVersion = saved.contentVersion === fingerprint(raw, legacy.extensionFor(oldQ).fingerprint) ? fingerprint(raw, collection.extensionFor(q).fingerprint) : saved.contentVersion;
            this.editorDrafts.put(scope, question, { ...saved, contentVersion }); replaceFile(marker, Buffer.from('migrated\n'));
          }
        }
      }
      return this.editorDraft(context, this.editorDrafts, scope, question);
    }
    if (parts[1] === 'extensions') this.rejectTypeQuery(context);
    if (pathname === '/api/library/index' && method === 'GET') return { ...this.library.index(), canManage: this.canManage(context) };
    if (pathname === '/api/catalog' && method === 'GET') { this.states.recover(); return { ...await this.library.catalog(), canManage: this.canManage(context) }; }
    if (pathname === '/api/library/import' && method === 'POST') {
      this.requireLocal(context); this.validateOrigin(context);
      if (context.request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== archiveMime) throw new ApiError(415, 'QBANK_REQUIRED', '请上传 QuizForge .qbank 文件');
      let filename; try { const header = context.request.headers['x-quizforge-filename']; if (header !== undefined) { if (typeof header !== 'string' || header.length > 4000) throw new Error(); filename = decodeURIComponent(header); } } catch { throw bad('Invalid package filename'); }
      return this.namespaceTransaction(() => this.library.importPackage(context.request, filename));
    }
    if (['/api/library/import/commit', '/api/library/import/cancel'].includes(pathname) && method === 'POST') {
      this.requireLocal(context); const body = await this.writeRequest(context);
      throw new ApiError(410, 'IMPORT_CHOICES_REMOVED', '新版题库包始终新增独立副本，无需选择覆盖。请刷新页面后重新导入。');
    }
    if (pathname === '/api/library/manage' && method === 'POST') { this.requireLocal(context); const body = await this.writeRequest(context); return this.namespaceTransaction(async () => { const result = await this.library.manage(body); this.states.clearMemory(); this.developmentStates.clearMemory(); return result; }); }
    if (parts.length === 5 && parts[1] === 'extensions' && parts[4] === 'page' && method === 'GET') return this.library.page(routeId(parts[2]), routeId(parts[3]));
    if (parts.length >= 4 && parts[1] === 'collections') {
      const kind = parts[2], bank = routeId(parts[3]); if (kind === 'exam') return this.exams.route(context, method, parts);
      if (parts.length === 5 && parts[4] === 'exams') { if (method === 'GET') return this.exams.list(kind, bank, session); if (method === 'POST') return this.exams.start(await this.library.collection(kind, bank), await this.writeRequest(context), session); }
      if (kind.startsWith('development')) {
        const candidate = this.library.candidate(this.library.indexSnapshot(), kind, bank);
        const canonical = [...parts]; canonical[2] = candidate.kind; canonical[3] = candidate.id;
        return this.api(context, '/' + canonical.join('/'));
      }
      const development = false, routes = this.routes, isBank = kind === 'bank';
      if (parts[4] === 'history') {
        if (isBank && parts.length === 6 && ExamSessions.isHistoryId(parts[5]) && ['GET', 'DELETE'].includes(method)) { try { (await this.library.collection(kind, bank)).features.requireHistory(); } catch (error) { if (error.code !== 'COLLECTION_NOT_FOUND') throw error; } if (method === 'DELETE') this.validateOrigin(context); return this.exams.history(kind, bank, parts[5], method === 'DELETE'); }
        const history = await routes.route(context, method, parts); return isBank && parts.length === 5 && method === 'GET' ? this.exams.appendHistory(kind, bank, history) : history;
      }
      const collection = await this.library.readCollection(kind, bank); if (collection.features.history) return routes.route(context, method, parts, method === 'GET' ? collection : null);
      const lease = await this.lease(context, true, method !== 'GET'); try { return (development ? lease.session.developmentRoutes : lease.session.routes).route(context, method, parts, method === 'GET' ? collection : null); } finally { lease.close(); }
    }
    if (!['GET', 'POST'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported');
    throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found');
  }
  async editorDraft(context, store, scope, question) { if (context.request.method === 'GET') return store.get(scope, question); if (context.request.method === 'PUT') return store.put(scope, question, await this.writeRequest(context)); if (context.request.method === 'DELETE') { this.validateOrigin(context); return store.delete(scope, question); } throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method is not supported'); }
  send(response, status, type, bytes) { if (response.destroyed || response.headersSent) return; response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length }); response.end(bytes); }
  async handle(context) {
    const { request, response } = context; let acquired = false;
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('Cache-Control', 'no-store');
    try {
      if (!this.ready || this.active >= 8) throw new ApiError(503, 'SERVER_BUSY', 'Server is busy; try again'); this.active++; acquired = true; this.validateHost(context);
      // Decode without URL dot-segment normalization, preserving traversal rejection.
      const [rawPath] = request.url.split('?'); let pathname; try { pathname = decodeURIComponent(rawPath); } catch { throw bad('Invalid path'); }
      if (!pathname.startsWith('/') || /[\\\0]/.test(pathname) || pathname.includes('//')) throw bad('Invalid path');
      context.url = new URL(request.url, context.authority); if (/%(?![a-f0-9]{2})/i.test(context.url.search)) throw bad('Invalid query');
      if (pathname.startsWith('/api/')) {
        if (pathname !== '/api/auth/login') this.authenticate(context);
        const development = pathname.startsWith('/api/development/resources/');
        if ((pathname.startsWith('/api/resources/') || development) && request.method === 'GET') {
          const resourceId = pathname.slice((development ? '/api/development/resources/' : '/api/resources/').length), lease = await this.lease(context, false, false);
          try { const store = lease ? development ? lease.session.developmentResources : lease.session.resources : development ? this.developmentResources : this.resources, resource = store.read(resourceId); this.send(response, 200, resource.mime, resource.bytes); } finally { lease?.close(); }
        } else if (pathname === '/api/library/export' && request.method === 'POST') {
          this.requireLocal(context); const selection = requireObject(await this.writeRequest(context));
          if (Object.keys(selection).length !== 1 || !['bank', 'group'].includes(Object.keys(selection)[0])) throw bad('请选择一个题库或题库分组导出');
          const single = Object.hasOwn(selection, 'bank'), value = text(selection, single ? 'bank' : 'group', single ? 1000 : 120);
          const download = await this.namespaceTransaction(() => single ? this.library.exportBank(value) : this.library.exportGroup(value));
          try { response.writeHead(200, { 'Content-Type': archiveMime, 'Content-Length': fs.statSync(download.file).size, 'Content-Disposition': "attachment; filename=quizforge-package.qbank; filename*=UTF-8''" + encodeURIComponent(download.name + '.qbank') }); await pipeline(fs.createReadStream(download.file), response); } finally { download.close(); }
        } else this.send(response, 200, 'application/json; charset=utf-8', jsonBytes(await this.api(context, pathname)));
      } else if (pathname === HUB_CALLBACK) {
        // The Hub returns the browser here after the user allows or denies; host computer only.
        if (request.method !== 'GET' || !this.canManage(context)) throw new ApiError(404, 'NOT_FOUND', 'Page not found');
        let title = '已登录 QuizForge 账号', detail = '这台电脑现在可以使用官方 AI 评分。可以关闭此页面，回到 QuizForge。';
        try { await this.hub.complete(context.url.searchParams); } catch (error) { title = '没有完成登录'; detail = error instanceof ApiError ? error.message : '登录没有完成，请回到 QuizForge 重新登录。'; }
        response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        this.send(response, 200, 'text/html; charset=utf-8', Buffer.from(callbackPage(title, detail)));
      } else if (pathname === CA_PATH) {
        // Public root certificate for phones; it is the only file served from .state and never includes a key.
        if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported for pages');
        const der = this.httpsServer ? this.certificates.rootDer() : null; if (!der) throw new ApiError(404, 'NOT_FOUND', 'Page not found');
        if (!response.headersSent) { response.writeHead(200, { 'Content-Type': 'application/x-x509-ca-cert', 'Content-Length': der.length, 'Content-Disposition': 'attachment; filename="QuizForge-LAN-CA.crt"' }); response.end(der); }
      } else {
        if (request.method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported for pages');
        let file = pathname === '/' ? 'index.html' : pathname.slice(1); if (file.startsWith('web/')) file = file.slice(4); const type = mime(file);
        if (!type) throw new ApiError(404, 'NOT_FOUND', 'Page not found'); let asset;
        try { asset = safeFile(publicSharedModules.has(file) ? this.codeRoot : path.join(this.codeRoot, 'web'), file); } catch { throw new ApiError(404, 'NOT_FOUND', 'Page not found'); }
        if (fs.statSync(asset).size > 4 * 1024 * 1024) throw new ApiError(413, 'ASSET_SIZE_LIMIT', 'Page asset exceeds the size limit');
        response.setHeader('Content-Security-Policy', csp); this.send(response, 200, type, readBytes(asset, 4 * 1024 * 1024));
      }
    } catch (error) {
      const status = error instanceof ApiError ? error.status : error instanceof AiProviderError ? error.retryable ? 503 : 422 : 500;
      if (status === 500) process.stderr.write('Request failed: ' + error.constructor.name + '\n');
      this.send(response, status, 'application/json; charset=utf-8', jsonBytes({ error: { code: error.code && status !== 500 ? error.code : 'INTERNAL_ERROR', message: status === 500 ? 'Request could not be completed' : error.message } }));
      if (response.headersSent && !response.writableEnded) response.destroy();
    } finally { if (acquired) this.active--; if (!request.complete) request.resume(); }
  }
}
