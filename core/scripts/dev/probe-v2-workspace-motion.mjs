// Real CSS transitions and responsive boundaries, called by the router acceptance probe.
import assert from 'node:assert/strict';

async function settle(page, selector) {
  await page.locator(selector).evaluate(async (node) => {
    await Promise.all(
      node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})),
    );
  });
}
async function transition(page, selector, property, duration) {
  await page.waitForFunction(
    ({ selector, property }) =>
      document
        .querySelector(selector)
        .getAnimations()
        .some((animation) => animation.transitionProperty === property),
    { selector, property },
  );
  const sample = await page.locator(selector).evaluate(
    (node, { property, duration }) => {
      const animation = node.getAnimations().find((item) => item.transitionProperty === property);
      const actual = animation.effect.getTiming().duration;
      animation.pause();
      animation.currentTime = duration / 2;
      const box = node.getBoundingClientRect();
      const midpoint = { width: node.offsetWidth, height: box.height, x: box.x };
      const display = getComputedStyle(node).display;
      const visibility = getComputedStyle(node).visibility;
      for (const item of node.getAnimations()) {
        item.finish();
      }
      return { actual, midpoint, display, visibility };
    },
    { property, duration },
  );
  assert.equal(sample.actual, duration);
  assert.notEqual(sample.display, 'none');
  return sample;
}
async function groups(page) {
  const toggle = page.locator('.extension-group-toggle');
  const group = page.locator('.library-group-transition');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') {
    await toggle.click();
    await settle(page, '.v2-library');
  }
  const child = await page.locator('.library-item').first().elementHandle();
  assert.equal(await group.evaluate((node) => node.inert), true);
  await toggle.click();
  assert.equal(
    await group.evaluate((node) => getComputedStyle(node).transitionDuration),
    '0.3s, 0.22s',
  );
  const open = await transition(page, '.library-group-transition', 'grid-template-rows', 300);
  const full = await group.evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(open.midpoint.height > 0 && open.midpoint.height < full);
  assert.equal(await group.evaluate((node) => getComputedStyle(node).opacity), '1');
  await toggle.click();
  assert.equal(await group.evaluate((node) => node.inert), true);
  const closed = await transition(page, '.library-group-transition', 'grid-template-rows', 300);
  assert.ok(closed.midpoint.height > 0 && closed.midpoint.height < full);
  assert.equal(await group.evaluate((node) => node.getBoundingClientRect().height), 0);
  assert.equal(await child.evaluate((node) => node.isConnected), true);
  await toggle.click();
  await settle(page, '.v2-library');
}
async function desktop(page) {
  const borders = await page
    .locator('.v2-sidebar-heading, .v2-toolbar')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
  assert.deepEqual(borders, [56, 56, 56]);
  for (const [side, label, width] of [
    ['library', '题库', 256],
    ['outline', '大纲', 244],
  ]) {
    const panel = page.locator(`.v2-${side}`);
    const main = page.locator('.v2-main');
    const before = await main.evaluate((node) => node.getBoundingClientRect().width);
    await page.getByRole('button', { name: `收起或展开${label}栏` }).click();
    assert.equal(
      await panel.evaluate((node) => getComputedStyle(node).transitionDuration),
      '0.32s, 0.24s, 0s',
    );
    assert.equal(await panel.evaluate((node) => node.inert), true);
    const closed = await transition(page, `.v2-${side}`, 'width', 320);
    assert.ok(closed.midpoint.width > 0 && closed.midpoint.width < width);
    assert.equal(await panel.evaluate((node) => node.getBoundingClientRect().width), 0);
    assert.equal(await main.evaluate((node) => node.getBoundingClientRect().width), before + width);
    await page.getByRole('button', { name: `收起或展开${label}栏` }).click();
    await transition(page, `.v2-${side}`, 'width', 320);
    assert.equal(await panel.evaluate((node) => node.getBoundingClientRect().width), width);
  }
  await groups(page);
}
async function drawer(page, side) {
  await settle(page, '.v2-scrim');
  const label = side === 'library' ? '题库' : '大纲';
  await page.getByRole('button', { name: label, exact: true }).click();
  const open = await transition(page, `.v2-${side}`, 'transform', 340);
  await transition(page, '.v2-scrim', 'opacity', 280);
  assert.equal(open.midpoint.width, 280);
  const bounds = await page.locator(`.v2-${side}`).boundingBox();
  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 844);
  assert.equal(await page.locator('.v2-sidebar.open').count(), 1);
  assert.equal(await page.locator('.v2-main').evaluate((node) => node.inert), true);
  const mask = page.getByRole('button', { name: '关闭侧栏' });
  const maskBounds = await mask.boundingBox();
  assert.deepEqual(maskBounds, { x: 0, y: 0, width: 390, height: 844 });
  await mask.click({ position: { x: side === 'library' ? 385 : 5, y: 5 } });
  const closed = await transition(page, `.v2-${side}`, 'transform', 340);
  assert.equal(closed.visibility, 'visible');
  assert.equal(await page.locator(`.v2-${side}`).evaluate((node) => node.inert), true);
  await page
    .locator(`.v2-${side} button`)
    .first()
    .evaluate((node) => node.focus());
  assert.equal(
    await page.locator(`.v2-${side}`).evaluate((node) => node.contains(document.activeElement)),
    false,
  );
  assert.equal(
    await page
      .getByRole('button', { name: label, exact: true })
      .evaluate((node) => node === document.activeElement),
    true,
  );
}
async function boundaries(page) {
  for (const width of [900, 901, 900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForFunction(
      (mobile) =>
        document.querySelector('.v2-toolbar button').getAttribute('aria-label') ===
        (mobile ? '题库' : '收起或展开题库栏'),
      width <= 900,
    );
    assert.equal(await page.locator('.v2-toolbar').evaluate((node) => node.offsetHeight), 56);
    assert.equal(await page.locator('.v2-mobile').count(), 0);
    if (width <= 900) {
      if ((await page.locator('.v2-library.open').count()) === 0) {
        await page.getByRole('button', { name: '题库', exact: true }).click();
      }
      await settle(page, '.v2-library');
    } else {
      assert.equal(await page.locator('.v2-sidebar.open').count(), 0);
    }
  }
  await page.keyboard.press('Escape');
  await settle(page, '.v2-library');
  for (const width of [601, 600, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.locator('.v2-question-navigation');
    const button = page.getByRole('button', { name: '上一题', exact: true });
    const box = await button.boundingBox();
    assert.deepEqual([box.width, box.height], width <= 600 ? [48, 52] : [32, 72]);
    if (width <= 600) {
      const strip = await nav.boundingBox();
      const viewport = await page.locator('.v2-viewport').boundingBox();
      assert.equal(strip.height, 76);
      assert.equal(strip.y + strip.height, 844);
      assert.ok(viewport.y + viewport.height <= strip.y);
      const submit = page
        .frameLocator('.v2-question-frame iframe')
        .getByRole('button', { name: '提交答案', exact: true });
      await submit.scrollIntoViewIfNeeded();
      const submitBounds = await submit.boundingBox();
      assert.ok(submitBounds.y + submitBounds.height <= strip.y);
    }
  }
}
export async function checkWorkspaceMotion(h) {
  const { page, name } = h;
  await page.evaluate(async () => {
    await Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => {})),
    );
  });
  if (name === 'desktop') {
    await desktop(page);
    return;
  }
  await drawer(page, 'library');
  await drawer(page, 'outline');
  await boundaries(page);
  await reducedMotion(page);
  await scratchDrawer(page);
}
async function reducedMotion(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '题库', exact: true }).click();
  assert.equal(
    await page.locator('.v2-library').evaluate((node) => getComputedStyle(node).transitionDuration),
    '0s',
  );
  assert.equal(
    await page.locator('.v2-scrim').evaluate((node) => getComputedStyle(node).transitionDuration),
    '0s',
  );
  assert.equal(
    await page
      .locator('.library-group-transition')
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    '0s',
  );
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
}
async function scratchDrawer(page) {
  await page.getByRole('button', { name: '草稿', exact: true }).click();
  const toolbar = page.locator('.qf-whiteboard-toolbar');
  const toolbarBounds = await toolbar.boundingBox();
  const strip = await page.locator('.v2-question-navigation').boundingBox();
  assert.ok(toolbarBounds.y + toolbarBounds.height <= strip.y);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  assert.equal(await page.locator('.v2-main').evaluate((node) => node.inert), true);
  const box = await toolbar.boundingBox();
  assert.equal(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y).closest('.qf-whiteboard-toolbar') !== null,
      { x: box.x + 5, y: box.y + 5 },
    ),
    false,
  );
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回作答', exact: true }).click();
}
