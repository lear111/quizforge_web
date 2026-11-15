import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { replaceFile } from '../../server/host/platform/files.js';
import { jsonBytes, parseJson } from '../../server/host/platform/json.js';
import { filesUnder } from './v2-archive-fixture.mjs';

export function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

export function measure(action) {
  const start = performance.now();
  const value = action();
  return { ms: performance.now() - start, value };
}

const nativeBytes = (state) => Buffer.from(JSON.stringify(state), 'utf8');

export function encodingSamples(state, { warmups, samples }) {
  const rows = [],
    equal = jsonBytes(state).equals(nativeBytes(state));
  for (let index = 0; index < warmups + samples; index++) {
    const row = {};
    for (const name of index % 2 ? ['native', 'custom'] : ['custom', 'native']) {
      const encoded = measure(() => (name === 'native' ? nativeBytes(state) : jsonBytes(state)));
      row[name] = encoded.ms;
      row[name + 'Bytes'] = encoded.value.length;
    }
    if (index >= warmups) {
      rows.push(row);
    }
  }
  return {
    equal,
    raw: rows,
    custom: statistics(rows.map((r) => r.custom)),
    native: statistics(rows.map((r) => r.native)),
  };
}

export function numericComparison() {
  const input = '{"float":1.0,"exponent":1e7,"integer":9007199254740993,"zero":-0.0}';
  const value = parseJson(input),
    custom = jsonBytes(value),
    native = nativeBytes(value);
  return {
    input,
    custom: custom.toString(),
    native: native.toString(),
    equal: custom.equals(native),
  };
}

export function archiveSample(fixture, destination) {
  const start = performance.now();
  const setup = measure(() => fs.mkdirSync(destination));
  const encode = measure(() => jsonBytes(fixture.state));
  const atomic = measure(() => replaceFile(path.join(destination, 'state.json'), encode.value));
  const bank = measure(() =>
    fs.copyFileSync(path.join(fixture.directory, 'bank.json'), path.join(destination, 'bank.json')),
  );
  const extensions = measure(() =>
    fs.cpSync(fixture.extensionRoot, path.join(destination, 'extensions'), { recursive: true }),
  );
  const ink = measure(() =>
    fs.cpSync(fixture.inkRoot, path.join(destination, 'ink'), { recursive: true }),
  );
  const total = performance.now() - start;
  const row = {
    setup: setup.ms,
    encode: encode.ms,
    atomic: atomic.ms,
    bank: bank.ms,
    extensions: extensions.ms,
    ink: ink.ms,
  };
  return { ...row, other: total - Object.values(row).reduce((sum, ms) => sum + ms, 0), total };
}

function verifyCopy(fixture, destination, expectedBytes) {
  assert.ok(fs.readFileSync(path.join(destination, 'state.json')).equals(jsonBytes(fixture.state)));
  for (const relative of ['bank.json', 'extensions', 'ink']) {
    const from = path.join(fixture.directory, relative === 'ink' ? '.qf-v2/ink' : relative);
    const sources = fs.statSync(from).isDirectory() ? filesUnder(from) : [from];
    for (const source of sources) {
      const target = path.join(destination, relative, path.relative(from, source));
      assert.ok(fs.readFileSync(source).equals(fs.readFileSync(target)));
    }
  }
  const actual = filesUnder(destination).reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.equal(actual, expectedBytes);
}

export function archiveSamples(fixture, root, options, size) {
  const rows = [];
  const expectedBytes = size.stateBytes + size.bankBytes + size.extensionBytes + size.inkBytes;
  for (let index = 0; index < options.warmups + options.samples; index++) {
    const destination = path.join(root, `archive-${index}`);
    const row = archiveSample(fixture, destination);
    if (index >= options.warmups) {
      rows.push(row);
    }
    // Verification and cleanup are outside all timed intervals.
    if (index === options.warmups) {
      verifyCopy(fixture, destination, expectedBytes);
    }
    fs.rmSync(destination, { recursive: true });
  }
  return {
    logicalBytesWritten: expectedBytes,
    filesWritten: 2 + size.extensionFiles + size.inkFiles,
    stages: Object.fromEntries(
      Object.keys(rows[0]).map((name) => [name, statistics(rows.map((row) => row[name]))]),
    ),
    raw: rows,
  };
}

export function atomicSamples(state, root, options) {
  const bytes = jsonBytes(state),
    file = path.join(root, 'atomic-state.json'),
    rows = [];
  for (let index = 0; index < options.warmups + options.samples; index++) {
    const duration = measure(() => replaceFile(file, bytes)).ms;
    if (index >= options.warmups) {
      rows.push(duration);
    }
  }
  assert.ok(fs.readFileSync(file).equals(bytes));
  fs.unlinkSync(file);
  return { ...statistics(rows), raw: rows, bytes: bytes.length };
}

export function machine() {
  return {
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    arch: process.arch,
    os: `${os.type()} ${os.release()} ${os.version()}`,
    node: process.version,
    totalMemoryBytes: os.totalmem(),
    timestamp: new Date().toISOString(),
  };
}
