import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// No host imports: do not start a service, load a bank, migrate, or create files.
// Counts use readdir/lstat only. Explicit --read-bindings permits bank.json to
// be parsed solely to select extension.path; no other content is used/output.
export function inspectBankFileCounts(root, { readBindings = false } = {}) {
  root = path.resolve(root);
  const base = path.join(root, 'question-banks'), extensions = path.join(root, 'extensions');
  function normal(item, directory = false) {
    const stat = fs.lstatSync(item);
    if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isDirectory() || stat.isFile())) throw new Error('Uncountable');
    return stat;
  }
  normal(root, true); normal(base, true);
  const banks = [];
  function discover(directory) {
    const names = fs.readdirSync(directory).sort();
    if (names.includes('bank.json') && normal(path.join(directory, 'bank.json')).isFile()) banks.push(directory);
    for (const name of names) { const child = path.join(directory, name), stat = fs.lstatSync(child); if (stat.isDirectory() && !stat.isSymbolicLink()) discover(child); }
  }
  discover(base);
  function count(directory) {
    const result = { files: 0, directories: 0, resourceFiles: 0, bytes: 0, skipped: 0 };
    function visit(item, resource = false, first = false) {
      const stat = fs.lstatSync(item);
      if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) { result.skipped++; return; }
      if (stat.isFile()) { result.files++; result.bytes += stat.size; if (resource) result.resourceFiles++; return; }
      if (!first) result.directories++;
      for (const name of fs.readdirSync(item).sort()) visit(path.join(item, name), resource || ['assets', 'media', 'resources'].includes(name));
    }
    visit(directory, false, true); return result;
  }
  function boundFiles(directory) {
    if (!readBindings) return null;
    const raw = JSON.parse(fs.readFileSync(path.join(directory, 'bank.json'), 'utf8')), references = new Set();
    for (const question of raw.questions ?? []) {
      const reference = Object.hasOwn(question, 'extension') ? question.extension : raw.extension;
      if (typeof reference?.path !== 'string' || reference.path.includes('\\') || reference.path.includes(':') || reference.path.includes('\0')) return null;
      const target = path.resolve(root, reference.path), relative = path.relative(extensions, target);
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return null;
      // Every ancestor is lstat-checked: never follow a linked parent.
      let cursor = extensions; normal(cursor, true);
      for (const part of relative.split(path.sep)) { cursor = path.join(cursor, part); normal(cursor, true); }
      references.add(target);
    }
    return [...references].reduce((total, target) => total + count(target).files, 0);
  }
  const rows = banks.map((directory, index) => {
    const sizes = count(directory); let extensionFiles = null;
    try { extensionFiles = boundFiles(directory); } catch { /* Generic numeric status, no path or parser message. */ }
    return { index: index + 1, ...sizes, extensionFiles: extensionFiles ?? 0, bindingUnknown: Number(extensionFiles === null) };
  });
  const totals = rows.filter(row => !row.bindingUnknown).map(row => row.files + row.extensionFiles).sort((a, b) => a - b);
  const middle = totals.length ? (totals[Math.floor((totals.length - 1) / 2)] + totals[Math.floor(totals.length / 2)]) / 2 : 0;
  return { rows, summary: { banks: rows.length, bindingUnknown: rows.filter(row => row.bindingUnknown).length, min: totals[0] ?? 0, median: middle, p90: totals[Math.max(0, Math.ceil(totals.length * .9) - 1)] ?? 0, max: totals.at(-1) ?? 0, over256: totals.filter(n => n > 256).length, over1000: totals.filter(n => n > 1000).length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), readBindings = args.includes('--read-bindings'), roots = args.filter(arg => arg !== '--read-bindings');
    if (roots.length !== 1) throw new Error('Arguments');
    const result = inspectBankFileCounts(roots[0], { readBindings });
    for (const row of result.rows) console.log(JSON.stringify(row));
    console.log(JSON.stringify(result.summary));
  } catch { console.error('{"error":1}'); process.exitCode = 1; }
}
