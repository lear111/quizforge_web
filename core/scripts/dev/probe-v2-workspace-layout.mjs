// Presentation and real pointer checks, called by the existing router probe.
import assert from 'node:assert/strict';
import path from 'node:path';

async function drag(handle, page, distance) {
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + 100;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + distance, y, { steps: 8 });
  await page.mouse.up();
}
async function width(handle, expected) {
  assert.equal(Number(await handle.getAttribute('aria-valuenow')), expected);
}
async function desktop(h) {
  const { page, question } = h;
  const library = page.getByRole('separator', { name: '调整题库栏宽度' });
  const outline = page.getByRole('separator', { name: '调整大纲栏宽度' });
  await width(library, 256);
  await width(outline, 244);
  await drag(library, page, 64);
  await width(library, 320);
  await drag(outline, page, -32);
  await width(outline, 276);
  for (const [handle, large, small, maximum] of [
    [library, 450, -350, 420],
    [outline, -450, 250, 380],
  ]) {
    await drag(handle, page, large);
    await width(handle, maximum);
    await drag(handle, page, small);
    await width(handle, 200);
    await handle.dblclick({ position: { x: 4, y: 100 } });
  }
  await library.focus();
  await page.keyboard.press('ArrowRight');
  await width(library, 272);
  await outline.focus();
  await page.keyboard.press('ArrowLeft');
  await width(outline, 260);
  await page.reload();
  await question('2');
  await width(library, 272);
  await width(outline, 260);
  for (const side of ['题库', '大纲']) {
    const toggle = page.getByRole('button', { name: `收起或展开${side}栏` });
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  }
  await library.dblclick({ position: { x: 4, y: 100 } });
  await outline.dblclick({ position: { x: 4, y: 100 } });
  await width(library, 256);
  await width(outline, 244);
}
async function mobile(h, output) {
  const { page } = h;
  for (const [label, selector, edge] of [
    ['题库', '.v2-library', 'right'],
    ['大纲', '.v2-outline', 'left'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.screenshot({ path: path.join(output, `mobile-${label}.png`), fullPage: true });
    const box = await page.locator(selector).boundingBox();
    assert.equal(box.width, 280);
    assert.equal(await page.locator(`${selector} .v2-resize`).isVisible(), false);
    const scrim = page.getByRole('button', { name: '关闭侧栏' });
    const area = await scrim.boundingBox();
    await scrim.click({
      position: { x: edge === 'right' ? area.width - 5 : 5, y: area.height - 5 },
    });
    assert.equal(await page.locator(selector).isVisible(), false);
  }
  assert.equal(await page.getByRole('button', { name: '收起或展开题库栏' }).isVisible(), false);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.v2-mobile').isVisible(), true);
  await page.setViewportSize({ width: 901, height: 844 });
  assert.equal(await page.locator('.v2-mobile').isVisible(), false);
  await page.setViewportSize({ width: 390, height: 844 });
}
async function statusColors(page) {
  const colors = await page
    .locator('.outline-item')
    .first()
    .evaluate((button) => {
      const original = button.className;
      const result = ['unanswered', 'answered', 'correct', 'wrong', 'ungradable'].map((status) => {
        button.className = `outline-item ${status}`;
        const css = getComputedStyle(button);
        return [css.backgroundColor, css.color, css.borderStyle];
      });
      button.className = original;
      return result;
    });
  assert.deepEqual(colors, [
    ['rgb(255, 255, 255)', 'rgb(107, 112, 132)', 'solid'],
    ['rgb(234, 231, 251)', 'rgb(74, 61, 176)', 'solid'],
    ['rgb(225, 243, 234)', 'rgb(23, 112, 79)', 'solid'],
    ['rgb(251, 231, 223)', 'rgb(164, 66, 26)', 'solid'],
    ['rgb(253, 235, 235)', 'rgb(168, 40, 40)', 'dashed'],
  ]);
  assert.deepEqual(await page.locator('.v2-legend span').allTextContents(), [
    '已作答',
    '正确',
    '错误',
  ]);
}
export async function checkWorkspaceLayout(h, output) {
  if (h.name === 'desktop') {
    await desktop(h);
  } else {
    await mobile(h, output);
  }
  const { page } = h;
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  if (h.name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  await statusColors(page);
  if (h.name === 'mobile') {
    await page.getByRole('button', { name: '大纲', exact: true }).click();
  }
  assert.equal(
    await page.locator('.v2-toolbar').getByRole('button', { name: '完成练习' }).count(),
    0,
  );
  const frame = await page.locator('.v2-question-frame iframe').elementHandle();
  if (h.name === 'mobile') {
    await page.getByRole('button', { name: '题库', exact: true }).click();
  }
  const refreshed = page.waitForResponse((response) => response.url().endsWith('/api/v2/catalog'));
  await page.getByRole('button', { name: '刷新题库列表', exact: true }).click();
  await refreshed;
  await page.locator('.extension-group-toggle').click();
  assert.equal(await frame.evaluate((node) => node.isConnected), true);
  if (h.name === 'mobile') {
    await page.getByRole('button', { name: '题库', exact: true }).click();
  }
  await page.screenshot({ path: path.join(output, `${h.name}-workspace.png`), fullPage: true });
}
