// Review #73: synthetic loopback diagnostics only. No real bank or running host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { V2Server } from '../../server/host/v2/server.js';
import { jsonBytes } from '../../server/host/platform/json.js';
const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-ink-save-'));
const stat = values => { const s = [...values].sort((a, b) => a - b); return { n: s.length, median: s[Math.ceil(s.length * .5) - 1], p95: s[Math.ceil(s.length * .95) - 1] }; };
const native = Object.fromEntries(['openSync', 'closeSync', 'writeSync', 'fsyncSync', 'renameSync'].map(key => [key, fs[key]]));
const handles = new Set(); let collecting = false, sample, server;
fs.openSync = function (file, ...args) { const fd = native.openSync.call(this, file, ...args); if (collecting && typeof file === 'string' && file.startsWith(root + path.sep) && path.basename(file).startsWith('.write-')) { handles.add(fd); sample.files++; } return fd; };
fs.closeSync = function (fd) { try { return native.closeSync.call(this, fd); } finally { handles.delete(fd); } };
fs.writeSync = function (fd, ...args) { const start = performance.now(), bytes = native.writeSync.call(this, fd, ...args); if (collecting && handles.has(fd)) { sample.bytes += bytes; sample.fileWrite += performance.now() - start; } return bytes; };
fs.fsyncSync = function (fd) { const start = performance.now(); try { return native.fsyncSync.call(this, fd); } finally { if (collecting && handles.has(fd)) { sample.fsyncs++; sample.fsync += performance.now() - start; } } };
fs.renameSync = function (from, to) { const start = performance.now(); try { return native.renameSync.call(this, from, to); } finally { if (collecting && String(from).startsWith(root + path.sep)) sample.rename += performance.now() - start; } };
try {
  fs.cpSync(path.join(repo, 'examples/v2'), root, { recursive: true });
  const directory = path.join(root, 'question-banks/基础题型/单选题展示'), bank = JSON.parse(fs.readFileSync(path.join(directory, 'bank.json'), 'utf8'));
  bank.outline = [{ title: 'synthetic', items: Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), label: String(i + 1), maxScore: 2 })) }];
  bank.questions = Object.fromEntries(bank.outline[0].items.map(item => [item.id, structuredClone(bank.questions['1'])]));
  fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify(bank));
  server = await new V2Server({ root, codeRoot: core }).start(); const origin = `http://127.0.0.1:${server.port()}`;
  const catalog = await (await fetch(origin + '/api/v2/catalog')).json(), id = catalog.groups[0].items[0].bankId, base = `/api/v2/banks/${id}`;
  const rows = [];
  for (const populated of [false, true]) {
    const opened = await (await fetch(origin + base + '/overview')).json(), snapshot = server.library.opened.get(id), store = server.library.stateStore;
    if (populated) {
      const ink = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, paper: { color: '#ffffff', pattern: 'plain' }, strokes: Array.from({ length: 200 }, (_, i) => ({ id: `pen-${i}`, color: '#334155', width: 3, points: Array.from({ length: 8 }, (_, j) => ({ x: 30 + i % 20 * 24 + j * 2, y: 40 + Math.floor(i / 20) * 22 + j % 3, pressure: .5 })) })) };
      const questions = Object.fromEntries([...snapshot.items.keys()].map(qid => [qid, { ...store.get(snapshot, qid), ink }]));
      store.commit(directory, { formatVersion: 2, questions, historyIndex: [] });
    }
    const samples = [];
    for (let i = 0; i < 32; i++) {
      sample = { files: 0, bytes: 0, fileWrite: 0, fsyncs: 0, fsync: 0, rename: 0 }; collecting = true;
      const started = performance.now();
      const response = await fetch(origin + base + '/questions/1/draft', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: opened.snapshotId, requestId: `${populated ? 'i' : 's'}${String(i).padStart(31, '0')}`, expectedRevision: store.get(snapshot, '1').revision, answer: { selected: i % 2 ? 'A' : 'B' } }) });
      const value = await response.json(); collecting = false;
      assert.equal(response.status, 200, JSON.stringify(value));
      const stages = Object.fromEntries(response.headers.get('Server-Timing').split(', ').map(row => { const [key, duration] = row.split(';dur='); return [key, Number(duration)]; }));
      samples.push({ ...stages, ...sample, client: performance.now() - started });
    }
    const values = samples.slice(2), bytes = jsonBytes(store.load(directory)).length;
    rows.push({ scenario: populated ? '50 questions x 200 strokes x 8 points' : 'small state, no ink', stateBytes: bytes,
      metrics: Object.fromEntries(Object.keys(values[0]).map(key => [key, stat(values.map(row => row[key]))])) });
  }
  const result = { machine: { platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, node: process.version }, rows,
    method: '2 warmups + 30 samples each. Server-Timing exclusive parse/validate+assembly/serialize(state and response)/atomic-write/other. Optional fs wrappers count temporary state-file bytes, fsync and rename without production hooks; no directory fsync in replaceFile. Includes unquantified instrumentation overhead; client is loopback fetch+JSON, not browser. No optimization or storage split.' };
  const output = path.join(repo, '.temp/v2-ink-save.json'); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {
  collecting = false; for (const [key, value] of Object.entries(native)) fs[key] = value;
  server?.server.closeAllConnections(); await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
