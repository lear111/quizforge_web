import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
// Real Chromium, synthetic banks and an ephemeral loopback host. Measurement
// only: --no-resource-cache disables response cache headers on this test server
// for an otherwise identical control. It is not a production option.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/host/v2/server.js';
const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-bank-return-'));
const cacheEnabled = !process.argv.includes('--no-resource-cache');
const stats = a => { a.sort((a,b) => a-b); return { n: a.length, median: a[Math.ceil(a.length*.5)-1], p95: a[Math.ceil(a.length*.95)-1] }; };
let server, browser;
try {
  copyBrowserFixture(root);
  const directory = path.join(root, 'question-banks/基础题型/单选题展示');
  const bank = JSON.parse(fs.readFileSync(path.join(directory, 'bank.json'), 'utf8'));
  bank.title = 'Synthetic A';
  bank.questions['1'].question.stem.content.push({ type: 'image', attrs: { src: 'qf-asset:assets/figure.png', alt: 'synthetic figure' } });
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'assets/figure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64'));
  fs.writeFileSync(path.join(directory, 'bank.json'), JSON.stringify(bank));
  const other = path.join(path.dirname(directory), 'other'); fs.cpSync(directory, other, { recursive: true });
  fs.writeFileSync(path.join(other, 'bank.json'), JSON.stringify({ ...bank, title: 'Synthetic B' }));
  server = new V2Server({ root, codeRoot: core });
  if (!cacheEnabled) server.immutable = () => {};
  await server.start(); const origin = `http://127.0.0.1:${server.port()}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [], errors = [];
  for (const [name, viewport] of [['desktop', {width:1440,height:900}], ['mobile', {width:390,height:844}]]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    const select = async title => {
      if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click();
      if (!await page.locator('.library-item').filter({ hasText:title }).isVisible()) await page.locator('.extension-group-toggle').click();
      // Timestamp the actual DOM click, excluding automation actionability waits.
      await page.evaluate(() => {
        performance.clearResourceTimings(); delete window.__qfReturnEnd;
        const previous = document.querySelector('.v2-question-frame iframe');
        const listener = () => {
          window.__qfReturnStart = performance.now();
          const observer = new MutationObserver(() => {
            if (document.querySelector('.v2-question-frame iframe') === previous || document.querySelector('.v2-card')?.getAttribute('aria-busy') !== 'false') return;
            observer.disconnect(); requestAnimationFrame(() => { window.__qfReturnEnd = performance.now(); });
          });
          observer.observe(document.querySelector('.v2-main'), { attributes:true, childList:true, subtree:true });
        };
        document.querySelector('.v2-library').addEventListener('click', listener, { once:true, capture:true });
      });
      await page.locator('.library-item').filter({ hasText:title }).click();
      await page.waitForFunction(title => document.querySelector('.v2-main h1')?.textContent === title && document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false', title);
      const frame = page.frameLocator('.v2-question-frame iframe');
      await frame.getByRole('radio', { name:'B', exact:true }).waitFor();
      assert.equal(await frame.getByRole('radio', { name:'B', exact:true }).isEnabled(), true);
      assert.equal(await frame.locator('img').evaluateAll(images => images.length > 0 && images.every(image => image.complete && image.naturalWidth > 0)), true);
      await page.waitForFunction(() => Number.isFinite(window.__qfReturnEnd));
      return page.evaluate(() => {
        const total = window.__qfReturnEnd - window.__qfReturnStart;
        return { total, requests: performance.getEntriesByType('resource').filter(entry => entry.startTime >= window.__qfReturnStart).map(entry => ({ kind:entry.name.includes('/assets/')?'image':entry.name.includes('/extensions/')||entry.name.includes('/sdk/')?'type/SDK':'overview/question', start:entry.startTime-window.__qfReturnStart, duration:entry.duration, bytes:entry.transferSize, cacheHit:entry.transferSize===0 })) };
      });
    };
    await select('Synthetic A'); await select('Synthetic B');
    const rows = [];
    for (let i=0;i<32;i++) { rows.push(await select('Synthetic A')); await select('Synthetic B'); }
    const samples = rows.slice(2), kinds = ['type/SDK','image','overview/question'];
    for (const row of samples) {
      assert.equal(row.requests.filter(e => e.kind === 'overview/question' && e.cacheHit).length, 0);
      assert.equal(row.requests.filter(e => e.kind === 'type/SDK' && e.cacheHit).length, cacheEnabled ? 6 : 0);
      assert.equal(row.requests.filter(e => e.kind === 'image' && e.cacheHit).length, cacheEnabled ? 1 : 0);
    }
    results.push({ name, total:stats(samples.map(r=>r.total)), resources:Object.fromEntries(kinds.map(kind=>[kind,{ countPerReturn:stats(samples.map(r=>r.requests.filter(e=>e.kind===kind).length)), summedDuration:stats(samples.map(r=>r.requests.filter(e=>e.kind===kind).reduce((n,e)=>n+e.duration,0))), cacheHits:samples.flatMap(r=>r.requests).filter(e=>e.kind===kind&&e.cacheHit).length }])), waterfall:samples[0].requests });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { machine:{system:`${os.type()} ${os.release()}`,node:process.version,cpu:os.cpus()[0]?.model,browser:browser.version()}, cacheEnabled, results, errors, method:'2 warmups + 30 returns from B to already-opened A (3 synthetic questions, 1 image). Actual DOM click to new iframe ready/host busy=false and next animation frame, both timed inside the browser. Radio enabled and image decoded are asserted after each sample. Resource durations overlap and must not be summed into total. Same current code and advanced SDK JS/CSS with/without immutable response headers; no interception or prefetch. Synthetic small banks, not real mobile hardware.' };
  const output = path.join(repo,`.temp/v2-basic-return-${cacheEnabled ? 'on' : 'off'}.json`); fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} finally { await browser?.close(); server?.server.closeAllConnections(); await server?.close(); fs.rmSync(root,{recursive:true,force:true}); }
