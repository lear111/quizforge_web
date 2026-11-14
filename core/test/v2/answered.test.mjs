import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { mergeAnswered, ANSWERED_PART_LIMIT } from '../../shared/v2/answered.js';
import { V2Server } from '../../server/v2/app.js';
import { createReadFixture, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';
const code = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/services/outline.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
});
const { buildV2Outline } = await import(
  'data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].text).toString('base64')
);

async function setup(t) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start();
  t.after(() => server.close());
  const api = async (route, body, method = 'GET') => {
    const response = await fetch(
      `http://127.0.0.1:${server.port()}${route}`,
      body === undefined
        ? {}
        : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    );
    const text = await response.text();
    return { status: response.status, text, value: JSON.parse(text) };
  };
  const bankId = (await api('/api/v2/catalog')).value.groups[0].items[0].bankId,
    base = `/api/v2/banks/${bankId}`,
    overview = (await api(base + '/overview')).value;
  const write = (id, op, body) =>
    api(
      `${base}/questions/${id}/${op}`,
      { snapshotId: overview.snapshotId, ...body },
      ['submit', 'retry'].includes(op) ? 'POST' : 'PUT',
    );
  return { fixture, server, api, bankId, base, overview, write };
}

test('answered metadata merges only known parts, rejects malformed/oversized maps, and treats prototype-shaped IDs as ordinary keys', () => {
  const item = { parts: [{ id: 'a' }, { id: 'b' }, { id: '__proto__' }] };
  assert.equal(mergeAnswered(false, {}), false);
  assert.deepEqual(mergeAnswered({ b: false, unknown: true }, item, { a: true, b: true }), {
    a: true,
    b: false,
  });
  assert.equal(
    Object.hasOwn(mergeAnswered(JSON.parse('{"__proto__":true}'), item), '__proto__'),
    true,
  );
  assert.equal({}.polluted, undefined);
  for (const value of [
    true,
    null,
    [],
    { a: 'true' },
    Object.fromEntries(Array.from({ length: ANSWERED_PART_LIMIT + 1 }, (_, i) => ['p' + i, true])),
  ]) {
    assert.throws(() => mergeAnswered(value, item));
  }
  assert.throws(() => mergeAnswered({ a: true }, {}));
});

test('outline uses exactly five backend display states with per-part labels and an accessible warning', () => {
  const groups = [
    {
      title: '分组',
      items: [
        { id: 'single', label: '1', maxScore: 2 },
        {
          id: 'multi',
          parts: [
            { id: 'a', label: '2', maxScore: 1 },
            { id: 'b', label: '3', maxScore: 2 },
          ],
        },
      ],
    },
  ];
  const buttons = (states) => buildV2Outline(groups, states, 'multi').groups[0].buttons;
  assert.deepEqual(
    buttons([
      { questionId: 'single', status: 'answered' },
      { questionId: 'multi', status: { a: 'answered' } },
    ]).map((b) => b.status),
    ['answered', 'answered', 'unanswered'],
  );
  assert.deepEqual(
    buttons([{ questionId: 'multi', status: { b: 'answered' }, locked: true }]).map(
      (b) => b.status,
    ),
    ['unanswered', 'unanswered', 'answered'],
  );
  const graded = buttons([
    { questionId: 'single', status: 'ungradable' },
    { questionId: 'multi', status: { a: 'wrong', b: 'correct' } },
  ]);
  assert.deepEqual(
    graded.map((b) => b.status),
    ['ungradable', 'wrong', 'correct'],
  );
  assert.equal(graded[1].active, true);
  assert.match(graded[0].title, /无法评分/);
  assert.match(graded[0].ariaLabel, /无法评分/);
});

test('D37–D39 answer reports persist through reopen, merge partial parts, ignore ink, lock with answer and clear on retry', async (t) => {
  const { fixture, server, api, base, overview, write } = await setup(t);
  let saved = await write('1', 'answer', {
    requestId: 'a',
    expectedRevision: 0,
    answer: { choice: '乙' },
    answered: true,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.state.status, 'answered');
  assert.doesNotMatch(saved.text, new RegExp(SOLUTION_MARKER));
  saved = await write('1', 'answer', {
    requestId: 'clear',
    expectedRevision: 1,
    answer: null,
    answered: false,
  });
  assert.equal(saved.value.state.status, 'unanswered');
  await write('2', 'answer', {
    requestId: 'pa',
    expectedRevision: 0,
    answer: { p1: '乙' },
    answered: { p1: true, foreign: true },
  });
  await write('2', 'answer', {
    requestId: 'pb',
    expectedRevision: 1,
    answer: { p1: '乙', p2: '甲' },
    answered: { p2: true },
  });
  saved = await write('2', 'answer', {
    requestId: 'pc',
    expectedRevision: 2,
    answer: { p2: '甲' },
    answered: { p1: false },
  });
  assert.deepEqual(saved.value.state.status, { p1: 'unanswered', p2: 'answered' });
  saved.value.state.status.p2 = 'unanswered';
  const after = (await api(base + '/overview')).value;
  assert.deepEqual(after.states.find((s) => s.questionId === '2').status, {
    p1: 'unanswered',
    p2: 'answered',
  });
  assert.equal(
    (
      await write('2', 'answer', {
        requestId: 'notes',
        expectedRevision: 3,
        draft: 'obsolete notes',
      })
    ).status,
    400,
  );
  const ink = await write('2', 'ink', {
    requestId: 'ink',
    expectedInkRevision: 0,
    ink: { marker: 'NO_INK_ECHO_9e69', points: [[1, 2]] },
  });
  assert.deepEqual(Object.keys(ink.value).sort(), ['inkRevision', 'state']);
  assert.doesNotMatch(ink.text, /NO_INK_ECHO_9e69|points/);
  assert.deepEqual(ink.value.state.status, { p1: 'unanswered', p2: 'answered' });
  const locked = await write('2', 'submit', {
    requestId: 'submit',
    expectedRevision: 3,
    answer: { p2: '甲' },
  });
  assert.deepEqual(locked.value.state.status, { p1: 'unanswered', p2: 'answered' });
  assert.equal(
    (
      await write('2', 'answer', {
        requestId: 'late',
        expectedRevision: 4,
        answer: null,
        answered: { p2: false },
      })
    ).value.error.code,
    'ANSWER_LOCKED',
  );
  const grade = (requestId, expectedRevision, result) =>
    write('2', 'result', {
      requestId,
      expectedRevision,
      submissionId: locked.value.submissionId,
      source: 'grader',
      result,
    });
  const pending = await grade('pending', 4, { score: null, parts: null, message: null });
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.value.state.status, locked.value.state.status);
  assert.deepEqual((await api(base + '/overview')).value.pendingGrading, []);
  const failed = await grade('failure', 5, { score: null, parts: null, message: '评分失败' });
  assert.equal(failed.status, 200);
  assert.deepEqual(failed.value.state.status, { p1: 'ungradable', p2: 'ungradable' });
  const graded = await grade('grade', 6, {
    score: 0.25,
    parts: { p1: 0.05, p2: 0.2 },
    message: null,
  });
  assert.equal(graded.status, 200);
  assert.deepEqual(graded.value.state.status, { p1: 'wrong', p2: 'correct' });
  assert.deepEqual(graded.value.result.parts, { p1: 0.05, p2: 0.2 });
  assert.equal(Object.hasOwn(graded.value.state, 'answered'), false);
  const savedRecord = server.library.stateStore.load(fixture.directory).questions['2'];
  assert.deepEqual(Object.keys(savedRecord).sort(), [
    'answer',
    'receipts',
    'result',
    'revision',
    'status',
    'submissionId',
  ]);
  assert.deepEqual(savedRecord.status, graded.value.state.status);
  const restarted = await new V2Server(fixture).start();
  t.after(() => restarted.close());
  const reopened = await fetch(`http://127.0.0.1:${restarted.port()}${base}/overview`).then((r) =>
    r.json(),
  );
  assert.deepEqual(reopened.states.find((s) => s.questionId === '2').status, {
    p1: 'wrong',
    p2: 'correct',
  });
  assert.equal(
    (await write('2', 'retry', { requestId: 'retry', expectedRevision: 7 })).status,
    200,
  );
  const reset = await api(`${base}/questions/2?snapshotId=${overview.snapshotId}`);
  assert.deepEqual(reset.value.state.status, {});
  assert.equal(reset.value.ink, null);
  assert.equal(fs.existsSync(server.library.stateStore.file(fixture.directory)), true);
});

test('invalid reports and failed saves do not overwrite answered metadata or state bytes, and exact retry preserves it', async (t) => {
  const { fixture, server, write } = await setup(t),
    store = server.library.stateStore;
  const request = { requestId: 'first', expectedRevision: 0, answer: 'opaque', answered: true };
  const original = store.write;
  store.write = () => {
    throw Error('disk');
  };
  assert.equal((await write('1', 'answer', request)).status, 503);
  assert.equal(fs.existsSync(store.file(fixture.directory)), false);
  store.write = original;
  assert.equal((await write('1', 'answer', request)).status, 200);
  const bytes = fs.readFileSync(store.file(fixture.directory));
  assert.equal((await write('1', 'answer', request)).status, 200);
  for (const answered of [null, 'true', { bad: true }]) {
    assert.equal(
      (
        await write('1', 'answer', {
          requestId: 'bad',
          expectedRevision: 1,
          answer: 'other',
          answered,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await write('1', 'answer', {
        requestId: 'notes',
        expectedRevision: 1,
        draft: 'note',
        answered: false,
      })
    ).status,
    400,
  );
  assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
});
