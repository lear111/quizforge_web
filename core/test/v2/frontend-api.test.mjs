import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export { createApi } from './api';
      export { writeBody } from './api/requests';
      export { createWriteQueue } from './services/write-queue';`,
    resolveDir: fileURLToPath(new URL('../../frontend/src/v2', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { createApi, writeBody, createWriteQueue } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const question = () => ({
  bankId: 'b1',
  questionId: '题/1',
  snapshotId: 's&1',
  inkRevision: 3,
  state: { revision: 7 },
  submissionId: 'locked-answer',
});
function fixture(respond = () => Response.json({})) {
  const requests = [];
  let token = '',
    unauthorized = 0;
  const api = createApi({
    token: () => token,
    unauthorized: () => unauthorized++,
    fetch(route, options) {
      requests.push({ route, ...options });
      return respond(route, options);
    },
  });
  return {
    api,
    requests,
    setToken: (value) => (token = value),
    unauthorized: () => unauthorized,
  };
}

test('all resource transports use current authorization, omit ambient credentials and propagate cancellation', async () => {
  const f = fixture((route) =>
    route.includes('/files/') || route.includes('/sdk/')
      ? new Response('source')
      : route.includes('/assets/')
        ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })
        : Response.json({ groups: [] }),
  );
  const abort = new AbortController();
  await f.api.catalog.get();
  f.setToken('first');
  await f.api.extensions.manifest('a/b', abort.signal);
  f.setToken('second');
  assert.equal(await f.api.extensions.file('a/b', 'grade-js', abort.signal), 'source');
  await f.api.sdk.richtext('1.0.0', 's&1', abort.signal);
  const picture = await f.api.questions.asset(question(), 'image');
  assert.equal(picture.headers.get('Content-Type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await picture.arrayBuffer())], [1, 2, 3]);
  assert.deepEqual(
    f.requests.map((row) => row.headers['x-quizforge-token']),
    [undefined, 'first', 'second', 'second', 'second', 'second'],
  );
  assert.equal(f.requests[1].route, '/api/v2/extensions/a%2Fb/manifest');
  assert.equal(f.requests[3].route, '/api/v2/sdk/richtext/1.0.0/richtext.js?snapshotId=s%261');
  assert.equal(
    f.requests[5].route,
    '/api/v2/banks/b1/questions/%E9%A2%98%2F1/assets/image?snapshotId=s%261',
  );
  for (const row of f.requests) {
    assert.equal(row.credentials, 'omit');
    assert.equal(row.referrerPolicy, 'no-referrer');
  }
  for (const row of f.requests.slice(1, 5)) {
    assert.equal(row.signal, abort.signal);
  }
  const canceled = fixture((_, { signal }) => Promise.reject(signal.reason));
  abort.abort(new Error('canceled'));
  await assert.rejects(canceled.api.extensions.file('a', 'grade-js', abort.signal), /canceled/);
  assert.equal(canceled.requests.length, 1);
});

test('errors keep server code, question and status across JSON, text and binary; only 401 expires sources', async () => {
  const f = fixture(() =>
    Response.json(
      { error: { code: 'REVISION_CONFLICT', questionId: '题/1', message: '已变更' } },
      { status: 409 },
    ),
  );
  for (const call of [
    () => f.api.questions.get(question()),
    () => f.api.extensions.file('a', 'grade-js'),
    () => f.api.questions.asset(question(), 'image'),
  ]) {
    await assert.rejects(call(), {
      message: '已变更',
      code: 'REVISION_CONFLICT',
      questionId: '题/1',
      status: 409,
    });
  }
  assert.equal(f.requests.length, 3);
  assert.equal(f.unauthorized(), 0);
  const denied = fixture(() =>
    Response.json({ error: { code: 'AUTH_REQUIRED' } }, { status: 401 }),
  );
  await assert.rejects(denied.api.catalog.get(), {
    message: '操作未完成。',
    code: 'AUTH_REQUIRED',
    status: 401,
  });
  assert.equal(denied.unauthorized(), 1);
  const offline = fixture(() => Promise.reject(new TypeError('offline')));
  await assert.rejects(offline.api.catalog.get(), /offline/);
  assert.equal(offline.requests.length, 1);
  const invalid = fixture(() => new Response('invalid JSON', { status: 502 }));
  await assert.rejects(invalid.api.banks.overview('b1'), SyntaxError);
  assert.equal(invalid.requests.length, 1);
});

test('save captures revision only at dispatch and retries identical bytes while ink uses its own revision', async () => {
  const q = question();
  let failed = true;
  const f = fixture(() => {
    if (failed) {
      return Promise.reject(new Error('response lost'));
    }
    return Response.json({ state: { revision: 9 }, inkRevision: 4 });
  });
  const queue = createWriteQueue();
  let release;
  const earlier = queue.enqueue(() => new Promise((resolve) => (release = resolve)));
  const answer = queue.prepare(
    () => f.api.questions.prepareAnswer(q, { answer: { text: '保留输入' }, answered: true }),
    f.api.questions.sendSave,
    () => {},
  );
  const first = answer();
  const refused = assert.rejects(first, /response lost/);
  await Promise.resolve();
  q.state.revision = 8;
  release();
  await earlier;
  await refused;
  q.state.revision = 99;
  q.snapshotId = 'changed';
  failed = false;
  await answer();
  assert.equal(f.requests[0].body, f.requests[1].body);
  assert.deepEqual(JSON.parse(f.requests[1].body), {
    requestId: JSON.parse(f.requests[0].body).requestId,
    snapshotId: 's&1',
    expectedRevision: 8,
    answer: { text: '保留输入' },
    answered: true,
  });
  const ink = f.api.questions.prepareInk(q, { strokes: [1] });
  await f.api.questions.sendSave(ink.route, ink.body);
  const inkBody = JSON.parse(f.requests[2].body);
  assert.equal(inkBody.expectedInkRevision, 3);
  assert.equal(Object.hasOwn(inkBody, 'expectedRevision'), false);
  assert.notEqual(inkBody.requestId, JSON.parse(f.requests[0].body).requestId);
});

test('single and bulk operations retain wire fields, snapshot and lock credentials without adding refresh credentials', async () => {
  const f = fixture(),
    q = question(),
    result = { score: 2, parts: null, message: null };
  await f.api.banks.overview(q.bankId);
  await f.api.questions.get(q);
  await f.api.questions.submit(q, { selected: 'a' });
  await f.api.questions.result(q, result);
  await f.api.questions.retry(q);
  await f.api.banks.finish(q.bankId, q.snapshotId);
  const batch = writeBody(
    q.snapshotId,
    { results: [{ questionId: q.questionId, result }] },
    'stable-id',
  );
  await f.api.banks.results(q.bankId, batch);
  await f.api.banks.results(q.bankId, batch);
  await f.api.banks.refresh(q.bankId, q.questionId);
  await f.api.banks.refresh(q.bankId);
  assert.equal(f.requests[0].route, '/api/v2/banks/b1/overview');
  assert.equal(f.requests[1].route, '/api/v2/banks/b1/questions/%E9%A2%98%2F1?snapshotId=s%261');
  const bodies = f.requests.slice(2, 6).map((row) => JSON.parse(row.body));
  for (const body of bodies) {
    assert.match(body.requestId, /^[a-f0-9]{32}$/);
    assert.equal(body.snapshotId, q.snapshotId);
  }
  assert.equal(new Set(bodies.map((body) => body.requestId)).size, 4);
  assert.deepEqual(
    bodies.map((body) => {
      const fields = { ...body };
      delete fields.requestId;
      delete fields.snapshotId;
      return fields;
    }),
    [
      { expectedRevision: 7, answer: { selected: 'a' } },
      { submissionId: 'locked-answer', expectedRevision: 7, source: 'grader', result },
      { expectedRevision: 7 },
      {},
    ],
  );
  assert.deepEqual(
    f.requests.slice(2).map((row) => row.method),
    ['POST', 'PUT', 'POST', 'POST', 'PUT', 'PUT', 'POST', 'POST'],
  );
  assert.equal(f.requests[6].body, batch);
  assert.equal(f.requests[7].body, batch);
  assert.equal(f.requests[8].body, JSON.stringify({ questionId: q.questionId }));
  assert.equal(f.requests[9].body, '{}');
  for (const row of f.requests.slice(2)) {
    assert.equal(row.headers['Content-Type'], 'application/json');
  }
});
