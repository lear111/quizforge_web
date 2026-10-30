// Explicit integration check: installs a uniquely named test app, then removes
// only that test registration and its shortcuts. User QuizForge is not started.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
const run = promisify(execFile), product = fileURLToPath(new URL('../../../', import.meta.url));
const options = {};
for (let i = 2; i < process.argv.length; i++) { const name = process.argv[i]; if (!['--compiler', '--payload'].includes(name) || ++i >= process.argv.length) throw new Error('Expected --compiler and --payload'); options[name.slice(2)] = path.resolve(process.argv[i]); }
if (process.platform !== 'win32' || !options.compiler || !options.payload) throw new Error('Windows, --compiler and --payload are required');
const work = fs.mkdtempSync(path.join(product, '.temp', 'installer-acceptance-')), app = path.join(work, '程序 空格'), data = path.join(work, '数据 空格');
const id = randomUUID(), name = 'QuizForge Test ' + id, appId = 'QuizForge.InstallerTest.' + id;
const associationExtension = '.qbank-qftest-' + id, associationId = appId + '.QBank';
const hubScheme = 'quizforge-test-' + id;
const payload = path.join(work, 'payload');
fs.cpSync(options.payload, payload, { recursive: true });
fs.writeFileSync(path.join(payload, 'INSTALLATION.json'), JSON.stringify({ schemaVersion: 1, dataMode: 'user', applicationId: appId }));
const artifact = path.join(work, 'QuizForge-0.1.0-test-win-x64-setup.exe');
const executable = path.join(app, 'QuizForge.exe');
const report = { work, appId, appName: name, checks: [] };
const check = value => { report.checks.push(value); console.log(value); };
const powershell = (script, env = {}) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, env: { ...process.env, ...env } });
const shortcuts = async () => JSON.parse((await powershell("$name=$env:QF_INSTALL_TEST_NAME; $shell=New-Object -ComObject WScript.Shell; $paths=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($name+'.lnk')),(Join-Path ([Environment]::GetFolderPath('Programs')) ($name+'\\'+$name+'.lnk'))); @($paths | ForEach-Object {[pscustomobject]@{path=$_;exists=(Test-Path -LiteralPath $_);target=if(Test-Path -LiteralPath $_){$shell.CreateShortcut($_).TargetPath}else{''}}}) | ConvertTo-Json", { QF_INSTALL_TEST_NAME: name })).stdout);
const command = async mode => JSON.parse((await run(executable, ['--data-root', data, mode], { windowsHide: true, timeout: 12000, env: { ...process.env, PATH: '' } })).stdout);
const association = async () => JSON.parse((await powershell("$base='Software\\Classes\\'; $type=$env:QF_INSTALL_TEST_PROGID; $ext=$env:QF_INSTALL_TEST_EXTENSION; $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base+$ext); $open=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base+$type+'\\shell\\open\\command'); $with=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($base+$ext+'\\OpenWithProgids'); [pscustomobject]@{defaultType=if($key){$key.GetValue('')}else{$null};command=if($open){$open.GetValue('')}else{$null};listed=if($with){$with.GetValueNames() -contains $type}else{$false}} | ConvertTo-Json", { QF_INSTALL_TEST_PROGID: associationId, QF_INSTALL_TEST_EXTENSION: associationExtension })).stdout);
const setAssociationDefault = async value => powershell("$testKey='HKCU:\\Software\\Classes\\'+$env:QF_INSTALL_TEST_EXTENSION; New-Item -Path $testKey -Force | Out-Null; Set-Item -LiteralPath $testKey -Value $env:QF_INSTALL_TEST_VALUE", { QF_INSTALL_TEST_EXTENSION: associationExtension, QF_INSTALL_TEST_VALUE: value });
const protocol = async () => JSON.parse((await powershell("$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\'+$env:QF_INSTALL_TEST_SCHEME); $open=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\'+$env:QF_INSTALL_TEST_SCHEME+'\\shell\\open\\command'); [pscustomobject]@{exists=($null -ne $key);urlProtocol=if($key){$key.GetValueNames() -contains 'URL Protocol'}else{$false};command=if($open){$open.GetValue('')}else{$null}} | ConvertTo-Json", { QF_INSTALL_TEST_SCHEME: hubScheme })).stdout);
const setProtocolOwner = async value => powershell("$base='HKCU:\\Software\\Classes\\'+$env:QF_INSTALL_TEST_SCHEME; New-Item -Path ($base+'\\shell\\open\\command') -Force | Out-Null; Set-Item -LiteralPath ($base+'\\shell\\open\\command') -Value $env:QF_INSTALL_TEST_VALUE", { QF_INSTALL_TEST_SCHEME: hubScheme, QF_INSTALL_TEST_VALUE: value });
let owner, exit, installed = false;
async function start() {
  owner = spawn(executable, ['--data-root', data, '--port', '0', '--no-browser'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: '' } });
  exit = once(owner, 'exit'); owner.stdout.resume(); owner.stderr.resume();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const value = await command('--status'); if (value.state === '运行中') return value; if (value.state === '启动失败') throw new Error(value.detail); } catch (error) { if (owner.exitCode !== null) throw error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Isolated installed service did not become ready');
}
async function stop() {
  if (owner && owner.exitCode === null && owner.signalCode === null) {
    await command('--quit'); await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Installed test service did not stop')), 12000).unref())]);
  }
}
async function install(log) { await run(artifact, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/DIR=' + app, '/LOG=' + path.join(work, log)], { windowsHide: true, timeout: 120000 }); installed = true; }
async function uninstall(log) {
  const logFile = path.join(work, log);
  await run(path.join(app, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/LOG=' + logFile], { windowsHide: true, timeout: 60000 });
  // Inno's first phase can exit before its temporary child finishes registry cleanup.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (fs.existsSync(logFile) && /Uninstallation process succeeded\./.test(fs.readFileSync(logFile, 'utf8'))) { installed = false; return; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Isolated uninstallation did not finish; see ' + logFile);
}
try {
  await run(options.compiler, [`/DPayloadRoot=${payload}`, `/DOutputPath=${work}`, '/DAppVersion=0.1.0-test', '/DCompressionMethod=zip', `/DAppId=${appId}`, `/DAppName=${name}`, `/DQBankExtension=${associationExtension}`, `/DHubScheme=${hubScheme}`, path.join(product, 'core/desktop/installer/QuizForge.iss')], { windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const protectedDirectory = path.join(work, 'existing-files'); fs.mkdirSync(protectedDirectory); fs.writeFileSync(path.join(protectedDirectory, 'keep.txt'), 'preserve');
  await assert.rejects(run(artifact, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/DIR=' + protectedDirectory, '/LOG=' + path.join(work, 'refused-directory.log')], { windowsHide: true, timeout: 30000 }));
  assert.equal(fs.readFileSync(path.join(protectedDirectory, 'keep.txt'), 'utf8'), 'preserve'); check('An unrelated nonempty directory is refused without deleting its contents');
  await install('install.log'); check('Per-user installation completed in an isolated directory');
  const links = await shortcuts(); assert.equal(links.length, 2); for (const link of links) { assert.equal(link.exists, true); assert.equal(link.target.toLowerCase(), executable.toLowerCase()); }
  check('Desktop and Start Menu shortcuts point to the installed launcher');
  const registered = await association(); assert.equal(registered.defaultType, associationId); assert.equal(registered.listed, true);
  assert.equal(registered.command, '"' + executable + '" --import "%1"');
  check('Per-user file association quotes both the launcher and package path; the real .qbank association is untouched');
  const uriRegistration = await protocol(); assert.equal(uriRegistration.exists, true); assert.equal(uriRegistration.urlProtocol, true); assert.equal(uriRegistration.command, '"' + executable + '" --open-url "%1"');
  check('Per-user Hub URI registration quotes the installed path and full URI; the real quizforge scheme is untouched');
  const layout = await command('--layout'); assert.equal(layout.dataRoot, data); assert.equal(layout.installed, true); assert.equal(fs.existsSync(data), false);
  const ready = await start(), api = async (route, body, method = 'POST') => { const response = await fetch(ready.url + route, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value; };
  const index = await api('api/library/index'); assert.equal(index.banks.length, 1); assert.equal(index.extensions.length, 5);
  const defaults = await api('api/collections/bank/' + index.banks[0].id);
  assert.equal(defaults.questions.length, 11);
  for (const question of defaults.questions) assert.equal((await fetch(ready.url + 'api/collections/bank/' + index.banks[0].id + '/questions/' + question.id)).status, 200);
  const sample = JSON.parse(fs.readFileSync(path.join(data, 'question-banks/基础题型/基础题型展示/bank.json'))), images = new Set();
  const visit = value => { if (!value || typeof value !== 'object') return; if (value.type === 'image' && /^[a-f0-9]{64}$/.test(value.attrs?.assetId)) images.add(value.attrs.assetId); for (const item of Object.values(value)) visit(item); }; visit(sample);
  assert.ok(images.size > 0);
  for (const id of images) { const image = await fetch(ready.url + 'api/resources/' + id); assert.equal(image.status, 200); assert.match(image.headers.get('content-type'), /^image\//); assert.ok((await image.arrayBuffer()).byteLength > 0); }
  assert.equal((await fetch(ready.url + 'assets/backgrounds/coast.svg')).status, 200);
  assert.equal((await fetch(ready.url + 'api/settings/admin-contact?url=https://example.test')).status, 400);
  check('All eleven default questions, their images, five extensions, coastal artwork and the contact route are present');
  const archive = await fetch(ready.url + 'api/library/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bank: index.banks[0].path }) }); assert.equal(archive.status, 200);
  const packageFile = path.join(work, "下载 空格' & 题库.qbank"); fs.writeFileSync(packageFile, Buffer.from(await archive.arrayBuffer())); const packageBefore = fs.readFileSync(packageFile);
  const queued = JSON.parse((await run(executable, ['--data-root', data, '--no-browser', '--import', packageFile], { windowsHide: true, timeout: 12000, env: { ...process.env, PATH: '' } })).stdout);
  let imported; const importDeadline = Date.now() + 60000;
  while (Date.now() < importDeadline) { imported = await command('--status'); if (imported.lastImport?.id === queued.acceptedImportId && ['completed','failed'].includes(imported.lastImport.state)) break; await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.equal(imported.lastImport?.state, 'completed', JSON.stringify(imported)); assert.equal(imported.servicePid, ready.servicePid); assert.equal((await api('api/library/index')).banks.length, 2); assert.deepEqual(fs.readFileSync(packageFile), packageBefore);
  check('The installed launcher imports a real single-bank package into separate data through the existing tray');
  const prefix = 'api/collections/bank/' + index.banks[0].id, overview = await api(prefix), q = prefix + '/questions/' + overview.questions[0].id;
  const initial = await api(q), answer = { selectedOptionId: initial.question.data.options[0].id };
  await api(q + '/actions', { action: 'draft', requestId: 'installer-draft-test', revision: 0, data: { answer } });
  await api(q + '/actions', { action: 'submit', requestId: 'installer-submit-test', revision: 1, data: { answer } });
  const summary = await api(prefix + '/summary'), finished = await api(prefix + '/finish', { requestId: 'installer-finish-test', roundId: summary.roundId, summaryVersion: summary.summaryVersion });
  const historyId = (await api(prefix + '/history')).records[0].id, history = await api(prefix + '/history/' + historyId);
  await api(prefix + '/restart', { requestId: 'installer-restart-test', roundId: finished.roundId, summaryVersion: finished.summaryVersion });
  const current = await api(q); await api(q + '/actions', { action: 'draft', requestId: 'installer-next-draft', revision: current.state.revision, data: { answer } });
  await api('api/settings/development', { enabled: true }, 'PUT');
  assert.equal(fs.existsSync(path.join(app, '.state')), false); check('Bundled Node serves real basic questions and saves answers in separate data');
  await assert.rejects(install('blocked-upgrade.log')); assert.equal((await fetch(ready.url + 'api/health')).status, 200); check('A running installed app blocks upgrade without stopping its service');
  await stop();
  await setAssociationDefault('Foreign.Reader');
  const edited = path.join(data, 'question-banks/基础题型/基础题型展示/bank.json'), raw = JSON.parse(fs.readFileSync(edited)); raw.description = 'User-edited content'; fs.writeFileSync(edited, JSON.stringify(raw)); const before = fs.readFileSync(edited);
  fs.writeFileSync(path.join(app, 'core/obsolete-upgrade-probe.txt'), 'old program file');
  await install('upgrade.log'); assert.deepEqual(fs.readFileSync(edited), before); assert.equal(fs.existsSync(path.join(app, 'core/obsolete-upgrade-probe.txt')), false);
  assert.equal((await association()).defaultType, 'Foreign.Reader');
  assert.equal((await protocol()).command, uriRegistration.command);
  const next = await start(), response = await fetch(next.url + q); const saved = await response.json(); assert.equal(response.status, 200); assert.deepEqual(saved.state.answer, answer);
  assert.equal((await (await fetch(next.url + 'api/settings/development')).json()).enabled, true);
  assert.deepEqual(await (await fetch(next.url + prefix + '/history/' + historyId)).json(), history);
  check('Reinstallation replaces program files and preserves edited banks, settings, answers and frozen history');
  await stop();
  await uninstall('uninstall.log');
  const end = Date.now() + 12000; while (fs.existsSync(executable) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(fs.existsSync(executable), false); assert.deepEqual(fs.readFileSync(edited), before); for (const link of await shortcuts()) assert.equal(link.exists, false);
  const registration = (await powershell("Test-Path -LiteralPath ('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$env:QF_INSTALL_TEST_ID+'_is1')", { QF_INSTALL_TEST_ID: appId })).stdout.trim(); assert.equal(registration, 'False');
  check('Uninstall removes only program files, test shortcuts and registration; data remains');
  const removedAssociation = await association(); assert.equal(removedAssociation.command, null); assert.equal(removedAssociation.listed, false); assert.equal(removedAssociation.defaultType, 'Foreign.Reader');
  check('Upgrade and uninstall preserve another reader’s default association and remove only the test app’s registration');
  assert.equal((await protocol()).exists, false); check('Uninstall removes the Hub protocol only while it still points to this installed launcher');
  const otherCommand = '"C:\\Other Installation\\QuizForge.exe" --open-url "%1"'; await setProtocolOwner(otherCommand);
  await install('protocol-conflict-install.log'); assert.equal((await protocol()).command, otherCommand);
  assert.match(fs.readFileSync(path.join(work, 'protocol-conflict-install.log'), 'utf8'), /protocol is already owned/);
  await uninstall('protocol-conflict-uninstall.log');
  assert.equal((await protocol()).command, otherCommand); assert.deepEqual(fs.readFileSync(edited), before);
  check('Installation and uninstall preserve a Hub protocol owned by another program or installation and report the conflict');
  report.passed = true;
} finally {
  try { await stop(); } catch (error) { if (owner?.exitCode === null) { owner.kill(); await exit; } report.cleanupError = error.message; }
  if (installed && fs.existsSync(path.join(app, 'unins000.exe'))) { try { await uninstall('cleanup-uninstall.log'); } catch (error) { report.uninstallError = error.message; } }
  await powershell("$ext=$env:QF_INSTALL_TEST_EXTENSION; if($ext -notmatch '^\\.qbank-qftest-[a-f0-9-]{36}$'){throw 'Invalid test association'}; $testKey='HKCU:\\Software\\Classes\\'+$ext; if(Test-Path -LiteralPath $testKey){Remove-Item -LiteralPath $testKey -Recurse -Force}", { QF_INSTALL_TEST_EXTENSION: associationExtension });
  await powershell("$scheme=$env:QF_INSTALL_TEST_SCHEME; if($scheme -notmatch '^quizforge-test-[a-f0-9-]{36}$'){throw 'Invalid test scheme'}; $testKey='HKCU:\\Software\\Classes\\'+$scheme; if(Test-Path -LiteralPath $testKey){Remove-Item -LiteralPath $testKey -Recurse -Force}", { QF_INSTALL_TEST_SCHEME: hubScheme });
  fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Report: ' + path.join(work, 'report.json'));
}
