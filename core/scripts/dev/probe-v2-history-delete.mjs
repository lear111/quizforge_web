import assert from 'node:assert/strict';

async function clickDelete(page, button, round) {
  const date = await page.locator('.v2-history-popover time').textContent();
  const dialog = page.waitForEvent('dialog');
  await button.click();
  const message = (await dialog).message();
  assert.ok(message.includes(`${round.score} / ${round.maxScore} 分`), message);
  assert.ok(message.includes(date), message);
}

export async function probeHistoryDelete({ page, api, base, setAccept, idle }) {
  await page.getByRole('button', { name: '返回当前练习', exact: true }).click();
  await idle();
  const [round] = await api(base + '/rounds');
  const url = `**${base}/rounds/${round.roundId}`;
  const practiceUrl = page.url();
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const menu = page.locator('.v2-history-popover');
  const button = menu.getByRole('button', { name: /^删除 .* 的历史记录$/ });
  let requests = 0;
  await page.route(url, (route) => {
    requests++;
    assert.equal(route.request().method(), 'DELETE');
    return route.fulfill({
      status: 503,
      json: { error: { code: 'STATE_WRITE_FAILED', message: '合成删除失败' } },
    });
  });
  setAccept(false);
  await clickDelete(page, button, round);
  assert.equal(requests, 0);
  assert.equal(page.url(), practiceUrl);
  setAccept(true);
  await clickDelete(page, button, round);
  await menu.getByRole('alert').filter({ hasText: '合成删除失败' }).waitFor();
  assert.equal(requests, 1);
  assert.equal(await menu.locator('.v2-history-open').count(), 1);
  assert.equal(page.url(), practiceUrl);
  await page.unroute(url);
  const response = page.waitForResponse((r) => r.request().method() === 'DELETE');
  await clickDelete(page, button, round);
  assert.equal((await response).status(), 204);
  await menu.getByText('暂无历史记录', { exact: true }).waitFor();
  assert.equal(page.url(), practiceUrl);
  assert.deepEqual(await api(base + '/rounds'), []);
}
