import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

const WARMUP = 5, SAMPLES = 30;
const SAVE_PHASES = ['parse', 'validate', 'serialize', 'write', 'other', 'total'];

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  const median = (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2;
  return { n, medianMs: +median.toFixed(3), p95Ms: +sorted[Math.ceil(n * .95) - 1].toFixed(3) };
}

async function request(origin, route, fields) {
  const started = performance.now();
  const response = await fetch(origin + route, {
    signal: AbortSignal.timeout(5000),
    ...(fields === undefined ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) })
  });
  const body = await response.text(), elapsed = performance.now() - started;
  const value = JSON.parse(body);
  assert.equal(response.status, 200, `${route}: ${value.error?.code ?? response.status}`);
  assert.doesNotMatch(body, new RegExp(SOLUTION_MARKER), 'unlocked requests cannot expose the solution');
  const header = response.headers.get('Server-Timing');
  if (fields !== undefined) assert.ok(header, 'save timing is required');
  const timing = fields === undefined ? null : Object.fromEntries(header.split(', ').map(field => {
    const match = /^([a-z]+);dur=(\d+(?:\.\d+)?)$/.exec(field);
    assert.ok(match, `invalid Server-Timing entry: ${field}`);
    return [match[1], Number(match[2])];
  }));
  if (timing) {
    assert.deepEqual(Object.keys(timing).sort(), [...SAVE_PHASES].sort());
    const segments = SAVE_PHASES.filter(phase => phase !== 'total').reduce((sum, phase) => sum + timing[phase], 0);
    assert.ok(Math.abs(segments - timing.total) <= .0031, 'phase sum differs from total by more than the header rounding tolerance');
  }
  return { elapsed, timing, value };
}

for (const count of [20, 200]) test(`V2 loopback performance: open, read and save (${count} questions)`, async t => {
  const fixture = createReadFixture({ count });
  let server;
  try {
    server = await new V2Server(fixture).start();
    const origin = `http://127.0.0.1:${server.port()}`;
    const catalog = (await request(origin, '/api/v2/catalog')).value;
    const base = `/api/v2/banks/${catalog.groups[0].items[0].bankId}`;
    const samples = { overview: [], question: [], answer: [], ink: [] };
    const answerSamples = [], inkSamples = [];
    let previousSnapshot;
    for (let index = 0; index < WARMUP + SAMPLES; index++) {
      const opened = await request(origin, base + '/overview');
      const { snapshotId, states, initial } = opened.value;
      assert.equal(states.length, count);
      assert.equal(initial.question.questionId, '1');
      assert.equal(initial.question.state.revision, index);
      assert.equal(initial.question.state.status, index ? 'answered' : 'unanswered');
      if (previousSnapshot !== undefined) assert.equal(snapshotId, previousSnapshot);
      previousSnapshot = snapshotId;

      const read = await request(origin, `${base}/questions/2?snapshotId=${snapshotId}`);
      assert.equal(read.value.questionId, '2');
      const answer = { selected: index % 2 ? '甲' : '乙' };
      const saved = await request(origin, `${base}/questions/1/answer`, { snapshotId, requestId: `answer-${index}`, expectedRevision: index, answer, answered: true });
      assert.equal(saved.value.state.revision, index + 1);
      assert.equal(saved.value.state.status, 'answered');
      assert.deepEqual(saved.value.answer, answer);
      const ink = { strokes: [{ points: [[0, 0], [index, 1]] }] };
      const inkSaved = await request(origin, `${base}/questions/1/ink`, { snapshotId, requestId: `ink-${index}`, expectedInkRevision: index, ink });
      assert.equal(inkSaved.value.inkRevision, index + 1);
      assert.equal(inkSaved.value.state.revision, index + 1);

      if (index >= WARMUP) {
        for (const [name, sample] of Object.entries({ overview: opened, question: read, answer: saved, ink: inkSaved })) samples[name].push(sample.elapsed);
        answerSamples.push(saved.timing); inkSamples.push(inkSaved.timing);
      }
    }
    // Open the on-disk progress with a new server so a response alone cannot
    // make this measurement pass if the saves stopped reaching persistent storage.
    await server.close();
    server = await new V2Server(fixture).start();
    const reopened = (await request(`http://127.0.0.1:${server.port()}`, base + '/overview')).value.initial.question;
    const last = WARMUP + SAMPLES - 1;
    assert.equal(reopened.state.revision, last + 1);
    assert.deepEqual(reopened.answer, { selected: last % 2 ? '甲' : '乙' });
    assert.equal(reopened.inkRevision, last + 1);
    assert.deepEqual(reopened.ink, { strokes: [{ points: [[0, 0], [last, 1]] }] });

    const phases = values => Object.fromEntries(SAVE_PHASES.map(phase => [phase, summarize(values.map(row => row[phase]))]));
    t.diagnostic(JSON.stringify({ count, warmup: WARMUP, client: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, summarize(values)])), server: { answer: phases(answerSamples), ink: phases(inkSamples) } }));
  } finally {
    try { await server?.close(); } finally { fixture.cleanup(); }
  }
});
