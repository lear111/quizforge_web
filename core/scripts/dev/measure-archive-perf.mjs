import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const currentCore = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function treeDigest(root) {
  const value = createHash('sha256');
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(row => row.isFile()).map(row => path.join(row.parentPath, row.name)).sort()) {
    value.update(path.relative(root, entry).replaceAll('\\', '/')); value.update('\0'); value.update(fs.readFileSync(entry));
  }
  return value.digest('hex');
}
async function host(core, root) {
  const { RuleEngine } = await import(pathToFileURL(path.join(core, 'server/host/extensions/rule-engine.js')));
  const { Library } = await import(pathToFileURL(path.join(core, 'server/host/library/library.js')));
  const engine = await RuleEngine.create(core), library = new Library(root, core, engine);
  return { library, close: async () => { library.close(); await engine.close(); } };
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export async function measureArchivePerf(seed, baselineCore, output) {
  seed = path.resolve(seed); baselineCore = path.resolve(baselineCore); output = path.resolve(output);
  const fixture = JSON.parse(fs.readFileSync(path.join(seed, 'archive-perf-fixture.json'), 'utf8'));
  if (fixture.fixture !== 'quizforge-archive-b7a-v1' || fixture.images !== 500 || fixture.audio !== 3) throw new Error('Only the synthetic archive fixture is accepted');
  fs.mkdirSync(output); // Exclusive, never overwrite results or application data.
  const before = treeDigest(seed), work = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-archive-perf-'));
  const fresh = name => { const directory = path.join(work, name); fs.mkdirSync(directory); return directory; };
  const copied = name => { const directory = path.join(work, name); fs.cpSync(seed, directory, { recursive: true }); return directory; };
  try {
    // Common old-format/compression input isolates the import CRC change.
    const preparation = await host(baselineCore, copied('prepare'));
    try { const pack = await preparation.library.exportGroup(fixture.group); try { fs.copyFileSync(pack.file, path.join(output, 'baseline.qbank')); } finally { pack.close(); } }
    finally { await preparation.close(); }
    const input = fs.readFileSync(path.join(output, 'baseline.qbank')), samples = [];
    for (let run = 0; run < 3; run++) for (const label of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const core = label === 'before' ? baselineCore : currentCore;
      const producer = await host(core, copied(label + '-export-' + run)); let exported;
      const row = { run: run + 1, label };
      try {
        const start = performance.now(); exported = await producer.library.exportGroup(fixture.group); row.exportMs = performance.now() - start;
        row.exportBytes = fs.statSync(exported.file).size;
        if (label === 'after' && run === 0) fs.copyFileSync(exported.file, path.join(output, 'new.qbank'));
      } finally { exported?.close(); await producer.close(); }
      const consumer = await host(core, fresh(label + '-import-' + run));
      try {
        const start = performance.now(), imported = await consumer.library.importPackage(input); row.importMs = performance.now() - start;
        if (imported.importedBanks !== 3 || imported.importedExtensions !== 1) throw new Error('Real import did not install the whole fixture');
      } finally { await consumer.close(); }
      samples.push(row); console.error(label + ' run ' + (run + 1) + ' completed');
    }
    const compatibility = [];
    for (const [name, core, archive] of [['new-to-old', baselineCore, 'new.qbank'], ['old-to-new', currentCore, 'baseline.qbank']]) {
      const consumer = await host(core, fresh(name));
      try {
        const imported = await consumer.library.importPackage(fs.readFileSync(path.join(output, archive)));
        if (imported.importedBanks !== 3 || imported.importedExtensions !== 1) throw new Error('Cross-version import incomplete');
        for (const bank of imported.catalog.banks) {
          const collection = await consumer.library.collection('bank', bank.id);
          if (!collection.listening?.materials.length) throw new Error('Listening material lost');
        }
        compatibility.push({ direction: name, banks: imported.importedBanks, extensions: imported.importedExtensions, status: 'passed' });
      } finally { await consumer.close(); }
    }
    const after = treeDigest(seed); if (after !== before) throw new Error('Synthetic seed was modified');
    const result = { fixture, environment: { system: os.version(), release: os.release(), arch: os.arch(), node: process.version, cpu: os.cpus()[0]?.model },
      inputBytes: input.length, inputSha256: hash(input), newSha256: hash(fs.readFileSync(path.join(output, 'new.qbank'))), seedSha256Before: before, seedSha256After: after,
      samples, summary: Object.fromEntries(['before', 'after'].map(label => { const group = samples.filter(row => row.label === label); return [label, { n: group.length, importMedianMs: median(group.map(row => row.importMs)), exportMedianMs: median(group.map(row => row.exportMs)), exportMedianBytes: median(group.map(row => row.exportBytes)) }]; })), compatibility };
    fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(result, null, 2)); return result;
  } finally {
    const resolved = path.resolve(work);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('qf-archive-perf-')) throw new Error('Unsafe synthetic cleanup target');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 5) throw new Error('Usage: node core/scripts/dev/measure-archive-perf.mjs <seed> <baseline-core> <new-results-directory>');
  console.log(JSON.stringify(await measureArchivePerf(...process.argv.slice(2)), null, 2));
}
