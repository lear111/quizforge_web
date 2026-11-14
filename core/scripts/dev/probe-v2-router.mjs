// Real-browser address/guard checks; disposable synthetic banks and loopback only.
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
import { captureBrowserFailure } from './v2-browser-failure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/v2/app.js';
const core = fileURLToPath(new URL('../../', import.meta.url)),
  repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-router-'));
const output = path.join(repo, '.temp/v2-router');
fs.mkdirSync(output, { recursive: true });
let server, browser;
const errors = [],
  rows = [];
const stems = {
  1: '下列哪一个是偶数？',
  2: '下列哪项属于计算机的输入设备？',
  3: '请选择英文单词 apple 的含义。',
};
const deferred = () => Promise.withResolvers();
function failure(route) {
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { code: 'STATE_WRITE_FAILED', message: '合成失败，请重试。' } }),
  });
}
function navigationButtons(page, name) {
  const drawer = async (kind) => {
    if (
      name === 'mobile' &&
      !(await page.locator(`.v2-${kind}`).evaluate((node) => node.classList.contains('open')))
    ) {
      await page
        .getByRole('button', { name: kind === 'outline' ? '大纲' : '题库', exact: true })
        .click();
    }
  };
  const go = async (qid) => {
    await drawer('outline');
    await page.locator(`[data-question-id="${qid}"]`).first().click();
  };
  const openBank = async (letter) => {
    await drawer('library');
    if (!(await page.locator('.library-item').first().isVisible())) {
      await page.locator('.extension-group-toggle').click();
    }
    await page
      .locator('.library-item')
      .filter({ hasText: `${name}-${letter}` })
      .click();
  };
  return { go, openBank };
}
function harness(page, origin, name, catalog) {
  const bank = (letter) =>
    catalog.groups[0].items.find((row) => row.title === `${name}-${letter}`).bankId;
  const id = bank('A'),
    other = bank('B'),
    base = `/api/v2/banks/${id}`;
  const url = (qid) => `${origin}/#/banks/${id}/questions/${qid}`;
  const frame = () => page.frameLocator('.v2-question-frame iframe');
  const idle = () =>
    page.waitForFunction(
      () => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false',
    );
  const question = async (qid) => {
    await page.waitForURL(url(qid));
    await frame().getByText(stems[qid], { exact: true }).waitFor();
    await idle();
  };
  const { go, openBank } = navigationButtons(page, name);
  const saved = () =>
    page
      .locator('.v2-save-status')
      .filter({ hasText: /^已保存$/ })
      .waitFor();
  const failed = () =>
    page
      .locator('.v2-save-status')
      .filter({ hasText: /^保存失败$/ })
      .waitFor();
  return {
    page,
    origin,
    name,
    id,
    other,
    base,
    url,
    frame,
    idle,
    question,
    go,
    openBank,
    saved,
    failed,
  };
}
async function checkPending(h) {
  const { page, base, frame, go, url, question } = h;
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));

  // Hold the actual save response: route, visible frame and next GET must stay put.
  const entered = deferred(),
    release = deferred();
  await page.route(`**${base}/questions/2/answer`, async (route) => {
    entered.resolve();
    await release.promise;
    await route.continue();
  });
  await frame().locator('input[value="B"]').check();
  await entered.promise;
  const before = requests.length;
  await go('3');
  assert.equal(page.url(), url('2'));
  assert.equal(
    requests.slice(before).some((u) => u.includes('/questions/3?')),
    false,
  );
  assert.equal(await frame().locator('input[value="B"]').isChecked(), true);
  release.resolve();
  await question('3');
  await page.unroute(`**${base}/questions/2/answer`);
}
async function checkFailedSave(h) {
  const { page, base, frame, failed, go, url, name, saved, question } = h;
  // Failed saves keep both the hash and input; navigation retries cannot lose it.
  await page.route(`**${base}/questions/3/answer`, failure);
  await frame().locator('input[value="A"]').check();
  await failed();
  const rejection = page.waitForResponse(
    (r) => r.url().endsWith('/questions/3/answer') && r.status() === 503,
  );
  await go('2');
  await rejection;
  await failed();
  assert.equal(page.url(), url('3'));
  assert.equal(await frame().locator('input[value="A"]').isChecked(), true);
  await page.unroute(`**${base}/questions/3/answer`);
  if (name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await saved();
  await go('2');
  await question('2');
  assert.equal(await frame().locator('input[value="B"]').isChecked(), true);
}
async function checkNativeHistory(h) {
  const { page, base, frame, failed, go, url, saved, question } = h;
  await go('1');
  await question('1');
  await page.goBack();
  await question('2');
  await page.goForward();
  await question('1');

  // Native browser back must roll its hash back too, not just UI button pushes.
  await page.route(`**${base}/questions/1/answer`, failure);
  await frame().locator('input[value="A"]').check();
  await failed();
  const backRejected = page.waitForResponse(
    (r) => r.url().endsWith('/questions/1/answer') && r.status() === 503,
  );
  await page.goBack();
  await backRejected;
  await page.waitForURL(url('1'));
  await failed();
  assert.equal(await frame().locator('input[value="A"]').isChecked(), true);
  await page.unroute(`**${base}/questions/1/answer`);
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await saved();
}
async function checkLoadRollback(h) {
  const { page, id, other, frame, question, openBank, origin, idle } = h;
  await page.evaluate((hash) => {
    location.hash = hash;
  }, `#/banks/${id}/questions/missing`);
  await page.locator('.v2-error').waitFor();
  await question('1');
  assert.equal(await frame().locator('input[value="A"]').isChecked(), true);

  await page.route(`**/banks/${other}/overview`, failure);
  await openBank('B');
  await page.locator('.v2-error').filter({ hasText: '合成失败' }).waitFor();
  await question('1');
  await page.unroute(`**/banks/${other}/overview`);
  await openBank('B');
  await page.waitForURL(`${origin}/#/banks/${other}/questions/1`);
  await idle();
  await openBank('A');
  await question('1');
}
async function checkSummary(h) {
  const { page, id, name, origin, idle } = h;
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '完成练习', exact: true }).click();
  await page.getByRole('heading', { name: '本轮练习已完成' }).waitFor();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  await page.getByRole('button', { name: '查看题目', exact: true }).waitFor({ state: 'visible' });
  await page.reload();
  await page.getByRole('heading', { name: '本轮练习已完成' }).waitFor();
  await idle();
  const originalFrame = await page.locator('.v2-question-frame iframe').elementHandle();
  await page.getByRole('button', { name: '查看题目', exact: true }).click();
  await page.waitForURL(/\/questions\//);
  await page.locator('.v2-question-frame iframe').waitFor({ state: 'visible' });
  assert.equal(
    await originalFrame.evaluate(
      (node) => node === document.querySelector('.v2-question-frame iframe'),
    ),
    true,
  );
  await page.getByRole('button', { name: '最终得分', exact: true }).click();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  assert.equal(
    await originalFrame.evaluate(
      (node) => node === document.querySelector('.v2-question-frame iframe'),
    ),
    true,
  );
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function exercise(page, origin, name, catalog) {
  const h = harness(page, origin, name, catalog);
  await page.addInitScript((id) => {
    if (window === window.top) {
      localStorage.setItem('quizforge.v2.last-bank', id);
    }
  }, h.id);
  await page.goto(origin);
  await page.locator('.v2-empty').waitFor();
  assert.equal(new URL(page.url()).hash, '#/');
  await page.goto(h.url('2'));
  await h.question('2');
  await page.reload();
  await h.question('2');
  await checkPending(h);
  await checkFailedSave(h);
  await checkNativeHistory(h);
  await checkLoadRollback(h);
  await checkSummary(h);
  rows.push({
    viewport: name,
    deepLink: true,
    reload: true,
    pendingSaveGuard: true,
    failedSaveGuard: true,
    nativeHistory: true,
    failedLoadRollback: true,
    bankReturn: true,
    summaryReload: true,
    sameFrame: true,
  });
}
try {
  copyBrowserFixture(root);
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, 'question-banks/基础题型/单选题展示/bank.json'), 'utf8'),
  );
  fs.rmSync(path.join(root, 'question-banks'), { recursive: true });
  for (const name of ['desktop-A', 'desktop-B', 'mobile-A', 'mobile-B']) {
    const directory = path.join(root, 'question-banks/演示', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, 'bank.json'),
      JSON.stringify({ ...fixture, title: name }),
    );
  }
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const catalog = await (await fetch(origin + '/api/v2/catalog')).json();
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await exercise(page, origin, name, catalog);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ rows, errors }, null, 2));
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
