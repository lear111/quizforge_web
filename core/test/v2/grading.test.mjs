import assert from 'node:assert/strict';
import { test } from 'node:test';
import { input, result, normalized, turn, fixture } from '../fixtures/v2-grading.mjs';

test('same type is FIFO and reuses its worker, while another type proceeds independently', async (t) => {
  const loads = [],
    f = fixture(t, {
      loadSource: async (id) => {
        loads.push(id);
        return '';
      },
    });
  const a1 = f.service.grade('a', input('a1')),
    a2 = f.service.grade('a', input('a2')),
    b1 = f.service.grade('b', input('b1'));
  await turn();
  assert.deepEqual(loads, ['a', 'b']);
  assert.equal(f.frames().length, 2);
  const a = f.observe(f.frames()[0]),
    b = f.observe(f.frames()[1]);
  a.send({ ready: true });
  b.send({ ready: true });
  await turn();
  assert.equal(a.messages.length, 1);
  b.send({ job: b.messages[0].job, results: result('b1') });
  assert.deepEqual(await b1, normalized('b1'));
  a.send({ job: a.messages[0].job, results: result('a1') });
  assert.deepEqual(await a1, normalized('a1'));
  await turn();
  assert.equal(a.messages.length, 2);
  a.send({ job: a.messages[1].job, results: result('a2') });
  assert.deepEqual(await a2, normalized('a2'));
  assert.deepEqual(loads, ['a', 'b']);
  assert.equal(f.frames().length, 2);
});

test('default batch deadline removes the failed environment; the next call creates a new one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const f = fixture(t, {
    loadSource: async () => {
      loads++;
      return '';
    },
  });
  const first = f.service.grade('a', input('q1'));
  await turn();
  const old = f.observe(f.frames()[0]);
  old.send({ ready: true });
  await turn();
  const oldJob = old.messages[0].job;
  t.mock.timers.tick(9999);
  await turn();
  assert.equal(f.frames().length, 1);
  t.mock.timers.tick(1);
  const expired = await first;
  assert.equal(expired[0].result.score, null);
  assert.match(expired[0].result.message, /超时/);
  assert.equal(f.frames().length, 0);
  const next = f.service.grade('a', input('q2'));
  await turn();
  assert.equal(loads, 2);
  const current = f.observe(f.frames()[0]);
  current.send({ ready: true });
  await turn();
  let done = false;
  void next.then(() => {
    done = true;
  });
  old.send({ job: oldJob, results: result('old') });
  await turn();
  assert.equal(done, false);
  current.send({ job: current.messages[0].job, results: result('q2') });
  assert.deepEqual(await next, normalized('q2'));
});

test('closing during source loading aborts it and queued jobs cannot create late frames', async (t) => {
  let resolveSource, signal;
  const f = fixture(t, {
    loadSource: async (_id, suppliedSignal) => {
      signal = suppliedSignal;
      return new Promise((resolve) => {
        resolveSource = resolve;
      });
    },
  });
  const first = f.service.grade('a', input('one')),
    second = f.service.grade('a', input('two'));
  await turn();
  f.service.dispose();
  assert.equal(signal.aborted, true);
  assert.equal((await first)[0].result.score, null);
  assert.equal((await second)[0].result.score, null);
  resolveSource('');
  await turn();
  assert.equal(f.frames().length, 0);
  assert.equal((await f.service.grade('b', input('three')))[0].result.score, null);
});

test('an idle environment is reclaimed and a later job loads a fresh one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const f = fixture(t, {
    loadSource: async () => {
      loads++;
      return '';
    },
  });
  const first = f.service.grade('a', input('q1'));
  await turn();
  const probe = f.observe(f.frames()[0]);
  probe.send({ ready: true });
  await turn();
  probe.send({ job: probe.messages[0].job, results: result('q1') });
  await first;
  t.mock.timers.tick(59_999);
  assert.equal(f.frames().length, 1);
  t.mock.timers.tick(1);
  assert.equal(f.frames().length, 0);
  const next = f.service.grade('a', input('q2'));
  await turn();
  assert.equal(loads, 2);
  const fresh = f.observe(f.frames()[0]);
  fresh.send({ ready: true });
  await turn();
  fresh.send({ job: fresh.messages[0].job, results: result('q2') });
  assert.deepEqual(await next, normalized('q2'));
});

test('source fetch and worker startup failure do not poison subsequent work', async (t) => {
  let loads = 0;
  const f = fixture(t, {
    loadSource: async () => {
      if (++loads === 1) {
        throw Error('offline');
      }
      return '';
    },
  });
  assert.equal((await f.service.grade('a', input('q1')))[0].result.score, null);
  const second = f.service.grade('a', input('q2'));
  await turn();
  const bad = f.observe(f.frames()[0]);
  bad.send({ error: true });
  assert.equal((await second)[0].result.score, null);
  assert.equal(f.frames().length, 0);
  const third = f.service.grade('a', input('q3'));
  await turn();
  const good = f.observe(f.frames()[0]);
  good.send({ ready: true });
  await turn();
  good.send({ job: good.messages[0].job, results: result('q3') });
  assert.deepEqual(await third, normalized('q3'));
});

test('deadline includes source loading and its late resolution cannot replace the next environment', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveSource,
    signal,
    loads = 0;
  const f = fixture(t, {
    loadSource: async (_id, suppliedSignal) => {
      if (++loads === 1) {
        signal = suppliedSignal;
        return new Promise((resolve) => {
          resolveSource = resolve;
        });
      }
      return '';
    },
  });
  const first = f.service.grade('a', input('q1')),
    second = f.service.grade('a', input('q2'));
  await turn();
  t.mock.timers.tick(10_000);
  assert.deepEqual(await first, [
    {
      questionId: 'q1',
      result: { score: null, parts: null, message: '评分超时，请重新评分。' },
    },
  ]);
  assert.equal(signal.aborted, true);
  await turn();
  const frame = f.frames()[0],
    probe = f.observe(frame);
  resolveSource('throw new Error("late source must not execute");');
  await turn();
  assert.deepEqual(f.frames(), [frame]);
  probe.send({ ready: true });
  await turn();
  probe.send({ job: probe.messages[0].job, results: result('q2') });
  assert.deepEqual(await second, normalized('q2'));
});
