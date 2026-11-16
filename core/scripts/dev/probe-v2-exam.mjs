import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/v2/app.js';
import { captureBrowserFailure } from './v2-browser-failure.mjs';
import { probeApi } from './v2-completion-result.mjs';

const core = fileURLToPath(new URL('../../', import.meta.url));
const examples = path.join(core, '..', 'examples', 'v2');
const examStart = Date.parse('2026-02-01T08:00:00Z');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-exam-browser-'));
const source = path.join(examples, 'question-banks/基础题型/基础题型展示');
const bank = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
const first = bank.outline[0].items[0].id;
const option = bank.questions[first].solution.selected;

function createBank(name) {
  const directory = path.join(root, 'question-banks', 'exam-fixture', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.cpSync(path.join(source, 'assets'), path.join(directory, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify({ ...bank, title: name }));
}

async function selectBank(page, name, mobile, expand = false) {
  if (mobile) {
    await page.getByRole('button', { name: '题库', exact: true }).click();
  }
  if (expand) {
    await page.locator('.extension-group-toggle').click();
  }
  const previous = page.url();
  await page.locator('.library-item').getByText(name, { exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
  await page.waitForURL((url) => url.href !== previous && url.hash.includes('/questions/'));
  await choice(page).waitFor();
}

function choice(page) {
  return page.frameLocator('.v2-question-frame iframe').locator(`input[value="${option}"]`);
}

async function choose(page) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/answer') && response.request().method() === 'PUT' && response.ok(),
  );
  await choice(page).check();
  await saved;
}

async function startExam(page) {
  await page.getByRole('button', { name: '开始考试', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const duration = dialog.getByLabel('考试时长（分钟）');
  await duration.fill('1.5');
  assert.equal(await duration.evaluate((input) => input.validity.stepMismatch), true);
  await duration.fill('1');
  await dialog.getByRole('button', { name: '开始', exact: true }).click();
  await page.getByRole('timer').waitFor();
  assert.match(await page.getByRole('timer').innerText(), /考试中\s+00:0[01]:[0-5][0-9]/);
  const q = page.frameLocator('.v2-question-frame iframe');
  await choice(page).waitFor();
  assert.equal(await q.getByRole('button', { name: '提交答案' }).count(), 0);
  assert.equal(await q.getByRole('button', { name: '重做' }).count(), 0);
  assert.equal(await page.locator('.v2-outline .v2-legend .correct').count(), 0);
  assert.equal(await choice(page).isChecked(), false);
}

async function desktop(page, fixture) {
  const { origin, api, base, setTime } = fixture;
  await page.goto(origin);
  await selectBank(page, 'exercise-desktop', false, true);
  await choose(page);
  await startExam(page);
  await choose(page);
  await selectBank(page, 'exercise-other', false);
  assert.equal(await page.getByRole('timer').count(), 0);
  setTime(12500);
  await selectBank(page, 'exercise-desktop', false);
  assert.equal(await choice(page).isChecked(), true);
  assert.match(await page.getByRole('timer').innerText(), /00:00:4\d/);

  const submit = page.getByRole('button', { name: '交卷', exact: true });
  page.once('dialog', (dialog) => dialog.dismiss());
  await submit.click();
  assert.equal((await api(base + '/overview')).completedAt, null);
  await page.route(`**${base}/results`, (route) => route.abort());
  page.once('dialog', (dialog) => dialog.accept());
  await submit.click();
  await page.getByRole('heading', { name: '考试已交卷' }).waitFor();
  await page.locator('.v2-error').waitFor();
  const pending = await api(base + '/overview');
  assert.ok(pending.completedAt);
  assert.equal(pending.pendingGrading.length, 1);
  await page.unroute(`**${base}/results`);
  let handIns = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(base + '/finish')) {
      handIns++;
    }
  });
  await page.reload();
  await page.locator('.v2-final-score strong').filter({ hasText: /^2$/ }).waitFor();
  assert.equal(handIns, 0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '归档并返回练习' }).click();
  await page.getByRole('button', { name: '开始考试', exact: true }).waitFor();
  assert.equal(await choice(page).isChecked(), true);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.getByText('考试 · 用时 00:00:12').waitFor();
  const [entry] = await api(base + '/rounds');
  assert.equal(entry.kind, 'exam');
  assert.equal(entry.score, 2);
  const overview = await api(base + '/overview');
  assert.equal(overview.exam, null);
  assert.equal(overview.initial.question.state.locked, false);
}

async function simulateLostFinish(page, base) {
  const requests = [];
  await page.route(`**${base}/finish`, (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'STATE_WRITE_FAILED', message: '合成交卷网络失败' } }),
    });
  });
  return requests;
}

async function timed(page, fixture, { away }) {
  const { origin, api, base, setTime, name } = fixture;
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.goto(origin);
  await selectBank(page, name, true, true);
  await startExam(page);
  await choose(page);
  const requests = await simulateLostFinish(page, base);
  setTime(65001);
  if (away) {
    await page.reload();
  } else {
    await page.clock.fastForward(61_000);
  }
  await page.locator('.v2-error').filter({ hasText: '合成交卷网络失败' }).waitFor();
  assert.equal(requests.length, 1);
  assert.equal((await api(base + '/overview')).completedAt, null);
  assert.equal(await page.locator('.v2-question-frame').evaluate((region) => region.inert), true);
  assert.equal(await page.getByRole('button', { name: '草稿', exact: true }).isEnabled(), true);

  // No automatic retry loop. A failed send can safely be retried explicitly.
  await page.clock.fastForward(20_000);
  assert.equal(requests.length, 1);
  await page.unroute(`**${base}/finish`);
  await page.getByRole('button', { name: '重试交卷' }).click();
  await page.getByRole('heading', { name: '考试已交卷' }).waitFor();
  await page.locator('.v2-final-score strong').filter({ hasText: /^2$/ }).waitFor();
  const overview = await api(base + '/overview');
  assert.equal(overview.pendingGrading.length, 0);
  assert.equal(overview.completedAt, new Date(examStart + 65001).toISOString());
}

async function runCase(browser, fixture, check, mobile) {
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await check(page, fixture);
  assert.deepEqual(errors, []);
  await context.close();
}

let server, browser;
try {
  fs.cpSync(path.join(examples, 'extensions'), path.join(root, 'extensions'), { recursive: true });
  for (const name of ['exercise-desktop', 'exercise-mobile', 'exercise-reopen', 'exercise-other']) {
    createBank(name);
  }
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = probeApi(origin);
  const catalog = await api('/api/v2/catalog');
  const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  const setTime = (offset) => {
    server.library.stateStore.now = () => new Date(examStart + offset).toISOString();
  };
  for (const [name, check, mobile] of [
    ['exercise-desktop', desktop, false],
    ['exercise-mobile', (page, fixture) => timed(page, fixture, { away: false }), true],
    ['exercise-reopen', (page, fixture) => timed(page, fixture, { away: true }), true],
  ]) {
    setTime(0);
    const { bankId } = catalog.groups[0].items.find((item) => item.title === name);
    await runCase(
      browser,
      { name, origin, api, base: '/api/v2/banks/' + bankId, setTime },
      check,
      mobile,
    );
  }
  console.log(
    JSON.stringify({
      chromium: browser.version(),
      passed: [
        'desktop early hand-in and archive',
        'mobile deadline and retry',
        'mobile reopen expired exam',
      ],
    }),
  );
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
