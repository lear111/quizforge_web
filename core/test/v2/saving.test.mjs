import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export { ref } from 'vue';
      export { createApi } from './api';
      export { createRuntime } from './stores/practice/runtime';
      export { createActions } from './stores/practice/actions';`,
    resolveDir: fileURLToPath(new URL('../../frontend/src/v2', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: { '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"test"' },
});
const { ref, createApi, createRuntime, createActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
const question = () => ({
  bankId: 'b',
  questionId: 'q',
  snapshotId: 's',
  question: {},
  answer: null,
  ink: null,
  inkRevision: 0,
  solution: null,
  result: null,
  submissionId: null,
  extension: { artifactId: 'single' },
  resources: [],
  item: { questionId: 'q', label: 'q', maxScore: 2, children: [] },
  state: { questionId: 'q', revision: 0, locked: false, hasSavedAnswer: false, status: 'answered' },
});

function fixture(t) {
  const previous = globalThis.window;
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  const ctx = {
    current: ref(question()),
    overview: ref({ states: [question().state] }),
    saveStatus: ref(''),
    message: ref(''),
    recovering: ref(false),
    token: ref(''),
    runtime: createRuntime(),
  };
  const actions = createActions(ctx);
  ctx.actions = () => actions;
  const requests = [],
    updates = [];
  let answer = 'A',
    respond,
    server = question(),
    inkFailures = 0;
  ctx.api = createApi({
    token: () => '',
    unauthorized() {},
    fetch: async (route, init) => {
      requests.push({ route, ...init });
      if (respond) {
        return respond(route, init);
      }
      const body = JSON.parse(init.body);
      assert.equal(
        Object.hasOwn(body, 'kind'),
        false,
        'internal tags never enter the HTTP payload',
      );
      if (route.endsWith('/answer')) {
        server = {
          ...server,
          answer: body.answer,
          state: { ...server.state, revision: server.state.revision + 1, hasSavedAnswer: true },
        };
        return Response.json({ ...server, ink: undefined, inkRevision: undefined });
      }
      assert.ok(route.endsWith('/ink'));
      if (inkFailures-- > 0) {
        throw Error('ink offline');
      }
      server = { ...server, ink: body.ink, inkRevision: server.inkRevision + 1 };
      return Response.json({ state: server.state, inkRevision: server.inkRevision });
    },
  });
  const instance = {
    answer: async () => answer,
    can: { retry: true },
    frame: { inert: false },
    update: async (value) => {
      updates.push(value);
    },
  };
  const saver = actions.createSaver(ctx.current.value, 0, instance);
  ctx.runtime.saver = saver;
  t.after(() => {
    saver.destroy();
    globalThis.window = previous;
  });
  return {
    ctx,
    actions,
    saver,
    instance,
    requests,
    updates,
    answer: (value) => {
      answer = value;
    },
    failInk: () => {
      inkFailures++;
    },
    respond: (value) => {
      respond = value;
    },
  };
}

test('partial answer success retries only the frozen ink before newer answers with independent revisions', async (t) => {
  const f = fixture(t),
    { ctx, saver, requests } = f;
  ctx.runtime.answerVersion = ctx.runtime.inkVersion = 1;
  ctx.runtime.scratch = { getDraft: () => ({ strokes: ['one'] }) };
  f.failInk();
  saver.changed('text');
  await assert.rejects(saver.flush(), /ink offline/);
  assert.equal(ctx.runtime.savedAnswer, 1);
  assert.equal(ctx.runtime.savedInk, 0);
  assert.equal(saver.dirty, true);
  f.answer('B');
  ctx.runtime.answerVersion++;
  saver.changed('choice');
  await saver.flush();
  assert.deepEqual(
    requests.map((row) => row.route.split('/').at(-1)),
    ['answer', 'ink', 'ink', 'answer'],
  );
  assert.equal(requests[1].body, requests[2].body);
  const bodies = requests.map((row) => JSON.parse(row.body));
  assert.equal(bodies[0].expectedRevision, 0);
  assert.equal(bodies[3].expectedRevision, 1);
  assert.equal(bodies[1].expectedInkRevision, 0);
  assert.equal(bodies[3].answer, 'B');
  assert.equal(new Set(bodies.map((row) => row.requestId)).size, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.current.value.ink)), { strokes: ['one'] });
  assert.equal(ctx.current.value.inkRevision, 1);
  assert.equal(ctx.current.value.answer, 'B');
  assert.equal(ctx.saveStatus.value, '已保存');
  assert.equal(ctx.runtime.savedAnswer, 2);
  assert.equal(ctx.runtime.savedInk, 1);
});

test('a newer answer arriving during permission repaint cancels stale context and saves before repainting', async (t) => {
  const f = fixture(t),
    { ctx, saver, instance } = f;
  instance.can.retry = false;
  let release, entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  const getter = instance.answer;
  let reads = 0;
  instance.answer = async () => {
    if (++reads === 2) {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return getter();
  };
  ctx.runtime.answerVersion = 1;
  saver.changed('choice');
  const saving = saver.flush();
  await reading;
  assert.equal(instance.frame.inert, true);
  f.answer('B');
  ctx.runtime.answerVersion++;
  saver.changed('choice');
  release('A');
  await saving;
  assert.deepEqual(
    f.updates.map((value) => value.answer),
    ['B'],
  );
  assert.deepEqual(
    f.requests.map((row) => JSON.parse(row.body).answer),
    ['A', 'B'],
  );
  assert.equal(instance.frame.inert, false);
  assert.equal(saver.dirty, false);
});

test('a late save response from a disposed generation cannot repaint or replace the newly active question', async (t) => {
  const f = fixture(t),
    { ctx, saver } = f;
  let release, entered;
  const dispatched = new Promise((resolve) => {
    entered = resolve;
  });
  // Keep production preparation, queue and response handling; gate only the transport.
  ctx.api.questions.sendSave = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return { ...question(), answer: 'A', state: { ...question().state, revision: 1 } };
  };
  ctx.runtime.answerVersion = 1;
  saver.changed('choice');
  const saving = saver.flush();
  await dispatched;
  ctx.runtime.generation++;
  ctx.current.value = { ...question(), questionId: 'next' };
  saver.destroy();
  release();
  await saving;
  assert.equal(ctx.current.value.questionId, 'next');
  assert.equal(ctx.current.value.answer, null);
  assert.equal(ctx.runtime.savedAnswer, 0);
  assert.equal(f.updates.length, 0);
});

test('revision conflict abandons both local writes and a failed reload retries only GET through real recovery', async (t) => {
  const f = fixture(t),
    { ctx, saver } = f;
  const winner = {
    ...question(),
    answer: 'winner',
    ink: { strokes: ['winner'] },
    inkRevision: 3,
    state: { ...question().state, revision: 7, hasSavedAnswer: true },
  };
  let reads = 0,
    loadedInk;
  f.respond((_route, init) => {
    if (init.method === 'PUT') {
      return Response.json(
        { error: { code: 'REVISION_CONFLICT', message: 'conflict' } },
        { status: 409 },
      );
    }
    if (++reads === 1) {
      throw Error('reload offline');
    }
    return Response.json(winner);
  });
  ctx.runtime.answerVersion = ctx.runtime.inkVersion = 1;
  ctx.runtime.scratch = {
    getDraft: () => ({ strokes: ['loser'] }),
    load: (ink) => {
      loadedInk = ink;
    },
  };
  saver.changed('choice');
  await assert.rejects(saver.flush(), /reload offline/);
  assert.equal(saver.dirty, true);
  assert.equal(ctx.recovering.value, false);
  f.answer('new losing edit');
  ctx.runtime.answerVersion++;
  saver.changed('choice');
  await saver.flush();
  assert.deepEqual(
    f.requests.map((request) => request.method ?? 'GET'),
    ['PUT', 'GET', 'GET'],
  );
  assert.ok(f.requests.every((request) => !request.route.endsWith('/ink')));
  assert.equal(ctx.current.value.answer, 'winner');
  assert.deepEqual(loadedInk, winner.ink);
  assert.equal(ctx.runtime.savedAnswer, 2);
  assert.equal(ctx.runtime.savedInk, 1);
  assert.equal(ctx.saveStatus.value, '已载入最新内容');
  assert.equal(ctx.message.value, '本题已在别处修改，已载入最新内容');
  assert.equal(saver.dirty, false);
});
