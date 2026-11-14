// View-only router probe steps, called on disposable synthetic banks.
import path from 'node:path';
import assert from 'node:assert/strict';
const deferred = () => Promise.withResolvers();
export async function checkSummary(h, output) {
  const { page, id, name, origin, idle } = h;
  page.once('dialog', (dialog) => dialog.accept());
  if (name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  await page.locator('.v2-summary-entry').click();
  await page.getByRole('button', { name: '完成练习', exact: true }).click();
  await page.getByRole('heading', { name: '练习已完成' }).waitFor();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  await page.getByRole('button', { name: '返回题目', exact: true }).waitFor({ state: 'visible' });
  await page.reload();
  await page.getByRole('heading', { name: '练习已完成' }).waitFor();
  await idle();
  const originalFrame = await page.locator('.v2-question-frame iframe').elementHandle();
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  await page.waitForURL(/\/questions\//);
  await page.locator('.v2-question-frame iframe').waitFor({ state: 'visible' });
  assert.equal(
    await originalFrame.evaluate(
      (node) => node === document.querySelector('.v2-question-frame iframe'),
    ),
    true,
  );
  if (name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  await page.locator('.v2-summary-entry').click();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  assert.equal(
    await originalFrame.evaluate(
      (node) => node === document.querySelector('.v2-question-frame iframe'),
    ),
    true,
  );
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}

export async function checkReload(h) {
  const { page, name, question } = h;
  const entered = deferred(),
    release = deferred();
  if (name === 'mobile') {
    await page.route('**/extensions/*/manifest', async (route) => {
      entered.resolve();
      await release.promise;
      await route.continue();
    });
  }
  await page.reload();
  if (name === 'mobile') {
    await entered.promise;
    await page.getByRole('button', { name: '题库', exact: true }).click();
    release.resolve();
  }
  await question('2');
  if (name === 'mobile') {
    assert.equal(
      await page.locator('.v2-library').evaluate((node) => node.classList.contains('open')),
      true,
    );
    await page.getByRole('button', { name: '题库', exact: true }).click();
    await page.unroute('**/extensions/*/manifest');
  }
}
