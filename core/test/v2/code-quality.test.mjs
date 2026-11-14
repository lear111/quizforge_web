import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { check, format } from 'prettier';
import config from '../../prettier.config.mjs';
import { root, sourceFiles } from '../../scripts/quality/scope.mjs';

const lint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, 'core/eslint.config.mjs'),
});
const rules = async (text, file) =>
  (await lint.lintText(text, { filePath: file }))[0].messages.map((message) => message.ruleId);

test('V2 quality scope excludes V1 and generated files', () => {
  const files = sourceFiles();
  for (const file of [
    'core/server/v2/app.js',
    'core/frontend/src/v2/App.vue',
    'core/frontend/src/v2/workspace.css',
    'core/shared/v2/answered.js',
    'core/scripts/dev/probe-v2-basic-types.mjs',
  ]) {
    assert.ok(files.includes(file), file);
  }
  assert.ok(files.some((file) => file.startsWith('examples/v2/')));
  assert.ok(files.every((file) => !file.includes('/.qf-v2/')));
  assert.ok(!files.includes('core/web/app.js'));
  assert.ok(!files.includes('core/web/ui/quizforge-ui.js'));
  assert.ok(!files.includes('core/server/host/platform/json.js'));
});

test('V2 JavaScript lint rejects common errors and compressed lines', async () => {
  const messages = await rules(
    `const unused = 1; missing();\n// ${'x'.repeat(101)}\n`,
    'core/server/v2/quality-probe.js',
  );
  for (const id of ['no-unused-vars', 'no-undef', 'max-len', 'max-statements-per-line']) {
    assert.ok(messages.includes(id), id);
  }
  assert.deepEqual(
    await rules('export const element = document.body;\n', 'examples/v2/quality-probe.js'),
    [],
  );
  assert.deepEqual(await rules('QF.register({});\n', 'examples/v2/quality-probe.js'), []);
  assert.ok((await rules('unknownSdk();\n', 'examples/v2/quality-probe.js')).includes('no-undef'));
  assert.ok(
    (await rules('process.exit();\n', 'examples/v2/quality-probe.js')).includes('no-undef'),
  );
});

test('V2 TypeScript and Vue lint distinguishes template use from unused declarations', async () => {
  assert.ok(
    (await rules('const unused: number = 1;\n', 'core/frontend/src/v2/quality-probe.ts')).includes(
      '@typescript-eslint/no-unused-vars',
    ),
  );
  const component =
    '<script setup lang="ts">\nconst text: string = "hello";\n</script>\n' +
    '<template><p>{{ text }}</p></template>\n';
  assert.deepEqual(await rules(component, 'core/frontend/src/v2/QualityProbe.vue'), []);
});

test('V2 formatter checks without writing and converges with shared configuration', async () => {
  const text = 'export const data={value:1};\n';
  const options = { ...config, filepath: 'probe.ts' };
  assert.equal(await check(text, options), false);
  const formatted = await format(text, options);
  assert.equal(await check(formatted, options), true);
  assert.equal(text, 'export const data={value:1};\n');
  assert.equal(config.printWidth, 100);
});

test('V2 length policy exempts literals and reports size as warnings outside tests', async () => {
  const long = 'x'.repeat(120);
  const literalLines = [
    `export const quoted = '${long}';`,
    'export const template = `' + long + '`;',
    `export const expression = /${long}/;`,
    `// https://example.test/${long}`,
  ].join('\n');
  assert.deepEqual(await rules(literalLines, 'core/server/v2/literal-probe.js'), []);
  const body = `export function longFunction() {\n${'  void 0;\n'.repeat(51)}}\n`;
  const [result] = await lint.lintText(body, {
    filePath: 'core/server/v2/length-probe.js',
  });
  assert.equal(result.errorCount, 0);
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === 'max-lines-per-function' && message.severity === 1,
    ),
  );
  const vue = await lint.calculateConfigForFile('core/frontend/src/v2/LengthProbe.vue');
  assert.equal(vue.rules['max-lines'][0], 1);
  assert.equal(vue.rules['max-lines'][1].max, 150);
  const tests = await lint.calculateConfigForFile('core/test/v2/length-probe.test.mjs');
  assert.equal(tests.rules['max-lines'][0], 0);
  assert.equal(tests.rules['max-lines-per-function'][0], 0);
});
