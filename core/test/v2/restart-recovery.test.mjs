import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { archivePractice } from '../../server/v2/services/practice-archive.service.js';
import { readJournal } from '../../server/v2/repositories/restart-journal.repository.js';
import { createPracticeLibrary } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';

test('every precommit failure restores byte-identical completed practice and permits retry', async (t) => {
  for (const phase of ['copied', 'prepared', 'backed-up', 'fresh', 'published']) {
    await t.test(phase, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const file = f.library.stateStore.file(f.directory),
        before = fs.readFileSync(file);
      assert.throws(() =>
        archivePractice(f.library, f.snapshot, f.input, (at) => {
          if (at === phase) {
            throw Error('synthetic interruption');
          }
        }),
      );
      assert.ok(fs.readFileSync(file).equals(before));
      assert.equal(f.rounds().length, 0);
      assert.equal(f.library.open(f.bankId).completedAt !== null, true);
      const response = await f.restart();
      assert.equal(response.status, 200, JSON.stringify(response.value));
      assert.equal(f.rounds().length, 1);
    });
  }
});

test('atomic archive write and directory rename failures retain completed state and are retryable', async (t) => {
  for (const target of ['state.json', 'extensions', 'practice']) {
    await t.test(target, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const file = f.library.stateStore.file(f.directory),
        before = fs.readFileSync(file);
      const original = fs.renameSync;
      let triggered = false;
      fs.renameSync = (from, to) => {
        const normalized = String(to).replaceAll('\\', '/');
        if (
          !triggered &&
          (target === 'practice'
            ? normalized.endsWith('/practice')
            : normalized.includes('/archive/') && normalized.includes(target))
        ) {
          triggered = true;
          throw Object.assign(Error('synthetic disk failure'), { code: 'EIO' });
        }
        return original(from, to);
      };
      try {
        assert.throws(() => archivePractice(f.library, f.snapshot, f.input));
      } finally {
        fs.renameSync = original;
      }
      assert.equal(triggered, true);
      assert.ok(fs.readFileSync(file).equals(before));
      assert.equal(f.rounds().length, 0);
      assert.equal((await f.restart()).status, 200);
    });
  }
});

test('a real exited process rolls back prepared transactions, but replays a committed lost response only once', async (t) => {
  for (const phase of ['copied', 'prepared', 'backed-up', 'fresh', 'published', 'committed']) {
    await t.test(phase, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const file = f.library.stateStore.file(f.directory),
        before = fs.readFileSync(file);
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
      const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
      const overview = fresh.open(f.bankId);
      if (phase === 'committed') {
        assert.equal(overview.completedAt, null);
        assert.equal(f.rounds().length, 1);
        const replay = fresh.restart(f.bankId, { ...f.input, requestId: 'crash-restart' });
        assert.equal(replay.snapshotId, overview.snapshotId);
        assert.equal(f.rounds().length, 1);
      } else {
        assert.ok(overview.completedAt);
        assert.ok(fs.readFileSync(file).equals(before));
        assert.equal(f.rounds().length, 0);
        assert.equal(readJournal(f.directory), null);
      }
    });
  }
});

test('a later failed restart restores the previous durable epoch and replay receipt', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const first = (await f.restart()).value;
  const snapshot = f.library.opened.get(f.bankId);
  f.library.finish(f.bankId, { requestId: 'next-finish', snapshotId: first.snapshotId });
  assert.throws(() =>
    archivePractice(
      f.library,
      snapshot,
      { requestId: 'next-restart', snapshotId: first.snapshotId },
      (at) => {
        if (at === 'fresh') {
          throw Error('stop');
        }
      },
    ),
  );
  assert.ok(f.library.open(f.bankId).completedAt);
  assert.equal(readJournal(f.directory).roundId, snapshot.practiceEpoch);
  assert.equal(f.rounds().length, 1);
  assert.equal((await f.restart()).status, 200);
  assert.equal(f.rounds().length, 1);
});

test('cleanup failure after commit preserves the archive and new writes instead of rolling back', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const original = fs.unlinkSync;
  fs.unlinkSync = (file) => {
    if (String(file).includes('previous-practice')) {
      throw Error('locked backup');
    }
    return original(file);
  };
  let response;
  try {
    response = f.library.restart(f.bankId, f.input);
  } finally {
    fs.unlinkSync = original;
  }
  assert.equal(response.completedAt, null);
  assert.match(response.notice, /临时备份/);
  f.library.write(f.bankId, '1', 'answer', {
    requestId: 'fresh-answer',
    snapshotId: response.snapshotId,
    expectedRevision: 0,
    answer: { selected: '甲' },
    answered: true,
  });
  assert.equal((await f.restart()).value.states[0].hasSavedAnswer, true);
  assert.equal(f.rounds().length, 1);
});

test('interrupted rollback preserves both original backup and unexpected new practice until recovery is safe', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const before = fs.readFileSync(f.library.stateStore.file(f.directory));
  const foreign = path.join(f.directory, '.qf-v2', 'practice', 'unknown.json');
  assert.throws(() =>
    archivePractice(f.library, f.snapshot, f.input, (at) => {
      if (at === 'fresh') {
        fs.writeFileSync(foreign, 'do not erase');
        throw Error('interrupted');
      }
    }),
  );
  const journal = readJournal(f.directory);
  assert.equal(journal.phase, 'prepared');
  const backup = path.join(
    f.directory,
    '.qf-v2',
    `.restart-${journal.roundId}`,
    'previous-practice',
    'state.json',
  );
  assert.ok(fs.readFileSync(backup).equals(before));
  const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
  assert.throws(() => fresh.open(f.bankId));
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'do not erase');
  assert.ok(fs.readFileSync(backup).equals(before));
  fs.unlinkSync(foreign);
  assert.ok(fresh.open(f.bankId).completedAt);
  assert.ok(fs.readFileSync(f.library.stateStore.file(f.directory)).equals(before));
});
