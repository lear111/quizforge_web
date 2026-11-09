import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleEngine } from '../extensions/rule-engine.js';
import { Library } from './library.js';
import { DevelopmentSettings } from '../extensions/development-settings.js';
import { readJson, safeDirectory, within } from '../platform/files.js';
import { cloneJson, jsonBytes } from '../platform/json.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryRoot = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
async function fixture(t, { rules = true } = {}) {
  safeDirectory(temporaryRoot, true);
  const root = fs.mkdtempSync(path.join(temporaryRoot, 'library-'));
  fs.mkdirSync(path.join(root, 'extensions')); fs.mkdirSync(path.join(root, 'question-banks'));
  copyFixture(path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0'), path.join(root, 'extensions', 'Test', 'choice'), { recursive: true });
  const engine = rules ? await RuleEngine.create(codeRoot) : { run: () => { throw new Error('Metadata index must not execute rules'); }, close() {} };
  if (rules) engine.validationEnvironment = async () => 'fixture-node-environment';
  const library = new Library(root, codeRoot, engine);
  t.after(() => { library.close(); engine.close(); assert.ok(within(temporaryRoot, root) && root !== temporaryRoot); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, engine, library };
}
test('retired bindings return upgrade errors without rewriting authored banks', async t => {
  const { root, library } = await fixture(t, { rules: false });
  const bank = readJson(path.join(root, 'extensions/Test/choice/examples.json')); bank.id = 'old-binding';
  const file = path.join(root, 'question-banks/Group/Old/bank.json');
  for (const [reference, code] of [
    [{ id: 'quizforge.single-choice', version: '1.0.0' }, 'EXTENSION_REFERENCE_UPGRADE_REQUIRED'],
    [{ development: 'choice' }, 'EXTENSION_REFERENCE_UPGRADE_REQUIRED'],
    [{ path: 'extensions/choice' }, 'EXTENSION_LAYOUT_UPGRADE_REQUIRED'],
    [{ path: 'extensions/Test/choice', id: 'another-type' }, 'EXTENSION_ID_MISMATCH']
  ]) {
    bank.extension = reference; writeFixture(file, jsonBytes(bank)); library.invalidate();
    const before = fs.readFileSync(file);
    await assert.rejects(library.collection('bank', bank.id), { code });
    assert.deepEqual(fs.readFileSync(file), before);
  }
});
test('old physical layouts remain diagnosable while current directory entries stay usable', async t => {
  const { root, library } = await fixture(t, { rules: false });
  fs.cpSync(path.join(root, 'extensions/Test/choice'), path.join(root, 'extensions/old-flat'), { recursive: true });
  const raw = readJson(path.join(root, 'extensions/Test/choice/examples.json')); raw.id = 'old-file';
  writeFixture(path.join(root, 'question-banks/legacy.json'), jsonBytes(raw));
  writeFixture(path.join(root, 'question-banks/Group/Current/bank.json'), jsonBytes({ ...raw, id: 'current' }));
  const index = library.index();
  assert.equal(index.extensions.find(row => row.path === 'old-flat').errorCode, 'EXTENSION_LAYOUT_UPGRADE_REQUIRED');
  assert.equal(index.banks.find(row => row.path === 'legacy.json').errorCode, 'BANK_LAYOUT_UPGRADE_REQUIRED');
  assert.equal(index.banks.find(row => row.bankId === 'current').error, undefined);
  assert.equal(index.extensions.find(row => row.path === 'Test/choice').error, undefined);
});
test('ordinary manifests ignore retired marker configuration and require exact self-bound examples', async t => {
  const { root, library } = await fixture(t);
  const directory = path.join(root, 'extensions/Test/choice');
  writeFixture(path.join(directory, 'development.json'), 'retired non-JSON metadata');
  assert.ok((await library.collection('extension', 'quizforge.single-choice')).questions.length);
  const file = path.join(directory, 'examples.json'), raw = readJson(file);
  raw.extension = { id: 'quizforge.single-choice', version: '1.0.0' };
  writeFixture(file, jsonBytes(raw)); library.invalidate();
  await assert.rejects(library.collection('extension', 'quizforge.single-choice'), { code: 'EXAMPLE_BINDING_UPGRADE_REQUIRED' });
});
test('pinned SDK archives survive absent source versions and a library restart', async t => {
  const { root, library } = await fixture(t, { rules: false });
  const id = 'quizforge.richtext', version = '1.1.1';
  const source = path.join(codeRoot, 'test', 'fixtures', 'legacy-richtext', version);
  const text = name => fs.readFileSync(path.join(source, name), 'utf8');
  const frozen = { id, version, script: text('richtext.js'), editorScript: text('richtext-editor.js'), style: text('richtext.css') };
  const archive = path.join(root, '.state', 'sdk', id, version, 'sdk.json');
  fs.mkdirSync(path.dirname(archive), { recursive: true }); writeFixture(archive, jsonBytes(frozen));
  const before = fs.readFileSync(archive);
  library.codeRoot = path.join(root, 'without-sdk-source');
  assert.deepEqual(library.sdk(id, version), { script: frozen.script, style: frozen.style });
  assert.deepEqual(library.sdk(id, version, true), { script: frozen.editorScript });
  const restarted = new Library(root, library.codeRoot, library.engine); t.after(() => restarted.close());
  assert.deepEqual(restarted.sdk(id, version), { script: frozen.script, style: frozen.style });
  assert.deepEqual(restarted.sdk(id, version, true), { script: frozen.editorScript });
  assert.deepEqual(fs.readFileSync(archive), before);
  assert.throws(() => restarted.sdk(id, '1.1.2'), error => error.code === 'SDK_UNAVAILABLE');
});
test('metadata index shows pending entries without executing any extension', async t => {
  const { root, library } = await fixture(t, { rules: false });
  const index = library.index();
  assert.equal(index.extensions[0].id, 'quizforge.single-choice');
  assert.equal(index.extensions[0].validationStatus, 'pending');
  assert.equal(fs.existsSync(path.join(root, '.state', 'resources')), false);
});
test('on-demand collection and page load keep ordinary extension identity', async t => {
  const { library } = await fixture(t);
  const collection = await library.collection('extension', 'quizforge.single-choice');
  assert.equal(collection.stateKey(), 'extension:quizforge.single-choice:quizforge.single-choice:1.0.0');
  assert.ok(collection.questions.length);
  const page = await library.page('quizforge.single-choice', '1.0.0');
  assert.ok(page.script.includes('QF')); assert.deepEqual(page.apiVersion, { major: 1, minor: 5 });
  const ready = library.index().extensions[0]; assert.equal(ready.validationStatus, 'ready');
});
test('external source changes invalidate an already loaded question collection', async t => {
  const { root, library } = await fixture(t);
  const original = await library.collection('extension', 'quizforge.single-choice');
  const examples = path.join(root, 'extensions', 'Test', 'choice', 'examples.json');
  const actual = original.extension.examples;
  const raw = readJson(actual); raw.questions[0].title = 'Changed by external editor'; writeFixture(actual, jsonBytes(raw));
  const updated = await library.readCollection('extension', 'quizforge.single-choice');
  assert.equal(updated.questions[0].title, 'Changed by external editor');
  assert.notEqual(updated, original);
});

test('warm writes check their binding without scanning unrelated banks; changed content still reloads',async t=>{
  const {root,library}=await fixture(t),source=path.join(root,'extensions','Test','choice');
  const manifest=readJson(path.join(source,'manifest.json')),bank=readJson(path.join(source,manifest.examples));bank.id='focused';
  const file=path.join(root,'question-banks', 'focused', 'bank.json');writeFixture(file,jsonBytes(bank));
  const opened=await library.collection('bank','focused'),scan=library.indexer.scan.bind(library.indexer);let scans=0;
  library.indexer.scan=(...args)=>{scans++;return scan(...args);};
  assert.equal(await library.writeCollection('bank','focused'),opened);assert.equal(scans,0);
  writeFixture(path.join(root,'question-banks', 'unrelated', 'bank.json'),jsonBytes({...bank,id:'other'}));
  assert.equal(await library.writeCollection('bank','focused'),opened);assert.equal(scans,0);
  bank.questions[0].title='new current content';writeFixture(file,jsonBytes(bank));
  const changed=await library.writeCollection('bank','focused');assert.equal(changed.questions[0].title,bank.questions[0].title);assert.ok(scans>0);
  scans=0;fs.appendFileSync(path.join(source,'practice.css'),'\n/* target dependency changed */');
  assert.notEqual(await library.writeCollection('bank','focused'),changed);assert.ok(scans>0);
  fs.unlinkSync(file);await assert.rejects(library.writeCollection('bank','focused'),{code:'COLLECTION_NOT_FOUND'});
});

test('warm writes ignore display settings and preserve runtime invalidation and closed-library checks',async t=>{
  const {root,library,engine}=await fixture(t),source=path.join(root,'extensions','Test','choice');
  const opened=await library.collection('extension','quizforge.single-choice');
  engine.validationEnvironment=async()=>'changed-runtime';assert.notEqual(await library.writeCollection('extension','quizforge.single-choice'),opened);
  writeFixture(path.join(source,'development.json'),jsonBytes({name:'development'}));library.settings.update({enabled:true});
  await assert.rejects(library.collection('development','choice'),{code:'COLLECTION_KIND_UPGRADE_REQUIRED'});library.settings.update({enabled:false});
  assert.equal((await library.writeCollection('extension','quizforge.single-choice')).kind,'extension');
  library.close();await assert.rejects(library.writeCollection('extension','quizforge.single-choice'),{code:'LIBRARY_UNAVAILABLE'});
});

test('catalog returns changed package bytes to pending rather than reusing a ready status', async t => {
  const { root, library } = await fixture(t);
  const original = await library.collection('extension', 'quizforge.single-choice');
  assert.equal(library.index().extensions[0].validationStatus, 'ready');
  fs.appendFileSync(path.join(root, 'extensions', 'Test', 'choice', 'practice.css'), '\n/* external package edit */');
  assert.equal(library.index().extensions[0].validationStatus, 'pending');
  const updated = await library.collection('extension', 'quizforge.single-choice');
  assert.notEqual(updated.extensionFingerprint, original.extensionFingerprint);
  assert.equal(library.index().extensions[0].validationStatus, 'ready');
});

test('one metadata refresh scans shared extension files once and detects changes on the next refresh', async t => {
  const { root, library }=await fixture(t), source=path.join(root,'extensions','Test','choice');
  const manifest=readJson(path.join(source,'manifest.json')),raw=readJson(path.join(source,manifest.examples));
  for(const name of ['one','two']){const bank=cloneJson(raw);bank.id=name;writeFixture(path.join(root,'question-banks',name,'bank.json'),jsonBytes(bank));}
  for(const name of ['one','two'])await library.collection('bank',name);
  const checked=[],fileHash=library.files.hash.bind(library.files);
  library.files.hash=(file,...args)=>{if(within(source,file))checked.push(file);return fileHash(file,...args);};
  assert.ok(library.index().banks.every(row=>row.validationStatus==='ready'));
  assert.ok(checked.length>0);assert.equal(checked.length,new Set(checked).size,'Shared folders are visited once per index response');
  fs.appendFileSync(path.join(source,'practice.css'),'\n/* changed */');
  assert.ok(library.index().banks.every(row=>row.validationStatus==='pending'),'Sharing scans must not retain identity across refreshes');
});

test('active development revision reuses metadata and reads only its own bank',async t=>{
  const {root,library}=await fixture(t,{rules:false}),source=path.join(root,'extensions','Test','choice');
  writeFixture(path.join(source,'development.json'),jsonBytes({name:'Development choice'}));library.settings.update({enabled:true});
  const manifest=readJson(path.join(source,'manifest.json')),raw=readJson(path.join(source,manifest.examples));raw.extension={path:'extensions/Test/choice'};
  for(const name of ['current','other']){const bank=cloneJson(raw);bank.id=name;writeFixture(path.join(root,'question-banks',name,'bank.json'),jsonBytes(bank));}
  library.index();
  const reads=[],json=library.indexer.files.json.bind(library.indexer.files);
  library.indexer.files.json=(file,...args)=>{reads.push(file);return json(file,...args);};
  const first=library.developmentBankRevision('current');
  assert.deepEqual(reads,[path.join(root,'question-banks', 'current', 'bank.json')]);
  const current=readJson(reads[0]);current.questions[0].title+=' changed';writeFixture(reads[0],jsonBytes(current));
  assert.notEqual(library.developmentBankRevision('current').revision,first.revision);
  assert.throws(()=>library.developmentBankRevision('missing'),{code:'DEVELOPMENT_BANK_NOT_FOUND'});
});

test('latest extension preview coexists with banks pinned to older installed versions', async t => {
  const { root, library } = await fixture(t), source = path.join(root, 'extensions', 'Test', 'choice'), newer = path.join(root, 'extensions', 'Test', 'choice-new');
  copyFixture(source, newer, { recursive: true }); const manifest = readJson(path.join(newer, 'manifest.json')); manifest.version = '1.0.1';
  writeFixture(path.join(newer, 'manifest.json'), jsonBytes(manifest));
  const example = readJson(path.join(newer, manifest.examples)); example.extension.version = '1.0.1'; writeFixture(path.join(newer, manifest.examples), jsonBytes(example));
  const bank = readJson(path.join(source, manifest.examples)); bank.id = 'old-pinned-bank'; writeFixture(path.join(root, 'question-banks', 'old', 'bank.json'), jsonBytes(bank));
  assert.equal((await library.collection('extension', 'quizforge.single-choice')).extension.version, '1.0.1');
  assert.equal((await library.collection('bank', bank.id)).extension.version, '1.0.0');
  assert.deepEqual(library.index().extensions.map(row => row.version).sort(), ['1.0.0', '1.0.1']);
  assert.equal((await library.page('quizforge.single-choice', '1.0.0')).html.includes('提交'), true);
});

test('warm collection reads revalidate after the reused rule runtime identity expires', async t => {
  const { library, engine } = await fixture(t);
  let time = 0; library.now = () => time;
  const original = await library.collection('extension', 'quizforge.single-choice');
  let runs = 0; const run = engine.run.bind(engine); engine.run = (...args) => { runs++; return run(...args); };
  engine.validationEnvironment = async () => 'updated-rule-runner';
  time = 29 * 1000; assert.equal(await library.readCollection('extension', 'quizforge.single-choice'), original, 'Reads reuse a recent runtime fingerprint'); assert.equal(runs, 0);
  time = 30 * 1000; const updated = await library.readCollection('extension', 'quizforge.single-choice');
  assert.notEqual(updated, original); assert.ok(runs > 0);
  assert.equal(updated.extensionFingerprint, original.extensionFingerprint, 'Changing host rules must not change a stored extension identity');
});
test('warm reads keep the checked binding until a newer index scan completes', async t => {
  const { root, library } = await fixture(t);
  const original = await library.collection('extension', 'quizforge.single-choice');
  const extension = path.join(root, 'extensions', 'Test', 'choice'), raw = readJson(path.join(extension, readJson(path.join(extension, 'manifest.json')).examples));
  raw.id = 'unrelated-bank'; writeFixture(path.join(root, 'question-banks', 'unrelated', 'bank.json'), jsonBytes(raw));
  assert.equal(await library.readCollection('extension', 'quizforge.single-choice'), original, 'Reads do not rescan unrelated banks');
  library.index();
  const reloaded = await library.readCollection('extension', 'quizforge.single-choice');
  assert.notEqual(reloaded, original, 'A newer completed scan sends the next read through the full loader');
  assert.equal(await library.readCollection('extension', 'quizforge.single-choice'), reloaded);
});
test('management display settings do not hide legacy banks or change collection identity', async t => {
  const { root, library } = await fixture(t, { rules: false });
  const extension = path.join(root, 'extensions', 'Test', 'choice');
  writeFixture(path.join(extension, 'development.json'), jsonBytes({ name: 'Choice development' }));
  const samples = readJson(path.join(extension, 'manifest.json')).examples;
  const raw = readJson(path.join(extension, samples)); raw.id = 'dev-bank'; raw.extension = { development: 'choice' };
  writeFixture(path.join(root, 'question-banks', 'dev-bank', 'bank.json'), jsonBytes(raw));
  assert.equal(library.index().extensions.length, 1); assert.equal(library.index().banks.length, 1);
  library.settings.update({ enabled: true });
  const index = library.index(); assert.equal(index.extensions[0].kind, 'extension'); assert.equal(index.banks[0].kind, 'bank');
});
test('group management preserves bank identity and rejects nested groups', async t => {
  const { root, library } = await fixture(t, { rules: false });
  const manifest = readJson(path.join(root, 'extensions', 'Test', 'choice', 'manifest.json'));
  const raw = readJson(path.join(root, 'extensions', 'Test', 'choice', manifest.examples)); raw.id = 'bank1';
  writeFixture(path.join(root, 'question-banks', 'bank1', 'bank.json'), jsonBytes(raw));
  await library.manage({ kind: 'bank', action: 'create', target: 'group', name: 'Group' });
  await library.manage({ kind: 'bank', action: 'update', target: 'item', path: 'bank1', name: 'Renamed', group: 'Group' });
  const bank = readJson(path.join(root, 'question-banks', 'Group', 'Renamed', 'bank.json'));
  assert.equal(bank.id, 'bank1'); assert.equal(bank.title, 'Renamed');
  await assert.rejects(library.manage({ kind: 'bank', action: 'update', target: 'group', path: 'Group', name: 'Nested', group: 'Group' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(library.manage({ kind: 'extension', action: 'delete', target: 'item', path: 'Test/choice' }), { code: 'EXTENSION_IN_USE' });
});

test('bank and group renames work after loading an extension page descriptor without a collection', async t => {
  const {root,library}=await fixture(t);
  const raw=readJson(path.join(root,'extensions/Test/choice/examples.json'));raw.id='one';
  writeFixture(path.join(root,'question-banks/Group/one/bank.json'),jsonBytes(raw));
  const bank=await library.collection('bank','one');
  await library.page('quizforge.single-choice','1.0.0');
  assert.equal(library.loaded.get('page:quizforge.single-choice@1.0.0').collection,null);
  const renamed=await library.manage({kind:'bank',action:'update',target:'item',path:'Group/one',name:'Renamed',group:'Group'});
  assert.equal(renamed.retainedCollections.find(row=>row.id==='one').title,'Renamed');
  assert.equal((await library.readCollection('bank','one')).questions,bank.questions);
  await library.page('quizforge.single-choice','1.0.0');
  await library.manage({kind:'bank',action:'update',target:'group',path:'Group',name:'New Group'});
  assert.equal((await library.readCollection('bank','one')).questions,bank.questions);
  assert.ok(fs.existsSync(path.join(root,'question-banks/New Group/Renamed/bank.json')));
});

test('bank and group renames reuse validated questions and keep unrelated collections warm', async t => {
  const { root, library, engine } = await fixture(t);
  const raw = readJson(path.join(root, 'extensions/Test/choice/examples.json'));
  for (const id of ['one', 'two']) writeFixture(path.join(root, `question-banks/Group/${id}/bank.json`), jsonBytes({ ...raw, id }));
  const first = await library.collection('bank', 'one'), second = await library.collection('bank', 'two');
  let rules = 0; const run = engine.run.bind(engine); engine.run = (...args) => { rules++; return run(...args); };
  const renamed = await library.manage({ kind: 'bank', action: 'update', target: 'item', path: 'Group/one', name: 'Renamed', group: 'Group' });
  assert.equal(renamed.retainedCollections.length, 2);
  assert.equal(renamed.retainedCollections.find(row => row.id === 'one').title, 'Renamed');
  const after = await library.readCollection('bank', 'one');
  assert.equal(after.title, 'Renamed'); assert.equal(after.questions, first.questions); assert.equal(after.stateKey(), first.stateKey());
  assert.equal((await library.readCollection('bank', 'two')).questions, second.questions);
  await library.manage({ kind: 'bank', action: 'update', target: 'group', path: 'Group', name: 'New Group' });
  assert.equal((await library.writeCollection('bank', 'one')).questions, first.questions);
  assert.equal(library.loaded.get('bank:one').source, path.join(root, 'question-banks/New Group/Renamed/bank.json'));
  assert.equal(rules, 0, 'Renaming does not rerun validation or outline rules');
});

for (const edited of ['question', 'extension', 'asset']) test(`a ${edited} change during rename cannot reuse old validated content`, async t => {
  const { root, library, engine } = await fixture(t);
  const raw = readJson(path.join(root, 'extensions/Test/choice/examples.json')); raw.id = 'one';
  writeFixture(path.join(root, 'question-banks/Group/one/bank.json'), jsonBytes(raw));
  const before = await library.collection('bank', 'one'), change = library.management.change.bind(library.management);
  let rules = 0; const run = engine.run.bind(engine); engine.run = (...args) => { rules++; return run(...args); };
  library.management.change = (...args) => {
    const result = change(...args), directory = path.join(root, 'question-banks/Group/Renamed');
    if (edited === 'question') { const value = readJson(path.join(directory, 'bank.json')); value.questions[0].title = 'Edited question'; writeFixture(path.join(directory, 'bank.json'), jsonBytes(value)); }
    if (edited === 'extension') fs.appendFileSync(path.join(root, 'extensions/Test/choice/practice.css'), '\n/* external edit */');
    if (edited === 'asset') writeFixture(path.join(directory, 'assets/new-file.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4xkAAAAASUVORK5CYII=', 'base64'));
    return result;
  };
  const result = await library.manage({ kind: 'bank', action: 'update', target: 'item', path: 'Group/one', name: 'Renamed', group: 'Group' });
  assert.equal(result.retainedCollections.length, 0);
  const after = await library.readCollection('bank', 'one');
  assert.notEqual(after.questions, before.questions); assert.ok(rules > 0);
  if (edited === 'question') assert.equal(after.questions[0].title, 'Edited question');
});

test('legacy publication endpoints explicitly reject copying another version', async t => {
 const {library}=await fixture(t);await assert.rejects(library.developmentPublishPlan('choice'),{code:'PUBLICATION_REMOVED'});await assert.rejects(library.publishDevelopment('choice',{}),{code:'PUBLICATION_REMOVED'});
});
test('editing a marked extension uses the same content validation as an ordinary extension', async t => {
 const {root,library}=await fixture(t),source=path.join(root,'extensions/Test/choice');writeFixture(path.join(source,'development.json'),'{}');
 const before=await library.collection('extension','quizforge.single-choice');fs.appendFileSync(path.join(source,'practice.css'),'\n/* edited */');
 const after=await library.collection('extension','quizforge.single-choice');assert.notEqual(before.extensionFingerprint,after.extensionFingerprint);assert.equal(after.kind,'extension');
});
