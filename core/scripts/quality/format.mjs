import fs from 'node:fs/promises';
import path from 'node:path';
import * as prettier from 'prettier';
import { root, sourceFiles } from './scope.mjs';
import config from '../../prettier.config.mjs';

const write = process.argv.includes('--write');
let failures = 0;
for (const file of sourceFiles()) {
  const absolute = path.join(root, file);
  const input = await fs.readFile(absolute, 'utf8');
  const options = { ...config, filepath: absolute };
  const output = await prettier.format(input, options);
  if (input !== output) {
    if (write) {
      await fs.writeFile(absolute, output);
    } else {
      console.error(file);
      failures++;
    }
  }
}
console.log(`Format: ${sourceFiles().length} files, ${failures} differences.`);
if (failures) {
  process.exitCode = 1;
}
