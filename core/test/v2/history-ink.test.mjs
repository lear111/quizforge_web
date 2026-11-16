import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { HistoryRounds } from '../../server/v2/services/history.service.js';
import { readRound, historyInkFile } from '../../server/v2/repositories/history.repository.js';

async function fixture(t) {
  const f = await restartFixture(t, 3);
  await f.finish();
  const next = await f.restart();
  assert.equal(next.status, 200);
  const roundId = path.basename(f.rounds()[0]),
    route = `${f.base}/rounds/${roundId}`;
  const q = (await f.api(route + '/questions/1')).value;
  const input = {
    requestId: 'historic-ink',
    snapshotId: q.snapshotId,
    expectedInkRevision: 0,
    ink: { strokes: ['one'], viewport: { x: 9, y: 7, zoom: 0.8 } },
  };
  for (const op of ['answer', 'ink']) {
    f.library.write(f.bankId, '1', op, {
      ...input,
      snapshotId: next.value.snapshotId,
      expectedRevision: 0,
      answer: { selected: '甲' },
      answered: true,
    });
  }
  const round = readRound(f.library, f.bankId, roundId);
  const immutable = [
    f.bankFile,
    path.join(round.directory, 'bank.json'),
    path.join(round.directory, 'state.json'),
    path.join(f.directory, '.qf-v2/practice/state.json'),
    f.library.stateStore.ink.file(f.library.opened.get(f.bankId), '1'),
  ];
  const before = immutable.map((file) => fs.readFileSync(file));
  const api = async (...args) => {
    const result = await f.api(...args);
    immutable.forEach((file, i) => assert.ok(fs.readFileSync(file).equals(before[i]), file));
    return result;
  };
  return {
    ...f,
    api,
    roundId,
    route: route + '/questions/1/ink',
    q,
    input,
    round,
    file: historyInkFile(round, '1'),
  };
}

test('historical host ink persists its own revision/camera, replays receipts and survives a fresh reader', async (t) => {
  const f = await fixture(t);
  const first = await f.api(f.route, f.input, 'PUT');
  assert.equal(first.status, 200, JSON.stringify(first.value));
  assert.equal(first.value.inkRevision, 1);
  assert.equal(first.value.state.locked, true);
  assert.equal(first.value.state.hasInk, true);
  const before = fs.readFileSync(f.file);
  assert.deepEqual(await f.api(f.route, f.input, 'PUT'), first);
  assert.ok(fs.readFileSync(f.file).equals(before));
  const fresh = new HistoryRounds(f.library).question(f.bankId, f.roundId, '1');
  assert.deepEqual(fresh.ink, f.input.ink);
  assert.equal(fresh.inkRevision, 1);
  assert.equal(
    (await f.api(f.route, { ...f.input, ink: 'different' }, 'PUT')).value.error.code,
    'REQUEST_CONFLICT',
  );
});

test('historical ink conflict never overwrites newer strokes; atomic write failure retries identical bytes/id', async (t) => {
  const f = await fixture(t),
    repository = f.library.history.ink,
    write = repository.write;
  repository.write = () => {
    throw Error('synthetic disk failure');
  };
  const failure = await f.api(f.route, f.input, 'PUT');
  assert.equal(failure.value.error.code, 'STATE_WRITE_FAILED');
  assert.equal(fs.existsSync(f.file), false);
  repository.write = write;
  assert.equal((await f.api(f.route, f.input, 'PUT')).value.inkRevision, 1);
  const before = fs.readFileSync(f.file);
  const conflict = await f.api(
    f.route,
    { ...f.input, requestId: 'stale-tab', ink: 'stale' },
    'PUT',
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.value.error.code, 'REVISION_CONFLICT');
  assert.ok(fs.readFileSync(f.file).equals(before));
  const newer = {
    ...f.input,
    requestId: 'newer',
    expectedInkRevision: 1,
    ink: { strokes: ['two'] },
  };
  assert.equal((await f.api(f.route, newer, 'PUT')).value.inkRevision, 2);
});

test('historical ink rejects stale snapshots, missing questions, oversized ink and corrupted old records', async (t) => {
  const f = await fixture(t);
  for (const [body, code] of [
    [{ ...f.input, snapshotId: f.input.snapshotId + '-old' }, 'SNAPSHOT_STALE'],
    [{ ...f.input, requestId: '' }, 'INVALID_REQUEST'],
    [{ ...f.input, ink: 'x'.repeat(32 * 1024 * 1024) }, 'STATE_SIZE_LIMIT'],
  ]) {
    const result = await f.api(f.route, body, 'PUT');
    assert.equal(result.value.error.code, code);
    assert.equal(fs.existsSync(f.file), false);
  }
  assert.equal(
    (await f.api(f.route.replace('/questions/1/', '/questions/missing/'), f.input, 'PUT')).status,
    404,
  );
  fs.mkdirSync(path.dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, '{broken');
  assert.equal((await f.api(f.route, f.input, 'PUT')).value.error.code, 'STATE_INVALID');
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{broken');
});

test('historical ink rejects linked directories and linked files without touching their targets', async (t) => {
  for (const target of ['directory', 'file']) {
    await t.test(target, async (t) => {
      const f = await fixture(t),
        outside = path.join(f.root, 'outside-' + target);
      if (target === 'directory') {
        fs.mkdirSync(outside);
        fs.renameSync(path.join(f.round.directory, 'ink'), path.join(f.root, 'saved-ink'));
        fs.symlinkSync(
          outside,
          path.join(f.round.directory, 'ink'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } else {
        fs.mkdirSync(path.dirname(f.file), { recursive: true });
        if (process.platform === 'win32') {
          fs.mkdirSync(outside);
          fs.writeFileSync(path.join(outside, 'marker'), 'preserve');
          fs.symlinkSync(outside, f.file, 'junction');
        } else {
          fs.writeFileSync(outside, 'preserve');
          fs.symlinkSync(outside, f.file);
        }
      }
      const observe = () =>
        fs.lstatSync(outside).isDirectory()
          ? fs.readdirSync(outside)
          : createHash('sha256').update(fs.readFileSync(outside)).digest('hex');
      const before = observe();
      assert.notEqual((await f.api(f.route, f.input, 'PUT')).status, 200);
      const after = observe();
      assert.deepEqual(after, before);
    });
  }
});
