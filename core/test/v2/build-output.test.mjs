import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ensureUi, uiNeedsBuild } from '../../scripts/build/ensure-ui.mjs';

const products = ['quizforge-ui.js', 'quizforge-web-local.css', 'THIRD_PARTY_NOTICES.txt'];
const inputs = [
  'frontend/src/App.vue',
  'frontend/src/nested/theme.css',
  'frontend/vite.config.ts',
  'package.json',
  'package-lock.json',
  'scripts/build/build-ui.mjs',
  'node_modules/.package-lock.json',
];
const time = (offset) => new Date(1600000000000 + offset * 1000);
function fixture(t) {
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-build-output-'));
  t.after(() => fs.rmSync(core, { recursive: true, force: true }));
  const write = (file, offset) => {
    const absolute = path.join(core, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, `synthetic ${file}`);
    fs.utimesSync(absolute, time(offset), time(offset));
  };
  for (const file of inputs) {
    write(file, 0);
  }
  const compile = async (directory) => {
    assert.equal(directory, core);
    for (const name of products) {
      write('web/ui/' + name, 40);
    }
  };
  for (const name of products) {
    write('web/ui/' + name, 10);
  }
  return { core, compile, write };
}

test('warm source startup reuses generated UI without invoking the compiler or rewriting notices', async (t) => {
  const { core } = fixture(t);
  const file = path.join(core, 'web/ui/THIRD_PARTY_NOTICES.txt');
  const before = fs.readFileSync(file),
    modified = fs.statSync(file).mtimeMs;
  assert.equal(await uiNeedsBuild(core), false);
  assert.equal(await ensureUi(core, () => assert.fail('warm startup must not compile')), false);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.statSync(file).mtimeMs, modified);
});

test('missing generated UI or license notices rebuild before source startup', async (t) => {
  for (const name of products) {
    await t.test(name, async (t) => {
      const { core, compile } = fixture(t);
      fs.unlinkSync(path.join(core, 'web/ui', name));
      assert.equal(await ensureUi(core, compile), true);
      assert.equal(await uiNeedsBuild(core), false);
      for (const product of products) {
        assert.ok(fs.existsSync(path.join(core, 'web/ui', product)));
      }
    });
  }
});

test('nested source, configuration, build script and dependency changes invalidate generated UI', async (t) => {
  for (const input of inputs) {
    await t.test(input, async (t) => {
      const { core, compile, write } = fixture(t);
      write(input, 30);
      assert.equal(await uiNeedsBuild(core), true);
      assert.equal(await ensureUi(core, compile), true);
      assert.equal(await uiNeedsBuild(core), false);
    });
  }
});

test('failed source UI build is propagated and leaves retained runtime files and notices untouched', async (t) => {
  const { core, write } = fixture(t);
  const before = products.map((name) => fs.readFileSync(path.join(core, 'web/ui', name)));
  write('frontend/src/App.vue', 30);
  const error = Error('synthetic compiler failure');
  await assert.rejects(
    ensureUi(core, async () => {
      throw error;
    }),
    (caught) => caught === error,
  );
  assert.equal(await uiNeedsBuild(core), true);
  products.forEach((name, index) =>
    assert.deepEqual(fs.readFileSync(path.join(core, 'web/ui', name)), before[index]),
  );
});

test('source launch and npm test/start entries build UI before running the host', () => {
  const root = new URL('../../../', import.meta.url);
  for (const name of [
    'Start-QuizForge-V2.cmd',
    '启动 V2 基础题型演示.cmd',
    '启动 V2 单选题演示.cmd',
  ]) {
    const source = fs.readFileSync(new URL(name, root), 'utf8');
    assert.ok(source.indexOf('ensure-ui.mjs') < source.indexOf('v2-main.mjs'));
    assert.match(source, /ensure-ui\.mjs\r?\nif errorlevel 1 goto :failed/);
    assert.match(source, /:failed\r?\npause\r?\nexit \/b 1/);
  }
  const scripts = JSON.parse(fs.readFileSync(new URL('core/package.json', root), 'utf8')).scripts;
  for (const entry of ['prestart', 'pretest', 'pretest:host']) {
    assert.equal(scripts[entry], 'node scripts/build/ensure-ui.mjs');
  }
  const legacy = fs.readFileSync(new URL('Start-QuizForge-Web.ps1', root), 'utf8');
  const start = legacy.lastIndexOf('scripts/build/ensure-ui.mjs');
  assert.ok(start > 0 && start < legacy.indexOf('$entryPoint ='));
  assert.match(legacy.slice(start), /LASTEXITCODE -ne 0/);
});
