import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/v2/app.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

async function setup(t, { count = 3, token = null, prepare } = {}) {
  const fixture = createReadFixture({ count });
  t.after(() => fixture.cleanup());
  prepare?.(fixture);
  const server = await new V2Server({ ...fixture, token }).start();
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route, body, method = 'POST', headers = {}) => {
    const response = await fetch(origin + route, {
      ...(body === undefined ? {} : { method, body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { 'x-quizforge-token': token } : {}),
        ...headers,
      },
    });
    const text = await response.text();
    return { status: response.status, text, value: JSON.parse(text) };
  };
  // fetch supplies its own Host; use the raw HTTP client when testing that gate.
  const raw = (route, body, method, headers) =>
    new Promise((resolve, reject) => {
      const request = http.request(
        origin + route,
        {
          method,
          headers: { 'Content-Type': 'application/json', 'x-quizforge-token': token, ...headers },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            resolve({ status: response.statusCode, text, value: JSON.parse(text) });
          });
        },
      );
      request.on('error', reject);
      request.end(JSON.stringify(body));
    });
  const catalog = await api('/api/v2/catalog'),
    bankId = catalog.value.groups[0].items[0].bankId,
    base = '/api/v2/banks/' + bankId;
  const opened = await api(base + '/overview'),
    snapshot = server.library.opened.get(bankId),
    snapshotId = snapshot.snapshotId;
  const store = server.library.stateStore;
  let sequence = 0;
  const answer = (id) =>
    api(
      `${base}/questions/${id}/answer`,
      {
        requestId: 'a' + ++sequence,
        snapshotId,
        expectedRevision: store.get(snapshot, id).revision,
        answer: { opaque: id },
        answered: true,
      },
      'PUT',
    );
  const row = (id) => {
    const s = store.get(snapshot, id);
    return {
      questionId: id,
      submissionId: s.submissionId,
      expectedRevision: s.revision,
      result: { score: 1, parts: null, message: null },
    };
  };
  const finish = () => api(base + '/finish', { requestId: 'finish', snapshotId });
  const results = (rows, requestId = 'batch') =>
    api(base + '/results', { requestId, snapshotId, results: rows }, 'PUT');
  const unchanged = (old, bytes) => {
    assert.equal(store.load(fixture.directory), old);
    assert.ok(jsonBytes(old).equals(bytes));
    assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes));
  };
  return {
    fixture,
    server,
    origin,
    api,
    raw,
    bankId,
    base,
    opened,
    snapshotId,
    snapshot,
    store,
    answer,
    row,
    finish,
    results,
    unchanged,
  };
}

test('partial batch receipt eviction refuses a replay atomically and changed full-batch bodies conflict', async (t) => {
  const f = await setup(t);
  await f.answer('1');
  await f.answer('3');
  await f.finish();
  const rows = [f.row('1'), f.row('3')];
  assert.equal((await f.results(rows)).status, 200);
  const beforeConflict = f.store.load(f.fixture.directory),
    conflictBytes = jsonBytes(beforeConflict);
  const conflict = await f.results([
    { ...rows[0], result: { score: 2, parts: null, message: null } },
    rows[1],
  ]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.value.error.code, 'REQUEST_CONFLICT');
  f.unchanged(beforeConflict, conflictBytes);
  for (let i = 0; i < 4; i++) {
    const current = f.store.get(f.snapshot, '1');
    assert.equal(
      (
        await f.api(
          f.base + '/questions/1/result',
          {
            requestId: 'correction-' + i,
            snapshotId: f.snapshotId,
            expectedRevision: current.revision,
            submissionId: current.submissionId,
            source: 'grader',
            result: { score: 2, parts: null, message: null },
          },
          'PUT',
        )
      ).status,
      200,
    );
  }
  assert.equal(
    f.store.get(f.snapshot, '1').receipts.some((r) => r.requestId === 'batch'),
    false,
  );
  assert.equal(
    f.store.get(f.snapshot, '3').receipts.some((r) => r.requestId === 'batch'),
    true,
  );
  const old = f.store.load(f.fixture.directory),
    bytes = jsonBytes(old),
    rejected = await f.results(rows);
  assert.equal(rejected.status, 409);
  assert.equal(rejected.value.error.code, 'RESULT_CONFLICT');
  assert.equal(rejected.value.error.questionId, '1');
  f.unchanged(old, bytes);
});

test('a batch prepared for an earlier lock cannot score a retried answer or a later completed generation', async (t) => {
  const f = await setup(t),
    submit = () =>
      f.api(f.base + '/questions/1/submit', {
        requestId: 'submit-' + f.store.get(f.snapshot, '1').revision,
        snapshotId: f.snapshotId,
        expectedRevision: f.store.get(f.snapshot, '1').revision,
        answer: { opaque: true },
      });
  assert.equal((await submit()).status, 200);
  const stale = f.row('1');
  assert.equal(
    (
      await f.api(f.base + '/questions/1/retry', {
        requestId: 'retry',
        snapshotId: f.snapshotId,
        expectedRevision: f.store.get(f.snapshot, '1').revision,
      })
    ).status,
    200,
  );
  assert.equal((await submit()).status, 200);
  assert.notEqual(f.store.get(f.snapshot, '1').submissionId, stale.submissionId);
  for (const completed of [false, true]) {
    if (completed) {
      assert.equal((await f.finish()).status, 200);
    }
    const old = f.store.load(f.fixture.directory),
      bytes = jsonBytes(old),
      rejected = await f.results([stale]);
    assert.equal(rejected.status, 409);
    assert.equal(rejected.value.error.code, 'SUBMISSION_STALE');
    assert.equal(rejected.value.error.questionId, '1');
    f.unchanged(old, bytes);
  }
});

test('invalid completion clocks and corrupt persisted completion timestamps never write or release solutions', async (t) => {
  const f = await setup(t);
  await f.answer('1');
  const old = f.store.load(f.fixture.directory),
    bytes = jsonBytes(old);
  f.store.now = () => 'not-a-time';
  const failed = await f.finish();
  assert.equal(failed.status, 503);
  assert.equal(failed.value.error.code, 'STATE_INVALID');
  assert.doesNotMatch(failed.text, new RegExp(SOLUTION_MARKER));
  f.unchanged(old, bytes);
  const corrupt = { ...old, completedAt: 'not-a-time' };
  writeFixtureFile(f.store.file(f.fixture.directory), corrupt);
  const corruptBytes = fs.readFileSync(f.store.file(f.fixture.directory));
  assert.equal((await f.api(f.base + '/overview')).value.error.code, 'STATE_INVALID');
  const again = await f.finish();
  assert.equal(again.status, 503);
  assert.equal(again.value.error.code, 'STATE_INVALID');
  assert.ok(fs.readFileSync(f.store.file(f.fixture.directory)).equals(corruptBytes));
});

test('aggregate overflow is rejected before finish or batch commits without imposing an individual-score cap', async (t) => {
  const f = await setup(t, {
    count: 3,
    prepare(fixture) {
      for (const item of fixture.bank.outline.flatMap((group) => group.items)) {
        delete item.parts;
        item.label = item.id;
        item.maxScore = Number.MAX_VALUE;
      }
      writeFixtureFile(fixture.bankFile, fixture.bank);
    },
  });
  // Each individual item is legal. Only their aggregate is unrepresentable;
  // the attempted overview publishes a snapshot but cannot return its total.
  assert.equal(f.opened.status, 422);
  assert.equal(f.opened.value.error.code, 'INVALID_RESULT');
  const root = {
    formatVersion: 2,
    contentFingerprint: f.snapshot.contentFingerprint,
    questions: {
      1: {
        status: 'answered',
        answer: { opaque: true },
        result: null,
        submissionId: 'locked',
        revision: 1,
        receipts: [],
      },
    },
  };
  f.store.commit(f.fixture.directory, root);
  const bytes = jsonBytes(root),
    batch = [f.row('1')];
  batch[0].result.score = Number.MAX_VALUE;
  for (const response of [await f.finish(), await f.results(batch)]) {
    assert.equal(response.status, 422);
    assert.equal(response.value.error.code, 'INVALID_RESULT');
    assert.doesNotMatch(response.text, new RegExp(SOLUTION_MARKER));
    f.unchanged(root, bytes);
  }
});

test('unavailable and malformed questions remain pending errors after a committed finish, not a failed transaction', async (t) => {
  const f = await setup(t, {
    prepare(fixture) {
      fixture.bank.questions['1'].type = 'quizforge.not-installed@2';
      fixture.bank.questions['3'].question = 123;
      writeFixtureFile(fixture.bankFile, fixture.bank);
    },
  });
  // Seed the already-saved opaque answers directly: an unavailable page cannot
  // currently create them, but old records can survive a missing installation.
  for (const id of ['1', '3']) {
    f.store.apply(f.snapshot, id, 'answer', {
      requestId: 'seed-' + id,
      answer: { opaque: id },
      answered: true,
      expectedRevision: 0,
    });
  }
  const done = await f.finish();
  assert.equal(done.status, 200);
  assert.ok(done.value.completedAt);
  assert.ok(done.value.states.every((s) => s.locked));
  assert.deepEqual(
    done.value.pendingGrading.map((entry) => entry.error.code),
    ['EXTENSION_NOT_FOUND', 'QUESTION_INVALID'],
  );
  assert.ok(done.value.pendingGrading.every((entry) => entry.question === null));
  assert.doesNotMatch(done.text, new RegExp(SOLUTION_MARKER));
  assert.equal(f.store.load(f.fixture.directory).completedAt, done.value.completedAt);
  assert.deepEqual((await f.finish()).value, done.value);
});

test('D27 extension source changes clear a completed active round but leave archived bytes untouched', async (t) => {
  const f = await setup(t);
  await f.answer('1');
  assert.equal((await f.finish()).status, 200);
  const archived = path.join(f.fixture.directory, '.qf-v2', 'rounds', 'archive', 'state.json');
  writeFixtureFile(archived, 'immutable-archive');
  fs.appendFileSync(path.join(f.fixture.extension, 'practice.js'), '\n/* changed author source */');
  const opened = await f.api(f.base + '/overview');
  assert.equal(opened.status, 200);
  assert.equal(opened.value.activeCleared, true);
  assert.equal(opened.value.completedAt, null);
  assert.ok(opened.value.states.every((state) => !state.locked));
  assert.equal(fs.readFileSync(archived, 'utf8'), 'immutable-archive');
});

test('finish and batch routes preserve token, Host and Origin gates before touching state', async (t) => {
  const token = 'synthetic-readonly-token',
    f = await setup(t, { token });
  for (const [route, method, body] of [
    [f.base + '/finish', 'POST', { requestId: 'finish', snapshotId: f.snapshotId }],
    [f.base + '/results', 'PUT', { requestId: 'batch', snapshotId: f.snapshotId, results: [] }],
  ]) {
    for (const [headers, expected] of [
      [{ 'x-quizforge-token': '' }, 'AUTH_REQUIRED'],
      [{ Origin: 'https://untrusted.example.test' }, 'ORIGIN_REJECTED'],
      [{ Host: 'untrusted.example.test' }, 'HOST_REJECTED'],
    ]) {
      const response = await (headers.Host ? f.raw : f.api)(route, body, method, headers);
      assert.equal(response.value.error?.code, expected, expected + ': ' + response.text);
      assert.ok([401, 403].includes(response.status));
      assert.doesNotMatch(response.text, new RegExp(SOLUTION_MARKER));
      assert.equal(fs.existsSync(f.store.file(f.fixture.directory)), false);
    }
  }
});
