import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { probeHistoryInk } from './probe-v2-history-ink.mjs';
import { probeHistoryDelete } from './probe-v2-history-delete.mjs';
import {
  checkAnswerLayout,
  probeHistoryLayout,
  preparePracticeMode,
  probePracticeReturn,
} from './probe-v2-history-layout.mjs';

export async function probeEmptyHistory(page) {
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.locator('.v2-history-popover').getByText('暂无历史记录', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.v2-history-popover').count(), 0);
}

async function checkMenu(h, round) {
  const { page } = h;
  const button = page.getByRole('button', { name: '历史记录', exact: true });
  const popover = page.locator('.v2-history-popover');
  await button.click();
  await popover.locator('li').first().waitFor();
  assert.match(await popover.textContent(), new RegExp(`${round.score} / ${round.maxScore} 分`));
  const rect = await popover.boundingBox();
  assert.ok(rect.x >= 0 && rect.x + rect.width <= h.viewport.width);
  await page.keyboard.press('Escape');
  assert.equal(await popover.count(), 0);
  await button.click();
  await popover.locator('li').first().waitFor();
  await page.locator('.v2-bank-heading').click();
  assert.equal(await popover.count(), 0);
  await button.click();
  await popover.locator('.v2-history-open').first().click();
  await page.locator('.v2-history-banner').waitFor();
  await h.idle();
  await button.click();
  const remove = popover.getByRole('button', { name: /^删除 .* 的历史记录$/ });
  await remove.waitFor();
  assert.equal(await remove.isDisabled(), true);
  await page.keyboard.press('Escape');
}

async function checkHostGuards(h, drafting = false) {
  const { page, frame } = h;
  const envelope = await page.evaluate(() => globalThis.__historyEnvelope);
  const results = await frame()
    .locator('body')
    .evaluate(async (_node, envelope) => {
      const result = await Promise.allSettled([QF.page.submit(), QF.page.retry()]);
      QF.page.changed({ kind: 'choice', answered: true });
      // A misbehaving author can bypass SDK checks, so exercise the host too.
      await new Promise((resolve) => {
        let count = 0;
        const receive = (event) => {
          if (event.data?.kind === 'action-result' && [901, 902].includes(event.data.request)) {
            if (++count === 2) {
              removeEventListener('message', receive);
              resolve();
            }
          }
        };
        addEventListener('message', receive);
        parent.postMessage(
          { ...envelope, kind: 'changed', inputKind: 'choice', answered: true },
          '*',
        );
        for (const [action, request] of [
          ['submit', 901],
          ['retry', 902],
        ]) {
          parent.postMessage({ ...envelope, kind: 'action', action, request }, '*');
        }
      });
      return result.map((r) => r.status);
    }, envelope);
  assert.deepEqual(results, ['rejected', 'rejected']);
  assert.equal(await frame().getByRole('button', { name: '提交答案', exact: true }).count(), 0);
  assert.equal(await frame().getByRole('button', { name: '重做', exact: true }).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: drafting ? '返回作答' : '草稿', exact: true }).count(),
    1,
  );
  assert.equal(
    await frame()
      .locator('input')
      .evaluateAll((nodes) => nodes.every((n) => n.disabled)),
    true,
  );
}

async function checkInk(h, roundBase) {
  await h.go('true-false-sample-false');
  const historic = await h.api(roundBase + '/questions/true-false-sample-false');
  assert.ok(historic.ink.strokes.length > 0);
  await checkAnswerLayout(h.page);
  assert.equal(await h.page.locator('.qf-whiteboard-toolbar').isVisible(), false);
  const box = await h.page.locator('.v2-viewport').boundingBox();
  await h.page.mouse.move(box.x + 20, box.y + 90);
  await h.page.mouse.down();
  await h.page.mouse.move(box.x + 80, box.y + 120, { steps: 5 });
  await h.page.mouse.up();
  assert.deepEqual(
    (await h.api(roundBase + '/questions/true-false-sample-false')).ink,
    historic.ink,
  );
  await probeHistoryLayout(h);
  await h.page.getByRole('button', { name: '草稿', exact: true }).click();
  await checkHostGuards(h, true);
  await h.page.getByRole('button', { name: '返回作答', exact: true }).click();
  await checkAnswerLayout(h.page);
}

async function checkUnavailable(h, roundBase) {
  await h.page.route('**/extensions/*/manifest', (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'EXTENSION_NOT_FOUND', message: '合成归档拓展缺失' } },
    }),
  );
  await h.page.reload();
  await h.page
    .locator('.v2-empty')
    .filter({ hasText: /^题型不可用/ })
    .waitFor();
  await h.page
    .locator('.v2-history-banner')
    .getByText(/当时得分：4/)
    .waitFor();
  assert.ok(await h.page.locator('[data-question-id]').count());
  await h.page.unroute('**/extensions/*/manifest');
  await h.page.reload();
  await h.idle();
  await h.page.route('**/rounds/*/questions/*/assets/*', (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'RESOURCE_NOT_FOUND', message: '素材已不存在' } },
    }),
  );
  // A fresh history page loads real qf-asset references, then degrades explicitly.
  await h.page.goto(
    `${h.origin}/#${roundBase.replace('/api/v2', '')}/questions/single-sample-image-math`,
  );
  await h.page.locator('.v2-error').filter({ hasText: '素材已不存在' }).waitFor();
  await h.idle();
  await h.page.unroute('**/rounds/*/questions/*/assets/*');
}

function recordHistoryRequests(page) {
  const writes = [],
    grades = [];
  const record = (r) => {
    if (r.method() !== 'GET' && r.url().includes('/api/v2/banks/')) {
      writes.push(r.url());
    }
    if (r.url().endsWith('/grade-js')) {
      grades.push(r.url());
    }
  };
  page.on('request', record);
  return { writes, grades, stop: () => page.off('request', record) };
}

function practiceBytes(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [path.relative(directory, file), fs.readFileSync(file).toString('base64')];
    });
}

function unchangedStates(files, before) {
  files.forEach((file, i) => assert.ok(fs.readFileSync(file).equals(before[i])));
}

function assertInkOnly(writes, roundBase) {
  assert.ok(writes.every((url) => url.includes(roundBase + '/questions/') && url.endsWith('/ink')));
}

async function watchHistoryEnvelope(page) {
  await page.evaluate(() =>
    addEventListener('message', (event) => {
      if (event.data?.kind === 'ready') {
        globalThis.__historyEnvelope = { channel: event.data.channel, version: event.data.version };
      }
    }),
  );
}

export async function probeHistory(h) {
  const { page, api, base, frame, first, directory, output, name } = h;
  const rounds = await api(base + '/rounds');
  assert.equal(rounds.length, 1);
  const round = rounds[0],
    roundBase = `${base}/rounds/${round.roundId}`;
  await frame().locator('input').first().check();
  await page
    .locator('.v2-save-status')
    .filter({ hasText: /^已保存$/ })
    .waitFor();
  await preparePracticeMode(h);
  const current = await api(
    base + `/questions/${first}?snapshotId=${(await api(base + '/overview')).snapshotId}`,
  );
  const currentFile = path.join(directory, '.qf-v2/practice/state.json');
  const historicFile = path.join(directory, `.qf-v2/rounds/${round.roundId}/state.json`);
  const before = [currentFile, historicFile].map((f) => fs.readFileSync(f));
  const practiceBefore = practiceBytes(path.dirname(currentFile));
  const { writes, grades, stop } = recordHistoryRequests(page);
  await watchHistoryEnvelope(page);
  await checkMenu(h, round);
  await checkHostGuards(h);
  assert.deepEqual(writes, []);
  await checkInk(h, roundBase);
  await page.screenshot({ path: path.join(output, name + '-history.png'), fullPage: true });
  await probePracticeReturn(h);
  await probeHistoryInk(h, roundBase);
  await h.idle();
  assert.ok(!page.url().includes('/rounds/'));
  await checkAnswerLayout(page);
  assert.equal(await frame().locator('input:checked').count(), 1);
  assert.deepEqual(
    (await api(base + `/questions/${first}?snapshotId=${current.snapshotId}`)).answer,
    current.answer,
  );
  unchangedStates([currentFile, historicFile], before);
  assert.ok(writes.length > 0);
  assertInkOnly(writes, roundBase);
  assert.deepEqual(practiceBytes(path.dirname(currentFile)), practiceBefore);
  assert.deepEqual(grades, []);
  await checkMenu(h, round);
  await checkUnavailable(h, roundBase);
  stop();
  assertInkOnly(writes, roundBase);
  assert.deepEqual(grades, []);
  unchangedStates([currentFile, historicFile], before);
  await probeHistoryDelete(h);
  assert.deepEqual(practiceBytes(path.dirname(currentFile)), practiceBefore);
}
