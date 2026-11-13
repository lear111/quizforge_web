// Isolated follow-up to #102. The HTTP route and its response are unmodified
// in this probe. File-cache probes run after timing samples are collected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { V2Server } from '../../server/host/v2/server.js';
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';

const core = fileURLToPath(new URL('../../', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-overview-'));
const directory = path.join(root, 'question-banks', '基础题型', '单选题展示');
const bankFile = path.join(directory, 'bank.json');
const summary = list => {
  const sorted = list.toSorted((a, b) => a - b);
  return { n: sorted.length, median: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
};
const timings = header => Object.fromEntries(header.split(', ').map(entry => {
  const [key, duration] = entry.split(';dur='); return [key, Number(duration)];
}));

async function countFiles(server, endpoint) {
  const { library } = server, { cache, types } = library;
  const scan = types.scan, resolve = types.resolve, entry = cache.entry, open = fs.openSync, sdk = library.sdk;
  const counts = { scans: 0, installedManifests: 0, manifestRequests: 0, manifestBodyOpens: 0, resolvedTypes: 0, sdkDigests: 0 };
  const isManifest = file => typeof file === 'string' && path.basename(file) === 'manifest.json';
  types.scan = function (...args) { const rows = scan.apply(this, args); counts.scans++; counts.installedManifests += rows.length; return rows; };
  types.resolve = function (...args) { counts.resolvedTypes++; return resolve.apply(this, args); };
  cache.entry = function (file, ...args) { if (isManifest(file)) counts.manifestRequests++; return entry.call(this, file, ...args); };
  fs.openSync = function (file, ...args) { if (isManifest(file)) counts.manifestBodyOpens++; return open.call(this, file, ...args); };
  library.sdk = function (...args) { counts.sdkDigests++; return sdk.apply(this, args); };
  try {
    for (let i = 0; i < 5; i++) {
      const response = await fetch(endpoint);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    return { n: 5, ...counts };
  } finally { types.scan = scan; types.resolve = resolve; cache.entry = entry; fs.openSync = open; library.sdk = sdk; }
}

let server;
try {
  copyBrowserFixture(root);
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8')); bank.title = 'Synthetic A';
  bank.questions['1'].question.stem.content.push({ type: 'image', attrs: { src: 'qf-asset:assets/figure.png', alt: 'synthetic figure' } });
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'assets', 'figure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(bankFile, JSON.stringify(bank));
  const other = path.join(path.dirname(directory), 'other'); fs.cpSync(directory, other, { recursive: true });
  fs.writeFileSync(path.join(other, 'bank.json'), JSON.stringify({ ...bank, title: 'Synthetic B' }));
  server = await new V2Server({ root, codeRoot: core }).start();
  const base = `http://127.0.0.1:${server.port()}/api/v2`;
  const catalog = await (await fetch(base + '/catalog')).json();
  const endpoint = title => `${base}/banks/${catalog.groups.flatMap(group => group.items).find(item => item.title === title).bankId}`;
  const a = endpoint('Synthetic A'), b = endpoint('Synthetic B');
  const open = async url => {
    const start = performance.now(), response = await fetch(url + '/overview');
    const headers = performance.now(), bytes = Buffer.from(await response.arrayBuffer()), parsed = JSON.parse(bytes.toString('utf8'));
    const end = performance.now();
    assert.equal(response.status, 200);
    assert.equal(parsed.initial.question.solution, null);
    const value = response.headers.get('Server-Timing');
    return { headers: headers - start, full: end - start, header: value && timings(value), parsed, bytes };
  };
  await open(a); await open(b);
  const results = {};
  for (const scenario of ['no records', 'saved answer and first-question ink']) {
    if (scenario !== 'no records') {
      const { snapshotId } = (await open(a)).parsed;
      for (const [op, input] of [['answer', { expectedRevision: 0, answer: { selected: 'B' }, answered: true }],
        ['ink', { expectedInkRevision: 0, ink: { strokes: [{ points: [[1, 2], [4, 5]] }] } }]]) {
        const response = await fetch(a + '/questions/1/' + op, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ snapshotId, requestId: 'synthetic-' + op, ...input }) });
        assert.equal(response.status, 200);
        await response.text();
      }
    }
    for (let i = 0; i < 6; i++) { await open(a); await open(b); }
    const rows = { on: [], off: [] };
    let expectedBytes;
    for (let i = 0; i < 60; i++) {
      server.timings = i % 4 === 0 || i % 4 === 3; // Alternate paired order.
      const row = await open(a);
      expectedBytes ??= row.bytes;
      assert.ok(row.bytes.equals(expectedBytes));
      assert.equal(Boolean(row.header), server.timings);
      assert.equal(Boolean(row.parsed.states[0].hasInk), scenario !== 'no records');
      rows[server.timings ? 'on' : 'off'].push(row);
      await open(b);
    }
    const timingKeys = Object.keys(rows.on[0].header);
    const phaseTotal = row => timingKeys.filter(key => key !== 'total').reduce((sum, key) => sum + row.header[key], 0);
    results[scenario] = {
      http: Object.fromEntries(Object.entries(rows).map(([key, list]) => [key, { headers: summary(list.map(r => r.headers)), full: summary(list.map(r => r.full)) }])),
      server: Object.fromEntries(timingKeys.map(key => [key, summary(rows.on.map(row => row.header[key]))])),
      extensionsAndSdk: summary(rows.on.map(({ header }) => header['extension-scan'] + header['extension-resolve'] + header['sdk-digest'])),
      maxRoundingError: Math.max(...rows.on.map(row => Math.abs(phaseTotal(row) - row.header.total))),
      nonServerToHeaders: summary(rows.on.map(row => row.headers - row.header.total))
    };
  }
  const observations = await countFiles(server, a + '/overview');
  console.log(JSON.stringify({ environment: { os: `${os.type()} ${os.release()}`, node: process.version, cpu: os.cpus()[0]?.model }, results, observations }, null, 2));
} finally {
  server?.server.closeAllConnections();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
