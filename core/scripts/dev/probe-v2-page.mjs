import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
// Optional Chromium acceptance, isolated synthetic roots/ports only. Supply an
// ignored Playwright installation; no new project dependency or daily service.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { V2Server } from '../../server/host/v2/server.js';

const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
if (!process.argv[2]) throw Error('Supply the temporary Playwright index.mjs path.');
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-page-'));
const output = path.join(repo, '.temp', 'v2-page'); fs.mkdirSync(output, { recursive: true });
const rows = [], errors = [];
let browser, server;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64');
const image = src => ({ type: 'image', attrs: { src, alt: '合成图片' } });
async function transferProbe() {
  const compiled = await build({ entryPoints: [path.join(core, 'frontend/src/v2/page.ts')], bundle: true, write: false, format: 'iife', globalName: 'ProbePages' });
  const nonce = 'v2-picture-probe', author = `QF.page.register({async load(context){const asset=await QF.resources.get('qf-asset:assets/one.png');const img=new Image();img.src=asset.url;document.getElementById('picture').replaceChildren(img);await img.decode();},getAnswer(){return null;}});`;
  const host = http.createServer((req, res) => {
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; base-uri 'none'`);
    const boot = `const bytes=new Uint8Array(${JSON.stringify([...png])}).buffer;
      const instance=ProbePages.mountQuestionPage(document.getElementById('app'),${JSON.stringify({ html: '<div id="picture"></div>', js: author, css: '', sdks: [] })},${JSON.stringify({ question: {}, answer: null, solution: null, result: null, item: {}, mode: 'practice', locked: false })},'${nonce}',{resources:[{assetId:'one',reference:'qf-asset:assets/one.png',bytes,type:'image/png'}]});
      instance.ready.then(()=>{document.body.dataset.detached=String(bytes.byteLength);window.destroy=()=>instance.destroy();document.body.dataset.ready='true';});`;
    res.end(`<div id="app"></div><script nonce="${nonce}">${compiled.outputFiles[0].text}</script><script nonce="${nonce}">${boot.replaceAll('</', '<\\/')}</script>`);
  });
  try {
    await new Promise(resolve => host.listen(0, '127.0.0.1', resolve)); const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${host.address().port}`); await page.waitForFunction(() => document.body.dataset.ready === 'true');
    assert.equal(await page.locator('body').getAttribute('data-detached'), '0', 'real transfer detaches host buffer');
    assert.equal(await page.frameLocator('iframe').locator('img').evaluate(img => img.naturalWidth), 1);
    await page.evaluate(() => window.destroy()); assert.equal(await page.locator('iframe').count(), 0); await page.close();
    return { hostBufferBytesAfterTransfer: 0, decodedWidth: 1, frameRemoved: true };
  } finally { host.closeAllConnections(); await new Promise(resolve => host.close(resolve)); }
}
try {
  copyBrowserFixture(root);
  const originalDirectory = path.join(root, 'question-banks/基础题型/单选题展示');
  const bank = JSON.parse(fs.readFileSync(path.join(originalDirectory, 'bank.json'), 'utf8'));
  bank.questions['1'].question.stem.content.push(image('qf-asset:assets/question.png'));
  bank.questions['1'].solution.explanation.content.push(image('qf-asset:assets/solution.png'));
  bank.questions['3'].type = 'quizforge.synthetic-text@2';
  const ext = path.join(root, 'extensions/基础题型/单选题'), manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.name = '合成选择'; write(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  const typing = path.join(root, 'extensions/synthetic/text');
  write(path.join(typing, 'manifest.json'), JSON.stringify({ ...manifest, id: 'quizforge.synthetic-text', name: '合成输入' }));
  write(path.join(typing, 'practice.html'), '<textarea aria-label="合成输入"></textarea><button id="submit">提交答案</button><strong id="result"></strong>');
  write(path.join(typing, 'practice.css'), 'textarea{width:80%;height:120px}');
  write(path.join(typing, 'practice.js'), `const answer=document.querySelector('textarea');
    answer.oninput=()=>QF.page.changed({kind:'text'});
    QF.page.register({load(c){answer.value=c.answer?.text||'';answer.disabled=c.locked;submit.hidden=!c.can.submit;submit.onclick=()=>QF.page.submit().catch(()=>{});result.textContent=c.result?.status==='graded'?c.result.score+' / '+c.item.maxScore+' 分':'';},getAnswer(){return {text:answer.value};}});`);
  write(path.join(typing, 'grade.js'), 'QF.grader.register({grade(){return {status:"graded",score:0}}});');
  // Distinct synthetic banks avoid sharing progress between viewport runs.
  for (const name of ['desktop', 'mobile']) {
    const directory = path.join(root, 'question-banks/基础题型', name);
    write(path.join(directory, 'bank.json'), JSON.stringify({ ...bank, title: name }));
    for (const file of ['question.png', 'solution.png']) write(path.join(directory, 'assets', file), png);
  }
  // All copies are synthetic; removing this copied example cannot touch user data.
  fs.rmSync(originalDirectory, { recursive: true });
  server = await new V2Server({ root, codeRoot: core }).start(); const origin = `http://127.0.0.1:${server.port()}`;
  browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
  const transferred = await transferProbe();
  console.log('ArrayBuffer transfer passed.');
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(), requests = [], drafts = [];
    page.on('pageerror', error => errors.push({ name, message: error.message }));
    page.on('request', req => { requests.push(new URL(req.url()).pathname); if (req.url().endsWith('/answer')) drafts.push(req.postData()); });
    const frame = () => page.frameLocator('.v2-question-frame iframe');
    const saved = () => page.locator('.v2-save-status').filter({ hasText: /^已保存$/ }).waitFor();
    const idle = () => page.locator('.v2-card[aria-busy="false"]').waitFor();
    async function go(id) {
      if (name === 'mobile') await page.getByRole('button', { name: '大纲', exact: true }).click();
      await page.locator(`[data-question-id="${id}"]`).click(); await idle();
    }
    await page.goto(origin);
    if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click();
    await page.locator('.extension-group-toggle').click(); await page.locator('.library-item').filter({ hasText: name }).click(); await idle();
    await frame().getByRole('radio', { name: 'A', exact: true }).waitFor();
    assert.equal(await page.locator('.v2-question-heading span').first().textContent(), '合成选择');
    assert.equal(await page.locator('.v2-question-frame iframe').getAttribute('title'), '合成选择作答');
    await frame().locator('#stem img').evaluate(img => img.decode());
    assert.equal(await frame().locator('#stem img').evaluate(img => img.naturalWidth), 1);
    assert.equal(requests.filter(url => url.includes('/assets/')).length, 1, 'solution resource is not fetched before lock');
    console.log(name + ': initial image and title passed.');
    const firstFrame = page.frames().find(f => f.parentFrame());
    const start = performance.now(); await frame().getByRole('radio', { name: 'A', exact: true }).check(); await saved(); const saveMs = performance.now() - start;
    console.log(name + ': immediate save passed.');
    assert.equal(page.frames().find(f => f.parentFrame()), firstFrame, 'auto-save does not rebuild frame');
    await go('2'); await go('1'); assert.equal(await frame().getByRole('radio', { name: 'A', exact: true }).isChecked(), true);
    assert.equal(requests.filter(url => url.endsWith('/files/practice-js')).length, 1, 'same snapshot reuses source Promise');
    console.log(name + ': round trip and source cache passed.');
    // Failure keeps current input, blocks both question and bank switches, and
    // explicit retry repeats exactly the original id/body/revision.
    await page.route('**/questions/1/answer', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STATE_WRITE_FAILED', message: '合成保存失败' } }) }));
    await frame().getByRole('radio', { name: 'B', exact: true }).check(); await page.getByRole('button', { name: '重试保存' }).waitFor();
    console.log(name + ': injected save failure visible.');
    await go('2'); assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
    if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click();
    await page.locator('.library-item').filter({ hasText: name === 'desktop' ? 'mobile' : 'desktop' }).click();
    await page.getByRole('alert').filter({ hasText: '合成保存失败' }).waitFor(); assert.equal(await page.locator('.v2-main h1').textContent(), name);
    if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click(); // close drawer
    const failureBody = drafts.at(-1); await page.unroute('**/questions/1/answer');
    await page.getByRole('button', { name: '重试保存' }).click(); await saved(); assert.equal(drafts.at(-1), failureBody);
    console.log(name + ': failed exits and retry passed.');
    const lockedFrame = page.frames().find(f => f.parentFrame()); const submitStart = performance.now();
    await frame().getByRole('button', { name: '提交答案', exact: true }).click(); await frame().locator('#result').filter({ hasText: '2 / 2 分' }).waitFor(); await idle();
    const submitMs = performance.now() - submitStart;
    assert.equal(page.frames().find(f => f.parentFrame()), lockedFrame, 'locking and grading keep same question iframe');
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isDisabled(), true);
    await frame().locator('#solution img').scrollIntoViewIfNeeded();
    await frame().locator('#solution img').evaluate(img => img.decode());
    assert.equal(await frame().locator('#solution img').evaluate(img => img.naturalWidth), 1);
    // Question image was refetched only on re-entry, not for lock/grade updates.
    assert.equal(requests.filter(url => url.includes('/assets/')).length, 3);
    await go('3'); const typingFrame = page.frames().find(f => f.parentFrame());
    await frame().getByRole('textbox', { name: '合成输入', exact: true }).fill('typing preserved'); await saved();
    assert.equal(await frame().getByRole('textbox', { name: '合成输入', exact: true }).inputValue(), 'typing preserved');
    assert.equal(page.frames().find(f => f.parentFrame()), typingFrame);
    await frame().getByRole('textbox', { name: '合成输入', exact: true }).fill('flush on leave'); await go('2'); await go('3');
    assert.equal(await frame().getByRole('textbox', { name: '合成输入', exact: true }).inputValue(), 'flush on leave');
    assert.equal(await frame().getByRole('textbox', { name: '合成输入', exact: true }).inputValue(), 'flush on leave');
    await page.route('**/questions/3/result', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: '合成评分中断' } }) }));
    await frame().getByRole('button', { name: '提交答案', exact: true }).click(); await page.getByRole('alert').filter({ hasText: '合成评分中断' }).waitFor(); await idle();
    await page.unroute('**/questions/3/result');
    assert.equal(await frame().getByRole('textbox', { name: '合成输入', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '继续评分', exact: true }).click(); await frame().locator('#result').waitFor(); await idle();
    console.log(name + ': regrading result: ' + await frame().locator('#result').textContent());
    assert.equal(await frame().locator('#result').textContent(), '0 / 2 分');
    assert.equal(await frame().getByRole('textbox', { name: '合成输入', exact: true }).inputValue(), 'flush on leave');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    rows.push({ name, saveMs, submitMs, failedSwitchPreservesInput: true, exactRetryBody: true, sourceReused: true, sameFrameAfterGrade: true, images: true, typedDraftRestored: true, lockedAnswerSurvivesRegrading: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { rows, transferred, pageErrors: errors, scope: 'Synthetic data and desktop/mobile Chromium viewports, not real-device or full-segment acceptance.' };
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error); throw error; }
finally { await browser?.close(); server?.server.closeAllConnections(); await server?.close(); fs.rmSync(root, { recursive: true, force: true }); }
