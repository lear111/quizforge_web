import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { restartFixture } from '../fixtures/v2-restart.mjs';
import { jsonBytes, parseJson } from '../../server/host/platform/json.js';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';

function bytes(directory) {
  const rows = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(file);
      } else {
        rows.push([
          path.relative(directory, file),
          createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        ]);
      }
    }
  }
  walk(directory);
  return rows;
}

async function archived(t) {
  const f = await restartFixture(t);
  f.library.write(f.bankId, '1', 'answer', {
    ...f.input,
    requestId: 'answer',
    expectedRevision: 0,
    answer: { selected: '乙' },
    answered: true,
  });
  f.library.write(f.bankId, '1', 'ink', {
    ...f.input,
    requestId: 'ink',
    expectedInkRevision: 0,
    ink: { strokes: [{ x: 42, y: 19 }] },
  });
  await f.finish();
  const q = f.library.stateStore.get(f.snapshot, '1');
  f.library.results(f.bankId, {
    ...f.input,
    requestId: 'grade',
    results: [
      {
        questionId: '1',
        submissionId: q.submissionId,
        expectedRevision: q.revision,
        result: { score: 2, parts: null, message: null },
      },
    ],
  });
  const next = await f.restart();
  assert.equal(next.status, 200, JSON.stringify(next.value));
  const directory = f.rounds()[0],
    roundId = path.basename(directory);
  return {
    ...f,
    roundDirectory: directory,
    roundId,
    roundBase: f.base + '/rounds/' + roundId,
    next: next.value,
  };
}

test('history lists no rounds before archiving and sorts real finalized totals by completion time', async (t) => {
  const f = await restartFixture(t);
  assert.deepEqual((await f.api(f.base + '/rounds')).value, []);
  assert.equal(fs.existsSync(f.library.stateStore.file(f.directory)), false);
  const order = [];
  for (let i = 0; i < 3; i++) {
    const snapshot = (await f.api(f.base + '/overview')).value.snapshotId;
    assert.equal(
      (await f.api(f.base + '/finish', { requestId: 'f' + i, snapshotId: snapshot })).status,
      200,
    );
    const file = f.library.stateStore.file(f.directory),
      state = parseJson(fs.readFileSync(file));
    state.completedAt = `2026-11-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`;
    fs.writeFileSync(file, jsonBytes(state));
    const previous = new Set(f.rounds());
    assert.equal((await f.restart({ requestId: 'r' + i, snapshotId: snapshot })).status, 200);
    order.unshift(path.basename(f.rounds().find((p) => !previous.has(p))));
  }
  const before = bytes(f.directory),
    response = await f.api(f.base + '/rounds');
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.value.map((r) => r.roundId),
    order,
  );
  assert.ok(response.value.every((r) => r.score === 0 && r.maxScore === 10.3));
  assert.deepEqual(bytes(f.directory), before);
});

test('history reads archived questions, answers, scores, extensions and ink without reconciling changed practice', async (t) => {
  const f = await archived(t),
    live = await f.api(f.base + '/questions/1?snapshotId=' + f.next.snapshotId);
  f.library.write(f.bankId, '1', 'answer', {
    requestId: 'new-answer',
    snapshotId: f.next.snapshotId,
    expectedRevision: 0,
    answer: { selected: '甲' },
    answered: true,
  });
  const raw = parseJson(fs.readFileSync(f.bankFile));
  raw.questions['1'].question.stem = '现在的题目';
  fs.writeFileSync(f.bankFile, jsonBytes(raw));
  fs.writeFileSync(path.join(f.extension, 'practice.js'), 'CURRENT_EXTENSION_ONLY');
  const before = bytes(f.directory);
  const overview = await f.api(f.roundBase + '/overview');
  assert.equal(overview.status, 200, JSON.stringify(overview.value));
  assert.equal(overview.value.readOnly, true);
  assert.equal(overview.value.roundId, f.roundId);
  assert.equal(overview.value.total.score, 2);
  assert.equal(overview.value.pendingGrading.length, 0);
  assert.equal(overview.value.initial.question.readOnly, true);
  const q = (await f.api(f.roundBase + '/questions/1')).value;
  assert.equal(q.question.stem.type, 'doc');
  assert.equal(q.answer.selected, '乙');
  assert.equal(q.result.score, 2);
  assert.equal(q.state.locked, true);
  assert.deepEqual(q.ink, { strokes: [{ x: 42, y: 19 }] });
  assert.equal(q.inkRevision, 1);
  assert.notEqual(q.extension.artifactId, live.value.extension.artifactId);
  const manifest = await f.api('/api/v2/extensions/' + q.extension.artifactId + '/manifest');
  assert.equal(manifest.status, 200, JSON.stringify(manifest.value));
  const response = await fetch(
    `http://127.0.0.1:${f.server.port()}/api/v2/extensions/${q.extension.artifactId}/files/practice-js`,
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /AUTHOR_CODE_EXECUTED_IN_BACKEND/);
  assert.deepEqual(bytes(f.directory), before);
});

test('every history write route including ink and delete returns 404 and leaves both states byte-identical', async (t) => {
  const f = await archived(t),
    before = bytes(f.directory);
  for (const [route, method] of [
    ['/questions/1/answer', 'PUT'],
    ['/questions/1/submit', 'POST'],
    ['/questions/1/retry', 'POST'],
    ['/questions/1/result', 'PUT'],
    ['/questions/1/ink', 'PUT'],
    ['/results', 'PUT'],
    ['/finish', 'POST'],
    ['/restart', 'POST'],
    ['', 'DELETE'],
  ]) {
    const response = await f.api(
      f.roundBase + route,
      { ...f.input, answer: 'attack', ink: 'attack', result: { score: 999 } },
      method,
    );
    assert.equal(response.status, 404, route + JSON.stringify(response.value));
  }
  assert.deepEqual(bytes(f.directory), before);
});

test('historical asset references are archived, bytes come from source and missing material is an explicit 404', async (t) => {
  const f = await archived(t),
    q = (await f.api(f.roundBase + '/questions/1')).value;
  const asset = q.resources.find((r) => r.reference === 'qf-asset:assets/figure.png');
  const route = `http://127.0.0.1:${f.server.port()}${f.roundBase}/questions/1/assets/${asset.assetId}`;
  const before = bytes(f.directory);
  assert.equal((await fetch(route)).status, 200);
  assert.deepEqual(bytes(f.directory), before);
  fs.unlinkSync(path.join(f.directory, 'assets/figure.png'));
  const response = await fetch(route);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.message, '素材已不存在');
  assert.equal((await f.api(f.roundBase + '/questions/1')).status, 200);
});

test('unavailable archived extension keeps historical outline, state and score without using installed replacement', async (t) => {
  const f = await archived(t);
  fs.unlinkSync(path.join(f.roundDirectory, 'extensions/synthetic/choice/practice.js'));
  const before = bytes(f.directory),
    overview = await f.api(f.roundBase + '/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.value.outline.length, 2);
  assert.equal(overview.value.states.length, 6);
  assert.equal(overview.value.total.score, 2);
  assert.equal(overview.value.initial.question, null);
  assert.ok(overview.value.initial.error);
  assert.notEqual((await f.api(f.roundBase + '/questions/1')).status, 200);
  assert.deepEqual(bytes(f.directory), before);
});

test('invalid round IDs and corrupted archives never fall back to live state or rewrite files', async (t) => {
  const f = await archived(t);
  for (const id of ['invalid', '..%2F..', '00000000-0000-0000-0000-000000000000']) {
    assert.notEqual((await f.api(f.base + '/rounds/' + id + '/overview')).status, 200);
  }
  assert.equal((await f.api(f.roundBase + '/overview')).status, 200);
  fs.writeFileSync(path.join(f.roundDirectory, 'state.json'), '{"formatVersion":2,"questions":');
  const before = bytes(f.directory);
  for (const suffix of ['/overview', '/questions/1']) {
    const response = await f.api(f.roundBase + suffix);
    assert.equal(response.status, 503);
    assert.equal(response.value.error.code, 'STATE_INVALID');
  }
  assert.equal((await f.api(f.base + '/rounds')).status, 503);
  assert.deepEqual(bytes(f.directory), before);
});

test('staged and prepared archives are not listed or recovered by historical reads', async (t) => {
  const f = await archived(t);
  const journalFile = path.join(f.directory, '.qf-v2/restart.json');
  const journal = parseJson(fs.readFileSync(journalFile));
  journal.phase = 'prepared';
  fs.writeFileSync(journalFile, jsonBytes(journal));
  writeFixtureFile(path.join(f.directory, '.qf-v2/rounds/.staging/state.json'), 'not complete');
  const before = bytes(f.directory);
  assert.deepEqual((await f.api(f.base + '/rounds')).value, []);
  assert.equal((await f.api(f.roundBase + '/overview')).status, 404);
  assert.deepEqual(bytes(f.directory), before);
});

test('historical round and ink junctions or symlinks are rejected without reading outside content', async (t) => {
  for (const target of ['round', 'ink', 'assets']) {
    await t.test(target, async (t) => {
      const f = await archived(t),
        outside = path.join(f.root, 'outside');
      fs.mkdirSync(outside);
      const original =
        target === 'round'
          ? f.roundDirectory
          : target === 'ink'
            ? path.join(f.roundDirectory, 'ink')
            : path.join(f.directory, 'assets');
      fs.renameSync(original, path.join(f.root, 'moved'));
      fs.symlinkSync(outside, original, process.platform === 'win32' ? 'junction' : 'dir');
      const marker = path.join(outside, 'state.json');
      fs.writeFileSync(marker, 'must not be read or changed');
      const before = fs.readFileSync(marker);
      const response = await f.api(
        f.roundBase + (target === 'round' ? '/overview' : '/questions/1'),
      );
      if (target !== 'assets') {
        assert.notEqual(response.status, 200);
      } else {
        assert.equal(response.status, 200);
        const a = response.value.resources[0];
        assert.equal((await f.api(f.roundBase + '/questions/1/assets/' + a.assetId)).status, 404);
      }
      assert.ok(fs.readFileSync(marker).equals(before));
    });
  }
});
