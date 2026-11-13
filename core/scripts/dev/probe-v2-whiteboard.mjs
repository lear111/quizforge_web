// Optional actual-Chromium acceptance; ignored Playwright, copied examples,
// synthetic banks, ephemeral ports. No daily service or user data touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/host/v2/server.js';
const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-whiteboard-'));
const output = path.join(repo, '.temp/v2-whiteboard'); fs.mkdirSync(output, { recursive: true });
let browser, server;
try {
  fs.cpSync(path.join(repo, 'examples/v2'), root, { recursive: true });
  const bankDirectory = path.join(root, 'question-banks/基础题型/单选题展示');
  const original = JSON.parse(fs.readFileSync(path.join(bankDirectory, 'bank.json'), 'utf8'));
  const bank = structuredClone(original); bank.outline[0].items = []; bank.questions = {};
  for (let i = 1; i <= 6; i++) { bank.questions[i] = structuredClone(original.questions['1']); bank.outline[0].items.push({ id: String(i), label: String(i), maxScore: 2 }); }
  fs.writeFileSync(path.join(bankDirectory, 'bank.json'), JSON.stringify(bank));
  const secondDirectory = path.join(root, 'question-banks/基础题型/other'); fs.cpSync(bankDirectory, secondDirectory, { recursive: true });
  fs.writeFileSync(path.join(secondDirectory, 'bank.json'), JSON.stringify({ ...bank, title: '合成另一本' }));
  server = await new V2Server({ root, codeRoot: core }).start(); const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route, body, method = 'POST') => { const r = await fetch(origin + '/api/v2' + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const value = await r.json(); assert.equal(r.ok, true, JSON.stringify(value)); return value; };
  const id = (await api('/catalog')).groups[0].items.find(row => row.title === bank.title).bankId, base = `/banks/${id}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [], errors = [];
  for (const [name, size] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport: size }); const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(15000);
    const frame = () => page.frameLocator('.v2-question-frame iframe');
    const idle = () => page.waitForFunction(() => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false');
    const saved = () => page.locator('.v2-save-status').filter({ hasText: /^已保存$/ }).waitFor();
    const go = async qid => { if (await page.locator(`[data-question-id="${qid}"]`).getAttribute('class').then(s => s.includes('active'))) return; if (name === 'mobile') await page.getByRole('button', { name: '大纲', exact: true }).click(); await page.locator(`[data-question-id="${qid}"]`).click(); await idle(); };
    const question = async () => { const opened = await api(base + '/overview'); return api(`${base}/questions/${name === 'desktop' ? '1' : '4'}?snapshotId=${opened.snapshotId}`); };
    async function stroke() {
      const rect = await page.locator('.v2-viewport').boundingBox(); const x = rect.x + rect.width * .35, y = rect.y + Math.min(270, rect.height * .5);
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 65, y + 22, { steps: 8 }); await page.mouse.up();
    }
    await page.goto(origin); if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click();
    await page.locator('.extension-group-toggle').click(); await page.locator('.library-item').filter({ hasText: bank.title }).click(); await idle();
    const qid = name === 'desktop' ? '1' : '4', other = name === 'desktop' ? '2' : '5'; await go(qid);
    await frame().getByRole('radio', { name: 'B', exact: true }).check(); await saved();
    await page.getByRole('button', { name: '草稿', exact: true }).click();
    await page.locator('button[data-tool="pen"]').click(); await stroke(); await saved();
    let q = await question(); assert.equal(q.ink.strokes.length, 1); const ink = structuredClone(q.ink.strokes);
    // Non-fullscreen coordinates and unchanged v1 tools, including undo/redo,
    // rectangle selection, eraser, zoom and draggable capsule.
    await page.locator('[data-action="undo"]').click(); await saved(); assert.equal((await question()).ink.strokes.length, 0);
    await page.locator('[data-action="redo"]').click(); await saved(); assert.equal((await question()).ink.strokes.length, 1);
    await page.locator('button[data-tool="select-ink"]').click(); await page.locator('button[data-tool="eraser"]').click(); await page.locator('button[data-tool="pen"]').click();
    const initialZoom = await page.locator('.v2-viewport').evaluate(node => Number(getComputedStyle(node).getPropertyValue('--qf-whiteboard-zoom')));
    const viewport = await page.locator('.v2-viewport').boundingBox(); await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 230); await page.keyboard.down('Control'); await page.mouse.wheel(0, -90); await page.keyboard.up('Control');
    await page.waitForFunction(before => Number(getComputedStyle(document.querySelector('.v2-viewport')).getPropertyValue('--qf-whiteboard-zoom')) > before, initialZoom);
    await page.getByRole('button', { name: '进入全屏', exact: true }).click(); await page.waitForFunction(() => document.fullscreenElement !== null);
    assert.equal(await page.locator('.v2-library').isVisible(), false);
    await page.getByRole('button', { name: '退出全屏', exact: true }).click(); await page.waitForFunction(() => document.fullscreenElement === null);
    await stroke(); // Immediately leave: flush must save this newest stroke.
    await go(other); assert.equal((await question()).ink.strokes.length, 2); await go(qid);
    assert.deepEqual((await question()).ink.strokes[0], ink[0]);
    await page.getByRole('button', { name: '返回作答', exact: true }).click();
    const lockedInk = (await question()).ink;
    const sameFrame = await page.locator('.v2-question-frame iframe').elementHandle();
    await frame().getByRole('button', { name: '提交答案', exact: true }).click(); await frame().locator('#result').filter({ hasText: '2 / 2 分' }).waitFor();
    assert.equal(await sameFrame.evaluate(node => node.isConnected), true);
    q = await question(); const submission = q.submission, result = q.result, answerVersion = q.state.answerVersion;
    await page.getByRole('button', { name: '草稿', exact: true }).click(); await stroke(); await saved();
    await page.screenshot({ path: path.join(output, name + '-draft.png'), fullPage: true });
    q = await question(); assert.deepEqual(q.submission, submission); assert.deepEqual(q.result, result); assert.equal(q.state.answerVersion, answerVersion); assert.deepEqual(q.answer, { selected: 'B' }); assert.equal(q.ink.strokes.length, lockedInk.strokes.length + 1);
    // Per-window browsing position and durable last-answer restoration; no automatic first bank for
    // a new user, but reopening this context recovers bank + question.
    await go(other); await page.getByRole('button', { name: '返回作答', exact: true }).click();
    const selectBank = async title => { if (name === 'mobile') await page.getByRole('button', { name: '题库', exact: true }).click(); await page.locator('.library-item').filter({ hasText: title }).click(); await idle(); };
    await selectBank('合成另一本');
    // Another window changes the durable cursor; this window still remembers
    // where it left this bank, independently of that other window's last answer.
    const otherWindow = await question();
    await api(base + `/questions/${qid}/draft`, { snapshotId: otherWindow.snapshotId, requestId: 'other-window-' + name, expectedRevision: otherWindow.state.revision, draft: 'other window notes' }, 'PUT');
    await selectBank(bank.title);
    assert.equal(await page.locator(`[data-question-id="${other}"]`).getAttribute('class').then(s => s.includes('active')), true);
    await page.reload(); await idle(); await page.waitForFunction(id => document.querySelector(`[data-question-id="${id}"]`)?.classList.contains('active'), qid);
    await go(qid); await frame().getByRole('button', { name: '重做', exact: true }).click(); await idle();
    q = await question(); assert.equal(q.answer, null); assert.equal(q.ink, null); assert.equal(q.submission, null); assert.equal(q.result, null);
    // Explicit refresh keeps a surviving current question; a removed one falls
    // back while preserving unrelated answers.
    await page.getByRole('button', { name: '刷新题库', exact: true }).click(); await idle();
    assert.equal(await page.locator(`[data-question-id="${qid}"]`).getAttribute('class').then(s => s.includes('active')), true);
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // Remove only this synthetic current question, then explicit refresh falls back.
    const latestBank = JSON.parse(fs.readFileSync(path.join(bankDirectory, 'bank.json'), 'utf8'));
    delete latestBank.questions[qid]; latestBank.outline.forEach(group => { group.items = group.items.filter(item => item.id !== qid); });
    fs.writeFileSync(path.join(bankDirectory, 'bank.json'), JSON.stringify(latestBank));
    await page.getByRole('button', { name: '刷新题库', exact: true }).click(); await idle();
    assert.equal(await page.locator(`[data-question-id="${qid}"]`).count(), 0);
    assert.equal(await page.locator('.v2-question-frame iframe').count(), 1);
    results.push({ name, strokeSaved: true, immediateExit: true, lockedNotes: true, position: true, retry: true, refresh: true, frameRetained: true });
    await context.close();
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ browser: browser.version(), results, errors }, null, 2));
} catch (error) { console.error(error); throw error; }
finally { await browser?.close(); server?.server.closeAllConnections(); await server?.close(); fs.rmSync(root, { recursive: true, force: true }); }
