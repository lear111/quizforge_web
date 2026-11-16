import assert from 'node:assert/strict';
import path from 'node:path';

export async function checkAnswerLayout(page) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.v2-viewport');
    return (
      !viewport.classList.contains('v2-drafting') &&
      viewport.querySelector('.qf-whiteboard--practice') &&
      viewport.querySelector('.qf-whiteboard-ink').hidden
    );
  });
  assert.equal(await page.locator('.qf-whiteboard-toolbar').isVisible(), false);
  const layout = await page.locator('.v2-viewport').evaluate((node) => {
    const card = node.querySelector('.v2-card').getBoundingClientRect();
    const world = getComputedStyle(node.querySelector('.v2-world'));
    const center = node.getBoundingClientRect().x + node.clientWidth / 2;
    return {
      position: world.position,
      transform: world.transform,
      offset: Math.abs(card.x + card.width / 2 - center),
    };
  });
  assert.equal(layout.position, 'relative');
  assert.equal(layout.transform, 'none');
  assert.ok(layout.offset <= 1, `answer card center offset: ${layout.offset}px`);
}

export async function checkDraftLayout(page) {
  await page.waitForFunction(() => {
    const viewport = document.querySelector('.v2-viewport');
    return (
      viewport.classList.contains('v2-drafting') &&
      viewport.querySelector('.qf-whiteboard--draft') &&
      !viewport.querySelector('.qf-whiteboard-ink').hidden
    );
  });
  assert.equal(await page.locator('.qf-whiteboard-toolbar').isVisible(), true);
  for (const tool of ['pen', 'eraser', 'hand']) {
    const button = page.locator(`button[data-tool="${tool}"]`);
    assert.equal(await button.isVisible(), true);
    assert.equal(await button.isEnabled(), true);
  }
  assert.equal(
    await page.locator('.v2-world').evaluate((node) => getComputedStyle(node).position),
    'absolute',
  );
}

export async function checkPaintedInk(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.qf-whiteboard-ink');
    if (canvas.hidden) {
      return false;
    }
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return rgba.some((value, i) => i % 4 === 3 && value > 0);
  });
}

export async function probeHistoryLayout(h) {
  const { page } = h;
  await checkAnswerLayout(page);
  await page.screenshot({
    path: path.join(h.output, h.name + '-history-answer.png'),
    fullPage: true,
  });
  await h.go(h.first);
  await checkAnswerLayout(page);
  await h.go('true-false-sample-false');
  await checkAnswerLayout(page);
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  await checkDraftLayout(page);
  await checkPaintedInk(page);
  await page.screenshot({
    path: path.join(h.output, h.name + '-history-draft.png'),
    fullPage: true,
  });
  await h.go(h.first);
  await checkDraftLayout(page);
  await h.go('true-false-sample-false');
  await checkDraftLayout(page);
  await checkPaintedInk(page);
  await page.getByRole('button', { name: '返回作答', exact: true }).click();
  await checkAnswerLayout(page);
}

export async function preparePracticeMode(h) {
  if (h.name === 'mobile') {
    await h.page.getByRole('button', { name: '草稿', exact: true }).click();
    await checkDraftLayout(h.page);
  } else {
    await checkAnswerLayout(h.page);
  }
}

export async function checkRestoredPractice(h) {
  if (h.name === 'mobile') {
    await checkDraftLayout(h.page);
  } else {
    await checkAnswerLayout(h.page);
  }
}

export async function probePracticeReturn(h) {
  const { page } = h;
  // Check the stashed practice view before reload starts a new store lifetime.
  await page.getByRole('button', { name: '返回当前练习', exact: true }).click();
  await h.idle();
  assert.ok(!page.url().includes('/rounds/'));
  await checkRestoredPractice(h);
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.locator('.v2-history-popover .v2-history-open').first().click();
  await page.locator('.v2-history-banner').waitFor();
  await h.idle();
  await h.go('true-false-sample-false');
  await checkAnswerLayout(page);
}
