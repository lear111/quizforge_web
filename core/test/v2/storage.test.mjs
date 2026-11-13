import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { LibrarySnapshots, OPEN_BANK_LIMIT } from '../../server/host/v2/snapshots.js';
import { PracticeState } from '../../server/host/v2/state.js';
import { fingerprint, hash, jsonBytes, parseJson } from '../../server/host/platform/json.js';
import { createReadFixture, writeFixtureFile } from '../fixtures/v2-banks.mjs';

function setup(t) {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const store = new PracticeState(), library = new LibrarySnapshots(fixture.root, fixture.codeRoot, { stateStore: store });
  const id = library.locations()[0].bankId, opened = library.open(id), snapshot = library.opened.get(id);
  const write = (qid, op, fields) => library.write(id, qid, op, { snapshotId: opened.snapshotId, ...fields });
  return { fixture, store, library, id, opened, snapshot, write };
}

test('D33 choice saves never read or serialize any ink; an ink save writes only its question file and has independent conflicts', t => {
  const { store, snapshot, fixture, write, library, id } = setup(t);
  for (const qid of ['1', '3']) write(qid, 'ink', { requestId: 'ink-' + qid, expectedInkRevision: 0, ink: { points: Array(1000).fill([1, 2]) } });
  const other = store.ink.file(snapshot, '3'), otherBytes = fs.readFileSync(other);
  const reader = store.ink.read, inkWriter = store.ink.write;
  store.ink.read = () => { throw Error('A choice save must not read any ink'); };
  store.ink.write = () => { throw Error('A choice save must not write ink'); };
  const saved = write('1', 'draft', { requestId: 'answer', expectedRevision: 0, answer: 'A' });
  assert.equal(saved.state.revision, 1); assert.equal(Object.hasOwn(saved, 'ink'), false);
  const stateFile = store.file(fixture.directory), stateBytes = fs.readFileSync(stateFile);
  assert.doesNotMatch(stateBytes.toString(), /"ink"|"points"/);
  store.ink.read = reader; store.ink.write = inkWriter;
  store.write = () => { throw Error('An ink save must not write state.json'); };
  const savedInk = write('1', 'ink', { requestId: 'ink-again', expectedInkRevision: 1, ink: [3] });
  assert.equal(savedInk.inkRevision, 2); assert.equal(savedInk.state.revision, 1);
  assert.ok(fs.readFileSync(stateFile).equals(stateBytes)); assert.ok(fs.readFileSync(other).equals(otherBytes));
  assert.throws(() => write('1', 'ink', { requestId: 'old', expectedInkRevision: 1, ink: [] }), { code: 'REVISION_CONFLICT' });
  store.ink.read = () => { throw Error('Overview indicators must use the directory index, not ink contents'); };
  const overview = library.open(id, undefined, { includeInitial: false });
  assert.equal(overview.states.find(s => s.questionId === '1').hasInk, true);
});

test('D33 hashed question filenames, independent four-receipt vector, restart and failed atomic save preserve bytes', t => {
  const { fixture, library, store, id } = setup(t);
  const qid = 'Windows:*?题号'; fixture.bank.questions[qid] = fixture.bank.questions['1']; fixture.bank.outline[0].items.push({ id: qid, label: qid, maxScore: 2 }); writeFixtureFile(fixture.bankFile, fixture.bank);
  const opened = library.open(id), snapshot = library.opened.get(id);
  const input = parseJson(`{"snapshotId":"${opened.snapshotId}","requestId":"ink","expectedInkRevision":0,"ink":{"x":1.0}}`);
  const result = library.write(id, qid, 'ink', input); assert.equal(result.inkRevision, 1);
  const file = store.ink.file(snapshot, qid); assert.equal(path.basename(file), hash(Buffer.from(qid)) + '.json');
  const signature = fingerprint({ op: 'ink', input }, 'quizforge-v2-receipt');
  const expected = parseJson(`{"ink":{"x":1.0},"inkRevision":1,"receipts":{"ink":"${signature}"},"receiptOrder":["ink"]}`);
  const bytes = fs.readFileSync(file); assert.ok(bytes.equals(jsonBytes(expected)));
  assert.equal(fs.existsSync(store.file(fixture.directory)), false);
  library.write(id, qid, 'ink', input); assert.ok(fs.readFileSync(file).equals(bytes));
  const writer = store.ink.write; store.ink.write = () => { throw Error('disk'); };
  const next = { snapshotId: opened.snapshotId, requestId: 'next', expectedInkRevision: 1, ink: [2] };
  assert.throws(() => library.write(id, qid, 'ink', next), { code: 'STATE_WRITE_FAILED' }); assert.ok(fs.readFileSync(file).equals(bytes));
  store.ink.write = writer; assert.equal(library.write(id, qid, 'ink', next).inkRevision, 2);
  const fresh = new LibrarySnapshots(fixture.root, fixture.codeRoot, { stateStore: new PracticeState() });
  const restored = fresh.open(id, qid).initial.question; assert.deepEqual(restored.ink, [2]); assert.equal(restored.inkRevision, 2);
});

test('D27 exact bank bytes or any used extension file clear all active questions and ink, preserving only history indexes', t => {
  const { fixture, library, store, id } = setup(t);
  for (const mutation of [() => fs.appendFileSync(fixture.bankFile, ' '), () => fs.appendFileSync(path.join(fixture.extension, 'practice.css'), ' ')]) {
    let overview = library.open(id), snapshot = library.opened.get(id);
    for (const qid of ['1', '3']) {
      library.write(id, qid, 'draft', { snapshotId: overview.snapshotId, requestId: 'draft-' + qid, expectedRevision: 0, answer: qid });
      library.write(id, qid, 'ink', { snapshotId: overview.snapshotId, requestId: 'ink-' + qid, expectedInkRevision: 0, ink: [qid] });
    }
    store.commit(fixture.directory, { ...store.load(fixture.directory), historyIndex: [{ id: 'frozen' }] });
    mutation(); overview = library.open(id);
    assert.equal(overview.activeCleared, true); assert.equal(overview.notice, '题库或题型已变化，本轮作答已清空');
    assert.deepEqual(store.load(fixture.directory).questions, {}); assert.deepEqual(store.load(fixture.directory).historyIndex, [{ id: 'frozen' }]);
    assert.equal(fs.existsSync(path.join(fixture.directory, '.qf-v2/ink')), false);
    assert.equal(overview.states.some(s => s.hasInk || s.hasSavedAnswer), false);
    assert.throws(() => library.write(id, '1', 'draft', { snapshotId: snapshot.snapshotId, requestId: 'stale', expectedRevision: 0, answer: 'old' }), { code: 'SNAPSHOT_STALE' });
  }
});

test('D27 image/unrelated file and physical folder names never clear answers; changes without answers create no state', t => {
  const { fixture, library, store, id, opened } = setup(t);
  fs.appendFileSync(fixture.bankFile, ' '); library.open(id);
  assert.equal(fs.existsSync(path.join(fixture.directory, '.qf-v2')), false);
  let overview = library.open(id);
  library.write(id, '1', 'draft', { snapshotId: overview.snapshotId, requestId: 'a', expectedRevision: 0, answer: 'A' });
  const before = fs.readFileSync(store.file(fixture.directory));
  fs.appendFileSync(path.join(fixture.directory, 'assets/figure.png'), 'changed');
  writeFixtureFile(path.join(fixture.directory, 'unrelated.txt'), 'other'); overview = library.open(id);
  assert.notEqual(overview.snapshotId, opened.snapshotId); assert.equal(overview.activeCleared, false); assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(before));
  const renamed = path.join(path.dirname(fixture.directory), 'renamed'); fs.renameSync(fixture.directory, renamed);
  fs.renameSync(fixture.extension, path.join(path.dirname(fixture.extension), 'renamed'));
  const nextId = library.locations()[0].bankId, moved = library.open(nextId);
  assert.equal(moved.activeCleared, false); assert.equal(moved.initial.question.answer, 'A'); assert.ok(fs.readFileSync(store.file(renamed)).equals(before));
});

test('retry removes its ink before state commit; failure retains answer and makes the ordered partial cleanup explicit', t => {
  const { store, snapshot, fixture, write } = setup(t);
  write('1', 'draft', { requestId: 'a', expectedRevision: 0, answer: 'A' });
  write('1', 'ink', { requestId: 'i', expectedInkRevision: 0, ink: [1] });
  const bytes = fs.readFileSync(store.file(fixture.directory)), writer = store.write;
  store.write = () => { assert.equal(fs.existsSync(store.ink.file(snapshot, '1')), false); throw Error('disk failure'); };
  const request = { requestId: 'retry', expectedRevision: 1 };
  assert.throws(() => write('1', 'retry', request), { code: 'STATE_WRITE_FAILED' }); assert.ok(fs.readFileSync(store.file(fixture.directory)).equals(bytes)); assert.equal(store.get(snapshot, '1').answer, 'A');
  store.write = writer; const saved = write('1', 'retry', request); assert.equal(saved.answer, null); assert.equal(saved.inkRevision, 0);
});

test('ink-only progress is cleared on content change without ever creating state.json', t => {
  const { fixture, library, store, id, snapshot, write } = setup(t);
  write('1', 'ink', { requestId:'ink', expectedInkRevision:0, ink:[1] });
  assert.equal(fs.existsSync(store.file(fixture.directory)), false);
  fs.appendFileSync(fixture.bankFile, ' ');
  const changed = library.open(id);
  assert.equal(changed.activeCleared, true); assert.equal(changed.initial.question.ink, null);
  assert.equal(fs.existsSync(store.file(fixture.directory)), false);
  assert.equal(fs.existsSync(store.ink.directory(snapshot)), false);
});

test('ink reading, saving and recursive clearing reject redirected private directories without touching the target', t => {
  const { fixture, store, snapshot, write } = setup(t);
  const outside = path.join(fixture.root, 'outside'), protectedFile = path.join(outside, 'keep.json');
  writeFixtureFile(protectedFile, 'protected synthetic content');
  const local = path.join(fixture.directory, '.qf-v2'); fs.mkdirSync(local);
  fs.symlinkSync(outside, path.join(local, 'ink'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.ink.read(snapshot, '1'));
  assert.throws(() => write('1', 'ink', { requestId:'i', expectedInkRevision:0, ink:[1] }));
  assert.throws(() => store.ink.clear(snapshot));
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'protected synthetic content');
  assert.deepEqual(fs.readdirSync(outside), ['keep.json']);
  assert.equal(fs.existsSync(store.file(fixture.directory)), false);
});

test('atomic state writes retain private-directory redirect checks and never recreate a removed bank', t => {
  const { fixture, store, snapshot, write } = setup(t);
  const outside = path.join(fixture.root, 'outside'), protectedFile = path.join(outside, 'state.json');
  writeFixtureFile(protectedFile, 'protected synthetic content');
  const local = path.join(fixture.directory, '.qf-v2');
  fs.symlinkSync(outside, local, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => write('1', 'draft', { requestId:'redirect', expectedRevision:0, answer:'A' }), { code:'STATE_WRITE_FAILED' });
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'protected synthetic content');
  const old = store.load(fixture.directory);
  fs.renameSync(fixture.directory, fixture.directory + '-moved');
  assert.throws(() => write('1', 'draft', { requestId:'missing', expectedRevision:0, answer:'A' }));
  assert.equal(fs.existsSync(snapshot.directory), false); assert.equal(store.load(snapshot.directory), old);
});

test('D29 LRU retains eight banks and their state/index caches; evicted snapshots reopen transparently or clear on content change', t => {
  const { fixture, library, store, id, opened, write } = setup(t);
  write('1', 'draft', { requestId: 'a', expectedRevision: 0, answer: 'A' });
  const ids = [id];
  for (let i = 1; i <= 8; i++) { const directory = path.join(path.dirname(fixture.directory), 'bank-' + i); fs.cpSync(fixture.directory, directory, { recursive: true }); ids.push(library.locations().find(row => row.directory === directory).bankId); }
  for (const next of ids.slice(1)) library.open(next);
  assert.equal(OPEN_BANK_LIMIT, 8); assert.equal(library.opened.size, 8); assert.equal(library.opened.has(id), false);
  assert.equal(store.loaded.has(store.file(fixture.directory)), false); assert.ok(store.identities.size <= 8); assert.ok(store.ink.indexes.size <= 8);
  assert.equal(library.question(id, '1', opened.snapshotId).answer, 'A');
  library.write(id, '1', 'draft', { snapshotId: opened.snapshotId, requestId: 'b', expectedRevision: 1, answer: 'B' });
  for (const next of ids.slice(1)) library.open(next);
  assert.equal(library.opened.has(id), false);
  fs.appendFileSync(fixture.bankFile, ' ');
  assert.throws(() => library.question(id, '1', opened.snapshotId), { code: 'SNAPSHOT_STALE' });
  assert.deepEqual(store.load(fixture.directory).questions, {});
  assert.equal(library.opened.size, 8); assert.ok(store.loaded.size <= 8); assert.ok(store.ink.indexes.size <= 8);
});
