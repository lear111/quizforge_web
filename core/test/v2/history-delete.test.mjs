import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { archivePractice } from '../../server/v2/services/practice-archive.service.js';
import { createPracticeLibrary } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { readJournal } from '../../server/v2/repositories/restart-journal.repository.js';
import { deleteRoundFiles } from '../../server/v2/repositories/history-delete.repository.js';

async function finish(f, label) {
  const { snapshotId } = (await f.api(f.base + '/overview')).value;
  assert.equal(
    (await f.api(f.base + '/finish', { requestId: `${label}-finish`, snapshotId })).status,
    200,
  );
  return { requestId: `${label}-restart`, snapshotId };
}

async function archive(f, label) {
  const input = await finish(f, label);
  const response = await f.restart(input);
  assert.equal(response.status, 200, JSON.stringify(response.value));
  const { roundId } = readJournal(f.directory);
  return {
    input,
    roundId,
    directory: f.rounds().find((directory) => path.basename(directory) === roundId),
    snapshotId: response.value.snapshotId,
    route: `${f.base}/rounds/${roundId}`,
  };
}

const deleteRequest = (f, route) =>
  fetch(`http://127.0.0.1:${f.server.port()}${route}`, { method: 'DELETE' });

async function remove(f, route) {
  const response = await deleteRequest(f, route);
  const body = await response.text();
  assert.equal(response.status, 204, body);
  assert.equal(body, '');
}

function contents(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(directory, file), fs.readFileSync(file)];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

function checkMarker(round) {
  assert.deepEqual(fs.readdirSync(round.directory), ['deleted.json']);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(round.directory, 'deleted.json'), 'utf8')),
    {
      formatVersion: 1,
      roundId: round.roundId,
    },
  );
}

async function list(f) {
  const response = await f.api(f.base + '/rounds');
  assert.equal(response.status, 200, JSON.stringify(response.value));
  return response.value.map(({ roundId }) => roundId);
}

test('delete one non-latest round and its contents without touching other rounds, receipt or practice bytes', async (t) => {
  const f = await restartFixture(t);
  const first = await archive(f, 'old');
  const latest = await archive(f, 'latest');
  const request = { snapshotId: latest.snapshotId, requestId: 'current-work' };
  f.library.write(f.bankId, '1', 'answer', {
    ...request,
    expectedRevision: 0,
    answer: { selected: '甲' },
    answered: true,
  });
  f.library.write(f.bankId, '1', 'ink', {
    ...request,
    expectedInkRevision: 0,
    ink: { strokes: [{ x: 1, y: 2 }] },
  });
  fs.mkdirSync(path.join(first.directory, 'extra'));
  fs.writeFileSync(path.join(first.directory, 'extra', 'extra.txt'), 'archived extra bytes');
  const oldQuestion = (await f.api(first.route + '/questions/1')).value;
  const manifest = `/api/v2/extensions/${oldQuestion.extension.artifactId}/manifest`;
  assert.equal((await f.api(manifest)).status, 200);
  const practice = path.join(f.directory, '.qf-v2', 'practice');
  const journal = path.join(f.directory, '.qf-v2', 'restart.json');
  const before = [contents(practice), contents(latest.directory), fs.readFileSync(journal)];
  assert.ok(before[0].some(([file]) => file.startsWith('ink')));

  await remove(f, first.route);
  checkMarker(first);
  assert.deepEqual(await list(f), [latest.roundId]);
  assert.equal((await f.api(first.route + '/overview')).status, 404);
  assert.equal((await f.api(first.route + '/questions/1')).status, 404);
  assert.equal((await f.api(first.route + '/questions/1/ink', request, 'PUT')).status, 404);
  assert.equal((await f.api(manifest)).status, 404);
  await remove(f, first.route);
  assert.deepEqual(
    [contents(practice), contents(latest.directory), fs.readFileSync(journal)],
    before,
  );
});

test('delete the journal’s latest round, then open, replay the original request, and archive again', async (t) => {
  const f = await restartFixture(t);
  const first = await archive(f, 'first');
  const journal = path.join(f.directory, '.qf-v2', 'restart.json');
  const before = fs.readFileSync(journal);
  await remove(f, first.route);
  assert.deepEqual(await list(f), []);
  const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
  assert.equal(fresh.open(f.bankId).snapshotId, first.snapshotId);
  assert.equal(fresh.restart(f.bankId, first.input).snapshotId, first.snapshotId);
  assert.deepEqual(fs.readFileSync(journal), before);
  assert.equal(f.rounds().length, 1);
  const next = await archive(f, 'next');
  assert.deepEqual(await list(f), [next.roundId]);
  checkMarker(first);
});

test('failed new restart rolls back to the prior receipt even if its round was deleted', async (t) => {
  const f = await restartFixture(t);
  const prior = await archive(f, 'prior');
  await remove(f, prior.route);
  const input = await finish(f, 'later');
  const snapshot = f.library.opened.get(f.bankId);
  const state = f.library.stateStore.file(f.directory);
  const before = fs.readFileSync(state);
  assert.throws(() =>
    archivePractice(f.library, snapshot, input, (phase) => {
      if (phase === 'published') {
        throw Error('synthetic archive failure');
      }
    }),
  );
  assert.deepEqual(fs.readFileSync(state), before);
  const fresh = createPracticeLibrary(f.root, f.codeRoot, { stateStore: new PracticeState() });
  assert.ok(fresh.open(f.bankId).completedAt);
  assert.equal(readJournal(f.directory).roundId, prior.roundId);
  assert.equal(fresh.restart(f.bankId, prior.input).snapshotId, prior.snapshotId);
  assert.equal(f.rounds().length, 1);
  checkMarker(prior);
});

test('an actual process exit after deleting one archive file hides the round and list finishes cleanup', async (t) => {
  const f = await restartFixture(t);
  const round = await archive(f, 'crash');
  const entry = new URL(
    '../../server/v2/repositories/history-delete.repository.js',
    import.meta.url,
  );
  const child = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import fs from 'node:fs';
    import { deleteRoundFiles } from ${JSON.stringify(entry.href)};
    const unlink = fs.unlinkSync;
    fs.unlinkSync = (file) => { unlink(file); process.exit(87); };
    deleteRoundFiles(process.argv[1], process.argv[2]);
  `,
      round.directory,
      round.roundId,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(child.status, 87, child.stderr);
  const residual = fs.readdirSync(round.directory);
  assert.ok(residual.includes('deleted.json') && residual.length > 1);
  assert.equal((await f.api(round.route + '/overview')).status, 404);
  assert.equal((await f.api(f.base + '/overview')).value.snapshotId, round.snapshotId);
  assert.deepEqual(await list(f), []);
  checkMarker(round);
  await remove(f, round.route);
});

test('an atomic marker write failure leaves the complete archive visible and permits retry', async (t) => {
  const f = await restartFixture(t);
  const round = await archive(f, 'marker-error');
  const question = (await f.api(round.route + '/questions/1')).value;
  const manifest = `/api/v2/extensions/${question.extension.artifactId}/manifest`;
  assert.equal((await f.api(manifest)).status, 200);
  const before = contents(round.directory);
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(round.directory, 'deleted.json')) {
      throw Object.assign(Error('synthetic write failure'), { code: 'EIO' });
    }
    return original(from, to);
  };
  try {
    const response = await deleteRequest(f, round.route);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'STATE_WRITE_FAILED');
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(contents(round.directory), before);
  assert.deepEqual(await list(f), [round.roundId]);
  assert.equal((await f.api(manifest)).status, 200);
  await remove(f, round.route);
});

test('damaged bank/state bytes can be deleted; a bad marker does not authenticate logical deletion', async (t) => {
  const f = await restartFixture(t);
  const round = await archive(f, 'damaged');
  const marker = path.join(round.directory, 'deleted.json');
  fs.writeFileSync(marker, JSON.stringify({ formatVersion: 1, roundId: 'other' }));
  assert.equal((await f.api(round.route + '/overview')).status, 503);
  assert.equal((await f.api(f.base + '/overview')).status, 503);
  fs.writeFileSync(path.join(round.directory, 'bank.json'), '{');
  fs.writeFileSync(path.join(round.directory, 'state.json'), 'invalid');
  await remove(f, round.route);
  checkMarker(round);
  assert.equal((await f.api(f.base + '/overview')).status, 200);
});

test('a directory replacement between preflight and marking is rejected and neither directory is erased', async (t) => {
  const f = await restartFixture(t);
  const round = await archive(f, 'replace');
  const moved = path.join(path.dirname(round.directory), 'moved');
  const before = contents(round.directory);
  assert.throws(
    () =>
      deleteRoundFiles(round.directory, round.roundId, () => {
        fs.renameSync(round.directory, moved);
        fs.mkdirSync(round.directory);
        fs.writeFileSync(path.join(round.directory, 'unrelated'), 'keep');
      }),
    { code: 'STATE_WRITE_FAILED' },
  );
  assert.deepEqual(fs.readdirSync(round.directory), ['unrelated']);
  assert.deepEqual(contents(moved), before);
});

test('unsafe round paths and nested links are refused before marking or erasing any original file', async (t) => {
  for (const redirect of ['round', 'nested']) {
    await t.test(redirect, async (t) => {
      const f = await restartFixture(t);
      const round = await archive(f, 'unsafe');
      const outside = path.join(f.root, 'outside');
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'keep'), 'outside data');
      const before = contents(round.directory);
      const request = await deleteRequest(f, f.base + '/rounds/..%2Fpractice');
      assert.equal(request.status, 400);
      assert.equal(
        (await deleteRequest(f, '/api/v2/banks/unknown/rounds/' + round.roundId)).status,
        404,
      );
      const link = redirect === 'round' ? round.directory : path.join(round.directory, 'linked');
      const saved = path.join(f.root, 'original');
      if (redirect === 'round') {
        fs.renameSync(round.directory, saved);
      }
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      try {
        const response = await deleteRequest(f, round.route);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).error.code, 'STATE_WRITE_FAILED');
        assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
        assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'outside data');
      } finally {
        fs.unlinkSync(link);
        if (redirect === 'round') {
          fs.renameSync(saved, round.directory);
        }
      }
      assert.deepEqual(contents(round.directory), before);
    });
  }
});

test('cleanup failure stays hidden, does not block opening or archiving, and can be retried', async (t) => {
  const f = await restartFixture(t);
  const round = await archive(f, 'cleanup-error');
  const question = (await f.api(round.route + '/questions/1')).value;
  const manifest = `/api/v2/extensions/${question.extension.artifactId}/manifest`;
  assert.equal((await f.api(manifest)).status, 200);
  const unlink = fs.unlinkSync;
  fs.unlinkSync = (file) => {
    if (file.startsWith(round.directory + path.sep)) {
      throw Error('synthetic locked archive file');
    }
    return unlink(file);
  };
  try {
    const response = await deleteRequest(f, round.route);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error.message, /已标记删除/);
    assert.deepEqual(await list(f), []);
    assert.equal((await f.api(round.route + '/overview')).status, 404);
    assert.equal((await f.api(manifest)).status, 404);
    assert.equal((await f.api(f.base + '/overview')).value.snapshotId, round.snapshotId);
    const later = await archive(f, 'while-cleanup-pending');
    assert.deepEqual(await list(f), [later.roundId]);
  } finally {
    fs.unlinkSync = unlink;
  }
  await remove(f, round.route);
  checkMarker(round);
});
