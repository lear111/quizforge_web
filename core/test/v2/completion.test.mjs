import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

async function setup(t, count = 6) {
  const fixture = createReadFixture({ count }); t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start(); t.after(() => server.close());
  const api = async (route, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.port()}` + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, text, value: JSON.parse(text) };
  };
  const catalog = await api('/api/v2/catalog'), base = '/api/v2/banks/' + catalog.value.groups[0].items[0].bankId;
  const opened = (await api(base + '/overview')).value, snapshotId = opened.snapshotId;
  const store = server.library.stateStore, snapshot = server.library.opened.get(opened.bank.bankId);
  let seq = 0;
  const answer = (id, answered = true, value = { selected: '乙' }) => api(`${base}/questions/${id}/answer`, { requestId: 'a' + ++seq, snapshotId, expectedRevision: store.get(snapshot, id).revision, answer: value, answered }, 'PUT');
  const finish = (requestId = 'finish') => api(base + '/finish', { requestId, snapshotId });
  const results = rows => api(base + '/results', { requestId: 'batch', snapshotId, results: rows }, 'PUT');
  const row = (id, result = { score: 2, parts: null, message: null }) => {
    const old = store.get(snapshot, id); return { questionId: id, submissionId: old.submissionId, expectedRevision: old.revision, result };
  };
  return { fixture, server, api, base, snapshotId, store, snapshot, answer, finish, results, row };
}

test('finish atomically locks the latest saved answers, zeros cleared/unseen questions, and batch results update exact totals', async t => {
  const { fixture, api, base, snapshotId, store, snapshot, answer, finish, results, row } = await setup(t);
  await answer('1'); await answer('2', { p1: true }); await answer('3', false, { selected: [] });
  const before = (await api(base + '/overview')).value; assert.equal(before.completedAt, null); assert.equal(before.total.score, 0);
  const lock = await finish(); assert.equal(lock.status, 200); assert.ok(Number.isFinite(Date.parse(lock.value.completedAt)));
  assert.equal(lock.value.states.length, 6); assert.ok(lock.value.states.every(s => s.locked));
  assert.deepEqual(lock.value.pendingGrading.map(p => p.question.questionId), ['1', '2']);
  assert.equal(lock.value.states.find(s => s.questionId === '3').score, 0);
  for (const id of ['3', '4', '5', '6']) assert.equal(store.get(snapshot, id).status, 'wrong');
  assert.deepEqual(store.get(snapshot, '3').answer, { selected: [] });
  assert.deepEqual(lock.value.total, { score: 0, maxScore: 10.3 });
  assert.match(lock.text, new RegExp(SOLUTION_MARKER));
  const rows = [row('1'), row('2', { score: 0.1, parts: { p1: 0.1, p2: 0 }, message: null })];
  const scored = await results(rows); assert.equal(scored.status, 200); assert.deepEqual(scored.value.total, { score: 2.1, maxScore: 10.3 });
  assert.deepEqual(store.get(snapshot, '2').status, { p1: 'correct', p2: 'wrong' });
  const bytes = fs.readFileSync(store.file(fixture.directory));
  assert.equal((await results(rows)).status, 200); assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
  const again = await finish(); assert.equal(again.status, 200); assert.equal(again.value.completedAt, lock.value.completedAt);
  assert.deepEqual(again.value.total, scored.value.total); assert.deepEqual(again.value.pendingGrading, []);
  assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
  // Owner chose latest saved data, not an overview captured in another tab.
  assert.equal(snapshotId, before.snapshotId);
});

test('completed rounds reject answer/submit/retry including receipt replay, but permit independent ink and score corrections', async t => {
  const { api, base, snapshotId, store, snapshot, answer, finish } = await setup(t);
  const saved = await answer('1'); await finish();
  for (const [op, method, input] of [
    ['answer', 'PUT', { answer: { selected: '甲' }, answered: true }], ['submit', 'POST', { answer: { selected: '甲' } }], ['retry', 'POST', {}]
  ]) {
    const response = await api(`${base}/questions/1/${op}`, { requestId: 'new-' + op, snapshotId, expectedRevision: store.get(snapshot, '1').revision, ...input }, method);
    assert.equal(response.status, 409); assert.equal(response.value.error.code, 'ROUND_COMPLETED'); assert.doesNotMatch(response.text, new RegExp(SOLUTION_MARKER));
  }
  const replay = await api(`${base}/questions/1/answer`, { requestId: 'a1', snapshotId, expectedRevision: 0, answer: { selected: '乙' }, answered: true }, 'PUT');
  assert.equal(replay.status, 409); assert.equal(replay.value.error.code, 'ROUND_COMPLETED');
  const old = store.get(snapshot, '1');
  const ink = await api(`${base}/questions/1/ink`, { requestId: 'ink', snapshotId, expectedInkRevision: 0, ink: { version: 1, strokes: [] } }, 'PUT'); assert.equal(ink.status, 200);
  const corrected = await api(`${base}/questions/1/result`, { requestId: 'correct', snapshotId, expectedRevision: old.revision, submissionId: old.submissionId, source: 'grader', result: { score: 1, parts: null, message: null } }, 'PUT');
  assert.equal(corrected.status, 200); assert.equal(corrected.value.result.score, 1); assert.deepEqual(corrected.value.answer, saved.value.answer);
  assert.equal((await api(base + '/overview')).value.total.score, 1);
});

test('finish write failure discloses no solution and leaves old frozen state and bytes untouched; same request can retry', async t => {
  const { fixture, store, snapshot, answer, finish } = await setup(t); await answer('1');
  const old = store.load(fixture.directory), expected = jsonBytes(old), file = store.file(fixture.directory), bytes = fs.readFileSync(file), write = store.write;
  store.write = () => { throw Error('injected'); };
  const failed = await finish(); assert.equal(failed.status, 503); assert.equal(failed.value.error.code, 'STATE_WRITE_FAILED'); assert.doesNotMatch(failed.text, new RegExp(SOLUTION_MARKER));
  assert.equal(store.load(fixture.directory), old); assert.ok(jsonBytes(old).equals(expected)); assert.ok(fs.readFileSync(file).equals(bytes));
  store.write = write; assert.equal((await finish()).status, 200); assert.ok(jsonBytes(old).equals(expected)); assert.ok(Object.isFrozen(store.get(snapshot, '1')));
});

test('batch rejects duplicate IDs, stale lock/revision, invalid middle result and failed write without partially changing disk or cache', async t => {
  const { fixture, store, answer, finish, results, row } = await setup(t);
  await answer('1'); await answer('2', { p1: true }); await finish();
  const rows = [row('1'), row('2', { score: 0.3, parts: { p1: 0.1, p2: 0.2 }, message: null })];
  const old = store.load(fixture.directory), bytes = fs.readFileSync(store.file(fixture.directory)), snapshot = jsonBytes(old);
  for (const candidate of [[...rows, rows[0]], [rows[0], { ...rows[1], submissionId: 'old' }], [rows[0], { ...rows[1], expectedRevision: 999 }], [rows[0], { ...rows[1], result: { score: 1000, parts: null, message: null } }]]) {
    const bad = await results(candidate); assert.ok([400, 409, 422].includes(bad.status));
    assert.equal(store.load(fixture.directory), old); assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
  }
  const write = store.write; store.write = () => { throw Error('injected'); }; assert.equal((await results(rows)).status, 503); store.write = write;
  assert.equal(store.load(fixture.directory), old); assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
  assert.equal((await results(rows)).status, 200); assert.ok(jsonBytes(old).equals(snapshot));
  assert.equal((await results([{ ...rows[0], result: { score: 1, parts: null, message: null } }, rows[1]])).value.error.code, 'REQUEST_CONFLICT');
});

test('reopening completed state keeps summary and pending grading; completion is cleared on content change but archived files are untouched', async t => {
  const { fixture, api, base, store, answer, finish } = await setup(t); await answer('1'); const locked = await finish();
  const second = await new V2Server(fixture).start(); t.after(() => second.close());
  const opened = await fetch(`http://127.0.0.1:${second.port()}${base}/overview`).then(r => r.json());
  assert.equal(opened.completedAt, locked.value.completedAt); assert.equal(opened.pendingGrading.length, 1);
  const archived = path.join(fixture.directory, '.qf-v2', 'rounds', 'synthetic', 'state.json'); writeFixtureFile(archived, 'archived-marker');
  fixture.bank.title = 'content changed'; writeFixtureFile(fixture.bankFile, fixture.bank);
  const changed = await api(base + '/overview'); assert.equal(changed.status, 200); assert.equal(changed.value.activeCleared, true); assert.equal(changed.value.completedAt, null); assert.ok(changed.value.states.every(s => !s.locked));
  assert.equal(fs.readFileSync(archived, 'utf8'), 'archived-marker'); assert.equal(store.load(fixture.directory).completedAt ?? null, null);
});

test('pre-existing grades and pending submitted answers survive finish; empty banks finish idempotently', async t => {
  const { api, base, snapshotId, store, snapshot, finish } = await setup(t);
  const locked = await api(`${base}/questions/1/submit`, { requestId: 'submit', snapshotId, expectedRevision: 0, answer: { selected: '乙' } }); assert.equal(locked.status, 200);
  const graded = await api(`${base}/questions/1/result`, { requestId: 'score', snapshotId, expectedRevision: locked.value.state.revision, submissionId: locked.value.submissionId, source: 'grader', result: { score: 2, parts: null, message: null } }, 'PUT');
  const original = store.get(snapshot, '1'); const completed = await finish(); assert.equal(completed.status, 200); assert.equal(store.get(snapshot, '1'), original); assert.equal(completed.value.total.score, 2); assert.equal(graded.status, 200);
  const empty = await setup(t, 0); assert.equal((await empty.finish()).status, 200); assert.deepEqual((await empty.finish()).value.total, { score: 0, maxScore: 0 });
});
