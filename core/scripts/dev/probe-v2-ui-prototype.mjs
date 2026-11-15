// Reproducible visual evidence: tracked public example, disposable records and loopback only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/v2/app.js';
import { captureBrowserFailure } from './v2-browser-failure.mjs';

const core = fileURLToPath(new URL('../../', import.meta.url));
const repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-ui-prototype-'));
const output = path.join(repo, '.temp/v2-ui-prototype');
fs.mkdirSync(output, { recursive: true });
let server, browser;
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
}
async function screenshot(page, name) {
  await settled(page);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}
async function evidence(page, name, origin, id) {
  const prototype = path.join(
    core,
    'docs/design/prototype',
    'quizforge-v2-mobile-overlay-bottom-nav-animated.html',
  );
  await page.goto(pathToFileURL(prototype).href);
  await screenshot(page, `${name}-prototype`);
  if (name === 'mobile') {
    await page.locator('#toggle-lib').click();
    await screenshot(page, 'mobile-prototype-library');
  }
  await page.goto(`${origin}/#/banks/${id}/questions/single-sample-text`);
  await page.frameLocator('.v2-question-frame iframe').getByRole('radio').first().waitFor();
  await page.locator('.v2-card[aria-busy="false"]').waitFor();
  if (name === 'desktop') {
    await page.locator('.extension-group-toggle').click();
  }
  await screenshot(page, `${name}-vue`);
  if (name !== 'mobile') {
    return;
  }
  await page.getByRole('button', { name: '题库', exact: true }).click();
  await page.locator('.extension-group-toggle').click();
  await screenshot(page, 'mobile-vue-library');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await screenshot(page, 'mobile-vue-outline');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  await screenshot(page, 'mobile-vue-draft');
  await page.getByRole('button', { name: '题库', exact: true }).click();
  await screenshot(page, 'mobile-vue-draft-drawer');
}
try {
  fs.cpSync(path.join(repo, 'examples/v2/extensions'), path.join(root, 'extensions'), {
    recursive: true,
  });
  const source = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  const directory = path.join(root, 'question-banks/基础题型/基础题型展示');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(path.join(source, 'bank.json'), path.join(directory, 'bank.json'));
  fs.cpSync(path.join(source, 'assets'), path.join(directory, 'assets'), { recursive: true });
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const catalog = await (await fetch(origin + '/api/v2/catalog')).json();
  const id = catalog.groups[0].items[0].bankId;
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  const errors = [];
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await evidence(page, name, origin, id);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, errors }, null, 2));
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
