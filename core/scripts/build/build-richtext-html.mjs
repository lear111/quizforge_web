import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const core = path.resolve(import.meta.dirname, '../..');
const directory = path.join(core, 'shared/richtext/2.0.0');
const output = await build({
  entryPoints: [path.join(directory, 'src/static.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  write: false,
});
const bytes = output.outputFiles[0].contents;
const licenses = [];
for (const [name, version, file] of [
  ['DOMPurify', '3.4.18', 'dompurify/LICENSE'],
  ['KaTeX', '0.16.43', 'katex/LICENSE'],
]) {
  const metadata = JSON.parse(
    await fs.readFile(path.join(core, 'node_modules', name.toLowerCase(), 'package.json')),
  );
  if (metadata.version !== version) {
    throw new Error(`${name} must be ${version}`);
  }
  licenses.push(
    `## ${name} ${version}\n\n${await fs.readFile(path.join(core, 'node_modules', file), 'utf8')}`,
  );
}
const notices = '# Bundled dependencies\n\n' + licenses.join('\n\n');
for (const [file, content] of [
  ['richtext.js', bytes],
  ['THIRD_PARTY_NOTICES.md', notices],
]) {
  if (process.argv.includes('--check')) {
    if (!Buffer.from(await fs.readFile(path.join(directory, file))).equals(Buffer.from(content))) {
      throw new Error(`${file} differs from its locked source build`);
    }
  } else {
    await fs.writeFile(path.join(directory, file), content);
  }
}
console.log(
  JSON.stringify({
    jsMinified: bytes.length,
    jsGzip: gzipSync(bytes).length,
    css: (await fs.stat(path.join(directory, 'richtext.css'))).size,
  }),
);
