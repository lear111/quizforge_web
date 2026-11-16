import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { jsonBytes, parseJson } from '../../server/host/platform/json.js';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

test('restart requires a completed round and a current snapshot without creating history', async (t) => {
  const f = await restartFixture(t);
  assert.equal((await f.restart()).value.error.code, 'PRACTICE_NOT_COMPLETED');
  assert.equal(
    (await f.restart({ ...f.input, snapshotId: 'old' })).value.error.code,
    'SNAPSHOT_STALE',
  );
  assert.equal(f.rounds().length, 0);
  assert.equal(fs.existsSync(f.library.stateStore.file(f.directory)), false);
  for (const body of [{}, { ...f.input, requestId: '' }, null]) {
    assert.equal((await f.restart(body)).status, 400);
  }
});

test('restart archives exact bank/extensions/ink and finalized scores, returns an empty distinct round, and replays after restart', async (t) => {
  const f = await restartFixture(t);
  const { library, snapshot, input } = f;
  const store = library.stateStore;
  for (const id of ['1', '2', '3']) {
    library.write(f.bankId, id, 'answer', {
      ...input,
      requestId: `a${id}`,
      expectedRevision: 0,
      answer: { selected: '乙', text: '手写与文字' },
      answered: id === '2' ? { p1: true } : true,
    });
  }
  library.write(f.bankId, '1', 'ink', {
    ...input,
    requestId: 'ink',
    expectedInkRevision: 0,
    ink: { strokes: [{ x: 42, y: 19 }] },
  });
  await f.finish();
  const entries = ['1', '2'].map((id) => {
    const old = store.get(snapshot, id);
    return {
      questionId: id,
      expectedRevision: old.revision,
      submissionId: old.submissionId,
      result:
        id === '1'
          ? { score: 2, parts: null, message: null }
          : { score: null, parts: null, message: '无法评分' },
    };
  });
  library.results(f.bankId, { ...input, requestId: 'grades', results: entries });
  const old = store.load(f.directory),
    scored = jsonBytes(old.questions['1']);
  const inkFile = store.ink.file(snapshot, '1'),
    ink = fs.readFileSync(inkFile);
  const bank = fs.readFileSync(f.bankFile),
    extension = fs.readFileSync(path.join(f.extension, 'grade.js'));
  const response = await f.restart();
  assert.equal(response.status, 200);
  assert.notEqual(response.value.snapshotId, input.snapshotId);
  assert.equal(response.value.completedAt, null);
  assert.equal(response.value.total.score, 0);
  assert.equal(fs.existsSync(store.file(f.directory)), false);
  assert.ok(
    response.value.states.every(
      (s) => !s.locked && !s.hasSavedAnswer && !s.hasInk && s.revision === 0,
    ),
  );
  assert.ok(!JSON.stringify(response.value).includes(SOLUTION_MARKER));
  assert.equal(f.rounds().length, 1);
  const round = f.rounds()[0],
    stateBytes = fs.readFileSync(path.join(round, 'state.json'));
  const archived = parseJson(stateBytes);
  assert.ok(jsonBytes(archived.questions['1']).equals(scored));
  for (const id of ['2', '3']) {
    assert.equal(archived.questions[id].result.score, 0);
  }
  assert.deepEqual(archived.questions['2'].result.parts, { p1: 0, p2: 0 });
  assert.deepEqual(archived.questions['3'].answer, old.questions['3'].answer);
  assert.equal(archived.completedAt, old.completedAt);
  assert.ok(fs.readFileSync(path.join(round, 'bank.json')).equals(bank));
  assert.ok(
    fs
      .readFileSync(path.join(round, 'extensions', 'synthetic', 'choice', 'grade.js'))
      .equals(extension),
  );
  assert.ok(
    fs
      .readFileSync(path.join(round, 'ink', snapshot.contentFingerprint, path.basename(inkFile)))
      .equals(ink),
  );
  assert.equal(fs.existsSync(path.join(round, 'assets')), false);
  assert.equal(fs.existsSync(path.join(round, 'answer-files')), false);
  const again = await f.restart();
  assert.equal(again.value.snapshotId, response.value.snapshotId);
  assert.equal(f.rounds().length, 1);
  assert.equal(
    (await f.restart({ ...input, requestId: 'different' })).value.error.code,
    'SNAPSHOT_STALE',
  );
  assert.equal(
    (await f.restart({ ...input, snapshotId: response.value.snapshotId })).value.error.code,
    'REQUEST_CONFLICT',
  );
  assert.equal(
    (
      await f.api(
        `${f.base}/questions/1/answer`,
        { ...input, requestId: 'late', expectedRevision: 0, answer: {} },
        'PUT',
      )
    ).value.error.code,
    'SNAPSHOT_STALE',
  );
  for (const [route, method] of [
    ['/finish', 'POST'],
    ['/results', 'PUT'],
    ['/questions/1/result', 'PUT'],
    ['/questions/1/submit', 'POST'],
    ['/questions/1/retry', 'POST'],
    ['/questions/1/ink', 'PUT'],
  ]) {
    assert.equal(
      (await f.api(f.base + route, { ...input, requestId: 'late-operation' }, method)).value.error
        .code,
      'SNAPSHOT_STALE',
    );
  }
  // New process/library, no in-memory receipt or cached snapshot.
  const { createPracticeLibrary } = await import('../../server/v2/services/bank.service.js');
  const { PracticeState } = await import('../../server/v2/services/practice.service.js');
  const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
  assert.equal(fresh.restart(f.bankId, input).snapshotId, response.value.snapshotId);
  assert.equal(f.rounds().length, 1);
  fs.appendFileSync(f.bankFile, '\n');
  fs.appendFileSync(path.join(f.extension, 'grade.js'), '\n// later version');
  assert.ok(fs.readFileSync(path.join(round, 'bank.json')).equals(bank));
  assert.ok(fs.readFileSync(path.join(round, 'state.json')).equals(stateBytes));
  assert.ok(
    fs
      .readFileSync(path.join(round, 'extensions', 'synthetic', 'choice', 'grade.js'))
      .equals(extension),
  );
});

test('a replaced or missing extension and a changed bank refuse archiving without clearing completed practice', async (t) => {
  for (const change of ['extension', 'missing', 'bank']) {
    await t.test(change, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const file = f.library.stateStore.file(f.directory),
        before = fs.readFileSync(file);
      if (change === 'extension') {
        fs.appendFileSync(path.join(f.extension, 'grade.js'), '\n// changed');
      }
      if (change === 'missing') {
        fs.unlinkSync(path.join(f.extension, 'grade.js'));
      }
      if (change === 'bank') {
        fs.appendFileSync(f.bankFile, '\n');
      }
      const response = await f.restart();
      assert.notEqual(response.status, 200);
      assert.ok(fs.readFileSync(file).equals(before));
      assert.equal(f.rounds().length, 0);
    });
  }
});

test('externally changed state identity is not archived against a cached bank snapshot', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const file = f.library.stateStore.file(f.directory);
  const state = parseJson(fs.readFileSync(file));
  fs.writeFileSync(file, jsonBytes({ ...state, contentFingerprint: '0'.repeat(64) }));
  const before = fs.readFileSync(file);
  assert.equal((await f.restart()).value.error.code, 'SNAPSHOT_STALE');
  assert.ok(fs.readFileSync(file).equals(before));
  assert.equal(f.rounds().length, 0);
});

test('cold and evicted archive requests never reconcile changed content by clearing completed practice', async (t) => {
  for (const change of ['bank', 'extension', 'missing']) {
    await t.test(change, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const file = f.library.stateStore.file(f.directory),
        before = fs.readFileSync(file);
      f.library.opened.delete(f.bankId);
      f.library.stateStore.evict(f.directory);
      if (change === 'bank') {
        fs.appendFileSync(f.bankFile, '\n');
      } else if (change === 'extension') {
        fs.appendFileSync(path.join(f.extension, 'grade.js'), '\n// new');
      } else {
        fs.unlinkSync(path.join(f.extension, 'grade.js'));
      }
      const result = await f.restart();
      assert.equal(result.value.error.code, 'SNAPSHOT_STALE');
      assert.ok(fs.readFileSync(file).equals(before));
      assert.equal(f.rounds().length, 0);
    });
  }
});

test('completed practice can be archived directly after a service restart without first opening it', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const { createPracticeLibrary } = await import('../../server/v2/services/bank.service.js');
  const { PracticeState } = await import('../../server/v2/services/practice.service.js');
  const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
  assert.equal(fresh.opened.size, 0);
  const response = fresh.restart(f.bankId, f.input);
  assert.equal(response.completedAt, null);
  assert.notEqual(response.snapshotId, f.input.snapshotId);
  assert.equal(f.rounds().length, 1);
});
