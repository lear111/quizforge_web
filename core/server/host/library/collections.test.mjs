import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJson } from '../platform/json.js';
import { Collection, prepareCollection, finishCollection, developmentFolders } from './collections.js';
import { readOutlineConfiguration, validateOutlineStates } from '../practice/outline.js';
import { SerialTransactions, LoadCoordinator } from '../platform/transactions.js';
import { RichTextService } from '../resources/richtext-service.js';
import { readExtension, snapshotPage } from '../extensions/extension-packages.js';
import { RuleEngine } from '../extensions/rule-engine.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));
test('mixed collections retain their state identity and question owners', () => {
  const a = { id: 'a', version: '1.0.0', fingerprint: 'a'.repeat(64), directory: 'a', outlineItemsDeclared: true, providerRevision: '' };
  const b = { ...a, id: 'b', fingerprint: 'b'.repeat(64) };
  const raw = { id: 'sample', title: 'Mixed', questions: [{ id: 'q1', title: 'One', extension: { id: 'a', version: '1.0.0' }, data: {}, outline: { level: 'parts', items: [{ id: 'p1', label: '1' }] } }, { id: 'q2', title: 'Two', extension: { id: 'b', version: '1.0.0' }, data: {} }] };
  const prepared = prepareCollection(raw, 'bank', null, 'sample', new Map([['a@1.0.0', a], ['b@1.0.0', b]]));
  const collection = new Collection(prepared);
  assert.equal(collection.stateKey(), 'bank:sample:mixed');
  assert.equal(collection.question('q1').extension, a); assert.equal(collection.question('q2').extension, b);
  assert.deepEqual(collection.question('q1').outlineItems, [{ id: 'p1', label: '1' }]);
  assert.throws(() => collection.question('missing'), { code: 'QUESTION_NOT_FOUND' });
  assert.deepEqual(developmentFolders({ extension: { development: 'a' }, questions: [{ extension: { development: 'b' } }] }), ['a', 'b']);
});
test('unsubmitted small questions expose draft states without exposing correctness', () => {
  validateOutlineStates([{ id: 'p1', status: 'draft' }], false);
  assert.throws(() => validateOutlineStates([{ id: 'p1', status: 'correct' }], false), { code: 'INVALID_OUTLINE_STATES' });
  assert.throws(() => validateOutlineStates([{ id: 'p1', status: 'draft' }], true), { code: 'INVALID_OUTLINE_STATES' });
  assert.throws(() => readOutlineConfiguration({ level: 'parts', items: [{ id: 'p1', label: '1' }] }, { outlineItemsDeclared: false }), { code: 'OUTLINE_CAPABILITY_REQUIRED' });
});
test('async state transactions serialize across awaits and allow nested helpers', async () => {
  const transactions = new SerialTransactions(), events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = transactions.run(async () => { events.push('first-read'); await gate; await transactions.run(async () => events.push('nested-write')); events.push('first-write'); });
  const second = transactions.run(async () => events.push('second-read'));
  await Promise.resolve(); assert.deepEqual(events, ['first-read']);
  release(); await Promise.all([first, second]);
  assert.deepEqual(events, ['first-read', 'nested-write', 'first-write', 'second-read']);
});
test('failed transactions do not poison the next write', async () => {
  const transactions = new SerialTransactions();
  await assert.rejects(transactions.run(() => { throw new Error('disk failure'); }), /disk failure/);
  assert.equal(await transactions.run(() => 42), 42);
});
test('load coordinator shares identical jobs; cancelled loads never publish', async () => {
  const coordinator = new LoadCoordinator(); let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const first = coordinator.submit('bank:1:source', true, async () => { calls++; await gate; return 'old'; });
  const second = coordinator.submit('bank:1:source', true, async () => 'duplicate');
  assert.equal(first, second);
  const failure = assert.rejects(first, { code: 'LIBRARY_CHANGED' });
  coordinator.invalidate(key => key.startsWith('bank:1:')); release();
  await failure; assert.equal(calls, 1); coordinator.close();
});
test('unchanged legacy packages load and validate through the native collection path', async t => {
  const directory = path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0');
  const service = new RichTextService(codeRoot);
  const extension = readExtension(directory, service, () => {});
  const raw = parseJson(fs.readFileSync(extension.examples));
  const prepared = prepareCollection(raw, 'extension', extension, extension.id, new Map([[extension.id + '@' + extension.version, extension]]));
  const engine = await RuleEngine.create(codeRoot); t.after(() => engine.close());
  const result = await finishCollection(engine, prepared);
  assert.equal(result.collection.stateKey(), 'extension:quizforge.single-choice:quizforge.single-choice:1.0.0');
  assert.ok(result.successfulCheck); assert.ok(result.collection.questions.length > 0);
  const page = snapshotPage(extension);
  assert.deepEqual(page.apiVersion, { major: 1, minor: 4 }); assert.ok(page.html.includes('<'));
});
