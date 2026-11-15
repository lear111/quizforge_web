import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('V2 entry dependency graph excludes the entire v1 rules, runner, validation and HTTP graph', async () => {
  const entry = fileURLToPath(new URL('../../server/v2-main.mjs', import.meta.url));
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
    external: ['express'],
  });
  const files = Object.keys(result.metafile.inputs).map((file) => file.replaceAll('\\', '/'));
  assert.ok(files.some((file) => file.endsWith('/v2/app.js')));
  assert.ok(files.some((file) => file.endsWith('/platform/json.js')));
  for (const file of files) {
    assert.doesNotMatch(
      file,
      /(?:node_modules\/|rule-engine|rules-runner|validation-cache|write-environment|host\/http\/server|host\/practice\/)/,
    );
  }
  for (const data of Object.values(result.metafile.inputs)) {
    for (const imported of data.imports) {
      if (imported.external) {
        assert.ok(imported.path === 'express' || imported.path.startsWith('node:'), imported.path);
        assert.doesNotMatch(imported.path, /child_process|worker_threads|node:vm$/);
      }
    }
  }
});
