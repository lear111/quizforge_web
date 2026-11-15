import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import { SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';
import { setup } from '../fixtures/v2-drafts.mjs';

test('D36 answer and ink persist opaque JSON without solution; obsolete notes cannot be saved', async (t) => {
  const { write, api, base, snapshotId, store, fixture, file } = await setup(t);
  let saved = await write('ink', {
    requestId: 'ink-1',
    expectedInkRevision: 0,
    ink: { strokes: [{ points: [[1, 2]] }] },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.state.status, 'unanswered');
  assert.equal(saved.value.state.hasSavedAnswer, false);
  saved = await write('answer', {
    requestId: 'notes',
    expectedRevision: 0,
    draft: ['plain', { any: true }],
  });
  assert.equal(saved.status, 400);
  assert.equal(saved.value.error.code, 'INVALID_REQUEST');
  saved = await write('answer', {
    requestId: 'answer',
    expectedRevision: 0,
    answer: { arbitrary: [false, 'hello', null] },
    answered: true,
    draft: 'obsolete field is ignored',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.state.status, 'answered');
  assert.equal(saved.value.state.hasSavedAnswer, true);
  const version = saved.value.state.revision;
  const again = await write('answer', {
    requestId: 'same-answer',
    expectedRevision: 1,
    answer: saved.value.answer,
  });
  assert.equal(again.status, 200);
  assert.equal(again.value.state.revision, version + 1);
  const question = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  assert.deepEqual(question.value.answer, saved.value.answer);
  assert.equal(Object.hasOwn(question.value, 'draft'), false);
  assert.equal(Object.hasOwn(question.value.state, 'hasDraft'), false);
  for (const value of [saved, again, question, await api(base + '/overview')]) {
    assert.doesNotMatch(value.text, new RegExp(SOLUTION_MARKER));
  }
  assert.deepEqual(new PracticeState().load(fixture.directory), store.load(fixture.directory));
  assert.ok(fs.readFileSync(file).equals(jsonBytes(store.load(fixture.directory))));
});

test('raw numeric literals survive answer and ink field patches and later unrelated writes', async (t) => {
  const { api, base, snapshotId, file, write, store, snapshot } = await setup(t);
  const route = base + '/questions/1';
  assert.equal(
    (
      await api(
        route + '/answer',
        `{"snapshotId":"${snapshotId}","requestId":"n1","expectedRevision":0,"answer":1.0,"draft":2.0}`,
        'PUT',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await api(
        route + '/ink',
        `{"snapshotId":"${snapshotId}","requestId":"n2","expectedInkRevision":0,"ink":3.0}`,
        'PUT',
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await write(
        'answer',
        { requestId: 'n3', expectedRevision: 0, answer: 'another question' },
        '2',
      )
    ).status,
    200,
  );
  assert.match(fs.readFileSync(file, 'utf8'), /"answer":1\.0/);
  assert.match(fs.readFileSync(store.ink.file(snapshot, '1'), 'utf8'), /"ink":3\.0/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /"ink"/);
});

test('locked ink preserves answer revision, credential and score; notes-only and answer patches remain forbidden', async (t) => {
  const { write, api, base, snapshotId } = await setup(t);
  const locked = await write('submit', {
    requestId: 's',
    expectedRevision: 0,
    answer: { selected: '乙' },
  });
  const graded = await write('result', {
    requestId: 'g',
    submissionId: locked.value.submissionId,
    expectedRevision: locked.value.state.revision,
    source: 'grader',
    result: { score: 2, parts: null, message: null },
  });
  assert.equal(graded.status, 200);
  const ink = await write('ink', {
    requestId: 'i',
    expectedInkRevision: 0,
    ink: { strokes: [1, 2] },
  });
  assert.equal(ink.status, 200);
  assert.deepEqual(Object.keys(ink.value).sort(), ['inkRevision', 'state']);
  const afterInk = await api(`${base}/questions/1?snapshotId=${snapshotId}`);
  const notes = await write('answer', {
    requestId: 'd',
    expectedRevision: 2,
    draft: 'post-submit notes',
  });
  assert.equal(notes.status, 400);
  for (const value of [afterInk.value]) {
    assert.deepEqual(value.answer, graded.value.answer);
    assert.deepEqual(value.submissionId, graded.value.submissionId);
    assert.deepEqual(value.result, graded.value.result);
    assert.equal(value.state.revision, graded.value.state.revision);
    assert.equal(value.state.status, 'correct');
  }
  for (const answer of [null, graded.value.answer, {}]) {
    assert.equal(
      (await write('answer', { requestId: 'bad', expectedRevision: 2, answer })).value.error.code,
      'ANSWER_LOCKED',
    );
  }
  assert.equal(afterInk.value.state.revision, 2);
});

test('retry clears active content and prior receipts while keeping the revision monotonic and rejecting old submissions/results', async (t) => {
  const { write, store, snapshot, file } = await setup(t);
  const draftInput = { requestId: 'd', expectedRevision: 0, answer: { selected: '乙' } };
  assert.equal((await write('answer', draftInput)).status, 200);
  assert.equal(
    (await write('ink', { requestId: 'i', expectedInkRevision: 0, ink: 'ink' })).status,
    200,
  );
  const submission = { requestId: 's', expectedRevision: 1, answer: { selected: '乙' } };
  const locked = await write('submit', submission);
  assert.equal(locked.status, 200);
  const grading = {
    requestId: 'r',
    submissionId: locked.value.submissionId,
    expectedRevision: locked.value.state.revision,
    source: 'grader',
    result: { score: 2, parts: null, message: null },
  };
  assert.equal((await write('result', grading)).status, 200);
  const redo = { requestId: 'retry', expectedRevision: 3 },
    retry = await write('retry', redo);
  assert.equal(retry.status, 200);
  assert.equal(retry.value.state.status, 'unanswered');
  assert.equal(retry.value.state.hasSavedAnswer, false);
  assert.equal(retry.value.state.revision, 4);
  for (const key of ['answer', 'ink', 'submissionId', 'result', 'solution']) {
    assert.equal(retry.value[key], null);
  }
  assert.equal(Object.hasOwn(retry.value, 'draft'), false);
  assert.doesNotMatch(retry.text, new RegExp(SOLUTION_MARKER));
  assert.equal(Object.hasOwn(store.load(snapshot.directory), 'historyIndex'), false);
  assert.deepEqual(
    store.get(snapshot, '1').receipts.map((entry) => entry.requestId),
    ['retry'],
  );
  const bytes = fs.readFileSync(file);
  assert.equal((await write('retry', redo)).status, 200);
  assert.ok(fs.readFileSync(file).equals(bytes));
  for (const [op, input] of [
    ['answer', draftInput],
    ['submit', submission],
    ['result', grading],
  ]) {
    const response = await write(op, input);
    assert.equal(response.status, 409);
    assert.doesNotMatch(response.text, new RegExp(SOLUTION_MARKER));
  }
  assert.ok(fs.readFileSync(file).equals(bytes));
});
