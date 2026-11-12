import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { PracticeState, STATE_BYTES, validateResult } from '../../server/host/v2/state.js';
import { jsonBytes, parseJson } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

async function setup(t) {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start(); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route, body, method = 'POST', headers = {}) => {
    const response = await fetch(origin + route, body === undefined ? { headers } : { method, headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, text, value: JSON.parse(text) };
  };
  const catalog = await api('/api/v2/catalog'), bankId = catalog.value.groups[0].items[0].bankId, base = `/api/v2/banks/${bankId}`;
  const opened = await api(base + '/overview'), snapshotId = opened.value.snapshotId;
  const submit = (id = '1', extra = {}) => api(`${base}/questions/${id}/submit`, { requestId: 's' + id, snapshotId, expectedRevision: 0, answer: { selected: '乙' }, ...extra });
  const result = (saved, extra = {}) => api(`${base}/questions/${saved.questionId}/result`, { requestId: 'r' + saved.questionId, snapshotId, submission: saved.submission, expectedResultRevision: 0, source: 'grader', result: { status: 'graded', score: 2, feedback: '正确' }, ...extra }, 'PUT');
  return { fixture, directory: fixture.directory, server, api, bankId, base, snapshotId, submit, result };
}
test('submit persists before releasing solution, locks the opaque answer, replays idempotently and stores validated results', async t => {
  const { directory, server, api, base, snapshotId, submit, result, fixture, bankId } = await setup(t);
  const before = await api(`${base}/questions/1?snapshotId=${snapshotId}`); assert.doesNotMatch(before.text, new RegExp(SOLUTION_MARKER));
  const locked = await submit(); assert.equal(locked.status, 200); assert.equal(locked.value.state.locked, true); assert.equal(locked.value.state.answerVersion, 1); assert.equal(locked.value.state.status, 'submitted-pending'); assert.match(locked.text, new RegExp(SOLUTION_MARKER + '_1'));
  const file = server.library.stateStore.file(directory), bytes = fs.readFileSync(file);
  const pending = await api(base + '/overview'); assert.equal(pending.value.pendingGrading.length, 1); assert.deepEqual(pending.value.pendingGrading[0].question.submission, locked.value.submission);
  assert.deepEqual((await submit()).value, locked.value); assert.ok(fs.readFileSync(file).equals(bytes));
  for (const extra of [{ requestId: 'new', expectedRevision: 1 }, { answer: 'changed' }]) {
    const refused = await submit('1', extra); assert.equal(refused.status, 409); assert.doesNotMatch(refused.text, new RegExp(SOLUTION_MARKER));
  }
  const graded = await result(locked.value); assert.equal(graded.status, 200); assert.equal(graded.value.state.score, 2); assert.equal(graded.value.state.revision, 2);
  assert.deepEqual((await api(base + '/overview')).value.pendingGrading, []);
  const replay = await result(locked.value); assert.deepEqual(replay.value, graded.value);
  const wrongLock = await result(locked.value, { requestId: 'different', submission: { ...locked.value.submission, answerVersion: 99 } }); assert.equal(wrongLock.status, 409);
  const another = await api(`${base}/questions/2?snapshotId=${snapshotId}`); assert.doesNotMatch(another.text, new RegExp(SOLUTION_MARKER));
  const sourceAsset = graded.value.resources.find(r => r.reference.endsWith('solution.txt')).assetId;
  assert.match((await fetch(`http://127.0.0.1:${server.port()}${base}/questions/1/assets/${sourceAsset}?snapshotId=${snapshotId}`)).headers.get('content-type'), /text|octet-stream/);
  const restarted = await new V2Server(fixture).start(); t.after(() => restarted.close());
  const open = await fetch(`http://127.0.0.1:${restarted.port()}${base}/overview`).then(r => r.json()); assert.equal(open.initial.question.state.score, 2); assert.deepEqual(open.initial.question.answer, { selected: '乙' });
});
test('failed atomic writes preserve both old frozen objects and disk, do not disclose solution, and allow same-ID retry', async t => {
  const { directory, server, submit, bankId, result } = await setup(t), store = server.library.stateStore;
  const old = store.load(directory), oldBytes = jsonBytes(old), write = store.write;
  store.write = () => { throw Error('injected write failure'); };
  const failed = await submit(); assert.equal(failed.status, 503); assert.doesNotMatch(failed.text, new RegExp(SOLUTION_MARKER)); assert.equal(store.load(directory), old); assert.ok(jsonBytes(old).equals(oldBytes)); assert.equal(fs.existsSync(store.file(directory)), false);
  store.write = write; const saved = await submit(); assert.equal(saved.status, 200);
  const locked = store.load(directory), disk = fs.readFileSync(store.file(directory)); assert.ok(Object.isFrozen(locked.questions['1'].answer));
  store.write = () => { throw Error(); }; assert.equal((await result(saved.value)).status, 503); assert.equal(store.load(directory), locked); assert.ok(fs.readFileSync(store.file(directory)).equals(disk)); assert.ok(jsonBytes(old).equals(oldBytes));
  store.write = write; assert.equal((await result(saved.value)).status, 200); assert.ok(jsonBytes(locked).equals(disk));
});
test('concurrent submissions are serialized, origin and stale snapshots cannot submit, and solution-only asset IDs cannot be guessed before lock', async t => {
  const { directory, server, api, base, snapshotId, submit } = await setup(t);
  const [a, b] = await Promise.all([submit('1', { requestId: 'a' }), submit('1', { requestId: 'b' })]); assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const bad = await api(`${base}/questions/2/submit`, { snapshotId, requestId: 'x', expectedRevision: 0, answer: {} }, 'POST', { Origin: 'https://example.test' }); assert.equal(bad.status, 403);
  const stale = await submit('3', { snapshotId: 'outdated' }); assert.equal(stale.status, 409); assert.doesNotMatch(stale.text, new RegExp(SOLUTION_MARKER));
  const { hash } = await import('../../server/host/platform/json.js');
  const assetId = hash(Buffer.from('2\0qf-asset:assets/solution.txt'));
  const response = await fetch(`http://127.0.0.1:${server.port()}${base}/questions/2/assets/${assetId}?snapshotId=${snapshotId}`); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), new RegExp(SOLUTION_MARKER));
  assert.equal((await api(`${base}/questions/3/submit`, '{"requestId":"x","requestId":"y"}')).status, 400);
});
test('result validation covers exact decimal parts, missing/duplicate/foreign parts, range, nonnumeric and pending results', () => {
  const item = { id: '2', parts: [{ id: 'a', maxScore: 0.1 }, { id: 'b', maxScore: 0.2 }] };
  const good = { status: 'graded', score: 0.3, outlineScores: [{ id: 'a', score: 0.1 }, { id: 'b', score: 0.2 }] };
  assert.doesNotThrow(() => validateResult(item, good));
  for (const value of [{ ...good, score: '0.3' }, { ...good, score: Infinity }, { ...good, score: -1 }, { ...good, score: 0.31 }, { ...good, score: 0.2 }, { ...good, outlineScores: good.outlineScores.slice(1) }, { ...good, outlineScores: [good.outlineScores[0], good.outlineScores[0]] }, { ...good, outlineScores: [{ id: 'x', score: 0.1 }, good.outlineScores[1]] }, { ...good, outlineScores: [{ id: 'a', score: 0.2 }, { id: 'b', score: 0.1 }] }]) assert.throws(() => validateResult(item, value), e => e.code === 'INVALID_RESULT');
  for (const status of ['pending', 'ungradable']) { assert.doesNotThrow(() => validateResult(item, { status, score: null })); assert.throws(() => validateResult(item, { status, score: 0 })); }
});
test('only changing the question record or outline item clears active state on open; assets, listening and extension edits preserve it', async t => {
  const { directory, fixture, server, api, base, bankId, submit } = await setup(t); await submit();
  const original = server.library.stateStore.load(directory);
  fs.appendFileSync(path.join(fixture.directory, 'assets', 'figure.png'), 'x');
  fixture.bank.listening.https.title = 'new title'; writeFixtureFile(fixture.bankFile, fixture.bank); fs.appendFileSync(path.join(fixture.extension, 'practice.js'), '\n// external edit');
  assert.equal((await api(base + '/overview')).value.initial.question.state.locked, true); assert.equal(server.library.stateStore.load(directory), original);
  fixture.bank.questions['1'].solution.explanation = 'changed'; writeFixtureFile(fixture.bankFile, fixture.bank);
  const changed = await api(base + '/overview'); assert.equal(changed.value.initial.question.state.locked, false); assert.equal(changed.value.initial.question.solution, null); assert.deepEqual(server.library.stateStore.load(directory).historyIndex, []);
  const newSnapshot = changed.value.snapshotId; await submit('1', { requestId: 'again', snapshotId: newSnapshot });
  fixture.bank.outline[0].items[0].maxScore = 3; writeFixtureFile(fixture.bankFile, fixture.bank); assert.equal((await api(base + '/overview')).value.states[0].locked, false);
});
test('32 MiB cap refuses the entire candidate without committing; unreadable records never get overwritten', async t => {
  const { directory, fixture, server, bankId, submit } = await setup(t), store = server.library.stateStore;
  const old = store.load(directory), candidate = { ...old, extra: 'x'.repeat(STATE_BYTES) };
  assert.throws(() => store.commit(directory, candidate), error => error.code === 'STATE_SIZE_LIMIT'); assert.equal(store.load(directory), old); assert.equal(fs.existsSync(store.file(directory)), false);
  writeFixtureFile(store.file(directory), '{bad'); store.loaded.clear(); const failed = await submit(); assert.equal(failed.status, 503); assert.equal(fs.readFileSync(store.file(directory), 'utf8'), '{bad');
  assert.equal(fs.existsSync(path.join(fixture.root, '.state')), false);
});
test('maximum request nesting can be reloaded through the deeper persistence envelope', async t => {
  const { directory, server, bankId, submit } = await setup(t), store = server.library.stateStore;
  let answer = { selected: '乙' }; for (let i = 0; i < 62; i++) answer = { nested: answer };
  assert.equal((await submit('1', { answer })).status, 200);
  assert.throws(() => parseJson(fs.readFileSync(store.file(directory))), /Nesting depth limit/);
  const reloaded = new PracticeState();
  assert.deepEqual(reloaded.load(directory), store.load(directory));
});
test('deterministic V2 persistence follows an independently specified state vector, with numeric answer literals retained', async t => {
  const { directory, server, bankId, base, api, snapshotId } = await setup(t), store = server.library.stateStore;
  store.uuid = () => '00000000-0000-4000-8000-000000000001';
  const request = `{"requestId":"golden-submit","snapshotId":"${snapshotId}","expectedRevision":0,"answer":{"number":1.0}}`;
  const saved = await api(`${base}/questions/1/submit`, request); assert.equal(saved.status, 200);
  const snapshot = server.library.opened.get(bankId), fp = snapshot.questionFingerprints.get('1');
  const { fingerprint } = await import('../../server/host/platform/json.js');
  const expected = parseJson(`{"formatVersion":2,"questions":{"1":{"fingerprint":"${fp}","status":"submitted-pending","revision":1,"answerVersion":1,"answer":{"number":1.0},"draft":null,"ink":null,"submission":{"submissionId":"00000000-0000-4000-8000-000000000001","answerVersion":1,"questionFingerprint":"${fp}"},"resultRevision":0,"result":null,"receipts":{"golden-submit":"${fingerprint({ op: 'submit', input: parseJson(request) }, 'quizforge-v2-receipt')}"}}},"historyIndex":[]}`);
  assert.ok(fs.readFileSync(store.file(directory)).equals(jsonBytes(expected))); assert.match(fs.readFileSync(store.file(directory), 'utf8'), /"number":1\.0/);
  // External callers receive clones, not borrowed frozen state.
  saved.value.answer.number = 99; assert.equal(store.get(snapshot, '1').answer.number, 1);
});

test('D19 bank-local records follow rename and movement; copied banks retain progress then save independently', async t => {
  const { fixture, server, submit, result, directory, api, bankId } = await setup(t);
  const locked = await submit(); await result(locked.value);
  const stateFile = server.library.stateStore.file(directory);
  assert.equal(stateFile, path.join(directory, '.qf-v2', 'state.json'));
  const bytes = fs.readFileSync(stateFile); assert.equal(Object.hasOwn(JSON.parse(bytes), 'bankId'), false);
  const renamed = path.join(path.dirname(directory), 'renamed'); fs.renameSync(directory, renamed);
  const moved = path.join(fixture.root, 'question-banks', 'moved-group', 'moved'); fs.mkdirSync(path.dirname(moved)); fs.renameSync(renamed, moved);
  const copy = path.join(path.dirname(moved), 'copy'); fs.cpSync(moved, copy, { recursive: true });
  const rows = (await api('/api/v2/catalog')).value.groups.flatMap(group => group.items);
  assert.equal(rows.length, 2); assert.ok(rows.every(row => row.bankId !== bankId));
  const opens = await Promise.all(rows.map(row => api(`/api/v2/banks/${row.bankId}/overview`)));
  for (const open of opens) { assert.equal(open.status, 200); assert.equal(open.value.initial.question.state.score, 2); assert.equal(open.value.initial.question.state.locked, true); }
  const first = opens[0].value, firstId = first.bank.bankId;
  const saved = await api(`/api/v2/banks/${firstId}/questions/3/submit`, { requestId: 'independent', snapshotId: first.snapshotId, expectedRevision: 0, answer: { selected: '甲' } }); assert.equal(saved.status, 200);
  const other = await api(`/api/v2/banks/${opens[1].value.bank.bankId}/overview`);
  assert.equal(other.value.states.find(state => state.questionId === '3').locked, false);
  assert.ok(fs.readFileSync(server.library.stateStore.file(server.library.opened.get(other.value.bank.bankId).directory)).equals(bytes));
  assert.equal(fs.existsSync(path.join(fixture.root, '.qf-v2')), false);
});

test('D19 private records are excluded from fingerprints, file limits, question assets and local listening', async t => {
  const { fixture, server, submit, directory, api, base, snapshotId } = await setup(t);
  await submit();
  const local = path.join(directory, '.qf-v2');
  for (let i = 0; i < 1005; i++) writeFixtureFile(path.join(local, `private-${i}.json`), 'private synthetic data');
  assert.equal((await api(base + '/overview')).value.snapshotId, snapshotId);
  assert.equal((await api(base + '/overview')).value.initial.question.state.locked, true);
  const { relativeFile, treeDigest, newCache } = await import('../../server/host/v2/io.js');
  const before = treeDigest(directory, newCache());
  writeFixtureFile(path.join(local, 'not-json'), '{broken');
  assert.equal(treeDigest(directory, newCache()), before);
  for (const relative of ['.qf-v2/state.json', '.QF-V2/state.json', 'assets/.qf-v2/secret']) assert.throws(() => relativeFile(directory, relative), error => error.code === 'ASSET_PATH_INVALID');
  fixture.bank.questions['3'].question.hidden = 'qf-asset:.qf-v2/state.json'; writeFixtureFile(fixture.bankFile, fixture.bank);
  const changed = (await api(base + '/overview')).value.snapshotId;
  const badQuestion = await api(`${base}/questions/3?snapshotId=${changed}`); assert.equal(badQuestion.value.error.code, 'ASSET_PATH_INVALID'); assert.doesNotMatch(badQuestion.text, /private synthetic data/);
  const { hash } = await import('../../server/host/platform/json.js');
  const guessed = hash(Buffer.from('1\0qf-asset:.qf-v2/state.json'));
  const denied = await api(`${base}/questions/1/assets/${guessed}?snapshotId=${changed}`); assert.equal(denied.status, 404);
  fixture.bank.listening.local.src = '.qf-v2/state.json'; writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await api(base + '/overview')).value.error.code, 'ASSET_PATH_INVALID');
});
