import { makeFormat4Fixture } from '../../../test/fixtures/format4-library.mjs';
import { copyFixture, writeFixture } from '../../../test/fixtures/installed-library.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LibraryArchive, MAX_ENTRIES, MAX_EXPANDED } from './library-archive.js';
import { Library } from './library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { ResourceStore, MAX_IMAGE_BYTES, imageReferences } from '../resources/resources.js';
import { hash, jsonBytes } from '../platform/json.js';
import { readJson, within } from '../platform/files.js';

const code = fileURLToPath(new URL('../../../', import.meta.url));
const temporary = path.join(path.dirname(code), '.temp', 'export-image-tests');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
const imageId = hash(png);
const document = { type: 'doc', content: [{ type: 'image', attrs: { assetId: imageId } }] };
function fixture(t) {
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'test-'));
  fs.mkdirSync(path.join(root, 'question-banks')); fs.mkdirSync(path.join(root, 'extensions'));
  t.after(() => { assert.ok(within(temporary, root) && root !== temporary); fs.rmSync(root, { recursive: true, force: true }); });
  const resources = new ResourceStore(root);
  return { root, resources, archive: new LibraryArchive(root, resources) };
}
function bank(root, bytes = png, suffix = 'png', identity = imageId) {
  const directory = path.join(root, 'question-banks/Group/Bank');
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  writeFixture(path.join(directory, 'bank.json'), jsonBytes(document));
  writeFixture(path.join(directory, 'assets', `${identity}.${suffix}`), bytes);
  return path.join(directory, 'bank.json');
}

test('unopened bank export reads all supported local image formats without registering or double-counting resources', t => {
  const { root, archive, resources } = fixture(t);
  const file = bank(root), raw = structuredClone(document);
  const images = [[png, 'png'], [Buffer.from([255, 216, 255, 217]), 'jpg'], [Buffer.from('RIFF0000WEBP'), 'webp'], [Buffer.from('GIF89a0000'), 'gif']];
  for (const [bytes, suffix] of images.slice(1)) {
    const identity = hash(bytes);
    writeFixture(path.join(path.dirname(file), 'assets', `${identity}.${suffix}`), bytes);
    raw.content.push({ type: 'image', attrs: { assetId: identity } });
  }
  raw.content.push(structuredClone(raw.content[0]));
  writeFixture(file, jsonBytes(raw));
  const before = fs.readFileSync(file), destination = path.join(root, '.temp/copy');
  resources.read = () => { throw new Error('Export must use bank-local images'); };
  archive.copyBank(file, destination);
  for (const [bytes, suffix] of images) assert.deepEqual(fs.readFileSync(path.join(destination, 'assets', `${hash(bytes)}.${suffix}`)), bytes);
  assert.equal(archive.copiedBytes, before.length + images.reduce((total, [bytes]) => total + bytes.length, 0));
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(path.join(root, '.state/resources')), false);
});

test('corrupt local image cannot be hidden by a valid global resource with the same ID', t => {
  const { root, archive, resources } = fixture(t), file = bank(root, Buffer.from('damaged'));
  resources.store('image/png', png);
  assert.throws(() => archive.copyBank(file, path.join(root, '.temp/copy')), { code: 'INVALID_LIBRARY_ARCHIVE' });
  assert.deepEqual(fs.readFileSync(path.join(path.dirname(file), 'assets', `${imageId}.png`)), Buffer.from('damaged'));
});

test('local image type and 4 MiB limit remain enforced', t => {
  const { root, archive } = fixture(t), jpeg = Buffer.from([255, 216, 255, 217]);
  const file = bank(root, jpeg, 'png', hash(jpeg));
  const raw = { type: 'image', attrs: { assetId: hash(jpeg) } };
  writeFixture(file, jsonBytes(raw));
  assert.throws(() => archive.copyBank(file, path.join(root, '.temp/type-copy')), { code: 'INVALID_LIBRARY_ARCHIVE' });
  writeFixture(path.join(path.dirname(file), 'assets', `${hash(jpeg)}.png`), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  assert.throws(() => archive.copyBank(file, path.join(root, '.temp/size-copy')), { code: 'INVALID_LIBRARY_ARCHIVE' });
});

test('old standalone bank still exports images held only by the host resource store', t => {
  const { root, archive, resources } = fixture(t);
  resources.store('image/png', png);
  const file = path.join(root, 'question-banks/old/bank.json'), before = jsonBytes(document);
  writeFixture(file, before);
  const destination = path.join(root, '.temp/copy'); archive.copyBank(file, destination);
  assert.deepEqual(fs.readFileSync(path.join(destination, 'assets', `${imageId}.png`)), png);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(archive.copiedBytes, before.length + png.length);
});

test('missing local and global images still fail export', t => {
  const { root, archive } = fixture(t);
  const file = path.join(root, 'question-banks/missing/bank.json'); writeFixture(file, jsonBytes(document));
  assert.throws(() => archive.copyBank(file, path.join(root, '.temp/copy')), { code: 'RESOURCE_NOT_FOUND' });
});

test('fallback images respect expanded byte and entry limits before writing', t => {
  const { root, archive, resources } = fixture(t); resources.store('image/png', png);
  for (const mode of ['bytes', 'entries']) {
    const destination = path.join(root, '.temp', mode); fs.mkdirSync(destination, { recursive: true });
    archive.copiedBytes = mode === 'bytes' ? MAX_EXPANDED : 0;
    archive.copiedEntries = mode === 'entries' ? MAX_ENTRIES : 0;
    assert.throws(() => archive.exportImages(destination, document), { code: 'LIBRARY_ARCHIVE_LIMIT' });
    assert.equal(fs.readdirSync(path.join(destination, 'assets')).length, 0);
  }
});

test('extension example images held in root assets are copied beside nested examples without global registration', t => {
  const { root, archive, resources } = fixture(t), source = path.join(root, 'extensions/Test/choice');
  copyFixture(path.join(code, 'test/fixtures/legacy-extensions/single-choice-1.0.0'), source, { recursive: true });
  const manifest = readJson(path.join(source, 'manifest.json')), raw = readJson(path.join(source, manifest.examples));
  fs.mkdirSync(path.join(source, 'assets')); writeFixture(path.join(source, 'assets', `${imageId}.png`), png);
  fs.mkdirSync(path.join(source, 'examples')); fs.unlinkSync(path.join(source, manifest.examples));
  raw.questions[0].data.stem = document; manifest.examples = 'examples/bank.json';
  writeFixture(path.join(source, manifest.examples), jsonBytes(raw));
  writeFixture(path.join(source, 'manifest.json'), jsonBytes(manifest));
  resources.read = () => { throw new Error('Export must use extension-local images'); };
  const example=readJson(path.join(source,manifest.examples));example.formatVersion=2;example.id='f0000000-0000-4000-8000-000000000001';example.outline=[{items:example.questions.map(q=>({question:q.id}))}];writeFixture(path.join(source,manifest.examples),jsonBytes(example));
  const destination = path.join(root, '.temp/copy'); archive.copyExtension(source, destination, 'extensions/Group/choice');
  assert.deepEqual(fs.readFileSync(path.join(destination, 'examples/assets', `${imageId}.png`)), png);
  assert.equal(fs.existsSync(path.join(root, '.state/resources')), false);
});

for (const formatVersion of [1, 2, 'single']) test(`case ${formatVersion}: freshly imported image bank exports before opening and survives another import`, async t => {
  const source = fixture(t), target = fixture(t), last = fixture(t);
  const extension = path.join(source.root, 'extensions/Test/short-answer');
  copyFixture(path.join(code, 'test/fixtures/legacy-extensions/short-answer-1.3.0'), extension, { recursive: true });
  const raw = readJson(path.join(extension, 'examples.json'));
  const originalImages = imageReferences(raw);
  const replaceImages = value => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'image') value.attrs.assetId = imageId;
    for (const child of Object.values(value)) replaceImages(child);
  };
  assert.ok(originalImages.size); assert.equal(originalImages.has(imageId), false);
  replaceImages(raw);
  raw.id = formatVersion === 1 ? 'image-bank' : '136832c4-69e0-4ef9-9b72-e86ce4317405';
  raw.version = '1.0';
  const file = bank(source.root); writeFixture(file, jsonBytes(raw));
  if (formatVersion === 2) writeFixture(path.join(source.root, 'question-banks/Group/.group.json'), jsonBytes({ schemaVersion: 1, kind: 'bank-group', id: 'ec7a70a3-4f7d-4fa5-b176-d8cb51dd3a07' }));
  makeFormat4Fixture(source.root);
  const engine = await RuleEngine.create(code); engine.validationEnvironment = async () => 'image-export-fixture';
  const libraries = [source, target, last].map(({ root }) => new Library(root, code, engine));
  t.after(() => { for (const library of libraries) library.close(); engine.close(); });
  const exported = await (formatVersion === 'single' ? libraries[0].exportBank('Group/Bank') : libraries[0].exportGroup('Group'));
  let imported;
  try { imported = await libraries[1].importPackage(fs.readFileSync(exported.file)); }
  finally { exported.close(); }
  assert.equal(imported.importedBanks, 1);
  assert.equal(libraries[1].loaded.size, 0);
  assert.throws(() => libraries[1].resources.read(imageId), { code: 'RESOURCE_NOT_FOUND' });
  const installed = imported.catalog.banks[0], bankFile = path.join(target.root, 'question-banks', installed.path, 'bank.json');
  const before = fs.readFileSync(bankFile);
  const unopened = await (formatVersion === 'single' ? libraries[1].exportBank(installed.path) : libraries[1].exportGroup('Group'));
  try {
    assert.equal(libraries[1].loaded.size, 0);
    assert.throws(() => libraries[1].resources.read(imageId), { code: 'RESOURCE_NOT_FOUND' });
    const result = await libraries[2].importPackage(fs.readFileSync(unopened.file));
    const collection = await libraries[2].collection('bank', result.catalog.banks[0].id);
    assert.equal(collection.questions.length, raw.questions.length);
    assert.deepEqual(libraries[2].resources.read(imageId).bytes, png);
  } finally { unopened.close(); }
  assert.deepEqual(fs.readFileSync(bankFile), before);
});
