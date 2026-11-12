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
  return { fixture, server, api, bankId, base, snapshotId, submit, result };
}
test('submit persists before releasing solution, locks the opaque answer, replays idempotently and stores validated results', async t => {
  const { server, api, base, snapshotId, submit, result, fixture, bankId } = await setup(t);
  const before = await api(`${base}/questions/1?snapshotId=${snapshotId}`); assert.doesNotMatch(before.text, new RegExp(SOLUTION_MARKER));
  const locked = await submit(); assert.equal(locked.status, 200); assert.equal(locked.value.state.locked, true); assert.equal(locked.value.state.answerVersion, 1); assert.equal(locked.value.state.status, 'submitted-pending'); assert.match(locked.text, new RegExp(SOLUTION_MARKER + '_1'));
  const file = server.library.stateStore.file(bankId), bytes = fs.readFileSync(file);
  assert.deepEqual((await submit()).value, locked.value); assert.ok(fs.readFileSync(file).equals(bytes));
  for (const extra of [{ requestId: 'new', expectedRevision: 1 }, { answer: 'changed' }]) {
    const refused = await submit('1', extra); assert.equal(refused.status, 409); assert.doesNotMatch(refused.text, new RegExp(SOLUTION_MARKER));
  }
  const graded = await result(locked.value); assert.equal(graded.status, 200); assert.equal(graded.value.state.score, 2); assert.equal(graded.value.state.revision, 2);
  const replay = await result(locked.value); assert.deepEqual(replay.value, graded.value);
  const wrongLock = await result(locked.value, { requestId: 'different', submission: { ...locked.value.submission, answerVersion: 99 } }); assert.equal(wrongLock.status, 409);
  const another = await api(`${base}/questions/2?snapshotId=${snapshotId}`); assert.doesNotMatch(another.text, new RegExp(SOLUTION_MARKER));
  const sourceAsset = graded.value.resources.find(r => r.reference.endsWith('solution.txt')).assetId;
  assert.match((await fetch(`http://127.0.0.1:${server.port()}${base}/questions/1/assets/${sourceAsset}?snapshotId=${snapshotId}`)).headers.get('content-type'), /text|octet-stream/);
  const restarted = await new V2Server(fixture).start(); t.after(() => restarted.close());
  const open = await fetch(`http://127.0.0.1:${restarted.port()}${base}/overview`).then(r => r.json()); assert.equal(open.initial.question.state.score, 2); assert.deepEqual(open.initial.question.answer, { selected: '乙' });
});
test('failed atomic writes preserve both old frozen objects and disk, do not disclose solution, and allow same-ID retry', async t => {
  const { server, submit, bankId, result } = await setup(t), store = server.library.stateStore;
  const old = store.load(bankId), oldBytes = jsonBytes(old), write = store.write;
  store.write = () => { throw Error('injected write failure'); };
  const failed = await submit(); assert.equal(failed.status, 503); assert.doesNotMatch(failed.text, new RegExp(SOLUTION_MARKER)); assert.equal(store.load(bankId), old); assert.ok(jsonBytes(old).equals(oldBytes)); assert.equal(fs.existsSync(store.file(bankId)), false);
  store.write = write; const saved = await submit(); assert.equal(saved.status, 200);
  const locked = store.load(bankId), disk = fs.readFileSync(store.file(bankId)); assert.ok(Object.isFrozen(locked.questions['1'].answer));
  store.write = () => { throw Error(); }; assert.equal((await result(saved.value)).status, 503); assert.equal(store.load(bankId), locked); assert.ok(fs.readFileSync(store.file(bankId)).equals(disk)); assert.ok(jsonBytes(old).equals(oldBytes));
  store.write = write; assert.equal((await result(saved.value)).status, 200); assert.ok(jsonBytes(locked).equals(disk));
});
test('concurrent submissions are serialized, origin and stale snapshots cannot submit, and solution-only asset IDs cannot be guessed before lock', async t => {
  const { server, api, base, snapshotId, submit } = await setup(t);
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
  const { fixture, server, api, base, bankId, submit } = await setup(t); await submit();
  const original = server.library.stateStore.load(bankId);
  fs.appendFileSync(path.join(fixture.directory, 'assets', 'figure.png'), 'x');
  fixture.bank.listening.https.title = 'new title'; writeFixtureFile(fixture.bankFile, fixture.bank); fs.appendFileSync(path.join(fixture.extension, 'practice.js'), '\n// external edit');
  assert.equal((await api(base + '/overview')).value.initial.question.state.locked, true); assert.equal(server.library.stateStore.load(bankId), original);
  fixture.bank.questions['1'].solution.explanation = 'changed'; writeFixtureFile(fixture.bankFile, fixture.bank);
  const changed = await api(base + '/overview'); assert.equal(changed.value.initial.question.state.locked, false); assert.equal(changed.value.initial.question.solution, null); assert.deepEqual(server.library.stateStore.load(bankId).historyIndex, []);
  const newSnapshot = changed.value.snapshotId; await submit('1', { requestId: 'again', snapshotId: newSnapshot });
  fixture.bank.outline[0].items[0].maxScore = 3; writeFixtureFile(fixture.bankFile, fixture.bank); assert.equal((await api(base + '/overview')).value.states[0].locked, false);
});
test('32 MiB cap refuses the entire candidate without committing; unreadable records never get overwritten', async t => {
  const { fixture, server, bankId, submit } = await setup(t), store = server.library.stateStore;
  const old = store.load(bankId), candidate = { ...old, extra: 'x'.repeat(STATE_BYTES) };
  assert.throws(() => store.commit(bankId, candidate), error => error.code === 'STATE_SIZE_LIMIT'); assert.equal(store.load(bankId), old); assert.equal(fs.existsSync(store.file(bankId)), false);
  writeFixtureFile(store.file(bankId), '{bad'); store.loaded.clear(); const failed = await submit(); assert.equal(failed.status, 503); assert.equal(fs.readFileSync(store.file(bankId), 'utf8'), '{bad');
  assert.equal(fs.existsSync(path.join(fixture.root, '.state')), false);
});
test('maximum request nesting can be reloaded through the deeper persistence envelope', async t => {
  const { server, bankId, submit } = await setup(t), store = server.library.stateStore;
  let answer = { selected: '乙' }; for (let i = 0; i < 59; i++) answer = { nested: answer };
  assert.equal((await submit('1', { answer })).status, 200);
  const reloaded = new PracticeState(store.root);
  assert.deepEqual(reloaded.load(bankId), store.load(bankId));
});
test('deterministic V2 persistence follows an independently specified state vector, with numeric answer literals retained', async t => {
  const { server, bankId, base, api, snapshotId } = await setup(t), store = server.library.stateStore;
  store.uuid = () => '00000000-0000-4000-8000-000000000001';
  const request = `{"requestId":"golden-submit","snapshotId":"${snapshotId}","expectedRevision":0,"answer":{"number":1.0}}`;
  const saved = await api(`${base}/questions/1/submit`, request); assert.equal(saved.status, 200);
  const snapshot = server.library.opened.get(bankId), fp = snapshot.questionFingerprints.get('1');
  const { fingerprint } = await import('../../server/host/platform/json.js');
  const expected = parseJson(`{"formatVersion":2,"bankId":"${bankId}","questions":{"1":{"fingerprint":"${fp}","status":"submitted-pending","revision":1,"answerVersion":1,"answer":{"number":1.0},"draft":null,"ink":null,"submission":{"submissionId":"00000000-0000-4000-8000-000000000001","answerVersion":1,"questionFingerprint":"${fp}"},"resultRevision":0,"result":null,"receipts":{"golden-submit":"${fingerprint({ op: 'submit', input: parseJson(request) }, 'quizforge-v2-receipt')}"}}},"historyIndex":[]}`);
  assert.ok(fs.readFileSync(store.file(bankId)).equals(jsonBytes(expected))); assert.match(fs.readFileSync(store.file(bankId), 'utf8'), /"number":1\.0/);
  // External callers receive clones, not borrowed frozen state.
  saved.value.answer.number = 99; assert.equal(store.get(snapshot, '1').answer.number, 1);
});
