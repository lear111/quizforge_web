import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { V2Server } from '../../server/host/v2/server.js';
import { LibrarySnapshots } from '../../server/host/v2/snapshots.js';
import { relativePath } from '../../server/host/v2/io.js';
import { createReadFixture, addFixtureExtension, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

function hashes(directory, prefix = '') {
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name), id = prefix + '/' + name;
    return fs.lstatSync(file).isDirectory() ? hashes(file, id) : [[id, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
  });
}
async function running(t, options = {}) {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const server = await new V2Server({ ...fixture, ...options }).start(); t.after(() => server.close());
  const url = `http://127.0.0.1:${server.port()}`;
  const get = async (route, init = {}) => {
    const response = await fetch(url + route, init), bytes = Buffer.from(await response.arrayBuffer()), text = bytes.toString('utf8');
    assert.ok(!text.includes(SOLUTION_MARKER), `solution leaked from ${route}`);
    return { response, bytes, text, body: response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : null };
  };
  const catalog = await get('/api/v2/catalog'), bankId = catalog.body.groups[0].items[0].bankId;
  const base = '/api/v2/banks/' + bankId;
  const open = async questionId => get(base + '/overview' + (questionId ? '?questionId=' + questionId : ''));
  return { fixture, server, get, open, bankId, base, url };
}

test('V2 entry dependency graph excludes the entire v1 rules, runner, validation and HTTP graph', async () => {
  const entry = fileURLToPath(new URL('../../server/v2-main.mjs', import.meta.url));
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent' });
  const files = Object.keys(result.metafile.inputs).map(file => file.replaceAll('\\', '/'));
  assert.ok(files.some(file => file.endsWith('/v2/server.js')));
  assert.ok(files.some(file => file.endsWith('/platform/json.js')));
  for (const file of files) assert.doesNotMatch(file, /(?:node_modules\/|rule-engine|rules-runner|validation-cache|write-environment|host\/http\/server|host\/practice\/)/);
  for (const data of Object.values(result.metafile.inputs)) for (const imported of data.imports) {
    if (imported.external) { assert.ok(imported.path.startsWith('node:'), imported.path); assert.doesNotMatch(imported.path, /child_process|worker_threads|node:vm$/); }
  }
});

test('read APIs isolate v1 data, never write files or execute author code, and never return solution', async t => {
  const { fixture, get, open, base, bankId } = await running(t);
  writeFixtureFile(path.join(fixture.root, '.state', 'network-settings.json'), 'not even valid JSON');
  writeFixtureFile(path.join(fixture.root, '.state', 'ai.json'), SOLUTION_MARKER);
  const before = hashes(fixture.root);
  const root = await get('/'); assert.match(root.text, /QuizForgeUI.mountV2App/); assert.match(root.text, /nonce=/); assert.match(root.response.headers.get('content-security-policy'), /script-src 'nonce-/);
  const scriptPolicy = root.response.headers.get('content-security-policy').split(';').find(rule => rule.trim().startsWith('script-src '));
  assert.match(scriptPolicy, /blob:/); assert.doesNotMatch(scriptPolicy, /unsafe-inline|unsafe-eval/);
  assert.equal((await get('/api/v2/health')).body.apiVersion, 2);
  const { body: overview, response } = await open(); assert.equal(response.status, 200);
  assert.equal(overview.states.length, 20); assert.equal(overview.initial.question.questionId, '1');
  assert.equal(overview.initial.question.solution, null); assert.deepEqual(overview.pendingGrading, []);
  assert.equal(overview.questionTypes.length, 20); assert.deepEqual(overview.questionTypes[0], { questionId: '1', type: 'quizforge.synthetic-choice@2' });
  assert.deepEqual(overview.listening.map(item => item.id), ['https', 'local', 'http']);
  assert.ok(overview.listening.every(item => !Object.hasOwn(item, 'src')));
  assert.equal(overview.states[1].maxScore, 0.3);
  const token = '?snapshotId=' + overview.snapshotId;
  for (let i = 1; i <= 20; i++) {
    const q = await get(base + '/questions/' + i + token); assert.equal(q.response.status, 200);
    assert.equal(q.body.solution, null); assert.equal(q.body.state.status, 'unanswered');
    assert.equal(q.body.resources.length, 1); assert.equal(q.body.resources[0].reference, 'qf-asset:assets/figure.png');
  }
  const q = overview.initial.question;
  const asset = await get(base + '/questions/1/assets/' + q.resources[0].assetId + token);
  assert.equal(asset.response.status, 200); assert.equal(asset.response.headers.get('content-type'), 'image/png');
  const hiddenAsset = createHash('sha256').update('1\0qf-asset:assets/solution.txt').digest('hex');
  assert.equal((await get(base + '/questions/1/assets/' + hiddenAsset + token)).response.status, 404);
  const local = await get(base + '/listening/local' + token, { headers: { Range: 'bytes=0-43' } });
  assert.equal(local.response.status, 206); assert.equal(local.bytes.length, 44); assert.equal(local.text.slice(0, 4), 'RIFF');
  assert.equal(local.response.headers.get('content-range'), 'bytes 0-43/2044');
  assert.equal((await get(base + '/listening/local' + token, { headers: { Range: 'bytes=99999-' } })).response.status, 416);
  assert.equal((await get(base + '/listening/local' + token, { method: 'HEAD' })).bytes.length, 0);
  for (const id of ['http', 'https']) {
    const remote = await get(base + '/listening/' + id + token); assert.equal(remote.body.kind, 'remote'); assert.match(remote.body.src, /^https?:\/\/audio.example.test\//);
  }
  assert.equal((await get(base + '/listening/ignored' + token)).response.status, 404);
  const artifact = '/api/v2/extensions/' + q.extension.artifactId;
  assert.equal((await get(artifact + '/manifest')).body.apiVersion, 2);
  for (const file of ['practice-html', 'practice-js', 'practice-css', 'grade-js']) {
    const response = await get(artifact + '/files/' + file); assert.equal(response.response.status, 200); assert.match(response.response.headers.get('content-security-policy'), /sandbox allow-scripts;/);
  }
  assert.equal((await get('/api/v2/sdk/richtext/2.0.0/sdk.js')).response.status, 200);
  assert.equal((await get('/api/v2/sdk/richtext/1.0.0/sdk.js')).response.status, 404);
  assert.equal((await get('/api/v2/extensions/unknown/manifest')).response.status, 404);
  assert.equal((await get('/api/v2/banks/unknown/overview')).response.status, 404);
  assert.equal((await get('/api/v2/banks/unknown/questions/1' + token)).response.status, 409);
  for (const route of ['/api/library', '/api/settings', '/api/ai/tasks']) assert.equal((await get(route)).response.status, 410);
  for (const route of ['/api/v2/settings/ai', base + '/position', base + '/history']) assert.equal((await get(route)).response.status, 501);
  for (const route of [base + '/questions/1/draft', base + '/finish']) assert.equal((await get(route, { method: 'POST', body: '{}' })).response.status, 501);
  // Submit is now implemented; malformed requests still cannot disclose answers.
  const rejected = await get(base + '/questions/1/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(rejected.response.status, 409); assert.doesNotMatch(rejected.text, new RegExp(SOLUTION_MARKER));
  for (const route of ['/bank.json', '/.state/ai.json', '/core/web/app.js']) assert.equal((await get(route)).response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.ok(bankId.startsWith('b_'));
  assert.deepEqual(hashes(fixture.root), before);
});

test('bad questions are lazy and isolated; unreferenced questions are ignored; part structure stays opaque', async t => {
  const { fixture, open, get, base } = await running(t);
  fixture.bank.questions['1'].question = [];
  delete fixture.bank.questions['3']; fixture.bank.questions['4'].type = 'not.installed@2';
  fixture.bank.questions['5'].solution = null;
  // Outline parts need not match question.parts: the page owns that contract.
  fixture.bank.questions['2'].question.parts = { unrelated: {} };
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const { body, response } = await open(); assert.equal(response.status, 200); assert.equal(body.states.length, 20);
  assert.equal(body.initial.error.code, 'QUESTION_INVALID'); assert.equal(body.initial.error.questionId, '1');
  const query = '?snapshotId=' + body.snapshotId;
  for (const [id, code, status] of [['1', 'QUESTION_INVALID', 422], ['3', 'QUESTION_NOT_FOUND', 404], ['4', 'EXTENSION_NOT_FOUND', 404], ['5', 'QUESTION_INVALID', 422], ['ignored', 'QUESTION_NOT_FOUND', 404]]) {
    const bad = await get(base + '/questions/' + id + query); assert.equal(bad.response.status, status); assert.equal(bad.body.error.code, code); assert.equal(bad.body.error.questionId, id);
  }
  assert.equal((await get(base + '/questions/2' + query)).response.status, 200);
});

test('outline validation rejects invalid groups, IDs, scores and listening while allowing an empty bank', async t => {
  const { fixture, open } = await running(t);
  const cases = [
    bank => { bank.formatVersion = 1; }, bank => { bank.outline = {}; }, bank => { bank.outline[0].items[1].id = '1'; },
    bank => { bank.outline[0].items[1].parts[1].id = 'p1'; }, bank => { bank.outline[0].items[1].parts = []; },
    bank => { bank.outline[0].items[1].label = 'bad'; }, bank => { delete bank.outline[0].items[0].label; },
    bank => { bank.outline[0].items[0].maxScore = 0; }, bank => { bank.outline[0].items[0].maxScore = -1; },
    bank => { bank.outline[0].items[0].maxScore = '2'; }, bank => { bank.outline[0].items[0].listening = 'missing'; },
    bank => { bank.outline[0].items[1].parts.forEach(part => { part.maxScore = 1e308; }); },
    bank => { bank.listening.https.src = 'ftp://example.test/a'; }, bank => { bank.listening.local.src = '../escape.wav'; },
    bank => { bank.features.exam = 'yes'; }
  ];
  for (const mutate of cases) {
    const bank = structuredClone(fixture.bank); mutate(bank); writeFixtureFile(fixture.bankFile, bank);
    const { body, response } = await open(); assert.equal(response.status, 422); assert.match(body.error.message, /[\u4e00-\u9fff]/);
    assert.ok(['BANK_FORMAT_UNSUPPORTED', 'BANK_STRUCTURE_INVALID', 'ASSET_PATH_INVALID'].includes(body.error.code));
    assert.ok(!JSON.stringify(body).includes(fixture.root));
  }
  writeFixtureFile(fixture.bankFile, { ...fixture.bank, outline: [{ title: '数字题号', items: [{ id: '10', label: '甲', maxScore: 1 }, { id: '2', label: '乙', maxScore: 1 }] }] });
  const ordered = (await open()).body;
  assert.deepEqual(ordered.states.map(item => item.questionId), ['10', '2']); assert.equal(ordered.initial.question.questionId, '10');
  writeFixtureFile(fixture.bankFile, { ...fixture.bank, outline: [], questions: {} });
  const empty = await open(); assert.equal(empty.response.status, 200); assert.equal(empty.body.initial.question, null); assert.deepEqual(empty.body.states, []);
});

test('strict duplicate-key and invalid JSON diagnostics expose positions, not private values', async t => {
  const { fixture, open } = await running(t);
  for (const text of ['{"title":"' + SOLUTION_MARKER + '","title":"duplicate"}', '{"formatVersion":2,"n":NaN}', '{"outline":[]']) {
    writeFixtureFile(fixture.bankFile, text);
    const bad = await open(); assert.equal(bad.response.status, 400); assert.ok(['JSON_DUPLICATE_KEY', 'JSON_INVALID'].includes(bad.body.error.code));
    assert.equal(typeof bad.body.error.details.offset, 'number'); assert.ok(bad.body.error.details.line >= 1); assert.ok(bad.body.error.details.column >= 1);
  }
});

test('extension matching uses id plus major, refuses ambiguous versions and does not pick a latest version', async t => {
  const { fixture, open } = await running(t);
  addFixtureExtension(fixture.root, { name: 'different-major', version: '3.0.0' });
  assert.equal((await open()).body.initial.question.extension.version, '2.1.0');
  const second = addFixtureExtension(fixture.root, { name: 'duplicate-major', version: '2.9.0' });
  const ambiguous = await open(); assert.equal(ambiguous.response.status, 200); assert.equal(ambiguous.body.initial.error.code, 'EXTENSION_AMBIGUOUS'); assert.equal(ambiguous.body.initial.error.details.matches, 2);
  fs.rmSync(second, { recursive: true });
  fixture.bank.questions['1'].type = 'quizforge.synthetic-choice@4'; writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'EXTENSION_NOT_FOUND');
});

test('catalog distinguishes local instances with identical source IDs and contains bad metadata to its own item', async t => {
  const { fixture, get, open, base } = await running(t);
  const second = path.join(fixture.root, 'question-banks', 'synthetic', 'second');
  fs.cpSync(fixture.directory, second, { recursive: true });
  const broken = path.join(fixture.root, 'question-banks', 'synthetic', 'broken');
  writeFixtureFile(path.join(broken, 'bank.json'), '{invalid');
  const catalog = (await get('/api/v2/catalog')).body, items = catalog.groups[0].items;
  assert.equal(items.length, 3); assert.equal(new Set(items.map(item => item.bankId)).size, 3);
  assert.equal(items.filter(item => item.sourceId === 'synthetic-bank').length, 2);
  assert.equal(items.filter(item => item.availability === 'unavailable').length, 1);
  const first = (await open()).body, secondId = items.find(item => item.bankId !== first.bank.bankId && item.availability === 'available').bankId;
  const other = (await get('/api/v2/banks/' + secondId + '/overview')).body;
  assert.notEqual(first.snapshotId, other.snapshotId);
  assert.equal((await get(base + '/questions/1?snapshotId=' + other.snapshotId)).body.error.code, 'SNAPSHOT_STALE');
  delete fixture.bank.description; delete fixture.bank.features;
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const defaults = (await open()).body.bank;
  assert.equal(defaults.description, ''); assert.deepEqual(defaults.features, { history: true, exam: true });
});

test('explicit opening detects file changes but ordinary question GET borrows the opened immutable snapshot', async t => {
  const { fixture, server, open, get, base, bankId } = await running(t);
  const first = (await open()).body, query = '?snapshotId=' + first.snapshotId;
  const oldFingerprint = server.library.opened.get(bankId).questionFingerprints.get('1');
  fixture.bank.questions['1'].question.stem = { text: 'changed' }; writeFixtureFile(fixture.bankFile, fixture.bank);
  const old = await get(base + '/questions/1' + query); assert.notDeepEqual(old.body.question.stem, { text: 'changed' });
  const next = (await open('1')).body; assert.notEqual(next.snapshotId, first.snapshotId); assert.deepEqual(next.initial.question.question.stem, { text: 'changed' });
  assert.equal((await get(base + '/questions/1' + query)).body.error.code, 'SNAPSHOT_STALE');
  assert.notEqual(server.library.opened.get(bankId).questionFingerprints.get('1'), oldFingerprint);
  const changedFingerprint = server.library.opened.get(bankId).questionFingerprints.get('1');
  writeFixtureFile(path.join(fixture.directory, 'assets', 'figure.png'), Buffer.from('different bytes'));
  fixture.bank.listening.https.src = 'https://audio.example.test/replaced.mp3'; writeFixtureFile(fixture.bankFile, fixture.bank);
  writeFixtureFile(path.join(fixture.extension, 'practice.js'), '/* different code, never executed */');
  const resourceChange = (await open('1')).body; assert.notEqual(resourceChange.snapshotId, next.snapshotId);
  assert.equal(server.library.opened.get(bankId).questionFingerprints.get('1'), changedFingerprint);
  assert.equal((await open('1')).body.snapshotId, resourceChange.snapshotId);
  // Mutating an outward payload cannot mutate the frozen source data.
  const result = server.library.question(bankId, '1', resourceChange.snapshotId); result.question.stem.text = 'caller mutation';
  assert.equal(server.library.question(bankId, '1', resourceChange.snapshotId).question.stem.text, 'changed');
});

test('normal question reads perform no directory or content checks; explicit development marking only refreshes that extension', t => {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const library = new LibrarySnapshots(fixture.root, fixture.codeRoot), bankId = library.catalog().groups[0].items[0].bankId;
  const view = library.open(bankId);
  const originalRead = fs.readdirSync, originalStat = fs.lstatSync; let reads = 0, stats = 0;
  fs.readdirSync = (...args) => { reads++; return originalRead(...args); }; fs.lstatSync = (...args) => { stats++; return originalStat(...args); };
  try { library.question(bankId, '1', view.snapshotId); } finally { fs.readdirSync = originalRead; fs.lstatSync = originalStat; }
  assert.equal(reads, 0); assert.equal(stats, 0);
  const manifestFile = path.join(fixture.extension, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile)); manifest.development = true; writeFixtureFile(manifestFile, manifest);
  const development = new LibrarySnapshots(fixture.root, fixture.codeRoot, { development: true });
  const devView = development.open(bankId), oldId = devView.initial.question.extension.artifactId;
  writeFixtureFile(path.join(fixture.extension, 'practice.js'), '/* edited dev script */');
  const updated = development.question(bankId, '1', devView.snapshotId); assert.notEqual(updated.extension.artifactId, oldId);
  assert.equal(development.artifact(updated.extension.artifactId).descriptor.artifactId, updated.extension.artifactId);
});

test('file count limit reports its lower bound and stops at 1000, without leaking filenames', async t => {
  const { fixture, open } = await running(t);
  for (let i = 0; i < 1000; i++) writeFixtureFile(path.join(fixture.directory, 'assets', `extra-${i}.dat`), 'a');
  const result = await open(); assert.equal(result.response.status, 422); assert.equal(result.body.error.code, 'FILE_COUNT_LIMIT');
  assert.deepEqual(result.body.error.details, { lowerBound: 1001, limit: 1000 }); assert.match(result.body.error.message, /至少 1001 项，上限 1000 项/);
  assert.ok(!result.text.includes('extra-'));
});

test('resources reject traversal, reserved names, redirects and cross-question access', async t => {
  const { fixture, open, get, base } = await running(t);
  for (const relative of ['../x', '/x', 'assets\\x', 'assets/x:y', 'assets/CON.png', 'assets/x.', 'assets/x ', 'assets//x', 'assets/./x', 'assets/x?query']) assert.throws(() => relativePath(fixture.directory, relative), { code: 'ASSET_PATH_INVALID' });
  const opened = (await open()).body;
  const q = opened.initial.question, token = '?snapshotId=' + opened.snapshotId;
  assert.equal((await get(base + '/questions/2/assets/' + q.resources[0].assetId + token)).response.status, 404);
  const outside = path.join(fixture.root, 'outside'); writeFixtureFile(path.join(outside, 'secret.png'), 'not public');
  const linked = path.join(fixture.directory, 'assets', 'linked');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const bad = await open(); assert.equal(bad.response.status, 422); assert.equal(bad.body.error.code, 'ASSET_PATH_INVALID');
  fs.rmSync(linked, { recursive: true }); fixture.bank.questions['1'].question.stem = 'qf-asset:../outside/secret.png'; writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'ASSET_PATH_INVALID');
  fixture.bank.questions['1'].question.stem = 'qf-asset:bank.json'; writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'ASSET_PATH_INVALID');
});

test('read-only endpoints enforce Host, Origin and fresh-token boundaries without reading old LAN settings', async t => {
  const { fixture, server, get, url } = await running(t);
  assert.equal((await get('/api/v2/health', { headers: { Origin: 'http://attacker.test' } })).response.status, 403);
  assert.equal((await get('/api/v2/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).response.status, 403);
  assert.equal((await get('/api/v2/health', { headers: { 'X-Forwarded-Host': '127.0.0.1' } })).response.status, 403);
  const rejected = await new Promise((resolve, reject) => { const request = http.get(url + '/api/v2/health', { headers: { Host: 'attacker.test:' + server.port() } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); });
  assert.equal(rejected, 403);
  const secured = await new V2Server({ ...fixture, token: 'new-token-1234' }).start(); t.after(() => secured.close());
  const endpoint = `http://127.0.0.1:${secured.port()}/api/v2/health`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { 'X-QuizForge-Token': 'new-token-1234' } })).status, 200);
  assert.throws(() => new V2Server({ ...fixture, host: '0.0.0.0' }), { code: 'AUTH_REQUIRED' });
});
