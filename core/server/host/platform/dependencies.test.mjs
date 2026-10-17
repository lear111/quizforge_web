import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { safeDirectory, within } from './files.js';
import { dependencyDifferences, isSourceCheckout, missingModuleReason, sourceDependencyProblem } from './dependencies.js';
import { copyRuntimeDependencies } from '../../../scripts/build/runtime-dependencies.mjs';

const code = fileURLToPath(new URL('../../../', import.meta.url)), product = path.dirname(code), base = path.join(product, '.temp', 'dependency-check');
const lock = { name: 'fixture', lockfileVersion: 3, packages: {
  '': { name: 'fixture' },
  'node_modules/alpha': { version: '1.0.0', integrity: 'sha512-a' },
  'node_modules/@scope/beta': { version: '2.0.0', integrity: 'sha512-b' },
  'node_modules/alpha/node_modules/gamma': { version: '3.0.0', integrity: 'sha512-c' },
  'node_modules/tester': { version: '1.0.0', integrity: 'sha512-d', dev: true },
  'node_modules/maybe': { version: '1.0.0', integrity: 'sha512-e', optional: true },
  'node_modules/elsewhere': { version: '1.0.0', integrity: 'sha512-f', os: ['aix'] }
} };
function fixture(t) {
  safeDirectory(base, true); const root = fs.mkdtempSync(path.join(base, 'product-'));
  t.after(() => { assert.ok(within(base, root) && root !== base); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function write(root, file, value) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
}
function installed(packages) { return { name: 'fixture', lockfileVersion: 3, packages }; }

test('source checkout compares the lock file with what npm recorded as installed', t => {
  const root = fixture(t); write(root, 'core/package-lock.json', lock);
  assert.equal(isSourceCheckout(root), true);
  assert.deepEqual(dependencyDifferences(root), ['@scope/beta', 'alpha', 'gamma']);
  assert.match(sourceDependencyProblem(root), /^缺少依赖或版本不符：@scope\/beta、alpha、gamma。请在应用根目录运行 npm --prefix core ci 后重新启动。$/);
  const { packages } = lock;
  for (const key of ['node_modules/alpha', 'node_modules/@scope/beta', 'node_modules/alpha/node_modules/gamma', 'node_modules/tester', 'node_modules/maybe']) write(root, 'core/' + key + '/package.json', {});
  write(root, 'core/node_modules/.package-lock.json', installed({ 'node_modules/alpha': packages['node_modules/alpha'], 'node_modules/@scope/beta': { ...packages['node_modules/@scope/beta'], version: '1.9.0' }, 'node_modules/alpha/node_modules/gamma': packages['node_modules/alpha/node_modules/gamma'] }));
  assert.deepEqual(dependencyDifferences(root), ['@scope/beta']);
  assert.deepEqual(dependencyDifferences(root, { includeDev: true }), ['@scope/beta', 'tester']);
  write(root, 'core/node_modules/.package-lock.json', installed({ ...packages, '': undefined }));
  assert.equal(sourceDependencyProblem(root), null);
  fs.rmSync(path.join(root, 'core/node_modules/alpha/node_modules/gamma'), { recursive: true });
  assert.deepEqual(dependencyDifferences(root), ['gamma']);
  write(root, 'core/package-lock.json', '{broken');
  assert.match(sourceDependencyProblem(root), /无法读取 core\/package-lock\.json/);
});

test('preview packages and trees without a lock file are never checked against npm', t => {
  const root = fixture(t);
  assert.equal(sourceDependencyProblem(root), null);
  write(root, 'core/package-lock.json', lock); write(root, 'RELEASE.json', {});
  assert.equal(isSourceCheckout(root), false); assert.equal(sourceDependencyProblem(root), null);
});

test('a failed import is described by package or file name only', () => {
  const missing = (message, code = 'ERR_MODULE_NOT_FOUND') => Object.assign(new Error(message), { code });
  assert.equal(missingModuleReason(missing(String.raw`Cannot find package 'qrcode-generator' imported from C:\Users\someone\app\core\server\x.js`), true),
    '缺少依赖或版本不符：qrcode-generator。请在应用根目录运行 npm --prefix core ci 后重新启动。');
  assert.equal(missingModuleReason(missing("Cannot find package '@scope/pkg' imported from /home/someone/x.js"), false), '缺少运行依赖：@scope/pkg。请重新解压完整预览包。');
  const file = missingModuleReason(missing(String.raw`Cannot find module 'C:\Users\someone\app\core\server\host\gone.js' imported from C:\Users\someone\app\core\server\main.mjs`), false);
  assert.equal(file, '缺少应用文件：gone.js。请重新解压完整预览包。'); assert.doesNotMatch(file, /someone/);
  assert.equal(missingModuleReason(missing('boom', 'EACCES'), true), null);
});

function runMain(root) {
  return spawnSync(process.execPath, [path.join(root, 'core/server/main.mjs'), '--root', root, '--port', '0', '--desktop'], { encoding: 'utf8', windowsHide: true, timeout: 20000, input: '' });
}
function failure(result) {
  const line = result.stdout.split('\n').find(text => text.startsWith('QUIZFORGE_DESKTOP '));
  assert.ok(line, result.stdout + result.stderr);
  const event = JSON.parse(line.slice('QUIZFORGE_DESKTOP '.length));
  assert.equal(event.event, 'failed'); assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('QuizForge could not start: ' + event.reason), result.stderr);
  assert.doesNotMatch(event.reason, /[\\/]{2}|[A-Z]:\\|ERR_MODULE_NOT_FOUND/);
  return event.reason;
}
function copyServer(root) {
  fs.cpSync(path.join(code, 'server'), path.join(root, 'core/server'), { recursive: true, filter: file => !/\.test\./.test(path.basename(file)) });
}

test('desktop backend names a package missing from a source checkout instead of crashing on import', t => {
  // A checkout whose lock gained qrcode-generator before npm ci was run again.
  const root = fixture(t); copyServer(root); copyRuntimeDependencies(product, root);
  const wanted = JSON.parse(fs.readFileSync(path.join(code, 'package-lock.json'), 'utf8'));
  wanted.packages = Object.fromEntries(Object.entries(wanted.packages).filter(([key]) => !key || fs.existsSync(path.join(root, 'core', key, 'package.json'))));
  write(root, 'core/package-lock.json', wanted);
  const record = structuredClone(wanted); delete record.packages['node_modules/qrcode-generator'];
  write(root, 'core/node_modules/.package-lock.json', record);
  fs.rmSync(path.join(root, 'core/node_modules/qrcode-generator'), { recursive: true });
  assert.equal(failure(runMain(root)), '缺少依赖或版本不符：qrcode-generator。请在应用根目录运行 npm --prefix core ci 后重新启动。');
});

test('desktop backend in a preview package reports a removed runtime package without running npm', t => {
  const root = fixture(t); copyServer(root); copyRuntimeDependencies(product, root);
  fs.copyFileSync(path.join(code, 'package-lock.json'), path.join(root, 'core/package-lock.json')); write(root, 'RELEASE.json', {});
  fs.rmSync(path.join(root, 'core/node_modules/qrcode-generator'), { recursive: true });
  assert.equal(failure(runMain(root)), '缺少运行依赖：qrcode-generator。请重新解压完整预览包。');
});
