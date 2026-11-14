// #73 follow-up: actual Chromium, synthetic banks, isolated loopback port.
// No production instrumentation, user data, fixed sleeps or project dependency.
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
import { captureBrowserFailure } from './v2-browser-failure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { V2Server } from '../../server/v2/app.js';
const core = fileURLToPath(new URL('../../', import.meta.url)),
  repo = path.dirname(core);
if (!process.argv[2]) {
  throw Error('Supply the temporary Playwright index.mjs path.');
}
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-page-review-')),
  output = path.join(repo, '.temp/v2-page-review');
fs.mkdirSync(output, { recursive: true });
let server, browser;
const frame = (page) => page.frameLocator('.v2-question-frame iframe');
const idle = (page) =>
  page.waitForFunction(
    () => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false',
  );
const saved = (page) =>
  page
    .locator('.v2-save-status')
    .filter({ hasText: /^已保存$/ })
    .waitFor();
const notice = (page) =>
  page.getByRole('alert').filter({ hasText: '本题已在别处修改，已载入最新内容' }).waitFor();
const go = async (page, id) => {
  await page.bringToFront();
  await page.locator(`[data-question-id="${id}"]`).click();
  await page.locator(`[data-question-id="${id}"][aria-current="true"]`).waitFor();
  await idle(page);
};
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};

// All marks use performance.timeOrigin + performance.now() to align the opaque
// iframe and host clocks. Probe messages report marks only, no answer contents.
function instrument() {
  const now = () => performance.timeOrigin + performance.now();
  if (window !== parent) {
    addEventListener(
      'change',
      (event) => {
        if (event.target?.matches?.('input[type=radio]')) {
          parent.postMessage({ probe: 'input', at: now() }, '*');
        }
      },
      true,
    );
    return;
  }
  window.saveMeasures = [];
  let row;
  addEventListener('message', (event) => {
    if (event.data?.probe === 'input') {
      row = { input: event.data.at };
    } else if (row && event.data?.kind === 'changed' && event.data.inputKind === 'choice') {
      row.changed = now();
    } else if (row && event.data?.kind === 'answer') {
      row.answer = now();
    }
  });
  const timeout = window.setTimeout;
  window.setTimeout = function (fn, ms, ...args) {
    if (row && ms === 0 && row.changed && !row.scheduled) {
      const own = row;
      own.scheduled = now();
      return timeout.call(
        this,
        (...values) => {
          own.read = now();
          return fn(...values);
        },
        ms,
        ...args,
      );
    }
    return timeout.call(this, fn, ms, ...args);
  };
  const fetch = window.fetch;
  window.fetch = async function (url, init) {
    const own = row;
    if (!own || init?.method !== 'PUT' || !String(url).endsWith('/answer')) {
      return fetch.call(this, url, init);
    }
    own.sent = now();
    const result = await fetch.call(this, url, init);
    own.headers = now();
    const json = result.json.bind(result);
    result.json = async () => {
      const body = await json();
      own.json = now();
      return body;
    };
    return result;
  };
  new MutationObserver(() => {
    if (
      !row ||
      row.dom ||
      !row.json ||
      document.querySelector('.v2-save-status')?.textContent !== '已保存'
    ) {
      return;
    }
    const own = row;
    own.dom = now();
    requestAnimationFrame(() => {
      own.paint = now();
      window.saveMeasures.push(own);
    });
  }).observe(document, { childList: true, subtree: true, characterData: true });
}

try {
  copyBrowserFixture(root);
  const original = path.join(root, 'question-banks/基础题型/单选题展示'),
    bank = JSON.parse(fs.readFileSync(path.join(original, 'bank.json'), 'utf8'));
  for (const title of ['shared', 'race', 'latency']) {
    const directory = path.join(root, 'question-banks/基础题型', title);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify({ ...bank, title }));
  }
  fs.rmSync(original, { recursive: true }); // verified synthetic copied directory
  server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route, body) => {
    const r = await fetch(
      origin + route,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    );
    const value = await r.json();
    assert.equal(r.ok, true, JSON.stringify(value));
    return value;
  };
  const catalog = await api('/api/v2/catalog'),
    ids = Object.fromEntries(catalog.groups[0].items.map((row) => [row.title, row.bankId]));
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
  async function open(page, title) {
    await page.goto(origin);
    await page.locator('.extension-group-toggle').click();
    await idle(page);
    await page.locator('.library-item').filter({ hasText: title }).click();
  }
  const a = await context.newPage(),
    b = await context.newPage();
  await open(a, 'shared');
  await idle(a);
  await open(b, 'shared');
  await idle(b);
  const conflicts = [];
  b.on('response', (r) => {
    if (r.url().endsWith('/answer') && r.status() === 409) {
      conflicts.push(409);
    }
  });
  await a.bringToFront();
  await frame(a).getByRole('radio', { name: 'A', exact: true }).check();
  await saved(a);
  const originalFrame = b.frames().find((f) => f.parentFrame());
  // The winner can replace B before Playwright's check() postcondition runs.
  await b.bringToFront();
  await frame(b).getByRole('radio', { name: 'B', exact: true }).click();
  await notice(b);
  await idle(b);
  assert.equal(await frame(b).getByRole('radio', { name: 'A', exact: true }).isChecked(), true);
  assert.equal(
    b.frames().find((f) => f.parentFrame()),
    originalFrame,
    'same binding reloads through update(context)',
  );
  await go(b, '2');
  await go(a, '2');
  await frame(a).getByRole('radio', { name: 'B', exact: true }).check();
  await saved(a);
  await frame(a).getByRole('button', { name: '提交答案', exact: true }).click();
  await frame(a).locator('#result').waitFor();
  await idle(a);
  await b.bringToFront();
  await frame(b).getByRole('radio', { name: 'A', exact: true }).click();
  await notice(b);
  await idle(b);
  assert.equal(await frame(b).getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
  assert.equal(await frame(b).getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
  await go(b, '3');
  assert.equal(await frame(b).getByRole('radio', { name: 'A', exact: true }).isEnabled(), true);
  console.log('Two-page save conflict and external lock recovered; navigation works.');

  // Another page refreshes away the current question. Re-reading the missing
  // question must release the save barrier instead of retrying its stale write.
  const file = path.join(root, 'question-banks/基础题型/shared/bank.json'),
    removed = structuredClone(bank);
  removed.title = 'shared';
  delete removed.questions['3'];
  removed.outline[0].items = removed.outline[0].items.filter((item) => item.id !== '3');
  fs.writeFileSync(file, JSON.stringify(removed));
  await api(`/api/v2/banks/${ids.shared}/refresh`, { questionId: '3' });
  await frame(b).getByRole('radio', { name: 'A', exact: true }).click();
  await b.getByRole('alert').filter({ hasText: '本题已移除' }).waitFor();
  assert.equal(await b.locator('.v2-question-frame iframe').count(), 0);
  await go(b, '1');
  await frame(b).getByRole('radio', { name: 'A', exact: true }).waitFor();
  await b.locator('.library-item').filter({ hasText: 'latency' }).click();
  await idle(b);
  assert.equal(await b.locator('.v2-main h1').textContent(), 'latency');
  console.log('Stale snapshot with removed question releases question and bank navigation.');

  // D36 removes the old locked-note race; locked scratch/grade ordering is
  // covered by probe-v2-whiteboard and the independent ink queue tests.

  const measured = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await measured.addInitScript(instrument);
  const page = await measured.newPage();
  await open(page, 'latency');
  await idle(page);
  const external = [];
  for (let i = 0; i < 32; i++) {
    const start = performance.now();
    await frame(page)
      .getByRole('radio', { name: i % 2 ? 'B' : 'A', exact: true })
      .check();
    await page.waitForFunction((n) => window.saveMeasures.length >= n, i + 1);
    external.push(performance.now() - start);
  }
  const samples = (await page.evaluate(() => window.saveMeasures)).slice(2);
  const segments = samples.map((r) => ({
    inputMessage: r.changed - r.input,
    zeroDelay: r.read - r.changed,
    answerMessages: r.answer - r.read,
    queue: r.sent - r.answer,
    putToHeaders: r.headers - r.sent,
    parse: r.json - r.headers,
    hostDom: r.dom - r.json,
    nextPaint: r.paint - r.dom,
    total: r.paint - r.input,
  }));
  const timings = Object.fromEntries(
    Object.keys(segments[0]).map((key) => [key, stats(segments.map((row) => row[key]))]),
  );
  const result = {
    browser: browser.version(),
    node: process.version,
    platform: `${os.type()} ${os.release()}`,
    conflicts: conflicts.length,
    twoPageSaveAndLock: true,
    removedQuestion: true,
    timings,
    externalProbe: stats(external.slice(2)),
    method:
      '2 warmups + 30 alternating radio changes; input/change-to-next-frame marks in host/iframe; no production hook. Message/timer/fetch/MutationObserver probes add unquantified small overhead. PUT-to-headers includes server and loopback; not separately attributed.',
    pageErrors: errors,
  };
  assert.deepEqual(errors, []);
  for (const row of segments) {
    for (const value of Object.values(row)) {
      assert.ok(Number.isFinite(value) && value >= 0);
    }
  }
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
