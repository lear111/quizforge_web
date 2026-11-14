// Synthetic loopback diagnostic only. Does not open the caller's data root.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createReadFixture } from '../../test/fixtures/v2-banks.mjs';

const samples = Number(process.argv[2] ?? 30);
if (!Number.isInteger(samples) || samples < 10 || samples > 100) {
  throw new Error('Sample count must be an integer from 10 to 100');
}
const entry = fileURLToPath(new URL('../../server/v2-main.mjs', import.meta.url));
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    n,
    medianMs: Number(
      ((sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2).toFixed(3),
    ),
    p95Ms: Number(sorted[Math.ceil(n * 0.95) - 1].toFixed(3)),
  };
};
const request = async (url, route) => {
  const start = performance.now(),
    response = await fetch(url + route);
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error('Diagnostic request failed: ' + (body.error?.code ?? response.status));
  }
  return { body, elapsed: performance.now() - start };
};
const report = {
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  cpu: os.cpus()[0]?.model,
  samples,
  units: 'ms',
  cases: [],
};
for (const count of [20, 200]) {
  const fixture = createReadFixture({ count });
  const times = { startup: [], firstOverview: [], repeatOverview: [], question: [] };
  try {
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      const child = spawn(
        process.execPath,
        [entry, '--root', fixture.root, '--code-root', fixture.codeRoot, '--port', '0'],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const exited = once(child, 'exit');
      let stderr = '';
      child.stderr.setEncoding('utf8').on('data', (text) => {
        stderr += text;
      });
      try {
        const url = await new Promise((resolve, reject) => {
          let stdout = '';
          const timeout = setTimeout(() => reject(new Error('V2 startup timed out')), 10000);
          const done = (error, value) => {
            clearTimeout(timeout);
            child.stdout.off('data', data);
            child.off('error', failed);
            child.off('exit', failed);
            error ? reject(error) : resolve(value);
          };
          const data = (text) => {
            stdout += text;
            const match = /listening on (http:\/\/127\.0\.0\.1:\d+)\//.exec(stdout);
            if (match) {
              done(null, match[1]);
            }
          };
          const failed = () => done(new Error('V2 process stopped before listening: ' + stderr));
          child.stdout.setEncoding('utf8').on('data', data);
          child.once('error', failed);
          child.once('exit', failed);
        });
        await request(url, '/api/v2/health');
        times.startup.push(performance.now() - start);
        const catalog = (await request(url, '/api/v2/catalog')).body;
        const bankId = catalog.groups[0].items[0].bankId,
          base = '/api/v2/banks/' + bankId;
        // Catalog is a distinct discovery request, outside the overview interval.
        const first = await request(url, base + '/overview');
        times.firstOverview.push(first.elapsed);
        if (first.body.states.length !== count || first.body.initial.question?.questionId !== '1') {
          throw new Error('Invalid overview');
        }
        times.repeatOverview.push((await request(url, base + '/overview')).elapsed);
        const q = await request(url, base + '/questions/2?snapshotId=' + first.body.snapshotId);
        if (q.body.solution !== null || q.body.questionId !== '2') {
          throw new Error('Invalid readonly payload');
        }
        times.question.push(q.elapsed);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
        }
        await exited;
      }
    }
  } finally {
    fixture.cleanup();
  }
  report.cases.push({
    questions: count,
    ...Object.fromEntries(Object.entries(times).map(([name, values]) => [name, summarize(values)])),
  });
}
console.log(JSON.stringify(report, null, 2));
