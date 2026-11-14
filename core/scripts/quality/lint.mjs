import { ESLint } from 'eslint';
import path from 'node:path';
import { root, sourceFiles } from './scope.mjs';

const lint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, 'core/eslint.config.mjs'),
});
const results = await lint.lintFiles(sourceFiles());
console.log((await lint.loadFormatter('stylish')).format(results));
const errors = results.reduce((total, result) => total + result.errorCount, 0);
const warnings = results.reduce((total, result) => total + result.warningCount, 0);
console.log(`Lint: ${results.length} files, ${errors} errors, ${warnings} warnings.`);
if (errors || warnings) {
  process.exitCode = 1;
}
