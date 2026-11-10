import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { perfDraft } from './create-perf-fixture.mjs';

const defaultServer = new URL('../../server/host/http/server.js', import.meta.url);
export function summarizeSamples(samples) {
  if (!samples.length || samples.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid timing samples');
  const sorted = [...samples].sort((a, b) => a - b), n = sorted.length;
  return { n, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2, p95: sorted[Math.ceil(n * .95) - 1] };
}
export function parseServerTiming(header) {
  if (!header) return {};
  if (header.includes('incomplete')) throw Error('Timing interval limit reached; sample is incomplete');
  return Object.fromEntries(header.split(',').map(item => {
    const match = /^\s*([a-z-]+);dur=([0-9.]+)\s*$/.exec(item); if (!match) throw Error('Invalid Server-Timing');
    return [match[1], Number(match[2])];
  }));
}
export async function measurePerf(seed, { runs = 3, timings = true, serverModule = defaultServer, counts = { switch: 20, draft: 20, whiteboard: 20, submit: 10 }, onProgress = () => {} } = {}) {
  const serverUrl = serverModule instanceof URL ? serverModule : pathToFileURL(path.resolve(serverModule));
  if (serverUrl.protocol !== 'file:') throw Error('Only a local server module is accepted');
  const { QuizForgeServer } = await import(serverUrl.href), codeRoot = fileURLToPath(new URL('../../../', serverUrl));
  const root = path.resolve(seed), fixture = JSON.parse(fs.readFileSync(path.join(root, 'perf-fixture.json'), 'utf8'));
  if (fixture.fixture !== 'quizforge-perf-a1-v1') throw Error('Only the generated synthetic fixture is accepted');
  if (!Number.isInteger(runs) || runs < 1 || runs > 30 || Object.values(counts).some(n => !Number.isInteger(n) || n < 1 || n > 20)) throw Error('Invalid benchmark counts');
  const samples = [];
  for (let run = 0; run < runs; run++) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-a1-measure-'));
    let service;
    try {
      for (const item of ['extensions', 'question-banks', '.state']) fs.cpSync(path.join(root, item), path.join(temporary, item), { recursive: true, errorOnExist: true, force: false });
      service = await QuizForgeServer.create({ root: temporary, codeRoot, port: 0, timings, tailscale: { read: async () => ({ state: 'missing' }) }, hub: { fetchImpl: async () => { throw Error('Network disabled for benchmark'); } } });
      await service.start();
      const base = `http://127.0.0.1:${service.port()}/api/collections/bank/perf-bank`, revisions = new Map();
      const request = async (operation, uri, body) => {
        const start = performance.now();
        const response = await fetch(base + uri, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000) });
        const bytes = await response.arrayBuffer(), elapsed = performance.now() - start, data = JSON.parse(Buffer.from(bytes).toString());
        if (!response.ok) throw Error(operation + ': ' + response.status + ' ' + data.error?.code);
        samples.push({ run: run + 1, operation, elapsed, bytes: bytes.byteLength, phases: parseServerTiming(response.headers.get('server-timing')) });
        return data;
      };
      const opened = await request('open', '');
      onProgress({ run: run + 1, operation: 'open' });
      for (const [id, state] of Object.entries(opened.states)) revisions.set(id, state.revision);
      for (let i = 0; i < counts.switch; i++) await request('switch', '/questions/' + opened.questions[i].id);
      onProgress({ run: run + 1, operation: 'switch' });
      for (const operation of ['draft', 'whiteboard', 'submit']) {
        for (let i = 0; i < counts[operation]; i++) {
        const id = opened.questions[i].id, result = await request(operation, '/questions/' + id + '/actions', {
          action: operation, requestId: `perf-${operation}-${run}-${i}`, revision: revisions.get(id),
          data: operation === 'whiteboard' ? { draft: perfDraft(120 + i) } : { answer: { value: 'A' } }
        }); revisions.set(id, result.state.revision);
        }
        onProgress({ run: run + 1, operation });
      }
    } finally {
      await service?.close();
      // Only this invocation's mkdtemp directory is removed, never the seed.
      if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('qf-a1-measure-')) fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
  const summary = Object.fromEntries(['open', 'switch', 'draft', 'whiteboard', 'submit'].map(operation => {
    const selected = samples.filter(sample => sample.operation === operation);
    return [operation, { elapsed: summarizeSamples(selected.map(row => row.elapsed)),
      phases: Object.fromEntries(Object.keys(selected[0].phases).map(phase => [phase, summarizeSamples(selected.map(row => row.phases[phase]))])) }];
  }));
  return { fixture, timings, runs, node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, samples, summary };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [root, runs = '3', mode = 'on', serverModule] = process.argv.slice(2);
  if (!root || !['on', 'off'].includes(mode)) throw Error('Usage: node core/scripts/dev/measure-perf.mjs <fixture-directory> [runs=3] [on|off] [local-server-module]');
  console.log(JSON.stringify(await measurePerf(root, { runs: Number(runs), timings: mode === 'on', serverModule, onProgress: row => console.error(`Run ${row.run}: ${row.operation} complete`) }), null, 2));
}
