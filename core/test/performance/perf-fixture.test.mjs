import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerfFixture } from '../../scripts/dev/create-perf-fixture.mjs';
import { measurePerf, summarizeSamples, parseServerTiming } from '../../scripts/dev/measure-perf.mjs';
import { QuizForgeServer } from '../../server/host/http/server.js';
import { fileURLToPath } from 'node:url';
const codeRoot = fileURLToPath(new URL('../../', import.meta.url));

test('synthetic fixture is reopenable, has 200 questions, outline, 32 receipts and two frozen rounds', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-perf-test-'));
  t.after(() => { assert.equal(path.dirname(parent), os.tmpdir()); assert.ok(path.basename(parent).startsWith('qf-perf-test-')); fs.rmSync(parent, { recursive: true, force: true }); });
  const root = path.join(parent, 'fixture'), fixture = await createPerfFixture(root);
  assert.equal(fixture.questions, 200); assert.equal(fixture.receipts, 32); assert.equal(fixture.historyRounds, 2);
  assert.ok(fixture.stateBytes > 4_900_000 && fixture.stateBytes < 5_100_000);
  await assert.rejects(createPerfFixture(root), /exist/i);
  const before = fs.readFileSync(path.join(root, fixture.stateFile));
  const service = await QuizForgeServer.create({ root, codeRoot, port: 0, tailscale: { read: async () => ({ state: 'missing' }) } });
  try {
    await service.start(); const base = `http://127.0.0.1:${service.port()}/api/collections/bank/perf-bank`;
    const opened = await fetch(base); assert.equal(opened.status, 200);
    const overview = await opened.json(); assert.equal(overview.questions.length, 200); assert.ok(overview.questions.some(q => q.outlineItems?.length === 3));
    const history = await fetch(base + '/history'); assert.equal(history.status, 200); const records = (await history.json()).records; assert.equal(records.length, 2);
    const frozen = await fetch(base + '/history/' + records[0].id); assert.equal(frozen.status, 200); assert.equal((await frozen.json()).questions.length, 200);
    assert.deepEqual(fs.readFileSync(path.join(root, fixture.stateFile)), before, 'reading does not rewrite old state');
    const response = await fetch(base + '/questions/q001'); assert.equal(response.status, 200);
    for (const phase of ['library', 'state-load', 'rules', 'clone', 'persist', 'queue']) assert.match(response.headers.get('server-timing'), new RegExp(phase + ';dur='));
    assert.equal((await fetch(`http://127.0.0.1:${service.port()}/api/health`)).headers.get('server-timing'), null);
    const invalid = await fetch(base + '/questions/missing'); assert.equal(invalid.status, 404); assert.ok(invalid.headers.get('server-timing'));
    service.timings = false;
    const disabled = await fetch(base + '/questions/q001'); assert.equal(disabled.status, 200); assert.equal(disabled.headers.get('server-timing'), null);
    assert.deepEqual(fs.readFileSync(path.join(root, fixture.stateFile)), before);
  } finally { await service.close(); }
  // A short smoke run uses a separate copy and does not mutate the seed fixture.
  const result = await measurePerf(root, { runs: 1, counts: { switch: 1, draft: 1, whiteboard: 1, submit: 1 } });
  assert.equal(result.samples.length, 5); assert.deepEqual(fs.readFileSync(path.join(root, fixture.stateFile)), before);
});

test('benchmark nearest rank median and P95 are derived from samples, never estimated', () => {
  assert.deepEqual(summarizeSamples([4, 1, 3, 2]), { n: 4, median: 2.5, p95: 4 });
  assert.throws(() => parseServerTiming('clone;dur=1, incomplete;desc="interval limit"'), /incomplete/);
  assert.throws(() => parseServerTiming('not-a-measurement'), /Invalid/);
});
