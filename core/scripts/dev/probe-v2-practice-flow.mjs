import assert from 'node:assert/strict';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
export async function exerciseViewport({
  browser,
  name,
  viewport,
  offset,
  errors,
  url,
  output,
  rows,
}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push({ name, message: error.message }));
  const leaked = [];
  page.on('response', async (response) => {
    if (response.url().includes('/questions/') && response.request().method() === 'GET') {
      const body = await response.json().catch(() => null);
      if (body?.state?.locked === false && body.solution !== null) {
        leaked.push(response.url());
      }
    }
  });
  const frame = () => page.frameLocator('iframe[title="单选题作答"]');
  async function open() {
    if (name === 'mobile') {
      await page.getByRole('button', { name: '题库', exact: true }).click();
    }
    await page.getByRole('button', { name: '展开 g_', exact: false }).click();
    const start = performance.now();
    await page.locator('[data-item-id]').click();
    await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
    return performance.now() - start;
  }
  await page.goto(url);
  await page.locator('.extension-group-toggle').waitFor({ state: 'attached' });
  const openMs = await open();
  // Negative path: failed submit leaves the selected option intact and hides solution.
  let failed = false;
  if (name === 'desktop') {
    await frame().getByRole('radio', { name: 'B', exact: true }).check();
    await page.route('**/questions/1/submit', (route) => {
      failed = true;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'STATE_WRITE_FAILED', message: '测试：本次未保存' },
        }),
      });
    });
    await page
      .frameLocator('.v2-question-frame iframe')
      .getByRole('button', { name: '提交答案', exact: true })
      .click();
    await page.getByRole('alert').filter({ hasText: '本次未保存' }).waitFor();
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
    assert.equal(await frame().locator('#explanation').isVisible(), false);
    await page.unroute('**/questions/1/submit');
    assert.ok(failed);
  }
  const timings = [];
  for (let n = 1; n <= 10; n++) {
    const qid = String(offset + n);
    if (qid !== '1') {
      if (name === 'mobile') {
        await page.getByRole('button', { name: '大纲', exact: true }).click();
      }
      await page.locator(`[data-question-id="${qid}"]`).click();
      await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
      await page
        .frameLocator('.v2-question-frame iframe')
        .getByRole('button', { name: '提交答案', exact: true })
        .waitFor({ state: 'visible' });
    }
    await frame()
      .getByRole('radio', { name: n % 2 ? 'B' : 'A', exact: true })
      .check();
    const start = performance.now();
    await page
      .frameLocator('.v2-question-frame iframe')
      .getByRole('button', { name: '提交答案', exact: true })
      .click();
    await page
      .frameLocator('.v2-question-frame iframe')
      .locator('#result')
      .filter({ hasText: n % 2 ? '2 / 2 分' : '0 / 2 分' })
      .waitFor();
    await frame().getByRole('radio', { name: 'B', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
    timings.push(performance.now() - start);
  }
  if (name === 'desktop') {
    await page.locator('[data-question-id="21"]').click();
    await frame().getByRole('radio', { name: 'B', exact: true }).check();
    await page.route('**/questions/21/result', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: '测试：评分保存中断' } }),
      }),
    );
    await page
      .frameLocator('.v2-question-frame iframe')
      .getByRole('button', { name: '提交答案', exact: true })
      .click();
    await page.getByRole('alert').filter({ hasText: '评分保存中断' }).waitFor();
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
    await page.unroute('**/questions/21/result');
  }
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await page.locator('.extension-group-toggle').waitFor({ state: 'attached' });
  await open();
  // Position restoration now returns to 21/20, not always question 1.
  if (name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  await page.locator(`[data-question-id="${offset + 1}"]`).click();
  await frame().getByRole('radio', { name: 'B', exact: true }).waitFor();
  assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
  assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
  await page
    .frameLocator('.v2-question-frame iframe')
    .locator('#result')
    .filter({ hasText: '2 / 2 分' })
    .waitFor();
  if (name === 'desktop') {
    // Opening the bank auto-recovers the OTHER pending question without a click.
    await page.waitForFunction(() =>
      document.querySelector('[data-question-id="21"]')?.classList.contains('correct'),
    );
    const recovered = await page.evaluate(async () => {
      const catalog = await fetch('/api/v2/catalog').then((r) => r.json()),
        id = catalog.groups[0].items[0].bankId;
      const overview = await fetch(`/api/v2/banks/${id}/overview`).then((r) => r.json());
      return {
        pending: overview.pendingGrading.length,
        state: overview.states.find((s) => s.questionId === '21'),
      };
    });
    assert.equal(recovered.pending, 0);
    assert.equal(recovered.state.status, 'correct');
    assert.equal(recovered.state.score, 2);
  }
  assert.deepEqual(leaked, []);
  rows.push({
    viewport: name,
    samples: timings.length,
    openMs,
    submitMedianMs: percentile(timings, 0.5),
    submitP95Ms: percentile(timings, 0.95),
  });
  await context.close();
}
