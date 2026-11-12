import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectBankFileCounts } from '../../scripts/dev/inspect-bank-file-counts.mjs';

test('anonymous bank counts are read-only; only explicitly allowed bank binding reads occur', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-count-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bank = path.join(root, 'question-banks/private-title'), ext = path.join(root, 'extensions/private-extension');
  fs.mkdirSync(path.join(bank, 'assets'), { recursive: true }); fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(bank, 'bank.json'), JSON.stringify({ title: 'SECRET', extension: { path: 'extensions/private-extension' }, questions: [{ body: 'SECRET', answer: 'SECRET' }] }));
  fs.writeFileSync(path.join(bank, 'assets/image.png'), 'image'); fs.writeFileSync(path.join(ext, 'rules.js'), 'SECRET');
  const before = fs.readFileSync(path.join(bank, 'bank.json')), read = t.mock.method(fs, 'readFileSync');
  for (const method of ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync']) t.mock.method(fs, method, () => { throw new Error('Must not write'); });
  const noRead = inspectBankFileCounts(root); assert.equal(read.mock.callCount(), 0); assert.equal(noRead.summary.bindingUnknown, 1);
  const result = inspectBankFileCounts(root, { readBindings: true });
  assert.equal(read.mock.callCount(), 1); assert.equal(String(read.mock.calls[0].arguments[0]), path.join(bank, 'bank.json'));
  assert.deepEqual(result.rows[0], { index: 1, files: 2, directories: 1, resourceFiles: 1, bytes: before.length + 5, skipped: 0, extensionFiles: 1, bindingUnknown: 0 });
  assert.deepEqual(result.summary, { banks: 1, bindingUnknown: 0, min: 3, median: 3, p90: 3, max: 3, over256: 0, over1000: 0 });
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private-title|private-extension/);
  assert.ok(fs.readFileSync(path.join(bank, 'bank.json')).equals(before));
});
