import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';
import { hashes, running } from '../fixtures/v2-readonly.mjs';

test('read APIs isolate v1 data, never write files or execute author code, and never return solution', async (t) => {
  const { fixture, get, open, base, bankId } = await running(t);
  writeFixtureFile(
    path.join(fixture.root, '.state', 'network-settings.json'),
    'not even valid JSON',
  );
  writeFixtureFile(path.join(fixture.root, '.state', 'ai.json'), SOLUTION_MARKER);
  const before = hashes(fixture.root);
  const root = await get('/');
  assert.match(root.text, /QuizForgeUI.mountV2App/);
  assert.match(root.text, /nonce=/);
  assert.match(root.response.headers.get('content-security-policy'), /script-src 'nonce-/);
  const scriptPolicy = root.response.headers
    .get('content-security-policy')
    .split(';')
    .find((rule) => rule.trim().startsWith('script-src '));
  assert.match(scriptPolicy, /blob:/);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline|unsafe-eval/);
  assert.deepEqual((await get('/api/v2/health')).body, {
    apiVersion: 2,
    availableFeatures: ['catalog', 'overview', 'question', 'resources', 'submit', 'result'],
  });
  const { body: overview, response } = await open();
  assert.equal(response.status, 200);
  assert.equal(overview.states.length, 20);
  assert.equal(overview.initial.question.questionId, '1');
  assert.equal(overview.initial.question.solution, null);
  assert.deepEqual(overview.pendingGrading, []);
  assert.equal(overview.questionTypes.length, 20);
  assert.deepEqual(overview.questionTypes[0], {
    questionId: '1',
    type: 'quizforge.synthetic-choice@2',
  });
  assert.deepEqual(
    overview.listening.map((item) => item.id),
    ['https', 'local', 'http'],
  );
  assert.ok(overview.listening.every((item) => !Object.hasOwn(item, 'src')));
  assert.equal(overview.states[1].maxScore, 0.3);
  const token = '?snapshotId=' + overview.snapshotId;
  for (let i = 1; i <= 20; i++) {
    const q = await get(base + '/questions/' + i + token);
    assert.equal(q.response.status, 200);
    assert.equal(q.body.solution, null);
    assert.deepEqual(q.body.state.status, q.body.item.parts ? {} : 'unanswered');
    assert.equal(q.body.resources.length, 1);
    assert.equal(q.body.resources[0].reference, 'qf-asset:assets/figure.png');
  }
  const q = overview.initial.question;
  const asset = await get(base + '/questions/1/assets/' + q.resources[0].assetId + token);
  assert.equal(asset.response.status, 200);
  assert.equal(asset.response.headers.get('content-type'), 'image/png');
  const hiddenAsset = createHash('sha256').update('1\0qf-asset:assets/solution.txt').digest('hex');
  assert.equal(
    (await get(base + '/questions/1/assets/' + hiddenAsset + token)).response.status,
    404,
  );
  const local = await get(base + '/listening/local' + token, { headers: { Range: 'bytes=0-43' } });
  assert.equal(local.response.status, 206);
  assert.equal(local.bytes.length, 44);
  assert.equal(local.text.slice(0, 4), 'RIFF');
  assert.equal(local.response.headers.get('content-range'), 'bytes 0-43/2044');
  assert.equal(
    (await get(base + '/listening/local' + token, { headers: { Range: 'bytes=99999-' } })).response
      .status,
    416,
  );
  assert.equal((await get(base + '/listening/local' + token, { method: 'HEAD' })).bytes.length, 0);
  for (const id of ['http', 'https']) {
    const remote = await get(base + '/listening/' + id + token);
    assert.equal(remote.body.kind, 'remote');
    assert.match(remote.body.src, /^https?:\/\/audio.example.test\//);
  }
  assert.equal((await get(base + '/listening/ignored' + token)).response.status, 404);
  const artifact = '/api/v2/extensions/' + q.extension.artifactId;
  assert.equal((await get(artifact + '/manifest')).body.apiVersion, 2);
  for (const file of ['practice-html', 'practice-js', 'practice-css', 'grade-js']) {
    const response = await get(artifact + '/files/' + file);
    assert.equal(response.response.status, 200);
    assert.match(
      response.response.headers.get('content-security-policy'),
      /sandbox allow-scripts;/,
    );
  }
  assert.equal((await get('/api/v2/sdk/richtext/2.0.0/sdk.js')).response.status, 200);
  assert.equal((await get('/api/v2/sdk/richtext/1.0.0/sdk.js')).response.status, 404);
  assert.equal((await get('/api/v2/extensions/unknown/manifest')).response.status, 404);
  assert.equal((await get('/api/v2/banks/unknown/overview')).response.status, 404);
  assert.equal((await get('/api/v2/banks/unknown/questions/1' + token)).response.status, 404);
  for (const route of ['/api/library', '/api/settings', '/api/ai/tasks']) {
    assert.equal((await get(route)).response.status, 410);
  }
  assert.equal((await get(base + '/position')).response.status, 501);
  for (const route of ['/api/v2/settings/ai', base + '/history']) {
    assert.equal((await get(route)).response.status, 501);
  }
  for (const route of [base + '/questions/1/answer', base + '/restart']) {
    assert.equal((await get(route, { method: 'POST', body: '{}' })).response.status, 501);
  }
  // Submit is now implemented; malformed requests still cannot disclose answers.
  const rejected = await get(base + '/questions/1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(rejected.response.status, 409);
  assert.doesNotMatch(rejected.text, new RegExp(SOLUTION_MARKER));
  for (const route of ['/bank.json', '/.state/ai.json', '/core/web/app.js']) {
    assert.equal((await get(route)).response.status, 404);
  }
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(bankId.startsWith('b_'));
  assert.deepEqual(hashes(fixture.root), before);
});

test('catalog distinguishes local instances with identical source IDs and contains bad metadata to its own item', async (t) => {
  const { fixture, get, open, base } = await running(t);
  const second = path.join(fixture.root, 'question-banks', 'synthetic', 'second');
  fs.cpSync(fixture.directory, second, { recursive: true });
  const broken = path.join(fixture.root, 'question-banks', 'synthetic', 'broken');
  writeFixtureFile(path.join(broken, 'bank.json'), '{invalid');
  const catalog = (await get('/api/v2/catalog')).body,
    items = catalog.groups[0].items;
  assert.equal(items.length, 3);
  assert.equal(new Set(items.map((item) => item.bankId)).size, 3);
  assert.equal(items.filter((item) => item.sourceId === 'synthetic-bank').length, 2);
  assert.equal(items.filter((item) => item.availability === 'unavailable').length, 1);
  const first = (await open()).body,
    secondId = items.find(
      (item) => item.bankId !== first.bank.bankId && item.availability === 'available',
    ).bankId;
  const other = (await get('/api/v2/banks/' + secondId + '/overview')).body;
  assert.notEqual(first.snapshotId, other.snapshotId);
  assert.equal(
    (await get(base + '/questions/1?snapshotId=' + other.snapshotId)).body.error.code,
    'SNAPSHOT_STALE',
  );
  delete fixture.bank.description;
  delete fixture.bank.features;
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const defaults = (await open()).body.bank;
  assert.equal(defaults.description, '');
  assert.deepEqual(defaults.features, { history: true, exam: true });
});
