import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/stores/practice/restart.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
});
const { restart } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

function setup(send) {
  const calls = [],
    bodies = [];
  const old = { bank: { bankId: 'bank' }, snapshotId: 'old', completedAt: 'now' };
  const next = {
    bank: old.bank,
    snapshotId: 'new',
    completedAt: null,
    initial: { question: { questionId: '1' }, error: null },
    notice: null,
  };
  let busy = false;
  const ctx = {
    overview: { value: old },
    scoreView: { value: true },
    drawer: { value: null },
    drafting: { value: true },
    message: { value: '' },
    lastQuestions: { value: new Map([['bank', '6']]) },
    runtime: {
      restartRequest: null,
      nonce: 'n',
      queue: {
        enqueue: (f) => {
          calls.push('queue');
          return f();
        },
      },
      scratch: { setMode: (v) => calls.push(['mode', v]) },
      grader: { dispose: () => calls.push('grader-dispose') },
      completionGrader: { clear: () => calls.push('completion-clear') },
    },
    api: {
      banks: {
        restart: async (id, body) => {
          calls.push('send');
          bodies.push(body);
          return send ? send(next) : next;
        },
      },
    },
    actions: () => ({
      flush: async () => calls.push('flush'),
      clearQuestion: (v) => calls.push(['clear', v]),
      resetSources: () => calls.push('sources'),
      initializeRuntime: (n) => calls.push(['runtime', n]),
      show: async (q) => calls.push(['show', q.questionId]),
    }),
    run: async (_label, fn) => {
      if (busy) {
        return;
      }
      busy = true;
      try {
        await fn();
      } catch (e) {
        ctx.message.value = e.message;
      } finally {
        busy = false;
      }
    },
  };
  return { ctx, calls, bodies, old, next };
}

test('restart flushes then enqueues, blocks concurrent clicks, and resets old page/source/scoring sessions only on success', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = setup(async (next) => {
    await gate;
    return next;
  });
  const first = restart(f.ctx);
  await Promise.resolve();
  await restart(f.ctx);
  assert.equal(f.bodies.length, 1);
  assert.equal(f.ctx.overview.value, f.old);
  assert.equal(f.ctx.scoreView.value, true);
  release();
  await first;
  assert.deepEqual(f.calls, [
    'flush',
    'queue',
    'send',
    ['clear', true],
    'sources',
    'grader-dispose',
    'completion-clear',
    ['runtime', 'n'],
    ['mode', false],
    ['show', '1'],
  ]);
  assert.equal(f.ctx.overview.value, f.next);
  assert.equal(f.ctx.scoreView.value, false);
  assert.equal(f.ctx.lastQuestions.value.has('bank'), false);
  assert.equal(f.ctx.runtime.restartRequest, null);
});

test('restart failure leaves completed summary and input intact, and explicit retry reuses exact body/id', async () => {
  let fail = true;
  const f = setup((next) => {
    if (fail) {
      throw Error('response lost');
    }
    return next;
  });
  await restart(f.ctx);
  assert.equal(f.ctx.overview.value, f.old);
  assert.equal(f.ctx.scoreView.value, true);
  assert.match(f.ctx.message.value, /response lost/);
  assert.deepEqual(f.calls, ['flush', 'queue', 'send']);
  fail = false;
  await restart(f.ctx);
  assert.equal(f.bodies[0], f.bodies[1]);
  assert.ok(JSON.parse(f.bodies[0]).requestId);
});

test('restart never sends after a failed save barrier or for unfinished practice', async () => {
  const f = setup();
  f.ctx.actions = () => ({
    flush: async () => {
      throw Error('ink not saved');
    },
  });
  await restart(f.ctx);
  assert.equal(f.bodies.length, 0);
  assert.equal(f.ctx.scoreView.value, true);
  f.ctx.overview.value = { ...f.old, completedAt: null };
  await restart(f.ctx);
  assert.equal(f.ctx.runtime.restartRequest, null);
});
