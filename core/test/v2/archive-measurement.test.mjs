import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  temporaryRoot,
  createArchiveFixture,
  inventory,
  sourceHashes,
} from '../../scripts/dev/v2-archive-fixture.mjs';
import { archiveSample, numericComparison } from '../../scripts/dev/v2-archive-metrics.mjs';
import { StateRepository } from '../../server/v2/repositories/state.repository.js';
import { PracticeInk } from '../../server/v2/repositories/ink.repository.js';
import { jsonBytes } from '../../server/host/platform/json.js';

test('J synthetic completed round is readable by existing state and ink repositories without source changes', () => {
  const temporary = temporaryRoot();
  try {
    const fixture = createArchiveFixture(temporary.root, {
      name: 'fixture',
      answerUnits: 4,
      strokes: 2,
    });
    const before = sourceHashes(fixture),
      size = inventory(fixture);
    const loaded = new StateRepository().load(fixture.directory);
    assert.equal(Object.keys(loaded.questions).length, 200);
    assert.ok(loaded.completedAt);
    assert.equal(Object.values(loaded.questions).filter((q) => q.answer === null).length, 50);
    assert.equal(
      Object.values(loaded.questions).filter((q) => q.result?.score === null).length,
      50,
    );
    assert.equal(Object.values(loaded.questions).filter((q) => q.result === null).length, 50);
    assert.ok(
      Object.values(loaded.questions).every((q) => q.submissionId && q.receipts.length <= 4),
    );
    assert.equal(new Set(Object.values(loaded.questions).map((q) => q.receipts.length)).size, 5);
    assert.equal(size.inkFiles, 100);
    assert.equal(fs.readdirSync(fixture.extensionRoot).length, 3);
    const snapshot = {
      directory: fixture.directory,
      contentFingerprint: loaded.contentFingerprint,
    };
    const ink = new PracticeInk();
    assert.ok(ink.read(snapshot, '1').ink.strokes.length > 0);
    assert.equal(ink.read(snapshot, '2').ink, null);
    assert.ok(
      jsonBytes(loaded).equals(
        fs.readFileSync(path.join(fixture.directory, '.qf-v2/practice/state.json')),
      ),
    );
    assert.deepEqual(sourceHashes(fixture), before);
  } finally {
    temporary.cleanup();
  }
  assert.equal(fs.existsSync(temporary.root), false);
});

test('J simulation has exclusive stages, exact copied bytes and never removes the completed source', () => {
  const temporary = temporaryRoot();
  try {
    const fixture = createArchiveFixture(temporary.root, {
      name: 'fixture',
      answerUnits: 4,
      strokes: 2,
    });
    const before = sourceHashes(fixture),
      size = inventory(fixture);
    const destination = path.join(temporary.root, 'archive');
    const row = archiveSample(fixture, destination);
    const sum = Object.entries(row)
      .filter(([key]) => key !== 'total')
      .reduce((total, [, ms]) => total + ms, 0);
    assert.ok(Math.abs(sum - row.total) < 1e-6);
    assert.ok(Object.values(row).every((ms) => ms >= 0));
    const copied = sourceHashes({ directory: destination });
    assert.equal(Object.keys(copied).length, 2 + size.extensionFiles + size.inkFiles);
    assert.equal(copied['state.json'], before[path.join('.qf-v2', 'practice', 'state.json')]);
    assert.deepEqual(sourceHashes(fixture), before);
    assert.equal(fs.existsSync(path.join(fixture.directory, '.qf-v2/practice/state.json')), true);
  } finally {
    temporary.cleanup();
  }
});

test('J native comparison retains evidence of number-kind and unsafe-integer differences', () => {
  const compared = numericComparison();
  assert.equal(compared.equal, false);
  assert.match(compared.custom, /"float":1\.0/);
  assert.match(compared.custom, /9007199254740993/);
  assert.match(compared.native, /9007199254740992/);
});
