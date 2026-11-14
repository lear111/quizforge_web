import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { root } from '../../scripts/quality/scope.mjs';

const lint = new ESLint({
  cwd: root,
  overrideConfigFile: path.join(root, 'core/eslint.config.mjs'),
});
const architecture = async (text, file) =>
  (await lint.lintText(text, { filePath: `core/frontend/src/v2/${file}` }))[0].messages.filter(
    (message) => message.ruleId === 'frontendArchitecture/layers',
  );

test('D frontend layers reject reverse, re-export, dynamic, type and require imports', async () => {
  for (const [file, text] of [
    ['views/probe.ts', "import '../api';"],
    ['views/probe.ts', "import '../services/save-controller';"],
    ['components/probe.ts', "export * from '../views/PracticePage.vue';"],
    ['stores/probe.ts', "await import('../views/PracticePage.vue');"],
    ['api/probe.ts', "import type { Example } from '../stores/practice';"],
    ['services/probe.ts', "require('../stores/practice');"],
    ['stores/probe.ts', "import '../App.vue';"],
    ['services/probe.ts', "import '../main';"],
    ['api/probe.ts', "import '../../outline/OutlinePanel.vue';"],
    ['api/probe.ts', "import '../router/navigation';"],
    ['stores/probe.ts', "import '../router/navigation';"],
    ['router/probe.ts', "import '../views/WorkspaceView.vue';"],
  ]) {
    assert.equal((await architecture(text, file)).length, 1, `${file}: ${text}`);
  }
});

test('D frontend layers accept downward imports, shared types and root wiring', async () => {
  for (const [file, text] of [
    ['views/probe.ts', "import '../stores/practice';"],
    ['views/probe.ts', "import type { Question } from '../types/practice-types';"],
    ['stores/probe.ts', "import '../api'; import '../services/save-controller';"],
    ['api/probe.ts', "import '../services/types';"],
    ['services/probe.ts', "import type { PracticeApi } from '../api';"],
    ['main.ts', "import './App.vue'; import './stores/practice';"],
    ['views/probe.ts', "import '../router/injection';"],
    ['router/probe.ts', "import '../stores/practice';"],
    ['router/index.ts', "import '../views/WorkspaceView.vue';"],
  ]) {
    assert.deepEqual(await architecture(text, file), [], `${file}: ${text}`);
  }
});

test('D fetch is limited to api including global, computed and alias references', async () => {
  for (const text of [
    'fetch("/");',
    'window.fetch("/");',
    'globalThis["fetch"]("/");',
    'const request = fetch; request("/");',
    'const { fetch: request } = window; request("/");',
  ]) {
    assert.ok((await architecture(text, 'services/probe.ts')).length > 0, text);
    assert.deepEqual(await architecture(text, 'api/probe.ts'), [], text);
  }
});
