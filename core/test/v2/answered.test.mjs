import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mergeAnswered, ANSWERED_PART_LIMIT } from '../../shared/v2/answered.js';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';
const code = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/outline.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { buildV2Outline } = await import('data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64'));

async function setup(t) {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start(); t.after(() => server.close());
  const api = async (route, body, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.port()}${route}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, text, value: JSON.parse(text) };
  };
  const bankId = (await api('/api/v2/catalog')).value.groups[0].items[0].bankId, base = `/api/v2/banks/${bankId}`, overview = (await api(base + '/overview')).value;
  const write = (id, op, body) => api(`${base}/questions/${id}/${op}`, { snapshotId: overview.snapshotId, ...body }, ['submit', 'retry'].includes(op) ? 'POST' : 'PUT');
  return { fixture, server, api, bankId, base, overview, write };
}

test('answered metadata merges only known parts, rejects malformed/oversized maps, and treats prototype-shaped IDs as ordinary keys', () => {
  const item = { parts: [{ id: 'a' }, { id: 'b' }, { id: '__proto__' }] };
  assert.equal(mergeAnswered(false, {}), false);
  assert.deepEqual(mergeAnswered({ b: false, unknown: true }, item, { a: true, b: true }), { a: true, b: false });
  assert.equal(Object.hasOwn(mergeAnswered(JSON.parse('{"__proto__":true}'), item), '__proto__'), true);
  assert.equal({}.polluted, undefined);
  for (const value of [true, null, [], { a: 'true' }, Object.fromEntries(Array.from({ length: ANSWERED_PART_LIMIT + 1 }, (_, i) => ['p' + i, true]))]) assert.throws(() => mergeAnswered(value, item));
  assert.throws(() => mergeAnswered({ a: true }, {}));
});

test('outline uses per-part reported answers before lock and per-part scores after grading', () => {
  const groups = [{ title: '分组', items: [{ id: 'single', label: '1', maxScore: 2 }, { id: 'multi', parts: [{ id: 'a', label: '2', maxScore: 1 }, { id: 'b', label: '3', maxScore: 2 }] }] }];
  const buttons = states => buildV2Outline(groups, states, 'multi').groups[0].buttons;
  assert.deepEqual(buttons([{ questionId: 'single', answered: true }, { questionId: 'multi', answered: { a: true, b: false, foreign: true } }]).map(b => b.status), ['draft', 'draft', 'unanswered']);
  assert.deepEqual(buttons([{ questionId: 'single', answered: false }, { questionId: 'multi', answered: {}, locked: true }]).map(b => b.status), ['unanswered', 'pending', 'pending']);
  const graded = buttons([{ questionId: 'multi', locked: true, status: 'graded', score: 2, outlineScores: [{ id: 'a', score: 0 }, { id: 'b', score: 2 }] }]);
  assert.deepEqual(graded.map(b => b.status), ['unanswered', 'incorrect', 'correct']); assert.equal(graded[1].active, true);
});

test('D35 draft reports persist through reopen, merge partial parts, ignore notes/ink, lock with answer and clear on retry', async t => {
  const { fixture, server, api, base, overview, write } = await setup(t);
  let saved = await write('1', 'draft', { requestId: 'a', expectedRevision: 0, answer: { choice: '乙' }, answered: true });
  assert.equal(saved.status, 200); assert.equal(saved.value.state.answered, true); assert.doesNotMatch(saved.text, new RegExp(SOLUTION_MARKER));
  saved = await write('1', 'draft', { requestId: 'clear', expectedRevision: 1, answer: null, answered: false }); assert.equal(saved.value.state.answered, false);
  await write('2', 'draft', { requestId: 'pa', expectedRevision: 0, answer: { p1: '乙' }, answered: { p1: true, foreign: true } });
  await write('2', 'draft', { requestId: 'pb', expectedRevision: 1, answer: { p1: '乙', p2: '甲' }, answered: { p2: true } });
  saved = await write('2', 'draft', { requestId: 'pc', expectedRevision: 2, answer: { p2: '甲' }, answered: { p1: false } });
  assert.deepEqual(saved.value.state.answered, { p1: false, p2: true });
  saved.value.state.answered.p2 = false;
  const after = (await api(base + '/overview')).value; assert.deepEqual(after.states.find(s => s.questionId === '2').answered, { p1: false, p2: true });
  await write('2', 'draft', { requestId: 'notes', expectedRevision: 3, draft: 'notes only' });
  const ink = await write('2', 'ink', { requestId: 'ink', expectedInkRevision: 0, ink: { marker: 'NO_INK_ECHO_9e69', points: [[1, 2]] } });
  assert.deepEqual(Object.keys(ink.value).sort(), ['inkRevision', 'state']); assert.doesNotMatch(ink.text, /NO_INK_ECHO_9e69|points/);
  assert.deepEqual(ink.value.state.answered, { p1: false, p2: true });
  const locked = await write('2', 'submit', { requestId: 'submit', expectedRevision: 4, answer: { p2: '甲' } });
  assert.deepEqual(locked.value.state.answered, { p1: false, p2: true });
  assert.equal((await write('2', 'draft', { requestId: 'late', expectedRevision: 5, answer: null, answered: { p2: false } })).value.error.code, 'ANSWER_LOCKED');
  const graded = await write('2', 'result', { requestId: 'grade', submission: locked.value.submission, expectedResultRevision: 0, source: 'grader', result: { status: 'graded', score: 0.2, outlineScores: [{ id: 'p1', score: 0 }, { id: 'p2', score: 0.2 }] } });
  assert.equal(graded.status, 200); assert.deepEqual(graded.value.state.outlineScores, graded.value.result.outlineScores);
  const restarted = await new V2Server(fixture).start(); t.after(() => restarted.close());
  const reopened = await fetch(`http://127.0.0.1:${restarted.port()}${base}/overview`).then(r => r.json());
  assert.deepEqual(reopened.states.find(s => s.questionId === '2').answered, { p1: false, p2: true });
  assert.equal((await write('2', 'retry', { requestId: 'retry', expectedRevision: 6 })).status, 200);
  const reset = await api(`${base}/questions/2?snapshotId=${overview.snapshotId}`); assert.deepEqual(reset.value.state.answered, {}); assert.equal(reset.value.ink, null);
  assert.equal(fs.existsSync(server.library.stateStore.file(fixture.directory)), true);
});

test('invalid reports and failed saves do not overwrite answered metadata or state bytes, and exact retry preserves it', async t => {
  const { fixture, server, write } = await setup(t), store = server.library.stateStore;
  const request = { requestId: 'first', expectedRevision: 0, answer: 'opaque', answered: true };
  const original = store.write; store.write = () => { throw Error('disk'); };
  assert.equal((await write('1', 'draft', request)).status, 503); assert.equal(fs.existsSync(store.file(fixture.directory)), false);
  store.write = original; assert.equal((await write('1', 'draft', request)).status, 200);
  const bytes = fs.readFileSync(store.file(fixture.directory)); assert.equal((await write('1', 'draft', request)).status, 200);
  for (const answered of [null, 'true', { bad: true }]) assert.equal((await write('1', 'draft', { requestId: 'bad', expectedRevision: 1, answer: 'other', answered })).status, 400);
  assert.equal((await write('1', 'draft', { requestId: 'notes', expectedRevision: 1, draft: 'note', answered: false })).status, 400);
  assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
});
