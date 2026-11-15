import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { candidate, overview, result, row, deferred } from './fixtures/completion-grader.mjs';

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/services/completion.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
});
const { createCompletionGrader } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
test('groups run sequentially in first-seen order, preserve input references and assemble exact rows after grading', async () => {
  const candidates = [
    candidate('2', 'b'),
    { question: null, error: {} },
    candidate('1'),
    candidate('3', 'b'),
    candidate('4', 'c'),
  ];
  const first = deferred(),
    calls = [],
    bodies = [],
    reply = { total: { score: 2, maxScore: 4 } };
  const grader = createCompletionGrader({
    requestId: () => 'fixed',
    grade(id, items) {
      calls.push([id, items]);
      if (id === 'b') {
        return first.promise;
      }
      return Promise.resolve(id === 'a' ? [] : [result('4')]);
    },
    send: async (body) => {
      bodies.push(body);
      return reply;
    },
  });
  const running = grader.run(overview(candidates));
  assert.deepEqual(
    calls.map(([id]) => id),
    ['b'],
  );
  assert.equal(bodies.length, 0);
  candidates[0].question.state.revision = 9;
  candidates[0].question.submissionId = 'new-lock';
  first.resolve([result('3', 0), result('2'), result('2', 99), result('foreign')]);
  assert.equal(await running, reply);
  assert.deepEqual(
    calls.map(([id, items]) => [id, items.map((item) => item.questionId)]),
    [
      ['b', ['2', '3']],
      ['a', ['1']],
      ['c', ['4']],
    ],
  );
  for (const [, items] of calls) {
    for (const item of items) {
      const source = candidates.find(
        (entry) => entry.question?.questionId === item.questionId,
      ).question;
      assert.deepEqual(Object.keys(item), ['questionId', 'question', 'solution', 'answer', 'item']);
      for (const key of ['question', 'solution', 'answer', 'item']) {
        assert.equal(item[key], source[key]);
      }
    }
  }
  assert.equal(
    bodies[0],
    JSON.stringify({
      requestId: 'fixed',
      snapshotId: 's',
      results: [
        { ...row('2', result('2').result), submissionId: 'new-lock', expectedRevision: 9 },
        row('3', result('3', 0).result),
        row('1', { score: null, parts: null, message: '题型没有返回本题的评分结果。' }),
        row('4', result('4').result),
      ],
    }),
  );
});

test('INVALID_RESULT regenerates only the corrected batch, then a lost response replays its identical body and ID', async () => {
  const bodies = [],
    saved = { total: {} },
    network = Error('lost response');
  let ids = 0,
    grades = 0;
  const value = overview([candidate('1'), candidate('2')]);
  const grader = createCompletionGrader({
    requestId: () => 'id-' + ++ids,
    grade: async () => {
      grades++;
      return [result('1', null), result('2')];
    },
    send: async (body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        throw Object.assign(Error('invalid'), { code: 'INVALID_RESULT', questionId: '1' });
      }
      if (bodies.length === 2) {
        throw network;
      }
      return saved;
    },
  });
  await assert.rejects(grader.run(value), (error) => error === network);
  const [before, after] = bodies.map((body) => JSON.parse(body));
  assert.notEqual(before.requestId, after.requestId);
  assert.deepEqual(after.results[0].result, {
    score: null,
    parts: null,
    message: '题型返回的评分格式或分数无效。',
  });
  assert.deepEqual(after.results[1], before.results[1]);
  assert.equal(
    await grader.run(overview([])),
    saved,
    'same snapshot replays pending rows even with an empty list',
  );
  assert.equal(bodies[1], bodies[2]);
  assert.equal(ids, 2);
  assert.equal(grades, 1);
  assert.equal(await grader.run(overview([])), null);
  assert.equal(await grader.run(value), saved);
  assert.equal(ids, 3);
  assert.equal(grades, 2);
});

test('other errors, unknown IDs and already-ungradable rejections escape without extra retries or body changes', async () => {
  for (const mode of ['conflict', 'missing-id', 'ungradable', 'repeat-invalid']) {
    const error = Object.assign(Error(mode), {
      code: mode === 'conflict' ? 'RESULT_CONFLICT' : 'INVALID_RESULT',
      questionId: mode === 'missing-id' ? 'missing' : '1',
    });
    const bodies = [],
      reply = {};
    let ids = 0,
      grades = 0;
    const grader = createCompletionGrader({
      requestId: () => 'id-' + ++ids,
      grade: async () => {
        grades++;
        return [
          mode === 'ungradable'
            ? {
                questionId: '1',
                result: { score: null, parts: null, message: 'existing cause' },
              }
            : result('1'),
        ];
      },
      send: async (body) => {
        bodies.push(body);
        if (bodies.length <= (mode === 'repeat-invalid' ? 2 : 1)) {
          throw error;
        }
        return reply;
      },
    });
    await assert.rejects(grader.run(overview([candidate('1')])), (caught) => caught === error);
    assert.equal(bodies.length, mode === 'repeat-invalid' ? 2 : 1);
    const retained = bodies.at(-1);
    assert.equal(await grader.run(overview([])), reply);
    assert.equal(bodies.at(-1), retained);
    assert.equal(ids, mode === 'repeat-invalid' ? 2 : 1);
    assert.equal(grades, 1);
  }
});

test('clear and an empty different snapshot discard prepared failures without resurrecting an old batch', async () => {
  const bodies = [],
    graded = [],
    error = Error('offline');
  let ids = 0;
  const grader = createCompletionGrader({
    requestId: () => 'id-' + ++ids,
    grade: async (_type, items) => {
      graded.push(items.map((item) => item.questionId));
      return items.map((item) => result(item.questionId));
    },
    send: async (body) => {
      bodies.push(body);
      throw error;
    },
  });
  await assert.rejects(grader.run(overview([candidate('1')])), (caught) => caught === error);
  grader.clear();
  assert.equal(await grader.run(overview([])), null);
  assert.equal(bodies.length, 1);
  await assert.rejects(grader.run(overview([candidate('2')])), (caught) => caught === error);
  assert.equal(await grader.run(overview([], 'new-snapshot')), null);
  await assert.rejects(grader.run(overview([candidate('3')])), (caught) => caught === error);
  assert.deepEqual(graded, [['1'], ['2'], ['3']]);
  assert.equal(ids, 3);
  assert.deepEqual(
    bodies.map((body) => JSON.parse(body).results[0].questionId),
    ['1', '2', '3'],
  );
});

test('clear only resets pending storage; in-flight grading and sending continue with their original semantics', async () => {
  for (const phase of ['grade', 'send']) {
    const started = deferred(),
      gate = deferred(),
      bodies = [],
      error = Error('offline'),
      reply = {};
    let grades = 0;
    const grader = createCompletionGrader({
      requestId: () => 'fixed',
      grade: async () => {
        grades++;
        if (phase === 'grade') {
          started.resolve();
          await gate.promise;
        }
        return [result('1')];
      },
      send: async (body) => {
        bodies.push(body);
        if (phase === 'send') {
          started.resolve();
          await gate.promise;
        }
        if (bodies.length === 1) {
          throw error;
        }
        return reply;
      },
    });
    const running = grader.run(overview([candidate('1')]));
    await started.promise;
    grader.clear();
    gate.resolve();
    await assert.rejects(running, (caught) => caught === error);
    assert.equal(await grader.run(overview([])), phase === 'grade' ? reply : null);
    assert.equal(bodies.length, phase === 'grade' ? 2 : 1);
    assert.equal(grades, 1);
    if (phase === 'grade') {
      assert.equal(bodies[0], bodies[1]);
    }
  }
});

test('a grading rejection prepares nothing and the next attempt restarts grouping from the first artifact', async () => {
  const calls = [],
    bodies = [],
    error = Error('grading failed');
  let fail = true,
    ids = 0;
  const grader = createCompletionGrader({
    requestId: () => 'id-' + ++ids,
    grade: async (id, items) => {
      calls.push(id);
      if (id === 'a' && fail) {
        throw error;
      }
      return items.map((item) => result(item.questionId));
    },
    send: async (body) => {
      bodies.push(body);
      return {};
    },
  });
  const value = overview([candidate('1', 'b'), candidate('2', 'a')]);
  await assert.rejects(grader.run(value), (caught) => caught === error);
  assert.equal(ids, 0);
  assert.equal(bodies.length, 0);
  fail = false;
  await grader.run(value);
  assert.deepEqual(calls, ['b', 'a', 'b', 'a']);
  assert.equal(ids, 1);
  assert.equal(bodies.length, 1);
});
