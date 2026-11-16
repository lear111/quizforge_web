import assert from 'node:assert/strict';

// Invoked by the existing desktop/mobile completion probe, after its original
// assertions. First fail before commit, then lose an actually committed reply.
export async function probeRestart(page, base, api, frame) {
  const bodies = [];
  let attempt = 0;
  await page.route('**/restart', async (route) => {
    bodies.push(route.request().postData());
    attempt++;
    if (attempt === 1) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'ARCHIVE_FAILED', message: '合成归档失败，原练习保留' },
        }),
      });
    }
    if (attempt === 2) {
      await route.fetch();
      return route.abort('failed');
    }
    return route.continue();
  });
  const button = page.getByRole('button', { name: '再练一次', exact: true });
  await button.click();
  await page.getByRole('alert').filter({ hasText: '合成归档失败' }).waitFor();
  assert.ok((await api(base + '/overview')).completedAt);
  await button.click();
  await page
    .getByRole('alert')
    .filter({ hasText: /Failed to fetch|fetch|网络|请求/ })
    .waitFor();
  assert.equal(await page.getByRole('heading', { name: '练习已完成' }).count(), 1);
  await button.click();
  await page.locator('.v2-card[aria-busy="false"]').waitFor();
  await frame().locator('input:not([disabled])').first().waitFor();
  assert.equal(await page.getByRole('heading', { name: '练习已完成' }).count(), 0);
  assert.ok(!page.url().endsWith('/summary'));
  assert.equal(await frame().locator('input:checked').count(), 0);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[1], bodies[2]);
  const fresh = await api(base + '/overview');
  assert.equal(fresh.completedAt, null);
  assert.ok(fresh.states.every((s) => !s.locked && !s.hasSavedAnswer && !s.hasInk));
  await page.unroute('**/restart');
}
