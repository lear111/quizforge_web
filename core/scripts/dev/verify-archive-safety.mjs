import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import yazl from 'yazl';

const current = fileURLToPath(new URL('../../', import.meta.url));
async function pack(entries) {
  const zip = new yazl.ZipFile(), chunks = []; zip.outputStream.on('data', bytes => chunks.push(bytes)); const ended = once(zip.outputStream, 'end');
  for (const [name, bytes, options] of entries) zip.addBuffer(bytes, name, options);
  zip.end(); await ended; return Buffer.concat(chunks);
}
export async function verifyArchiveSafety(baselineCore) {
  const harmless = 'question-banks/Group/abcd', unsafe = 'question-banks/Group/../a';
  const traversal = await pack([[harmless, Buffer.from('synthetic')]]);
  let offset = 0; while ((offset = traversal.indexOf(harmless, offset)) !== -1) { traversal.write(unsafe, offset); offset += unsafe.length; }
  const cases = [{ name: 'traversal', bytes: traversal, code: 'INVALID_LIBRARY_ARCHIVE', status: 422 },
    { name: 'case-duplicate', bytes: await pack([['question-banks/Group/a', Buffer.from('one')], ['question-banks/Group/A', Buffer.from('two')]]), code: 'INVALID_LIBRARY_ARCHIVE', status: 422 },
    { name: 'oversized', bytes: await pack([['question-banks/Group/large', Buffer.alloc(8 * 1024 * 1024 + 1)]]), code: 'LIBRARY_ARCHIVE_LIMIT', status: 413 }];
  for (const compress of [false, true]) {
    const bytes = await pack([['question-banks/Group/body', Buffer.alloc(128 * 1024, 90), { compress }]]), central = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
    cases.push({ name: 'crc-' + (compress ? 'deflated' : 'stored'), bytes, code: 'INVALID_LIBRARY_ARCHIVE', status: 422 });
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-archive-safety-')), records = [];
  try {
    for (const item of cases) {
      const row = { case: item.name, inputSha256: createHash('sha256').update(item.bytes).digest('hex') };
      for (const [label, core] of [['before', path.resolve(baselineCore)], ['after', current]]) {
        const { LibraryArchive } = await import(pathToFileURL(path.join(core, 'server/host/library/library-archive.js')));
        const { ResourceStore } = await import(pathToFileURL(path.join(core, 'server/host/resources/resources.js')));
        const root = path.join(work, item.name + '-' + label); fs.mkdirSync(root);
        const archive = new LibraryArchive(root, new ResourceStore(root)); let failure = null;
        try { await archive.importPackage(item.bytes, async () => assert.fail('malicious archive reached validation')); } catch (error) { failure = error; }
        assert.ok(failure); assert.equal(failure.code, item.code); assert.equal(failure.status, item.status);
        if (item.name.startsWith('crc-')) assert.equal(failure.message, '压缩包文件校验失败');
        assert.equal(fs.existsSync(path.join(root, 'question-banks')), false); assert.equal(fs.existsSync(path.join(root, 'extensions')), false);
        assert.deepEqual(fs.readdirSync(path.join(root, '.temp')), []);
        row[label] = { code: failure.code, status: failure.status, stagingCleaned: true };
      }
      assert.deepEqual(row.before, row.after); records.push(row);
    }
    return records;
  } finally {
    const resolved = path.resolve(work); assert.equal(path.dirname(resolved), path.resolve(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('qf-archive-safety-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node core/scripts/dev/verify-archive-safety.mjs <baseline-core>');
  console.log(JSON.stringify(await verifyArchiveSafety(process.argv[2]), null, 2));
}
