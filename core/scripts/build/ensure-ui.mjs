import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const outputNames = ['quizforge-ui.js', 'quizforge-web-local.css', 'THIRD_PARTY_NOTICES.txt'];
async function newestSource(directory) {
  let newest = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? await newestSource(file) : (await fs.stat(file)).mtimeMs,
    );
  }
  return newest;
}

export async function uiNeedsBuild(core) {
  let outputs;
  try {
    outputs = await Promise.all(
      outputNames.map((name) => fs.stat(path.join(core, 'web/ui', name))),
    );
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
  const inputs = [
    'frontend/vite.config.ts',
    'package.json',
    'package-lock.json',
    'scripts/build/build-ui.mjs',
  ];
  let newest = await newestSource(path.join(core, 'frontend/src'));
  for (const file of inputs) {
    newest = Math.max(newest, (await fs.stat(path.join(core, file))).mtimeMs);
  }
  // npm ci replaces this file even when the checked-out lockfile has an older timestamp.
  try {
    newest = Math.max(
      newest,
      (await fs.stat(path.join(core, 'node_modules/.package-lock.json'))).mtimeMs,
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  return outputs.some((output) => output.mtimeMs < newest);
}

export async function ensureUi(core = path.resolve(import.meta.dirname, '../..'), build) {
  if (!(await uiNeedsBuild(core))) {
    return false;
  }
  console.log('UI build is missing or stale; building from core/frontend source.');
  const compile = build ?? (await import('./build-ui.mjs')).buildUi;
  await compile(core);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await ensureUi();
}
