import { captureBrowserFailure } from './v2-browser-failure.mjs';
// Real Chromium, curated demo copied into disposable banks; no author records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/v2/app.js';
const core = fileURLToPath(new URL('../../', import.meta.url)),
  repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-completion-')),
  output = path.join(repo, '.temp/v2-completion');
fs.mkdirSync(output, { recursive: true });
let server, browser;
try {
  fs.cpSync(path.join(repo, 'examples/v2/extensions'), path.join(root, 'extensions'), {
    recursive: true,
  });
  const source = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  for (const name of ['desktop', 'mobile', 'rollback']) {
    const directory = path.join(root, 'question-banks/basic', name);
    fs.mkdirSync(directory, { recursive: true });
    const bank = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
    bank.title = name;
    fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify(bank));
    fs.cpSync(path.join(source, 'assets'), path.join(directory, 'assets'), { recursive: true });
  }
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route) => {
    const r = await fetch(origin + route);
    assert.equal(r.ok, true);
    return r.json();
  };
  const catalog = await api('/api/v2/catalog'),
    rows = [],
    errors = [];
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    const id = catalog.groups[0].items.find((i) => i.title === name).bankId,
      base = `/api/v2/banks/${id}`;
    const frame = () => page.frameLocator('.v2-question-frame iframe');
    const idle = () =>
      page.waitForFunction(
        () => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false',
      );
    const go = async (id) => {
      if (name === 'mobile') {
        await page.getByRole('button', { name: '大纲', exact: true }).click();
      }
      await page.locator(`[data-question-id="${id}"]`).first().click();
      await idle();
    };
    const bank = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8')),
      first = bank.outline[0].items[0].id;
    await page.goto(origin);
    if (name === 'mobile') {
      await page.getByRole('button', { name: '题库', exact: true }).click();
    }
    await page.locator('.extension-group-toggle').click();
    await page.locator('.library-item').filter({ hasText: name }).click();
    await idle();
    const rollbackId = catalog.groups[0].items.find((i) => i.title === 'rollback').bankId,
      rollbackBase = `/api/v2/banks/${rollbackId}`;
    const rollback = await api(rollbackBase + '/overview');
    assert.equal(
      (
        await fetch(origin + rollbackBase + '/finish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'rollback-finish', snapshotId: rollback.snapshotId }),
        })
      ).ok,
      true,
    );
    await page.route('**/extensions/*/manifest', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'STORAGE_UNAVAILABLE', message: '合成题型加载失败' },
        }),
      }),
    );
    if (name === 'mobile') {
      await page.getByRole('button', { name: '题库', exact: true }).click();
    }
    await page.locator('.library-item').filter({ hasText: 'rollback' }).click();
    await page.locator('.v2-error').filter({ hasText: '合成题型加载失败' }).waitFor();
    await idle();
    assert.equal(await page.getByRole('heading', { name: '本轮练习已完成' }).count(), 0);
    assert.equal(
      await frame()
        .locator('input')
        .evaluateAll((nodes) => nodes.every((n) => !n.disabled)),
      true,
    );
    await page.unroute('**/extensions/*/manifest');
    await frame().locator(`input[value="${bank.questions[first].solution.selected}"]`).check();
    let accept = false,
      dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs++;
      assert.equal(dialog.type(), 'confirm');
      if (accept) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
    await page.getByRole('button', { name: '完成练习', exact: true }).click();
    assert.equal((await api(base + '/overview')).completedAt, null);
    // A saved then cleared choice must be zeroed rather than sent to the grader.
    await go('multiple-sample-numbers');
    await frame().locator('input[value="number-2"]').check();
    await frame().locator('input[value="number-2"]').uncheck();
    await go('true-false-sample-false');
    await frame().locator('input[value="false"]').check();
    const bodies = [],
      order = [];
    page.on('request', (request) => {
      if (/\/(finish|results)$/.test(request.url())) {
        order.push(request.url().split('/').at(-1));
      }
    });
    await page.route('**/results', (route) => {
      bodies.push(route.request().postData());
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'STATE_WRITE_FAILED', message: '合成评分写入失败' },
        }),
      });
    });
    await page.route('**/questions/true-false-sample-false?*', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'STORAGE_UNAVAILABLE', message: '合成题目回读失败' },
        }),
      }),
    );
    accept = true;
    await page.getByRole('button', { name: '完成练习', exact: true }).click();
    await page.getByRole('heading', { name: '本轮练习已完成' }).waitFor();
    await page.getByRole('button', { name: '继续评分', exact: true }).waitFor({ state: 'visible' });
    await page
      .getByRole('button', { name: '继续评分', exact: true })
      .isEnabled()
      .then((enabled) => {
        if (!enabled) {
          return page.getByRole('button', { name: '继续评分', exact: true }).waitFor();
        }
      });
    await page.locator('.v2-error').filter({ hasText: '合成评分写入失败' }).waitFor();
    const failed = await api(base + '/overview');
    assert.ok(failed.completedAt);
    assert.equal(failed.pendingGrading.length, 2);
    assert.ok(failed.states.every((s) => s.locked));
    assert.equal(failed.states.find((s) => s.questionId === 'multiple-sample-numbers').score, 0);
    assert.deepEqual(
      JSON.parse(bodies[0])
        .results.map((r) => r.questionId)
        .sort(),
      [first, 'true-false-sample-false'].sort(),
    );
    await page.getByRole('button', { name: '查看题目', exact: true }).click();
    await idle();
    assert.equal(await frame().getByRole('button', { name: '提交答案', exact: true }).count(), 0);
    assert.equal(await frame().getByRole('button', { name: '重做', exact: true }).count(), 0);
    assert.equal(
      await frame()
        .locator('input')
        .evaluateAll((nodes) => nodes.every((n) => n.disabled)),
      true,
    );
    await page.unroute('**/questions/true-false-sample-false?*');
    let individualResults = 0;
    page.on('request', (request) => {
      if (/\/questions\/[^/]+\/result$/.test(request.url())) {
        individualResults++;
      }
    });
    await go(first);
    assert.equal(individualResults, 0);
    assert.equal((await api(base + '/overview')).total.score, 0);
    await page.getByRole('button', { name: '最终得分', exact: true }).click();
    await page.unroute('**/results');
    page.on('request', (r) => {
      if (r.url().endsWith('/results')) {
        bodies.push(r.postData());
      }
    });
    await page.getByRole('button', { name: '继续评分', exact: true }).click();
    await page.locator('.v2-final-score strong').filter({ hasText: /^4$/ }).waitFor();
    assert.equal(bodies[0], bodies[1]);
    assert.equal(order[0], 'finish');
    assert.equal(dialogs, 2);
    await page.reload();
    await page.getByRole('heading', { name: '本轮练习已完成' }).waitFor();
    await idle();
    assert.equal(await page.locator('.v2-final-score strong').textContent(), '4');
    await go('true-false-sample-false');
    assert.equal(await page.getByRole('heading', { name: '本轮练习已完成' }).count(), 0);
    assert.equal(await frame().getByRole('button', { name: '提交答案', exact: true }).count(), 0);
    assert.equal(await frame().getByRole('button', { name: '重做', exact: true }).count(), 0);
    await page.getByRole('button', { name: '草稿', exact: true }).click();
    await page.locator('button[data-tool="pen"]').click();
    const box = await page.locator('.v2-viewport').boundingBox();
    const x = box.x + 40,
      y = box.y + Math.min(300, box.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 60, y + 25, { steps: 5 });
    await page.mouse.up();
    await page
      .locator('.v2-save-status')
      .filter({ hasText: /^已保存$/ })
      .waitFor();
    const final = await api(base + '/overview');
    assert.equal(final.total.score, 4);
    assert.ok(final.states.some((s) => s.hasInk));
    await page.getByRole('button', { name: '返回作答', exact: true }).click();
    await page.getByRole('button', { name: '最终得分', exact: true }).click();
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    rows.push({
      name,
      failedBankKeepsView: true,
      pendingViewDoesNotScoreIndividually: true,
      cancelLeavesActive: true,
      zeroClearedAnswer: true,
      flushBeforeFinish: true,
      groupedBatch: true,
      replayBodyStable: true,
      failedReadStaysLocked: true,
      score: final.total,
      reopenSummary: true,
      lockedScratch: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        rows,
        errors,
        scope:
          'Copied curated demo; isolated loopback; desktop/mobile Chromium viewports, not real mobile devices.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
