// Extra route checks on the disposable B bank used by the existing router probe.
import assert from 'node:assert/strict';

export async function checkCompletionRouting(h, resetRecords) {
  const { page, origin, other, name, frame, idle, openBank } = h;
  const base = `/api/v2/banks/${other}`;
  const questionUrl = `${origin}/#/banks/${other}/questions/1`;
  const summaryUrl = `${origin}/#/banks/${other}/summary`;
  await openBank('B');
  await page.waitForURL(questionUrl);
  await idle();
  await frame().locator('input[value="B"]').check();
  await h.saved();
  const before = await (await page.request.get(origin + base + '/overview?questionId=2')).json();
  const finished = await page.request.post(origin + base + '/finish', {
    data: { requestId: `f7-${name}`, snapshotId: before.snapshotId },
  });
  assert.equal(finished.ok(), true);
  await checkExternalCompletion(h, base, questionUrl);
  await page.getByRole('button', { name: '刷新题库', exact: true }).click();
  await page.waitForURL(summaryUrl);
  await page.getByRole('heading', { name: '练习已完成', exact: true }).waitFor();
  await idle();
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  await page.waitForURL(questionUrl);
  await idle();

  await checkChangedCompletion(h, base, questionUrl);
  await checkQuestionReset(h, base, before);
  await page.getByRole('button', { name: '刷新题库', exact: true }).click();
  await page.waitForURL(summaryUrl);
  resetRecords();
  // Actual filesystem reset of this synthetic bank; the real backend reloads
  // it. Continue grading must leave the summary only through Router.
  await page.getByRole('button', { name: '继续评分', exact: true }).click();
  await page.waitForURL(questionUrl);
  await idle();
  assert.equal(await page.locator('.v2-card').isVisible(), true);
  assert.equal(await page.locator('.v2-final-score').count(), 0);
  await page.reload();
  await page.waitForURL(questionUrl);
  await frame().getByText('下列哪一个是偶数？', { exact: true }).waitFor();
  await idle();
  await checkReopen(h);
}

async function checkQuestionReset(h, base, activeOverview) {
  const { page, origin, other, frame, idle } = h;
  // Replay a valid active overview captured before completion, with question 2
  // selected. No grading/saving implementation is replaced by this fixture.
  assert.equal(activeOverview.initial.question.questionId, '2');
  await page.route(`**${base}/overview`, (route) => route.fulfill({ json: activeOverview }));
  await page.getByRole('button', { name: '继续评分', exact: true }).click();
  await frame().getByText('下列哪项属于计算机的输入设备？', { exact: true }).waitFor();
  await idle();
  assert.equal(page.url(), `${origin}/#/banks/${other}/questions/2`);
  assert.equal(await page.locator('.v2-card').isVisible(), true);
  await page.unroute(`**${base}/overview`);
}

async function checkExternalCompletion(h, base, questionUrl) {
  const { page, frame, idle } = h;
  const rejected = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${base}/questions/1/answer`) && response.status() === 409,
  );
  await frame().locator('input[value="A"]').check();
  await rejected;
  await page.getByRole('alert').filter({ hasText: '已载入最新内容' }).waitFor();
  await idle();
  assert.equal(page.url(), questionUrl);
  assert.equal(await page.locator('.v2-card').isVisible(), true);
  assert.equal(await frame().getByRole('button', { name: '提交答案', exact: true }).count(), 0);
}

async function checkReopen(h) {
  const { page, origin, id, openBank, frame, idle } = h;
  await openBank('A');
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  await page.getByRole('heading', { name: '练习已完成', exact: true }).waitFor();
  await idle();
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  await page.waitForURL(`${origin}/#/banks/${id}/questions/1`);
  await idle();
  await page.reload();
  await page.waitForURL(`${origin}/#/banks/${id}/questions/1`);
  await frame().getByText('下列哪一个是偶数？', { exact: true }).waitFor();
  await idle();
  assert.equal(await page.locator('.v2-final-score').count(), 0);
}

async function checkChangedCompletion(h, base, questionUrl) {
  const { page, idle } = h;
  await page.route(`**${base}/overview`, async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    value.completedAt = '2030-01-02T03:04:05.000Z';
    await route.fulfill({ response, json: value });
  });
  await page.route(`**${base}/results`, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'STATE_WRITE_FAILED', message: 'F7 synthetic batch failure' },
      }),
    }),
  );
  await page.getByRole('button', { name: '继续评分', exact: true }).click();
  await page.locator('.v2-error').filter({ hasText: 'F7 synthetic batch failure' }).waitFor();
  await idle();
  assert.equal(page.url(), questionUrl);
  assert.equal(await page.locator('.v2-card').isVisible(), true);
  assert.equal(await page.locator('.v2-final-score').count(), 0);
  await page.unroute(`**${base}/overview`);
  await page.unroute(`**${base}/results`);
}
