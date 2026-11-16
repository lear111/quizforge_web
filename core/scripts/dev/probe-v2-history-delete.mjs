import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

async function clickDelete(page, row, round) {
  const date = await row.locator('time').textContent();
  const dialog = page.waitForEvent('dialog');
  await deleteButton(row).click();
  const message = (await dialog).message();
  assert.ok(message.includes(`${round.score} / ${round.maxScore} 分`), message);
  assert.ok(message.includes(date), message);
}

const deleteButton = (row) => row.getByRole('button', { name: /^删除 .* 的历史记录$/ });

function seedOlderRound(directory, round) {
  // The completion probe owns this temporary copy of the curated demo.
  const root = path.join(directory, '.qf-v2', 'rounds');
  const roundId = randomUUID();
  const copy = path.join(root, roundId);
  fs.cpSync(path.join(root, round.roundId), copy, { recursive: true });
  const file = path.join(copy, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.completedAt = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(file, JSON.stringify(state));
  return { ...round, roundId, completedAt: state.completedAt };
}

async function openMenu(page) {
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const menu = page.locator('.v2-history-popover');
  await menu.locator('.v2-history-row').first().waitFor();
  return menu;
}

function roundRow(page, menu, round) {
  return menu.locator('.v2-history-row').filter({
    has: page.locator(`time[datetime="${round.completedAt}"]`),
  });
}

async function holdDelete(page, base, round, fail) {
  const release = Promise.withResolvers();
  const routePath = `${base}/rounds/${round.roundId}`;
  let requests = 0;
  await page.route(
    `**${routePath}`,
    async (route) => {
      requests++;
      await release.promise;
      if (fail) {
        return route.fulfill({
          status: 503,
          json: { error: { code: 'STATE_WRITE_FAILED', message: '合成删除失败' } },
        });
      }
      return route.continue();
    },
    { times: 1 },
  );
  return {
    arrived: () => page.waitForRequest((r) => new URL(r.url()).pathname === routePath),
    release: release.resolve,
    requests: () => requests,
  };
}

async function assertOpenBlocked(page, menu, request, arrived, practiceUrl) {
  try {
    assert.equal((await arrived).method(), 'DELETE');
    const open = menu.locator('.v2-history-open');
    assert.equal(await open.count(), 2);
    assert.equal(await menu.locator('.v2-history-delete:disabled').count(), 2);
    for (const button of await open.all()) {
      assert.equal(await button.isDisabled(), true, 'pending deletion must disable every row');
      await button.evaluate((element) => element.click());
    }
    assert.equal(page.url(), practiceUrl);
    assert.equal(await page.locator('.v2-history-banner').count(), 0);
  } finally {
    request.release();
  }
}

async function inspectRemaining(h, row, round) {
  await row.locator('.v2-history-open').click();
  await h.page.locator('.v2-history-banner').waitFor();
  await h.idle();
  assert.ok(h.page.url().includes(`/rounds/${round.roundId}/`));
  const menu = await openMenu(h.page);
  assert.equal(await deleteButton(roundRow(h.page, menu, round)).isDisabled(), true);
  await h.page.keyboard.press('Escape');
  await leaveHistory(h);
}

async function leaveHistory({ page, idle }) {
  await page.getByRole('button', { name: '返回当前练习', exact: true }).click();
  await idle();
}

async function failThenInspect(h, menu, round, older, practiceUrl) {
  const { page, base, setAccept } = h;
  const row = roundRow(page, menu, round);
  const request = await holdDelete(page, base, round, true);
  setAccept(false);
  await clickDelete(page, row, round);
  assert.equal(request.requests(), 0);
  assert.equal(page.url(), practiceUrl);
  setAccept(true);
  const arrived = request.arrived();
  await clickDelete(page, row, round);
  await assertOpenBlocked(page, menu, request, arrived, practiceUrl);
  await menu.getByRole('alert').filter({ hasText: '合成删除失败' }).waitFor();
  assert.equal(request.requests(), 1);
  assert.equal(await menu.locator('.v2-history-open:enabled').count(), 2);
  assert.equal(await deleteButton(row).isEnabled(), true);
  assert.equal(page.url(), practiceUrl);
  await inspectRemaining(h, roundRow(page, menu, older), older);
}

async function retryThenInspect(h, round, older, practiceUrl) {
  const { page, api, base } = h;
  const menu = await openMenu(page);
  const request = await holdDelete(page, base, round, false);
  const arrived = request.arrived();
  const response = page.waitForResponse((r) => r.request().method() === 'DELETE');
  const row = roundRow(page, menu, round);
  await clickDelete(page, row, round);
  await assertOpenBlocked(page, menu, request, arrived, practiceUrl);
  assert.equal((await response).status(), 204);
  await row.waitFor({ state: 'detached' });
  assert.equal(await menu.locator('.v2-history-open:enabled').count(), 1);
  assert.equal(page.url(), practiceUrl);
  assert.deepEqual(await api(base + '/rounds'), [older]);
  await inspectRemaining(h, roundRow(page, menu, older), older);
}

export async function probeHistoryDelete(h) {
  const { page, api, base, directory } = h;
  await leaveHistory(h);
  const [round] = await api(base + '/rounds');
  const older = seedOlderRound(directory, round);
  const practiceUrl = page.url();
  await failThenInspect(h, await openMenu(page), round, older, practiceUrl);
  await retryThenInspect(h, round, older, practiceUrl);
  const menu = await openMenu(page);
  const response = page.waitForResponse((r) => r.request().method() === 'DELETE');
  await clickDelete(page, roundRow(page, menu, older), older);
  assert.equal((await response).status(), 204);
  await menu.getByText('暂无历史记录', { exact: true }).waitFor();
  assert.equal(page.url(), practiceUrl);
  assert.deepEqual(await api(base + '/rounds'), []);
}
