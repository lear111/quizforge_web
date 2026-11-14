import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

export async function buildUi(core = path.resolve(import.meta.dirname, '../..'), { check = false } = {}) {
  const result = await build({ configFile: path.join(core, 'frontend/vite.config.ts'), root: path.join(core, 'frontend'), build: { write: !check } });
  const license = await fs.readFile(path.join(core, 'node_modules/@vue/runtime-dom/LICENSE'), 'utf8');
  const { version } = JSON.parse(await fs.readFile(path.join(core, 'node_modules/vue/package.json'), 'utf8'));
  const piniaLicense = await fs.readFile(path.join(core, 'node_modules/pinia/LICENSE'), 'utf8');
  const { version: piniaVersion } = JSON.parse(await fs.readFile(path.join(core, 'node_modules/pinia/package.json'), 'utf8'));
  const nosticsLicense = await fs.readFile(path.join(core, 'node_modules/nostics/LICENSE'), 'utf8');
  const routerLicense = await fs.readFile(path.join(core, 'node_modules/vue-router/LICENSE'), 'utf8');
  const { version: routerVersion } = JSON.parse(await fs.readFile(path.join(core, 'node_modules/vue-router/package.json'), 'utf8'));
  const notices = `QuizForge UI bundles Vue ${version} runtime (@vue/runtime-dom, runtime-core, reactivity, shared).\nSource: https://github.com/vuejs/core\n\n${license}\nQuizForge UI bundles Pinia ${piniaVersion}.\nSource: https://github.com/vuejs/pinia\n\n${piniaLicense}\nPinia dependency: nostics (MIT).\n\n${nosticsLicense}\nQuizForge UI bundles Vue Router ${routerVersion}.\nSource: https://github.com/vuejs/router\n\n${routerLicense}`;
  if (!check) return fs.writeFile(path.join(core, 'web/ui/THIRD_PARTY_NOTICES.txt'), notices);
  for (const file of [...(Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output), { fileName: 'THIRD_PARTY_NOTICES.txt', source: notices }]) {
    const expected = Buffer.from(file.type === 'chunk' ? file.code : file.source);
    let actual;
    try { actual = await fs.readFile(path.join(core, 'web/ui', file.fileName)); } catch { /* report a fixed, actionable message below */ }
    if (!actual?.equals(expected)) throw Error('UI build is missing or stale; run npm --prefix core run build:ui.');
  }
  console.log('UI build matches source and licenses.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw Error('Only --check is supported.');
  await buildUi(undefined, { check: process.argv.includes('--check') });
}
