import { fileURLToPath } from 'node:url';
import { DesktopControl, reportDesktopFailure } from './host/http/desktop-control.js';
import { isSourceCheckout, missingModuleReason, sourceDependencyProblem } from './host/platform/dependencies.js';

const product = fileURLToPath(new URL('../../', import.meta.url));
const options = { root: '.', host: '127.0.0.1', port: 8080, token: null, node: process.execPath };
let upgrade = false, upgradeAutomatic = false, only = false, desktopMode = false, service, desktop, stopping;
try {
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--help') {
      console.log('node core/server/main.mjs [--root DIRECTORY] [--host ADDRESS] [--port 8080] [--token TOKEN] [--node EXECUTABLE] [--desktop] [--upgrade-short-answer | --upgrade-short-answer-auto] [--upgrade-only]');
      process.exit(0);
    }
    if (flag === '--upgrade-short-answer') { upgrade = true; continue; }
    if (flag === '--upgrade-short-answer-auto') { upgradeAutomatic = true; continue; }
    if (flag === '--upgrade-only') { only = true; continue; }
    if (flag === '--desktop') { desktopMode = true; continue; }
    if (!['--root', '--host', '--port', '--token', '--node'].includes(flag) || ++i >= process.argv.length) throw new Error('Unknown option or missing value: ' + flag);
    options[flag.slice(2)] = flag === '--port' ? Number(process.argv[i]) : process.argv[i];
  }
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('QuizForge requires Node.js 24');
  if (only && !upgrade && !upgradeAutomatic) throw new Error('--upgrade-only requires an upgrade option');
  // Explain stale or missing packages before importing them.
  const problem = sourceDependencyProblem(product);
  if (problem) throw Object.assign(new Error(problem), { reason: problem });
  let modules;
  try {
    modules = await Promise.all([import('./host/http/server.js'), import('./host/practice/short-answer-upgrade.js')]);
  } catch (error) {
    const reason = missingModuleReason(error, isSourceCheckout(product));
    throw reason ? Object.assign(new Error(reason), { reason }) : error;
  }
  const [{ QuizForgeServer }, { upgradeShortAnswerBanks }] = modules;
  service = await QuizForgeServer.create(options);
  const stop = () => stopping ??= (async () => { desktop?.dispose(); await service.close({ graceful: desktopMode }); process.exit(0); })();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  if (desktopMode) desktop = new DesktopControl(stop);
  if (upgrade) console.log('Short-answer banks upgraded: ' + await upgradeShortAnswerBanks(service.library, service.states));
  if (upgradeAutomatic) console.log('Automatic-scoring short-answer banks upgraded: ' + await upgradeShortAnswerBanks(service.library, service.states, true));
  if (only) await service.close();
  else {
    await service.start();
    console.log('QuizForge Web listening on http://' + (options.host.includes(':') ? '[' + options.host + ']' : options.host) + ':' + service.port());
    console.log('Local administrator supplied extensions only; Node restrictions are not a full hostile-code sandbox.');
    desktop?.arm(service);
  }
} catch (error) {
  desktop?.dispose();
  await service?.close();
  // Do not print provider payloads, credentials or command-line access tokens;
  // a reason is a fixed message naming at most a package or file.
  if (error.reason && desktopMode) reportDesktopFailure(error.reason);
  console.error('QuizForge could not start: ' + (error.reason ?? error.code ?? error.message)); process.exitCode = 1;
}
