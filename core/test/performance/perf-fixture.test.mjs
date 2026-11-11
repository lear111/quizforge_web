import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPerfFixture, perfAnswer } from '../../scripts/dev/create-perf-fixture.mjs';
import { jsonBytes } from '../../server/host/platform/json.js';
import { measurePerf, summarizeSamples, parseServerTiming } from '../../scripts/dev/measure-perf.mjs';
import { QuizForgeServer } from '../../server/host/http/server.js';
import { fileURLToPath } from 'node:url';
import { within } from '../../server/host/platform/files.js';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const codeRoot = fileURLToPath(new URL('../../', import.meta.url));

test('v2 fixture distributes ink and receipts, uses real choice rules and preserves frozen history', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-perf-test-'));
  t.after(() => { assert.equal(path.dirname(parent), os.tmpdir()); assert.ok(path.basename(parent).startsWith('qf-perf-test-')); fs.rmSync(parent, { recursive: true, force: true }); });
  const root = path.join(parent, 'fixture'), fixture = await createPerfFixture(root);
  assert.equal(fixture.fixture, 'quizforge-perf-a1-v2');
  assert.equal(fixture.questions, 200); assert.equal(fixture.historyRounds, 2);
  assert.ok(fixture.stateBytes > 4_900_000 && fixture.stateBytes < 5_100_000);
  await assert.rejects(createPerfFixture(root), /exist/i);
  const before = fs.readFileSync(path.join(root, fixture.stateFile));
  await t.test('readonly S1 inspection matches the v2 breakdown and leaves every state hash unchanged', () => {
    const script = path.join(codeRoot, 'scripts/dev/inspect-state-sizes.mjs');
    const run = spawnSync(process.execPath, [script, root], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stderr, '');
    const [row, summary] = run.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(row.bytes, fixture.stateBytes); assert.deepEqual(row.breakdown, fixture.breakdown);
    assert.equal(row.questions, 200); assert.equal(row.questionsWithRecords, 200); assert.equal(row.historyRounds.count, 2);
    assert.equal(row.historyRounds.bytes, fixture.breakdown.history); assert.equal(row.unchanged, true);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(row.sha256Before, sha(before)); assert.equal(row.sha256After, sha(before));
    assert.equal(summary.files, 1); assert.equal(summary.hashesUnchanged, true); assert.equal(summary.fileSetUnchanged, true);
    assert.deepEqual(fs.readFileSync(path.join(root, fixture.stateFile)), before);
  });
  const saved = JSON.parse(before), states = Object.values(saved.questions);
  assert.equal(states.length, 200);
  // Zero tolerance: other includes all keys, commas and enclosing structure.
  assert.equal(Object.values(fixture.breakdown).reduce((sum, bytes) => sum + bytes, 0), fixture.stateBytes);
  const receipts = states.reduce((sum, state) => sum + jsonBytes(state.receipts).length, 0);
  const ink = states.reduce((sum, state) => sum + jsonBytes(state.draft).length, 0);
  const history = jsonBytes(saved.historyRounds).length;
  assert.deepEqual(fixture.breakdown, { receipts, ink, history, other: before.length - receipts - ink - history });
  assert.equal(states.filter(state => state.draft?.strokes?.length > 0).length, 200);
  assert.ok(states.filter(state => jsonBytes(state.draft).length >= 20 * 1024 && jsonBytes(state.draft).length <= 50 * 1024).length >= 40);
  const withReceipts = states.filter(state => state.receipts.length);
  assert.ok(withReceipts.length >= 40);
  assert.equal(withReceipts.reduce((sum, state) => sum + state.receipts.length, 0), fixture.receipts);
  for (const state of withReceipts) {
    assert.ok(state.receipts.length >= 8 && state.receipts.length <= 32);
    assert.deepEqual(new Set(state.receipts.map(receipt => receipt.request.action)), new Set(['draft', 'whiteboard']));
    assert.ok(state.receipts.every(receipt => receipt.request && receipt.response));
  }
  for (const [id, state] of Object.entries(saved.questions)) {
    assert.ok(jsonBytes(state).length <= before.length * .05, id + ' must not dominate current state');
    const frozen = saved.historyRounds.flatMap(round => round.questions.filter(entry => entry.payload.question.id === id));
    assert.ok(jsonBytes(state).length + frozen.reduce((sum, entry) => sum + jsonBytes(entry).length, 0) <= before.length * .05, id + ' including frozen entries must stay below 5%');
  }
  const source = path.resolve(codeRoot, '../extensions/基础题型/单选题');
  for (const name of ['question.schema.json', 'answer.schema.json', 'rules.js']) {
    assert.deepEqual(fs.readFileSync(path.join(root, 'extensions/Perf/type0', name)), fs.readFileSync(path.join(source, name)));
  }
  for (const name of ['question.schema.json', 'answer.schema.json']) assert.notEqual(JSON.parse(fs.readFileSync(path.join(root, 'extensions/Perf/type0', name))), true);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extensions/Perf/type0/manifest.json')));
  const original = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  assert.deepEqual(manifest.requiresApi, original.requiresApi);
  assert.deepEqual(manifest.requiresRichText, original.requiresRichText);
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
    const draft = await fetch(base + '/questions/q001/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'draft', requestId: 'real-choice-draft', revision: overview.states.q001.revision, data: { answer: perfAnswer(0) } }) });
    assert.equal(draft.status, 200); const drafted = await draft.json(); assert.deepEqual(drafted.state.answer, { selectedOptionId: 'A' });
    await t.test('a warm HTTP draft performs zero full dependency walks and seven sentinel stats',async()=>{
      let full=0,sentinelStats=0,directoryReads=0;
      const validate=service.engine.validationEnvironment.bind(service.engine),stat=fs.lstatSync,read=fs.readdirSync;
      const dependencies=['ajv','fast-uri','fast-deep-equal','json-schema-traverse','require-from-string'];
      const sentinels=new Set([process.execPath,path.join(codeRoot,'server/rules-runner.cjs'),...dependencies.map(name=>path.join(codeRoot,'node_modules',name,'package.json'))].map(file=>path.resolve(file)));
      service.engine.validationEnvironment=(...args)=>{full++;return validate(...args);};
      fs.lstatSync=function(file,...args){if(sentinels.has(path.resolve(String(file))))sentinelStats++;return stat.call(this,file,...args);};
      fs.readdirSync=function(file,...args){if(within(path.join(codeRoot,'node_modules'),String(file)))directoryReads++;return read.call(this,file,...args);};
      try{
        const response=await fetch(base+'/questions/q001/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'draft',requestId:'sentinel-warm-draft',revision:drafted.state.revision,data:{answer:perfAnswer(0)}})});
        assert.equal(response.status,200);assert.deepEqual((await response.json()).state.answer,{selectedOptionId:'A'});
        assert.equal(full,0);assert.equal(directoryReads,0,'no dependency walkEntries can run without accessing a dependency directory');assert.equal(sentinelStats,7);
      }finally{fs.lstatSync=stat;fs.readdirSync=read;service.engine.validationEnvironment=validate;}
    });
  } finally { await service.close(); }
  // Restore only our synthetic seed after the deliberate write validation.
  fs.writeFileSync(path.join(root, fixture.stateFile), before);
  // A short smoke run uses a separate copy and does not mutate the seed fixture.
  const result = await measurePerf(root, { runs: 1, counts: { switch: 1, draft: 1, whiteboard: 1, submit: 1 } });
  assert.equal(result.samples.length, 5); assert.deepEqual(fs.readFileSync(path.join(root, fixture.stateFile)), before);
});

test('benchmark nearest rank median and P95 are derived from samples, never estimated', () => {
  assert.deepEqual(summarizeSamples([4, 1, 3, 2]), { n: 4, median: 2.5, p95: 4 });
  assert.throws(() => parseServerTiming('clone;dur=1, incomplete;desc="interval limit"'), /incomplete/);
  assert.throws(() => parseServerTiming('not-a-measurement'), /Invalid/);
});
