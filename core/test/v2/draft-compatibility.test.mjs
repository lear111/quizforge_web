import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { setup } from '../fixtures/v2-drafts.mjs';

test('D39 recognizable legacy progress is cleared at open, not migrated, and an interrupted reset does not expose it', async (t) => {
  const { store, snapshot, write, file, api, base, snapshotId } = await setup(t);
  writeFixtureFile(store.ink.file(snapshot, '1'), {
    ink: [1],
    inkRevision: 1,
    receipts: { old: 'signature' },
    receiptOrder: ['old'],
  });
  const legacy = {
    formatVersion: 2,
    contentFingerprint: snapshot.contentFingerprint,
    historyIndex: [],
    lastQuestionId: '1',
    questions: {
      1: {
        status: 'drafting',
        revision: 1,
        answerVersion: 1,
        answer: 'old data',
        submission: null,
        resultRevision: 0,
        result: null,
        draft: 'old note',
        receipts: Object.fromEntries(
          Array.from({ length: 9 }, (_, i) => ['old-' + i, 'a'.repeat(64)]),
        ),
      },
    },
  };
  writeFixtureFile(file, legacy);
  const bytes = fs.readFileSync(file),
    writer = store.write;
  store.write = () => {
    throw Error('failed legacy reset');
  };
  assert.equal((await api(base + '/overview')).value.error.code, 'STATE_WRITE_FAILED');
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(
    (await api(base + '/questions/1?snapshotId=' + snapshotId)).value.error.code,
    'STATE_INVALID',
  );
  store.write = writer;
  const opened = await api(base + '/overview');
  assert.equal(opened.status, 200);
  assert.equal(opened.value.activeCleared, true);
  assert.equal(opened.value.initial.question.answer, null);
  assert.equal(opened.value.initial.question.ink, null);
  assert.equal(fs.existsSync(store.ink.file(snapshot, '1')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), {
    formatVersion: 2,
    questions: {},
    contentFingerprint: snapshot.contentFingerprint,
    lastQuestionId: null,
  });
  assert.equal(
    (await write('answer', { requestId: 'new', expectedRevision: 0, answer: 'new answer' })).status,
    200,
  );
  assert.deepEqual(
    new PracticeState()
      .load(snapshot.directory)
      .questions['1'].receipts.map((entry) => entry.requestId),
    ['new'],
  );
});

test('D36 old development draft is ignored without rewriting; subsequent saves omit it and old endpoint is removed', async (t) => {
  const { write, store, snapshot, file, api, base, snapshotId } = await setup(t);
  await write('answer', { requestId: 'seed', expectedRevision: 0, answer: { number: 1 } });
  const root = JSON.parse(fs.readFileSync(file));
  root.questions['1'].draft = { obsolete: 'PRIVATE_OLD_NOTE_62be' };
  writeFixtureFile(file, root);
  const bytes = fs.readFileSync(file);
  const open = await api(base + '/overview');
  assert.equal(open.status, 200);
  const q = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  for (const r of [open, q]) {
    assert.doesNotMatch(r.text, /PRIVATE_OLD_NOTE_62be|"draft"|"hasDraft"/);
  }
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(Object.hasOwn(store.get(snapshot, '1'), 'draft'), false);
  const saved = await write('answer', {
    requestId: 'new',
    expectedRevision: 1,
    answer: { number: 2 },
  });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /"draft"|PRIVATE_OLD_NOTE_62be/);
  const before = fs.readFileSync(file);
  assert.equal(
    (
      await api(
        base + '/questions/1/draft',
        { snapshotId, requestId: 'old', expectedRevision: 2, answer: 'old API' },
        'PUT',
      )
    ).status,
    501,
  );
  assert.ok(fs.readFileSync(file).equals(before));
});
