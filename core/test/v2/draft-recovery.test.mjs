import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { jsonBytes } from '../../server/host/platform/json.js';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { setup } from '../fixtures/v2-drafts.mjs';

test('failed draft/ink/retry commits preserve old immutable graph, disk and receipt order, and can retry the same ID', async (t) => {
  const { store, snapshot, write, file } = await setup(t);
  assert.equal(
    (await write('answer', { requestId: 'seed', expectedRevision: 0, answer: { nested: [1] } }))
      .status,
    200,
  );
  for (const [op, fields] of [
    ['answer', { answer: { nested: [2] } }],
    ['ink', { ink: { points: [1, 2] } }],
    ['retry', {}],
  ]) {
    const old = store.load(snapshot.directory),
      before = jsonBytes(old),
      bytes = fs.readFileSync(file),
      writer = op === 'ink' ? store.ink : store,
      originalWrite = writer.write;
    const request = {
      requestId: op,
      ...(op === 'ink'
        ? { expectedInkRevision: store.ink.read(snapshot, '1').inkRevision }
        : { expectedRevision: store.get(snapshot, '1').revision }),
      ...fields,
    };
    writer.write = () => {
      throw new Error('synthetic failure');
    };
    const failed = await write(op, request);
    assert.equal(failed.value.error.code, 'STATE_WRITE_FAILED');
    assert.equal(store.load(snapshot.directory), old);
    assert.ok(jsonBytes(old).equals(before));
    assert.ok(fs.readFileSync(file).equals(bytes));
    writer.write = originalWrite;
    assert.equal((await write(op, request)).status, 200);
    assert.ok(jsonBytes(old).equals(before));
    assert.ok(Object.isFrozen(store.get(snapshot, '1').receipts));
  }
});

test('two concurrent drafts use revision conflict; stale snapshots, origins, bad envelopes and duplicate keys cannot write', async (t) => {
  const { write, api, base, snapshotId, file } = await setup(t);
  const results = await Promise.all(
    ['one', 'two'].map((requestId) =>
      write('answer', { requestId, expectedRevision: 0, answer: requestId }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const bytes = fs.readFileSync(file);
  assert.equal(
    (await write('answer', { requestId: 'none', expectedRevision: 1 })).value.error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (await write('ink', { requestId: 'none', expectedRevision: 1 })).value.error.code,
    'INVALID_REQUEST',
  );
  assert.equal(
    (await write('retry', { requestId: 'r', expectedRevision: -1 })).value.error.code,
    'REVISION_CONFLICT',
  );
  assert.equal(
    (
      await write('answer', {
        requestId: 'x',
        expectedRevision: 1,
        snapshotId: 'old',
        answer: null,
      })
    ).value.error.code,
    'SNAPSHOT_STALE',
  );
  const route = base + '/questions/1/ink';
  assert.equal(
    (
      await api(route, { requestId: 'cross', snapshotId, expectedRevision: 1, ink: [] }, 'PUT', {
        Origin: 'https://example.test',
      })
    ).status,
    403,
  );
  assert.equal((await api(route, '{"requestId":"a","requestId":"b"}', 'PUT')).status, 400);
  assert.ok(fs.readFileSync(file).equals(bytes));
});

test('reopening observes external record deletion, edit and replacement at the same bank path without relying on process restart', async (t) => {
  const { write, api, base, snapshotId, fixture, file, store } = await setup(t);
  await write('submit', { requestId: 's', expectedRevision: 0, answer: { selected: '乙' } });
  const lockedBytes = fs.readFileSync(file);
  fs.rmSync(path.dirname(file), { recursive: true });
  assert.equal(
    (await api(`${base}/questions/1?snapshotId=${snapshotId}`)).value.state.locked,
    true,
    'D7 does not require a disk check on every question GET',
  );
  let opened = await api(base + '/overview');
  assert.equal(opened.value.initial.question.state.locked, false);
  assert.equal(opened.value.initial.question.solution, null);
  writeFixtureFile(file, lockedBytes);
  opened = await api(base + '/overview');
  assert.equal(opened.value.initial.question.state.locked, true);
  const replacement = path.join(fixture.root, 'replacement.json');
  writeFixtureFile(replacement, { formatVersion: 2, questions: {} });
  fs.renameSync(replacement, file);
  opened = await api(base + '/overview');
  assert.equal(opened.value.initial.question.state.status, 'unanswered');
  const unchanged = store.load(fixture.directory);
  await api(base + '/overview');
  assert.equal(store.load(fixture.directory), unchanged);
});

test('a newly corrupt record invalidates the cache and blocks later writes without replacing the damaged bytes', async (t) => {
  const { write, api, base, file } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  writeFixtureFile(file, '{broken');
  assert.equal((await api(base + '/overview')).value.error.code, 'STATE_INVALID');
  assert.equal(
    (
      await write('answer', {
        requestId: 'later',
        expectedRevision: 1,
        answer: 'must not overwrite',
      })
    ).value.error.code,
    'STATE_INVALID',
  );
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('an external deletion or replacement immediately after commit cannot be paired with the candidate cache identity', async (t) => {
  const { write, store, api, base } = await setup(t),
    writer = store.write;
  for (const replace of [false, true]) {
    store.write = (file, bytes) => {
      writer(file, bytes);
      if (replace) {
        writer(file, jsonBytes({ formatVersion: 2, questions: {} }));
      } else {
        fs.rmSync(file);
      }
    };
    assert.equal(
      (
        await write('submit', {
          requestId: 's-' + replace,
          expectedRevision: 0,
          answer: 'must be forgotten',
        })
      ).status,
      200,
    );
    store.write = writer;
    const reopened = await api(base + '/overview');
    assert.equal(reopened.value.initial.question.state.locked, false);
    assert.equal(reopened.value.initial.question.answer, null);
  }
});
