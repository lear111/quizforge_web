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
    'core/frontend/src/v2/styles/workspace.css',
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

test('V2 length policy exempts literals and rejects oversized code outside tests', async () => {
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
  assert.equal(result.errorCount, 1);
  assert.ok(
    result.messages.some(
      (message) => message.ruleId === 'max-lines-per-function' && message.severity === 2,
    ),
  );
  const vue = await lint.calculateConfigForFile('core/frontend/src/v2/LengthProbe.vue');
  assert.equal(vue.rules['max-lines'][0], 2);
  assert.equal(vue.rules['max-lines'][1].max, 150);
  const tests = await lint.calculateConfigForFile('core/test/v2/length-probe.test.mjs');
  assert.equal(tests.rules['max-lines'][0], 0);
  assert.equal(tests.rules['max-lines-per-function'][0], 0);
});

test('H length errors retain file limits and exclude blank and comment lines', async () => {
  const file = 'core/server/v2/length-probe.js';
  const configuration = await lint.calculateConfigForFile(file);
  for (const [rule, max] of [
    ['max-lines', 300],
    ['max-lines-per-function', 50],
  ]) {
    assert.deepEqual(configuration.rules[rule], [
      2,
      {
        max,
        skipBlankLines: true,
        skipComments: true,
      },
    ]);
  }
  const [oversized] = await lint.lintText('void 0;\n'.repeat(301), { filePath: file });
  assert.equal(oversized.errorCount, 1);
  assert.equal(oversized.messages[0].ruleId, 'max-lines');
  assert.equal(oversized.messages[0].severity, 2);
  const comments = '\n// ignored line\n'.repeat(301);
  assert.deepEqual(await rules('export function short() {\n' + comments + '}\n', file), []);
});

test('H browser closure exceptions apply only to the two named probe files', async () => {
  for (const [name, max] of [
    ['probe-v2-grading.mjs', 137],
    ['probe-v2-page-review.mjs', 76],
    ['probe-v2-page.mjs', 50],
    ['probe-v2-practice-flow.mjs', 50],
  ]) {
    const configured = await lint.calculateConfigForFile('core/scripts/dev/' + name);
    assert.deepEqual(configured.rules['max-lines-per-function'], [
      2,
      {
        max,
        skipBlankLines: true,
        skipComments: true,
      },
    ]);
    assert.equal(configured.rules['max-lines'][1].max, 300);
  }
});

test('D48 layer rule rejects reverse imports, controller disk access and bypasses', async () => {
  const rejected = [
    ['controllers', "import '../repositories/state.repository.js';"],
    ['repositories', "export * from '../services/practice.service.js';"],
    ['services', "export { createHandlers } from '../controllers/http.controller.js';"],
    ['utils', "await import('../services/bank.service.js');"],
    ['routes', "import '../services/bank.service.js';"],
    ['middleware', "import '../controllers/http.controller.js';"],
    ['services', "import '../app.js';"],
    ['controllers', "import 'node:fs';"],
    ['services', "await import('node:fs/promises');"],
    ['controllers', "import '../../host/platform/files.js';"],
    ['controllers', "require('../repositories/state.repository.js');"],
  ];
  for (const [layer, text] of rejected) {
    assert.ok(
      (await rules(text, `core/server/v2/${layer}/layer-probe.js`)).includes(
        'architecture/backend-layers',
      ),
      `${layer}: ${text}`,
    );
  }
});

test('D48 layer rule accepts downward, same-layer and shared utility imports plus app wiring', async () => {
  for (const [layer, text] of [
    ['routes', "import '../controllers/http.controller.js';"],
    ['controllers', "import '../services/bank.service.js';"],
    ['services', "import '../repositories/state.repository.js';"],
    ['services', "import './question.service.js';"],
    ['repositories', "import '../utils/io.js';"],
    ['repositories', "import '../../host/platform/files.js';"],
    ['utils', "import './errors.js';"],
  ]) {
    assert.deepEqual(await rules(text, `core/server/v2/${layer}/layer-probe.js`), []);
  }
  assert.deepEqual(
    await rules("import './repositories/state.repository.js';", 'core/server/v2/app.js'),
    [],
  );
});

test('E data declarations allow type-only dependencies and keep runtime layer restrictions', async () => {
  assert.deepEqual(
    await rules(
      "import type { Snapshot } from '../types/data.js';\nexport type Value = Snapshot;",
      'core/server/v2/utils/type-probe.d.ts',
    ),
    [],
  );
  for (const [text, file] of [
    ["import '../types/data.js';", 'core/server/v2/utils/runtime-probe.js'],
    [
      "import type { PracticeState } from '../services/practice.service.js';\nexport type Value = PracticeState;",
      'core/server/v2/utils/type-probe.d.ts',
    ],
  ]) {
    assert.ok((await rules(text, file)).includes('architecture/backend-layers'));
  }
  const overloads = `export declare function probe(value: string): string;
    export declare function probe(value: number): number;`;
  assert.deepEqual(await rules(overloads, 'core/server/v2/utils/overloads.d.ts'), []);
  assert.ok(
    (
      await rules(
        'let value = 1; let value = 2; export { value };',
        'core/server/v2/utils/duplicate.ts',
      )
    ).includes('@typescript-eslint/no-redeclare'),
  );
});
