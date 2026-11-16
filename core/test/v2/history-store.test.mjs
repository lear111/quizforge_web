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
      export {toggleDraft} from './stores/practice/runtime';`,
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

test('historical context is locked; grading, retry, submission and whiteboard actions never invoke writers', async () => {
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
  await mod.toggleDraft(f.ctx);
  assert.equal(f.ctx.drafting.value, false);
});

test('history API scopes reads to the round and rejects all answer/ink/submit/retry/result writes locally', async () => {
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
    () => api.prepareInk(q, {}),
    () => api.submit(q, 'attack'),
    () => api.retry(q),
    () => api.result(q, {}),
  ]) {
    assert.throws(action, /只读/);
  }
  assert.equal(calls.length, 2);
});
