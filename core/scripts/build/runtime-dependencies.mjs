import fs from 'node:fs';
import path from 'node:path';

export function copyRuntimeDependencies(root, target) {
  const moduleRoot = path.join(root, 'core/node_modules'), modules = new Map();
  function resolvePackage(name, from) {
    for (let cursor = from; ; cursor = path.dirname(cursor)) {
      const candidate = path.join(cursor, 'node_modules', name);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
      if (cursor === path.dirname(cursor)) throw new Error('Missing runtime dependency: ' + name);
    }
  }
  function includeModule(directory) {
    if (modules.has(directory)) return;
    const relative = path.relative(moduleRoot, directory);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Dependency is outside core/node_modules');
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
    modules.set(directory, { name: metadata.name, version: metadata.version, path: 'core/node_modules/' + relative.replaceAll('\\', '/') });
    fs.cpSync(directory, path.join(target, 'core/node_modules', relative), { recursive: true,
      filter(file) {
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Dependency links are not packaged');
        const name = path.basename(file), nested = path.relative(directory, file).split(path.sep);
        return !nested.some(part => ['node_modules', 'test', 'tests', 'benchmark', 'benchmarks', '.github'].includes(part)) && name !== 'test.js' && !/\.test\.(mjs|cjs|js)$/.test(name);
      } });
    for (const name of Object.keys(metadata.dependencies ?? {})) includeModule(resolvePackage(name, directory));
  }
  for (const name of ['ajv', 'qrcode-generator', 'yauzl', 'yazl']) includeModule(path.join(moduleRoot, name));
  return [...modules.values()];
}
