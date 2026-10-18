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
const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), base = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
async function fixture(t, options = {}) {
  safeDirectory(base, true); const root = fs.mkdtempSync(path.join(base, 'http-')); fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  const extension = path.join(root, 'extensions', 'choice'); fs.cpSync(path.join(codeRoot, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), extension, { recursive: true });
  const raw = readJson(path.join(extension, readJson(path.join(extension, 'manifest.json')).examples)); raw.id = 'bank1'; raw.features = { history: options.history ?? true };
  fs.writeFileSync(path.join(root, 'question-banks', 'bank.json'), jsonBytes(raw));
  const service = await QuizForgeServer.create({ root, codeRoot, port: 0, token: options.token ?? null, tailscale: options.tailscale ?? { read: async () => ({ state: 'missing' }) } }); service.engine.validationEnvironment = async () => 'http-fixture'; options.beforeStart?.(service); await service.start();
  t.after(async () => { await service.close(); assert.ok(within(base, root) && root !== base); fs.rmSync(root, { recursive: true, force: true }); });
  const api = async (uri, { method = 'GET', body, headers = {}, port = service.port() } = {}) => {
    const response = await fetch('http://127.0.0.1:' + port + uri, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { root, service, api, raw };
}
const rawGet = (port, uri, headers = {}) => new Promise((resolve, reject) => { const request = http.get({ host: '127.0.0.1', port, path: uri, headers }, response => { const bytes = []; response.on('data', chunk => bytes.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, data: Buffer.concat(bytes).toString() })); }); request.on('error', reject); });

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
  const file = path.join(root, 'question-banks', 'bank.json'), edited = readJson(file); edited.title = 'Edited outside QuizForge'; fs.writeFileSync(file, jsonBytes(edited));
  scans = 0; const reloaded = await api('/api/collections/bank/bank1');
  assert.equal(reloaded.data.title, 'Edited outside QuizForge'); assert.ok(scans > 0, 'A changed bank goes through the full loader');
});
test('startup and metadata do not validate unopened banks; opening validates only the selected bank', async t => {
  const operations=[];
  const { api, service, root, raw }=await fixture(t,{beforeStart(service){const run=service.engine.run.bind(service.engine);service.engine.run=(extension,input)=>{operations.push(input.op);return run(extension,input);};}});
  const other=structuredClone(raw);other.id='bank2';other.questions[0].data={};
  fs.writeFileSync(path.join(root,'question-banks','other.json'),jsonBytes(other));
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

test('HTTP group export and import transport the native qbank stream and installed versions', async t => {
  const { api, root, raw } = await fixture(t); fs.renameSync(path.join(root, 'question-banks', 'bank.json'), path.join(root, 'question-banks', 'bank1.json'));
  assert.equal((await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'create', target: 'group', name: 'HTTP Group' } })).status, 200);
  const moved = await api('/api/library/manage', { method: 'POST', body: { kind: 'bank', action: 'update', target: 'item', path: 'bank1.json', name: raw.title, group: 'HTTP Group' } }); assert.equal(moved.status, 200, JSON.stringify(moved.data));
  const archive = await api('/api/library/export', { method: 'POST', body: { group: 'HTTP Group' } }); assert.equal(archive.status, 200); assert.equal(archive.headers.get('content-type'), archiveMime); assert.ok(archive.headers.get('content-disposition').includes('.qbank'));
  const other = await fixture(t); fs.unlinkSync(path.join(other.root, 'question-banks', 'bank.json')); fs.rmSync(path.join(other.root, 'extensions', 'choice'), { recursive: true }); other.service.library.invalidate();
  const response = await fetch('http://127.0.0.1:' + other.service.port() + '/api/library/import', { method: 'POST', headers: { 'Content-Type': archiveMime }, body: archive.data });
  const imported = await response.json(); assert.equal(response.status, 200, JSON.stringify(imported)); assert.equal(imported.importedBanks, 1); assert.equal(imported.importedExtensions, 1);
  assert.equal((await other.api('/api/collections/bank/bank1')).status, 200);
});
test('HTTP v2 import previews version choices and commits only the confirmed plan',async t=>{
 const source=await fixture(t),target=await fixture(t),bankId='18a9f141-87f4-4772-8d9e-5471998828cc';
 const raw={...source.raw,id:bankId,version:'1.0'};fs.writeFileSync(path.join(source.root,'question-banks/bank.json'),jsonBytes(raw));source.service.library.invalidate();
 await source.api('/api/library/manage',{method:'POST',body:{kind:'bank',action:'create',target:'group',name:'Package v2'}});
 assert.equal((await source.api('/api/library/manage',{method:'POST',body:{kind:'bank',action:'update',target:'item',path:'bank.json',name:raw.title,group:'Package v2'}})).status,200);
 const exported=await source.api('/api/library/export',{method:'POST',body:{group:'Package v2'}});assert.equal(exported.status,200);
 const upload=async()=>{const response=await fetch('http://127.0.0.1:'+target.service.port()+'/api/library/import',{method:'POST',headers:{'Content-Type':archiveMime},body:exported.data});assert.equal(response.status,200);return response.json();};
 assert.equal((await upload()).importedBanks,1);
 const plan=await upload();assert.equal(plan.needsConfirmation,true);assert.equal(plan.conflicts[0].incomingVersion,'1.0');assert.equal(plan.conflicts[0].existingVersion,'1.0');
 const committed=await target.api('/api/library/import/commit',{method:'POST',body:{importId:plan.importId,choices:{[bankId]:'keep'}}});assert.equal(committed.status,200);assert.equal(committed.data.skippedBanks,1);
 const repeated=await target.api('/api/library/import/commit',{method:'POST',body:{importId:plan.importId,choices:{[bankId]:'keep'}}});assert.equal(repeated.status,410);
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
