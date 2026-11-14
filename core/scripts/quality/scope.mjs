import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const sourcePatterns = [
  'core/server/host/v2/**/*.{js,mjs,cjs,ts}',
  'core/frontend/src/v2/**/*.{js,ts,vue}',
  'core/frontend/src/v2/**/*.css',
  'core/shared/v2/**/*.{js,ts}',
  'core/test/v2/**/*.{js,mjs,cjs,ts}',
  'examples/v2/**/*.{js,mjs,cjs,ts}',
  'core/scripts/dev/*v2*.mjs',
  'core/scripts/quality/*.mjs',
  'core/eslint.config.mjs',
  'core/prettier.config.mjs',
];

// Git's source list keeps local practice records and copied dependencies out.
export function sourceFiles() {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => sourcePatterns.some((pattern) => path.matchesGlob(file, pattern)))
    .sort();
}
