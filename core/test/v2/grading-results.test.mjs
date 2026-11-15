import assert from 'node:assert/strict';
import fs from 'node:fs';
import srcdocInput from './fixtures/grading-srcdoc.mjs';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { input, result, turn, fixture } from '../fixtures/v2-grading.mjs';

test('untrusted worker results are projected to the input IDs, order and length with invalid entries ungradable', async (t) => {
  const f = fixture(t);
  let serial = 0;
  const run = async (ids, payload) => {
    const pending = f.service.grade('shape-' + serial++, ids.flatMap(input));
    await turn();
    const probe = f.observe(f.frames().at(-1));
    probe.send({ ready: true });
    await turn();
    probe.send({ job: probe.messages[0].job, results: payload });
    return pending;
  };
  for (const payload of [null, {}, 'not an array', 42]) {
    const rows = await run(['q1', 'q2'], payload);
    assert.deepEqual(
      rows.map((row) => row.questionId),
      ['q1', 'q2'],
    );
    assert.ok(
      rows.every((row) => row.result.score === null && typeof row.result.message === 'string'),
    );
  }
  const rows = await run(
    ['q2', 'q1', 'missing', 'duplicate', 'array'],
    [
      ...result('foreign'),
      ...result('q1'),
      { questionId: 'q2', result: null },
      ...result('duplicate'),
      ...result('duplicate'),
      { questionId: 'array', result: [] },
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.questionId),
    ['q2', 'q1', 'missing', 'duplicate', 'array'],
  );
  assert.equal(rows[1].result.score, 2);
  assert.ok(
    rows
      .filter((row) => row.questionId !== 'q1')
      .every((row) => row.result.score === null && typeof row.result.message === 'string'),
  );
});

test('grading distinguishes a request for human review from a thrown or malformed grade', async (t) => {
  const f = fixture(t),
    pending = f.service.grade('new-contract', ['waiting', 'thrown', 'bad', 'parts'].flatMap(input));
  await turn();
  const probe = f.observe(f.frames()[0]);
  probe.send({ ready: true });
  await turn();
  probe.send({
    job: probe.messages[0].job,
    results: [
      { questionId: 'waiting', result: { score: null } },
      { questionId: 'thrown', error: '合成评分失败' },
      { questionId: 'bad', result: { score: 2, message: 'grade cannot set a message' } },
      { questionId: 'parts', result: { score: 2, parts: { x: 2 } } },
    ],
  });
  const rows = (await pending).map((row) => row.result);
  assert.deepEqual(rows[0], { score: null, parts: null, message: null });
  assert.deepEqual(rows[1], { score: null, parts: null, message: '合成评分失败' });
  assert.equal(rows[2].score, null);
  assert.match(rows[2].message, /无效/);
  assert.deepEqual(rows[3], { score: 2, parts: { x: 2 }, message: null });
});

test('grading srcdoc including Worker and bootstrap matches the pre-split document byte for byte', async (t) => {
  const compiled = await build({
    entryPoints: [
      fileURLToPath(new URL('../../frontend/src/v2/services/grading.ts', import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'TestGrading',
    platform: 'browser',
  });
  const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
  dom.window.crypto.getRandomValues = (values) => {
    values.forEach((_, i) => (values[i] = i));
    return values;
  };
  dom.window.eval(compiled.outputFiles[0].text + '\nwindow.TestGrading = TestGrading;');
  const service = dom.window.TestGrading.createGradingService({
    document: dom.window.document,
    loadSource: async () => srcdocInput.source,
    scriptNonce: srcdocInput.nonce,
  });
  t.after(() => {
    service.dispose();
    dom.window.close();
  });
  const pending = service.grade('synthetic', []);
  await turn();
  const actual = Buffer.from(dom.window.document.querySelector('iframe').srcdoc);
  const expected = fs.readFileSync(new URL('./fixtures/grading-srcdoc.txt', import.meta.url));
  assert.ok(actual.equals(expected));
  service.dispose();
  await pending;
});

test('normalization preserves error text, rejects pending parts and leaves score range checks to the server', async (t) => {
  const ids = ['error', 'blank', 'pending-parts', 'nonfinite', 'score', 'parts'];
  const f = fixture(t),
    pending = f.service.grade('a', ids.flatMap(input));
  await turn();
  const probe = f.observe(f.frames()[0]);
  probe.send({ ready: true });
  await turn();
  const parts = { p: -4 };
  probe.send({
    job: probe.messages[0].job,
    results: [
      { questionId: 'error', error: '  synthetic error  ', result: { score: 2 } },
      { questionId: 'blank', error: '  ', result: { score: 2 } },
      { questionId: 'pending-parts', result: { score: null, parts: null } },
      { questionId: 'nonfinite', result: { score: 2, parts: { p: Infinity } } },
      { questionId: 'score', result: { score: -4 } },
      { questionId: 'parts', result: { score: 8, parts } },
    ],
  });
  const rows = (await pending).map(({ result }) => result);
  assert.deepEqual(rows, [
    { score: null, parts: null, message: '  synthetic error  ' },
    { score: 2, parts: null, message: null },
    { score: null, parts: null, message: '题型返回的评分结果无效。' },
    { score: null, parts: null, message: '题型返回的评分结果无效。' },
    { score: -4, parts: null, message: null },
    { score: 8, parts: { p: -4 }, message: null },
  ]);
  assert.equal(rows[5].parts, parts, 'the host does not clone or rewrite parts');
});
