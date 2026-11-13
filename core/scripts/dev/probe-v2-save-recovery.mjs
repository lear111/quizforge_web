import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { V2Server } from '../../server/host/v2/server.js';
const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-save-recovery-'));
let browser, server;
try {
  copyBrowserFixture(root);
  const file = path.join(root, 'question-banks/基础题型/单选题展示/bank.json'), bank = JSON.parse(fs.readFileSync(file, 'utf8')), original = bank.questions['1'];
  bank.questions = {}; bank.outline[0].items = [];
  for (let i = 1; i <= 8; i++) { bank.questions[i] = structuredClone(original); bank.outline[0].items.push({ id: String(i), label: String(i), maxScore: 2 }); }
  fs.writeFileSync(file, JSON.stringify(bank)); server = await new V2Server({ root, codeRoot: core }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const api = async (route, input, method = 'POST') => { const r = await fetch(origin + '/api/v2' + route, input === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const value = await r.json(); assert.equal(r.ok, true, JSON.stringify(value)); return value; };
  const id = (await api('/catalog')).groups[0].items[0].bankId, base = `/banks/${id}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const frame = () => page.frameLocator('.v2-question-frame iframe');
  const idle = () => page.waitForFunction(() => document.querySelector('.v2-card')?.getAttribute('aria-busy') === 'false');
  const saved = () => page.locator('.v2-save-status').filter({ hasText: /^已保存$/ }).waitFor();
  const read = async qid => { const opened = await api(base + '/overview'); return api(`${base}/questions/${qid}?snapshotId=${opened.snapshotId}`); };
  const go = async qid => { await page.locator(`[data-question-id="${qid}"]`).click(); await idle(); };
  const write = async (q, op, fields) => api(`${base}/questions/${q.questionId}/${op}`, { snapshotId: q.snapshotId, requestId: crypto.randomUUID(), expectedRevision: q.state.revision, ...fields }, op === 'submit' || op === 'retry' ? 'POST' : 'PUT');
  async function held(pattern, trigger, change) {
    let release; const seen = new Promise(resolve => { release = resolve; });
    await page.route(pattern, route => release(route));
    const action = trigger(); const route = await seen; await change(); await route.continue(); await action; await idle(); await page.unroute(pattern);
    await page.getByRole('alert').filter({ hasText: '已载入最新内容' }).waitFor();
  }
  await page.goto(origin); await page.locator('.extension-group-toggle').click(); await page.locator('.library-item').click(); await idle();
  await frame().getByRole('radio', { name: 'B', exact: true }).check(); await saved();
  await held('**/questions/1/submit', () => frame().getByRole('button', { name: '提交答案', exact: true }).click(), async () => write(await read('1'), 'answer', { answer: { selected: 'A' } }));
  assert.equal(await frame().getByRole('radio', { name: 'A', exact: true }).isChecked(), true); assert.equal((await read('1')).state.locked, false);
  await go('2'); await frame().getByRole('radio', { name: 'B', exact: true }).check(); await saved();
  await held('**/questions/2/result', () => frame().getByRole('button', { name: '提交答案', exact: true }).click(), async () => {
    const q = await read('2'); await write(q, 'result', { submissionId: q.submissionId, expectedRevision: q.state.revision, source: 'grader', result: { score: 0, parts: null, message: null } });
  });
  await frame().locator('#result').filter({ hasText: '0 / 2 分' }).waitFor();
  await go('3'); await frame().getByRole('radio', { name: 'B', exact: true }).check(); await saved();
  await held('**/questions/3/result', () => frame().getByRole('button', { name: '提交答案', exact: true }).click(), async () => {
    await write(await read('3'), 'retry', {}); await write(await read('3'), 'submit', { answer: { selected: 'A' } });
  });
  assert.equal(await frame().getByRole('radio', { name: 'A', exact: true }).isChecked(), true); const interrupted = await read('3'); assert.equal(interrupted.state.locked, true); assert.equal(interrupted.result, null);
  for (const [qid, status, code] of [['4', 400, 'INVALID_REQUEST'], ['5', 413, 'STATE_SIZE_LIMIT']]) {
    await go(qid); const pattern = `**/questions/${qid}/answer`; let attempts = 0;
    await page.route(pattern, route => { attempts++; return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code, message: 'synthetic rejection' } }) }); });
    await frame().getByRole('radio', { name: 'B', exact: true }).check();
    await page.getByRole('alert').filter({ hasText: status === 413 ? '作答文件已达上限' : '已载入最新内容' }).waitFor();
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), false); assert.equal(attempts, 1); await page.unroute(pattern);
  }
  for (const [qid, status] of [['6', 401], ['7', 503]]) {
    await go(qid); const pattern = `**/questions/${qid}/answer`, bodies = [];
    await page.route(pattern, async route => { bodies.push(route.request().postData()); if (bodies.length === 1) await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: status === 401 ? 'AUTH_REQUIRED' : 'STATE_WRITE_FAILED', message: 'synthetic retry' } }) }); else await route.continue(); });
    await frame().getByRole('radio', { name: 'B', exact: true }).check(); await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
    assert.equal(await frame().getByRole('radio', { name: 'B', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: '重试保存', exact: true }).click(); await saved(); assert.equal(bodies.length, 2); assert.equal(bodies[0], bodies[1]); await page.unroute(pattern);
  }
  assert.deepEqual(errors, []); console.log(JSON.stringify({ browser: browser.version(), submitConflict: true, resultConflict: true, staleSubmission: true, invalid400: true, limit413: true, preserved401: true, retry503: true, errors }));
} finally { await browser?.close(); server?.server.closeAllConnections(); await server?.close(); fs.rmSync(root, { recursive: true, force: true }); }
