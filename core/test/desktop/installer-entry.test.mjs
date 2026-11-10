import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile), product = fileURLToPath(new URL('../../../', import.meta.url));
const supported = process.platform === 'win32' && process.arch === 'x64';
let work, tool;
before(async () => {
  if (!supported) return;
  work = fs.mkdtempSync(path.join(product, '.temp', 'installer-entry-tests-'));
  const source = path.join(work, 'Tool.cs'); tool = path.join(work, 'node.exe');
  fs.writeFileSync(source, `using System; using System.IO; using System.Text; using System.Web.Script.Serialization;
internal static class Tool {
 static int Main(string[] args) {
  Console.OutputEncoding=new UTF8Encoding(false);
  string root=Environment.GetEnvironmentVariable("QF_ENTRY_ROOT"), log=Path.Combine(root,"calls.jsonl");
  var json=new JavaScriptSerializer(); File.AppendAllText(log,json.Serialize(args)+"\\n");
  if(args[0]=="--version") {Console.WriteLine(Environment.GetEnvironmentVariable("QF_ENTRY_ISCC_VERSION")??"7.1.0");return 0;}
  if(args[0]=="--eval") {Console.WriteLine(json.Serialize(new { version=Environment.GetEnvironmentVariable("QF_ENTRY_NODE_VERSION")??"24.13.0",arch="x64",platform="win32" }));return 0;}
  if(args[0]=="--input-type=module") { if(Environment.GetEnvironmentVariable("QF_ENTRY_DEPENDENCIES")!="missing")return 0;Console.WriteLine("fixture-package");return 3;}
  if(Environment.GetEnvironmentVariable("QF_ENTRY_BUILD_FAIL")=="1") return 9;
  string version=null,output=null; for(int i=1;i<args.Length;i++){if(args[i]=="--version")version=args[i+1];if(args[i]=="--output")output=args[i+1];}
  Directory.CreateDirectory(output); string file=Path.Combine(output,"QuizForge-"+version+"-win-x64-setup.exe");File.WriteAllText(file,"fixture, not a real installer");File.WriteAllText(file+".sha256","fixture");
  Console.WriteLine(json.Serialize(new {packageFile=file}));return 0;
 }}
`);
  await run(path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'), ['/nologo', '/target:exe', '/utf8output', '/reference:System.Web.Extensions.dll', '/out:' + tool, source], { windowsHide: true });
});
after(() => { if (work) { assert.equal(path.dirname(work), path.join(product, '.temp')); fs.rmSync(work, { recursive: true, force: true }); } });

function fixture(t, extra = {}) {
  const root = fs.mkdtempSync(path.join(work, "源码 中文 & ' "));
  const build = path.join(root, 'core/scripts/build'); fs.mkdirSync(build, { recursive: true });
  fs.copyFileSync(path.join(product, 'core/scripts/build/build-windows-installer.ps1'), path.join(build, 'build-windows-installer.ps1'));
  fs.copyFileSync(path.join(product, 'Build-QuizForge-Installer.cmd'), path.join(root, 'Build-QuizForge-Installer.cmd'));
  fs.writeFileSync(path.join(root, 'core/package-lock.json'), '{}'); fs.writeFileSync(path.join(root, 'core/package.json'), JSON.stringify({ version: '0.1.0-preview.3' }));
  fs.writeFileSync(path.join(root, 'QuizForge.exe'), 'existing source launcher');
  const tools = path.join(root, '工具 空格'), node = path.join(tools, 'node.exe'), compiler = path.join(tools, 'ISCC.exe'); fs.mkdirSync(tools);
  fs.copyFileSync(tool, node); fs.copyFileSync(tool, compiler);
  fs.writeFileSync(path.join(tools, 'npm.cmd'), '@echo off\r\necho npm-ci>>"%QF_ENTRY_ROOT%\\npm.log"\r\nif "%QF_ENTRY_NPM_FAIL%"=="1" exit /b 7\r\nexit /b 0\r\n');
  fs.writeFileSync(path.join(build, 'build-windows-launcher.ps1'), `param([string]$OutputPath)
if($env:QF_ENTRY_LAUNCHER_FAIL -eq '1'){throw 'fixture launcher failed'}
[IO.File]::WriteAllText($OutputPath,'fixture launcher')
$global:LASTEXITCODE=0
`);
  fs.writeFileSync(path.join(build, 'build-windows-installer.mjs'), '// fixture');
  const env = { ...process.env, QF_ENTRY_ROOT: root, ...extra };
  const call = (args = [], { wrapper = false } = {}) => {
    const options = { windowsHide: true, timeout: 30000, env };
    if (wrapper) return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& $env:QF_TEST_ENTRY -Version 0.1.0-local.test -NodePath $env:QF_TEST_NODE -Compiler $env:QF_TEST_COMPILER -SkipPause'], { ...options, env: { ...env, QF_TEST_ENTRY: path.join(root, 'Build-QuizForge-Installer.cmd'), QF_TEST_NODE: node, QF_TEST_COMPILER: compiler } });
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(build, 'build-windows-installer.ps1'), '-Version', '0.1.0-local.test', '-NodePath', node, '-Compiler', compiler, '-SkipPause', ...args], options);
  };
  const calls = () => fs.existsSync(path.join(root, 'calls.jsonl')) ? fs.readFileSync(path.join(root, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  t.after(() => assert.equal(fs.readFileSync(path.join(root, 'QuizForge.exe'), 'utf8'), 'existing source launcher'));
  return { root, node, compiler, env, call, calls };
}

test('check-only verifies installed tools without installing dependencies or creating output', { skip: !supported }, async t => {
  const f = fixture(t, { QF_ENTRY_DEPENDENCIES: 'missing' }); const result = await f.call(['-CheckOnly']);
  assert.match(result.stdout, /环境检查通过/); assert.equal(fs.existsSync(path.join(f.root, '.temp')), false); assert.equal(fs.existsSync(path.join(f.root, 'dist')), false); assert.equal(fs.existsSync(path.join(f.root, 'npm.log')), false);
  assert.equal(f.calls().length, 2);
});

test('installer entry preserves Chinese output under non-Chinese code page 437', { skip: !supported }, async t => {
  const f = fixture(t);
  const script = path.join(f.root, 'core/scripts/build/build-windows-installer.ps1');
  const command = '[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(437); $OutputEncoding=[Text.Encoding]::GetEncoding(437); & $env:QF_TEST_BUILD -Version 0.1.0-local.test -NodePath $env:QF_TEST_NODE -Compiler $env:QF_TEST_COMPILER -CheckOnly -SkipPause';
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
    windowsHide: true, timeout: 30000, encoding: 'utf8', env: { ...f.env, QF_TEST_BUILD: script, QF_TEST_NODE: f.node, QF_TEST_COMPILER: f.compiler }
  });
  assert.match(result.stdout, /环境检查通过/);
  assert.ok(result.stdout.includes(f.node));
  assert.ok(result.stdout.includes(f.compiler));
  assert.equal(fs.existsSync(path.join(f.root, 'dist')), false);
});
test('installer finally restores both caller encodings on success and failure', {skip:!supported}, async t=>{
  for(const fail of [false,true]){
    const f=fixture(t,fail?{QF_ENTRY_NODE_VERSION:'22.0.0'}:{}),script=path.join(f.root,'core/scripts/build/build-windows-installer.ps1');
    // Only replace the process-exit statement in this disposable copy, so the
    // caller can inspect values after the real try/catch/finally has returned.
    const source=fs.readFileSync(script,'utf8');assert.match(source,/exit \$buildExit\s*$/);
    fs.writeFileSync(script,source.replace(/exit \$buildExit\s*$/,'return $buildExit'));
    const command='[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(437); $OutputEncoding=[Text.Encoding]::GetEncoding(1252); $code=. $env:QF_TEST_BUILD -Version 0.1.0-local.test -NodePath $env:QF_TEST_NODE -Compiler $env:QF_TEST_COMPILER -CheckOnly -SkipPause; Write-Output ("restored={0}/{1};result={2}" -f [Console]::OutputEncoding.CodePage,$OutputEncoding.CodePage,$code)';
    const result=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',env:{...f.env,QF_TEST_BUILD:script,QF_TEST_NODE:f.node,QF_TEST_COMPILER:f.compiler}});
    assert.match(result.stdout,new RegExp('restored=437/1252;result='+Number(fail)));
  }
});

test('wrong or missing Node, npm and compiler fail early with installation guidance', { skip: !supported }, async t => {
  for (const extra of [{ QF_ENTRY_NODE_VERSION: '22.0.0' }, { QF_ENTRY_ISCC_VERSION: '6.7.3' }]) {
    const f = fixture(t, extra); await assert.rejects(f.call(['-CheckOnly']), error => error.code === 1 && /https:\/\/(nodejs.org|jrsoftware.org)/.test(error.stdout)); assert.equal(fs.existsSync(path.join(f.root, '.temp')), false);
  }
  const f = fixture(t); fs.unlinkSync(path.join(path.dirname(f.node), 'npm.cmd'));
  await assert.rejects(f.call(['-CheckOnly']), error => error.code === 1 && /npm.cmd/.test(error.stdout));
  fs.unlinkSync(f.node); fs.unlinkSync(f.compiler);
  await assert.rejects(f.call(['-CheckOnly']), error => error.code === 1 && /nodejs.org/.test(error.stdout) && /jrsoftware.org/.test(error.stdout));
});
test('the real CMD entry preserves Unicode and spaced paths, skips matching dependencies and keeps output isolated', { skip: !supported }, async t => {
  const f = fixture(t); const result = await f.call([], { wrapper: true }); assert.match(result.stdout, /构建完成/);
  const artifact = path.join(f.root, 'dist/QuizForge-0.1.0-local.test-win-x64-setup.exe'); assert.equal(fs.readFileSync(artifact, 'utf8'), 'fixture, not a real installer');
  assert.equal(fs.existsSync(artifact + '.sha256'), true); assert.equal(fs.existsSync(path.join(f.root, 'npm.log')), false);
  const build = f.calls().find(args => args[0].endsWith('build-windows-installer.mjs')); assert.ok(build);
  assert.equal(build[build.indexOf('--node') + 1], f.node); assert.equal(build[build.indexOf('--compiler') + 1], f.compiler);
  const launcher = build[build.indexOf('--launcher') + 1]; assert.equal(path.dirname(path.dirname(launcher)), path.join(f.root, '.temp')); assert.equal(fs.readFileSync(launcher, 'utf8'), 'fixture launcher');
  await assert.rejects(f.call(), error => error.code === 1 && /已存在/.test(error.stdout));
});
test('missing dependencies run npm ci and a failure prevents launcher and packaging steps', { skip: !supported }, async t => {
  const success = fixture(t, { QF_ENTRY_DEPENDENCIES: 'missing' }); await success.call(); assert.match(fs.readFileSync(path.join(success.root, 'npm.log'), 'utf8'), /npm-ci/);
  const failed = fixture(t, { QF_ENTRY_DEPENDENCIES: 'missing', QF_ENTRY_NPM_FAIL: '1' });
  await assert.rejects(failed.call(), error => error.code === 1 && /npm ci/.test(error.stdout)); assert.equal(fs.existsSync(path.join(failed.root, '.temp')), false); assert.equal(fs.existsSync(path.join(failed.root, 'dist')), false);
});
test('dependency repairs are refused while the source host lock has a live owner', { skip: !supported }, async t => {
  const f = fixture(t, { QF_ENTRY_DEPENDENCIES: 'missing' }); fs.mkdirSync(path.join(f.root, '.state')); fs.writeFileSync(path.join(f.root, '.state/host.lock'), JSON.stringify({ pid: process.pid, nonce: 'fixture' }));
  await assert.rejects(f.call(), error => error.code === 1 && /服务仍在运行/.test(error.stdout)); assert.equal(fs.existsSync(path.join(f.root, 'npm.log')), false); assert.equal(fs.existsSync(path.join(f.root, '.temp')), false);
});
test('Windows PowerShell passes the dependency probe and literal project paths to real Node', { skip: !supported }, async t => {
  const f = fixture(t); fs.copyFileSync(process.execPath, f.node);
  fs.writeFileSync(path.join(f.root, 'core/package.json'), JSON.stringify({ version: '0.1.0-preview.3', type: 'module' }));
  fs.writeFileSync(path.join(f.root, 'core/package-lock.json'), JSON.stringify({ packages: {} }));
  const platform = path.join(f.root, 'core/server/host/platform'); fs.mkdirSync(platform, { recursive: true });
  fs.copyFileSync(path.join(product, 'core/server/host/platform/dependencies.js'), path.join(platform, 'dependencies.js'));
  fs.writeFileSync(path.join(f.root, 'core/scripts/build/build-windows-installer.mjs'), `import fs from 'node:fs';import path from 'node:path';
const value=name=>process.argv[process.argv.indexOf(name)+1]; const output=value('--output'),file=path.join(output,'QuizForge-'+value('--version')+'-win-x64-setup.exe');
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(file,'fixture only');fs.writeFileSync(file+'.sha256','fixture');console.log(JSON.stringify({packageFile:file}));
`);
  const result = await f.call(); assert.match(result.stdout, /项目依赖已匹配/); assert.match(result.stdout, /构建完成/); assert.equal(fs.existsSync(path.join(f.root, 'npm.log')), false);
});
test('compiler and packaging failures are reported without a successful result', { skip: !supported }, async t => {
  const launcher = fixture(t, { QF_ENTRY_LAUNCHER_FAIL: '1' }); await assert.rejects(launcher.call(), error => error.code === 1 && /fixture launcher failed/.test(error.stdout)); assert.equal(launcher.calls().some(args => args[0].endsWith('build-windows-installer.mjs')), false);
  const build = fixture(t, { QF_ENTRY_BUILD_FAIL: '1' }); await assert.rejects(build.call(), error => error.code === 1 && /安装包生成失败/.test(error.stdout)); assert.equal(fs.existsSync(path.join(build.root, 'dist')), false);
});
