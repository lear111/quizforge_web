import { copyFixture, writeFixture } from '../fixtures/installed-library.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { copyRuntimeDependencies } from '../../scripts/build/runtime-dependencies.mjs';
import { LibraryArchive } from '../../server/host/library/library-archive.js';
import { ResourceStore } from '../../server/host/resources/resources.js';

const run = promisify(execFile), product = fileURLToPath(new URL('../../../', import.meta.url));
const supported = process.platform === 'win32' && process.arch === 'x64';
let work, executable, encodingExecutable;
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
  encodingExecutable = path.join(work, 'ConsoleEncodingHarness.exe');
  await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), [
    '/nologo', '/target:exe', '/platform:x64', '/utf8output', '/main:ConsoleEncodingHarness', '/out:' + encodingExecutable,
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Core.dll', '/reference:System.Web.Extensions.dll',
    ...fs.readdirSync(source).filter(name => name.endsWith('.cs')).map(name => path.join(source, name)),
    path.join(product, 'core/test/desktop/fixtures/ConsoleEncodingHarness.cs')
  ], { windowsHide: true });
});
after(() => {
  if (work) { assert.equal(path.dirname(work), path.join(product, '.temp')); fs.rmSync(work, { recursive: true, force: true }); }
});
function fixture(t, { installed = false, dataRoot: selectedDataRoot = null } = {}) {
  const root = fs.mkdtempSync(path.join(work, "应用 空格'"));
  fs.copyFileSync(executable, path.join(root, 'QuizForge.exe'));
  for (const directory of ['server', 'web', 'shared']) fs.cpSync(path.join(product, 'core', directory), path.join(root, 'core', directory), { recursive: true, filter: file => !/\.test\./.test(path.basename(file)) });
  fs.copyFileSync(path.join(product, 'core/package.json'), path.join(root, 'core/package.json'));
  copyRuntimeDependencies(product, root);
  fs.mkdirSync(path.join(root, 'runtime')); fs.copyFileSync(process.execPath, path.join(root, 'runtime/node.exe'));
  fs.mkdirSync(path.join(root, 'question-banks'));
  copyFixture(path.join(product, 'core/test/fixtures/legacy-extensions/single-choice-1.0.0'), path.join(root, 'extensions/Test/choice'), { recursive: true });
  const raw = JSON.parse(fs.readFileSync(path.join(root, 'extensions/Test/choice/examples.json'))); raw.id = 'tray-bank';
  writeFixture(path.join(root, 'question-banks/Bank/bank.json'), JSON.stringify(raw));
  let dataRoot = selectedDataRoot ?? root;
  if (installed) {
    fs.mkdirSync(path.join(root, 'defaults'));
    for (const name of ['question-banks', 'extensions']) fs.renameSync(path.join(root, name), path.join(root, 'defaults', name));
    fs.writeFileSync(path.join(root, 'INSTALLATION.json'), JSON.stringify({ schemaVersion: 1, dataMode: 'user', applicationId: 'QuizForge.TrayTest.' + randomUUID() }));
    dataRoot = selectedDataRoot ?? path.join(work, '用户 数据-' + path.basename(root));
  }
  const layoutArgs = ['--root', root, ...(installed || selectedDataRoot ? ['--data-root', dataRoot] : [])];
  // Connect and reply each have a five-second bound; include process startup
  // overhead instead of killing a valid cold-start client at exactly ten seconds.
  const command = async (...args) => JSON.parse((await run(path.join(root, 'QuizForge.exe'), [...layoutArgs, ...args], { windowsHide: true, timeout: 20000, env: { ...process.env, PATH: '' } })).stdout);
  const start = (port = 0, args = []) => {
    const child = spawn(path.join(root, 'QuizForge.exe'), [...layoutArgs, '--port', String(port), '--no-browser', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '' } });
    const exit = once(child, 'exit');
    let errors = ''; child.stderr.on('data', chunk => errors += chunk);
    t.after(async () => {
      if (child.exitCode == null && child.signalCode == null) { try { await command('--quit'); await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 8000))]); } catch {} }
      if (child.exitCode == null && child.signalCode == null) { child.kill(); await exit; }
    });
    return { child, exit, errors: () => errors };
  };
  return { root, dataRoot, raw, command, start };
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

async function bankPackage(root, file) {
  const exported = await new LibraryArchive(root, new ResourceStore(root)).exportBank('Bank');
  try { fs.writeFileSync(file, fs.readFileSync(exported.file)); } finally { exported.close(); }
}

test('launcher control output remains UTF-8 under non-Chinese code page 437', { skip: !supported }, async t => {
  const root = fs.mkdtempSync(path.join(work, '编码 中文 '));
  for (const entry of ['entry', 'run']) {
    const result = await run(encodingExecutable, [entry, '--root', root, '--layout', '--no-browser'], { windowsHide: true, encoding: 'utf8' });
    assert.match(result.stderr, /forcedOutputCodePage=437/);
    assert.deepEqual(JSON.parse(result.stdout), { programRoot: root, dataRoot: root, installed: false });
    t.diagnostic(entry + ': ' + result.stderr.trim().replaceAll('\r\n', '; '));
  }
  await assert.rejects(run(encodingExecutable, ['entry', '--no-browser', '--unsupported'], { windowsHide: true, encoding: 'utf8' }), error => error.code === 1 && /未知启动参数/.test(error.stderr));
});

test('opening a local qbank cold-starts one tray, coalesces pending opens and imports later opens independently', {skip:!supported,timeout:90000}, async t=>{
  const f=fixture(t), file=path.join(work,"下载 中文 & ' 空格.qbank");await bankPackage(f.root,file);
  const bytes=fs.readFileSync(file), original=fs.readFileSync(path.join(f.root,'question-banks/Bank/bank.json'));
  const owner=f.start(0,[file]);
  // A control-only status request waits for the first process to own the pipe;
  // the duplicate import must not race it and become the long-running owner.
  await waitFor(f.command,status=>status.launcherPid===owner.child.pid&&status.pendingImports===1);
  const duplicate=await f.command('--no-browser','--import',file);
  const first=await waitFor(f.command,status=>status.lastImport?.state==='completed',60000);
  assert.equal(first.lastImport.id,duplicate.acceptedImportId);assert.equal(first.launcherPid,owner.child.pid);assert.equal(first.pendingImports,0);assert.equal(first.browserOpenRequests,1);
  assert.equal(new URL(first.lastOpenedUrl).searchParams.get('imported-bank'),first.lastImport.bankId);
  let index=await(await fetch(first.url+'api/library/index')).json();assert.equal(index.banks.length,2);
  const imported=index.banks.find(row=>row.id===first.lastImport.bankId);assert.equal(imported.group??'','');assert.equal(imported.title,path.basename(file,'.qbank'));
  const collection=await(await fetch(first.url+'api/collections/bank/'+imported.id)).json();assert.equal(collection.questions.length,3);
  const originalQuestion=first.url+'api/collections/bank/tray-bank/questions/'+f.raw.questions[0].id;
  assert.equal((await fetch(originalQuestion+'/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'draft',requestId:'native-import-keep-answer',revision:0,data:{answer:{selectedOptionId:'B'}}})})).status,200);
  const later=await f.command('--no-browser','--import',file);assert.notEqual(later.acceptedImportId,first.lastImport.id);
  const second=await waitFor(f.command,status=>status.lastImport?.id===later.acceptedImportId&&status.lastImport?.state==='completed',60000);
  assert.equal(second.servicePid,first.servicePid);assert.equal(second.browserOpenRequests,2);
  index=await(await fetch(first.url+'api/library/index')).json();assert.equal(index.banks.length,3);
  const copy=index.banks.find(row=>row.id===second.lastImport.bankId);assert.equal(copy.title,imported.title+'（2）');assert.notEqual(copy.id,imported.id);
  assert.deepEqual((await(await fetch(originalQuestion)).json()).state.answer,{selectedOptionId:'B'});
  assert.deepEqual(fs.readFileSync(file),bytes);assert.deepEqual(fs.readFileSync(path.join(f.root,'question-banks/Bank/bank.json')),original);
  await f.command('--quit');await owner.exit;await gone(first.servicePid);
});

test('running tray imports group packages and reports invalid files without partial installs or another service', {skip:!supported,timeout:90000}, async t=>{
  const f=fixture(t);fs.mkdirSync(path.join(f.root,'question-banks/Group'));fs.renameSync(path.join(f.root,'question-banks/Bank'),path.join(f.root,'question-banks/Group/Bank'));
  const owner=f.start(),ready=await waitFor(f.command,status=>status.state==='运行中');
  const response=await fetch(ready.url+'api/library/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:'Group'})});assert.equal(response.status,200);
  const file=path.join(work,'成套题库.qbank');fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
  const accepted=await f.command('--no-browser','--import',file);
  const done=await waitFor(f.command,status=>status.lastImport?.id===accepted.acceptedImportId&&status.lastImport?.state==='completed',60000);
  assert.equal(done.servicePid,ready.servicePid);assert.equal(done.launcherPid,owner.child.pid);
  const before=await(await fetch(ready.url+'api/library/index')).json();assert.equal(before.banks.find(row=>row.id===done.lastImport.bankId).group,'成套题库');
  const broken=path.join(work,'损坏.qbank');fs.writeFileSync(broken,'broken ZIP');const rejected=await f.command('--no-browser','--import',broken);
  const failed=await waitFor(f.command,status=>status.lastImport?.id===rejected.acceptedImportId&&status.lastImport?.state==='failed');
  assert.equal(failed.state,'运行中');assert.match(failed.lastImport.message,/ZIP|压缩包/);assert.equal(failed.pendingImports,0);assert.equal(failed.browserOpenRequests,done.browserOpenRequests);
  const after=await(await fetch(ready.url+'api/library/index')).json();assert.deepEqual(after.banks.map(row=>row.id),before.banks.map(row=>row.id));assert.deepEqual(after.extensions.map(row=>row.id),before.extensions.map(row=>row.id));
  await assert.rejects(f.command('--no-browser','--import',path.join(work,'missing.qbank')),error=>error.code===1&&/不存在/.test(error.stderr));
  const large=path.join(work,'oversized.qbank'),fd=fs.openSync(large,'w');fs.ftruncateSync(fd,64*1024*1024+1);fs.closeSync(fd);
  await assert.rejects(f.command('--no-browser','--import',large),error=>error.code===1&&/64 MiB/.test(error.stderr));
  await f.command('--quit');await owner.exit;await gone(ready.servicePid);
});

test('tray quit drains an accepted local import before shutting down the owned backend', {skip:!supported,timeout:90000}, async t=>{
  const f=fixture(t),file=path.join(work,'退出前导入.qbank');await bankPackage(f.root,file);
  const owner=f.start(),ready=await waitFor(f.command,status=>status.state==='运行中');
  await f.command('--no-browser','--import',file);await f.command('--quit');await owner.exit;await gone(ready.servicePid);
  assert.ok(fs.existsSync(path.join(f.root,'question-banks/退出前导入/bank.json')));assert.ok(fs.existsSync(path.join(f.root,'extensions/退出前导入/choice/manifest.json')));
  assert.equal(fs.existsSync(path.join(f.root,'.state/host.lock')),false);
});

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

test('installed Windows layout keeps code read-only, seeds once, and preserves answers across restarts and program updates', { skip: !supported, timeout: 90000 }, async t => {
  const f = fixture(t, { installed: true }), layout = await f.command('--layout');
  assert.deepEqual(layout, { programRoot: f.root, dataRoot: f.dataRoot, installed: true });
  assert.equal(fs.existsSync(f.dataRoot), false, 'Layout inspection does not create data');
  const owner = f.start(), ready = await waitFor(f.command, status => status.state === '运行中');
  assert.equal(ready.dataRoot, f.dataRoot); assert.equal(ready.programRoot, f.root);
  assert.equal(fs.existsSync(path.join(f.root, '.state')), false);
  const prefix = ready.url + 'api/collections/bank/tray-bank', question = prefix + '/questions/' + f.raw.questions[0].id;
  assert.equal((await fetch(ready.url)).status, 200);
  assert.equal((await fetch(question + '/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', requestId: 'installed-tray-save', revision: 0, data: { answer: { selectedOptionId: 'B' } } }) })).status, 200);
  await f.command('--quit'); await owner.exit; await gone(ready.servicePid);
  const bank = path.join(f.dataRoot, 'question-banks/Bank/bank.json'), raw = JSON.parse(fs.readFileSync(bank)); raw.questions[0].title = 'My edited question'; fs.writeFileSync(bank, JSON.stringify(raw));
  const template = path.join(f.root, 'defaults/question-banks/Bank/bank.json'), changed = JSON.parse(fs.readFileSync(template)); changed.questions[0].title = 'New program template'; fs.writeFileSync(template, JSON.stringify(changed));
  const second = f.start(), again = await waitFor(f.command, status => status.state === '运行中');
  const payload = await (await fetch(again.url + 'api/collections/bank/tray-bank/questions/' + f.raw.questions[0].id)).json();
  assert.equal(payload.question.title, 'My edited question'); assert.deepEqual(payload.state.answer, { selectedOptionId: 'B' });
  assert.equal(fs.existsSync(path.join(f.root, '.state')), false);
  await f.command('--quit'); await second.exit; await gone(again.servicePid);
});

test('two program installations targeting the same data reuse the original tray', { skip: !supported, timeout: 60000 }, async t => {
  const first = fixture(t, { installed: true }), owner = first.start(), ready = await waitFor(first.command, status => status.state === '运行中');
  const other = fixture(t, { installed: true, dataRoot: first.dataRoot }), duplicate = await other.command('--no-browser');
  assert.equal(duplicate.launcherPid, ready.launcherPid); assert.equal(duplicate.servicePid, ready.servicePid);
  await first.command('--quit'); await owner.exit; await gone(ready.servicePid);
});

test('installed layout defaults to local user data and refuses to store it inside the program directory', { skip: !supported }, async t => {
  const f = fixture(t, { installed: true });
  const layout = JSON.parse((await run(path.join(f.root, 'QuizForge.exe'), ['--root', f.root, '--layout'], { windowsHide: true })).stdout);
  assert.equal(layout.dataRoot, path.join(process.env.LOCALAPPDATA, 'QuizForge'));
  assert.equal(fs.existsSync(f.dataRoot), false);
  await assert.rejects(run(path.join(f.root, 'QuizForge.exe'), ['--root', f.root, '--data-root', path.join(f.root, 'data'), '--no-browser', '--layout'], { windowsHide: true }), error => error.code === 1 && /用户数据目录必须位于安装目录之外/.test(error.stderr));
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
