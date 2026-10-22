import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { QuizForgeServer } from './server.js';
import { readJson, safeDirectory, within } from '../platform/files.js';
import { jsonBytes } from '../platform/json.js';
import { MIME as archiveMime } from '../library/library-archive.js';
import { build } from 'esbuild';
const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), base = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
async function fixture(t, options = {}) {
  safeDirectory(base, true); const root = fs.mkdtempSync(path.join(base, 'http-')); fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  const extension = path.join(root, 'extensions', 'Test', 'choice'); copyFixture(path.join(codeRoot, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), extension, { recursive: true });
  const raw = readJson(path.join(extension, readJson(path.join(extension, 'manifest.json')).examples)); raw.id = 'bank1'; raw.features = { history: options.history ?? true };
  writeFixture(path.join(root, 'question-banks', 'bank', 'bank.json'), jsonBytes(raw));
  const service = await QuizForgeServer.create({ root, codeRoot, port: 0, token: options.token ?? null, tailscale: options.tailscale ?? { read: async () => ({ state: 'missing' }) }, hub: options.hub ?? { fetchImpl: async () => { throw new Error('No Hub in tests'); } } }); service.engine.validationEnvironment = async () => 'http-fixture'; options.beforeStart?.(service); await service.start();
  t.after(async () => { await service.close(); assert.ok(within(base, root) && root !== base); fs.rmSync(root, { recursive: true, force: true }); });
  const api = async (uri, { method = 'GET', body, headers = {}, port = service.port() } = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + uri, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { root, service, api, raw };
}
const rawGet = (port, uri, headers = {}) => new Promise((resolve, reject) => { const request = http.get({ host: '127.0.0.1', port, path: uri, headers }, response => { const bytes = []; response.on('data', chunk => bytes.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, data: Buffer.concat(bytes).toString() })); }); request.on('error', reject); });

test('all browser entry modules load over HTTP including the shared answer model and brush', async t => {
  const { api, service } = await fixture(t), origin = 'http://127.0.0.1:' + service.port(), loaded = new Set();
  await build({ entryPoints: [origin + '/app.js'], bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent', plugins: [{
    name: 'real-http-module-graph', setup(build) {
      build.onResolve({ filter: /^https?:\/\// }, args => ({ path: args.path, namespace: 'http-module' }));
      build.onResolve({ filter: /.*/, namespace: 'http-module' }, args => ({ path: new URL(args.path, args.importer).href, namespace: 'http-module' }));
      build.onLoad({ filter: /.*/, namespace: 'http-module' }, async args => {
        const response = await fetch(args.path); assert.equal(response.status, 200, 'Missing browser dependency: ' + args.path);
        assert.match(response.headers.get('content-type'), /^text\/javascript/); loaded.add(new URL(args.path).pathname);
        return { contents: await response.text(), loader: 'js' };
      });
    }
  }] });
  assert.ok(loaded.has('/shared/answer-area/1.4.0/model.js')); assert.ok(loaded.has('/shared/ink/1.0.0/renderer.js'));
  assert.ok(loaded.has('/editor/editor-navigation.js'));
  const editorStyle=await api('/editor/editor-navigation.css');assert.equal(editorStyle.status,200);assert.match(editorStyle.headers.get('content-type'),/^text\/css/);
  const entry=await api('/');assert.match(entry.data.toString(),/id="editor-leave-dialog"/);assert.match(entry.data.toString(),/href="\/editor\/editor-navigation.css"/);
  assert.equal((await api('/shared/answer-area/1.3.0/model.js')).status,200,'old pure model remains available');
  assert.ok(loaded.size > 30, 'check the whole startup graph, not just the new files');
  for (const uri of ['/shared/answer-area/1.3.0/component.js', '/shared/answer-area/1.2.0/model.js', '/shared/ink/1.0.0/renderer.js.map', '/server/host/http/server.js']) assert.equal((await api(uri)).status, 404, uri);
  assert.equal((await api('/api/library/index')).data.banks.length, 1);
});

test('desktop graceful shutdown finishes an accepted save and its HTTP response before releasing the directory', async t => {
  const { api, service, root, raw } = await fixture(t);
  const question = '/api/collections/bank/bank1/questions/' + raw.questions[0].id;
  const initial = (await api(question)).data;
  let release, entered;
  const gate = new Promise(resolve => release = resolve), started = new Promise(resolve => entered = resolve);
  const act = service.states.act.bind(service.states);
  service.states.act = (...args) => service.states.transactions.run(async () => { entered(); await gate; return act(...args); });
  const saving = api(question + '/actions', { method: 'POST', body: { action: 'draft', requestId: 'tray-save', revision: initial.state.revision, data: { answer: { selectedOptionId: 'B' } } } });
  await started;
  const closing = service.close({ graceful: true });
  assert.equal(service.close({ graceful: true }), closing);
  assert.equal(service.engine.closed, false);
  assert.equal(fs.existsSync(path.join(root, '.state/host.lock')), true);
  release(); const response = await saving;
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await closing; assert.equal(service.engine.closed, true);
  assert.equal(fs.existsSync(path.join(root, '.state/host.lock')), false);
  assert.deepEqual(response.data.state.answer, { selectedOptionId: 'B' });
});

test('conditional question reads reuse one checked binding and return updated answers on a stale stamp', async t => {
  const {api, service, raw, root} = await fixture(t);
  const q = '/api/collections/bank/bank1/questions/' + raw.questions[0].id;
  const original = (await api(q)).data;
  let scans = 0, projections = 0;
  const scan = service.library.indexSnapshot.bind(service.library), run = service.engine.run.bind(service.engine);
  service.library.indexSnapshot = (...args) => { scans++; return scan(...args); };
  service.engine.run = (extension, input) => { if (input.op === 'project') projections++; return run(extension, input); };
  const headers = {'X-QuizForge-Question-Stamp': JSON.stringify(original.stamp)};
  const warm = await api(q, {headers});
  assert.equal(warm.status, 200); assert.deepEqual(warm.data, {unchanged:true, stamp:original.stamp});
  // Warm reads recheck only this bank's own inputs, never the whole library index.
  assert.equal(scans, 0); assert.equal(projections, 0);
  await api(q + '/stamp'); assert.equal(scans, 0);
  await api('/api/collections/bank/bank1'); assert.equal(scans, 0);
  const answer = {selectedOptionId: raw.questions[0].data.correctOptionId};
  assert.equal((await api(q + '/actions', {method:'POST', body:{action:'draft', requestId:'conditional-draft', revision:0, data:{answer}}})).status, 200);
  scans = 0; projections = 0;
  const changed = await api(q, {headers});
  assert.equal(changed.data.unchanged, undefined); assert.deepEqual(changed.data.state.answer, answer);
  assert.equal(changed.data.stamp.revision, 1); assert.equal(scans, 0); assert.equal(projections, 1);
  assert.equal((await api(q, {headers:{'X-QuizForge-Question-Stamp':'bad'}})).status, 400);
  assert.equal((await api(q, {headers:{'X-QuizForge-Question-Stamp':JSON.stringify({...changed.data.stamp, packageVersion:'old'})}})).data.unchanged, undefined);
  // An outside edit to the opened bank is still seen by the very next read.
  const file = path.join(root, 'question-banks', 'bank', 'bank.json'), edited = readJson(file); edited.title = 'Edited outside QuizForge'; writeFixture(file, jsonBytes(edited));
  scans = 0; const reloaded = await api('/api/collections/bank/bank1');
  assert.equal(reloaded.data.title, 'bank'); assert.ok(scans > 0, 'A changed bank goes through the full loader');
});
test('startup and metadata do not validate unopened banks; opening validates only the selected bank', async t => {
  const operations=[];
  const { api, service, root, raw }=await fixture(t,{beforeStart(service){const run=service.engine.run.bind(service.engine);service.engine.run=(extension,input)=>{operations.push(input.op);return run(extension,input);};}});
  const other=structuredClone(raw);other.id='bank2';other.questions[0].data={};
  writeFixture(path.join(root,'question-banks', 'other', 'bank.json'),jsonBytes(other));
  assert.equal((await api('/api/health')).status,200);
  const initial=(await api('/api/library/index')).data;
  assert.equal(initial.banks.length,2);assert.ok(initial.banks.every(row=>row.validationStatus==='pending'));
  assert.deepEqual(operations,[]);assert.equal(service.library.loaded.size,0);
  assert.equal((await api('/api/collections/bank/bank1')).status,200);
  const opened=(await api('/api/library/index')).data;
  assert.equal(opened.banks.find(row=>row.id==='bank1').validationStatus,'ready');
  assert.equal(opened.banks.find(row=>row.id==='bank2').validationStatus,'pending');
  assert.equal(service.library.loaded.size,1);
  const validations=operations.filter(op=>op==='validateBank').length;assert.ok(validations>0);
  assert.equal((await api('/api/collections/bank/bank1')).status,200);
  assert.equal(operations.filter(op=>op==='validateBank').length,validations,'An unchanged warm collection reuses validation');
  assert.equal((await api('/api/collections/bank/bank2')).status,422);
  assert.equal((await api('/api/collections/bank/bank1')).status,200,'An invalid unopened bank cannot block a healthy bank');
});

test('runtime digest warmup overlaps metadata reads without opening any bank', async t => {
  let release, started = false;
  const gate = new Promise(resolve => {release = resolve;});
  const {api, service} = await fixture(t, {beforeStart(service) {
    service.engine.validationEnvironment = async () => {started = true; await gate; return 'warm-runtime';};
    service.engine.run = () => {throw new Error('Startup must not execute bank rules');};
  }});
  try {
    assert.equal(started, true);
    assert.equal((await api('/api/library/index')).status, 200);
    assert.equal(service.library.loaded.size, 0);
    release(); await service.runtimeWarmup;
  } finally {release();}
});
test('native HTTP serves existing pages and isolates administrator routes', async t => {
  const { api, service } = await fixture(t);
  assert.equal((await api('/api/health')).data.ok, true);
  const page = await api('/'); assert.equal(page.status, 200); assert.ok(page.data.includes(Buffer.from('QuizForge'))); assert.ok(page.headers.get('content-security-policy'));
  assert.equal((await rawGet(service.port(), '/api/health', { Host: 'evil.example:' + service.port() })).status, 403);
  assert.equal((await rawGet(service.port(), '/api/settings/ai', { 'X-Forwarded-For': '1.2.3.4' })).status, 403);
  assert.equal((await rawGet(service.port(), '/%2e%2e/package.json')).status, 404);
  assert.equal((await api('/api/settings/development', { method: 'PUT', body: { enabled: true }, headers: { Origin: 'https://evil.example' } })).data.error.code, 'ORIGIN_REJECTED');
  const index = await api('/api/library/index'); assert.equal(index.status, 200); assert.equal(index.data.canManage, true); assert.equal(index.data.banks[0].id, 'bank1');
  const catalog = await api('/api/catalog'); assert.equal(catalog.status, 200); assert.equal(catalog.data.banks[0].validationStatus, 'ready');
  const credential = await api('/api/settings/ai/credential'); assert.equal(credential.status, 200);
  assert.equal((await api('/api/settings/ai')).data.apiKey, undefined);
  assert.equal((await api('/api/extensions/quizforge.single-choice/1.0.0/page?typeId=x')).status, 400);
});
test('native HTTP preserves revision, submitted answers, frozen history and restart', async t => {
  const { api, raw } = await fixture(t), qid = raw.questions[0].id, prefix = '/api/collections/bank/bank1', q = prefix + '/questions/' + qid;
  const original = await api(q); assert.equal(original.status, 200);
  const answer = { selectedOptionId: raw.questions[0].data.correctOptionId };
  const draft = await api(q + '/actions', { method: 'POST', body: { action: 'draft', requestId: 'native-draft1', revision: 0, data: { answer } } }); assert.equal(draft.status, 200, JSON.stringify(draft.data));
  const submitted = await api(q + '/actions', { method: 'POST', body: { action: 'submit', requestId: 'native-submit1', revision: 1, data: { answer } } }); assert.equal(submitted.status, 200); assert.equal(submitted.data.state.status, 'submitted');
  const summary = await api(prefix + '/summary'); assert.equal(summary.status, 200);
  const finished = await api(prefix + '/finish', { method: 'POST', body: { requestId: 'native-finish1', roundId: summary.data.roundId, summaryVersion: summary.data.summaryVersion } }); assert.equal(finished.status, 200);
  const history = await api(prefix + '/history'); assert.equal(history.status, 200); assert.equal(history.data.records.length, 1);
  const frozen = await api(prefix + '/history/' + history.data.records[0].id); assert.equal(frozen.status, 200); assert.ok(frozen.data.page);
  const restarted = await api(prefix + '/restart', { method: 'POST', body: { requestId: 'native-restart1', roundId: finished.data.roundId, summaryVersion: finished.data.summaryVersion } }); assert.equal(restarted.status, 200); assert.equal((await api(q)).data.state.status, 'unanswered');
});

test('HTTP bank and group renames preserve active answers, ink, stamps and frozen history without revalidation', async t => {
  const { api, raw, service } = await fixture(t), prefix = '/api/collections/bank/bank1', q = prefix + '/questions/' + raw.questions[0].id;
  const answer = { selectedOptionId: raw.questions[0].data.correctOptionId };
  assert.equal((await api(q + '/actions', { method: 'POST', body: { action: 'submit', requestId: 'rename-submit', revision: 0, data: { answer } } })).status, 200);
  const summary = (await api(prefix + '/summary')).data;
  const finished = (await api(prefix + '/finish', { method: 'POST', body: { requestId: 'rename-finish', roundId: summary.roundId, summaryVersion: summary.summaryVersion } })).data;
  const historyId = (await api(prefix + '/history')).data.records[0].id;
  const frozen = (await api(prefix + '/history/' + historyId)).data;
  assert.equal((await api(prefix + '/restart', { method: 'POST', body: { requestId: 'rename-restart', roundId: finished.roundId, summaryVersion: finished.summaryVersion } })).status, 200);
  const draft = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, paper: { color: '#ffffff', pattern: 'plain' }, strokes: [{ id: 'ink', color: '#334155', width: 3, points: [{ x: 80, y: 120, pressure: .5 }] }] };
  const initial = (await api(q)).data;
  const drafted = await api(q + '/actions', { method: 'POST', body: { action: 'draft', requestId: 'rename-draft', revision: initial.state.revision, data: { answer } } }); assert.equal(drafted.status, 200);
  assert.equal((await api(q + '/actions', { method: 'POST', body: { action: 'whiteboard', requestId: 'rename-ink', revision: drafted.data.state.revision, data: { draft } } })).status, 200);
  const before = (await api(q)).data, descriptor = (await api(prefix)).data;
  const operations = [], run = service.engine.run.bind(service.engine); service.engine.run = (extension, input) => { operations.push(input.op); return run(extension, input); };
  const renamed = await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'update', target: 'item', path: 'bank', name: 'Renamed', group: '' } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(renamed.data.retainedCollections.find(row => row.id === 'bank1').previousRevision, descriptor.revision);
  assert.equal((await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'create', target: 'group', name: 'Group' } })).status, 200);
  assert.equal((await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'update', target: 'item', path: 'Renamed', name: 'Renamed', group: 'Group' } })).status, 200);
  assert.equal((await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'update', target: 'group', path: 'Group', name: 'New Group' } })).status, 200);
  const after = (await api(q)).data;
  assert.deepEqual(after.state, before.state); assert.deepEqual(after.draft, draft); assert.deepEqual(after.stamp, before.stamp);
  assert.equal((await api(prefix)).data.title, 'Renamed');
  assert.deepEqual((await api(prefix + '/history/' + historyId)).data, frozen);
  assert.ok(!operations.some(op => ['validateBank', 'getOutlineItems'].includes(op)), JSON.stringify(operations));
  assert.equal((await api(q + '/actions', { method: 'POST', body: { action: 'draft', requestId: 'rename-next-save', revision: after.state.revision, data: { answer } } })).status, 200);
});
test('history-disabled HTTP practice requires and isolates the browser page session', async t => {
  const { api, raw, root } = await fixture(t, { history: false }), uri = '/api/collections/bank/bank1/questions/' + raw.questions[0].id;
  assert.equal((await api(uri)).data.error.code, 'PRACTICE_SESSION_REQUIRED');
  const first = { 'X-QuizForge-Practice-Session': randomUUID() }, second = { 'X-QuizForge-Practice-Session': randomUUID() };
  assert.equal((await api(uri, { headers: first })).status, 200);
  const drafted = await api(uri + '/actions', { method: 'POST', headers: first, body: { action: 'draft', requestId: 'temporary-draft1', revision: 0, data: { answer: { selectedOptionId: raw.questions[0].data.correctOptionId } } } }); assert.equal(drafted.status, 200);
  assert.equal((await api(uri, { headers: second })).data.state.status, 'unanswered');
  assert.equal(fs.readdirSync(path.join(root, '.state')).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).length, 0);
});
test('native host enforces one writer per data directory and retains local access tokens', async t => {
  const { service, root, api } = await fixture(t, { token: 'native-token-123456789' });
  assert.equal((await api('/api/health')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', body: { password: 'native-token-123456789' } })).status, 200);
  assert.equal((await api('/api/health', { headers: { 'X-QuizForge-Token': 'native-token-123456789' } })).status, 200);
  await assert.rejects(QuizForgeServer.create({ root, codeRoot, port: 0 }), /already open/);
  assert.equal(fs.existsSync(path.join(root, '.state', 'host.lock')), true);
});
test('shared network password protects remote listener and blocks remote settings', async t => {
  const { api, service } = await fixture(t);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const settings = await api('/api/settings/network', { method: 'PUT', body: { enabled: true, publicEnabled: false, port, password: 'shared-password' } }); assert.equal(settings.status, 200); assert.equal(settings.data.enabled, true);
  assert.equal((await api('/api/health', { port })).status, 401);
  const login = await api('/api/auth/login', { port, method: 'POST', body: { password: 'shared-password' } }); assert.equal(login.status, 200); const headers = { 'X-QuizForge-Token': login.data.token };
  assert.equal((await api('/api/health', { port, headers })).status, 200);
  assert.equal((await api('/api/settings/ai/credential', { port, headers })).status, 403);
  assert.equal((await api('/api/settings/network', { port, headers })).status, 403);
  await api('/api/settings/network', { method: 'PUT', body: { enabled: false, publicEnabled: false, port } });
  assert.equal(service.networkServer, null);
});
test('web app manifest is served as a static asset with installable fields and existing icons', async t => {
  const { api } = await fixture(t, { token: 'manifest-token-123456789' });
  const page = (await api('/')).data.toString(); assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest">/); assert.doesNotMatch(page, /serviceWorker/);
  const response = await api('/manifest.webmanifest'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/manifest+json; charset=utf-8'); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await api('/api/health')).status, 401);
  const manifest = JSON.parse(response.data.toString());
  assert.equal(manifest.name, 'QuizForge 题库'); assert.equal(manifest.short_name, 'QuizForge'); assert.equal(manifest.display, 'standalone');
  // The start URL never carries the #token= hash, so installing cannot copy an access token into the launcher.
  assert.equal(manifest.start_url, '/'); assert.equal(manifest.scope, '/'); assert.equal(manifest.id, '/'); assert.notEqual(manifest.prefer_related_applications, true);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/); assert.match(manifest.background_color, /^#[0-9a-f]{6}$/);
  const covered = new Set();
  for (const icon of manifest.icons) {
    const image = await api(icon.src); assert.equal(image.status, 200, icon.src); assert.equal(image.headers.get('content-type'), icon.type);
    assert.equal(image.data.subarray(1, 4).toString(), 'PNG'); assert.equal(`${image.data.readUInt32BE(16)}x${image.data.readUInt32BE(20)}`, icon.sizes);
    covered.add(icon.purpose + ':' + icon.sizes);
  }
  assert.deepEqual([...covered].sort(), ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']);
});
test('HTTPS public address accepts a forwarded Host without the default port', async t => {
  const { api } = await fixture(t);
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  assert.equal((await api('/api/settings/network', { method: 'PUT', body: { enabled: false, publicEnabled: true, publicUrl: 'https://quiz.example.test/', port, password: 'shared-password' } })).status, 200);
  for (const host of ['quiz.example.test', 'quiz.example.test:443']) {
    assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: host, 'X-Forwarded-Proto': 'https' })).status, 200, host);
    assert.equal((await rawGet(port, '/api/health', { Host: host })).status, 401, host);
  }
  for (const host of ['quiz.example.test:8443', 'other.example.test']) assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: host })).status, 403, host);
  const login = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ password: 'shared-password' });
    const request = http.request({ host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST', headers: { Host: 'quiz.example.test', Origin: 'https://quiz.example.test', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end(body);
  });
  assert.equal(login, 200);
});

test('detected Tailscale and public IPv6 addresses work without saving a public URL', async t => {
  let tailscale = { state: 'running', name: 'pc.tail1234.ts.net', ips: ['100.70.1.2'], url: 'https://pc.tail1234.ts.net/' }, reads = 0;
  const { api, service } = await fixture(t, { tailscale: { read: async (port, { force } = {}) => { reads += force ? 1 : 0; return tailscale; } } });
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const saved = await api('/api/settings/network', { method: 'PUT', body: { enabled: false, publicEnabled: true, publicUrl: '', port, password: 'shared-password' } });
  assert.equal(saved.status, 200); assert.equal(saved.data.publicUrl, ''); assert.deepEqual(saved.data.tailscale, { state: 'running', name: 'pc.tail1234.ts.net', url: 'https://pc.tail1234.ts.net/' });
  for (const host of [`pc.tail1234.ts.net:${port}`]) assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: host })).status, 200, 'the MagicDNS name also works over HTTP on the connection port');
  for (const host of ['pc.tail1234.ts.net', 'pc.tail1234.ts.net:443', `100.70.1.2:${port}`]) assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: host })).status, 200, host);
  assert.equal((await rawGet(port, '/api/health', { Host: 'pc.tail1234.ts.net' })).status, 401, 'the password still applies');
  for (const host of ['other.tail1234.ts.net', 'pc.tail1234.ts.net:8443', `100.70.1.3:${port}`]) assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: host })).status, 403, host);
  const login = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ password: 'shared-password' });
    const request = http.request({ host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST', headers: { Host: 'pc.tail1234.ts.net', Origin: 'https://pc.tail1234.ts.net', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject); request.end(body);
  });
  assert.equal(login, 200, 'the HTTPS origin of the Tailscale forward is accepted');
  service.publicIpv6Hosts = new Set(['2001:db8::42']);
  assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: `[2001:db8::42]:${port}` })).status, 200, 'a detected public IPv6 address works');
  const before = reads; const fresh = await api('/api/settings/network?refresh=1'); assert.equal(fresh.status, 200); assert.equal(reads, before + 1, 'refresh re-reads Tailscale');
  tailscale = { state: 'stopped' }; await api('/api/settings/network?refresh=1');
  assert.equal((await rawGet(port, '/manifest.webmanifest', { Host: 'pc.tail1234.ts.net' })).status, 403, 'a stopped client no longer opens its name');
  assert.equal((await api('/api/settings/network', { method: 'PUT', body: { enabled: false, publicEnabled: false, publicUrl: '', port, password: '' } })).status, 200);
  tailscale = { state: 'running', name: 'pc.tail1234.ts.net', ips: [], url: null };
  const plain = await api('/api/settings/network?refresh=1'); assert.equal(plain.status, 200);
  assert.deepEqual(plain.data.tailscale, { state: 'running', name: 'pc.tail1234.ts.net', url: `http://pc.tail1234.ts.net:${port}/` }, 'without an HTTPS forward the HTTP name is listed');
});

test('Hub login starts on the host only and the loopback callback finishes it without exposing the token', async t => {
  const exchanged = [];
  const token = 'qfd_' + 'B'.repeat(43);
  const fetchImpl = async (url, init) => { exchanged.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify(url.endsWith('/api/connect/redeem') ? { added: 50, points: 50 } : { token, device: { id: 'd1', name: 'pc', client: 'web' }, user: { name: 'alice' } }), { status: 200 }); };
  const { api, service } = await fixture(t, { hub: { fetchImpl, origin: 'https://hub.example' } });
  const initial = await api('/api/settings/ai');
  assert.deepEqual(initial.data.hub, { connected: false }); assert.deepEqual([initial.data.useOfficial, initial.data.useCustom], [false, false]);
  assert.equal((await api('/api/settings/ai', { method: 'PUT', body: { useOfficial: true, enabled: true } })).status, 200, 'the free quota needs no model address');
  assert.equal((await api('/api/settings/ai', { method: 'PUT', body: { useCustom: true } })).status, 400, 'the custom model still needs an address and model');
  const started = await api('/api/settings/ai/hub/login', { method: 'POST', body: {} });
  const authorize = new URL(started.data.authorizeUrl);
  assert.equal(authorize.origin, 'https://hub.example');
  assert.equal(authorize.searchParams.get('redirect_uri'), `http://127.0.0.1:${service.port()}/hub/connect/callback`);
  const state = authorize.searchParams.get('state'), code = 'C'.repeat(43);
  const bad = await rawGet(service.port(), '/hub/connect/callback?code=' + code + '&state=wrong-state-0000000000000');
  assert.equal(bad.status, 200); assert.match(bad.data.toString(), /没有完成登录/);
  const page = await rawGet(service.port(), `/hub/connect/callback?code=${code}&state=${state}`);
  assert.match(page.data.toString(), /已登录 QuizForge 账号/); assert.equal(page.data.toString().includes(token), false, 'the page never shows the token');
  assert.equal(exchanged.length, 1); assert.equal(exchanged[0].url, 'https://hub.example/api/connect/token'); assert.equal(exchanged[0].body.code, code);
  const after = await api('/api/settings/ai');
  assert.deepEqual(after.data.hub, { connected: true, user: { name: 'alice' }, device: { name: 'pc', client: 'web' } });
  assert.equal(JSON.stringify(after.data).includes(token), false, 'settings never return the device token');
  const redeemed = await api('/api/settings/ai/hub/redeem', { method: 'POST', body: { code: 'AI-0000-1111-2222-3333' } });
  assert.deepEqual(redeemed.data, { added: 50, points: 50 }); assert.deepEqual(exchanged.at(-1), { url: 'https://hub.example/api/connect/redeem', body: { code: 'AI-0000-1111-2222-3333' } });
  assert.equal((await rawGet(service.port(), `/hub/connect/callback?code=${code}&state=${state}`, { Host: 'example.test' })).status, 403, 'other host names cannot reach the callback');
});

test('HTTP group export and import transport the native qbank stream and installed versions', async t => {
  const { api, root, raw } = await fixture(t);
  assert.equal((await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'create', target: 'group', name: 'HTTP Group' } })).status, 200);
  const moved = await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'update', target: 'item', path: 'bank', name: raw.title, group: 'HTTP Group' } }); assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const archive = await api('/api/library/export', { method: 'POST', body: { group: 'HTTP Group' } }); assert.equal(archive.status, 200); assert.equal(archive.headers.get('content-type'), archiveMime); assert.ok(archive.headers.get('content-disposition').includes('.qbank'));
  const other = await fixture(t); fs.unlinkSync(path.join(other.root, 'question-banks', 'bank', 'bank.json')); fs.rmSync(path.join(other.root, 'extensions', 'Test', 'choice'), { recursive: true }); other.service.library.invalidate();
  const response = await fetch('http://127.0.0.1:' + other.service.port() + '/api/library/import', { method: 'POST', headers: { 'Content-Type': archiveMime }, body: archive.data });
  const imported = await response.json(); assert.equal(response.status, 200, JSON.stringify(imported)); assert.equal(imported.importedBanks, 1); assert.equal(imported.importedExtensions, 1);
  assert.equal((await other.api('/api/collections/bank/'+imported.catalog.banks[0].id)).status, 200);
});

test('HTTP individual export imports at root and deleting its renamed bank preserves all extensions', async t => {
  const { api, root, service } = await fixture(t);
  for (const body of [{}, {bank:'bank',group:'Group'}, {bank:'bank',extra:true}, []]) assert.equal((await api('/api/library/export', {method:'POST',body})).status, 400);
  assert.equal((await api('/api/library/export', {method:'POST',body:{bank:'../bank'}})).status, 404);
  const exported = await api('/api/library/export', {method:'POST',body:{bank:'bank'}});
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('content-type'), archiveMime);
  assert.ok(exported.headers.get('content-disposition').includes('bank.qbank'));
  const response = await fetch('http://127.0.0.1:' + service.port() + '/api/library/import', {method:'POST',headers:{'Content-Type':archiveMime,'X-QuizForge-Filename':encodeURIComponent('单题库.qbank')},body:exported.data});
  const installed = await response.json(); assert.equal(response.status, 200, JSON.stringify(installed));
  assert.equal(installed.group, ''); assert.equal(installed.scope, 'bank'); assert.equal(installed.path, '单题库');
  const row = installed.catalog.banks.find(row=>row.path==='单题库'); assert.ok(row);
  assert.equal((await api('/api/collections/bank/'+row.id)).status, 200);
  const renamed = await api('/api/library/manage', {method:'POST',body:{kind:'bank',action:'update',target:'item',path:'单题库',name:'改过名',group:''}}); assert.equal(renamed.status,200);
  const removed = await api('/api/library/manage', {method:'POST',body:{kind:'bank',action:'delete',target:'item',path:'改过名'}});
  assert.equal(removed.status,200,JSON.stringify(removed.data)); assert.deepEqual(removed.data.removedExtensionGroups,[]);
  assert.ok(fs.existsSync(path.join(root,'extensions/单题库/choice/manifest.json')));
  assert.ok(fs.existsSync(path.join(root,removed.data.archivedTo,'content/改过名/bank.json')));
  assert.equal(fs.existsSync(path.join(root,removed.data.archivedTo,'extensions')),false);
  assert.ok(fs.existsSync(path.join(root,'extensions/Test/choice/manifest.json')));
  assert.ok(fs.existsSync(path.join(root,'question-banks/bank/bank.json')));
});
test('HTTP imports allocate new physical groups by filename without conflict plans',async t=>{
 const source=await fixture(t),target=await fixture(t);
 await source.api('/api/library/manage',{method:'POST',body:{kind:'bank',action:'create',target:'group',name:'Package'}});
 assert.equal((await source.api('/api/library/manage',{method:'POST',body:{kind:'bank',action:'update',target:'item',path:'bank',name:source.raw.title,group:'Package'}})).status,200);
 const exported=await source.api('/api/library/export',{method:'POST',body:{group:'Package'}});assert.equal(exported.status,200);
 const upload=async()=>{const response=await fetch('http://127.0.0.1:'+target.service.port()+'/api/library/import',{method:'POST',headers:{'Content-Type':archiveMime,'X-QuizForge-Filename':encodeURIComponent('下载的题库.qbank')},body:exported.data});assert.equal(response.status,200);return response.json();};
 const first=await upload(),second=await upload();
 assert.equal(first.group,'下载的题库');assert.equal(second.group,'下载的题库（2）');assert.equal(second.importedBanks,1);assert.equal(second.importedExtensions,1);
 assert.equal(second.needsConfirmation,undefined);
 assert.equal((await target.api('/api/library/import/commit',{method:'POST',body:{importId:'obsolete'}})).status,410);
 assert.equal((await target.api('/api/library/import/cancel',{method:'POST',body:{importId:'obsolete'}})).status,410);
 assert.equal((await target.api('/api/library/import',{method:'POST',headers:{'Content-Type':archiveMime,'X-QuizForge-Filename':'%ZZ'},body:exported.data})).status,400);
});

test('HTTP persists frozen draft layout and ink through history and restart, with legacy compatibility',async t=>{
 const {api,raw}=await fixture(t),prefix='/api/collections/bank/bank1',q=prefix+'/questions/'+raw.questions[0].id;
 const draft={schemaVersion:1,viewport:{x:30,y:50,zoom:1.25},paper:{color:'#ffffff',pattern:'plain'},strokes:[{id:'ink',color:'#334155',width:3,points:[{x:80,y:120,pressure:.5}]}],layout:{width:1280,padding:0,top:0}};
 const saved=await api(q+'/actions',{method:'POST',body:{requestId:'layout-save',revision:0,action:'whiteboard',data:{draft}}});assert.equal(saved.status,200,JSON.stringify(saved.data));assert.deepEqual(saved.data.draft,draft);assert.deepEqual((await api(q)).data.draft,draft);
 const invalid=await api(q+'/actions',{method:'POST',body:{requestId:'layout-invalid',revision:1,action:'whiteboard',data:{draft:{...draft,layout:{...draft.layout,width:0}}}}});assert.equal(invalid.status,400);assert.deepEqual((await api(q)).data.draft,draft);assert.equal((await api(q)).data.state.revision,1);
 const submitted=await api(q+'/actions',{method:'POST',body:{requestId:'layout-submit',revision:1,action:'submit',data:{answer:{selectedOptionId:raw.questions[0].data.correctOptionId}}}});assert.equal(submitted.status,200);
 const summary=(await api(prefix+'/summary')).data;
 const finished=await api(prefix+'/finish',{method:'POST',body:{requestId:'layout-finish',roundId:summary.roundId,summaryVersion:summary.summaryVersion}});assert.equal(finished.status,200);
 const records=(await api(prefix+'/history')).data.records,historyId=records[0].id;
 assert.deepEqual((await api(prefix+'/history/'+historyId)).data.questions.find(entry=>entry.payload.question.id===raw.questions[0].id).payload.draft,draft);
 const restarted=await api(prefix+'/restart',{method:'POST',body:{requestId:'layout-restart',roundId:finished.data.roundId,summaryVersion:finished.data.summaryVersion}});assert.equal(restarted.status,200);assert.equal((await api(q)).data.draft,null);
 assert.deepEqual((await api(prefix+'/history/'+historyId)).data.questions.find(entry=>entry.payload.question.id===raw.questions[0].id).payload.draft,draft);
 const legacy=structuredClone(draft);delete legacy.layout;const current=(await api(q)).data;
 const oldSave=await api(q+'/actions',{method:'POST',body:{requestId:'layout-legacy',revision:current.state.revision,action:'whiteboard',data:{draft:legacy}}});assert.equal(oldSave.status,200);assert.deepEqual((await api(q)).data.draft,legacy);
});

test('HTTP exams keep saved draft choices until hand-in and join ordinary history', async t => {
  const { api, raw } = await fixture(t), prefix = '/api/collections/bank/bank1';
  const started = await api(prefix + '/exams', { method: 'POST', body: { requestId: 'http-exam-start', durationMinutes: null } }); assert.equal(started.status, 200, JSON.stringify(started.data));
  const exam = '/api/collections/exam/' + started.data.id, qid = raw.questions[0].id;
  const saved = await api(exam + '/questions/' + qid + '/actions', { method: 'POST', body: { requestId: 'http-exam-draft', revision: 0, action: 'draft', data: { answer: { selectedOptionId: raw.questions[0].data.correctOptionId } } } }); assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal((await api(exam)).data.states[qid].status, 'draft');
  const rejected = await api(exam + '/questions/' + qid + '/actions', { method: 'POST', body: { requestId: 'http-exam-early-submit', revision: 1, action: 'submit', data: { answer: { selectedOptionId: raw.questions[0].data.correctOptionId } } } }); assert.equal(rejected.data.error.code, 'EXAM_ACTION_DISABLED');
  const finished = await api(exam + '/exam', { method: 'POST', body: {} }); assert.equal(finished.status, 200, JSON.stringify(finished.data)); assert.equal(finished.data.status, 'completed'); assert.equal(finished.data.summary.score, 1);
  const history = (await api(prefix + '/history')).data.records.find(row => row.mode === 'exam'); assert.ok(history);
  assert.equal((await api(prefix + '/history/' + history.id)).data.questions[0].payload.state.result.correct, true);
});

test('unused and malformed connections get Node default replies, so browsers retry a timed-out preconnect', async t => {
  const { service } = await fixture(t);
  service.listenerTimeouts = { headersTimeout: 300, requestTimeout: 300, connectionsCheckingInterval: 50, keepAliveTimeout: 1000 };
  const listener = service.newListener(false); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => { listener.close(resolve); listener.closeAllConnections(); }));
  const exchange = (...writes) => new Promise((resolve, reject) => {
    const socket = net.connect(listener.address().port, '127.0.0.1'), bytes = []; socket.on('data', chunk => bytes.push(chunk)); socket.on('error', reject);
    socket.on('close', () => resolve(Buffer.concat(bytes).toString())); for (const data of writes) socket.write(data);
  });
  // A browser preconnect that is never used must not look like a real 400 to the navigation that later picks it up.
  assert.match(await exchange(), /^HTTP\/1\.1 408 Request Timeout\r\n/);
  assert.match(await exchange('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Large: ' + 'a'.repeat(17 * 1024) + '\r\n\r\n'), /^HTTP\/1\.1 431 /);
  assert.match(await exchange('NOT A REQUEST\r\n\r\n'), /^HTTP\/1\.1 400 Bad Request\r\nConnection: close\r\n\r\n$/);
  const served = await exchange('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + listener.address().port + '\r\n\r\n');
  assert.match(served, /^HTTP\/1\.1 200 OK\r\n/); assert.doesNotMatch(served, /HTTP\/1\.1 4\d\d/);
});
