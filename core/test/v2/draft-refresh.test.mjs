import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { setup } from '../fixtures/v2-drafts.mjs';

test('explicit refresh rechecks state and content, reports changes, keeps requested position and rejects stale expectations', async (t) => {
  const { fixture, write, api, base, snapshotId } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  fixture.bank.questions['1'].solution.explanation = 'new solution';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const refreshed = await api(
    base + '/refresh',
    { expectedSnapshotId: snapshotId, questionId: '3' },
    'POST',
  );
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.value.initial.question.questionId, '3');
  assert.deepEqual(refreshed.value.changes.activeCleared, true);
  assert.equal(refreshed.value.states[0].status, 'unanswered');
  assert.doesNotMatch(refreshed.text, /new solution/);
  assert.equal(
    (await api(base + '/refresh', { expectedSnapshotId: snapshotId }, 'POST')).value.error.code,
    'SNAPSHOT_STALE',
  );
  assert.equal(
    (await write('answer', { requestId: 'old', expectedRevision: 1, answer: 'old' })).value.error
      .code,
    'SNAPSHOT_STALE',
  );
});

test('refresh falls back only for a removed question and a failed clearing write never publishes the candidate snapshot', async (t) => {
  const { fixture, write, api, base, snapshotId, store, server, snapshot, file } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: 'saved' });
  const before = fs.readFileSync(file),
    writer = store.write;
  delete fixture.bank.questions['1'];
  fixture.bank.outline[0].items = fixture.bank.outline[0].items.filter((item) => item.id !== '1');
  writeFixtureFile(fixture.bankFile, fixture.bank);
  store.write = () => {
    throw new Error('synthetic clearing failure');
  };
  const failed = await api(
    base + '/refresh',
    { expectedSnapshotId: snapshotId, questionId: '1' },
    'POST',
  );
  assert.equal(failed.value.error.code, 'STATE_WRITE_FAILED');
  assert.equal(server.library.opened.get(snapshot.bankId), snapshot);
  assert.ok(fs.readFileSync(file).equals(before));
  store.write = writer;
  const refreshed = await api(
    base + '/refresh',
    { expectedSnapshotId: snapshotId, questionId: '1' },
    'POST',
  );
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.value.initial.question.questionId, '2');
  assert.deepEqual(refreshed.value.changes.removedQuestionIds, ['1']);
  assert.deepEqual(refreshed.value.changes.activeCleared, true);
});
