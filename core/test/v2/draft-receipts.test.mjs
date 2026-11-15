import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { setup } from '../fixtures/v2-drafts.mjs';

test('100 sequential saves retain only four FIFO receipts and bounded state bytes; replay never grows or reorders receipts', async (t) => {
  const { write, store, snapshot, file } = await setup(t),
    sizes = [];
  for (let index = 0; index < 100; index++) {
    const response = await write('answer', {
      requestId: String(index).padStart(32, '0'),
      expectedRevision: index,
      answer: 'same-sized answer',
    });
    assert.equal(response.status, 200);
    assert.ok(store.get(snapshot, '1').receipts.map((entry) => entry.requestId).length <= 4);
    if (index >= 9) {
      sizes.push(fs.statSync(file).size);
    }
  }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 4, JSON.stringify(sizes));
  assert.deepEqual(
    store.get(snapshot, '1').receipts.map((entry) => entry.requestId),
    [96, 97, 98, 99].map((i) => String(i).padStart(32, '0')),
  );
  const bytes = fs.readFileSync(file),
    order = store.get(snapshot, '1').receipts.map((entry) => entry.requestId);
  assert.equal(
    (
      await write('answer', {
        requestId: String(99).padStart(32, '0'),
        expectedRevision: 99,
        answer: 'same-sized answer',
      })
    ).status,
    200,
  );
  assert.deepEqual(
    store.get(snapshot, '1').receipts.map((entry) => entry.requestId),
    order,
  );
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(
    (
      await write('answer', {
        requestId: String(99).padStart(32, '0'),
        expectedRevision: 99,
        answer: 'different',
      })
    ).value.error.code,
    'REQUEST_CONFLICT',
  );
  assert.equal(
    (
      await write('answer', {
        requestId: String(0).padStart(32, '0'),
        expectedRevision: 0,
        answer: 'same-sized answer',
      })
    ).value.error.code,
    'REVISION_CONFLICT',
  );
  assert.ok(fs.readFileSync(file).equals(bytes));
  assert.equal(
    store.get(snapshot, '1').receipts.find((entry) => entry.requestId === order.at(-1)).signature
      .length,
    64,
  );
});

test('numeric request IDs follow write order, not JavaScript integer-key enumeration', async (t) => {
  const { write, store, snapshot } = await setup(t);
  const ids = ['9', '1', '8', '2', '7'];
  for (let i = 0; i < ids.length; i++) {
    assert.equal(
      (await write('ink', { requestId: ids[i], expectedInkRevision: i, ink: [i] })).status,
      200,
    );
  }
  assert.deepEqual(
    store.ink.read(snapshot, '1').receipts.map((entry) => entry.requestId),
    ['1', '8', '2', '7'],
  );
  assert.equal(
    (await write('ink', { requestId: '9', expectedInkRevision: 0, ink: [0] })).value.error.code,
    'REVISION_CONFLICT',
  );
  assert.equal(
    (await write('ink', { requestId: '8', expectedInkRevision: 2, ink: [2] })).status,
    200,
  );
});

test('answer receipts are independent of ink receipts; retry revokes old grading even after resubmission', async (t) => {
  const { write, store, snapshot } = await setup(t);
  await write('answer', { requestId: 'd', expectedRevision: 0, answer: 'choice' });
  await write('ink', { requestId: 'i', expectedInkRevision: 0, ink: [1] });
  const locked = await write('submit', { requestId: 's', expectedRevision: 1, answer: 'choice' });
  const score = {
    requestId: 'r',
    submissionId: locked.value.submissionId,
    expectedRevision: locked.value.state.revision,
    source: 'grader',
    result: { score: 2, parts: null, message: null },
  };
  await write('result', score);
  assert.deepEqual(
    store.get(snapshot, '1').receipts.map((entry) => entry.requestId),
    ['d', 's', 'r'],
  );
  assert.deepEqual(
    store.ink.read(snapshot, '1').receipts.map((entry) => entry.requestId),
    ['i'],
  );
  for (let i = 0; i < 4; i++) {
    assert.equal(
      (await write('ink', { requestId: 'later-' + i, expectedInkRevision: 1 + i, ink: [i] }))
        .status,
      200,
    );
  }
  assert.equal(
    store.get(snapshot, '1').receipts.some((entry) => entry.requestId === 'r'),
    true,
  );
  for (let i = 0; i < 4; i++) {
    assert.equal(
      (await write('result', { ...score, requestId: 'later-grade-' + i, expectedRevision: 3 + i }))
        .status,
      200,
    );
  }
  assert.equal(
    store.get(snapshot, '1').receipts.some((entry) => entry.requestId === 'r'),
    false,
  );
  assert.equal((await write('result', score)).value.error.code, 'RESULT_CONFLICT');
  await write('retry', { requestId: 'redo', expectedRevision: 7 });
  const second = await write('submit', { requestId: 's2', expectedRevision: 8, answer: 'new' });
  assert.equal(second.status, 200);
  assert.notDeepEqual(second.value.submissionId, locked.value.submissionId);
  assert.equal((await write('result', score)).value.error.code, 'SUBMISSION_STALE');
  assert.equal(store.get(snapshot, '1').result, null);
});
