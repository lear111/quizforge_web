import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileCache, statIdentity } from './file-cache.js';
import { DigestCache, digestEntryBytes } from './digest-cache.js';
import { walkEntries, checkedStat } from './files.js';

function fixture(t, count = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-digest-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (let i = 0; i < count; i++) fs.writeFileSync(path.join(root, String(i).padStart(4, '0') + '.png'), 'synthetic-' + i);
  return root;
}
function scan(cache, root) {
  return walkEntries(root).filter(({ stat }) => stat.isFile()).map(({ file, stat }) => cache.hash(file, 1024, stat));
}

test('500 files stay warm for 30 scans; one changed file alone is read again', t => {
  const root = fixture(t, 500), cache = new FileCache();
  const first = scan(cache, root), reads = t.mock.method(fs, 'readFileSync'), stats = t.mock.method(fs, 'lstatSync');
  for (let i = 0; i < 30; i++) {
    reads.mock.resetCalls(); stats.mock.resetCalls();
    assert.deepEqual(scan(cache, root), first);
    assert.equal(reads.mock.callCount(), 0, 'no file bytes read or rehashed on a warm scan');
    const counts = new Map();
    for (const { arguments: [file] } of stats.mock.calls) counts.set(String(file), (counts.get(String(file)) ?? 0) + 1);
    for (const count of counts.values()) assert.equal(count, 1, 'each observed entry has one lstat');
  }
  fs.writeFileSync(path.join(root, '0250.png'), 'different'); reads.mock.resetCalls();
  const changed = scan(cache, root);
  assert.equal(reads.mock.callCount(), 1);
  assert.equal(changed.filter((hash, i) => hash !== first[i]).length, 1);
  assert.ok(cache.bytes <= 32 * 1024 * 1024); assert.ok(cache.entries.size <= 256);
});

test('digest admission is bounded and deterministic without cyclic full rescans', t => {
  const root = fixture(t, 7), cache = new FileCache({ count: 1, digestCount: 4, digestBytes: 4096 });
  const expected = scan(cache, root), reads = t.mock.method(fs, 'readFileSync');
  for (let i = 0; i < 5; i++) {
    reads.mock.resetCalls(); assert.deepEqual(scan(cache, root), expected);
    assert.equal(reads.mock.callCount(), 3, 'only the uncached tail is rehashed, never all seven files');
    assert.deepEqual([...cache.digests.entries.keys()].sort(), fs.readdirSync(root).slice(0, 4).map(name => path.join(root, name)));
    assert.equal(cache.digests.entries.size, 4); assert.ok(cache.digests.bytes <= 4096);
  }
  const tiny = new FileCache({ digestCount: 4, digestBytes: 1 });
  scan(tiny, root); assert.equal(tiny.digests.entries.size, 0); assert.equal(tiny.digests.bytes, 0);
  cache.clear(); assert.equal(cache.digests.entries.size, 0); assert.equal(cache.bytes, 0);
});

test('digest hits retain size limits and checked paths; cache is not a stale-stat API', t => {
  const root = fixture(t, 1), file = path.join(root, '0000.png'), cache = new FileCache();
  cache.hash(file); assert.throws(() => cache.hash(file, 1), /size limit/);
  const time = fs.statSync(file).mtime, before = cache.hash(file);
  fs.writeFileSync(file, 'same-size!!'); fs.utimesSync(file, time, time);
  assert.notEqual(cache.hash(file), before, 'ctime/other identity fields cover mtime rollback');
  fs.unlinkSync(file); assert.throws(() => cache.hash(file));
  fs.mkdirSync(file); assert.throws(() => cache.hash(file), /regular file/);
  const observed = fs.lstatSync(file, { bigint: true });
  t.mock.method(fs.realpathSync, 'native', () => path.join(root, 'redirected'));
  assert.throws(() => checkedStat(file, { observed }), /Redirected paths/);
});

test('all six identity fields participate and byte-budget eviction retains a deterministic prefix', () => {
  const stat = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n, birthtimeNs: 6n, isFile: () => true };
  const identity = statIdentity(stat);
  for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.notEqual(statIdentity({ ...stat, [field]: stat[field] + 1n }), identity);
  const size = digestEntryBytes('a', identity, 'hash'), cache = new DigestCache({ count: 100, bytes: size * 2 });
  for (const key of ['d', 'c', 'b', 'a']) { cache.set(key, identity, 'hash'); assert.ok(cache.bytes <= cache.limit); }
  assert.deepEqual([...cache.entries.keys()].sort(), ['a', 'b']);
  for (let scan = 0; scan < 5; scan++) for (const key of ['a', 'b', 'c', 'd']) {
    if (cache.get(key, identity) === null) cache.set(key, identity, 'hash');
    assert.ok(cache.bytes <= cache.limit);
  }
  assert.deepEqual([...cache.entries.keys()].sort(), ['a', 'b']);
});
