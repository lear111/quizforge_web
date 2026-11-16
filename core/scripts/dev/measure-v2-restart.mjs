// Actual J restart HTTP endpoint, synthetic disposable data only. This does
// not overwrite #176's simulated-archive measurements or use a live service.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { V2Server } from '../../server/v2/app.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import {
  temporaryRoot,
  createArchiveFixture,
  scenarios,
  filesUnder,
} from './v2-archive-fixture.mjs';
import { machine, statistics } from './v2-archive-metrics.mjs';
import { countWrites } from './v2-restart-write-metrics.mjs';

function install(root, scenario) {
  const source = createArchiveFixture(path.join(root, 'source'), scenario);
  const directory = path.join(root, 'question-banks', 'synthetic', scenario.name);
  fs.mkdirSync(directory, { recursive: true });
  const bank = JSON.parse(fs.readFileSync(path.join(source.directory, 'bank.json')));
  // Match the pre-existing fixture's scored part payloads to its outline.
  for (const item of bank.outline[0].items) {
    if (Number(item.id) % 4 === 2) {
      delete item.maxScore;
      item.parts = [
        { id: 'a', maxScore: 1 },
        { id: 'b', maxScore: 1 },
      ];
    }
  }
  fs.writeFileSync(path.join(directory, 'bank.json'), jsonBytes(bank));
  fs.cpSync(source.extensionRoot, path.join(root, 'extensions', 'basic'), { recursive: true });
  return { source, directory };
}

function seed(server, snapshot, fixture) {
  const state = { ...fixture.source.state, contentFingerprint: snapshot.contentFingerprint };
  server.library.stateStore.commit(fixture.directory, state);
  const sourceInk = path.join(fixture.source.inkRoot, 'a'.repeat(64));
  if (fs.existsSync(sourceInk)) {
    fs.cpSync(
      sourceInk,
      path.join(fixture.directory, '.qf-v2', 'practice', 'ink', snapshot.contentFingerprint),
      { recursive: true },
    );
  }
}

function sizes(round) {
  const files = filesUnder(round);
  return { files: files.length, bytes: files.reduce((n, file) => n + fs.statSync(file).size, 0) };
}

async function samples(server, fixture, { warmups, count }) {
  const catalog = server.library.catalog();
  const bankId = catalog.groups[0].items[0].bankId;
  let overview = server.library.open(bankId);
  const rows = [];
  for (let i = 0; i < warmups + count; i++) {
    const snapshot = server.library.opened.get(bankId);
    seed(server, snapshot, fixture);
    const writes = countWrites();
    const start = performance.now();
    let response;
    try {
      response = await fetch(`http://127.0.0.1:${server.port()}/api/v2/banks/${bankId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: `sample-${i}`, snapshotId: overview.snapshotId }),
      });
      overview = await response.json();
    } finally {
      writes.restore();
    }
    const ms = performance.now() - start;
    assert.equal(response.status, 200, JSON.stringify(overview));
    assert.equal(overview.completedAt, null);
    const round = path.join(
      fixture.directory,
      '.qf-v2',
      'rounds',
      server.library.opened.get(bankId).practiceEpoch,
    );
    const size = sizes(round);
    if (i >= warmups) {
      rows.push({ ms, ...size, ...writes.value });
    }
  }
  return {
    latency: statistics(rows.map((row) => row.ms)),
    files: rows[0].files,
    archiveBytes: rows[0].bytes,
    writtenFiles: rows[0].writtenFiles,
    writtenBytes: rows[0].writtenBytes,
    raw: rows,
  };
}

async function run() {
  const report = { machine: machine(), warmups: 5, samples: 30, rows: [], cleanupVerified: false };
  for (const scenario of scenarios) {
    const temporary = temporaryRoot();
    let server;
    try {
      const fixture = install(temporary.root, scenario);
      const codeRoot = path.resolve(import.meta.dirname, '../..');
      server = await new V2Server({ root: temporary.root, codeRoot }).start();
      report.rows.push({
        name: scenario.name,
        questions: 200,
        ...(await samples(server, fixture, { warmups: report.warmups, count: report.samples })),
      });
    } finally {
      await server?.close();
      temporary.cleanup();
      assert.equal(fs.existsSync(temporary.root), false);
    }
  }
  report.cleanupVerified = true;
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv.length !== 2) {
  throw Error('Only generated temporary data is accepted');
}
await run();
