import {makeFormat4Fixture} from '../fixtures/format4-library.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { copyRuntimeDependencies } from '../../scripts/build/runtime-dependencies.mjs';
import { copyFixture, writeFixture } from '../fixtures/installed-library.mjs';
import { LibraryArchive } from '../../server/host/library/library-archive.js';
import { ResourceStore } from '../../server/host/resources/resources.js';
import yazl from '../../node_modules/yazl/index.js';

const run = promisify(execFile), product = fileURLToPath(new URL('../../../', import.meta.url));
const supported = process.platform === 'win32' && process.arch === 'x64';
const pack = '123e4567-e89b-42d3-a456-426614174000';
const link = (revision = 3) => `quizforge://hub/import?v=1&pack=${pack}&revision=${revision}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let work, executable;
before(async () => {
  if (!supported) return;
  fs.mkdirSync(path.join(product, '.temp'), { recursive: true });
  work = fs.mkdtempSync(path.join(product, '.temp', 'hub-import-tests-')); executable = path.join(work, 'HubImportHarness.exe');
  const source = path.join(product, 'core/desktop/windows');
  await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:exe', '/platform:x64', '/utf8output', '/main:HubImportHarness', '/out:' + executable,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll',
    ...fs.readdirSync(source).filter(name => name.endsWith('.cs')).map(name => path.join(source, name)),
    path.join(product, 'core/test/desktop/fixtures/HubImportHarness.cs')
  ], { windowsHide: true });
});
after(() => { if (work) { assert.equal(path.dirname(work), path.join(product, '.temp')); fs.rmSync(work, { recursive: true, force: true }); } });
const invoke = async (args, env = {}) => JSON.parse((await run(executable, args, { windowsHide: true, timeout: 20000, env: { ...process.env, ...env } })).stdout);

test('compiled launcher targets .NET 4.8 and enables operating-system TLS defaults', { skip: !supported }, async () => {
  const runtime = await invoke(['framework']);
  assert.equal(runtime.targetFramework, '.NETFramework,Version=v4.8');
  assert.equal(runtime.legacyTls, false, 'the legacy compatibility switch rejects SystemDefault TLS on HTTPS');
});

test('Hub URI accepts only the v1 literal grammar and exact standalone startup mode', { skip: !supported }, async () => {
  for (const uri of [link(), `quizforge://hub/import?revision=9007199254740991&pack=${pack}&v=1`]) {
    const parsed = await invoke(['parse', uri]); assert.equal(parsed.PackId, pack); assert.match(parsed.Key, /^hub:/);
    assert.deepEqual(await invoke(['options', '--open-url', uri]), { hub: true });
  }
  const invalid = ['', link().replace('v=1', 'v=2'), link() + '&v=1', link() + '&url=https://evil.test', link() + '#fragment',
    link().replace('hub/', 'hub:443/'), link().replace('hub/', 'user@hub/'), link().replace('/import?', '/import/?'), link().replace('v=1', '%76=1'),
    link().replace('v=1', 'v=%31'), link().replace('174000', '17400A'), link().replace('revision=3', 'revision=03'), link().replace('revision=3', 'revision=0'),
    link().replace('revision=3', 'revision=9007199254740992'), link().replace('revision=3', 'revision=1.0'), link().replace('revision=3', 'revision=+3'),
    link().replace('revision=3', 'revision=3&revision=3'), link().replace('pack=', 'PACK='), link() + '\\', link() + '"', link() + '\n', link() + ' ', link() + 'x'.repeat(1024),
    link().replace('quizforge:', 'https:'), link().replace('hub/', 'other/'), link().replace('v=1&', ''), link() + '&'];
  for (const uri of invalid) await assert.rejects(invoke(['parse', uri]), error => error.code === 1 && /链接无效/.test(error.stderr));
  for (const extra of [['--root', work], ['--data-root', work], ['--port', '0'], ['--import', 'a.qbank'], ['--quit'], ['--no-browser'], ['--layout'], ['--status'], ['--open-url', link()]]) {
    await assert.rejects(invoke(['options', '--open-url', link(), ...extra]), error => error.code === 1 && /不能附带/.test(error.stderr));
    await assert.rejects(invoke(['options', ...extra, '--open-url', link()]), error => error.code === 1);
  }
  await assert.rejects(invoke(['options', '--open-url']), error => error.code === 1);
});
test('Hub pipe messages reject unknown or duplicate fields, JSON escapes and malformed URIs', { skip: !supported }, async () => {
  for (const value of [JSON.stringify({ command: 'hub-import', uri: link() }), JSON.stringify({ uri: link(), command: 'hub-import' })]) assert.equal((await invoke(['command', value])).valid, true);
  for (const value of [JSON.stringify({ command: 'hub-import', uri: link(), root: work }), `{"command":"hub-import","uri":"${link()}","uri":"${link()}"}`,
    JSON.stringify({ command: 'hub-import', uri: link() + '&v=1' }), JSON.stringify({ command: 'import', uri: link() }), `{"command":"hub-import","uri":"${link().replace('v=1', 'v=\\u0031')}"}`, '{broken']) {
    assert.equal((await invoke(['command', value])).valid, false);
  }
});

async function server(t, handler) {
  const connections = new Set();
  const service = http.createServer((req, res) => { Promise.resolve(handler(req, res)).catch(error => { res.destroy(error); }); });
  service.on('connection', socket => { connections.add(socket); socket.on('close', () => connections.delete(socket)); });
  service.listen(0, '127.0.0.1'); await once(service, 'listening');
  t.after(async () => { for (const socket of connections) socket.destroy(); await new Promise(resolve => service.close(resolve)); });
  return `http://127.0.0.1:${service.address().port}`;
}
function manifest(bytes, revision = 3) { return { schemaVersion: 1, pack: { id: pack, revision, title: '示例题库' }, archive: { name: '../非本地路径.qbank', size: bytes.length, sha256: hash(bytes) } }; }
function json(res, value, status = 200) { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); res.end(body); }
function archive(res, bytes, headers = {}) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, ...headers }); res.end(bytes); }
function stageEmpty(root) { const stage = path.join(root, '.temp/hub-import-v1'); assert.deepEqual(fs.existsSync(stage) ? fs.readdirSync(stage) : [], []); }

test('Hub downloads enforce origin paths, manifests, content types, exact lengths and hashes before upload', { skip: !supported, timeout: 90000 }, async t => {
  const bytes = Buffer.from('validated binary archive'), data = path.join(work, 'network-data'); fs.mkdirSync(data);
  let mode = 'ok', uploads = 0, downloads = 0, routes = [], lastBody;
  const origin = await server(t, async (req, res) => {
    routes.push(req.url); assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined);
    if (req.url === '/api/library/import') {
      uploads++; assert.equal(req.headers['x-quizforge-filename'], undefined, 'fixed staging name is not sent as the bank name');
      const chunks = []; for await (const chunk of req) chunks.push(chunk); lastBody = Buffer.concat(chunks);
      return json(res, { scope: 'bank', path: 'Example', name: 'Example', importedBanks: 1, importedExtensions: 1, catalog: { banks: [{ id: 'installed-example', path: 'Example' }] } });
    }
    if (req.url.includes('/local-import?')) {
      let value = manifest(bytes);
      if (mode === 'redirect') { res.writeHead(302, { Location: '/api/library/import' }); return res.end(); }
      if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>proxy error</html>'); }
      if (mode === 'json-large') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(' '.repeat(32769)); }
      if (mode === 'json-invalid') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('not JSON'); }
      if (mode === 'schema') value.schemaVersion = 2;
      if (mode === 'pack') value.pack.id = randomUUID();
      if (mode === 'revision') value.pack.revision = 4;
      if (mode === 'missing') delete value.archive;
      if (mode === 'missing-title') delete value.pack.title;
      if (mode === 'format') value.archive.name = 'archive.zip';
      if (mode === 'size') value.archive.size = 67108865;
      if (mode === 'zero') value.archive.size = 0;
      if (mode === 'fraction') value.archive.size = 1.5;
      if (mode === 'string') value.archive.size = String(bytes.length);
      if (mode === 'sha-case') value.archive.sha256 = hash(bytes).toUpperCase();
      if (mode === 'sha') value.archive.sha256 = '0'.repeat(64);
      if (mode === 'extra') value.futureField = true;
      if (mode === 'slow') { await new Promise(resolve => setTimeout(resolve, 500)); if (res.destroyed) return; }
      if (mode === 'shared-timeout') { await new Promise(resolve => setTimeout(resolve, 160)); if (res.destroyed) return; }
      if (mode === 'slow-error') { res.writeHead(409, { 'Content-Type': 'application/json' }); res.write('{'); return; }
      if (mode.startsWith('code:')) return json(res, { code: mode.slice(5), error: 'secret server paths must not be shown' }, 409);
      if (mode === 'old-error') return json(res, { error: 'old server' }, 404);
      return json(res, value);
    }
    assert.equal(req.url, `/api/packs/${pack}/download?revision=3&sha256=${mode === 'sha' ? '0'.repeat(64) : hash(bytes)}`);
    downloads++;
    if (mode === 'shared-timeout') { await new Promise(resolve => setTimeout(resolve, 160)); if (res.destroyed) return; }
    if (mode === 'download-redirect') { res.writeHead(302, { Location: '/api/library/import' }); return res.end(); }
    if (mode === 'download-type') return archive(res, bytes, { 'Content-Type': 'text/html' });
    if (mode === 'download-missing-length') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(bytes); }
    if (mode === 'download-size') return archive(res, bytes, { 'Content-Length': bytes.length + 1 });
    if (mode === 'download-short') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length }); res.write(bytes.subarray(0, 2)); return res.socket.destroy(); }
    if (mode === 'download-encoding') return archive(res, bytes, { 'Content-Encoding': 'gzip' });
    if (mode === 'download-changed') return archive(res, Buffer.alloc(bytes.length, 1));
    if (mode === 'download-unavailable') return json(res, { code: 'LOCAL_IMPORT_UNAVAILABLE' }, 404);
    return archive(res, bytes);
  });
  const env = { QF_TEST_HUB_ORIGIN: origin };
  for (mode of ['ok', 'extra']) { const result = await invoke(['fetch', link(), data, origin], env); assert.equal(result.BankId, 'installed-example'); stageEmpty(data); assert.deepEqual(lastBody, bytes); }
  assert.equal(uploads, 2); assert.equal(downloads, 2);
  const bad = ['redirect', 'html', 'json-large', 'json-invalid', 'schema', 'pack', 'revision', 'missing', 'missing-title', 'format', 'size', 'zero', 'fraction', 'string', 'sha-case', 'sha',
    'download-redirect', 'download-type', 'download-missing-length', 'download-size', 'download-short', 'download-encoding', 'download-changed', 'download-unavailable', 'old-error'];
  for (mode of bad) { await assert.rejects(invoke(['fetch', link(), data, origin], env), error => error.code === 1, mode); assert.equal(uploads, 2, mode); stageEmpty(data); }
  for (const [code, message] of Object.entries({ LOCAL_IMPORT_REQUEST_INVALID: '链接无效', LOCAL_IMPORT_DISABLED: '暂未开启', LOCAL_IMPORT_UNAVAILABLE: '暂不可用', LOCAL_IMPORT_REVISION_CHANGED: '版本已变化',
    LOCAL_IMPORT_TOO_LARGE: '128 MiB', LOCAL_IMPORT_FORMAT_UNSUPPORTED: '不支持', LOCAL_IMPORT_RATE_LIMITED: '过于频繁', LOCAL_IMPORT_TRAFFIC_LIMIT: '流量额度', LOCAL_IMPORT_SERVER_ERROR: '下载失败', FUTURE_CODE: '下载失败' })) {
    mode = 'code:' + code;
    await assert.rejects(invoke(['fetch', link(), data, origin], env), error => error.code === 1 && error.stderr.includes(message) && !error.stderr.includes('secret'));
  }
  for (mode of ['slow', 'slow-error']) await assert.rejects(invoke(['fetch', link(), data, origin], { ...env, QF_TEST_TIMEOUT: '150' }), error => error.code === 1 && /超时/.test(error.stderr));
  mode = 'shared-timeout'; await assert.rejects(invoke(['fetch', link(), data, origin], { ...env, QF_TEST_TIMEOUT: '250' }), error => error.code === 1 && /超时/.test(error.stderr));
  stageEmpty(data); assert.equal(uploads, 2); assert.ok(routes.every(route => route === '/api/library/import' || route.startsWith(`/api/packs/${pack}/`)));
});

test('stale cleanup removes only old owned task files and preserves other data and unknown directory contents', { skip: !supported }, async () => {
  const data = path.join(work, 'cleanup-data'), root = path.join(data, '.temp/hub-import-v1'); fs.mkdirSync(root, { recursive: true });
  const old = path.join(root, randomUUID().replaceAll('-', '')), recent = path.join(root, randomUUID().replaceAll('-', '')), unknown = path.join(root, 'user-stuff');
  for (const folder of [old, recent, unknown]) { fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'package.qbank'), 'temporary'); }
  const keep = path.join(data, 'question-banks/keep'); fs.mkdirSync(keep, { recursive: true }); fs.writeFileSync(path.join(keep, 'answer.json'), 'keep');
  const past = new Date(Date.now() - 2 * 86400000); fs.utimesSync(old, past, past); fs.utimesSync(unknown, past, past);
  await invoke(['cleanup', data]); assert.equal(fs.existsSync(old), false); assert.equal(fs.existsSync(recent), true); assert.equal(fs.existsSync(unknown), true); assert.equal(fs.readFileSync(path.join(keep, 'answer.json'), 'utf8'), 'keep');
  const unexpected = path.join(root, randomUUID().replaceAll('-', '')); fs.mkdirSync(unexpected); fs.writeFileSync(path.join(unexpected, 'user.txt'), 'keep'); fs.utimesSync(unexpected, past, past);
  await invoke(['cleanup', data]); assert.equal(fs.readFileSync(path.join(unexpected, 'user.txt'), 'utf8'), 'keep');
});

async function fixture(t, origin) {
  const root = fs.mkdtempSync(path.join(work, "程序 空格'")), data = path.join(root, 'data');
  for (const name of ['server', 'web', 'shared']) fs.cpSync(path.join(product, 'core', name), path.join(root, 'core', name), { recursive: true, filter: file => !/\.test\./.test(path.basename(file)) });
  fs.copyFileSync(path.join(product, 'core/package.json'), path.join(root, 'core/package.json')); copyRuntimeDependencies(product, root);
  fs.mkdirSync(path.join(root, 'runtime')); fs.copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
  copyFixture(path.join(product, 'core/test/fixtures/legacy-extensions/single-choice-1.0.0'), path.join(data, 'extensions/Test/choice'), { recursive: true });
  const raw = JSON.parse(fs.readFileSync(path.join(data, 'extensions/Test/choice/examples.json'))); raw.id = 'hub-test-bank'; writeFixture(path.join(data, 'question-banks/Bank/bank.json'), JSON.stringify(raw));
  const staged=path.join(root,'format4-export');for(const name of ['question-banks','extensions'])fs.cpSync(path.join(data,name),path.join(staged,name),{recursive:true});makeFormat4Fixture(staged);
  const exported = await new LibraryArchive(staged, new ResourceStore(staged)).exportBank('Bank'); let bytes;
  try { bytes = fs.readFileSync(exported.file); } finally { exported.close(); }
  // Capacity tests deliberately hold one request while twenty separate EXEs
  // connect. Keep that fixture alive under CPU load; short network deadlines
  // are verified independently above, and production remains 180 seconds.
  const env = { QF_TEST_HUB_ORIGIN: origin, QF_TEST_ROOT: root, QF_TEST_DATA: data, QF_TEST_TIMEOUT: '60000', PATH: '' };
  const command = (...args) => invoke(['run', ...args], env);
  const start = (...args) => {
    const child = spawn(executable, ['run', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    const exit = once(child, 'exit'); child.stdout.resume(); child.stderr.resume();
    t.after(async () => { if (child.exitCode === null) { try { await command('--quit'); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 10000).unref())]); } catch {} } if (child.exitCode === null) { child.kill(); await exit; } });
    return { child, exit };
  };
  return { root, data, raw, bytes, env, command, start };
}
async function waitFor(command, predicate, timeout = 60000) {
  const end = Date.now() + timeout; let status;
  while (Date.now() < end) { try { status = await command('--status'); if (predicate(status)) return status; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail('Tray did not settle: ' + JSON.stringify(status));
}
async function oldPackage(version) {
  const zip = new yazl.ZipFile(), chunks = []; zip.outputStream.on('data', chunk => chunks.push(chunk));
  zip.addBuffer(Buffer.from(JSON.stringify({ format: 'quizforge-bank-group', formatVersion: version, group: 'Old' })), 'quizforge-package.json');
  zip.end(); await once(zip.outputStream, 'end'); return Buffer.concat(chunks);
}

test('Hub cold and warm starts reuse one real tray/backend, coalesce pending links and preserve active answers', { skip: !supported, timeout: 90000 }, async t => {
  let f, downloads = 0, gate;
  const origin = await server(t, async (req, res) => {
    if (req.url.includes('/local-import?')) return json(res, manifest(f.bytes));
    downloads++; if (gate) await gate; return archive(res, f.bytes);
  });
  f = await fixture(t, origin); const original = fs.readFileSync(path.join(f.data, 'question-banks/Bank/bank.json'));
  let release; gate = new Promise(resolve => { release = resolve; }); const owner = f.start('--open-url', link());
  await waitFor(f.command, status => status.lastImport?.state === 'downloading');
  const duplicate = await f.command('--open-url', link()); release(); gate = null;
  const first = await waitFor(f.command, status => status.lastImport?.state === 'completed');
  assert.equal(first.lastImport.id, duplicate.acceptedImportId); assert.equal(first.launcherPid, owner.child.pid); assert.equal(first.pendingImports, 0); assert.equal(first.browserOpenRequests, 1);
  assert.equal(first.lastImport.packId, pack); assert.equal(first.lastImport.revision, 3); assert.equal(first.lastImport.source, 'hub'); assert.equal(downloads, 1);
  assert.equal(new URL(first.lastOpenedUrl).searchParams.get('imported-bank'), first.lastImport.bankId);
  let index = await (await fetch(first.url + 'api/library/index')).json(); assert.equal(index.banks.length, 2); assert.equal(index.banks.find(row => row.id === first.lastImport.bankId).title, 'Bank（2）');
  const question = first.url + 'api/collections/bank/hub-test-bank/questions/' + f.raw.questions[0].id;
  assert.equal((await fetch(question + '/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', requestId: 'hub-preserve-answer', revision: 0, data: { answer: { selectedOptionId: 'B' } } }) })).status, 200);
  const accepted = await f.command('--open-url', link()); assert.notEqual(accepted.acceptedImportId, first.lastImport.id);
  const second = await waitFor(f.command, status => status.lastImport?.id === accepted.acceptedImportId && status.lastImport?.state === 'completed');
  assert.equal(second.servicePid, first.servicePid); assert.equal(second.launcherPid, first.launcherPid); assert.equal(second.browserOpenRequests, 2); assert.equal(downloads, 2);
  index = await (await fetch(first.url + 'api/library/index')).json(); assert.equal(index.banks.length, 3); assert.equal(index.banks.find(row => row.id === second.lastImport.bankId).title, 'Bank（3）');
  assert.deepEqual((await (await fetch(question)).json()).state.answer, { selectedOptionId: 'B' }); assert.deepEqual(fs.readFileSync(path.join(f.data, 'question-banks/Bank/bank.json')), original); stageEmpty(f.data);
  await f.command('--quit'); await owner.exit; assert.equal(fs.existsSync(path.join(f.data, '.state/host.lock')), false);
});

test('Hub and file imports share the 20-task bound; failed/old packages preserve data and exit drains accepted downloads', { skip: !supported, timeout: 120000 }, async t => {
  let f, mode = 'hold', release, bytes;
  const gate = new Promise(resolve => { release = resolve; });
  const origin = await server(t, async (req, res) => {
    const revision = Number(new URL(req.url, 'http://localhost').searchParams.get('revision'));
    if (req.url.includes('/local-import?')) {
      if (mode === 'hold') { await gate; return json(res, { code: 'LOCAL_IMPORT_UNAVAILABLE' }, 404); }
      return json(res, manifest(bytes, revision));
    }
    return archive(res, bytes);
  });
  f = await fixture(t, origin); const owner = f.start(), ready = await waitFor(f.command, value => value.state === '运行中');
  const existing = await (await fetch(ready.url + 'api/library/index')).json();
  await f.command('--open-url', link(1));
  const file = path.join(work, 'mixed-local.qbank'); fs.writeFileSync(file, f.bytes); await f.command('--import', file);
  for (let revision = 2; revision <= 19; revision++) await f.command('--open-url', link(revision));
  assert.equal((await f.command('--status')).pendingImports, 20);
  await assert.rejects(f.command('--open-url', link(20)), error => error.code === 1 && /等待/.test(error.stderr));
  const duplicate = await f.command('--open-url', link(19)); assert.ok(duplicate.acceptedImportId); release();
  await waitFor(f.command, value => value.pendingImports === 0);
  assert.equal((await (await fetch(ready.url + 'api/library/index')).json()).banks.length, existing.banks.length + 1);
  mode = 'package';
  for (bytes of [Buffer.from('invalid ZIP'), await oldPackage(1), await oldPackage(2)]) {
    const accepted = await f.command('--open-url', link(100)); const failed = await waitFor(f.command, value => value.lastImport?.id === accepted.acceptedImportId && value.lastImport?.state === 'failed');
    assert.match(failed.lastImport.message, bytes[0] === 80 ? /格式 3|升级/ : /ZIP|压缩包/); assert.equal(failed.servicePid, ready.servicePid); stageEmpty(f.data);
    assert.equal((await (await fetch(ready.url + 'api/library/index')).json()).banks.length, existing.banks.length + 1);
  }
  const groupRoot = path.join(work, 'group-source');
  fs.cpSync(path.join(f.data, 'extensions'), path.join(groupRoot, 'extensions'), { recursive: true });
  fs.mkdirSync(path.join(groupRoot, 'question-banks/Group'), { recursive: true });
  fs.cpSync(path.join(f.data, 'question-banks/Bank'), path.join(groupRoot, 'question-banks/Group/Member'), { recursive: true });
  makeFormat4Fixture(groupRoot);
  const groupArchive = await new LibraryArchive(groupRoot, new ResourceStore(groupRoot)).exportGroup('Group');
  try { bytes = fs.readFileSync(groupArchive.file); } finally { groupArchive.close(); }
  const groupAccepted = await f.command('--open-url', link(150));
  const groupDone = await waitFor(f.command, value => value.lastImport?.id === groupAccepted.acceptedImportId && ['completed', 'failed'].includes(value.lastImport?.state));
  assert.equal(groupDone.lastImport.state, 'completed', JSON.stringify(groupDone));
  const groupIndex = await (await fetch(ready.url + 'api/library/index')).json();
  assert.equal(groupIndex.banks.find(bank => bank.id === groupDone.lastImport.bankId).group, 'Group');
  bytes = f.bytes; await f.command('--open-url', link(200)); await f.command('--quit'); await owner.exit;
  assert.equal(fs.existsSync(path.join(f.data, 'question-banks/Bank（2）/bank.json')), true); stageEmpty(f.data); assert.equal(fs.existsSync(path.join(f.data, '.state/host.lock')), false);
});
