import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyRuntimeDependencies } from './runtime-dependencies.mjs';
import { stageBasicContent } from './stage-basic-content.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function stageWindowsApp({ root, target, version, node = process.execPath, launcher = path.join(root, 'QuizForge.exe'), license = null, sourceCommit = null, installed = false, applicationId = 'QuizForge.Desktop' }) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || !/^[\w.-]{1,80}$/.test(version)) throw new Error('This build produces a Windows x64 app');
  if (sourceCommit !== null && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('Invalid source commit');
  if (!fs.existsSync(launcher)) throw new Error('Build QuizForge.exe with core/scripts/build/build-windows-launcher.ps1 first');
  const source = path.join(root, 'core/desktop/windows');
  if (fs.readdirSync(source).filter(name => name.endsWith('.cs')).some(name => fs.statSync(path.join(source, name)).mtimeMs > fs.statSync(launcher).mtimeMs)) throw new Error('Launcher source changed; rebuild QuizForge.exe first');
  const nodeVersion = execFileSync(node, ['--version'], { windowsHide: true, encoding: 'utf8' }).trim();
  if (!/^v24\./.test(nodeVersion)) throw new Error('Node.js 24 is required');
  fs.mkdirSync(target);
  const productFilter = file => {
    const name = path.basename(file);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Links are not packaged: ' + file);
    return !['.temp', '.state', '.development', '.trash', '.git', 'node_modules'].includes(name) && !/\.test\.(mjs|cjs|js)$/.test(name);
  };
  const copy = relative => fs.cpSync(path.join(root, relative), path.join(target, relative), { recursive: true, filter: productFilter });
  fs.copyFileSync(launcher, path.join(target, 'QuizForge.exe'));
  for (const directory of ['core/server', 'core/web', 'core/shared', 'core/docs', 'skills']) copy(directory);
  for (const file of ['LICENSE', 'core/package.json', 'core/package-lock.json', 'FEATURES.md']) copy(file);
  const defaults = installed ? path.join(target, 'defaults') : target;
  fs.mkdirSync(defaults, { recursive: true });
  const basicContent = stageBasicContent(root, defaults, productFilter);
  if (installed) fs.writeFileSync(path.join(target, 'INSTALLATION.json'), JSON.stringify({ schemaVersion: 1, dataMode: 'user', applicationId }));
  fs.mkdirSync(path.join(target, 'runtime')); fs.copyFileSync(node, path.join(target, 'runtime/node.exe'));
  const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`;
  let nodeLicense;
  if (license) nodeLicense = fs.readFileSync(license);
  else {
    const response = await fetch(licenseUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Node license download failed: ' + response.status);
    nodeLicense = Buffer.from(await response.arrayBuffer());
  }
  if (!nodeLicense.toString('utf8').includes('Node.js') || nodeLicense.length > 1024 * 1024) throw new Error('Node license is invalid');
  fs.writeFileSync(path.join(target, 'runtime/LICENSE'), nodeLicense);
  const dependencies = copyRuntimeDependencies(root, target);
  fs.writeFileSync(path.join(target, 'README.md'), `# QuizForge ${version}\n\nWindows 10/11 64 位预览版。${installed ? '通过桌面或开始菜单的 QuizForge 快捷方式启动。用户数据位于 %LOCALAPPDATA%\\QuizForge，升级和卸载保留；托盘菜单可打开数据文件夹。' : '解压整个文件夹后双击 QuizForge.exe。题库、拓展及记录保存在解压目录内，请保留整个目录。'}\n\n内置 Node.js ${nodeVersion}，无需安装 Node.js。托盘使用系统 .NET Framework 4.8。首次启动服务就绪后自动打开网页；左键点击托盘打开网页，右键查看运行情况或退出。关闭浏览器后服务仍运行，退出前请确认页面输入已保存。\n\n只附带基础题型展示库及六种基础拓展（含听力理解），其他题库通过应用内“获取题库”下载。安装版首次启动复制基础内容，此后升级不覆盖用户题库。安装版不会自动搬运旧解压版数据，需先导出题库再导入；旧目录仍保留。听力制作步骤见 core/docs/guides/LISTENING_GUIDE.md，完整使用说明见 core/docs/guides/USER_GUIDE.md。\n`);
  const receipt = { version, sourceCommit, platform: 'win-x64', layout: installed ? 'installed' : 'portable', nodeVersion, nodeLicenseSource: licenseUrl, launcherSha256: digest(fs.readFileSync(launcher)), ...basicContent, dependencies, excluded: ['personal state/settings/history', 'root test/', 'non-basic banks/extensions', 'automatic tests', 'temporary/build files'] };
  fs.writeFileSync(path.join(target, 'RELEASE.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
