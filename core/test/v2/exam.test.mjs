import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SOLUTION_MARKER, writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { V2Server } from '../../server/v2/app.js';
import { archivePractice } from '../../server/v2/services/practice-archive.service.js';

const epoch = Date.parse('2026-02-01T08:00:00Z');
const at = (offset) => new Date(epoch + offset).toISOString();
const examDir = (f) => path.join(f.directory, '.qf-v2', 'exam');
const body = (snapshot, requestId) => ({ snapshotId: snapshot.snapshotId, requestId });

async function begin(f) {
  f.library.stateStore.now = () => at(0);
  const response = await f.api(f.base + '/exam', {
    ...body(f.snapshot, 'start'),
    durationMinutes: 1,
  });
  assert.equal(response.status, 200, JSON.stringify(response.value));
  assert.notEqual(response.value.snapshotId, f.snapshot.snapshotId);
  return response.value;
}

function save(f, snapshot, revision = 0, answer = 'exam answer') {
  return f.api(
    f.base + '/questions/1/answer',
    {
      ...body(snapshot, 'answer-' + revision),
      expectedRevision: revision,
      answer,
      answered: true,
    },
    'PUT',
  );
}

function ink(f, snapshot, revision = 0) {
  return f.api(
    f.base + '/questions/1/ink',
    {
      ...body(snapshot, 'ink-' + revision),
      expectedInkRevision: revision,
      ink: { strokes: [revision] },
    },
    'PUT',
  );
}

test('exam validates duration and generations, isolates bank and practice, and rejects duplicate starts', async (t) => {
  const f = await restartFixture(t);
  for (const durationMinutes of [undefined, null, '1', 0, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(
      (await f.api(f.base + '/exam', { ...body(f.snapshot, 'invalid'), durationMinutes })).status,
      400,
    );
  }
  const start = { ...body(f.snapshot, 'start'), durationMinutes: 1 };
  assert.equal(
    (await f.api(f.base + '/exam', { ...start, snapshotId: 'old' })).value.error.code,
    'SNAPSHOT_STALE',
  );
  assert.equal((await f.api('/api/v2/banks/missing/exam', start)).status, 404);
  assert.equal(fs.existsSync(examDir(f)), false);
  assert.equal((await save(f, f.snapshot, 0, 'practice answer')).status, 200);
  assert.equal((await ink(f, f.snapshot)).status, 200);

  const files = [
    f.library.stateStore.file(f.directory),
    f.library.stateStore.ink.file(f.snapshot, '1'),
  ];
  const original = files.map((file) => fs.readFileSync(file));
  const form = await begin(f);
  assert.deepEqual(form.exam, { startedAt: at(0), endsAt: at(60000), now: at(0) });
  assert.equal(form.initial.question.answer, null);
  assert.equal(form.initial.question.ink, null);
  assert.equal((await f.api(f.base + '/exam', start)).value.error.code, 'EXAM_EXISTS');
  assert.equal((await save(f, f.snapshot, 1)).value.error.code, 'SNAPSHOT_STALE');
  assert.equal((await ink(f, f.snapshot, 1)).value.error.code, 'SNAPSHOT_STALE');
  assert.equal((await save(f, form)).status, 200);
  assert.equal((await ink(f, form)).status, 200);
  assert.deepEqual(
    files.map((file) => fs.readFileSync(file)),
    original,
  );
  assert.ok(fs.existsSync(path.join(examDir(f), 'state.json')));

  writeFixtureFile(path.join(f.directory, '..', 'other', 'bank.json'), {
    ...f.bank,
    title: 'other exam fixture',
  });
  const catalog = (await f.api('/api/v2/catalog')).value;
  const otherId = catalog.groups[0].items.find((i) => i.title === 'other exam fixture').bankId;
  assert.equal((await f.api('/api/v2/banks/' + otherId + '/overview')).value.exam, null);
  const resumed = (await f.api(f.base + '/overview')).value;
  assert.equal(resumed.snapshotId, form.snapshotId);
  assert.equal(resumed.initial.question.answer, 'exam answer');
});

test('exam deadline persists across server instances, does not leak solutions, and applies the exclusive five-second boundary', async (t) => {
  const f = await restartFixture(t);
  const exam = await begin(f);
  const question = f.base + '/questions/1';
  const solutionAsset = f.library.visibleAssets(
    f.library.opened.get(f.bankId),
    '1',
    f.bank.questions['1'],
    true,
  );
  const solutionID = [...solutionAsset].find(([, a]) => a.reference.includes('solution')).at(0);
  for (const op of ['submit', 'retry']) {
    const r = await f.api(question + '/' + op, {
      ...body(exam, op),
      expectedRevision: 0,
      answer: 'early',
    });
    assert.equal(r.status, 409);
    assert.equal(r.value.error.code, 'EXAM_IN_PROGRESS');
  }
  assert.equal(
    (await f.api(question + '/assets/' + solutionID + '?snapshotId=' + exam.snapshotId)).status,
    404,
  );

  await f.server.close();
  const resumed = await new V2Server({ ...f, port: 0 }).start();
  t.after(() => resumed.close());
  const store = resumed.library.stateStore;
  const live = (url, options) => fetch(`http://127.0.0.1:${resumed.port()}` + url, options);
  store.now = () => at(59000);
  const view = await (await live(f.base + '/overview')).json();
  assert.deepEqual(view.exam, { ...exam.exam, now: at(59000) });
  assert.equal(view.snapshotId, exam.snapshotId);
  assert.equal(JSON.stringify(view).includes(SOLUTION_MARKER), false);
  const write = async (op, fields) => {
    const r = await live(question + '/' + op, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body(exam, op + JSON.stringify(fields)), ...fields }),
    });
    return { status: r.status, value: await r.json() };
  };
  assert.equal(
    (await write('answer', { expectedRevision: 0, answer: 'before', answered: true })).status,
    200,
  );
  store.now = () => at(64999);
  assert.equal(
    (await write('answer', { expectedRevision: 1, answer: 'within grace', answered: true })).status,
    200,
  );
  store.now = () => at(65000);
  const late = await write('answer', { expectedRevision: 2, answer: 'late' });
  assert.equal(late.status, 409);
  assert.equal(late.value.error.code, 'EXAM_ENDED');
  const q = await (await live(question + '?snapshotId=' + exam.snapshotId)).json();
  assert.equal(q.answer, 'within grace');
  assert.equal(q.state.locked, true);
  assert.equal(q.solution, null);
  assert.equal(q.result, null);
  assert.equal(
    (await write('ink', { expectedInkRevision: 0, ink: { note: 'after deadline' } })).status,
    200,
  );
  assert.equal((await (await live(f.base + '/overview')).json()).completedAt, null);
});

test('hand-in locks intact answers, recovers missing grading, and archives an exam without changing practice bytes', async (t) => {
  const f = await restartFixture(t);
  await save(f, f.snapshot, 0, 'keep my practice');
  await ink(f, f.snapshot);
  const files = [
    f.library.stateStore.file(f.directory),
    f.library.stateStore.ink.file(f.snapshot, '1'),
  ];
  const original = files.map((file) => fs.readFileSync(file));
  const exam = await begin(f);
  await save(f, exam);
  await ink(f, exam);
  f.library.stateStore.now = () => at(18000);
  const finish = body(exam, 'finish exam');
  const { status, value: locked } = await f.api(f.base + '/finish', finish);
  assert.equal(status, 200);
  assert.equal(locked.completedAt, at(18000));
  assert.ok(locked.states.every((state) => state.locked));
  assert.ok(locked.states.filter((s) => s.questionId !== '1').every((state) => state.score === 0));
  assert.equal(locked.pendingGrading.length, 1);
  const { question } = locked.pendingGrading[0];
  assert.match(question.solution.explanation, new RegExp(SOLUTION_MARKER));
  assert.equal(question.answer, 'exam answer');
  assert.deepEqual((await f.api(f.base + '/finish', finish)).value, locked);
  assert.equal((await ink(f, exam, 1)).status, 200);
  const recovery = (await f.api(f.base + '/overview')).value;
  assert.equal(recovery.pendingGrading[0].question.submissionId, question.submissionId);
  const results = await f.api(
    f.base + '/results',
    {
      ...body(exam, 'score exam'),
      results: [
        {
          questionId: '1',
          submissionId: question.submissionId,
          expectedRevision: question.state.revision,
          result: { score: 2, parts: null, message: null },
        },
      ],
    },
    'PUT',
  );
  assert.equal(results.value.total.score, 2);

  const request = body(exam, 'archive exam');
  const returned = (await f.restart(request)).value;
  assert.equal(returned.exam, null);
  assert.equal(returned.initial.question.answer, 'keep my practice');
  assert.notEqual(returned.snapshotId, f.snapshot.snapshotId);
  assert.notEqual(returned.snapshotId, exam.snapshotId);
  assert.equal(fs.existsSync(examDir(f)), false);
  assert.deepEqual(
    files.map((file) => fs.readFileSync(file)),
    original,
  );
  assert.equal((await save(f, exam, 2)).value.error.code, 'SNAPSHOT_STALE');
  assert.equal((await f.restart(request)).value.snapshotId, returned.snapshotId);
  const history = (await f.api(f.base + '/rounds')).value;
  assert.equal(history.length, 1);
  const [round] = history;
  assert.equal(round.kind, 'exam');
  assert.equal(round.score, 2);
  assert.equal(Date.parse(round.completedAt) - Date.parse(round.startedAt), 18000);
  const state = JSON.parse(fs.readFileSync(path.join(f.rounds()[0], 'state.json')));
  assert.deepEqual(state.exam, { startedAt: at(0), endsAt: at(60000) });
  const historical = (await f.api(f.base + '/rounds/' + round.roundId + '/questions/1')).value;
  assert.equal(historical.answer, 'exam answer');
  assert.deepEqual(historical.ink.strokes, [1]);
});

test('archive rollbacks restore exam bytes, including after a real process exit, while practice stays byte-identical', async (t) => {
  for (const phase of ['copied', 'backed-up', 'published', 'committed']) {
    await t.test(phase, async (t) => {
      const f = await restartFixture(t);
      await save(f, f.snapshot, 0, 'untouched practice');
      const exam = await begin(f);
      await f.api(f.base + '/finish', body(exam, 'finish'));
      const practice = f.library.stateStore.file(f.directory);
      const state = path.join(examDir(f), 'state.json');
      const originalPractice = fs.readFileSync(practice),
        originalExam = fs.readFileSync(state);
      const snapshot = f.library.opened.get(f.bankId);
      assert.throws(() =>
        archivePractice(f.library, snapshot, body(exam, 'test copy failure'), (at) => {
          if (at === 'copied') {
            throw new Error('synthetic copy preparation failure');
          }
        }),
      );
      assert.deepEqual(fs.readFileSync(state), originalExam);
      const child = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL('../fixtures/v2-restart-crash.mjs', import.meta.url)),
          f.root,
          f.codeRoot,
          f.bankId,
          phase,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(child.status, 87, child.stderr);
      const opened = (await f.api(f.base + '/overview')).value;
      assert.deepEqual(fs.readFileSync(practice), originalPractice);
      if (phase === 'committed') {
        assert.equal(opened.exam, null);
        assert.equal(f.rounds().length, 1);
        assert.equal(
          (await f.restart(body(exam, 'crash-restart'))).value.snapshotId,
          opened.snapshotId,
        );
        assert.equal(f.rounds().length, 1);
      } else {
        assert.equal(opened.snapshotId, exam.snapshotId);
        assert.deepEqual(fs.readFileSync(state), originalExam);
        assert.equal(f.rounds().length, 0);
        assert.equal((await f.restart(body(exam, 'retry'))).status, 200);
      }
    });
  }
});

test('a redirected exam directory is rejected and D27 refresh clears both active scopes on content update', async (t) => {
  const f = await restartFixture(t);
  await save(f, f.snapshot);
  const before = fs.readFileSync(f.library.stateStore.file(f.directory));
  fs.symlinkSync(
    path.dirname(f.library.stateStore.file(f.directory)),
    examDir(f),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const redirected = await f.api(f.base + '/exam', {
    ...body(f.snapshot, 'link'),
    durationMinutes: 1,
  });
  assert.ok(redirected.status >= 400);
  assert.deepEqual(fs.readFileSync(f.library.stateStore.file(f.directory)), before);
  if (process.platform === 'win32') {
    fs.rmdirSync(examDir(f)); // The fixture is a directory junction.
  } else {
    fs.unlinkSync(examDir(f)); // POSIX rmdir does not remove a symbolic link.
  }
  const exam = await begin(f);
  await save(f, exam);
  f.bank.questions['1'].question.changed = true;
  writeFixtureFile(f.bankFile, f.bank);
  const refresh = (await f.api(f.base + '/refresh', { expectedSnapshotId: exam.snapshotId })).value;
  assert.equal(refresh.exam, null);
  assert.equal(refresh.changes.activeRoundInterrupted, true);
  assert.equal(refresh.activeCleared, true);
  assert.equal(refresh.initial.question.answer, null);
  assert.equal(fs.existsSync(examDir(f)), false);
});

test('malformed exam state fails closed instead of switching to practice or altering either scope', async (t) => {
  const f = await restartFixture(t);
  assert.equal((await save(f, f.snapshot, 0, 'practice')).status, 200);
  const practice = f.library.stateStore.file(f.directory);
  const contents = fs.readFileSync(practice);
  await begin(f);
  const file = path.join(examDir(f), 'state.json');
  fs.writeFileSync(file, '{invalid synthetic exam');
  const overview = await f.api(f.base + '/overview');
  assert.equal(overview.value.error.code, 'STATE_INVALID');
  assert.ok(fs.readFileSync(practice).equals(contents));
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid synthetic exam');
});
