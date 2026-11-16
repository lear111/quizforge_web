import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { LibrarySnapshots } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { hash, jsonBytes } from '../../server/host/platform/json.js';
import {
  setupPracticeStorage,
  seedCurrentAndNeighbors,
  treeBytes,
  currentBytes,
} from '../fixtures/v2-practice-storage.mjs';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';

test('D50 new paths, state cache keys, receipts, independent ink and process reconstruction use practice only', (t) => {
  const f = setupPracticeStorage(t);
  assert.equal(fs.existsSync(f.local), false);
  const stateFile = path.join(f.local, 'practice/state.json');
  assert.equal(f.store.file(f.fixture.directory), stateFile);
  assert.equal(fs.existsSync(f.local), false);
  const input = { requestId: 'answer', expectedRevision: 0, answer: 'A' };
  f.write('answer', input);
  f.write('ink', { requestId: 'ink', expectedInkRevision: 0, ink: [{ x: 2, y: 3 }] });
  const inkFile = path.join(
    f.local,
    'practice/ink',
    f.snapshot.contentFingerprint,
    hash(Buffer.from('1')) + '.json',
  );
  assert.equal(f.store.ink.file(f.snapshot, '1'), inkFile);
  const stateBytes = fs.readFileSync(stateFile),
    inkBytes = fs.readFileSync(inkFile);
  assert.equal(f.write('answer', input).state.revision, 1);
  assert.ok(fs.readFileSync(stateFile).equals(stateBytes));
  assert.throws(() => f.write('answer', { ...input, requestId: 'conflict' }), {
    code: 'REVISION_CONFLICT',
  });
  const store = new PracticeState();
  const library = new LibrarySnapshots(f.fixture.root, f.fixture.codeRoot, { stateStore: store });
  const reopened = library.open(f.id).initial.question;
  assert.equal(reopened.answer, 'A');
  assert.deepEqual(reopened.ink, [{ x: 2, y: 3 }]);
  assert.deepEqual([...store.loaded.keys()], [stateFile]);
  assert.deepEqual([...store.identities.keys()], [stateFile]);
  assert.equal(store.records.exists(f.fixture.directory), true);
  store.evict(f.fixture.directory);
  assert.equal(store.loaded.size, 0);
  assert.equal(store.identities.size, 0);
  assert.equal(store.ink.indexes.size, 0);
  assert.ok(fs.readFileSync(inkFile).equals(inkBytes));
  assert.equal(fs.existsSync(f.legacyFile), false);
  assert.equal(fs.existsSync(path.join(f.local, 'ink')), false);
});

test('D50 refresh discovers external deletion and changes at the new state location', (t) => {
  const f = setupPracticeStorage(t);
  f.write('answer', { requestId: 'a', expectedRevision: 0, answer: 'A' });
  const file = f.store.file(f.fixture.directory);
  const changed = JSON.parse(fs.readFileSync(file));
  changed.questions['1'].answer = 'external-answer';
  changed.questions['1'].revision++;
  writeFixtureFile(file, changed);
  assert.equal(f.library.open(f.id).initial.question.answer, 'external-answer');
  fs.unlinkSync(file);
  assert.equal(f.library.open(f.id).initial.question.answer, null);
  assert.equal(fs.existsSync(file), false);
  assert.equal(f.store.records.exists(f.fixture.directory), false);
});

test('D50 a fresh Node process restores answer and ink from practice without changing persisted bytes', (t) => {
  const f = setupPracticeStorage(t);
  f.write('answer', { requestId: 'restart-answer', expectedRevision: 0, answer: 'A' });
  f.write('ink', { requestId: 'restart-ink', expectedInkRevision: 0, ink: ['restart-ink'] });
  const before = treeBytes(f.local);
  const script = `
    import { LibrarySnapshots } from ${JSON.stringify(new URL('../../server/v2/services/bank.service.js', import.meta.url).href)};
    import { PracticeState } from ${JSON.stringify(new URL('../../server/v2/services/practice.service.js', import.meta.url).href)};
    const { root, codeRoot, id } = JSON.parse(process.argv[1]);
    const library = new LibrarySnapshots(root, codeRoot, { stateStore: new PracticeState() });
    process.stdout.write(JSON.stringify(library.open(id).initial.question));
  `;
  const restored = JSON.parse(
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', script, JSON.stringify({ ...f.fixture, id: f.id })],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(restored.answer, 'A');
  assert.deepEqual(restored.ink, ['restart-ink']);
  assert.deepEqual(treeBytes(f.local), before);
});

test('D50 content changes clear only practice state and ink, leaving other private directories byte-identical', (t) => {
  const f = setupPracticeStorage(t);
  seedCurrentAndNeighbors(f);
  const exam = treeBytes(path.join(f.local, 'exam'));
  const rounds = treeBytes(path.join(f.local, 'rounds'));
  fs.appendFileSync(f.fixture.bankFile, ' ');
  assert.equal(f.library.open(f.id).activeCleared, true);
  assert.deepEqual(f.store.load(f.fixture.directory).questions, {});
  assert.equal(fs.existsSync(path.join(f.local, 'practice/ink')), false);
  assert.deepEqual(treeBytes(path.join(f.local, 'exam')), exam);
  assert.deepEqual(treeBytes(path.join(f.local, 'rounds')), rounds);
  assert.equal(fs.readFileSync(path.join(f.local, 'unrelated.txt'), 'utf8'), 'keep');
});

test('D50 failed atomic writes retain the old graph, bytes and sibling directories and allow the same request retry', (t) => {
  const f = setupPracticeStorage(t);
  seedCurrentAndNeighbors(f);
  const before = treeBytes(f.local),
    old = f.store.load(f.fixture.directory);
  const originalWrite = f.store.write;
  f.store.write = () => {
    throw Error('synthetic disk failure');
  };
  const input = { requestId: 'failure', expectedRevision: 1, answer: 'new-answer' };
  assert.throws(() => f.write('answer', input), { code: 'STATE_WRITE_FAILED' });
  assert.equal(f.store.load(f.fixture.directory), old);
  assert.deepEqual(treeBytes(f.local), before);
  assert.ok(currentBytes(f).equals(jsonBytes(old)));
  f.store.write = originalWrite;
  assert.equal(f.write('answer', input).state.revision, 2);
});

for (const relative of ['practice', 'practice/ink', 'practice/ink/fingerprint']) {
  test(`D50 redirected ${relative} rejects reads and writes without touching the target`, (t) => {
    const f = setupPracticeStorage(t);
    const outside = path.join(f.fixture.root, 'outside');
    writeFixtureFile(path.join(outside, 'sentinel.json'), 'protected');
    const actual = relative.replace('fingerprint', f.snapshot.contentFingerprint);
    const linked = path.join(f.local, actual);
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const before = treeBytes(outside);
    assert.throws(() => f.store.ink.read(f.snapshot, '1'));
    assert.throws(() => f.write('ink', { requestId: 'i', expectedInkRevision: 0, ink: [] }));
    assert.throws(() => f.store.ink.clear(f.snapshot));
    if (relative === 'practice') {
      assert.throws(() => f.store.load(f.fixture.directory, { refresh: true }));
      assert.throws(() => f.write('answer', { requestId: 'a', expectedRevision: 0, answer: 'A' }));
    }
    assert.deepEqual(treeBytes(outside), before);
  });
}
