import assert from 'node:assert/strict';
import {
  checkAnswerLayout,
  checkDraftLayout,
  checkPaintedInk,
} from './probe-v2-history-layout.mjs';

const id = 'true-false-sample-false';
const saved = (page) =>
  page
    .locator('.v2-save-status')
    .filter({ hasText: /^已保存$/ })
    .waitFor();
const failed = (page) =>
  page
    .locator('.v2-save-status')
    .filter({ hasText: /^保存失败$/ })
    .waitFor();

async function draw(page) {
  const box = await page.locator('.v2-viewport').boundingBox();
  const input = page.locator('.qf-whiteboard-input');
  const rect = await input.boundingBox();
  const x = box.x + box.width * 0.4,
    y = box.y + Math.min(230, box.height * 0.5);
  await input.hover({ position: { x: x - rect.x, y: y - rect.y } });
  await page.mouse.down();
  await page.mouse.move(x + 50, y + 25, { steps: 8 });
  await page.mouse.up();
}

async function editMode(page) {
  const button = page.getByRole('button', { name: '草稿', exact: true });
  if (await button.count()) {
    await button.click();
  }
  await page.locator('button[data-tool="pen"]').click();
}

async function retryFailure(h, route) {
  const bodies = [],
    { page } = h;
  let allow = false;
  await page.route('**' + route, async (request) => {
    bodies.push(request.request().postData());
    if (allow) {
      return request.continue();
    }
    await request.fulfill({
      status: 503,
      json: { error: { code: 'STATE_WRITE_FAILED', message: '合成历史笔迹写入失败' } },
    });
  });
  await draw(page);
  await failed(page);
  await page.getByRole('button', { name: '返回当前练习', exact: true }).click();
  await h.idle();
  assert.ok(page.url().includes('/rounds/'));
  await failed(page);
  allow = true;
  // Archived camera may place the card footer outside the pointer viewport.
  // Exercise the existing keyboard-accessible retry without force-clicking.
  await page.getByRole('button', { name: '重试保存', exact: true }).focus();
  await page.getByRole('button', { name: '重试保存', exact: true }).press('Enter');
  await saved(page);
  assert.ok(bodies.length >= 3);
  assert.ok(bodies.every((body) => body === bodies[0]));
  await page.unroute('**' + route);
}

async function waitBeforeSwitch(h, roundBase) {
  const { page } = h,
    route = `${roundBase}/questions/${id}/ink`;
  let release;
  const seen = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**' + route, (request) => release(request));
  await draw(page);
  const switching = h.go(h.first);
  const held = await seen;
  assert.ok(page.url().includes('/questions/' + id));
  await held.continue();
  await switching;
  await h.idle();
  assert.ok(page.url().endsWith('/questions/' + h.first));
  await page.unroute('**' + route);
  await h.go(id);
}

async function conflict(h, roundBase) {
  const { page, api } = h,
    route = `${roundBase}/questions/${id}`;
  const old = await api(route);
  const external = { ...old.ink, strokes: old.ink.strokes.slice(0, 1) };
  await api(
    route + '/ink',
    {
      requestId: 'other-tab-' + h.name,
      snapshotId: old.snapshotId,
      expectedInkRevision: old.inkRevision,
      ink: external,
    },
    'PUT',
  );
  await editMode(page);
  await draw(page);
  await page
    .locator('.v2-error')
    .filter({ hasText: /已载入最新内容/ })
    .waitFor();
  const current = await api(route);
  assert.equal(current.inkRevision, old.inkRevision + 1);
  assert.deepEqual(current.ink, external);
}

async function lostResponse(h, roundBase) {
  const { page, api } = h,
    route = `${roundBase}/questions/${id}/ink`;
  const bodies = [];
  await page.route('**' + route, async (request) => {
    bodies.push(request.request().postData());
    if (bodies.length === 1) {
      const response = await request.fetch();
      assert.equal(response.ok(), true);
      await request.abort('failed');
    } else {
      await request.continue();
    }
  });
  const old = await api(`${roundBase}/questions/${id}`);
  await draw(page);
  await failed(page);
  // Archived camera may place the card footer outside the pointer viewport.
  // Exercise the existing keyboard-accessible retry without force-clicking.
  await page.getByRole('button', { name: '重试保存', exact: true }).focus();
  await page.getByRole('button', { name: '重试保存', exact: true }).press('Enter');
  await saved(page);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal((await api(`${roundBase}/questions/${id}`)).inkRevision, old.inkRevision + 1);
  await page.unroute('**' + route);
}

export async function probeHistoryInk(h, roundBase) {
  const { page, api } = h,
    question = `${roundBase}/questions/${id}`;
  const old = await api(question);
  await editMode(page);
  await draw(page);
  await saved(page);
  const edited = await api(question);
  assert.equal(edited.inkRevision, old.inkRevision + 1);
  assert.equal(edited.ink.strokes.length, old.ink.strokes.length + 1);
  await page.getByRole('button', { name: '返回作答', exact: true }).click();
  await checkAnswerLayout(page);
  await editMode(page);
  await checkDraftLayout(page);
  await checkPaintedInk(page);
  assert.deepEqual((await api(question)).ink, edited.ink);
  await page.reload();
  await h.idle();
  await checkAnswerLayout(page);
  assert.deepEqual((await api(question)).ink, edited.ink);
  await editMode(page);
  await retryFailure(h, question + '/ink');
  await waitBeforeSwitch(h, roundBase);
  await conflict(h, roundBase);
  await lostResponse(h, roundBase);
  // Immediate departure must flush the newest stroke to this historical scope.
  const beforeLeave = await api(question);
  await draw(page);
  await page.getByRole('button', { name: '返回当前练习', exact: true }).click();
  await h.idle();
  assert.ok(!page.url().includes('/rounds/'));
  assert.equal((await api(question)).inkRevision, beforeLeave.inkRevision + 1);
}
