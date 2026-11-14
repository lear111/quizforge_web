import assert from 'node:assert/strict';
import path from 'node:path';

async function centered(page) {
  const card = await page.locator('.v2-final').boundingBox();
  const content = await page.locator('.v2-content').boundingBox();
  assert.ok(Math.abs(card.x + card.width / 2 - content.x - content.width / 2) < 2);
  assert.ok(Math.abs(card.y + card.height / 2 - content.y - content.height / 2) < 2);
}

export async function checkSideNavigation(h, output) {
  const { page, go, question, origin, id } = h;
  await go('1');
  await question('1');
  assert.equal(await page.getByRole('button', { name: '上一题', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: '下一题', exact: true }).click();
  await question('2');
  await page.getByRole('button', { name: '上一题', exact: true }).click();
  await question('1');
  await go('3');
  await question('3');
  const frame = await page.locator('.v2-question-frame iframe').elementHandle();
  const writes = [];
  const record = (request) => {
    if (/\/(finish|results)$/.test(request.url())) {
      writes.push(request.url());
    }
  };
  page.on('request', record);
  await page.locator('.v2-side-nav.next').click();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  await page.getByRole('heading', { name: '当前得分', exact: true }).waitFor();
  await centered(page);
  assert.equal(await page.locator('.outline-item.active').count(), 0);
  await page.screenshot({ path: path.join(output, `${h.name}-current-score.png`), fullPage: true });
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  await question('3');
  assert.equal(
    await frame.evaluate((node) => node === document.querySelector('.v2-question-frame iframe')),
    true,
  );
  await page.locator('.v2-side-nav.next').click();
  await page.waitForURL(`${origin}/#/banks/${id}/summary`);
  await page.reload();
  await page.getByRole('heading', { name: '当前得分', exact: true }).waitFor();
  const state = await (await page.request.get(origin + h.base + '/overview')).json();
  assert.equal(state.completedAt, null);
  assert.equal(
    state.states.every((state) => !state.locked),
    true,
  );
  assert.deepEqual(writes, []);
  page.off('request', record);
  await page.getByRole('button', { name: '返回题目', exact: true }).click();
  // D32 remembers the last answer, not read-only navigation; this bank is untouched.
  await question('1');
  await go('2');
  await question('2');
}
