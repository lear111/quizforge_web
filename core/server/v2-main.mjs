import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { V2Server } from './v2/app.js';

const options = { root: '.', codeRoot: fileURLToPath(new URL('../', import.meta.url)), port: 8794 };
let service;
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('V2 需要 Node.js 24');
  for (let i = 2; i < process.argv.length; i++) {
    const option = process.argv[i];
    if (option === '--help') { console.log('node core/server/v2-main.mjs --root DATA --port 8794 [--host ADDRESS --token TOKEN] [--code-root CORE] [--development]'); process.exit(0); }
    if (option === '--development') { options.development = true; continue; }
    const key = { '--root': 'root', '--code-root': 'codeRoot', '--port': 'port', '--host': 'host', '--token': 'token' }[option];
    if (!key || ++i >= process.argv.length) throw new Error('启动参数无效');
    options[key] = key === 'port' ? Number(process.argv[i]) : process.argv[i];
  }
  options.root = path.resolve(options.root); options.codeRoot = path.resolve(options.codeRoot);
  service = await new V2Server(options).start();
  console.log(`QuizForge V2 listening on http://${options.host?.includes(':') ? '[' + options.host + ']' : options.host ?? '127.0.0.1'}:${service.port()}/`);
  const stop = async () => { await service.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) { await service?.close(); console.error('QuizForge V2 无法启动：' + (error.code ?? '请检查参数、目录及权限')); process.exitCode = 1; }
