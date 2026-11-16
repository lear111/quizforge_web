import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import {
  recoverRestart,
  restartPaths,
} from '../../server/v2/repositories/restart-journal.repository.js';

test('archive rejects redirected extension, ink, rounds and staging paths without touching targets', async (t) => {
  for (const kind of ['extension', 'ink', 'rounds', 'root']) {
    await t.test(kind, async (t) => {
      const f = await restartFixture(t);
      await f.finish();
      const state = f.library.stateStore.file(f.directory);
      const before = fs.readFileSync(state);
      const outside = path.join(f.root, 'untouched');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'sentinel'), 'never remove');
      let target =
        kind === 'extension'
          ? f.extension
          : kind === 'ink'
            ? path.join(f.directory, '.qf-v2', 'practice', 'ink')
            : path.join(f.directory, '.qf-v2', 'rounds');
      if (kind === 'root') {
        // A regular file where a directory is expected is also refused.
        fs.writeFileSync(target, 'not a directory');
      } else {
        if (fs.existsSync(target)) {
          // These are only this test's synthetic extension files, with no records.
          const relative = path.relative(f.root, target);
          assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
          fs.rmSync(target, { recursive: true });
        }
        fs.symlinkSync(outside, target, 'junction');
      }
      const result = await f.restart();
      assert.notEqual(result.status, 200);
      assert.ok(fs.readFileSync(state).equals(before));
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'never remove');
    });
  }
});

test('unknown practice content is preserved rather than cleared with the backup', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const unexpected = path.join(f.directory, '.qf-v2', 'practice', 'answer-files');
  fs.mkdirSync(unexpected);
  fs.writeFileSync(path.join(unexpected, 'unknown'), 'preserve');
  assert.notEqual((await f.restart()).status, 200);
  assert.equal(fs.readFileSync(path.join(unexpected, 'unknown'), 'utf8'), 'preserve');
  assert.ok(f.library.open(f.bankId).completedAt);
  assert.equal(f.rounds().length, 0);
});

test('malformed journals and path traversal round IDs are rejected without deleting anything', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  const state = fs.readFileSync(f.library.stateStore.file(f.directory));
  for (const roundId of ['../practice', 'C:\\Windows', 'CON', 'a/../b', '.']) {
    assert.throws(() => restartPaths(f.directory, roundId));
    fs.writeFileSync(
      path.join(f.directory, '.qf-v2', 'restart.json'),
      JSON.stringify({
        phase: 'prepared',
        requestId: 'bad',
        snapshotId: f.input.snapshotId,
        roundId,
        previous: null,
      }),
    );
    assert.throws(() => recoverRestart(f.directory));
    assert.ok(fs.readFileSync(f.library.stateStore.file(f.directory)).equals(state));
  }
});

test('archive does not expose history read/write endpoints or assets under the private directory', async (t) => {
  const f = await restartFixture(t);
  await f.finish();
  await f.restart();
  for (const suffix of ['/rounds', '/rounds/any', '/rounds/any/questions/1']) {
    assert.notEqual((await f.api(f.base + suffix)).status, 200);
    assert.notEqual((await f.api(f.base + suffix, {}, 'PUT')).status, 200);
  }
});
