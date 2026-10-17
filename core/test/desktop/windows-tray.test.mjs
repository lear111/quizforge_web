import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { copyRuntimeDependencies } from '../../scripts/build/runtime-dependencies.mjs';

const run = promisify(execFile), product = fileURLToPath(new URL('../../../', import.meta.url));
const supported = process.platform === 'win32' && process.arch === 'x64';
let work, executable;
before(async () => {
  if (!supported) return;
  fs.mkdirSync(path.join(product, '.temp'), { recursive: true });
  work = fs.mkdtempSync(path.join(product, '.temp', 'tray-tests-')); executable = path.join(work, 'QuizForge.exe');
  const source = path.join(product, 'core/desktop/windows');
  await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:winexe', '/platform:x64', '/utf8output', '/out:' + executable,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll',
    ...fs.readdirSync(source).filter(name => name.endsWith('.cs')).map(name => path.join(source, name))
  ], { windowsHide: true });
});
after(() => {
  if (work) { assert.equal(path.dirname(work), path.join(product, '.temp')); fs.rmSync(work, { recursive: true, force: true }); }
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(work, "应用 空格'"));
  fs.copyFileSync(executable, path.join(root, 'QuizForge.exe'));
  for (const directory of ['server', 'web', 'shared']) fs.cpSync(path.join(product, 'core', directory), path.join(root, 'core', directory), { recursive: true, filter: file => !/\.test\./.test(path.basename(file)) });
  fs.copyFileSync(path.join(product, 'core/package.json'), path.join(root, 'core/package.json'));
  copyRuntimeDependencies(product, root);
  fs.mkdirSync(path.join(root, 'runtime')); fs.copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
  fs.mkdirSync(path.join(root, 'question-banks'));
  fs.cpSync(path.join(product, 'core/test/fixtures/legacy-extensions/single-choice-1.0.0'), path.join(root, 'extensions/choice'), { recursive: true });
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'extensions/choice/examples.json'))); raw.id = 'tray-bank';
  fs.writeFileSync(path.join(root, 'question-banks/bank.json'), JSON.stringify(raw));
  const command = async mode => JSON.parse((await run(path.join(root, 'QuizForge.exe'), ['--root', root, mode], { windowsHide: true, timeout: 10000, env: { ...process.env, PATH: '' } })).stdout);
  const start = (port = 0) => {
    const child = spawn(path.join(root, 'QuizForge.exe'), ['--root', root, '--port', String(port), '--no-browser'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '' } });
    const exit = once(child, 'exit');
    let errors = ''; child.stderr.on('data', chunk => errors += chunk);
    t.after(async () => {
      if (child.exitCode == null && child.signalCode == null) { try { await command('--quit'); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 8000))]); } catch {} }
      if (child.exitCode == null && child.signalCode == null) { child.kill(); await exit; }
    });
    return { child, exit, errors: () => errors };
  };
  return { root, raw, command, start };
}
async function waitFor(command, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout; let latest, lastError;
  while (Date.now() < deadline) {
    try { latest = await command('--status'); if (predicate(latest)) return latest; } catch (error) { lastError = { message: error.message, stdout: error.stdout, stderr: error.stderr }; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Tray state did not settle: ' + JSON.stringify({ latest, lastError }));
}
async function gone(pid) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Owned background service remained alive: ' + pid);
}

test('Windows EXE uses bundled Node without PATH, opens after ready, reuses one tray and exits with its service', { skip: !supported, timeout: 60000 }, async t => {
  const { root, raw, command, start } = fixture(t), owner = start();
  const ready = await waitFor(command, status => status.state === '运行中');
  assert.equal(ready.launcherPid, owner.child.pid); assert.equal(ready.browserOpenRequests, 1);
  assert.equal((await fetch(ready.url + 'api/health')).status, 200);
  const prefix = ready.url + 'api/collections/bank/tray-bank';
  assert.equal((await fetch(prefix)).status, 200);
  const question = prefix + '/questions/' + raw.questions[0].id;
  const initial = await (await fetch(question)).json();
  const saved = await fetch(question + '/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', requestId: 'native-tray-draft', revision: initial.state.revision, data: { answer: { selectedOptionId: 'B' } } }) });
  assert.equal(saved.status, 200);
  const duplicate = await command('--no-browser');
  assert.equal(duplicate.launcherPid, ready.launcherPid); assert.equal(duplicate.servicePid, ready.servicePid); assert.equal(duplicate.browserOpenRequests, 2);
  await command('--quit'); await owner.exit; assert.equal(owner.child.exitCode, 0, owner.errors());
  await gone(ready.servicePid); assert.equal(fs.existsSync(path.join(root, '.state/host.lock')), false);
  const restarted = start(), again = await waitFor(command, status => status.state === '运行中');
  const recovered = await (await fetch(again.url + 'api/collections/bank/tray-bank/questions/' + raw.questions[0].id)).json();
  assert.deepEqual(recovered.state.answer, { selectedOptionId: 'B' });
  await command('--quit'); await restarted.exit; await gone(again.servicePid);
});

test('Windows tray shutdown while starting does not leave a service process', { skip: !supported, timeout: 40000 }, async t => {
  const { root, command, start } = fixture(t), owner = start();
  await command('--quit'); await owner.exit; assert.equal(owner.child.exitCode, 0, owner.errors());
  assert.equal(fs.existsSync(path.join(root, '.state/host.lock')), false);
});

test('Windows tray crash reaps its owned service; a fresh launcher recovers a stale host lock', { skip: !supported, timeout: 60000 }, async t => {
  const { command, start } = fixture(t), owner = start();
  const ready = await waitFor(command, status => status.state === '运行中');
  owner.child.kill(); await owner.exit; await gone(ready.servicePid);
  const recovered = start(), next = await waitFor(command, status => status.state === '运行中');
  assert.notEqual(next.servicePid, ready.servicePid);
  await command('--quit'); await recovered.exit; await gone(next.servicePid);
});

test('Windows tray reports a stopped backend rather than claiming the service is running', { skip: !supported, timeout: 45000 }, async t => {
  const { command, start } = fixture(t), owner = start();
  const ready = await waitFor(command, status => status.state === '运行中');
  process.kill(ready.servicePid);
  await waitFor(command, status => status.state === '服务已停止');
  await command('--quit'); await owner.exit;
});

test('Windows tray port conflict and a foreign live root lock never stop the existing owner', { skip: !supported, timeout: 60000 }, async t => {
  const blocker = net.createServer(socket => socket.end()); await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const first = fixture(t), owner = first.start(blocker.address().port);
  let failure;
  try { failure = await waitFor(first.command, status => status.state === '启动失败'); }
  catch (error) { assert.fail(error.message + '\nlauncher: ' + JSON.stringify({ exit: owner.child.exitCode, signal: owner.child.signalCode, errors: owner.errors() })); }
  assert.match(failure.detail, /占用/); assert.equal(blocker.listening, true);
  await first.command('--quit'); await owner.exit;
  const second = fixture(t); fs.mkdirSync(path.join(second.root, '.state'));
  const file = path.join(second.root, '.state/host.lock'), lock = JSON.stringify({ pid: process.pid, nonce: 'existing-owner' }); fs.writeFileSync(file, lock);
  const foreign = second.start(); await waitFor(second.command, status => status.state === '启动失败');
  assert.equal(fs.readFileSync(file, 'utf8'), lock);
  await second.command('--quit'); await foreign.exit; assert.equal(fs.readFileSync(file, 'utf8'), lock);
});

test('Windows tray names a stale source dependency and the repair command instead of only reporting a stop', { skip: !supported, timeout: 45000 }, async t => {
  // The lock gained qrcode-generator after the last npm ci (lock trimmed to the fixture's packages).
  const { root, command, start } = fixture(t);
  const wanted = JSON.parse(fs.readFileSync(path.join(product, 'core/package-lock.json'), 'utf8'));
  wanted.packages = Object.fromEntries(Object.entries(wanted.packages).filter(([key]) => !key || fs.existsSync(path.join(root, 'core', key, 'package.json'))));
  fs.writeFileSync(path.join(root, 'core/package-lock.json'), JSON.stringify(wanted));
  const record = structuredClone(wanted); delete record.packages['node_modules/qrcode-generator'];
  fs.writeFileSync(path.join(root, 'core/node_modules/.package-lock.json'), JSON.stringify(record));
  fs.rmSync(path.join(root, 'core/node_modules/qrcode-generator'), { recursive: true });
  const owner = start(), failure = await waitFor(command, status => status.state === '启动失败');
  assert.equal(failure.detail, '缺少依赖或版本不符：qrcode-generator。请在应用根目录运行 npm --prefix core ci 后重新启动。');
  await command('--quit'); await owner.exit; assert.equal(owner.child.exitCode, 0, owner.errors());
});

test('Windows tray in a preview package reports a removed runtime package and asks for a fresh unzip', { skip: !supported, timeout: 45000 }, async t => {
  const { root, command, start } = fixture(t);
  fs.copyFileSync(path.join(product, 'core/package-lock.json'), path.join(root, 'core/package-lock.json'));
  fs.writeFileSync(path.join(root, 'RELEASE.json'), '{}');
  fs.rmSync(path.join(root, 'core/node_modules/qrcode-generator'), { recursive: true });
  const owner = start(), failure = await waitFor(command, status => status.state === '启动失败');
  assert.equal(failure.detail, '缺少运行依赖：qrcode-generator。请重新解压完整预览包。');
  await command('--quit'); await owner.exit; assert.equal(owner.child.exitCode, 0, owner.errors());
});
