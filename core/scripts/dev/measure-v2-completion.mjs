// Isolated synthetic direct-backend diagnostic; no HTTP/browser time claims.
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { LibrarySnapshots } from '../../server/host/v2/snapshots.js';
import { PracticeState } from '../../server/host/v2/state.js';
import { withSaveTiming, measureSave, saveTimingHeader } from '../../server/host/v2/timing.js';
import { jsonBytes } from '../../server/host/platform/json.js';
import { createReadFixture } from '../../test/fixtures/v2-banks.mjs';
const stat = (values) => {
  values.sort((a, b) => a - b);
  return {
    n: values.length,
    median: values[Math.ceil(values.length * 0.5) - 1],
    p95: values[Math.ceil(values.length * 0.95) - 1],
  };
};
const fixture = createReadFixture({ count: 200 });
try {
  const store = new PracticeState(),
    library = new LibrarySnapshots(fixture.root, fixture.codeRoot, { stateStore: store });
  const bankId = library.catalog().groups[0].items[0].bankId;
  library.open(bankId);
  const snapshot = library.opened.get(bankId),
    questions = {};
  let i = 0;
  for (const [id, item] of snapshot.items) {
    if (i++ < 120) {
      questions[id] = {
        status: item.parts ? { p1: 'answered' } : 'answered',
        answer: { selected: '乙' },
        result: null,
        submissionId: null,
        revision: 1,
        receipts: [],
      };
    }
  }
  const seed = {
    formatVersion: 2,
    questions,
    contentFingerprint: snapshot.contentFingerprint,
    lastQuestionId: '1',
  };
  const samples = [],
    write = store.write;
  let writes = [];
  store.write = (file, bytes) => {
    writes.push(bytes.length);
    return write(file, bytes);
  };
  for (let i = 0; i < 32; i++) {
    store.commit(fixture.directory, seed);
    writes = [];
    const measured = withSaveTiming(true, () => {
      const begin = performance.now(),
        value = measureSave('validate', () =>
          library.finish(bankId, { requestId: 'finish-' + i, snapshotId: snapshot.snapshotId }),
        );
      const backendMs = performance.now() - begin,
        phases = Object.fromEntries(
          saveTimingHeader()
            .split(', ')
            .map((part) => {
              const [key, ms] = part.split(';dur=');
              return [key, Number(ms)];
            }),
        );
      const start = performance.now(),
        body = jsonBytes(value),
        responseEncodeMs = performance.now() - start;
      return {
        backendMs,
        responseEncodeMs,
        responseBytes: body.length,
        stateEncodeMs: phases.serialize,
        stateWriteMs: phases.write,
        filesWritten: writes.length,
        stateBytes: writes.reduce((a, b) => a + b, 0),
      };
    });
    if (i >= 2) {
      samples.push(measured);
    }
  }
  console.log(
    JSON.stringify(
      {
        system: os.release(),
        cpu: os.cpus()[0]?.model,
        node: process.version,
        questions: 200,
        answered: 120,
        warmups: 2,
        backend: stat(samples.map((x) => x.backendMs)),
        stateEncoding: stat(samples.map((x) => x.stateEncodeMs)),
        write: stat(samples.map((x) => x.stateWriteMs)),
        responseEncoding: stat(samples.map((x) => x.responseEncodeMs)),
        filesPerFinish: [...new Set(samples.map((x) => x.filesWritten))],
        stateBytes: stat(samples.map((x) => x.stateBytes)),
        responseBytes: stat(samples.map((x) => x.responseBytes)),
        scope:
          'Direct current library.finish; synthetic 200 items/120 answers, warm snapshot. Actual atomic writes and state/response encoding measured separately; no browser, network, rule execution or real user data. Restart/archiving belongs to the next PR.',
      },
      null,
      2,
    ),
  );
} finally {
  fixture.cleanup();
}
