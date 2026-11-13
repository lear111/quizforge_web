import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/grading.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser' });
const { createGradingService } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const input = id => [{ questionId: id, question: {}, solution: {}, answer: {}, item: { maxScore: 2 } }];
const result = id => [{ questionId: id, result: { score: 2 } }];
const normalized = id => [{ questionId: id, result: { score: 2, parts: null, message: null } }];
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(t, options = {}) {
  const dom = new JSDOM('<body></body>', { url: 'http://127.0.0.1:12345/' });
  const service = createGradingService({ document: dom.window.document, loadSource: async () => 'QF.grader.register({grade(){return {score:2}}});', ...options });
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
  assert.deepEqual(await pending, normalized('q1'));
  f.service.dispose(); assert.equal(f.frames().length, 0);
});

test('same type is FIFO and reuses its worker, while another type proceeds independently', async t => {
  const loads = [], f = fixture(t, { loadSource: async id => { loads.push(id); return ''; } });
  const a1 = f.service.grade('a', input('a1')), a2 = f.service.grade('a', input('a2')), b1 = f.service.grade('b', input('b1'));
  await turn(); assert.deepEqual(loads, ['a', 'b']); assert.equal(f.frames().length, 2);
  const a = f.observe(f.frames()[0]), b = f.observe(f.frames()[1]);
  a.send({ ready: true }); b.send({ ready: true }); await turn();
  assert.equal(a.messages.length, 1);
  b.send({ job: b.messages[0].job, results: result('b1') }); assert.deepEqual(await b1, normalized('b1'));
  a.send({ job: a.messages[0].job, results: result('a1') }); assert.deepEqual(await a1, normalized('a1'));
  await turn(); assert.equal(a.messages.length, 2);
  a.send({ job: a.messages[1].job, results: result('a2') }); assert.deepEqual(await a2, normalized('a2'));
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
  const expired = await first; assert.equal(expired[0].result.score, null); assert.match(expired[0].result.message, /超时/);
  assert.equal(f.frames().length, 0);
  const next = f.service.grade('a', input('q2')); await turn();
  assert.equal(loads, 2);
  const current = f.observe(f.frames()[0]); current.send({ ready: true }); await turn();
  let done = false; void next.then(() => { done = true; });
  old.send({ job: oldJob, results: result('old') }); await turn(); assert.equal(done, false);
  current.send({ job: current.messages[0].job, results: result('q2') }); assert.deepEqual(await next, normalized('q2'));
});

test('closing during source loading aborts it and queued jobs cannot create late frames', async t => {
  let resolveSource, signal;
  const f = fixture(t, { loadSource: async (_id, suppliedSignal) => { signal = suppliedSignal; return new Promise(resolve => { resolveSource = resolve; }); } });
  const first = f.service.grade('a', input('one')), second = f.service.grade('a', input('two'));
  await turn(); f.service.dispose(); assert.equal(signal.aborted, true);
  assert.equal((await first)[0].result.score, null);
  assert.equal((await second)[0].result.score, null);
  resolveSource(''); await turn(); assert.equal(f.frames().length, 0);
  assert.equal((await f.service.grade('b', input('three')))[0].result.score, null);
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
  fresh.send({ job: fresh.messages[0].job, results: result('q2') }); assert.deepEqual(await next, normalized('q2'));
});

test('source fetch and worker startup failure do not poison subsequent work', async t => {
  let loads = 0;
  const f = fixture(t, { loadSource: async () => { if (++loads === 1) throw Error('offline'); return ''; } });
  assert.equal((await f.service.grade('a', input('q1')))[0].result.score, null);
  const second = f.service.grade('a', input('q2')); await turn();
  const bad = f.observe(f.frames()[0]); bad.send({ error: true });
  assert.equal((await second)[0].result.score, null); assert.equal(f.frames().length, 0);
  const third = f.service.grade('a', input('q3')); await turn();
  const good = f.observe(f.frames()[0]); good.send({ ready: true }); await turn();
  good.send({ job: good.messages[0].job, results: result('q3') }); assert.deepEqual(await third, normalized('q3'));
});

test('untrusted worker results are projected to the input IDs, order and length with invalid entries ungradable', async t => {
  const f = fixture(t);
  let serial = 0;
  const run = async (ids, payload) => {
    const pending = f.service.grade('shape-' + serial++, ids.flatMap(input)); await turn();
    const probe = f.observe(f.frames().at(-1)); probe.send({ ready: true }); await turn();
    probe.send({ job: probe.messages[0].job, results: payload });
    return pending;
  };
  for (const payload of [null, {}, 'not an array', 42]) {
    const rows = await run(['q1', 'q2'], payload);
    assert.deepEqual(rows.map(row => row.questionId), ['q1', 'q2']);
    assert.ok(rows.every(row => row.result.score === null && typeof row.result.message === 'string'));
  }
  const rows = await run(['q2', 'q1', 'missing', 'duplicate', 'array'], [
    ...result('foreign'), ...result('q1'), { questionId: 'q2', result: null },
    ...result('duplicate'), ...result('duplicate'), { questionId: 'array', result: [] },
  ]);
  assert.deepEqual(rows.map(row => row.questionId), ['q2', 'q1', 'missing', 'duplicate', 'array']);
  assert.equal(rows[1].result.score, 2);
  assert.ok(rows.filter(row => row.questionId !== 'q1').every(row => row.result.score === null && typeof row.result.message === 'string'));
});

test('grading distinguishes a request for human review from a thrown or malformed grade', async t => {
  const f = fixture(t), pending = f.service.grade('new-contract', ['waiting', 'thrown', 'bad', 'parts'].flatMap(input));
  await turn();
  const probe = f.observe(f.frames()[0]); probe.send({ ready: true }); await turn();
  probe.send({ job: probe.messages[0].job, results: [
    { questionId: 'waiting', result: { score: null } },
    { questionId: 'thrown', error: '合成评分失败' },
    { questionId: 'bad', result: { score: 2, message: 'grade cannot set a message' } },
    { questionId: 'parts', result: { score: 2, parts: { x: 2 } } },
  ] });
  const rows = (await pending).map(row => row.result);
  assert.deepEqual(rows[0], { score: null, parts: null, message: null });
  assert.deepEqual(rows[1], { score: null, parts: null, message: '合成评分失败' });
  assert.equal(rows[2].score, null); assert.match(rows[2].message, /无效/);
  assert.deepEqual(rows[3], { score: 2, parts: { x: 2 }, message: null });
});
