import { makeFormat4Fixture } from '../../../test/fixtures/format4-library.mjs';
import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Library } from './library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { StateStore } from '../practice/state-store.js';
import { readJson, within } from '../platform/files.js';
import { bankLocator } from './identity.js';
import { AiGradingService } from '../ai/ai-grading-service.js';
import { LibraryArchive } from './library-archive.js';

const code = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = path.join(path.dirname(code), '.temp', 'package-v2-tests');
const groupId = 'ec7a70a3-4f7d-4fa5-b176-d8cb51dd3a07', bankId = '136832c4-69e0-4ef9-9b72-e86ce4317405', extensionId = 'f7aa4878-0e49-4f2f-a6d5-c6a7636b24ca';
let engine;
before(async () => { engine = await RuleEngine.create(code); engine.validationEnvironment = async () => 'fixture'; });
after(() => engine.close());
function fixture(t, populated = true) {
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'test-'));
  fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  const library = new Library(root, code, engine);
  t.after(() => { library.close(); assert.ok(within(temporary, root)); fs.rmSync(root, { recursive: true, force: true }); });
  if (populated) {
    install(root, 'choice');
    const raw = readJson(path.join(root, 'extensions/Test/choice/examples.json'));
    raw.id = bankId; raw.version = '1.0'; raw.extension = { id: extensionId, path: 'extensions/Test/choice' };
    raw.questions[1].extension = { ...raw.extension };
    fs.mkdirSync(path.join(root, 'question-banks/Group/leaf'), { recursive: true });
    writeFixture(path.join(root, 'question-banks/Group/.group.json'), JSON.stringify({ schemaVersion: 1, kind: 'bank-group', id: groupId }));
    writeFixture(path.join(root, 'question-banks/Group/leaf/bank.json'), JSON.stringify(raw));
    makeFormat4Fixture(root);
  }
  return { root, library, file: path.join(root, 'question-banks/Group/leaf/bank.json') };
}
function install(root, name) {
  const directory = path.join(root, 'extensions', 'Test', name);
  copyFixture(path.join(code, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), directory, { recursive: true });
  const manifest = readJson(path.join(directory, 'manifest.json')); manifest.id = extensionId;
  writeFixture(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  const raw = readJson(path.join(directory, 'examples.json')); raw.extension.id = extensionId;
  writeFixture(path.join(directory, 'examples.json'), JSON.stringify(raw));
  return directory;
}
async function pack(source) { const result = await source.library.exportGroup('Group'); try { return fs.readFileSync(result.file); } finally { result.close(); } }
test('repeated identical imports create independent physical bundles and local practice identities', async t => {
  const source = fixture(t), target = fixture(t, false), bytes = await pack(source);
  const first = await target.library.importPackage(bytes), row = first.catalog.banks[0];
  const states = new StateStore(target.root, engine), collection = await target.library.collection('bank', row.id), q = collection.questions[0];
  await states.act(collection, q, { requestId: randomUUID(), revision: 0, action: 'draft', data: { answer: { selectedOptionId: q.data.correctOptionId } } });
  const second = await target.library.importPackage(bytes);
  assert.equal(first.group, 'Group'); assert.equal(second.group, 'Group（2）');
  assert.equal(second.importedBanks, 1); assert.equal(second.importedExtensions, 1);
  assert.equal(second.needsConfirmation, undefined);
  assert.equal(second.catalog.banks.length, 2); assert.equal(second.catalog.extensions.length, 2);
  assert.equal(new Set(second.catalog.banks.map(item => item.id)).size, 2);
  for (const item of second.catalog.banks) {
    const value = await target.library.collection('bank', item.id);
    assert.equal(value.extensionFor(value.questions[1]).referencePath, 'extensions/' + item.group + '/choice');
    assert.equal((await states.question(value, value.questions[0])).state.status, item.id === row.id ? 'draft' : 'unanswered');
    assert.equal(item.title, 'leaf');
  }
  for (const item of second.catalog.extensions) assert.equal((await target.library.collection('extension', item.id)).extension.referencePath, item.referencePath);
});
test('bank and extension group suffixes are allocated separately; filename controls new group name', async t => {
  const source = fixture(t), target = fixture(t, false);
  fs.mkdirSync(path.join(target.root, 'extensions/我的练习'));
  const result = await target.library.importPackage(await pack(source), '我的练习.qbank');
  assert.equal(result.group, '我的练习'); assert.equal(result.extensionGroup, '我的练习（2）');
  const row = result.catalog.banks[0], raw = readJson(path.join(target.root, 'question-banks', row.path, 'bank.json'));
  assert.deepEqual(raw.extension, { path: 'extensions/我的练习（2）/choice' });
  assert.deepEqual(raw.questions[1].extension, raw.extension);
  assert.equal((await target.library.collection('bank', row.id)).extensionFor((await target.library.collection('bank', row.id)).questions[1]).referencePath, raw.extension.path);
});
test('changed or higher versions always add a copy and preserve existing source, state and frozen history', async t => {
  const source = fixture(t), target = fixture(t), before = fs.readFileSync(target.file), states = new StateStore(target.root, engine);
  const collection = await target.library.collection('bank', bankLocator(groupId, bankId)), q = collection.questions[0];
  await states.act(collection, q, { requestId: randomUUID(), revision: 0, action: 'submit', data: { answer: { selectedOptionId: q.data.correctOptionId } } });
  const summary = await states.summary(collection);
  await states.finish(collection, { requestId: randomUUID(), roundId: summary.roundId, summaryVersion: summary.summaryVersion });
  const history = (await states.history('bank', collection.id)).records;
  const frozen = await states.history('bank', collection.id, history[0].id);
  const raw = readJson(source.file); raw.version = '99.0'; raw.questions[0].data.stem += ' updated'; writeFixture(source.file, JSON.stringify(raw));
  const result = await target.library.importPackage(await pack(source));
  assert.equal(result.group, 'Group（2）'); assert.equal(result.importedBanks, 1);
  assert.deepEqual(fs.readFileSync(target.file), before);
  assert.deepEqual((await states.history('bank', collection.id)).records, history);
  assert.deepEqual(await states.history('bank', collection.id, history[0].id), frozen);
  const imported = await target.library.collection('bank', result.catalog.banks.find(row => row.group === result.group).id);
  assert.equal((await states.question(imported, imported.questions[0])).state.status, 'unanswered');
  const deleted = await target.library.manage({ kind: 'bank', target: 'group', action: 'delete', path: 'Group' });
  assert.deepEqual(deleted.removedExtensionGroups, []); assert.ok(fs.existsSync(path.join(target.root, 'extensions/Test/choice/manifest.json'))); states.clearMemory();
  assert.deepEqual((await states.history('bank', collection.id)).records, history);
  assert.deepEqual(await states.history('bank', collection.id, history[0].id), frozen);
});
test('importing identical IDs leaves installed exact-path bindings unchanged', async t => {
  const source = fixture(t), target = fixture(t), raw = readJson(target.file);
  raw.extension = { path: 'extensions/Test/choice' }; delete raw.questions[1].extension; writeFixture(target.file, JSON.stringify(raw));
  const previous = await target.library.collection('bank', bankLocator(groupId, bankId)), before = fs.readFileSync(target.file);
  fs.appendFileSync(path.join(source.root, 'extensions/Test/choice/practice.css'), '\n/* variant */');
  await target.library.importPackage(await pack(source));
  assert.equal((await target.library.collection('bank', previous.id)).questions[0].fingerprint, previous.questions[0].fingerprint);
  assert.deepEqual(fs.readFileSync(target.file), before);
});
test('renaming and moving imported banks and groups preserve answers, stable identities and extension paths', async t => {
  const source = fixture(t), target = fixture(t, false), result = await target.library.importPackage(await pack(source));
  const row = result.catalog.banks[0], collection = await target.library.collection('bank', row.id), states = new StateStore(target.root, engine), q = collection.questions[0];
  await states.act(collection, q, { requestId: randomUUID(), revision: 0, action: 'draft', data: { answer: { selectedOptionId: q.data.correctOptionId } } });
  await target.library.manage({ kind: 'bank', target: 'group', action: 'create', name: '新分组' });
  const moved = await target.library.manage({ kind: 'bank', target: 'item', action: 'update', path: row.path, name: '新题库', group: '新分组' });
  assert.equal(moved.path, '新分组/新题库');
  await target.library.manage({ kind: 'bank', target: 'group', action: 'update', path: '新分组', name: '改名分组' });
  const current = await target.library.collection('bank', row.id);
  assert.equal(current.title, '新题库'); assert.equal(current.stateKey(), collection.stateKey());
  assert.equal(current.extensionFor(current.questions[0]).referencePath, 'extensions/Group/choice');
  states.clearMemory(); assert.equal((await states.question(current, current.questions[0])).state.status, 'draft');
});
test('extension structural writes are blocked and physical group deletion checks bank references', async t => {
  const source = fixture(t), target = fixture(t, false), result = await target.library.importPackage(await pack(source));
  const file = path.join(target.root, 'extensions/Group/choice/manifest.json'), before = fs.readFileSync(file);
  for (const request of [{ action: 'create', target: 'group', name: 'Other' }, { action: 'update', target: 'group', path: 'Group', name: 'Other' }, { action: 'update', target: 'item', path: 'Group/choice', name: 'Other', group: '' }]) {
    await assert.rejects(target.library.manage({ kind: 'extension', ...request }), { code: 'EXTENSION_STRUCTURE_READ_ONLY' });
  }
  await assert.rejects(target.library.manage({ kind: 'extension', action: 'delete', target: 'group', path: 'Group' }), { code: 'EXTENSION_IN_USE' });
  assert.deepEqual(fs.readFileSync(file), before);
  const removed = await target.library.manage({ kind: 'bank', action: 'delete', target: 'group', path: result.group });
  assert.deepEqual(removed.removedExtensionGroups, []);
  assert.ok(fs.existsSync(path.join(target.root, removed.archivedTo, 'content/Group/leaf/bank.json')));
  assert.deepEqual(fs.readFileSync(file), before);
  await target.library.manage({ kind: 'extension', action: 'delete', target: 'group', path: 'Group' });
  assert.equal(fs.existsSync(file), false);
});

test('single bank export includes only its dependencies, imports at root, and can be re-exported', async t => {
  const source = fixture(t), target = fixture(t, false);
  const other = install(source.root, 'unused'), another = readJson(source.file);
  another.id = randomUUID(); another.extension = { path: 'extensions/Test/unused' }; delete another.questions[1].extension;
  writeFixture(path.join(source.root, 'question-banks/Group/second/bank.json'), JSON.stringify(another));
  makeFormat4Fixture(source.root);
  const before = fs.readFileSync(source.file), manifestBefore = fs.readFileSync(path.join(other, 'manifest.json'));
  const exported = await source.library.exportBank('Group/leaf');
  let bytes;
  try {
    const archive = new LibraryArchive(source.root, source.library.resources), staging = path.join(exported.workspace, 'inspect'); fs.mkdirSync(staging);
    await archive.unzip(exported.file, staging);
    assert.equal(readJson(path.join(staging, 'quizforge-package.json')).scope, 'bank');
    assert.deepEqual(fs.readdirSync(path.join(staging, 'question-banks/leaf')), ['leaf']);
    assert.deepEqual(fs.readdirSync(path.join(staging, 'extensions/leaf')), ['choice']);
    bytes = fs.readFileSync(exported.file);
  } finally { exported.close(); }
  fs.mkdirSync(path.join(target.root, 'extensions/我的练习'));
  const first = await target.library.importPackage(bytes, '我的练习.qbank');
  const second = await target.library.importPackage(bytes, '我的练习.qbank');
  assert.equal(first.scope, 'bank'); assert.equal(first.group, ''); assert.equal(first.name, '我的练习');
  assert.equal(first.extensionGroup, '我的练习（2）'); assert.equal(second.name, '我的练习（2）');
  assert.equal(second.extensionGroup, '我的练习（3）'); assert.equal(second.catalog.banks.length, 2);
  assert.equal(first.importedExtensions, 1); assert.deepEqual(second.catalog.groups.banks, []);
  for (const row of second.catalog.banks) {
    assert.equal(row.group ?? '', ''); assert.ok(!row.path.includes('/'));
    const bank = await target.library.collection('bank', row.id);
    assert.equal(bank.title, row.path); assert.equal(bank.questions.length, 3);
    const ref = readJson(path.join(target.root, 'question-banks', row.path, 'bank.json')).extension;
    assert.equal(bank.extensionFor(bank.questions[1]).referencePath, ref.path);
  }
  assert.notEqual(second.catalog.banks[0].id, second.catalog.banks[1].id);
  for (const row of second.catalog.extensions) await target.library.collection('extension', row.id);
  const roundtrip = await target.library.exportBank(first.path);
  try { const third = fixture(t, false), result = await third.library.importPackage(fs.readFileSync(roundtrip.file)); assert.equal(result.group, ''); assert.equal(result.importedBanks, 1); }
  finally { roundtrip.close(); }
  assert.deepEqual(fs.readFileSync(source.file), before); assert.deepEqual(fs.readFileSync(path.join(other, 'manifest.json')), manifestBefore);
  await assert.rejects(source.library.exportBank('../Group/leaf'), { code: 'BANK_NOT_FOUND' });
});

test('a single-bank group remains grouped; invalid single scope cannot install multiple banks', async t => {
  const source = fixture(t), target = fixture(t, false);
  const grouped = await target.library.importPackage(await pack(source)); assert.equal(grouped.scope, 'group'); assert.equal(grouped.group, 'Group');
  copyFixture(path.dirname(source.file), path.join(source.root, 'question-banks/Group/second'), { recursive: true });
  const second=readJson(source.file);second.id=randomUUID();writeFixture(path.join(source.root,'question-banks/Group/second/bank.json'),JSON.stringify(second));
  const exported = await source.library.exportGroup('Group');
  try {
    const archive = new LibraryArchive(source.root, source.library.resources), staging = path.join(exported.workspace, 'tampered'); fs.mkdirSync(staging);
    await archive.unzip(exported.file, staging);
    for (const scope of ['bank', 'invalid']) {
      const marker = readJson(path.join(staging, 'quizforge-package.json')); marker.scope = scope;
      writeFixture(path.join(staging, 'quizforge-package.json'), JSON.stringify(marker));
      const zip = path.join(exported.workspace, scope + '.qbank'); await archive.zip(staging, zip);
      await assert.rejects(target.library.importPackage(fs.readFileSync(zip)), { code: 'INVALID_QUESTION_BANK' });
    }
    assert.equal(target.library.index().banks.length, 1);
  } finally { exported.close(); }
});

test('failed single-bank installation rolls back the extension group', async t => {
  const source = fixture(t), target = fixture(t, false), exported = await source.library.exportBank('Group/leaf');
  const bytes = fs.readFileSync(exported.file); exported.close(); const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === path.join(target.root, 'question-banks/leaf')) throw new Error('single installation failed'); return rename(from, to); };
  try { await assert.rejects(target.library.importPackage(bytes), /single installation failed/); } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readdirSync(path.join(target.root, 'question-banks')), []);
  assert.deepEqual(fs.readdirSync(path.join(target.root, 'extensions')), []);
});
test('old logical grouping and labels are ignored without altering their files', t => {
  const f = fixture(t), state = path.join(f.root, '.state'); fs.mkdirSync(state, { recursive: true });
  for (const name of ['extension-groups.json', 'library-labels.json']) writeFixture(path.join(state, name), 'old invalid metadata');
  const row = f.library.index().extensions[0]; assert.equal(row.name, 'choice'); assert.equal(row.group, 'Test');
  assert.equal(fs.readFileSync(path.join(state, 'extension-groups.json'), 'utf8'), 'old invalid metadata');
});
test('format 4 rejects duplicate permanent UUIDs within a bundle', async t => {
  const source = fixture(t), target = fixture(t, false);
  copyFixture(path.dirname(source.file), path.join(source.root, 'question-banks/Group/second'), { recursive: true });
  await assert.rejects(pack(source), {code:'INVALID_QUESTION_BANK'});
  assert.equal(target.library.index().banks.length,0);
});
test('format 4 rejects missing permanent bank UUIDs and incomplete extension identities',async t=>{
  const source=fixture(t),raw=readJson(source.file);delete raw.id;writeFixture(source.file,JSON.stringify(raw));
  await assert.rejects(pack(source),{code:'BANK_FORMAT_UPGRADE_REQUIRED'});
  raw.id=bankId;writeFixture(source.file,JSON.stringify(raw));
  const file=path.join(source.root,'extensions/Test/choice/manifest.json'),manifest=readJson(file);delete manifest.version;writeFixture(file,JSON.stringify(manifest));
  await assert.rejects(pack(source));
});

test('failed bank directory installation rolls back its paired extension directory and preserves existing files', async t => {
  const source = fixture(t), target = fixture(t), original = fs.readFileSync(target.file), bytes = await pack(source), rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === path.join(target.root, 'question-banks/Group（2）')) throw new Error('injected installation failure'); return rename(from, to); };
  try { await assert.rejects(target.library.importPackage(bytes), /injected/); } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(target.file), original); assert.equal(fs.existsSync(path.join(target.root, 'extensions/Group')), false);
  assert.equal(fs.readdirSync(path.join(target.root, '.temp')).length, 0);
});
test('new imports do not shadow installed path bindings or prevent their later export',async t=>{
 const source=fixture(t),target=fixture(t),raw=readJson(target.file);
 raw.extension={path:'extensions/Test/choice'};delete raw.questions[1].extension;writeFixture(target.file,JSON.stringify(raw));
 const previous=await target.library.collection('bank',bankLocator(groupId,bankId));
 await target.library.importPackage(await pack(source));
 assert.equal((await target.library.collection('bank',previous.id)).questions[0].fingerprint,previous.questions[0].fingerprint);
 const exported=await target.library.exportGroup('Group');exported.close();
});
test('same-named extensions from different groups are independently bundled and path-remapped',async t=>{
 const source=fixture(t),target=fixture(t,false),other=path.join(source.root,'extensions/Other/choice');
 copyFixture(path.join(source.root,'extensions/Test/choice'),other,{recursive:true});
 const examplePath=path.join(other,'examples/bank.json'),example=readJson(examplePath);example.id=randomUUID();writeFixture(examplePath,JSON.stringify(example));
 fs.appendFileSync(path.join(other,'practice.css'),'\n/* different */');
 const raw=readJson(source.file);raw.questions[1].extension={path:'extensions/Other/choice'};writeFixture(source.file,JSON.stringify(raw));
 const result=await target.library.importPackage(await pack(source));assert.equal(result.importedExtensions,2);
 const collection=await target.library.collection('bank',result.catalog.banks[0].id);
 assert.notEqual(collection.extensionFor(collection.questions[0]).referencePath,collection.extensionFor(collection.questions[1]).referencePath);
 assert.notEqual(collection.questions[0].extension.fingerprint,collection.questions[1].extension.fingerprint);
});
test('packages cannot supply host instance or bundle metadata to share another copy’s progress',async t=>{
 const source=fixture(t),target=fixture(t,false),exported=await source.library.exportGroup('Group');
 const archive=new LibraryArchive(source.root,source.library.resources),staging=path.join(exported.workspace,'tampered');fs.mkdirSync(staging);
 try {
  await archive.unzip(exported.file,staging);
  for(const relative of ['question-banks/Group/leaf/.instance/bank.json','extensions/Group/.bundle.json']){
   const file=path.join(staging,relative);writeFixture(file,JSON.stringify({schemaVersion:1,id:randomUUID(),kind:'extension-bundle'}));
   const zip=path.join(exported.workspace,'tampered-'+path.basename(file)+'.qbank');await archive.zip(staging,zip);
   await assert.rejects(target.library.importPackage(fs.readFileSync(zip)),{code:'INVALID_QUESTION_BANK'});fs.unlinkSync(file);
  }
  assert.equal(fs.readdirSync(path.join(target.root,'question-banks')).length,0);assert.equal(fs.readdirSync(path.join(target.root,'extensions')).length,0);
 } finally { exported.close(); }
});
