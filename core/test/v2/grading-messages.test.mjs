import assert from 'node:assert/strict';
import { test } from 'node:test';
import { input, result, normalized, turn, fixture } from '../fixtures/v2-grading.mjs';

test('grading accepts only the owning frame, channel and current job; disposes the frame', async (t) => {
  const f = fixture(t, { scriptNonce: 'host-boot-nonce' }),
    pending = f.service.grade('type-a', input('q1'));
  await turn();
  const frame = f.frames()[0],
    probe = f.observe(frame);
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.ok(!frame.getAttribute('sandbox').includes('allow-same-origin'));
  assert.match(frame.srcdoc, /connect-src 'none'/);
  assert.match(frame.srcdoc, /script-src 'nonce-host-boot-nonce'/);
  assert.match(frame.srcdoc, /<script nonce="host-boot-nonce">/);
  probe.send({ ready: true });
  await turn();
  const request = probe.messages[0];
  assert.equal(request.items[0].questionId, 'q1');
  let finished = false;
  void pending.then(() => {
    finished = true;
  });
  probe.send({ job: request.job, results: result('forged') }, f.dom.window);
  probe.send({ job: request.job, channel: 'wrong', results: result('forged') });
  probe.send({ job: 'old', results: result('forged') });
  await turn();
  assert.equal(finished, false);
  probe.send({ job: request.job, results: result('q1') });
  assert.deepEqual(await pending, normalized('q1'));
  f.service.dispose();
  assert.equal(f.frames().length, 0);
});

test('message priority remains error then ready then current job result', async (t) => {
  const f = fixture(t),
    pending = f.service.grade('a', input('q1'));
  await turn();
  const probe = f.observe(f.frames()[0]);
  probe.send({ ready: true });
  await turn();
  const job = probe.messages[0].job;
  let finished = false;
  void pending.then(() => {
    finished = true;
  });
  probe.send({ ready: true, job, results: result('q1') });
  await turn();
  assert.equal(finished, false, 'a ready message cannot also resolve a job');
  probe.send({ error: true, ready: true, job, results: result('q1') });
  assert.deepEqual(await pending, [
    {
      questionId: 'q1',
      result: { score: null, parts: null, message: '评分环境执行失败，请重试。' },
    },
  ]);
  assert.equal(f.frames().length, 0);
});

test('postMessage failure discards the environment and the next queued job recovers', async (t) => {
  const f = fixture(t),
    first = f.service.grade('a', input('q1')),
    second = f.service.grade('a', input('q2'));
  await turn();
  const frame = f.frames()[0],
    probe = f.observe(frame);
  frame.contentWindow.postMessage = () => {
    throw new DOMException('synthetic', 'DataCloneError');
  };
  probe.send({ ready: true });
  assert.deepEqual(await first, [
    {
      questionId: 'q1',
      result: { score: null, parts: null, message: '评分环境执行失败，请重试。' },
    },
  ]);
  await turn();
  assert.equal(frame.isConnected, false);
  assert.equal(f.frames().length, 1);
  const next = f.observe(f.frames()[0]);
  next.send({ ready: true });
  await turn();
  next.send({ job: next.messages[0].job, results: result('q2') });
  assert.deepEqual(await second, normalized('q2'));
});
