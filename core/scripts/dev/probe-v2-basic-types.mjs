// Real Chromium acceptance of the tracked public showcase, never user records.
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
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-basic-')),
  output = path.join(repo, '.temp/v2-basic-types');
fs.mkdirSync(output, { recursive: true });
let server, browser;
try {
  fs.cpSync(path.join(repo, 'examples/v2/extensions'), path.join(root, 'extensions'), {
    recursive: true,
  });
  const source = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  const bank = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
  for (const name of ['desktop', 'mobile']) {
    const directory = path.join(root, 'question-banks/basic', name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify({ ...bank, title: name }));
    fs.cpSync(path.join(source, 'assets'), path.join(directory, 'assets'), { recursive: true });
  }
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route) => {
    const r = await fetch(origin + route);
    assert.equal(r.ok, true);
    return r.json();
  };
  const ids = Object.fromEntries(
    (await api('/api/v2/catalog')).groups[0].items.map((i) => [i.title, i.bankId]),
  );
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  const errors = [],
    rows = [];
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    const frame = () => page.frameLocator('.v2-question-frame iframe');
    const idle = () =>
      page.waitForFunction(
        () => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false',
      );
    const saved = () =>
      page
        .locator('.v2-save-status')
        .filter({ hasText: /^已保存$/ })
        .waitFor();
    const go = async (id) => {
      if (name === 'mobile') {
        await page.getByRole('button', { name: '大纲', exact: true }).click();
      }
      await page.locator(`[data-question-id="${id}"]`).first().click();
      await idle();
      if (
        name === 'mobile' &&
        (await page.locator('.v2-outline').evaluate((n) => n.classList.contains('open')))
      ) {
        await page.getByRole('button', { name: '大纲', exact: true }).click();
      }
    };
    const base = '/api/v2/banks/' + ids[name];
    const read = async (id) => {
      const o = await api(base + '/overview');
      return api(`${base}/questions/${id}?snapshotId=${o.snapshotId}`);
    };
    const initial = await api(base + '/overview');
    const solutionText = JSON.stringify(Object.values(bank.questions).map((q) => q.solution));
    assert.equal(initial.initial.question.solution, null);
    assert.ok(!JSON.stringify(initial).includes(solutionText));
    await page.goto(origin);
    if (name === 'mobile') {
      await page.getByRole('button', { name: '题库', exact: true }).click();
    }
    await page.locator('.extension-group-toggle').click();
    await page.locator('.library-item').filter({ hasText: name }).click();
    await idle();
    // Multi-choice clearing reports unanswered immediately, and false is a real answer.
    await go('multiple-sample-numbers');
    await frame().locator('input[value="number-2"]').check();
    await saved();
    await frame().locator('input[value="number-2"]').uncheck();
    await page.waitForFunction(() =>
      document
        .querySelector('[data-question-id="multiple-sample-numbers"]')
        .classList.contains('unanswered'),
    );
    await saved();
    assert.deepEqual((await read('multiple-sample-numbers')).answer, { selected: [] });
    await frame().locator('input[value="number-2"]').check();
    await saved();
    await go('true-false-sample-false');
    await frame().locator('input[value="false"]').check();
    await saved();
    assert.equal((await read('true-false-sample-false')).state.status, 'answered');
    await go('multiple-sample-numbers');
    assert.equal(await frame().locator('input[value="number-2"]').isChecked(), true);
    assert.equal(await frame().locator('input:checked').count(), 1);
    await frame().locator('input[value="number-2"]').uncheck();
    await saved();
    await go('true-false-sample-false');
    assert.equal(await frame().locator('input[value="false"]').isChecked(), true);
    await frame().getByRole('button', { name: '重做', exact: true }).click();
    await idle();
    await go('multiple-sample-numbers');
    // Failed save retains both checks and the current question; retry saves once.
    await page.route('**/questions/multiple-sample-numbers/answer', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'STATE_WRITE_FAILED', message: '合成写入失败' } }),
      }),
    );
    await frame().locator('input[value="number-2"]').check();
    await page.locator('.v2-save-status').filter({ hasText: '保存失败' }).waitFor();
    await go('true-false-sample-false');
    assert.equal(await frame().locator('input[value="number-2"]').isChecked(), true);
    await page.unroute('**/questions/multiple-sample-numbers/answer');
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await saved();
    // Incomplete answer is zero, retry clears answer, then all seven originals score exactly.
    await frame().getByRole('button', { name: '提交答案', exact: true }).click();
    await frame().locator('#result').filter({ hasText: '0 / 4 分' }).waitFor();
    await idle();
    await frame().getByRole('button', { name: '重做', exact: true }).click();
    await idle();
    assert.equal(await frame().locator('input:checked').count(), 0);
    for (const group of bank.outline) {
      for (const item of group.items) {
        const q = bank.questions[item.id];
        await go(item.id);
        if (item.id.includes('table')) {
          assert.ok((await frame().locator('table').count()) > 0);
          assert.equal(
            await frame()
              .locator('table')
              .first()
              .evaluate((n) => getComputedStyle(n).borderCollapse),
            'collapse',
          );
        }
        if (item.id === 'single-sample-image-math') {
          assert.equal(
            await frame()
              .locator('img')
              .evaluateAll(
                (nodes) => nodes.length > 0 && nodes.every((n) => n.complete && n.naturalWidth > 0),
              ),
            true,
          );
          assert.ok((await frame().locator('math').count()) > 0);
          await page.screenshot({
            path: path.join(output, name + '-image-math.png'),
            fullPage: true,
          });
        }
        if (group.title === '判断题') {
          await frame().locator(`input[value="${q.solution.value}"]`).check();
        } else {
          for (const id of [].concat(q.solution.selected)) {
            await frame().locator(`input[value="${id}"]`).check();
          }
        }
        await saved();
        const answer = (await read(item.id)).answer;
        assert.deepEqual(
          answer,
          group.title === '判断题'
            ? { value: q.solution.value }
            : { selected: q.solution.selected },
        );
        const before = page.frames().find((f) => f.parentFrame());
        await frame().getByRole('button', { name: '提交答案', exact: true }).click();
        await frame()
          .locator('#result')
          .filter({ hasText: `${item.maxScore} / ${item.maxScore} 分` })
          .waitFor();
        await idle();
        assert.equal(
          page.frames().find((f) => f.parentFrame()),
          before,
          'grading updates the existing iframe',
        );
        const locked = await read(item.id);
        assert.equal(locked.state.locked, true);
        assert.equal(locked.state.score, item.maxScore);
        assert.equal(
          await frame().getByRole('button', { name: '提交答案', exact: true }).isVisible(),
          false,
        );
        if (item.id === 'multiple-sample-tables') {
          await page.screenshot({ path: path.join(output, name + '-tables.png'), fullPage: true });
        }
        assert.equal(
          await frame()
            .locator('input')
            .evaluateAll((nodes) => nodes.every((n) => n.disabled)),
          true,
        );
      }
    }
    // A wrong true/false answer scores zero; reload restores the locked false answer.
    await frame().getByRole('button', { name: '重做', exact: true }).click();
    await idle();
    await frame().locator('input[value="true"]').check();
    await saved();
    await frame().getByRole('button', { name: '提交答案', exact: true }).click();
    await frame().locator('#result').filter({ hasText: '0 / 2 分' }).waitFor();
    await idle();
    await frame().getByRole('button', { name: '重做', exact: true }).click();
    await idle();
    await frame().locator('input[value="false"]').check();
    await saved();
    await page.reload();
    await frame().locator('input[value="false"]').waitFor();
    await idle();
    assert.equal(await frame().locator('input[value="false"]').isChecked(), true);
    // Post-lock scratch remains writable without changing the locked answer/result.
    await frame().getByRole('button', { name: '提交答案', exact: true }).click();
    await frame().locator('#result').filter({ hasText: '2 / 2 分' }).waitFor();
    await idle();
    const locked = await read('true-false-sample-false');
    await page.getByRole('button', { name: '草稿', exact: true }).click();
    await page.locator('button[data-tool="pen"]').click();
    const rect = await page.locator('.v2-viewport').boundingBox(),
      x = rect.x + rect.width * 0.4,
      y = rect.y + 240;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 20, { steps: 8 });
    await page.mouse.up();
    await saved();
    const after = await read('true-false-sample-false');
    assert.equal(after.ink.strokes.length, 1);
    assert.deepEqual(after.answer, locked.answer);
    assert.deepEqual(after.result, locked.result);
    assert.deepEqual(after.submissionId, locked.submissionId);
    await page.getByRole('button', { name: '返回作答', exact: true }).click();
    await page.getByRole('button', { name: '刷新题库', exact: true }).click();
    await idle();
    assert.equal(await frame().locator('input[value="false"]').isChecked(), true);
    await frame().getByRole('button', { name: '重做', exact: true }).click();
    await idle();
    const cleared = await read('true-false-sample-false');
    assert.equal(cleared.answer, null);
    assert.equal(cleared.ink, null);
    assert.equal(cleared.state.status, 'unanswered');
    rows.push({
      name,
      questions: 7,
      exactOriginalScores: true,
      imagesMathTables: true,
      noCrossQuestionInput: true,
      falseIsAnswered: true,
      clearMultiIsUnanswered: true,
      failedSaveRetained: true,
      sameFrameOnGrade: true,
      lockedScratch: true,
      retryAndRefresh: true,
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { browser: browser.version(), rows, errors };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  server?.server.closeAllConnections();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
