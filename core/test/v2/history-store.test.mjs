import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export * from './stores/practice/history';
      export {context} from './stores/practice/question-state';
      export {createQuestionApi} from './api/questions';
      export {grade,score,submit,retry,recoverPending,continueGrading} from './stores/practice/scoring';
      export {complete,gradeCompleted,resumeCompletion} from './stores/practice/completion';
      export {toggleDraft} from './stores/practice/runtime';
      export {createSaver} from './stores/practice/saving';
      export {reloadAfterConflict} from './stores/practice/recovery';
      export {createWriteQueue} from './services/write-queue';
      export {navigate} from './stores/practice/banks';`,
    resolveDir: fileURLToPath(new URL('../../frontend/src/v2', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  loader: { '.css': 'empty' },
});
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

function fixture() {
  const calls = [],
    ink = { strokes: ['current'] };
  const oldQuestion = {
    bankId: 'bank',
    questionId: 'live',
    answer: { selected: 'A' },
    ink: null,
    state: { locked: false, hasSavedAnswer: true },
  };
  const old = { bank: { bankId: 'bank' }, snapshotId: 'live', completedAt: null };
  const historicQuestion = {
    bankId: 'bank',
    questionId: '1',
    roundId: 'round',
    readOnly: true,
    state: { locked: true },
    answer: 'past',
    solution: 'solution',
    item: {},
  };
  const historic = {
    bank: old.bank,
    snapshotId: 'past',
    readOnly: true,
    roundId: 'round',
    lastQuestionId: '1',
    initial: { question: historicQuestion },
    completedAt: '2026-11-15',
  };
  const ctx = {
    current: { value: oldQuestion },
    overview: { value: old },
    scoreView: { value: false },
    drawer: { value: null },
    drafting: { value: true },
    message: { value: 'previous' },
    runtime: {
      nonce: 'n',
      returnPractice: null,
      scratch: { getDraft: () => ink, setMode: (v) => calls.push(['mode', v]) },
      grader: { dispose: () => calls.push('dispose-grader') },
      completionGrader: { clear: () => calls.push('clear-batch') },
    },
    api: {
      history: {
        overview: async () => {
          calls.push('get-history');
          return historic;
        },
      },
      questions: { get: async () => historicQuestion },
    },
    run: async (_name, fn) => {
      try {
        await fn();
      } catch (e) {
        ctx.message.value = e.message;
      }
    },
    actions: () => ({
      flush: async () => calls.push('flush'),
      clearQuestion: () => {
        ctx.current.value = null;
        calls.push('clear');
      },
      resetSources: () => calls.push('sources'),
      initializeRuntime: () => calls.push('runtime'),
      show: async (q, resume) => {
        ctx.current.value = q;
        calls.push(['show', q.questionId, resume]);
      },
      openBank: async (id) => calls.push(['open-bank', id]),
    }),
  };
  return { ctx, calls, old, oldQuestion, historicQuestion, ink };
}

test('entering and leaving history flushes before suspension and restores current answer, cursor and ink', async () => {
  const f = fixture();
  await mod.openHistory(f.ctx, 'bank', 'round');
  assert.deepEqual(f.calls.slice(0, 2), ['flush', 'get-history']);
  assert.equal(f.ctx.overview.value.readOnly, true);
  assert.equal(f.ctx.drafting.value, false);
  assert.deepEqual(f.ctx.runtime.returnPractice.question.answer, f.oldQuestion.answer);
  assert.deepEqual(f.ctx.runtime.returnPractice.question.ink, f.ink);
  // Switching rounds must retain the original practice, not stash a historic answer.
  await mod.openHistory(f.ctx, 'bank', 'round-2');
  await mod.leaveHistory(f.ctx);
  assert.equal(f.ctx.overview.value, f.old);
  assert.equal(f.ctx.current.value.questionId, 'live');
  assert.deepEqual(f.ctx.current.value.answer, f.oldQuestion.answer);
  assert.deepEqual(f.ctx.current.value.ink, f.ink);
  assert.equal(f.ctx.drafting.value, true);
  assert.equal(f.ctx.message.value, 'previous');
  assert.equal(f.ctx.runtime.returnPractice, null);
  assert.ok(!f.calls.some((v) => Array.isArray(v) && v[0] === 'open-bank'));
});

test('failed flush or history read preserves the current practice without destroying its page', async () => {
  for (const stage of ['flush', 'read']) {
    const f = fixture();
    if (stage === 'read') {
      f.ctx.api.history.overview = async () => {
        throw Error('read failed');
      };
    } else {
      f.ctx.actions = () => ({
        flush: async () => {
          throw Error('save failed');
        },
      });
    }
    await mod.openHistory(f.ctx, 'bank', 'round');
    assert.equal(f.ctx.overview.value, f.old);
    assert.equal(f.ctx.current.value, f.oldQuestion);
    assert.equal(f.ctx.runtime.returnPractice, null);
    assert.ok(!f.calls.includes('clear'));
  }
});

test('opening a history URL without active practice does not stash an empty workspace and reopens practice on exit', async () => {
  const f = fixture();
  f.ctx.overview.value = null;
  f.ctx.current.value = null;
  await mod.openHistory(f.ctx, 'bank', 'round');
  assert.equal(f.ctx.runtime.returnPractice, null);
  await mod.leaveHistory(f.ctx);
  assert.deepEqual(f.calls.at(-1), ['open-bank', 'bank']);
});

test('historical context is locked; grading, retry, submission and plugin actions never invoke writers', async () => {
  const f = fixture();
  await mod.openHistory(f.ctx, 'bank', 'round');
  const context = mod.context(f.ctx, f.historicQuestion);
  assert.equal(context.locked, true);
  assert.deepEqual(context.can, { submit: false, retry: false });
  f.ctx.actions = () =>
    new Proxy(
      {},
      {
        get: (_t, name) => () => {
          throw Error('unexpected action: ' + String(name));
        },
      },
    );
  await mod.grade(f.ctx, f.historicQuestion);
  await assert.rejects(() => mod.score(f.ctx, f.historicQuestion), /只读/);
  await mod.submit(f.ctx);
  await mod.retry(f.ctx);
  await mod.recoverPending(f.ctx, f.ctx.overview.value);
  await mod.continueGrading(f.ctx);
  await mod.complete(f.ctx);
  await mod.gradeCompleted(f.ctx, f.ctx.overview.value);
  await mod.resumeCompletion(f.ctx);
});

test('history API scopes reads and host ink to the round and rejects answer/submit/retry/result writes locally', async () => {
  const calls = [];
  const api = mod.createQuestionApi({
    json: async (route) => calls.push(route),
    response: async (route) => calls.push(route),
  });
  const q = {
    bankId: 'bank',
    questionId: '1',
    roundId: 'past',
    readOnly: true,
    snapshotId: 's',
    state: { revision: 4 },
  };
  await api.get(q);
  await api.asset(q, 'image');
  assert.ok(calls.every((v) => v.startsWith('/api/v2/banks/bank/rounds/past/questions/1')));
  for (const action of [
    () => api.prepareAnswer(q, { answer: 'attack' }),
    () => api.submit(q, 'attack'),
    () => api.retry(q),
    () => api.result(q, {}),
  ]) {
    assert.throws(action, /只读/);
  }
  const inkRequest = api.prepareInk({ ...q, inkRevision: 3 }, { strokes: [] });
  assert.equal(inkRequest.route, '/api/v2/banks/bank/rounds/past/questions/1/ink');
  assert.equal(JSON.parse(inkRequest.body).expectedInkRevision, 3);
  assert.equal(calls.length, 2);
});

test('historical host saver never reads plugin answers and retries the frozen ink request after transport failure', async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = globalThis;
  t.after(() => {
    globalThis.window = previousWindow;
  });
  const f = fixture(),
    requests = [];
  await mod.openHistory(f.ctx, 'bank', 'round');
  const q = f.ctx.current.value;
  Object.assign(q, { snapshotId: 'history-snapshot', inkRevision: 2 });
  Object.assign(f.ctx.runtime, {
    generation: 7,
    queue: mod.createWriteQueue(),
    answerVersion: 1,
    savedAnswer: 0,
    inkVersion: 1,
    savedInk: 0,
  });
  f.ctx.saveStatus = { value: '' };
  const answer = q.answer,
    result = q.result;
  f.ctx.api.questions = mod.createQuestionApi({
    json: async (route, init) => {
      requests.push({ route, body: init.body });
      if (requests.length === 1) {
        throw Error('synthetic network failure');
      }
      return { inkRevision: 3, state: q.state };
    },
  });
  f.ctx.actions = () => ({
    update: (value) => {
      f.ctx.current.value = value;
    },
  });
  const saver = mod.createSaver(f.ctx, q, 7, {
    answer: () => {
      throw Error('plugin answer must never be read');
    },
  });
  t.after(() => saver.destroy());
  saver.changed('ink');
  await assert.rejects(() => saver.flush(), /network/);
  assert.equal(saver.dirty, true);
  assert.equal(f.ctx.saveStatus.value, '保存失败');
  await saver.flush();
  assert.deepEqual(requests[0], requests[1]);
  assert.match(requests[0].route, /rounds\/round\/questions\/1\/ink$/);
  assert.equal(JSON.parse(requests[0].body).expectedInkRevision, 2);
  assert.equal(f.ctx.current.value.inkRevision, 3);
  assert.equal(f.ctx.current.value.answer, answer);
  assert.equal(f.ctx.current.value.result, result);
  assert.equal(f.ctx.runtime.savedInk, 1);
  assert.equal(saver.dirty, false);
});

test('historical transitions wait for host ink flush and failed flush preserves the old round and practice stash', async () => {
  for (const move of ['question', 'round', 'leave']) {
    const f = fixture();
    await mod.openHistory(f.ctx, 'bank', 'round');
    const previous = f.ctx.overview.value,
      question = f.ctx.current.value,
      stash = f.ctx.runtime.returnPractice;
    const actions = f.ctx.actions();
    let release;
    f.ctx.actions = () => ({
      ...actions,
      flush: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    const moving =
      move === 'question'
        ? mod.navigate(f.ctx, '2')
        : move === 'round'
          ? mod.openHistory(f.ctx, 'bank', 'round-2')
          : mod.leaveHistory(f.ctx);
    await Promise.resolve();
    assert.equal(f.ctx.current.value, question);
    assert.equal(f.ctx.overview.value, previous);
    release();
    await moving;
    assert.ok(f.calls.filter((v) => v === 'clear').length > 1);
    const g = fixture();
    await mod.openHistory(g.ctx, 'bank', 'round');
    const original = g.ctx.current.value;
    g.ctx.actions = () => ({
      flush: async () => {
        throw Error('ink save failed');
      },
    });
    if (move === 'question') {
      await mod.navigate(g.ctx, '2');
    } else if (move === 'round') {
      await mod.openHistory(g.ctx, 'bank', 'round-2');
    } else {
      await mod.leaveHistory(g.ctx);
    }
    assert.equal(g.ctx.current.value, original);
    assert.ok(g.ctx.overview.value.readOnly);
    assert.equal(g.ctx.runtime.returnPractice.question.questionId, stash.question.questionId);
    assert.match(g.ctx.message.value, /ink save failed/);
  }
});

test('historical ink conflict reload stays in the round and cannot open or reconcile live practice', async () => {
  const f = fixture();
  await mod.openHistory(f.ctx, 'bank', 'round');
  const old = { ...f.ctx.current.value, snapshotId: 'old', extension: { artifactId: 'e' } };
  f.ctx.current.value = old;
  f.ctx.recovering = { value: false };
  f.ctx.token = { value: 'token' };
  f.ctx.runtime.generation = 7;
  f.ctx.runtime.sources = { scope: () => {} };
  f.ctx.runtime.scratch.load = (ink) => f.calls.push(['ink', ink]);
  const latest = { ...old, snapshotId: 'new', inkRevision: 8, ink: { strokes: ['other-tab'] } };
  f.ctx.api.banks = {
    overview: () => {
      throw Error('must not read live practice');
    },
  };
  let reads = 0;
  f.ctx.api.questions.get = async (key) => {
    assert.equal(key.roundId, 'round');
    if (++reads === 1) {
      throw { code: 'SNAPSHOT_STALE', status: 409 };
    }
    return latest;
  };
  f.ctx.api.history.overview = async (bankId, roundId) => {
    assert.equal(roundId, 'round');
    return { ...f.ctx.overview.value, snapshotId: 'new', states: [{ questionId: '1' }] };
  };
  // Even an unexpected completed-round response must never fall back to live practice.
  await mod.reloadAfterConflict(f.ctx, old, 7, { code: 'ROUND_COMPLETED', status: 409 });
  assert.equal(f.ctx.current.value, latest);
  assert.equal(f.ctx.overview.value.readOnly, true);
  assert.equal(f.ctx.runtime.returnPractice.question.questionId, 'live');
  assert.match(f.ctx.message.value, /已载入最新内容/);
});
