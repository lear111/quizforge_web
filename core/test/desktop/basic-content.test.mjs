import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageBasicContent, BASIC_EXTENSIONS } from '../../scripts/build/stage-basic-content.mjs';
import { Library } from '../../server/host/library/library.js';
import { RuleEngine } from '../../server/host/extensions/rule-engine.js';
const product = fileURLToPath(new URL('../../../', import.meta.url));
test('preview content stages one physical extension group and rewrites its bank without changing sources', async t => {
  const base = path.join(product, '.temp'); fs.mkdirSync(base, { recursive: true });
  const target = fs.mkdtempSync(path.join(base, 'staged-basics-'));
  t.after(() => { assert.equal(path.dirname(target), base); fs.rmSync(target, { recursive: true, force: true }); });
  const source = path.join(product, 'question-banks/基础题型/基础题型展示/bank.json'), before = fs.readFileSync(source);
  const result = stageBasicContent(product, target);
  assert.equal(result.extensions.length, 6); assert.deepEqual(fs.readdirSync(path.join(target, 'extensions')).sort(), ['README.md', '基础题型']);
  const raw = JSON.parse(fs.readFileSync(path.join(target, 'question-banks/基础题型/基础题型展示/bank.json')));
  for (const owner of [raw, ...raw.questions]) if (owner.extension?.path) assert.ok(owner.extension.path.startsWith('extensions/基础题型/'));
  for (const name of BASIC_EXTENSIONS) assert.ok(fs.existsSync(path.join(target, 'extensions/基础题型', name, 'manifest.json')));
  assert.deepEqual(fs.readFileSync(source), before);
  const core = path.join(product, 'core'), engine = await RuleEngine.create(core), library = new Library(target, core, engine);
  engine.validationEnvironment = async () => 'staged-basics';
  try { const row = library.index().banks[0], collection = await library.collection('bank', row.id); assert.equal(collection.questions.length, raw.questions.length); assert.equal(collection.extensions.length, 6); }
  finally { library.close(); engine.close(); }
});
