// Optional real-Chromium acceptance. Playwright is supplied from an ignored
// directory and is not a project dependency. Only synthetic copied data is used.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { V2Server } from '../../server/host/v2/server.js';
const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const playwright = process.argv[2];
if (!playwright) throw Error('Supply the temporary Playwright index.mjs path.');
const { chromium } = await import(pathToFileURL(path.resolve(playwright)).href);
const output = path.join(repo, '.temp', 'v2-practice'); fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-practice-'));
let browser, server;
const rows = [], errors = [];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  fs.cpSync(path.join(repo, 'examples', 'v2'), root, { recursive: true });
  const bankDirectory = path.join(root, 'question-banks', '基础题型', '单选题展示');
  const bank = JSON.parse(fs.readFileSync(path.join(bankDirectory, 'bank.json'), 'utf8'));
  // 20 measured questions plus one independent interrupted-grading case.
  bank.outline[0].items = [];
  const original = structuredClone(bank.questions['1']); bank.questions = {};
  for (let i = 1; i <= 21; i++) { bank.outline[0].items.push({ id: String(i), label: String(i), maxScore: 2 }); bank.questions[i] = structuredClone(original); }
  fs.writeFileSync(path.join(bankDirectory, 'bank.json'), JSON.stringify(bank));
  server = await new V2Server({ root, codeRoot: core }).start();
  const url = `http://127.0.0.1:${server.port()}/`;
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  for (const [name, viewport, offset] of [['desktop', { width: 1440, height: 900 }, 0], ['mobile', { width: 390, height: 844 }, 10]]) {
    const context = await browser.newContext({ viewport }); const page = await context.newPage();
    page.on('pageerror', error => errors.push({ name, message: error.message }));
    const leaked = [];
    page.on('response', async response => { if (response.url().includes('/questions/') && response.request().method() === 'GET') { const body = await response.json().catch(() => null); if (body?.state?.locked === false && body.solution !== null) leaked.push(response.url()); } });
    const frame = () => page.frameLocator('iframe[title="单选题作答"]');
    async function open() {
      if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click();
      await page.getByRole('button', { name: '展开 g_', exact: false }).click();
      const start = performance.now();
      await page.locator('[data-item-id]').click();
      await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
      return performance.now() - start;
    }
    await page.goto(url); await page.locator('.extension-group-toggle').waitFor({ state: 'attached' });
    const openMs = await open();
    // Negative path: failed submit leaves the selected option intact and hides solution.
    let failed = false;
    if (name === 'desktop') {
      await frame().getByRole('radio', { name: 'B', exact: true }).check();
      await page.route('**/questions/1/submit', route => { failed = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STATE_WRITE_FAILED', message: '测试：本次未保存' } }) }); });
      await page.getByRole('button', { name: '提交答案', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '本次未保存' }).waitFor();
      assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
      assert.equal(await frame().locator('#explanation').isVisible(), false); await page.unroute('**/questions/1/submit'); assert.ok(failed);
    }
    const timings = [];
    for (let n = 1; n <= 10; n++) {
      const qid = String(offset + n);
      if (qid !== '1') {
        if (name === 'mobile') await page.getByRole('button', { name: '大纲', exact: true }).click();
        await page.locator(`[data-question-id="${qid}"]`).click();
        await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: '提交答案', exact: true }).waitFor({ state: 'visible' });
      }
      await frame().getByRole('radio', { name: n % 2 ? 'B' : 'A', exact: true }).check();
      const start = performance.now(); await page.getByRole('button', { name: '提交答案', exact: true }).click();
      await page.locator('.v2-answer-footer strong').filter({ hasText: n % 2 ? '2 / 2 分' : '0 / 2 分' }).waitFor();
      await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
      timings.push(performance.now() - start);
    }
    if (name === 'desktop') {
      await page.locator('[data-question-id="21"]').click();
      await frame().getByRole('radio', { name: 'B', exact: true }).check();
      await page.route('**/questions/21/result', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '测试：评分保存中断' } }) }));
      await page.getByRole('button', { name: '提交答案', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '评分保存中断' }).waitFor();
      assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
      await page.unroute('**/questions/21/result');
    }
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.reload(); await page.locator('.extension-group-toggle').waitFor({ state: 'attached' }); await open();
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
    await page.locator('.v2-answer-footer strong').filter({ hasText: '2 / 2 分' }).waitFor();
    if (name === 'desktop') {
      // Opening the bank auto-recovers the OTHER pending question without a click.
      await page.waitForFunction(() => document.querySelector('[data-question-id="21"]')?.classList.contains('correct'));
      const recovered = await page.evaluate(async () => {
        const catalog = await fetch('/api/v2/catalog').then(r => r.json()), id = catalog.groups[0].items[0].bankId;
        const overview = await fetch(`/api/v2/banks/${id}/overview`).then(r => r.json());
        return { pending: overview.pendingGrading.length, state: overview.states.find(s => s.questionId === '21') };
      });
      assert.equal(recovered.pending, 0); assert.equal(recovered.state.status, 'graded'); assert.equal(recovered.state.score, 2);
    }
    assert.deepEqual(leaked, []);
    rows.push({ viewport: name, samples: timings.length, openMs, submitMedianMs: percentile(timings, .5), submitP95Ms: percentile(timings, .95) });
    await context.close();
  }
  // A broken starting question must not trap navigation to healthy neighbours.
  const badBank = structuredClone(bank); badBank.id = 'synthetic-bad-start'; badBank.title = '坏题展示'; badBank.questions['1'].question = [];
  const badDirectory = path.join(root, 'question-banks', '坏题校验', '坏题展示'); fs.mkdirSync(badDirectory, { recursive: true }); fs.writeFileSync(path.join(badDirectory, 'bank.json'), JSON.stringify(badBank));
  const errorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }), errorPage = await errorContext.newPage();
  errorPage.on('pageerror', error => errors.push({ name: 'bad-start', message: error.message }));
  await errorPage.goto(url); await errorPage.locator('.extension-group-toggle').filter({ hasText: '坏题校验' }).click();
  await errorPage.locator('[data-item-id]').filter({ hasText: '坏题展示' }).click(); await errorPage.getByRole('alert').waitFor();
  await errorPage.locator('[data-question-id="2"]').click();
  await errorPage.frameLocator('iframe[title="单选题作答"]').getByRole('radio', { name: 'B', exact: true }).check();
  assert.equal(await errorPage.getByRole('alert').count(), 0); await errorContext.close();
  assert.deepEqual(errors, []);
  const report = { browser: browser.version(), node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`, rows, pageErrors: errors, scope: 'Synthetic data, desktop/mobile viewports, not a real mobile device or release acceptance.' };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); await server?.close(); fs.rmSync(root, { recursive: true, force: true }); }
