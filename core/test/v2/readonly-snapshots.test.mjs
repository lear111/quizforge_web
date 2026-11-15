import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { LibrarySnapshots } from '../../server/v2/services/bank.service.js';
import { createReadFixture, addFixtureExtension, writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { running } from '../fixtures/v2-readonly.mjs';

test('extension matching uses id plus major, refuses ambiguous versions and does not pick a latest version', async (t) => {
  const { fixture, get, open } = await running(t);
  addFixtureExtension(fixture.root, { name: 'different-major', version: '3.0.0' });
  assert.equal((await open()).body.initial.question.extension.version, '2.1.0');
  const second = addFixtureExtension(fixture.root, { name: 'duplicate-major', version: '2.9.0' });
  await get('/api/v2/catalog');
  const ambiguous = await open();
  assert.equal(ambiguous.response.status, 200);
  assert.equal(ambiguous.body.initial.error.code, 'EXTENSION_AMBIGUOUS');
  assert.equal(ambiguous.body.initial.error.details.matches, 2);
  fs.rmSync(second, { recursive: true });
  fixture.bank.questions['1'].type = 'quizforge.synthetic-choice@4';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'EXTENSION_NOT_FOUND');
});

test('explicit opening detects file changes but ordinary question GET borrows the opened immutable snapshot', async (t) => {
  const { fixture, server, open, get, base, bankId } = await running(t);
  const first = (await open()).body,
    query = '?snapshotId=' + first.snapshotId;
  const oldFingerprint = server.library.opened.get(bankId).contentFingerprint;
  fixture.bank.questions['1'].question.stem = { text: 'changed' };
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const old = await get(base + '/questions/1' + query);
  assert.notDeepEqual(old.body.question.stem, { text: 'changed' });
  const next = (await open('1')).body;
  assert.notEqual(next.snapshotId, first.snapshotId);
  assert.deepEqual(next.initial.question.question.stem, { text: 'changed' });
  assert.equal((await get(base + '/questions/1' + query)).body.error.code, 'SNAPSHOT_STALE');
  assert.notEqual(server.library.opened.get(bankId).contentFingerprint, oldFingerprint);
  const changedFingerprint = server.library.opened.get(bankId).contentFingerprint;
  writeFixtureFile(
    path.join(fixture.directory, 'assets', 'figure.png'),
    Buffer.from('different bytes'),
  );
  fixture.bank.listening.https.src = 'https://audio.example.test/replaced.mp3';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  writeFixtureFile(
    path.join(fixture.extension, 'practice.js'),
    '/* different code, never executed */',
  );
  const resourceChange = (await open('1')).body;
  assert.notEqual(resourceChange.snapshotId, next.snapshotId);
  assert.notEqual(server.library.opened.get(bankId).contentFingerprint, changedFingerprint);
  assert.equal((await open('1')).body.snapshotId, resourceChange.snapshotId);
  // Mutating an outward payload cannot mutate the frozen source data.
  const result = server.library.question(bankId, '1', resourceChange.snapshotId);
  result.question.stem.text = 'caller mutation';
  assert.equal(
    server.library.question(bankId, '1', resourceChange.snapshotId).question.stem.text,
    'changed',
  );
});

test('normal question reads perform no directory or content checks; explicit development marking only refreshes that extension', (t) => {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const library = new LibrarySnapshots(fixture.root, fixture.codeRoot),
    bankId = library.catalog().groups[0].items[0].bankId;
  const view = library.open(bankId);
  const originalRead = fs.readdirSync,
    originalStat = fs.lstatSync;
  let reads = 0,
    stats = 0;
  fs.readdirSync = (...args) => {
    reads++;
    return originalRead(...args);
  };
  fs.lstatSync = (...args) => {
    stats++;
    return originalStat(...args);
  };
  try {
    library.question(bankId, '1', view.snapshotId);
  } finally {
    fs.readdirSync = originalRead;
    fs.lstatSync = originalStat;
  }
  assert.equal(reads, 0);
  assert.equal(stats, 0);
  const manifestFile = path.join(fixture.extension, 'manifest.json'),
    manifest = JSON.parse(fs.readFileSync(manifestFile));
  manifest.development = true;
  writeFixtureFile(manifestFile, manifest);
  const development = new LibrarySnapshots(fixture.root, fixture.codeRoot, { development: true });
  const devView = development.open(bankId),
    oldId = devView.initial.question.extension.artifactId;
  writeFixtureFile(path.join(fixture.extension, 'practice.js'), '/* edited dev script */');
  const updated = development.question(bankId, '1', devView.snapshotId);
  assert.notEqual(updated.extension.artifactId, oldId);
  assert.equal(
    development.artifact(updated.extension.artifactId).descriptor.artifactId,
    updated.extension.artifactId,
  );
});

test('file count limit reports its lower bound and stops at 1000, without leaking filenames', async (t) => {
  const { fixture, open } = await running(t);
  for (let i = 0; i < 1000; i++) {
    writeFixtureFile(path.join(fixture.directory, 'assets', `extra-${i}.dat`), 'a');
  }
  const result = await open();
  assert.equal(result.response.status, 422);
  assert.equal(result.body.error.code, 'FILE_COUNT_LIMIT');
  assert.deepEqual(result.body.error.details, { lowerBound: 1001, limit: 1000 });
  assert.match(result.body.error.message, /至少 1001 项，上限 1000 项/);
  assert.ok(!result.text.includes('extra-'));
});
