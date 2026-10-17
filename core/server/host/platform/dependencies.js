// Startup dependency checks. Only Node built-ins here: this runs before any
// third-party package is imported, so it can explain why one is missing.
import fs from 'node:fs';
import path from 'node:path';

export const REPAIR_COMMAND = 'npm --prefix core ci';

// A source checkout installs from core/package-lock.json; a preview package
// (RELEASE.json) ships a trimmed node_modules and must never run npm.
export function isSourceCheckout(product) {
  return fs.existsSync(path.join(product, 'core/package-lock.json')) && !fs.existsSync(path.join(product, 'RELEASE.json'));
}

// Compares the lock file with npm's record of what is installed
// (node_modules/.package-lock.json) and the package folders. Returns the names
// that are missing or at another version; dev-only packages are skipped unless asked.
export function dependencyDifferences(product, { includeDev = false } = {}) {
  const core = path.join(product, 'core');
  const wanted = JSON.parse(fs.readFileSync(path.join(core, 'package-lock.json'), 'utf8')).packages;
  if (!wanted || typeof wanted !== 'object') throw new Error('core/package-lock.json has no packages');
  // A missing or unreadable record means nothing is known to be installed.
  let installed = {};
  try { installed = JSON.parse(fs.readFileSync(path.join(core, 'node_modules/.package-lock.json'), 'utf8')).packages ?? {}; }
  catch { }
  const names = new Set();
  for (const [key, entry] of Object.entries(wanted)) {
    if (!key || entry.link || (!includeDev && (entry.dev || entry.devOptional))) continue;
    if (entry.os && !entry.os.includes(process.platform)) continue;
    if (entry.cpu && !entry.cpu.includes(process.arch)) continue;
    const present = installed[key];
    if (!present && entry.optional) continue;
    if (!present || present.version !== entry.version || present.integrity !== entry.integrity || !fs.existsSync(path.join(core, key, 'package.json')))
      names.add(key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length));
  }
  return [...names].sort();
}

function listNames(names) {
  return names.slice(0, 5).join('、') + (names.length > 5 ? ' 等 ' + names.length + ' 个' : '');
}

export function dependencyHint(names, source) {
  return source
    ? '缺少依赖或版本不符：' + listNames(names) + '。请在应用根目录运行 ' + REPAIR_COMMAND + ' 后重新启动。'
    : '缺少运行依赖：' + listNames(names) + '。请重新解压完整预览包。';
}

// Readable reason for a failed import, or null when the error is something
// else. Only a package name or a file name is reported, never a full path.
export function missingModuleReason(error, source) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'MODULE_NOT_FOUND') return null;
  const match = /Cannot find (package|module) '([^']+)'/.exec(String(error.message));
  const specifier = match?.[2] ?? '';
  if (match?.[1] === 'package' && /^(@[\w.-]+\/)?[\w.-]+$/.test(specifier)) return dependencyHint([specifier], source);
  const file = path.win32.basename(specifier.replace(/^file:\/+/, ''));
  return (file ? '缺少应用文件：' + file + '。' : '缺少应用文件。') + (source ? '请检查源码是否完整。' : '请重新解压完整预览包。');
}

// Reason the source checkout cannot start, or null when it is ready.
export function sourceDependencyProblem(product) {
  if (!isSourceCheckout(product)) return null;
  let names;
  try { names = dependencyDifferences(product); }
  catch { return '无法读取 core/package-lock.json。请检查源码是否完整，然后在应用根目录运行 ' + REPAIR_COMMAND + '。'; }
  return names.length ? dependencyHint(names, true) : null;
}
