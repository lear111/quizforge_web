import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/grading.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createGradingService } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const input = id => [{ questionId: id, question: {}, solution: {}, answer: {}, item: { maxScore: 2 } }];
const result = id => [{ questionId: id, result: { status: 'graded', score: 2 } }];
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(t, options = {}) {
  const dom = new JSDOM('<body></body>', { url: 'http://127.0.0.1:12345/' });
  const service = createGradingService({ document: dom.window.document, loadSource: async () => 'QF.grader.register({grade(){return {score:2,status:"graded"}}});', ...options });
  t.after(() => { service.dispose(); dom.window.close(); });
  const frames = () => [...dom.window.document.querySelectorAll('iframe')];
  const observe = frame => {
    const messages = [];
    frame.contentWindow.postMessage = data => messages.push(data);
    const channel = /const channel = ("[^"]+")/.exec(frame.srcdoc);
    assert.ok(channel, 'real production srcdoc has a scoped channel');
    const send = (data, source = frame.contentWindow) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data: { channel: JSON.parse(channel[1]), ...data } }));
    return { messages, send };
  };
  return { dom, service, frames, observe };
}

test('grading accepts only the owning frame, channel and current job; disposes the frame', async t => {
  const f = fixture(t, { scriptNonce: 'host-boot-nonce' }), pending = f.service.grade('type-a', input('q1'));
  await turn();
  const frame = f.frames()[0], probe = f.observe(frame);
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.ok(!frame.getAttribute('sandbox').includes('allow-same-origin'));
  assert.match(frame.srcdoc, /connect-src 'none'/);
  assert.match(frame.srcdoc, /script-src 'nonce-host-boot-nonce'/);
  assert.match(frame.srcdoc, /<script nonce="host-boot-nonce">/);
  probe.send({ ready: true }); await turn();
  const request = probe.messages[0]; assert.equal(request.items[0].questionId, 'q1');
  let finished = false; void pending.then(() => { finished = true; });
  probe.send({ job: request.job, results: result('forged') }, f.dom.window);
  probe.send({ job: request.job, channel: 'wrong', results: result('forged') });
  probe.send({ job: 'old', results: result('forged') });
  await turn(); assert.equal(finished, false);
  probe.send({ job: request.job, results: result('q1') });
  assert.deepEqual(await pending, result('q1'));
  f.service.dispose(); assert.equal(f.frames().length, 0);
});

test('same type is FIFO and reuses its worker, while another type proceeds independently', async t => {
  const loads = [], f = fixture(t, { loadSource: async id => { loads.push(id); return ''; } });
  const a1 = f.service.grade('a', input('a1')), a2 = f.service.grade('a', input('a2')), b1 = f.service.grade('b', input('b1'));
  await turn(); assert.deepEqual(loads, ['a', 'b']); assert.equal(f.frames().length, 2);
  const a = f.observe(f.frames()[0]), b = f.observe(f.frames()[1]);
  a.send({ ready: true }); b.send({ ready: true }); await turn();
  assert.equal(a.messages.length, 1);
  b.send({ job: b.messages[0].job, results: result('b1') }); assert.deepEqual(await b1, result('b1'));
  a.send({ job: a.messages[0].job, results: result('a1') }); assert.deepEqual(await a1, result('a1'));
  await turn(); assert.equal(a.messages.length, 2);
  a.send({ job: a.messages[1].job, results: result('a2') }); assert.deepEqual(await a2, result('a2'));
  assert.deepEqual(loads, ['a', 'b']); assert.equal(f.frames().length, 2);
});

test('default batch deadline removes the failed environment; the next call creates a new one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const f = fixture(t, { loadSource: async () => { loads++; return ''; } });
  const first = f.service.grade('a', input('q1')); await turn();
  const old = f.observe(f.frames()[0]); old.send({ ready: true }); await turn();
  const oldJob = old.messages[0].job;
  t.mock.timers.tick(9999); await turn(); assert.equal(f.frames().length, 1);
  t.mock.timers.tick(1);
  const expired = await first; assert.equal(expired[0].result.status, 'ungradable'); assert.match(expired[0].result.reason, /超时/);
  assert.equal(f.frames().length, 0);
  const next = f.service.grade('a', input('q2')); await turn();
  assert.equal(loads, 2);
  const current = f.observe(f.frames()[0]); current.send({ ready: true }); await turn();
  let done = false; void next.then(() => { done = true; });
  old.send({ job: oldJob, results: result('old') }); await turn(); assert.equal(done, false);
  current.send({ job: current.messages[0].job, results: result('q2') }); assert.deepEqual(await next, result('q2'));
});

test('closing during source loading aborts it and queued jobs cannot create late frames', async t => {
  let resolveSource, signal;
  const f = fixture(t, { loadSource: async (_id, suppliedSignal) => { signal = suppliedSignal; return new Promise(resolve => { resolveSource = resolve; }); } });
  const first = f.service.grade('a', input('one')), second = f.service.grade('a', input('two'));
  await turn(); f.service.dispose(); assert.equal(signal.aborted, true);
  assert.equal((await first)[0].result.status, 'ungradable');
  assert.equal((await second)[0].result.status, 'ungradable');
  resolveSource(''); await turn(); assert.equal(f.frames().length, 0);
  assert.equal((await f.service.grade('b', input('three')))[0].result.status, 'ungradable');
});

test('an idle environment is reclaimed and a later job loads a fresh one', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const f = fixture(t, { loadSource: async () => { loads++; return ''; } });
  const first = f.service.grade('a', input('q1')); await turn();
  const probe = f.observe(f.frames()[0]); probe.send({ ready: true }); await turn();
  probe.send({ job: probe.messages[0].job, results: result('q1') }); await first;
  t.mock.timers.tick(59_999); assert.equal(f.frames().length, 1);
  t.mock.timers.tick(1); assert.equal(f.frames().length, 0);
  const next = f.service.grade('a', input('q2')); await turn(); assert.equal(loads, 2);
  const fresh = f.observe(f.frames()[0]); fresh.send({ ready: true }); await turn();
  fresh.send({ job: fresh.messages[0].job, results: result('q2') }); assert.deepEqual(await next, result('q2'));
});

test('source fetch and worker startup failure do not poison subsequent work', async t => {
  let loads = 0;
  const f = fixture(t, { loadSource: async () => { if (++loads === 1) throw Error('offline'); return ''; } });
  assert.equal((await f.service.grade('a', input('q1')))[0].result.status, 'ungradable');
  const second = f.service.grade('a', input('q2')); await turn();
  const bad = f.observe(f.frames()[0]); bad.send({ error: true });
  assert.equal((await second)[0].result.status, 'ungradable'); assert.equal(f.frames().length, 0);
  const third = f.service.grade('a', input('q3')); await turn();
  const good = f.observe(f.frames()[0]); good.send({ ready: true }); await turn();
  good.send({ job: good.messages[0].job, results: result('q3') }); assert.deepEqual(await third, result('q3'));
});
