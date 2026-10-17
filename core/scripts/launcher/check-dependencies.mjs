// Source launcher check: exits 1 and prints the differing package names when
// core/node_modules does not match core/package-lock.json (dev tools included).
import { fileURLToPath } from 'node:url';
import { dependencyDifferences } from '../../server/host/platform/dependencies.js';

const product = fileURLToPath(new URL('../../../', import.meta.url));
try {
  const names = dependencyDifferences(product, { includeDev: true });
  if (names.length) {
    console.log(names.slice(0, 5).join(', ') + (names.length > 5 ? ' (' + names.length + ')' : ''));
    process.exitCode = 1;
  }
} catch {
  console.log('core/package-lock.json');
  process.exitCode = 1;
}
