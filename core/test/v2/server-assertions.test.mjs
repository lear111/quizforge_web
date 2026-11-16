import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { optionalProperty } from '../../server/v2/utils/properties.js';
import { LibrarySnapshots, createPracticeLibrary } from '../../server/v2/services/bank.service.js';
import { PracticeState } from '../../server/v2/services/practice.service.js';
import { StateRepository } from '../../server/v2/repositories/state.repository.js';
import { parseJson, jsonBytes, decimalSum } from '../../server/host/platform/json.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';
import { findAssertions, countAssertions } from '../../scripts/dev/count-v2-type-assertions.mjs';

test('cast accounting includes the checked property boundary, excluding ordinary declarations', () => {
  const casts = findAssertions(`/** @typedef {{value:unknown}} Shape */
    /** @type {unknown} */ const source = {};
    const a = /** @type {Shape} */ (source);
    const b = /** @satisfies {Shape} */ ({value: source});
    /** @param {unknown} value @returns {value is Shape} */ function guard(value) { return false; }
    const nested = /** @type {Shape} */ (/** @type {object} */ (source));`);
  assert.equal(casts.length, 3);
  const report = countAssertions();
  assert.ok(report.rows.some((row) => row.file === 'server/v2/utils/properties.js'));
  assert.ok(report.modules >= 19);
  assert.ok(report.total < 30);
});

test('optional unknown properties preserve boxing, getters, key coercion and thrown values', () => {
  const direct = (value, key) => value?.[key];
  const symbol = Symbol('synthetic');
  for (const value of [null, undefined, false, 0, 'abc', [1, 2], { x: 3, [symbol]: 4 }]) {
    for (const key of ['x', 'length', 0, symbol, null, { toString: () => 'x' }]) {
      assert.equal(optionalProperty(value, key), direct(value, key));
    }
  }
  const events = [],
    thrown = Error('synthetic getter');
  const value = new Proxy(
    {},
    {
      get(_target, key) {
        events.push(key);
        throw thrown;
      },
    },
  );
  assert.throws(
    () => optionalProperty(value, 'snapshotId'),
    (error) => error === thrown,
  );
  assert.deepEqual(events, ['snapshotId']);
  const badKey = {
    [Symbol.toPrimitive]() {
      throw thrown;
    },
  };
  assert.equal(optionalProperty(null, badKey), undefined);
  assert.throws(
    () => optionalProperty({}, badKey),
    (error) => error === thrown,
  );
});

test('read-only and injected libraries preserve construction and their actual storage behavior', (t) => {
  const f = createReadFixture();
  t.after(() => f.cleanup());
  const readonly = new LibrarySnapshots(f.root, f.codeRoot);
  const id = readonly.locations()[0].bankId;
  const opened = readonly.open(id);
  assert.equal(readonly.stateStore, null);
  assert.deepEqual(opened.pendingGrading, []);
  assert.ok(opened.states.every((state) => state.revision === 0 && !state.locked));
  assert.throws(() => readonly.finish(id, { snapshotId: opened.snapshotId }), TypeError);
  assert.equal(
    fs.existsSync(readonly.opened.get(id).directory + '/.qf-v2/practice/state.json'),
    false,
  );
  const stateStore = new PracticeState();
  const injected = createPracticeLibrary(f.root, f.codeRoot, { stateStore });
  const oldConstruction = new LibrarySnapshots(f.root, f.codeRoot, { stateStore });
  assert.ok(injected instanceof LibrarySnapshots);
  assert.equal(injected.stateStore, stateStore);
  assert.deepEqual(Object.keys(injected), Object.keys(oldConstruction));
  const snapshot = injected.open(id);
  const saved = injected.write(id, '1', 'answer', {
    snapshotId: snapshot.snapshotId,
    requestId: 'typed-write',
    expectedRevision: 0,
    answer: { value: 1 },
  });
  assert.deepEqual(saved.answer, { value: 1 });
  assert.equal(saved.state.revision, 1);
  const input = parseJson(
    '{"snapshotId":' +
      JSON.stringify(snapshot.snapshotId) +
      ',"requestId":"numeric-answer","expectedRevision":1,"answer":1.0,"answered":true}',
  );
  injected.write(id, '1', 'answer', input);
  const file = stateStore.file(injected.opened.get(id).directory);
  const bytes = fs.readFileSync(file);
  assert.match(bytes.toString(), /"answer":1\.0/);
  assert.equal(injected.write(id, '1', 'answer', input).state.revision, 2);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('state cache misses read normally while warm and identity-matched reads preserve references', (t) => {
  const f = createReadFixture();
  t.after(() => f.cleanup());
  const library = new LibrarySnapshots(f.root, f.codeRoot);
  const actual = library.locations()[0].directory;
  const records = new StateRepository();
  assert.equal(records.loaded.get(records.file(actual)), undefined);
  const value = records.load(actual);
  assert.equal(records.load(actual), value);
  assert.equal(records.load(actual, { refresh: true }), value);
  records.evict(actual);
  assert.deepEqual(records.load(actual), value);
});

test('numeric declaration accepts untrusted totals only because the implementation validates them', () => {
  assert.equal(decimalSum([0.1, 0.2]), 0.3);
  for (const value of [null, undefined, '2', Infinity, NaN, 1n, {}]) {
    assert.throws(() => decimalSum([value]), TypeError);
  }
  const file = parseJson('{"answer":1.0,"status":"answered"}');
  assert.equal(jsonBytes(file).toString(), '{"answer":1.0,"status":"answered"}');
});
