import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
export async function probeRecovery({ bank, root, server, browser, errors, url }) {
  // Four locked pending questions exercise the real App, Worker and HTTP path:
  // first/current save fails, then invalid score, forged non-array, healthy.
  const reviewBank = structuredClone(bank);
  reviewBank.id = 'synthetic-review';
  reviewBank.title = '评分隔离';
  reviewBank.outline[0].items = reviewBank.outline[0].items.slice(0, 4);
  reviewBank.questions = Object.fromEntries(Object.entries(reviewBank.questions).slice(0, 4));
  for (const [id, question] of Object.entries(reviewBank.questions)) {
    question.question.probe = id;
  }
  const reviewDirectory = path.join(root, 'question-banks', '评分隔离', '评分隔离');
  fs.mkdirSync(reviewDirectory, { recursive: true });
  fs.writeFileSync(path.join(reviewDirectory, 'bank.json'), JSON.stringify(reviewBank));
  fs.writeFileSync(
    path.join(root, 'extensions/基础题型/单选题/grade.js'),
    `
    addEventListener('message',({data})=>{if(data.items[0].question.probe==='3')self.postMessage({job:data.job,results:{not:'an array'}});});
    QF.grader.register({grade(question){return {score:question.probe==='2'?9999:2};}});
  `,
  );
  const reviewId = server.library
    .locations()
    .find((row) => row.directory === reviewDirectory).bankId;
  const reviewOverview = server.library.open(reviewId);
  for (const item of reviewBank.outline[0].items) {
    server.library.write(reviewId, item.id, 'submit', {
      snapshotId: reviewOverview.snapshotId,
      expectedRevision: 0,
      answer: { selected: 'B' },
      requestId: 'review-' + item.id,
    });
  }
  const recoveryContext = await browser.newContext(),
    recovery = await recoveryContext.newPage();
  recovery.on('pageerror', (error) =>
    errors.push({ name: 'grading-isolation', message: error.message }),
  );
  await recovery.route('**/questions/1/result', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'STATE_WRITE_FAILED', message: 'synthetic interrupted first result' },
      }),
    }),
  );
  await recovery.goto(url);
  await recovery.locator('.extension-group-toggle').filter({ hasText: '评分隔离' }).click();
  await recovery.locator('[data-item-id]').filter({ hasText: '评分隔离' }).click();
  await recovery.waitForFunction(() =>
    document.querySelector('[data-question-id="4"]')?.classList.contains('correct'),
  );
  const review = server.library.open(reviewId),
    reviewStates = review.states;
  assert.deepEqual(
    review.pendingGrading.map((row) => row.question.questionId),
    ['1'],
  );
  assert.deepEqual(
    reviewStates.map((state) => state.status),
    ['unanswered', 'ungradable', 'ungradable', 'correct'],
  );
  assert.equal(reviewStates[3].score, 2);
  assert.ok(reviewStates.every((state) => state.locked));
  const warning = recovery.locator('[data-question-id="2"]');
  assert.match(await warning.getAttribute('title'), /无法评分/);
  assert.notEqual(
    await warning.evaluate((node) => getComputedStyle(node).backgroundColor),
    await recovery
      .locator('[data-question-id="1"]')
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  );
  await recoveryContext.close();
  return reviewStates;
}
export async function probeBadStart({ bank, root, browser, errors, url }) {
  // A broken starting question must not trap navigation to healthy neighbours.
  const badBank = structuredClone(bank);
  badBank.id = 'synthetic-bad-start';
  badBank.title = '坏题展示';
  badBank.questions['1'].question = [];
  const badDirectory = path.join(root, 'question-banks', '坏题校验', '坏题展示');
  fs.mkdirSync(badDirectory, { recursive: true });
  fs.writeFileSync(path.join(badDirectory, 'bank.json'), JSON.stringify(badBank));
  const errorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    errorPage = await errorContext.newPage();
  errorPage.on('pageerror', (error) => errors.push({ name: 'bad-start', message: error.message }));
  await errorPage.goto(url);
  await errorPage.locator('.extension-group-toggle').filter({ hasText: '坏题校验' }).click();
  await errorPage.locator('[data-item-id]').filter({ hasText: '坏题展示' }).click();
  await errorPage.getByRole('alert').waitFor();
  await errorPage.locator('[data-question-id="2"]').click();
  await errorPage
    .frameLocator('iframe[title="单选题作答"]')
    .getByRole('radio', { name: 'B', exact: true })
    .check();
  assert.equal(await errorPage.getByRole('alert').count(), 0);
  await errorContext.close();
}
