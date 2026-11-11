import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inspectStateSizes } from '../../scripts/dev/inspect-state-sizes.mjs';

const script = fileURLToPath(new URL('../../scripts/dev/inspect-state-sizes.mjs', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-state-inspect-'));
  t.after(() => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('qf-state-inspect-')); fs.rmSync(root, { recursive: true, force: true }); });
  const put = (scope, name, bytes) => { const directory = path.join(root, scope); fs.mkdirSync(directory, { recursive: true }); const file = path.join(directory, name); fs.writeFileSync(file, bytes); return file; };
  return { root, put };
}
function snapshot(root) {
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true }).map(entry => {
    const file = path.join(entry.parentPath, entry.name), stat = fs.statSync(file);
    return [path.relative(root, file), stat.isDirectory() ? 'directory' : [stat.size, stat.mtimeMs, sha(fs.readFileSync(file))]];
  }));
}
test('readonly inspection covers local/development, preserves number spelling, continues past corruption and discloses no contents or paths', t => {
  const f = fixture(t), secret = 'DO_NOT_DISCLOSE_title_answer_username';
  const raw = '{"questions":{"private-id":{"status":"draft","answer":1.0,"result":2e0,"draft":null,"receipts":[]}},"title":"' + secret + '"}';
  const file = f.put('.state', 'a'.repeat(64) + '.json', raw);
  f.put('.development/.state', 'b'.repeat(64) + '.json', '{"questions":{},"history":[{"draft":{"x":1.00},"receipts":[]}],"finishReceipts":[]}');
  f.put('.state', 'c'.repeat(64) + '.json', '{"bad":"' + secret);
  f.put('.state', 'settings.json', secret); // Not a practice file, never parsed.
  const before = snapshot(f.root), run = spawnSync(process.execPath, [script, f.root], { encoding: 'utf8', cwd: os.tmpdir(), windowsHide: true });
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stderr, ''); assert.deepEqual(snapshot(f.root), before);
  const rows = run.stdout.trim().split('\n').map(line => JSON.parse(line)), first = rows[0], summary = rows.at(-1);
  assert.equal(rows.length, 4); assert.equal(first.file, path.basename(file)); assert.equal(first.questions, 1); assert.equal(first.questionsWithRecords, 1);
  assert.equal(first.answerResultBytes, 6, '1.0 and 2e0 must each retain three encoded bytes');
  assert.equal(first.sha256Before, sha(Buffer.from(raw))); assert.equal(first.sha256After, first.sha256Before); assert.equal(first.unchanged, true);
  assert.equal(rows[1].status, '无法解析'); assert.equal(rows[1].unchanged, true); assert.equal(rows[2].scope, 'development');
  assert.equal(summary.files, 3); assert.equal(summary.parsed, 2); assert.equal(summary.unparsed, 1);
  assert.equal(summary.hashesUnchanged, true); assert.equal(summary.fileSetUnchanged, true);
  assert.equal(Object.values(summary.categoryBytes).reduce((a, b) => a + b, 0), summary.totalBytes);
  const sizes = rows.slice(0, -1).map(row => row.bytes).sort((a, b) => a - b);
  assert.deepEqual(summary.fileBytes, { min: sizes[0], median: sizes[1], p90: sizes[2], max: sizes[2] });
  for (const sensitive of [secret, 'private-id', 'settings.json', f.root, os.userInfo().username]) assert.ok(!run.stdout.includes(sensitive), 'must not disclose contents or host identity');
});
test('exclusive categories do not double count historical or receipt-owned drafts and max receipt row is chosen by count', t => {
  const f = fixture(t), current = { answer: { text: 'synthetic' }, result: null, draft: { points: [1] }, receipts: [{ response: { draft: { points: [2, 3] } } }] };
  const saved = { questions: { one: current, two: { receipts: [{}, {}] } }, historyRounds: [{ draft: { points: [4] }, receipts: [{}] }], upgradedCompletion: { draft: null }, finishReceipts: [{}] };
  f.put('.state', 'd'.repeat(64) + '.json', JSON.stringify(saved));
  const { rows: [row] } = inspectStateSizes(f.root);
  assert.equal(row.allReceiptCount, 5); assert.ok(row.allDraftBytes > row.categoryBytes.ink);
  assert.equal(row.categoryBytes.ink, Buffer.byteLength(JSON.stringify(current.draft)));
  assert.deepEqual(row.mostQuestionReceipts, { count: 2, bytes: 7 });
  assert.equal(row.largestQuestionDraftBytes, row.categoryBytes.ink);
  assert.equal(Object.values(row.categoryBytes).reduce((a, b) => a + b, 0), row.bytes);
});
test('empty input creates no files, and invalid roots return generic errors without echoing the argument', t => {
  const f = fixture(t), before = snapshot(f.root), result = inspectStateSizes(f.root);
  assert.equal(result.summary.files, 0); assert.equal(result.summary.hashesUnchanged, true); assert.deepEqual(result.summary.fileBytes, { min: null, median: null, p90: null, max: null });
  assert.deepEqual(snapshot(f.root), before);
  const missing = path.join(f.root, 'PRIVATE_PATH'), run = spawnSync(process.execPath, [script, missing], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 1); assert.equal(run.stdout, ''); assert.doesNotMatch(run.stderr, /PRIVATE_PATH|Error:| at /);
});
