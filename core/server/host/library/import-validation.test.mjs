import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ImportValidationEngine, validateImportLibrary } from './import-validation.js';
import { Library } from './library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { within } from '../platform/files.js';

const extension = { id: 'fixture', version: '1', fingerprint: 'one', directory: 'extensions/one' };
test('import batches preserve original requests and split outlines by position despite repeated question IDs', async () => {
  const calls = [], adapter = new ImportValidationEngine({ async run(owner, request) {
    calls.push(request);
    return request.op === 'outlineBatch' ? { outlineItems: request.questions.map(data => [{ id: 'same-child', label: data.label }]) } : { valid: true };
  } });
  const requests = [
    adapter.run(extension, { op: 'validateBank', questions: [{ label: 'A' }, { label: 'B' }] }),
    adapter.run(extension, { op: 'validateBank', questions: [{ label: 'C' }] })
  ];
  await Promise.all(requests);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].contextResetOffsets, [2]);
  const results = await Promise.all(['A', 'B'].map(label => adapter.run(extension, { op: 'outlineBatch', questions: [{ id: 'repeated', label }] })));
  assert.deepEqual(results.map(row => row.outlineItems[0][0].label), ['A', 'B']);
  assert.deepEqual(calls[1].contextResetOffsets, [1]); await adapter.drain();
});

test('a failed merged import falls back to original jobs and drains valid work before reporting errors', async () => {
  const calls = [], failure = new Error('invalid question');
  const adapter = new ImportValidationEngine({ async run(owner, request) {
    calls.push(request); if (request.questions.includes('bad')) throw failure; return { valid: true };
  } });
  const results = await Promise.allSettled(['good', 'bad', 'other'].map(value => adapter.run(extension, { op: 'validateBank', questions: [value] })));
  await adapter.drain();
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[1].reason, failure); assert.equal(calls.length, 4);
  assert.equal(adapter.active, 0); assert.equal(adapter.queue.length, 0);
});

test('import batching keeps physical entities separate and caps process concurrency at two', async () => {
  let active = 0, peak = 0, release;
  const gate = new Promise(resolve => { release = resolve; }), calls = [];
  const adapter = new ImportValidationEngine({ async run(owner, request) {
    active++; peak = Math.max(peak, active); calls.push(owner.directory);
    if (active === 2) release(); await gate; active--; return { valid: true };
  } });
  await Promise.all(['one', 'two', 'three'].map(name => adapter.run({ ...extension, directory: name }, { op: 'validateBank', questions: [{}] })));
  await adapter.drain(); assert.equal(peak, 2); assert.equal(active, 0); assert.equal(calls.length, 3);
});

test('large original chunks are not split or merged beyond existing input and outline bounds', async () => {
  const calls = [], adapter = new ImportValidationEngine({ async run(owner, request) {
    calls.push(request); return request.op === 'outlineBatch' ? { outlineItems: request.questions.map(() => []) } : { valid: true };
  } });
  await Promise.all([Array(400).fill({}), Array(200).fill({})].map(questions => adapter.run(extension, { op: 'validateBank', questions })));
  assert.deepEqual(calls.map(row => row.questions.length), [400, 200]); calls.length = 0;
  await Promise.all([Array(20).fill({}), Array(10).fill({})].map(questions => adapter.run(extension, { op: 'outlineBatch', questions })));
  assert.deepEqual(calls.map(row => row.questions.length), [20, 10]); calls.length = 0;
  await Promise.all([1, 2].map(() => adapter.run(extension, { op: 'validateBank', questions: [{ text: 'a'.repeat(300 * 1024) }] })));
  assert.equal(calls.length, 2); await adapter.drain();
});

test('combined timeout or malformed outline output still permits independently valid original jobs', async () => {
  for (const mode of ['timeout', 'malformed']) {
    const adapter = new ImportValidationEngine({ async run(owner, request) {
      if (request.contextResetOffsets) {
        if (mode === 'timeout') throw Object.assign(new Error('combined deadline'), { code: 'RULE_TIMEOUT' });
        return { outlineItems: [] };
      }
      return { outlineItems: request.questions.map(row => [{ id: 'child', label: row.label }]) };
    } });
    const result = await Promise.all(['one', 'two'].map(label => adapter.run(extension, { op: 'outlineBatch', questions: [{ label }] })));
    assert.deepEqual(result.map(row => row.outlineItems[0][0].label), ['one', 'two']); await adapter.drain();
  }
});

const code = fileURLToPath(new URL('../../../', import.meta.url));
async function fixture(t) {
  const temporary = path.join(path.dirname(code), '.temp', 'import-validation-tests'); fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'test-'));
  fs.mkdirSync(path.join(root, 'question-banks'));
  const directory = path.join(root, 'extensions', 'Test', 'choice');
  copyFixture(path.join(code, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), directory, { recursive: true });
  const example = JSON.parse(fs.readFileSync(path.join(directory, 'examples.json')));
  for (let index = 0; index < 4; index++) writeFixture(path.join(root, 'question-banks', 'bank-' + index, 'bank.json'), JSON.stringify({ ...example, id: 'bank-' + index }));
  const engine = await RuleEngine.create(code); engine.validationEnvironment = async () => 'fixture';
  const library = new Library(root, code, engine);
  t.after(() => { library.close(); engine.close(); assert.ok(within(temporary, root)); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, library, engine };
}

test('isolated import still rejects schema errors in a later bank and invalid image assets', async t => {
  const { root, library, engine } = await fixture(t), run = engine.run.bind(engine), calls = [];
  engine.run = async (...args) => { calls.push(args[1]); return run(...args); };
  await validateImportLibrary(library); assert.ok(calls.length < 5);
  const file = path.join(root, 'question-banks', 'bank-3', 'bank.json'), raw = JSON.parse(fs.readFileSync(file));
  raw.questions[0].data.options = 'invalid'; writeFixture(file, JSON.stringify(raw));
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
  assert.equal(library.loaded.size, 0);
  writeFixture(file, fs.readFileSync(path.join(root, 'question-banks', 'bank-0', 'bank.json')).toString().replace('"bank-0"', '"bank-3"'));
  const directory = path.join(root, 'question-banks', 'bad-resources'); fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  const valid = JSON.parse(fs.readFileSync(file)); valid.id = 'bad-resources';
  writeFixture(path.join(directory, 'bank.json'), JSON.stringify(valid)); writeFixture(path.join(directory, 'assets', 'broken.png'), 'invalid image bytes');
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
});

test('import rejects content and runtime changes detected at the final validation boundary', async t => {
  const { root, library, engine } = await fixture(t), run = engine.run.bind(engine);
  let changed = false;
  engine.run = async (...args) => {
    const result = await run(...args);
    if (!changed) { changed = true; fs.appendFileSync(path.join(root, 'extensions/Test/choice/practice.css'), '\n/* changed during validation */'); }
    return result;
  };
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
  engine.run = run; let environment = 0; engine.validationEnvironment = async () => 'environment-' + environment++;
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
});

test('import reuses indexed bank bytes while still rejecting subsequent on-disk edits', async t => {
  const { root, library } = await fixture(t);
  const file = path.join(root, 'question-banks', 'bank-3', 'bank.json');
  library.indexSnapshot();
  const originalOpen = fs.openSync;
  let reads = 0;
  const open = t.mock.method(fs, 'openSync', function (target, ...args) {
    if (target === file) reads++;
    return originalOpen.call(this, target, ...args);
  });
  await validateImportLibrary(library);
  assert.equal(reads, 0, 'identity checks reuse the JSON already read by the index');
  open.mock.restore();
  const raw = JSON.parse(fs.readFileSync(file));
  raw.questions[0].data.options = 'invalid after indexing';
  writeFixture(file, JSON.stringify(raw));
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
  assert.equal(library.loaded.size, 0);
});

test('real import outlines preserve original per-bank globals and reject a later invalid outline', async t => {
  const { root, library } = await fixture(t), directory = path.join(root, 'extensions', 'Test', 'choice');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  manifest.requiresApi = { major: 1, minMinor: 3, capabilities: ['outline-items'] };
  writeFixture(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  writeFixture(path.join(directory, 'rules.js'), `let count=0;QF.defineType({project(){return {};},grade(){return {};},getOutlineItems(data){return [{id:'child',label:data.stem==='reject-outline'?'<unsafe>':String(++count)}];}});`);
  const loaded = [], load = library.loadScope.bind(library);
  library.loadScope = async (...args) => { const result = await load(...args); loaded.push(result.collection); return result; };
  await validateImportLibrary(library);
  assert.equal(loaded.length, 5);
  for (const collection of loaded) assert.deepEqual(collection.questions.map(question => question.outlineItems[0].label), ['1', '2', '3']);
  const file = path.join(root, 'question-banks', 'bank-3', 'bank.json'), raw = JSON.parse(fs.readFileSync(file));
  raw.questions[0].data.stem = 'reject-outline'; writeFixture(file, JSON.stringify(raw));
  await assert.rejects(validateImportLibrary(library), { code: 'INVALID_LIBRARY_ARCHIVE' });
});
