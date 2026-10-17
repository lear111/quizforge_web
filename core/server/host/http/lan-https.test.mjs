import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { X509Certificate, createHash, generateKeyPairSync } from 'node:crypto';
import { QuizForgeServer, CA_PATH } from './server.js';
import { LanCertificates, LEAF_DAYS, hostNames, permittedAddress, serverCertificate } from './lan-certificates.js';
import { readJson, safeDirectory, within } from '../platform/files.js';
import { jsonBytes } from '../platform/json.js';
const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), base = path.join(path.dirname(codeRoot), '.temp', 'node-migration'), day = 24 * 60 * 60 * 1000;
function directory(t) { safeDirectory(base, true); const root = fs.mkdtempSync(path.join(base, 'https-')); t.after(() => { assert.ok(within(base, root) && root !== base); fs.rmSync(root, { recursive: true, force: true }); }); return root; }
async function fixture(t) {
  const root = directory(t); fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  const extension = path.join(root, 'extensions', 'choice'); fs.cpSync(path.join(codeRoot, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), extension, { recursive: true });
  const raw = readJson(path.join(extension, readJson(path.join(extension, 'manifest.json')).examples)); raw.id = 'bank1'; fs.writeFileSync(path.join(root, 'question-banks', 'bank.json'), jsonBytes(raw));
  const service = await QuizForgeServer.create({ root, codeRoot, port: 0 }); service.engine.validationEnvironment = async () => 'https-fixture'; await service.start(); t.after(() => service.close());
  const api = async (uri, { method = 'GET', body, headers = {}, port = service.port() } = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + uri, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { root, service, api };
}
const freePort = async () => { const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port; };
const secure = (port, uri, { ca, method = 'GET', headers = {}, body, host = '127.0.0.1' } = {}) => new Promise((resolve, reject) => {
  const request = https.request({ host, port, path: uri, method, ca, checkServerIdentity: (_name, cert) => tls.checkServerIdentity(host, cert), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, agent: false }, response => {
    const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode, data: response.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : text, certificate: response.socket.getPeerX509Certificate?.() }); });
  });
  request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
});
const sanOf = cert => cert.subjectAltName.split(', ');

test('server certificate carries LAN names, short validity and a name-constrained root', async t => {
  const now = new Date('2026-10-16T08:00:00Z'), certificates = new LanCertificates(directory(t), { now: () => now, hostname: 'Study-PC' });
  await certificates.ensure(['192.168.1.20', 'fd12::5', '2001:db8::7', '8.8.8.8', 'fe80::1%12']);
  const leaf = certificates.leaf.cert, root = certificates.root;
  assert.deepEqual(sanOf(leaf), ['DNS:localhost', 'DNS:study-pc', 'DNS:study-pc.local', 'IP Address:127.0.0.1', 'IP Address:0:0:0:0:0:0:0:1', 'IP Address:192.168.1.20', 'IP Address:FD12:0:0:0:0:0:0:5']);
  const lifetime = new Date(leaf.validTo) - new Date(leaf.validFrom);
  assert.ok(lifetime <= 825 * day && lifetime <= (LEAF_DAYS + 1) * day, 'leaf validity stays within iOS and Chrome limits');
  assert.ok(leaf.checkIssued(root) && leaf.verify(root.publicKey) && root.ca && !leaf.ca);
  assert.equal(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'), true);
  assert.ok(Buffer.from(root.raw).includes(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1e])), 'root has nameConstraints');
  assert.deepEqual(hostNames('Study-PC'), ['study-pc', 'study-pc.local']); assert.deepEqual(hostNames('名字'), []);
  assert.equal(permittedAddress('10.1.2.3'), true); assert.equal(permittedAddress('172.32.0.1'), false); assert.equal(permittedAddress('2001:db8::1'), false);
  const mode = fs.statSync(certificates.files.rootKey).mode & 0o777; if (process.platform !== 'win32') assert.equal(mode, 0o600);
});

test('address changes reissue the server certificate under the same root', async t => {
  let now = new Date('2026-10-16T08:00:00Z'); const certificates = new LanCertificates(directory(t), { now: () => now, hostname: 'desk' });
  const first = await certificates.ensure(['192.168.1.20']), fingerprint = certificates.status().fingerprint;
  assert.equal(first.changed, true); assert.equal((await certificates.ensure(['192.168.1.20'])).changed, false);
  const moved = await certificates.ensure(['192.168.1.20', '10.0.0.8']); assert.equal(moved.changed, true);
  assert.equal(new X509Certificate(moved.cert).checkIP('10.0.0.8'), '10.0.0.8'); assert.equal(certificates.status().fingerprint, fingerprint);
  // A restarted host reloads the same root and leaf from disk.
  const reloaded = new LanCertificates(certificates.directory.replace(/[\\/]\.state[\\/]lan-https$/, ''), { now: () => now, hostname: 'desk' });
  assert.equal((await reloaded.ensure(['192.168.1.20', '10.0.0.8'])).changed, false); assert.equal(reloaded.status().fingerprint, fingerprint);
  now = new Date(now.getTime() + (LEAF_DAYS - 20) * day); assert.equal((await reloaded.ensure(['10.0.0.8'])).changed, true, 'renews before expiry');
  assert.equal(reloaded.status().fingerprint, fingerprint);
  await reloaded.regenerate(['10.0.0.8']); assert.notEqual(reloaded.status().fingerprint, fingerprint);
});

test('TLS clients enforce the root name constraints', async t => {
  const certificates = new LanCertificates(directory(t), { hostname: 'desk' }); const material = await certificates.ensure([]), ca = certificates.root.toString();
  const serve = async (key, cert) => { const server = https.createServer({ key, cert }, (_request, response) => response.end('ok')); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close()); return server.address().port; };
  assert.equal((await secure(await serve(material.key, material.cert), '/', { ca })).data, 'ok');
  const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 }), cert = new X509Certificate(serverCertificate({ publicKey: rogue.publicKey, root: certificates.root, rootKey: certificates.rootKey, names: ['example.com'], addresses: ['127.0.0.1', '8.8.8.8'] })).toString();
  await assert.rejects(secure(await serve(rogue.privateKey.export({ type: 'pkcs8', format: 'pem' }), cert), '/', { ca }), /permitted subtree violation|ERR_TLS|certificate/i);
});

test('LAN HTTPS shares the connection password, checks Host and Origin, and only exposes the public root', async t => {
  const { api, service, root } = await fixture(t), port = await freePort(), httpsPort = await freePort();
  assert.equal((await api('/api/settings/network', { method: 'PUT', body: { enabled: false, publicEnabled: false, port, httpsEnabled: true, httpsPort, password: 'shared-password' } })).status, 400, 'HTTPS requires LAN access');
  assert.equal((await api('/api/settings/network', { method: 'PUT', body: { enabled: true, publicEnabled: false, port, httpsEnabled: true, httpsPort: port, password: 'shared-password' } })).status, 400, 'HTTPS needs its own port');
  assert.equal((await api(CA_PATH)).status, 404);
  const saved = await api('/api/settings/network', { method: 'PUT', body: { enabled: true, publicEnabled: false, port, httpsEnabled: true, httpsPort, password: 'shared-password' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.https.enabled, true); assert.equal(saved.data.https.port, httpsPort);
  assert.match(saved.data.https.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  for (const value of saved.data.https.urls) assert.match(value, new RegExp('^https://.+:' + httpsPort + '/$'));
  for (const value of saved.data.https.certificateUrls) assert.ok(value.startsWith('http://') && value.endsWith(':' + port + CA_PATH));
  if (saved.data.https.certificateUrls.length) assert.ok(saved.data.https.certificateQr.startsWith('data:image/svg+xml;base64,'));

  // The download is the public DER root over plain LAN HTTP, without a password.
  const download = await api(CA_PATH, { port });
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/x-x509-ca-cert');
  const ca = new X509Certificate(download.data); assert.equal(ca.ca, true); assert.equal(ca.toString(), service.certificates.root.toString());
  assert.equal(createHash('sha256').update(download.data).digest('hex').toUpperCase().match(/../g).join(':'), saved.data.https.fingerprint);
  assert.equal(download.data.includes('PRIVATE KEY'), false); assert.equal(download.data.toString('latin1').includes('PRIVATE'), false);
  assert.ok(fs.readFileSync(path.join(root, '.state/lan-https/root-ca.key'), 'utf8').includes('PRIVATE KEY'));
  for (const uri of ['/.state/lan-https/root-ca.key', '/quizforge-lan-ca.key', '/quizforge-lan-ca.crt/', '/root-ca.key', '/web/../.state/lan-https/server.key', '/%2e%2e/.state/lan-https/root-ca.key']) {
    const response = await api(uri, { port }); assert.notEqual(response.status, 200, uri); assert.equal(Buffer.isBuffer(response.data) && response.data.toString().includes('PRIVATE KEY'), false);
  }
  assert.equal((await api(CA_PATH, { method: 'POST', port })).status, 405);

  const pem = ca.toString();
  const anonymous = await secure(httpsPort, '/api/health', { ca: pem }); assert.equal(anonymous.status, 401);
  assert.equal(anonymous.certificate.checkIP('127.0.0.1'), '127.0.0.1');
  assert.equal((await secure(httpsPort, '/', { ca: pem })).status, 200, 'pages load before login');
  const login = await secure(httpsPort, '/api/auth/login', { ca: pem, method: 'POST', body: { password: 'shared-password' } }); assert.equal(login.status, 200);
  const headers = { 'X-QuizForge-Token': login.data.token };
  assert.equal((await secure(httpsPort, '/api/health', { ca: pem, headers })).status, 200);
  assert.equal((await secure(httpsPort, '/api/health', { ca: pem, headers: { ...headers, Host: 'evil.example:' + httpsPort } })).status, 403);
  assert.equal((await secure(httpsPort, '/api/health', { ca: pem, headers: { ...headers, Host: '127.0.0.1:' + port } })).status, 403);
  assert.equal((await secure(httpsPort, '/api/auth/login', { ca: pem, method: 'POST', headers: { Origin: 'http://127.0.0.1:' + httpsPort }, body: { password: 'shared-password' } })).status, 403, 'HTTP origin is not the HTTPS origin');
  assert.equal((await secure(httpsPort, '/api/auth/login', { ca: pem, method: 'POST', headers: { Origin: 'https://127.0.0.1:' + httpsPort }, body: { password: 'shared-password' } })).status, 200);
  assert.equal((await secure(httpsPort, '/api/settings/network', { ca: pem, headers })).status, 403, 'HTTPS is always remote');
  assert.equal((await secure(httpsPort, '/api/settings/network/https/regenerate', { ca: pem, method: 'POST', headers, body: {} })).status, 403);
  assert.equal((await secure(httpsPort, '/api/library/index', { ca: pem, headers })).data.canManage, false);

  const fingerprint = saved.data.https.fingerprint, renewed = await api('/api/settings/network/https/regenerate', { method: 'POST', body: {} });
  assert.equal(renewed.status, 200); assert.notEqual(renewed.data.https.fingerprint, fingerprint);
  await assert.rejects(secure(httpsPort, '/api/health', { ca: pem }), /certificate|self.signed|ERR_TLS/i, 'old root no longer validates');
  const fresh = new X509Certificate((await api(CA_PATH, { port })).data).toString(); assert.equal((await secure(httpsPort, '/api/health', { ca: fresh })).status, 401);

  const off = await api('/api/settings/network', { method: 'PUT', body: { enabled: true, publicEnabled: false, port, httpsEnabled: false, httpsPort } });
  assert.equal(off.status, 200); assert.equal(off.data.https.enabled, false); assert.equal(service.httpsServer, null);
  await assert.rejects(secure(httpsPort, '/api/health', { ca: fresh }), /ECONNREFUSED|ECONNRESET/);
  assert.equal((await api(CA_PATH, { port })).status, 404);
  assert.equal(fs.existsSync(path.join(root, '.state/lan-https/root-ca.key')), true, 'turning HTTPS off keeps the root so phones need not reinstall');
  const settings = readJson(path.join(root, '.state/network-settings.json')); assert.equal(settings.httpsEnabled, false); assert.equal(settings.httpsPort, httpsPort);
});

test('saved HTTPS settings restart the listener with the same root', async t => {
  const first = await fixture(t), port = await freePort(), httpsPort = await freePort();
  assert.equal((await first.api('/api/settings/network', { method: 'PUT', body: { enabled: true, publicEnabled: false, port, httpsEnabled: true, httpsPort, password: 'shared-password' } })).status, 200);
  const fingerprint = first.service.certificates.status().fingerprint, ca = first.service.certificates.root.toString(); await first.service.close();
  const service = await QuizForgeServer.create({ root: first.root, codeRoot, port: 0 }); service.engine.validationEnvironment = async () => 'https-fixture'; await service.start(); t.after(() => service.close());
  assert.ok(service.httpsServer); assert.equal(service.certificates.status().fingerprint, fingerprint);
  assert.equal((await secure(httpsPort, '/api/health', { ca })).status, 401);
  const plain = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: httpsPort, path: '/' }, resolve).on('error', reject)).then(() => 'answered', error => error.code);
  assert.notEqual(plain, 'answered', 'the HTTPS port does not serve plain HTTP');
});
