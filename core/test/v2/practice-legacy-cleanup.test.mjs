import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { clearLegacyPractice } from '../../server/v2/repositories/legacy-practice.repository.js';
import {
  setupPracticeStorage,
  seedLegacy,
  seedCurrentAndNeighbors,
  treeBytes,
} from '../fixtures/v2-practice-storage.mjs';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { StateRepository } from '../../server/v2/repositories/state.repository.js';
import { V2Server } from '../../server/v2/app.js';

test('D50 low-level state reads ignore the old location and never silently migrate or erase it', (t) => {
  const f = setupPracticeStorage(t);
  seedLegacy(f);
  const before = treeBytes(f.local);
  const records = new StateRepository();
  assert.deepEqual(records.load(f.fixture.directory), { formatVersion: 2, questions: {} });
  assert.deepEqual(treeBytes(f.local), before);
  assert.equal(fs.existsSync(path.join(f.local, 'practice')), false);
});

test('D50 recognized old state and ink are removed on open without migration or creation of new records', (t) => {
  const f = setupPracticeStorage(t);
  seedLegacy(f);
  const opened = f.library.open(f.id);
  assert.equal(opened.initial.question.answer, null);
  assert.equal(opened.initial.question.ink, null);
  assert.doesNotMatch(JSON.stringify(opened), /OLD_DEVELOPMENT_ANSWER/);
  assert.equal(fs.existsSync(f.legacyFile), false);
  assert.equal(fs.existsSync(path.join(f.local, 'ink')), false);
  assert.equal(fs.existsSync(path.join(f.local, 'practice')), false);
  assert.equal(fs.existsSync(f.local), true);
  assert.equal(f.library.open(f.id).initial.question.answer, null);
});

test('D50 old records alongside a new practice never override or delete the new records, exam, rounds or unknown siblings', (t) => {
  const f = setupPracticeStorage(t);
  seedCurrentAndNeighbors(f);
  const before = treeBytes(f.local);
  seedLegacy(f);
  const opened = f.library.open(f.id);
  assert.equal(opened.initial.question.answer, 'current-answer');
  assert.deepEqual(opened.initial.question.ink, ['current-ink']);
  assert.deepEqual(treeBytes(f.local), before);
  assert.equal(
    f.library.open(f.id, undefined, { refresh: true }).initial.question.answer,
    'current-answer',
  );
});

const uncertain = [
  ['malformed state', (f) => writeFixtureFile(f.legacyFile, '{bad')],
  ['duplicate key', (f) => writeFixtureFile(f.legacyFile, '{"formatVersion":2,"formatVersion":2}')],
  [
    'unknown state fields',
    (f) => writeFixtureFile(f.legacyFile, { formatVersion: 2, questions: {}, unknown: 'preserve' }),
  ],
  [
    'invalid metadata',
    (f) =>
      writeFixtureFile(f.legacyFile, { formatVersion: 2, questions: {}, contentFingerprint: [] }),
  ],
  [
    'unrecognized state format',
    (f) => writeFixtureFile(f.legacyFile, { formatVersion: 3, questions: {} }),
  ],
  ['malformed ink', (f) => writeFixtureFile(f.legacyInk, '{bad')],
  [
    'unknown ink fields',
    (f) => writeFixtureFile(f.legacyInk, { ink: [], inkRevision: 0, receipts: [], extra: 'keep' }),
  ],
  [
    'unknown directory',
    (f) => writeFixtureFile(path.join(f.local, 'ink/unrecognized/file'), 'keep'),
  ],
  [
    'unknown filename',
    (f) => writeFixtureFile(path.join(path.dirname(f.legacyInk), 'notes.txt'), 'keep'),
  ],
];
for (const [label, change] of uncertain) {
  test(`D50 ${label} preserves the whole old tree and all current data and reports a clear error`, (t) => {
    const f = setupPracticeStorage(t);
    seedCurrentAndNeighbors(f);
    seedLegacy(f);
    change(f);
    const before = treeBytes(f.local);
    assert.throws(
      () => f.library.open(f.id),
      (error) => {
        assert.equal(error.code, 'STATE_INVALID');
        assert.match(error.message, /旧开发练习记录.*已保留/);
        return true;
      },
    );
    assert.deepEqual(treeBytes(f.local), before);
  });
}

for (const target of ['state', 'ink', 'fingerprint', 'ink-file']) {
  test(`D50 redirected legacy ${target} is retained and no files inside or outside it are deleted`, (t) => {
    const f = setupPracticeStorage(t);
    seedCurrentAndNeighbors(f);
    seedLegacy(f);
    const outside = path.join(f.fixture.root, 'outside');
    writeFixtureFile(path.join(outside, 'state.json'), 'protected');
    const paths = {
      state: f.legacyFile,
      ink: path.join(f.local, 'ink'),
      fingerprint: path.dirname(f.legacyInk),
      'ink-file': f.legacyInk,
    };
    const linked = paths[target];
    assert.ok(linked.startsWith(f.local + path.sep));
    fs.rmSync(linked, { recursive: true });
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const before = treeBytes(f.local),
      protectedBytes = treeBytes(outside);
    assert.throws(() => f.library.open(f.id), { code: 'STATE_INVALID' });
    assert.deepEqual(treeBytes(f.local), before);
    assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
    assert.deepEqual(treeBytes(outside), protectedBytes);
  });
}

test('D50 old ink-only and old receipt-vector variants are recognized without creating a practice state', (t) => {
  const f = setupPracticeStorage(t);
  seedLegacy(f);
  fs.unlinkSync(f.legacyFile);
  writeFixtureFile(f.legacyInk, {
    ink: [],
    inkRevision: 1,
    receipts: { old: 'signature' },
    receiptOrder: ['old'],
  });
  clearLegacyPractice(f.fixture.directory);
  assert.equal(fs.existsSync(path.join(f.local, 'ink')), false);
  assert.equal(fs.existsSync(path.join(f.local, 'practice')), false);
});

test('D50 interrupted deletion leaves new data intact, reports partial cleanup and is recoverable on the next open', (t) => {
  const f = setupPracticeStorage(t);
  seedCurrentAndNeighbors(f);
  const current = treeBytes(f.local);
  seedLegacy(f);
  const unlink = fs.unlinkSync;
  try {
    fs.unlinkSync = (file) => {
      if (file === f.legacyFile) {
        throw Error('synthetic cleanup failure');
      }
      return unlink(file);
    };
    assert.throws(() => f.library.open(f.id), { code: 'STATE_WRITE_FAILED' });
    assert.equal(fs.existsSync(f.legacyFile), true);
    assert.equal(fs.existsSync(path.join(f.local, 'ink')), false);
    for (const relative of Object.keys(current)) {
      assert.equal(treeBytes(f.local)[relative], current[relative]);
    }
  } finally {
    fs.unlinkSync = unlink;
  }
  assert.equal(f.library.open(f.id).initial.question.answer, 'current-answer');
  assert.deepEqual(treeBytes(f.local), current);
});

test('D50 a legacy file changed during preflight is preserved without any deletion', (t) => {
  const f = setupPracticeStorage(t);
  seedLegacy(f);
  const original = fs.readFileSync;
  const oldBytes = original(f.legacyInk);
  const identity = fs.statSync(f.legacyFile, { bigint: true });
  let changed = false;
  try {
    fs.readFileSync = (file, ...args) => {
      const value = original(file, ...args);
      const opened = typeof file === 'number' ? fs.fstatSync(file, { bigint: true }) : null;
      if (opened?.ino === identity.ino && opened.dev === identity.dev) {
        fs.appendFileSync(f.legacyFile, ' ');
        changed = true;
      }
      return value;
    };
    assert.throws(() => clearLegacyPractice(f.fixture.directory), { code: 'STATE_INVALID' });
  } finally {
    fs.readFileSync = original;
  }
  assert.equal(changed, true);
  assert.ok(fs.readFileSync(f.legacyInk).equals(oldBytes));
  assert.equal(fs.existsSync(f.legacyFile), true);
});

test('D50 unsafe legacy cleanup is reported through the unchanged HTTP error shape without leaking stored answers', async (t) => {
  const f = setupPracticeStorage(t);
  seedLegacy(f);
  writeFixtureFile(f.legacyInk, '{bad');
  const before = treeBytes(f.local);
  const server = await new V2Server(f.fixture).start();
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.port()}/api/v2/banks/${f.id}/overview`);
  const value = await response.json();
  assert.equal(response.status, 503);
  assert.equal(value.error.code, 'STATE_INVALID');
  assert.match(value.error.message, /旧开发练习记录.*已保留/);
  assert.doesNotMatch(JSON.stringify(value), /OLD_DEVELOPMENT_ANSWER|old-ink/);
  assert.deepEqual(treeBytes(f.local), before);
});
