// Optional real-Chromium acceptance. Playwright is supplied from an ignored
// directory and is not a project dependency. Only synthetic copied data is used.
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
import { captureBrowserFailure } from './v2-browser-failure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { V2Server } from '../../server/v2/app.js';
const core = fileURLToPath(new URL('../../', import.meta.url)),
  repo = path.dirname(core);
const playwright = process.argv[2];
if (!playwright) {
  throw Error('Supply the temporary Playwright index.mjs path.');
}
const { chromium } = await import(pathToFileURL(path.resolve(playwright)).href);
const output = path.join(repo, '.temp', 'v2-practice');
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-practice-'));
let browser, server;
const rows = [],
  errors = [];
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
// A genuinely different loopback origin receives real browser requests; no
// Playwright route abort can hide an outbound request from this assertion.
async function probeNetwork(browser, baseline = false) {
  const received = [];
  const collector = http.createServer((req, res) => {
    received.push(req.url);
    res.setHeader('Content-Type', 'text/javascript');
    res.end('/* synthetic collector */');
  });
  const compiled = await build({
    entryPoints: [path.join(core, 'frontend/src/v2/page.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'ProbePages',
  });
  const nonce = 'synthetic-network-probe-nonce';
  let host;
  try {
    await new Promise((resolve) => collector.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${collector.address().port}`;
    const actions = {
      'nonce-script': `const script=document.createElement('script');script.nonce=document.scripts[0]?.nonce||'';script.src=target;document.head.append(script);`,
      // A removed nonce is still potentially recoverable from a CSP event.
      'policy-nonce-script': `addEventListener('securitypolicyviolation',event=>{const match=/nonce-([^']+)/.exec(event.originalPolicy);if(match){const script=document.createElement('script');script.nonce=match[1];script.src=target;document.head.append(script);}},{once:true});fetch(target).catch(()=>{});`,
      fetch: 'fetch(target).catch(()=>{});',
      xhr: 'const xhr=new XMLHttpRequest();xhr.open("GET",target);xhr.send();',
      beacon: 'navigator.sendBeacon(target,"synthetic");',
      image: 'const image=new Image();image.src=target;document.body.append(image);',
      css: 'const style=document.createElement("style");style.textContent=`@import url("${target}"); body{background:url("${target}")}`;document.head.append(style);',
      stylesheet:
        'const link=document.createElement("link");link.rel="stylesheet";link.href=target;document.head.append(link);',
      media:
        'const audio=document.createElement("audio");audio.src=target;document.body.append(audio);audio.load();',
      iframe:
        'const frame=document.createElement("iframe");frame.src=target;document.body.append(frame);',
      object:
        'const object=document.createElement("object");object.data=target;document.body.append(object);',
      form: 'const form=document.createElement("form");form.action=target;document.body.append(form);form.submit();finish("sandbox-or-CSP");',
      popup: 'window.open(target);finish("sandbox");',
      navigation: 'location.href=target;',
      import: 'import(target).catch(()=>{});',
      worker: 'try{new Worker(target)}catch{finish("worker-origin-check");}',
      websocket: 'try{new WebSocket(target.replace("http:","ws:"))}catch{finish("CSP");}',
      eventsource:
        'const source=new EventSource(target);source.onerror=()=>{source.close();finish("error");};',
    };
    const cases = [];
    host = http.createServer((req, res) => {
      const route = new URL(req.url, 'http://probe.test'),
        kind = route.searchParams.get('kind') ?? 'nonce-script';
      const locked = route.searchParams.get('locked') === 'true';
      const target = origin + '/' + kind;
      const author = `QF.page.register({async load(context){
        const target=${JSON.stringify(target)}+'?data='+encodeURIComponent(JSON.stringify(context));
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>reject(new Error('No network/blocked completion event')),5000);
          const finish=()=>{clearTimeout(timer);resolve();};
          addEventListener('securitypolicyviolation',finish,{once:true});
          addEventListener('error',finish,{once:true});
          try{${actions[kind]}}catch{finish();}
          ${kind === 'nonce-script' ? 'const s=document.scripts[document.scripts.length-1];s.onload=s.onerror=finish;' : ''}
        });
      },getAnswer(){return {selected:'B'}}});`;
      const boot = `addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='frame-src'&&event.blockedURI.startsWith(${JSON.stringify(origin)}))document.body.dataset.complete='true';});const instance=ProbePages.mountQuestionPage(document.getElementById('app'),${JSON.stringify({ html: '<p>synthetic</p>', js: author, css: '', sdks: [] })},${JSON.stringify({ question: { stem: 'network test' }, answer: { selected: 'B' }, solution: locked ? { answer: 'private synthetic marker' } : null, result: null, item: { maxScore: 2 }, mode: 'practice', locked })},${JSON.stringify(nonce)});instance.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.dataset.complete='true')));`;
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'none'; script-src 'nonce-${nonce}'${baseline ? '' : ' blob:'}; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'`,
      );
      res.end(
        `<div id="app"></div><script nonce="${nonce}">${compiled.outputFiles[0].text}</script><script nonce="${nonce}">${boot.replaceAll('</', '<\\/')}</script>`,
      );
    });
    await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
    for (const locked of baseline ? [true] : [false, true]) {
      for (const kind of baseline ? ['nonce-script'] : Object.keys(actions)) {
        const page = await browser.newPage(),
          before = received.length;
        const diagnostics = [];
        page.on('pageerror', (error) => diagnostics.push(error.message));
        try {
          await page.goto(`http://127.0.0.1:${host.address().port}/?kind=${kind}&locked=${locked}`);
          await page.waitForFunction(() => document.body.dataset.complete === 'true');
        } catch (error) {
          // The diagnostic intentionally includes the cause text in its existing message.
          // eslint-disable-next-line preserve-caught-error
          throw new Error(
            `Network probe ${kind} locked=${locked}: ${error.message}; page errors=${JSON.stringify(diagnostics)}; received=${JSON.stringify(received)}`,
          );
        } finally {
          await page.close();
        }
        cases.push({ kind, locked, requests: received.length - before });
      }
    }
    if (!baseline) {
      assert.deepEqual(received, [], 'author scripts must not reach the external collector');
    }
    return { requests: received.length, baseline, cases };
  } finally {
    await Promise.all(
      [host, collector]
        .filter(Boolean)
        .map((server) => new Promise((resolve) => server.close(resolve))),
    );
  }
}
try {
  if (process.argv.includes('--network-only')) {
    browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
    console.log(
      JSON.stringify(await probeNetwork(browser, process.argv.includes('--network-baseline'))),
    );
  } else {
    copyBrowserFixture(root);
    const bankDirectory = path.join(root, 'question-banks', '基础题型', '单选题展示');
    const bank = JSON.parse(fs.readFileSync(path.join(bankDirectory, 'bank.json'), 'utf8'));
    // 20 measured questions plus one independent interrupted-grading case.
    bank.outline[0].items = [];
    const original = structuredClone(bank.questions['1']);
    bank.questions = {};
    for (let i = 1; i <= 21; i++) {
      bank.outline[0].items.push({ id: String(i), label: String(i), maxScore: 2 });
      bank.questions[i] = structuredClone(original);
    }
    fs.writeFileSync(path.join(bankDirectory, 'bank.json'), JSON.stringify(bank));
    server = await new V2Server({ root, codeRoot: core }).start();
    const url = `http://127.0.0.1:${server.port()}/`;
    browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
    const network = await probeNetwork(browser);
    for (const [name, viewport, offset] of [
      ['desktop', { width: 1440, height: 900 }, 0],
      ['mobile', { width: 390, height: 844 }, 10],
    ]) {
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
        assert.equal(
          await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(),
          true,
        );
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
          await frame()
            .getByRole('radio', { name: 'B', exact: true })
            .waitFor({ state: 'visible' });
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
        assert.equal(
          await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(),
          true,
        );
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
        assert.equal(
          await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(),
          true,
        );
        await page.unroute('**/questions/21/result');
      }
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
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
    errorPage.on('pageerror', (error) =>
      errors.push({ name: 'bad-start', message: error.message }),
    );
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
    assert.deepEqual(errors, []);
    const report = {
      browser: browser.version(),
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      rows,
      network,
      gradingIsolation: reviewStates.map(({ questionId, status, score }) => ({
        questionId,
        status,
        score,
      })),
      pageErrors: errors,
      scope:
        'Synthetic data, desktop/mobile viewports, not a real mobile device or release acceptance.',
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
