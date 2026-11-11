import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseJson, jsonBytes, projectJson } from '../../server/host/platform/json.js';

const stateName = /^[a-f0-9]{64}\.json$/i;
const receiptNames = new Set(['receipts', 'finishReceipts', 'restartReceipts', 'completionReceipts', 'editReceipts']);
const historyNames = new Set(['historyRounds', 'history', 'upgradedCompletion']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const categories = ['historyRounds', 'legacyHistory', 'upgradedCompletion', 'receipts', 'ink', 'answerResult', 'other'];

// Project the parent as well: a primitive 1.0 carries its spelling on its parent.
function valueBytes(parent, key) {
  return jsonBytes(projectJson(parent, [String(key)])).length - Buffer.byteLength(JSON.stringify(String(key))) - 3;
}
function discover(root) {
  const files = []; let skippedLinks = 0;
  const add = (parts, scope) => {
    let directory = root;
    for (const part of parts) {
      directory = path.join(directory, part);
      let stat; try { stat = fs.lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (stat.isSymbolicLink()) { skippedLinks++; return; }
      if (!stat.isDirectory()) return;
    }
    for (const name of fs.readdirSync(directory).sort()) {
      if (!stateName.test(name)) continue;
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) { skippedLinks++; continue; }
      if (stat.isFile()) files.push({ file, scope, name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  };
  add(['.state'], 'local'); add(['.development', '.state'], 'development');
  return { files, skippedLinks };
}
function readChecked(file) {
  // O_NOFOLLOW is additional protection where supported. Recheck on Windows too.
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular state');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error('state identity changed');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function metrics(saved, bytes) {
  if (!object(saved) || !object(saved.questions)) throw new Error('not a practice state');
  const states = Object.values(saved.questions).filter(object), parts = Object.fromEntries(categories.map(key => [key, 0]));
  let allReceiptCount = 0, allReceiptBytes = 0, allDraftBytes = 0;
  // Occurrence totals intentionally include historical and receipt-owned copies.
  function occurrences(value) {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (receiptNames.has(key) && Array.isArray(child)) { allReceiptCount += child.length; allReceiptBytes += valueBytes(value, key); }
      if (key === 'draft') allDraftBytes += valueBytes(value, key);
      occurrences(child);
    }
  }
  function partition(value, top = false) {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (top && historyNames.has(key)) parts[key === 'history' ? 'legacyHistory' : key] += valueBytes(value, key);
      else if (receiptNames.has(key) && Array.isArray(child)) parts.receipts += valueBytes(value, key);
      else if (key === 'draft') parts.ink += valueBytes(value, key);
      else if (key === 'answer' || key === 'result') parts.answerResult += valueBytes(value, key);
      else partition(child);
    }
  }
  occurrences(saved); partition(saved, true);
  parts.other = bytes - Object.values(parts).reduce((sum, size) => sum + size, 0);
  if (parts.other < 0) throw new Error('invalid size partition');
  let largestQuestionDraftBytes = 0, mostQuestionReceipts = { count: 0, bytes: 0 };
  for (const state of states) {
    if (state.draft !== null && Object.hasOwn(state, 'draft')) largestQuestionDraftBytes = Math.max(largestQuestionDraftBytes, valueBytes(state, 'draft'));
    if (Array.isArray(state.receipts)) {
      const next = { count: state.receipts.length, bytes: valueBytes(state, 'receipts') };
      if (next.count > mostQuestionReceipts.count || next.count === mostQuestionReceipts.count && next.bytes > mostQuestionReceipts.bytes) mostQuestionReceipts = next;
    }
  }
  return {
    questions: states.length,
    questionsWithRecords: states.filter(state => ['draft', 'submitted'].includes(state.status) || state.answer != null || state.result != null || state.draft != null || state.receipts?.length > 0).length,
    historyRounds: { count: Array.isArray(saved.historyRounds) ? saved.historyRounds.length : 0, bytes: parts.historyRounds },
    legacyHistory: { count: Array.isArray(saved.history) ? saved.history.length : 0, bytes: parts.legacyHistory },
    allReceiptCount, allReceiptBytes, allDraftBytes, largestQuestionDraftBytes, mostQuestionReceipts,
    answerResultBytes: parts.answerResult, otherBytes: parts.other, categoryBytes: parts,
    // This projection has exactly A1's exclusive breakdown when given its v2 seed.
    breakdown: { receipts: parts.receipts, ink: parts.ink, history: parts.historyRounds + parts.legacyHistory + parts.upgradedCompletion, other: parts.answerResult + parts.other },
  };
}
function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b), n = sorted.length;
  return { min: n ? sorted[0] : null, median: n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null,
    p90: n ? sorted[Math.ceil(n * .9) - 1] : null, max: n ? sorted[n - 1] : null };
}
export function inspectStateSizes(dataRoot) {
  const root = path.resolve(dataRoot), rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('invalid data root');
  const discovered = discover(root), rows = [];
  // Complete the before pass for all files before doing the after pass.
  for (const entry of discovered.files) {
    const row = { kind: 'state', scope: entry.scope, file: entry.name, bytes: entry.bytes, modifiedAt: entry.modifiedAt, status: '无法解析', sha256Before: null, sha256After: null, unchanged: false };
    try {
      const bytes = readChecked(entry.file); row.bytes = bytes.length; row.sha256Before = digest(bytes);
      Object.assign(row, metrics(parseJson(bytes), bytes.length), { status: 'ok' });
    } catch { /* Never disclose parse errors, which can contain paths or contents. */ }
    rows.push(row);
  }
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    try { row.sha256After = digest(readChecked(discovered.files[index].file)); row.unchanged = row.sha256Before !== null && row.sha256Before === row.sha256After; } catch { /* Report unavailable verification, continue. */ }
  }
  const after = discover(root), identities = list => list.map(entry => entry.scope + ':' + entry.name).join('\n');
  const totals = Object.fromEntries([...categories, 'unparsed'].map(key => [key, 0]));
  for (const row of rows) if (row.status === 'ok') { for (const key of categories) totals[key] += row.categoryBytes[key]; } else totals.unparsed += row.bytes;
  const totalBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const summary = { kind: 'summary', files: rows.length, parsed: rows.filter(row => row.status === 'ok').length,
    unparsed: rows.filter(row => row.status !== 'ok').length, totalBytes, fileBytes: distribution(rows.map(row => row.bytes)),
    categoryBytes: totals, categoryPercent: Object.fromEntries(Object.entries(totals).map(([key, size]) => [key, totalBytes ? 100 * size / totalBytes : 0])),
    hashesUnchanged: rows.every(row => row.unchanged), fileSetUnchanged: identities(discovered.files) === identities(after.files), skippedLinks: discovered.skippedLinks };
  return { rows, summary };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) { console.error('用法：node core/scripts/dev/inspect-state-sizes.mjs <数据根目录>'); process.exitCode = 1; }
  else try {
    const result = inspectStateSizes(process.argv[2]);
    for (const row of result.rows) console.log(JSON.stringify(row));
    console.log(JSON.stringify(result.summary));
    if (!result.summary.hashesUnchanged || !result.summary.fileSetUnchanged) process.exitCode = 2;
  } catch { console.error('无法读取状态目录；请检查目录和读取权限。'); process.exitCode = 1; }
}
