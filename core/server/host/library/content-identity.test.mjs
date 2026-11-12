import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Library } from './library.js';
import { baselineContentIdentities } from '../../../test/fixtures/k2-content-baseline.mjs';

function fixture(t, images = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-content-')), code = path.join(root, 'code');
  const folder = path.join(root, 'extensions/type'), bank = path.join(root, 'question-banks/group/bank'), assets = path.join(bank, 'assets');
  for (const dir of [folder, assets, path.join(code, 'shared/richtext')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(folder, 'manifest.json'), '{"id":"fixture","n":1.0}');
  fs.writeFileSync(path.join(folder, 'rules.js'), 'rules');
  fs.writeFileSync(path.join(bank, 'bank.json'), '{"questions":[]}');
  fs.writeFileSync(path.join(code, 'shared/richtext/service.json'), '{"n":1.0}');
  for (let i = 0; i < images; i++) fs.writeFileSync(path.join(assets, i + '.png'), 'image-' + i);
  const library = new Library(root, code, {}), scope = { folders: [folder], source: path.join(bank, 'bank.json') };
  t.after(() => { library.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const value = () => library.contentIdentity(scope);
  const baseline = () => baselineContentIdentities.call(library, scope).current;
  return { root, code, folder, bank, assets, library, scope, value, baseline };
}

test('500-image content fingerprint matches baseline, stays warm, and changes for one edited image', t => {
  const f = fixture(t, 500), before = f.value(); assert.equal(before, f.baseline());
  const reads = t.mock.method(fs, 'readFileSync'), stats = t.mock.method(fs, 'lstatSync');
  for (let i = 0; i < 30; i++) {
    reads.mock.resetCalls(); stats.mock.resetCalls(); assert.equal(f.value(), before);
    // JSON manifests/registry deliberately retain direct reads; assets do not.
    assert.equal(reads.mock.calls.filter(c => typeof c.arguments[0] === 'number').length, 2);
    const assets = stats.mock.calls.filter(c => path.dirname(String(c.arguments[0])) === f.assets && String(c.arguments[0]).endsWith('.png'));
    assert.equal(assets.length, 500);
    assert.equal(new Set(assets.map(c => String(c.arguments[0]))).size, 500);
  }
  fs.writeFileSync(path.join(f.assets, '250.png'), 'changed');
  reads.mock.resetCalls(); assert.notEqual(f.value(), before);
  assert.equal(reads.mock.calls.filter(c => typeof c.arguments[0] === 'number').length, 3, 'only one extra body read/hash');
  assert.equal(f.value(), f.baseline());
});

for (const change of ['create', 'delete', 'rename', 'replace-file', 'replace-directory', 'empty-directory', 'mtime-rollback']) test('baseline guarantee: ' + change, t => {
  const f = fixture(t), before = f.value(), image = path.join(f.assets, '0.png');
  if (change === 'create') fs.writeFileSync(path.join(f.assets, 'new.png'), 'new');
  if (change === 'delete') fs.unlinkSync(image);
  if (change === 'rename') fs.renameSync(image, path.join(f.assets, 'renamed.png'));
  if (change === 'replace-file') { fs.unlinkSync(image); fs.writeFileSync(image, 'image-0'); }
  if (change === 'replace-directory') { fs.renameSync(f.assets, f.assets + '-old'); fs.mkdirSync(f.assets); fs.writeFileSync(image, 'image-0'); }
  if (change === 'empty-directory') fs.mkdirSync(path.join(f.assets, 'empty'));
  if (change === 'mtime-rollback') { const time = fs.statSync(image).mtime; fs.writeFileSync(image, 'changed'); fs.utimesSync(image, time, time); }
  assert.equal(f.value(), f.baseline());
  if (['replace-file', 'replace-directory', 'empty-directory'].includes(change)) assert.equal(f.value(), before, 'content identity is not a physical-directory/inode alarm');
  else assert.notEqual(f.value(), before);
});

test('baseline guarantee: linked directories and redirected parents are refused', t => {
  const f = fixture(t), target = path.join(f.root, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, '0.png'), 'image-0');
  f.value(); fs.rmSync(f.assets, { recursive: true });
  fs.symlinkSync(target, f.assets, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(f.value, /Links|Redirected/); assert.throws(f.baseline, /Links|Redirected/);
});

test('baseline guarantee: special files, denied checks and leaf canonical redirection are refused', t => {
  const f = fixture(t), file = path.join(f.assets, '0.png'), native = fs.realpathSync.native;
  f.value();
  const redirect = t.mock.method(fs.realpathSync, 'native', item => String(item) === file ? path.join(f.assets, 'other.png') : native(item));
  assert.throws(f.value, /Redirected/); assert.throws(f.baseline, /Redirected/); redirect.mock.restore();
  const denied = t.mock.method(fs.realpathSync, 'native', item => { if (String(item) === file) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return native(item); });
  assert.throws(f.value, { code: 'EACCES' }); assert.throws(f.baseline, { code: 'EACCES' }); denied.mock.restore();
  const raw = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (item, options) => String(item) === file ? { isSymbolicLink: () => false, isFile: () => false, isDirectory: () => false } : raw(item, options));
  assert.throws(f.value, /special files/); assert.throws(f.baseline, /special files/);
});

test('baseline guarantee: changed-during-read is refused and cold reads retain safe-open flags and fstat', t => {
  const f = fixture(t), file = path.join(f.assets, '0.png'), open = fs.openSync, read = fs.readFileSync;
  let descriptor, changed = false;
  const opens = t.mock.method(fs, 'openSync', (item, flags, ...rest) => {
    const fd = open(item, flags, ...rest); if (String(item) === file) { descriptor = fd; assert.equal(flags, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); } return fd;
  });
  const fstat = t.mock.method(fs, 'fstatSync');
  t.mock.method(fs, 'readFileSync', (...args) => { const result = read(...args); if (args[0] === descriptor && !changed) { changed = true; fs.appendFileSync(file, 'x'); } return result; });
  assert.throws(f.value, /changed while reading/); assert.ok(opens.mock.callCount() > 0); assert.ok(fstat.mock.callCount() > 0);
  f.library.files.clear(); changed = false; descriptor = undefined; assert.throws(f.baseline, /changed while reading/);
});

test('baseline guarantee: uncovered SDK/unbound/media files stay outside, registry and declared local audio stay inside', t => {
  const f = fixture(t), before = f.value();
  fs.mkdirSync(path.join(f.code, 'shared/answer-area'), { recursive: true }); fs.writeFileSync(path.join(f.code, 'shared/answer-area/sdk.js'), 'sdk');
  fs.writeFileSync(path.join(f.code, 'shared/richtext/sdk.js'), 'sdk'); fs.mkdirSync(path.join(f.root, 'extensions/unbound')); fs.writeFileSync(path.join(f.root, 'extensions/unbound/rules.js'), 'unbound');
  fs.mkdirSync(path.join(f.bank, 'media')); fs.writeFileSync(path.join(f.bank, 'media/a.mp3'), 'audio');
  assert.equal(f.value(), before); assert.equal(f.value(), f.baseline());
  fs.writeFileSync(f.scope.source, '{"questions":[],"listening":{"materials":[{"id":"a","title":"a","file":"media/a.mp3"}]}}');
  const withAudio = f.value(); fs.writeFileSync(path.join(f.bank, 'media/a.mp3'), 'changed-audio');
  assert.notEqual(f.value(), withAudio); assert.equal(f.value(), f.baseline());
  const registryBefore = f.value(); fs.writeFileSync(path.join(f.code, 'shared/richtext/service.json'), '{"n":2.0}');
  assert.notEqual(f.value(), registryBefore); assert.equal(f.value(), f.baseline());
});

test('baseline guarantee: 1000-entry traversal limit is unchanged', t => {
  const f = fixture(t, 1000); assert.throws(f.value, /Too many files/); assert.throws(f.baseline, /Too many files/);
});
