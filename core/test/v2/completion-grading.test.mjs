import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/completion.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
});
const { createCompletionGrader } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const question = (id, type) => ({
  question: {
    questionId: id,
    extension: { artifactId: type },
    question: {},
    solution: {},
    answer: {},
    item: {},
    submissionId: 'lock-' + id,
    state: { revision: 2 },
  },
  error: null,
});
const fixture = () => ({
  snapshotId: 'snapshot',
  pendingGrading: [question('1', 'a'), question('2', 'b'), question('3', 'a')],
});

test('completion grades each type in one batch; uncertain transport reuses byte-identical body/id and does not rerun author code', async () => {
  const calls = [],
    bodies = [];
  let ids = 0,
    fail = true;
  const grader = createCompletionGrader({
    requestId: () => 'r' + ++ids,
    async grade(id, items) {
      calls.push([id, items.map((q) => q.questionId)]);
      return items.map((q) => ({
        questionId: q.questionId,
        result: { score: 2, parts: null, message: null },
      }));
    },
    async send(body) {
      bodies.push(body);
      if (fail) {
        throw Error('network');
      }
      return { total: { score: 6, maxScore: 6 } };
    },
  });
  await assert.rejects(grader.run(fixture()), /network/);
  fail = false;
  assert.equal((await grader.run(fixture())).total.score, 6);
  assert.deepEqual(calls, [
    ['a', ['1', '3']],
    ['b', ['2']],
  ]);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(ids, 1);
});

test('invalid author result is replaced only for the rejected question; conflict errors are not downgraded or automatically retried', async () => {
  const bodies = [];
  let ids = 0;
  const grader = createCompletionGrader({
    requestId: () => 'id' + ++ids,
    async grade(id, items) {
      return items.map((q) => ({
        questionId: q.questionId,
        result: { score: 999, parts: null, message: null },
      }));
    },
    async send(body) {
      bodies.push(JSON.parse(body));
      if (bodies.length === 1) {
        throw Object.assign(Error('invalid'), { code: 'INVALID_RESULT', questionId: '1' });
      }
      return {};
    },
  });
  await grader.run(fixture());
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].results.find((r) => r.questionId === '1').result.score, null);
  assert.match(bodies[1].results[0].result.message, /无效/);
  assert.equal(bodies[1].results.find((r) => r.questionId === '2').result.score, 999);
  assert.notEqual(bodies[0].requestId, bodies[1].requestId);
  let sends = 0;
  const conflict = createCompletionGrader({
    requestId: () => 'r',
    grade: async (_, items) => items.map((q) => ({ questionId: q.questionId, result: {} })),
    send: async () => {
      sends++;
      throw Object.assign(Error('conflict'), { code: 'RESULT_CONFLICT' });
    },
  });
  await assert.rejects(conflict.run(fixture()), /conflict/);
  assert.equal(sends, 1);
});

test('unavailable pages are left pending and a changed scope discards obsolete prepared results', async () => {
  const bodies = [];
  let fail = true;
  const grader = createCompletionGrader({
    requestId: () => 'r',
    grade: async (_, items) =>
      items.map((q) => ({
        questionId: q.questionId,
        result: { score: 0, parts: null, message: null },
      })),
    send: async (body) => {
      bodies.push(JSON.parse(body));
      if (fail) {
        throw Error('failed');
      }
      return {};
    },
  });
  assert.equal(
    await grader.run({
      snapshotId: 'one',
      pendingGrading: [{ question: null, error: { message: 'unavailable' } }],
    }),
    null,
  );
  await assert.rejects(grader.run(fixture()), /failed/);
  fail = false;
  await grader.run({ snapshotId: 'changed', pendingGrading: [question('new', 'b')] });
  assert.equal(bodies.length, 2);
  assert.deepEqual(
    bodies[1].results.map((row) => row.questionId),
    ['new'],
  );
});
