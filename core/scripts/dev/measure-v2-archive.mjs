// Run from any directory; no input data-root or live service is accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  temporaryRoot,
  scenarios,
  createArchiveFixture,
  inventory,
  sourceHashes,
} from './v2-archive-fixture.mjs';
import {
  machine,
  encodingSamples,
  atomicSamples,
  archiveSamples,
  numericComparison,
} from './v2-archive-metrics.mjs';

export function runArchiveMeasurement({ warmups = 5, samples = 30 } = {}) {
  assert.ok(Number.isInteger(warmups) && warmups >= 1);
  assert.ok(Number.isInteger(samples) && samples >= 1);
  const temporary = temporaryRoot();
  const report = {
    machine: machine(),
    options: { warmups, samples },
    rows: [],
    numericComparison: numericComparison(),
    cleanupVerified: false,
  };
  try {
    // Three different bank.json files and three used extension directories per bank.
    for (const scenario of scenarios) {
      const fixture = createArchiveFixture(temporary.root, scenario);
      const original = sourceHashes(fixture),
        size = inventory(fixture);
      const encoding = encodingSamples(fixture.state, report.options);
      const atomic = atomicSamples(fixture.state, temporary.root, report.options);
      const archive = archiveSamples(fixture, temporary.root, report.options, size);
      assert.deepEqual(sourceHashes(fixture), original);
      report.rows.push({
        name: scenario.name,
        size,
        encoding,
        atomic,
        archive,
        sourceHashesUnchanged: true,
      });
    }
  } finally {
    temporary.cleanup();
    report.cleanupVerified = !fs.existsSync(temporary.root);
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    throw new Error('No arguments accepted; only generated temporary data is measured');
  }
  console.log(JSON.stringify(runArchiveMeasurement(), null, 2));
}
