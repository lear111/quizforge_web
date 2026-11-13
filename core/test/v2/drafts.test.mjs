import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { PracticeState } from '../../server/host/v2/state.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

async function setup(t) {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start(); t.after(() => server.close());
  const api = async (route, body, method = 'GET', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port()}${route}`, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, text, value: JSON.parse(text) };
  };
  const bankId = (await api('/api/v2/catalog')).value.groups[0].items[0].bankId, base = `/api/v2/banks/${bankId}`;
  const opened = (await api(base + '/overview')).value, snapshotId = opened.snapshotId;
  const store = server.library.stateStore, snapshot = server.library.opened.get(bankId), file = store.file(fixture.directory);
  const write = (op, input, id = '1') => api(`${base}/questions/${id}/${op}`, { snapshotId, ...input }, ['answer', 'ink', 'result'].includes(op) ? 'PUT' : 'POST');
  return { fixture, server, api, base, snapshotId, store, snapshot, file, write };
}

test('D36 answer and ink persist opaque JSON without solution; obsolete notes cannot be saved', async t => {
  const { write, api, base, snapshotId, store, fixture, file } = await setup(t);
  let saved = await write('ink', { requestId: 'ink-1', expectedInkRevision: 0, ink: { strokes: [{ points: [[1, 2]] }] } });
  assert.equal(saved.status, 200); assert.equal(saved.value.state.status, 'unanswered'); assert.equal(saved.value.state.hasSavedAnswer, false);
  saved = await write('answer', { requestId: 'notes', expectedRevision: 0, draft: ['plain', { any: true }] });
  assert.equal(saved.status, 400); assert.equal(saved.value.error.code, 'INVALID_REQUEST');
  saved = await write('answer', { requestId: 'answer', expectedRevision: 0, answer: { arbitrary: [false, 'hello', null] }, answered: true, draft: 'obsolete field is ignored' });
  assert.equal(saved.status, 200); assert.equal(saved.value.state.status, 'answered'); assert.equal(saved.value.state.hasSavedAnswer, true);
  const version = saved.value.state.revision;
  const again = await write('answer', { requestId: 'same-answer', expectedRevision: 1, answer: saved.value.answer });
  assert.equal(again.status, 200); assert.equal(again.value.state.revision, version + 1);
  const question = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  assert.deepEqual(question.value.answer, saved.value.answer); assert.equal(Object.hasOwn(question.value, 'draft'), false); assert.equal(Object.hasOwn(question.value.state, 'hasDraft'), false);
  for (const value of [saved, again, question, await api(base + '/overview')]) assert.doesNotMatch(value.text, new RegExp(SOLUTION_MARKER));
  assert.deepEqual(new PracticeState().load(fixture.directory), store.load(fixture.directory));
  assert.ok(fs.readFileSync(file).equals(jsonBytes(store.load(fixture.directory))));
});

test('raw numeric literals survive answer and ink field patches and later unrelated writes', async t => {
  const { api, base, snapshotId, file, write, store, snapshot } = await setup(t);
  const route = base + '/questions/1';
  assert.equal((await api(route + '/answer', `{"snapshotId":"${snapshotId}","requestId":"n1","expectedRevision":0,"answer":1.0,"draft":2.0}`, 'PUT')).status, 200);
  assert.equal((await api(route + '/ink', `{"snapshotId":"${snapshotId}","requestId":"n2","expectedInkRevision":0,"ink":3.0}`, 'PUT')).status, 200);
  assert.equal((await write('answer', { requestId: 'n3', expectedRevision: 0, answer: 'another question' }, '2')).status, 200);
  assert.match(fs.readFileSync(file, 'utf8'), /"answer":1\.0/); assert.match(fs.readFileSync(store.ink.file(snapshot, '1'), 'utf8'), /"ink":3\.0/); assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /"ink"/);
});

test('locked ink preserves answer revision, credential and score; notes-only and answer patches remain forbidden', async t => {
  const { write, api, base, snapshotId } = await setup(t);
  const locked = await write('submit', { requestId: 's', expectedRevision: 0, answer: { selected: '乙' } });
  const graded = await write('result', { requestId: 'g', submissionId: locked.value.submissionId, expectedRevision: locked.value.state.revision, source: 'grader', result: { score: 2, parts: null, message: null } });
  assert.equal(graded.status, 200);
  const ink = await write('ink', { requestId: 'i', expectedInkRevision: 0, ink: { strokes: [1, 2] } }); assert.equal(ink.status, 200);
  assert.deepEqual(Object.keys(ink.value).sort(), ['inkRevision', 'state']);
  const afterInk = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  const notes = await write('answer', { requestId: 'd', expectedRevision: 2, draft: 'post-submit notes' }); assert.equal(notes.status, 400);
  for (const value of [afterInk.value]) {
    assert.deepEqual(value.answer, graded.value.answer); assert.deepEqual(value.submissionId, graded.value.submissionId); assert.deepEqual(value.result, graded.value.result);
    assert.equal(value.state.revision, graded.value.state.revision); assert.equal(value.state.status, 'correct');
  }
  for (const answer of [null, graded.value.answer, {}]) assert.equal((await write('answer', { requestId: 'bad', expectedRevision: 2, answer })).value.error.code, 'ANSWER_LOCKED');
  assert.equal(afterInk.value.state.revision, 2);
});

test('retry clears active content and prior receipts while keeping the revision monotonic and rejecting old submissions/results', async t => {
  const { write, store, snapshot, file } = await setup(t);
  const draftInput = { requestId: 'd', expectedRevision: 0, answer: { selected: '乙' } };
  assert.equal((await write('answer', draftInput)).status, 200);
  assert.equal((await write('ink', { requestId: 'i', expectedInkRevision: 0, ink: 'ink' })).status, 200);
  const submission = { requestId: 's', expectedRevision: 1, answer: { selected: '乙' } };
  const locked = await write('submit', submission); assert.equal(locked.status, 200);
  const grading = { requestId: 'r', submissionId: locked.value.submissionId, expectedRevision: locked.value.state.revision, source: 'grader', result: { score: 2, parts: null, message: null } };
  assert.equal((await write('result', grading)).status, 200);
  const redo = { requestId: 'retry', expectedRevision: 3 }, retry = await write('retry', redo); assert.equal(retry.status, 200);
  assert.equal(retry.value.state.status, 'unanswered'); assert.equal(retry.value.state.hasSavedAnswer, false); assert.equal(retry.value.state.revision, 4);
  for (const key of ['answer', 'ink', 'submissionId', 'result', 'solution']) assert.equal(retry.value[key], null);
  assert.equal(Object.hasOwn(retry.value, 'draft'), false);
  assert.doesNotMatch(retry.text, new RegExp(SOLUTION_MARKER));
  assert.equal(Object.hasOwn(store.load(snapshot.directory), 'historyIndex'), false);
  assert.deepEqual(store.get(snapshot, '1').receipts.map(entry => entry.requestId), ['retry']);
  const bytes = fs.readFileSync(file); assert.equal((await write('retry', redo)).status, 200); assert.ok(fs.readFileSync(file).equals(bytes));
  for (const [op, input] of [['answer', draftInput], ['submit', submission], ['result', grading]]) { const response = await write(op, input); assert.equal(response.status, 409); assert.doesNotMatch(response.text, new RegExp(SOLUTION_MARKER)); }
  assert.ok(fs.readFileSync(file).equals(bytes));
});

test('100 sequential saves retain only four FIFO receipts and bounded state bytes; replay never grows or reorders receipts', async t => {
  const { write, store, snapshot, file } = await setup(t), sizes = [];
  for (let index = 0; index < 100; index++) {
    const response = await write('answer', { requestId: String(index).padStart(32, '0'), expectedRevision: index, answer: 'same-sized answer' });
    assert.equal(response.status, 200); assert.ok(store.get(snapshot, '1').receipts.map(entry => entry.requestId).length <= 4);
    if (index >= 9) sizes.push(fs.statSync(file).size);
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 4, JSON.stringify(sizes));
  assert.deepEqual(store.get(snapshot, '1').receipts.map(entry => entry.requestId), [96, 97, 98, 99].map(i => String(i).padStart(32, '0')));
  const bytes = fs.readFileSync(file), order = store.get(snapshot, '1').receipts.map(entry => entry.requestId);
  assert.equal((await write('answer', { requestId: String(99).padStart(32, '0'), expectedRevision: 99, answer: 'same-sized answer' })).status, 200);
  assert.deepEqual(store.get(snapshot, '1').receipts.map(entry => entry.requestId), order); assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal((await write('answer', { requestId: String(99).padStart(32, '0'), expectedRevision: 99, answer: 'different' })).value.error.code, 'REQUEST_CONFLICT');
  assert.equal((await write('answer', { requestId: String(0).padStart(32, '0'), expectedRevision: 0, answer: 'same-sized answer' })).value.error.code, 'REVISION_CONFLICT');
  assert.ok(fs.readFileSync(file).equals(bytes)); assert.equal(store.get(snapshot, '1').receipts.find(entry => entry.requestId === order.at(-1)).signature.length, 64);
});

test('numeric request IDs follow write order, not JavaScript integer-key enumeration', async t => {
  const { write, store, snapshot } = await setup(t);
  const ids = ['9', '1', '8', '2', '7'];
  for (let i = 0; i < ids.length; i++) assert.equal((await write('ink', { requestId: ids[i], expectedInkRevision: i, ink: [i] })).status, 200);
  assert.deepEqual(store.ink.read(snapshot, '1').receipts.map(entry => entry.requestId), ['1', '8', '2', '7']);
  assert.equal((await write('ink', { requestId: '9', expectedInkRevision: 0, ink: [0] })).value.error.code, 'REVISION_CONFLICT');
  assert.equal((await write('ink', { requestId: '8', expectedInkRevision: 2, ink: [2] })).status, 200);
});

test('answer receipts are independent of ink receipts; retry revokes old grading even after resubmission', async t => {
  const { write, store, snapshot } = await setup(t);
  await write('answer', { requestId: 'd', expectedRevision: 0, answer: 'choice' });
  await write('ink', { requestId: 'i', expectedInkRevision: 0, ink: [1] });
  const locked = await write('submit', { requestId: 's', expectedRevision: 1, answer: 'choice' });
  const score = { requestId: 'r', submissionId: locked.value.submissionId, expectedRevision: locked.value.state.revision, source: 'grader', result: { score: 2, parts: null, message: null } };
  await write('result', score);
  assert.deepEqual(store.get(snapshot, '1').receipts.map(entry => entry.requestId), ['d', 's', 'r']);
  assert.deepEqual(store.ink.read(snapshot, '1').receipts.map(entry => entry.requestId), ['i']);
  for (let i = 0; i < 4; i++) assert.equal((await write('ink', { requestId: 'later-' + i, expectedInkRevision: 1 + i, ink: [i] })).status, 200);
  assert.equal(store.get(snapshot, '1').receipts.some(entry => entry.requestId === 'r'), true);
  for (let i = 0; i < 4; i++) assert.equal((await write('result', { ...score, requestId: 'later-grade-' + i, expectedRevision: 3 + i })).status, 200);
  assert.equal(store.get(snapshot, '1').receipts.some(entry => entry.requestId === 'r'), false);
  assert.equal((await write('result', score)).value.error.code, 'RESULT_CONFLICT');
  await write('retry', { requestId: 'redo', expectedRevision: 7 });
  const second = await write('submit', { requestId: 's2', expectedRevision: 8, answer: 'new' });
  assert.equal(second.status, 200); assert.notDeepEqual(second.value.submissionId, locked.value.submissionId);
  assert.equal((await write('result', score)).value.error.code, 'SUBMISSION_STALE');
  assert.equal(store.get(snapshot, '1').result, null);
});

test('D39 recognizable legacy progress is cleared at open, not migrated, and an interrupted reset does not expose it', async t => {
  const { store, snapshot, write, file, api, base, snapshotId } = await setup(t);
  writeFixtureFile(store.ink.file(snapshot, '1'), { ink: [1], inkRevision: 1, receipts: { old: 'signature' }, receiptOrder: ['old'] });
  const legacy = { formatVersion: 2, contentFingerprint: snapshot.contentFingerprint, historyIndex: [], lastQuestionId: '1',
    questions: { '1': { status: 'drafting', revision: 1, answerVersion: 1, answer: 'old data', submission: null, resultRevision: 0, result: null,
      draft: 'old note', receipts: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['old-' + i, 'a'.repeat(64)])) } } };
  writeFixtureFile(file, legacy); const bytes = fs.readFileSync(file), writer = store.write;
  store.write = () => { throw Error('failed legacy reset'); };
  assert.equal((await api(base + '/overview')).value.error.code, 'STATE_WRITE_FAILED');
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal((await api(base + '/questions/1?snapshotId=' + snapshotId)).value.error.code, 'STATE_INVALID');
  store.write = writer;
  const opened = await api(base + '/overview');
  assert.equal(opened.status, 200); assert.equal(opened.value.activeCleared, true);
  assert.equal(opened.value.initial.question.answer, null); assert.equal(opened.value.initial.question.ink, null);
  assert.equal(fs.existsSync(store.ink.file(snapshot, '1')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { formatVersion: 2, questions: {}, contentFingerprint: snapshot.contentFingerprint, lastQuestionId: null });
  assert.equal((await write('answer', { requestId: 'new', expectedRevision: 0, answer: 'new answer' })).status, 200);
  assert.deepEqual(new PracticeState().load(snapshot.directory).questions['1'].receipts.map(entry => entry.requestId), ['new']);
});

test('D36 old development draft is ignored without rewriting; subsequent saves omit it and old endpoint is removed', async t => {
  const { write, store, snapshot, file, api, base, snapshotId } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: { number: 1 } });
  const root = JSON.parse(fs.readFileSync(file)); root.questions['1'].draft = { obsolete: 'PRIVATE_OLD_NOTE_62be' };
  writeFixtureFile(file, root); const bytes = fs.readFileSync(file);
  const open = await api(base + '/overview'); assert.equal(open.status, 200);
  const q = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  for (const r of [open, q]) assert.doesNotMatch(r.text, /PRIVATE_OLD_NOTE_62be|"draft"|"hasDraft"/);
  assert.ok(fs.readFileSync(file).equals(bytes)); assert.equal(Object.hasOwn(store.get(snapshot, '1'), 'draft'), false);
  const saved = await write('answer', { requestId: 'new', expectedRevision: 1, answer: { number: 2 } }); assert.equal(saved.status, 200);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /"draft"|PRIVATE_OLD_NOTE_62be/);
  const before = fs.readFileSync(file);
  assert.equal((await api(base + '/questions/1/draft', { snapshotId, requestId: 'old', expectedRevision: 2, answer: 'old API' }, 'PUT')).status, 501);
  assert.ok(fs.readFileSync(file).equals(before));
});

test('failed draft/ink/retry commits preserve old immutable graph, disk and receipt order, and can retry the same ID', async t => {
  const { store, snapshot, write, file } = await setup(t);
  assert.equal((await write('answer', { requestId: 'seed', expectedRevision: 0, answer: { nested: [1] } })).status, 200);
  for (const [op, fields] of [['answer', { answer: { nested: [2] } }], ['ink', { ink: { points: [1, 2] } }], ['retry', {}]]) {
    const old = store.load(snapshot.directory), before = jsonBytes(old), bytes = fs.readFileSync(file), writer = op === 'ink' ? store.ink : store, originalWrite = writer.write;
    const request = { requestId: op, ...(op === 'ink' ? { expectedInkRevision: store.ink.read(snapshot, '1').inkRevision } : { expectedRevision: store.get(snapshot, '1').revision }), ...fields };
    writer.write = () => { throw new Error('synthetic failure'); };
    const failed = await write(op, request); assert.equal(failed.value.error.code, 'STATE_WRITE_FAILED');
    assert.equal(store.load(snapshot.directory), old); assert.ok(jsonBytes(old).equals(before)); assert.ok(fs.readFileSync(file).equals(bytes));
    writer.write = originalWrite; assert.equal((await write(op, request)).status, 200);
    assert.ok(jsonBytes(old).equals(before)); assert.ok(Object.isFrozen(store.get(snapshot, '1').receipts));
  }
});

test('two concurrent drafts use revision conflict; stale snapshots, origins, bad envelopes and duplicate keys cannot write', async t => {
  const { write, api, base, snapshotId, file } = await setup(t);
  const results = await Promise.all(['one', 'two'].map(requestId => write('answer', { requestId, expectedRevision: 0, answer: requestId })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const bytes = fs.readFileSync(file);
  assert.equal((await write('answer', { requestId: 'none', expectedRevision: 1 })).value.error.code, 'INVALID_REQUEST');
  assert.equal((await write('ink', { requestId: 'none', expectedRevision: 1 })).value.error.code, 'INVALID_REQUEST');
  assert.equal((await write('retry', { requestId: 'r', expectedRevision: -1 })).value.error.code, 'REVISION_CONFLICT');
  assert.equal((await write('answer', { requestId: 'x', expectedRevision: 1, snapshotId: 'old', answer: null })).value.error.code, 'SNAPSHOT_STALE');
  const route = base + '/questions/1/ink';
  assert.equal((await api(route, { requestId: 'cross', snapshotId, expectedRevision: 1, ink: [] }, 'PUT', { Origin: 'https://example.test' })).status, 403);
  assert.equal((await api(route, '{"requestId":"a","requestId":"b"}', 'PUT')).status, 400);
  assert.ok(fs.readFileSync(file).equals(bytes));
});

test('reopening observes external record deletion, edit and replacement at the same bank path without relying on process restart', async t => {
  const { write, api, base, snapshotId, fixture, file, store } = await setup(t);
  await write('submit', { requestId: 's', expectedRevision: 0, answer: { selected: '乙' } });
  const lockedBytes = fs.readFileSync(file);
  fs.rmSync(path.dirname(file), { recursive: true });
  assert.equal((await api(`${base}/questions/1?snapshotId=${snapshotId}`)).value.state.locked, true, 'D7 does not require a disk check on every question GET');
  let opened = await api(base + '/overview'); assert.equal(opened.value.initial.question.state.locked, false); assert.equal(opened.value.initial.question.solution, null);
  writeFixtureFile(file, lockedBytes); opened = await api(base + '/overview'); assert.equal(opened.value.initial.question.state.locked, true);
  const replacement = path.join(fixture.root, 'replacement.json');
  writeFixtureFile(replacement, { formatVersion: 2, questions: {} }); fs.renameSync(replacement, file);
  opened = await api(base + '/overview'); assert.equal(opened.value.initial.question.state.status, 'unanswered');
  const unchanged = store.load(fixture.directory); await api(base + '/overview'); assert.equal(store.load(fixture.directory), unchanged);
});

test('a newly corrupt record invalidates the cache and blocks later writes without replacing the damaged bytes', async t => {
  const { write, api, base, file } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  writeFixtureFile(file, '{broken');
  assert.equal((await api(base + '/overview')).value.error.code, 'STATE_INVALID');
  assert.equal((await write('answer', { requestId: 'later', expectedRevision: 1, answer: 'must not overwrite' })).value.error.code, 'STATE_INVALID');
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('an external deletion or replacement immediately after commit cannot be paired with the candidate cache identity', async t => {
  const { write, store, api, base } = await setup(t), writer = store.write;
  for (const replace of [false, true]) {
    store.write = (file, bytes) => {
      writer(file, bytes);
      if (replace) writer(file, jsonBytes({ formatVersion: 2, questions: {} }));
      else fs.rmSync(file);
    };
    assert.equal((await write('submit', { requestId: 's-' + replace, expectedRevision: 0, answer: 'must be forgotten' })).status, 200);
    store.write = writer;
    const reopened = await api(base + '/overview');
    assert.equal(reopened.value.initial.question.state.locked, false); assert.equal(reopened.value.initial.question.answer, null);
  }
});

test('explicit refresh rechecks state and content, reports changes, keeps requested position and rejects stale expectations', async t => {
  const { fixture, write, api, base, snapshotId } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  fixture.bank.questions['1'].solution.explanation = 'new solution'; writeFixtureFile(fixture.bankFile, fixture.bank);
  const refreshed = await api(base + '/refresh', { expectedSnapshotId: snapshotId, questionId: '3' }, 'POST');
  assert.equal(refreshed.status, 200); assert.equal(refreshed.value.initial.question.questionId, '3');
  assert.deepEqual(refreshed.value.changes.activeCleared, true); assert.equal(refreshed.value.states[0].status, 'unanswered');
  assert.doesNotMatch(refreshed.text, /new solution/);
  assert.equal((await api(base + '/refresh', { expectedSnapshotId: snapshotId }, 'POST')).value.error.code, 'SNAPSHOT_STALE');
  assert.equal((await write('answer', { requestId: 'old', expectedRevision: 1, answer: 'old' })).value.error.code, 'SNAPSHOT_STALE');
});

test('refresh falls back only for a removed question and a failed clearing write never publishes the candidate snapshot', async t => {
  const { fixture, write, api, base, snapshotId, store, server, snapshot, file } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  const before = fs.readFileSync(file), writer = store.write;
  delete fixture.bank.questions['1'];
  fixture.bank.outline[0].items = fixture.bank.outline[0].items.filter(item => item.id !== '1');
  writeFixtureFile(fixture.bankFile, fixture.bank);
  store.write = () => { throw new Error('synthetic clearing failure'); };
  const failed = await api(base + '/refresh', { expectedSnapshotId: snapshotId, questionId: '1' }, 'POST');
  assert.equal(failed.value.error.code, 'STATE_WRITE_FAILED'); assert.equal(server.library.opened.get(snapshot.bankId), snapshot);
  assert.ok(fs.readFileSync(file).equals(before));
  store.write = writer;
  const refreshed = await api(base + '/refresh', { expectedSnapshotId: snapshotId, questionId: '1' }, 'POST');
  assert.equal(refreshed.status, 200); assert.equal(refreshed.value.initial.question.questionId, '2');
  assert.deepEqual(refreshed.value.changes.removedQuestionIds, ['1']); assert.deepEqual(refreshed.value.changes.activeCleared, true);
});
