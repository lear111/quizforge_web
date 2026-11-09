import { makeFormat4Fixture } from '../../../test/fixtures/format4-library.mjs';
import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import yazl from 'yazl';
import { Library } from './library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { ResourceStore } from '../resources/resources.js';
import { LibraryArchive, MANIFEST, FORMAT } from './library-archive.js';
import { readJson, safeDirectory, within } from '../platform/files.js';
import { jsonBytes } from '../platform/json.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), temporaryRoot = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
function root(t) { safeDirectory(temporaryRoot, true); const directory = fs.mkdtempSync(path.join(temporaryRoot, 'archive-')); fs.mkdirSync(path.join(directory, 'extensions')); fs.mkdirSync(path.join(directory, 'question-banks')); t.after(() => { assert.ok(within(temporaryRoot, directory) && directory !== temporaryRoot); fs.rmSync(directory, { recursive: true, force: true }); }); return directory; }
async function packageBuffer(entries) { const zip = new yazl.ZipFile(), chunks = []; zip.outputStream.on('data', chunk => chunks.push(chunk)); const ended = once(zip.outputStream, 'end'); for (const [name, bytes] of entries) if (name.endsWith('/')) zip.addEmptyDirectory(name); else zip.addBuffer(Buffer.from(bytes), name); zip.end(); await ended; return Buffer.concat(chunks); }
test('format 4 exports upgraded mixed legacy UUID/string banks without changing them again',async t=>{
 const sourceRoot=root(t),targetRoot=root(t),leaf=path.join(sourceRoot,'extensions/Test/choice');copyFixture(path.join(codeRoot,'test/fixtures/legacy-extensions/single-choice-1.0.0'),leaf,{recursive:true});
 const group=path.join(sourceRoot,'question-banks/Group');fs.mkdirSync(group);
 writeFixture(path.join(group,'.group.json'),jsonBytes({schemaVersion:1,kind:'bank-group',id:'a04a41c3-7374-4a09-9892-1f25e30d24f4'}));
 const raw=readJson(path.join(leaf,'examples.json'));raw.extension={path:'extensions/Test/choice'};raw.questions[1].extension={...raw.extension};
 const ids=['old-bank','419257df-b27f-4979-af8a-dea38a58ceda'],before=[];
 for(const identity of ids){raw.id=identity;const file=path.join(group,identity,'bank.json');writeFixture(file,jsonBytes(raw));before.push([file,fs.readFileSync(file)]);}
 const engine=await RuleEngine.create(codeRoot);engine.validationEnvironment=async()=>'fixture';const source=new Library(sourceRoot,codeRoot,engine),target=new Library(targetRoot,codeRoot,engine);t.after(()=>{source.close();target.close();engine.close();});
 makeFormat4Fixture(sourceRoot);for(const entry of before)entry[1]=fs.readFileSync(entry[0]);
 const exported=await source.exportGroup('Group');try{const imported=await target.importPackage(fs.readFileSync(exported.file));assert.equal(imported.importedBanks,2);assert.equal(imported.importedExtensions,1);for(const row of imported.catalog.banks){const collection=await target.collection('bank',row.id);assert.equal(collection.extensionFor(collection.questions[1]).id,'quizforge.single-choice');}}finally{exported.close();}
 for(const [file,bytes]of before)assert.deepEqual(fs.readFileSync(file),bytes);
});
test('format 4 round-trip preserves code and repeated imports always create independent copies', async t => {
  const first = root(t), second = root(t); copyFixture(path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0'), path.join(first, 'extensions', 'Test', 'choice'), { recursive: true }); const raw = readJson(path.join(first, 'extensions', 'Test', 'choice', 'examples.json')); raw.id = 'bank'; writeFixture(path.join(first, 'question-banks', 'Group', 'questions', 'bank.json'), jsonBytes(raw));
  const engine = await RuleEngine.create(codeRoot); engine.validationEnvironment = async () => 'fixture'; const source = new Library(first, codeRoot, engine), target = new Library(second, codeRoot, engine); t.after(() => { source.close(); target.close(); engine.close(); });
  makeFormat4Fixture(first);
  const download = await source.exportGroup('Group'); let bytes; try { bytes = fs.readFileSync(download.file); } finally { download.close(); }
  const imported = await target.importPackage(bytes); assert.equal(imported.importedBanks, 1); assert.equal(imported.importedExtensions, 1); const bank = await target.collection('bank', imported.catalog.banks[0].id); assert.equal(bank.extension.id, 'quizforge.single-choice'); assert.equal(bank.extension.version, '1.0.0');
  const secondImport = await target.importPackage(bytes); assert.equal(secondImport.importedBanks, 1); assert.equal(secondImport.importedExtensions, 1); assert.equal(secondImport.group, 'Group（2）');
  const file = path.join(second, 'question-banks', imported.catalog.banks[0].path, 'bank.json'), changed = readJson(file); changed.title = 'locally changed'; writeFixture(file, jsonBytes(changed)); const before = fs.readFileSync(file);
  const third = await target.importPackage(bytes); assert.equal(third.group, 'Group（3）'); assert.deepEqual(fs.readFileSync(file), before); assert.equal(fs.readdirSync(path.join(second, '.temp')).length, 0);
});
test('arbitrary ZIP, case-duplicate files and undeclared private files are refused before installation', async t => {
  const directory = root(t), archive = new LibraryArchive(directory, new ResourceStore(directory));
  await assert.rejects(archive.importPackage(await packageBuffer([['anything.txt', 'hello']]), async () => {}), { code: 'INVALID_LIBRARY_ARCHIVE' });
  const marker = jsonBytes({ format: FORMAT, formatVersion: 1, group: 'Group' });
  await assert.rejects(archive.importPackage(await packageBuffer([[MANIFEST, marker], ['question-banks/Group/', ''], ['extensions/Group/', ''], ['question-banks/Group/a/bank.json', '{}'], ['question-banks/Group/A/bank.json', '{}']]), async () => {}), { code: 'INVALID_LIBRARY_ARCHIVE' });
  assert.equal(fs.readdirSync(path.join(directory, 'question-banks')).length, 0); assert.equal(fs.readdirSync(path.join(directory, 'extensions')).length, 0);
});
test('manifest-declared hidden runtime files are transported and unrelated hidden files are omitted', async t => {
  const directory = root(t), leaf = path.join(directory, 'extensions', 'Test', 'choice'); copyFixture(path.join(codeRoot, 'test', 'fixtures', 'legacy-extensions', 'single-choice-1.0.0'), leaf, { recursive: true }); const manifest = readJson(path.join(leaf, 'manifest.json')); fs.renameSync(path.join(leaf, manifest.rules), path.join(leaf, '.rules.js')); manifest.rules = '.rules.js'; writeFixture(path.join(leaf, 'manifest.json'), jsonBytes(manifest)); writeFixture(path.join(leaf, '.secret'), 'excluded');
  makeFormat4Fixture(directory);
  const archive = new LibraryArchive(directory, new ResourceStore(directory)), destination = path.join(directory, '.temp', 'copy'); archive.copyExtension(leaf, destination, 'extensions/Group/choice'); assert.equal(fs.existsSync(path.join(destination, '.rules.js')), true); assert.equal(fs.existsSync(path.join(destination, '.secret')), false);
});
for(const version of [1,2])test('old package format '+version+' reports that its author must upgrade, without installing files',async t=>{
 const directory=root(t),archive=new LibraryArchive(directory,new ResourceStore(directory));
 const bytes=await packageBuffer([[MANIFEST,jsonBytes({format:FORMAT,formatVersion:version,group:'Group'})]]);
 await assert.rejects(archive.importPackage(bytes,async()=>assert.fail('old package must not run rules')),{code:'UNSUPPORTED_LIBRARY_ARCHIVE'});
 assert.equal(fs.readdirSync(path.join(directory,'question-banks')).length,0);assert.equal(fs.readdirSync(path.join(directory,'.temp')).length,0);
});
