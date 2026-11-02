import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJson, stringifyJson, cloneJson, fingerprint, jsonBytes, hash } from './json.js';
import { safeFile, safeDirectory, replaceFile, within } from './files.js';
import { BankFeatures } from '../library/features.js';
import { ResourceStore } from '../resources/resources.js';
import { scanBanks, scanExtensions } from '../library/directories.js';
import { EditJournal } from '../editor/edit-journal.js';
import { requireBankFormat, requireManifestApi, normalizeHistoryApi } from '../extensions/extension-api.js';
import { RuleEngine, ruleEnvironment } from '../extensions/rule-engine.js';
import { FileCache } from './file-cache.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));
const productRoot = path.dirname(codeRoot), temporaryRoot = path.join(productRoot, '.temp', 'node-migration');
function fixture(t) {
  safeDirectory(temporaryRoot, true);
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'foundation-'));
  t.after(() => { assert.ok(within(temporaryRoot, root) && root !== temporaryRoot); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('JSON rejects duplicate names, trailing tokens and invalid UTF-8', () => {
  for (const invalid of ['{"x":1,"x":2}', '{"x":1,"nested":{"y":1,"y":2}}', '{} true', '[1,]', '{"x":01}', '{"x":NaN}', '{"x":"\u0000"}']) assert.throws(() => parseJson(invalid));
  assert.throws(() => parseJson(Buffer.from([0xff])));
  assert.throws(() => parseJson('[[[]]]', { maxDepth: 2 }));
  assert.throws(() => parseJson('"long"', { maxStringLength: 3 }));
  assert.throws(() => parseJson('1234', { maxNumberLength: 3 }));
});
test('JSON maintains numeric node kinds and large integer bytes through copying', () => {
  const value = parseJson('{"z":1.0,"a":9223372036854775807,"small":0.0000001,"zero":-0.0,"negative":-0}');
  assert.equal(typeof value.z, 'number');
  assert.equal(stringifyJson(cloneJson(value)), '{"z":1.0,"a":9223372036854775807,"small":1.0E-7,"zero":-0.0,"negative":0}');
  assert.equal(stringifyJson(value, { canonical: true }), '{"a":9223372036854775807,"negative":0,"small":1.0E-7,"z":1.0,"zero":-0.0}');
  value.z = 2;
  assert.equal(stringifyJson(value).startsWith('{"z":2,'), true);
  assert.notEqual(fingerprint(parseJson('{"n":1}'), 'x'), fingerprint(parseJson('{"n":1.0}'), 'x'));
});
test('JSON property names cannot mutate object prototypes', () => {
  const value = parseJson('{"__proto__":{"injected":true},"constructor":1}');
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  assert.equal({}.injected, undefined);
  assert.equal(Object.hasOwn(value, '__proto__'), true);
});
test('paths reject escaping assets and linked directories', t => {
  const root = fixture(t), inside = path.join(root, 'inside');
  fs.mkdirSync(inside); fs.writeFileSync(path.join(inside, 'file.txt'), 'ok');
  for (const relative of ['../outside.txt', '/absolute', 'C:/outside', 'sub\\file', 'bad\0name']) assert.throws(() => safeFile(inside, relative));
  const target = path.join(root, 'linked');
  fs.symlinkSync(inside, target, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safeFile(target, 'file.txt'));
});
test('replacement writes exact bytes and leaves no temporary file', t => {
  const root = fixture(t), file = path.join(root, 'saved.json');
  replaceFile(file, Buffer.from('first')); replaceFile(file, Buffer.from('second'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  assert.deepEqual(fs.readdirSync(root), ['saved.json']);
});

test('immutable file cache detects edits even when length and modification time are restored', t => {
  const root = fixture(t), file = path.join(root, 'input.json'), cache = new FileCache({ count: 1, bytes: 100 });
  fs.writeFileSync(file, '{"value":1.0}'); const timestamp = fs.statSync(file).mtime;
  const first = cache.json(file), digest = cache.jsonFingerprint(file, 'fixture');
  assert.equal(cache.json(file), first); assert.throws(() => { first.value = 3; }, TypeError);
  fs.writeFileSync(file, '{"value":2.0}'); fs.utimesSync(file, timestamp, timestamp);
  assert.equal(cache.json(file).value, 2); assert.notEqual(cache.jsonFingerprint(file, 'fixture'), digest);
  assert.throws(() => cache.json(file, 1), /size limit/);
  const second = path.join(root, 'second.json'); fs.writeFileSync(second, '{}'); cache.json(second);
  assert.equal(cache.entries.size, 1); assert.ok(cache.bytes <= 100);
  fs.unlinkSync(second); assert.throws(() => cache.json(second));
});
test('bank features remain opt-out and reject invented fields', () => {
  assert.deepEqual(BankFeatures.read({}).json(), { editing: true, whiteboard: true, history: true, exam: true });
  const features = BankFeatures.read({ features: { exam: false, history: false } });
  assert.equal(features.exam, false); assert.equal(features.editing, true);
  assert.throws(() => features.requireHistory(), { code: 'HISTORY_DISABLED' });
  assert.throws(() => BankFeatures.read({ features: { titleEditable: true } }), { code: 'INVALID_REQUEST' });
  assert.throws(() => BankFeatures.read({ features: { exam: 'false' } }), { code: 'INVALID_REQUEST' });
});
test('old API and bank declarations work; incompatible declarations stay explicit', () => {
  requireBankFormat({}); requireBankFormat({ formatVersion: 1 }); requireManifestApi({});
  requireManifestApi({ requiresApi: { major: 1, minMinor: 1, capabilities: ['outline-items'] } });
  requireBankFormat({formatVersion:2});
  assert.throws(() => requireBankFormat({ formatVersion: 3 }), { code: 'UNSUPPORTED_BANK_FORMAT' });
  assert.throws(() => requireManifestApi({ requiresApi: { major: 1, minMinor: 0, capabilities: ['outline-items'] } }), { code: 'INVALID_API_REQUIREMENT' });
  const history = { questions: [{ page: {} }] }; normalizeHistoryApi(history);
  assert.deepEqual(history.apiVersion, { major: 1, minor: 0 });
  assert.deepEqual(history.questions[0].page.apiVersion, { major: 1, minor: 0 });
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=', 'base64');
test('image content addresses survive reopen; tampered bytes are rejected', t => {
  const root = fixture(t), resources = new ResourceStore(root);
  const uploaded = resources.upload({ mime: 'image/png', data: png.toString('base64') });
  assert.equal(uploaded.id, hash(png));
  assert.equal(new ResourceStore(root).read(uploaded.id).bytes.equals(png), true);
  assert.throws(() => resources.upload({ mime: 'image/jpeg', data: png.toString('base64') }), { code: 'IMAGE_TYPE_MISMATCH' });
  assert.throws(() => resources.upload({ mime: 'image/png', data: '!bad!' }), { code: 'INVALID_REQUEST' });
  fs.writeFileSync(path.join(root, '.state', 'resources', uploaded.id + '.png'), 'changed');
  assert.throws(() => resources.read(uploaded.id), { code: 'RESOURCE_UNAVAILABLE' });
});
test('temporary resources do not persist uploads and can fall back to durable resources', t => {
  const root = fixture(t), durable = new ResourceStore(root), temporary = new ResourceStore(root, { memory: true, fallback: durable });
  const uploaded = temporary.upload({ mime: 'image/png', data: png.toString('base64') });
  assert.equal(temporary.memoryBytes(), png.length); assert.equal(fs.existsSync(path.join(root, '.state')), false);
  durable.store('image/png', png); temporary.clearMemory();
  assert.equal(temporary.read(uploaded.id).bytes.equals(png), true);
});
test('one-level grouping distinguishes bank folders from groups', t => {
  const root = fixture(t), base = path.join(root, 'question-banks');
  fs.mkdirSync(path.join(base, 'group', 'bank'), { recursive: true });
  fs.writeFileSync(path.join(base, 'group', 'bank', 'bank.json'), '{}');
  assert.equal(scanBanks(base).banks.length, 1); assert.equal(scanBanks(base).groups.length, 1);
  fs.mkdirSync(path.join(base, 'group', 'nested-group'));
  assert.throws(() => scanBanks(base), { code: 'INVALID_BANK_DIRECTORIES' });
  const extensions = path.join(root, 'extensions');
  fs.mkdirSync(path.join(extensions, 'types', 'choice'), { recursive: true });
  fs.writeFileSync(path.join(extensions, 'types', 'choice', 'manifest.json'), '{}');
  assert.equal(scanExtensions(extensions).length, 1);
});
test('source journal recovery completes the original edit and refuses unrelated changes', t => {
  const root = fixture(t), source = path.join(root, 'question-banks', 'sample.json');
  safeDirectory(path.dirname(source), true); safeDirectory(path.join(root, '.state'), true);
  const before = jsonBytes({ id: 'sample', questions: [{ id: 'q1' }] }), after = jsonBytes({ id: 'sample', questions: [{ id: 'q2' }] });
  replaceFile(source, before);
  const journal = new EditJournal(root), stored = { schemaVersion: 2, bank: 'question-banks/sample.json', bankBefore: [before.toString('base64')], bankAfter: [after.toString('base64')], bankBeforeDigest: hash(before), bankAfterDigest: hash(after) };
  replaceFile(journal.journal, jsonBytes(stored)); replaceFile(source, Buffer.from('{"id":"external","questions":[]}'));
  assert.throws(() => journal.recover(), /unrelated changes/); assert.equal(fs.existsSync(journal.journal), true);
  replaceFile(source, before); assert.equal(journal.recover(), true);
  assert.equal(fs.readFileSync(source).equals(after), true); assert.equal(fs.existsSync(journal.journal), false);
});
test('bank/state journal commits both files using the existing v1 layout', t => {
  const root = fixture(t), source = path.join(root, 'question-banks', 'sample.json');
  safeDirectory(path.dirname(source), true);
  const before = jsonBytes({ id: 'sample', questions: [{ id: 'q1' }] }), after = jsonBytes({ id: 'sample', questions: [{ id: 'q2' }] });
  replaceFile(source, before);
  const state = path.join(root, '.state', 'a'.repeat(64) + '.json'), stateBytes = jsonBytes({ schemaVersion: 1, collection: 'bank:sample:choice:1.0.0', questions: {} });
  new EditJournal(root).commit({ path: source, before, after, collection: { kind: 'bank', id: 'sample' } }, state, stateBytes);
  assert.equal(fs.readFileSync(source).equals(after), true); assert.equal(fs.readFileSync(state).equals(stateBytes), true);
});
test('rule child environment has no inherited API keys or Node options', () => {
  const values = ruleEnvironment();
  for (const key of Object.keys(values)) assert.ok(['SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'].includes(key.toUpperCase()));
  assert.equal(values.NODE_OPTIONS, undefined); assert.equal(values.OPENAI_API_KEY, undefined);
});
test('Node host executes unchanged legacy choice rules and keeps development preview behavior', async t => {
  const directory = path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0');
  const engine = await RuleEngine.create(codeRoot); t.after(() => engine.close());
  const extension = { rules: path.join(directory, 'rules.js'), questionSchema: path.join(directory, 'question.schema.json'), answerSchema: path.join(directory, 'answer.schema.json') };
  const bank = parseJson(fs.readFileSync(path.join(codeRoot, 'test', 'fixtures', 'legacy-banks', 'mixed-demo', 'bank.json')));
  const question = bank.questions.find(value => value.data.options);
  const projection = await engine.run(extension, { op: 'project', data: question.data });
  assert.ok(projection.projected); assert.equal(Object.hasOwn(projection.projected, 'correctOptionId'), false);
  const preview = await engine.run({ development: {}, rules: null }, { op: 'project', data: { stem: 'preview' } });
  assert.deepEqual(preview, { projected: { stem: 'preview' } });
  await assert.rejects(engine.run({ development: {}, rules: null }, { op: 'grade', data: {} }), { code: 'DEVELOPMENT_NOT_IMPLEMENTED' });
});
test('JSON encodings and fingerprints match the frozen Java 69dab26 oracle', () => {
  const cases = parseJson(fs.readFileSync(path.join(codeRoot, 'test', 'fixtures', 'node-host', 'json-hashes.json')));
  for (const item of cases) {
    const value = parseJson(item.raw);
    assert.equal(stringifyJson(value), item.encoded);
    assert.equal(fingerprint(value, 'migration-json-v1'), item.fingerprint);
    assert.equal(fingerprint(cloneJson(value), 'migration-json-v1'), item.fingerprint);
  }
});
test('child timeout and output limits terminate the process and release tracking', async t => {
  const engine = await RuleEngine.create(codeRoot); t.after(() => engine.close());
  await assert.rejects(engine.process(['-e', 'setInterval(()=>{},1000)'], null, 200), { code: 'RULE_TIMEOUT' });
  assert.equal(engine.children.size, 0);
  await assert.rejects(engine.process(['-e', 'process.stdout.write(Buffer.alloc(3*1024*1024))'], null, 3000), { code: 'RULE_OUTPUT_LIMIT' });
  assert.equal(engine.children.size, 0);
});
