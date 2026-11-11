import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import yazl from 'yazl';
import yauzl from 'yauzl';
import { LibraryArchive, MAX_FILE } from './library-archive.js';
import { ResourceStore } from '../resources/resources.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-archive-integrity-'));
  t.after(() => { const resolved = path.resolve(root); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('qf-archive-integrity-')); fs.rmSync(resolved, { recursive: true, force: true }); });
  const archive = new LibraryArchive(root, new ResourceStore(root)), staging = path.join(root, 'staging'); fs.mkdirSync(staging);
  return { root, archive, staging };
}
export async function zipBytes(entries) {
  const zip = new yazl.ZipFile(), chunks = []; zip.outputStream.on('data', bytes => chunks.push(bytes)); const ended = once(zip.outputStream, 'end');
  for (const [name, bytes, options] of entries) zip.addBuffer(bytes, name, options);
  zip.end(); await ended; return Buffer.concat(chunks);
}
function put(root, bytes) { const file = path.join(root, 'input.qbank'); fs.writeFileSync(file, bytes); return file; }
for (const compress of [false, true]) {
  test('native CRC verifies rolling chunks and zero-length entries (deflate=' + compress + ')', async t => {
    const f = fixture(t), bytes = Buffer.alloc(1024 * 1024, 90), name = 'question-banks/Group/body.bin';
    const zip = await zipBytes([[name, bytes, { compress }], ['question-banks/Group/empty', Buffer.alloc(0), { compress }]]);
    await f.archive.unzip(put(f.root, zip), f.staging);
    assert.deepEqual(fs.readFileSync(path.join(f.staging, name)), bytes); assert.equal(fs.statSync(path.join(f.staging, 'question-banks/Group/empty')).size, 0);
  });
  test('CRC mismatch still rejects with the original error and message (deflate=' + compress + ')', async t => {
    const f = fixture(t), zip = await zipBytes([['question-banks/Group/body.bin', Buffer.alloc(128 * 1024, 90), { compress }]]);
    const central = zip.readUInt32LE(zip.length - 6); assert.equal(zip.readUInt32LE(central), 0x02014b50);
    zip.writeUInt32LE((zip.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
    await assert.rejects(f.archive.unzip(put(f.root, zip), f.staging), { code: 'INVALID_LIBRARY_ARCHIVE', status: 422, message: '压缩包文件校验失败' });
  });
}
test('export stores only the existing compressed resource suffixes, while WAV, text and unknown formats remain deflated', async t => {
  const f = fixture(t), content = path.join(f.root, 'content'), directory = path.join(content, 'question-banks/Group'); fs.mkdirSync(directory, { recursive: true });
  const stored = ['.PNG', '.jpg', '.jpeg', '.webp', '.gif', '.MP3', '.m4a', '.ogg'];
  const deflated = ['.wav', '.json', '.js', '.css', '.html', '.txt', '.flac', '.aac'];
  for (const suffix of [...stored, ...deflated]) fs.writeFileSync(path.join(directory, 'asset' + suffix), 'Synthetic ZIP method test\n'.repeat(20));
  const file = path.join(f.root, 'output.qbank'); await f.archive.zip(content, file);
  const archive = await yauzl.openPromise(file, { lazyEntries: true }); const seen = new Set();
  try { for await (const entry of archive.eachEntry()) if (!entry.fileName.endsWith('/')) { const suffix = path.extname(entry.fileName); assert.equal(entry.compressionMethod, stored.includes(suffix) ? 0 : 8, entry.fileName); seen.add(suffix); } }
  finally { archive.close(); }
  assert.equal(seen.size, stored.length + deflated.length);
  await f.archive.unzip(file, f.staging);
  for (const suffix of [...stored, ...deflated]) assert.deepEqual(fs.readFileSync(path.join(f.staging, 'question-banks/Group/asset' + suffix)), fs.readFileSync(path.join(directory, 'asset' + suffix)));
});
test('path traversal, duplicate names and oversized entries remain rejected without installing a group', async t => {
  const f = fixture(t), harmless = 'question-banks/Group/abcd', unsafe = 'question-banks/Group/../a'; assert.equal(harmless.length, unsafe.length);
  const traversing = await zipBytes([[harmless, Buffer.from('payload')]]);
  let offset = 0; while ((offset = traversing.indexOf(harmless, offset)) !== -1) { traversing.write(unsafe, offset, 'utf8'); offset += unsafe.length; }
  const duplicate = await zipBytes([['question-banks/Group/a', Buffer.from('one')], ['question-banks/Group/A', Buffer.from('two')]]);
  const large = await zipBytes([['question-banks/Group/large', Buffer.alloc(MAX_FILE + 1)]]);
  for (const [bytes, code, status] of [[traversing, 'INVALID_LIBRARY_ARCHIVE', 422], [duplicate, 'INVALID_LIBRARY_ARCHIVE', 422], [large, 'LIBRARY_ARCHIVE_LIMIT', 413]]) {
    await assert.rejects(f.archive.importPackage(bytes, async () => assert.fail('must reject before validation')), { code, status });
    assert.equal(fs.existsSync(path.join(f.root, 'question-banks')), false); assert.equal(fs.existsSync(path.join(f.root, 'extensions')), false); assert.equal(fs.readdirSync(path.join(f.root, '.temp')).length, 0);
  }
});
