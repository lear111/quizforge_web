// Optional real-Chromium acceptance. Playwright is supplied from an ignored
// directory and is not a project dependency. Only synthetic copied data is used.
import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
import { captureBrowserFailure } from './v2-browser-failure.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { probeNetwork } from './probe-v2-practice-network.mjs';
import { exerciseViewport } from './probe-v2-practice-flow.mjs';
import { probeRecovery, probeBadStart } from './probe-v2-practice-recovery.mjs';
import { V2Server } from '../../server/v2/app.js';
const core = fileURLToPath(new URL('../../', import.meta.url)),
  repo = path.dirname(core);
const playwright = process.argv[2];
if (!playwright) {
  throw Error('Supply the temporary Playwright index.mjs path.');
}
const { chromium } = await import(pathToFileURL(path.resolve(playwright)).href);
const output = path.join(repo, '.temp', 'v2-practice');
fs.mkdirSync(output, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-practice-'));
let browser, server;
const rows = [],
  errors = [];
try {
  if (process.argv.includes('--network-only')) {
    browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
    console.log(
      JSON.stringify(await probeNetwork(browser, process.argv.includes('--network-baseline'))),
    );
  } else {
    copyBrowserFixture(root);
    const bankDirectory = path.join(root, 'question-banks', '基础题型', '单选题展示');
    const bank = JSON.parse(fs.readFileSync(path.join(bankDirectory, 'bank.json'), 'utf8'));
    // 20 measured questions plus one independent interrupted-grading case.
    bank.outline[0].items = [];
    const original = structuredClone(bank.questions['1']);
    bank.questions = {};
    for (let i = 1; i <= 21; i++) {
      bank.outline[0].items.push({ id: String(i), label: String(i), maxScore: 2 });
      bank.questions[i] = structuredClone(original);
    }
    fs.writeFileSync(path.join(bankDirectory, 'bank.json'), JSON.stringify(bank));
    server = await new V2Server({ root, codeRoot: core }).start();
    const url = `http://127.0.0.1:${server.port()}/`;
    browser = await chromium.launch({ channel: process.argv[3] ?? 'chrome', headless: true });
    const network = await probeNetwork(browser);
    for (const [name, viewport, offset] of [
      ['desktop', { width: 1440, height: 900 }, 0],
      ['mobile', { width: 390, height: 844 }, 10],
    ]) {
      await exerciseViewport({ browser, name, viewport, offset, errors, url, output, rows });
    }
    const reviewStates = await probeRecovery({ bank, root, server, browser, errors, url });
    await probeBadStart({ bank, root, browser, errors, url });
    assert.deepEqual(errors, []);
    const report = {
      browser: browser.version(),
      node: process.version,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      rows,
      network,
      gradingIsolation: reviewStates.map(({ questionId, status, score }) => ({
        questionId,
        status,
        score,
      })),
      pageErrors: errors,
      scope:
        'Synthetic data, desktop/mobile viewports, not a real mobile device or release acceptance.',
    };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
} catch (error) {
  await captureBrowserFailure(browser);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
