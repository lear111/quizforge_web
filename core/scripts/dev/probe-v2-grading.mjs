// Synthetic, loopback-only browser acceptance of the production grading module.
// Playwright stays outside project dependencies: pass its absolute index.mjs.
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const modulePath = process.argv[2];
if (!modulePath) {
  throw Error(
    'Usage: node core/scripts/dev/probe-v2-grading.mjs ABSOLUTE_PLAYWRIGHT_INDEX_MJS [chrome|msedge]',
  );
}
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/grading.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'QFGrading',
  platform: 'browser',
  target: 'es2022',
});
const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.url);
  res.setHeader('Cache-Control', 'no-store');
  if (req.url === '/grading.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(compiled.outputFiles[0].contents);
  } else if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self' 'nonce-qfGradingProbe'; frame-src 'self'; worker-src blob:; connect-src 'self'; base-uri 'none'; object-src 'none'",
    );
    res.end(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2 评分环境合成验收</title><body><h1>评分环境合成验收</h1><script nonce="qfGradingProbe" src="/grading.js"></script></body></html>',
    );
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const insecureOrigin = `http://qf-grading-probe.test:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.argv[3] || 'chrome',
    args: ['--host-resolver-rules=MAP qf-grading-probe.test 127.0.0.1', '--no-proxy-server'],
  });
  const rows = [];
  for (const scenario of [
    { viewport: { width: 1440, height: 900 }, url: origin },
    { viewport: { width: 390, height: 844 }, url: origin },
    { viewport: { width: 390, height: 844 }, url: insecureOrigin },
  ]) {
    const { viewport, url } = scenario;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(url);
    const report = await page.evaluate(async (origin) => {
      const check = (value, message) => {
        if (!value) {
          throw Error(message);
        }
      };
      const basic = `QF.grader.register({grade(question,solution,answer,item){
        if(question.crash)throw Error('synthetic error');
        if(question.uncloneable)return {callback(){}};
        return {score:answer.selectedOptionId===solution.correctOptionId?item.maxScore:0};
      }});`;
      const escape =
        `const text = '</script><script>parent.__unexpected = true;</script>';\n` + basic;
      const inspected = `QF.grader.register({async grade(){
        let fetchBlocked=false,importBlocked=false;
        try{await fetch(${JSON.stringify(origin + '/forbidden-fetch')},{credentials:'omit',referrerPolicy:'no-referrer'});}catch{fetchBlocked=true;}
        try{importScripts(${JSON.stringify(origin + '/forbidden-script')});}catch{importBlocked=true;}
        throw new Error(JSON.stringify({fetchBlocked,importBlocked,document:typeof document,storage:typeof localStorage,origin:location.origin}));
      }});`;
      const infinite = `QF.grader.register({grade(){while(true){}}});`;
      const loads = {};
      const service = QFGrading.createGradingService({
        scriptNonce: 'qfGradingProbe',
        loadSource: async (id) => {
          loads[id] = (loads[id] || 0) + 1;
          return id === 'inspection'
            ? inspected
            : id === 'escape'
              ? escape
              : id === 'syntax' && loads[id] === 1
                ? 'not valid javascript !'
                : basic;
        },
      });
      const item = (questionId, overrides = {}) => ({
        questionId,
        question: {},
        solution: { correctOptionId: 'B', explanation: '合成解析标记' },
        answer: { selectedOptionId: 'B' },
        item: { maxScore: 2 },
        ...overrides,
      });
      const start = performance.now();
      const first = await service.grade('basic', [
        item('correct'),
        item('wrong', { answer: { selectedOptionId: 'A' } }),
        item('bad', { question: { crash: true } }),
        item('clone', { question: { uncloneable: true } }),
      ]);
      const firstMs = performance.now() - start;
      check(
        first[0].result.score === 2 && first[1].result.score === 0,
        'real grade function results',
      );
      check(
        first[2].result.message === 'synthetic error' &&
          first[3].result.score === null &&
          !!first[3].result.message,
        'per-question errors remain isolated',
      );
      await service.grade('basic', [item('again')]);
      check(loads.basic === 1, 'type environment reuse');
      const inspection = JSON.parse(
        (await service.grade('inspection', [item('inspection')]))[0].result.message,
      );
      check(
        inspection.fetchBlocked &&
          inspection.importBlocked &&
          inspection.origin === 'null' &&
          inspection.document === 'undefined' &&
          inspection.storage === 'undefined',
        'worker network and DOM isolation',
      );
      const frameStorageBlocked = await new Promise((resolve) => {
        const frame = document.createElement('iframe');
        frame.sandbox = 'allow-scripts';
        const listener = (event) => {
          if (event.source === frame.contentWindow) {
            removeEventListener('message', listener);
            frame.remove();
            resolve(event.data.blocked);
          }
        };
        addEventListener('message', listener);
        frame.srcdoc =
          '<script nonce="qfGradingProbe">try{localStorage.getItem("probe");parent.postMessage({blocked:false},"*")}catch{parent.postMessage({blocked:true},"*")}</script>';
        document.body.append(frame);
      });
      check(frameStorageBlocked, 'opaque iframe storage isolation');
      check(
        (await service.grade('escape', [item('escape')]))[0].result.score === 2 &&
          window.__unexpected === undefined,
        'author source cannot escape srcdoc',
      );
      check(
        (await service.grade('syntax', [item('bad-source')]))[0].result.score === null,
        'syntax failure is surfaced',
      );
      check(
        (await service.grade('syntax', [item('new-source')]))[0].result.score === 2 &&
          loads.syntax === 2,
        'startup failure rebuild',
      );
      let hangLoads = 0;
      // Use the specified production deadline. A reduced probe deadline can
      // expire during a legitimate cold Worker startup on a busy machine.
      const slow = QFGrading.createGradingService({
        scriptNonce: 'qfGradingProbe',
        loadSource: async () => (++hangLoads === 1 ? infinite : basic),
      });
      const stuck = slow.grade('recoverable', [item('hang')]);
      const heartbeat = new Promise((resolve) => requestAnimationFrame(() => resolve(true)));
      check(await heartbeat, 'busy Worker leaves main thread responsive');
      const winner = await Promise.race([
        stuck.then(() => 'slow'),
        service.grade('basic', [item('parallel')]).then(() => 'fast'),
      ]);
      check(winner === 'fast', 'other type is independent of stuck Worker');
      check((await stuck)[0].result.score === null, 'deadline returns ungradable');
      check(
        (await slow.grade('recoverable', [item('recovered')]))[0].result.score === 2,
        'timeout rebuild',
      );
      slow.dispose();
      service.dispose();
      check(document.querySelectorAll('iframe').length === 0, 'all frames released');
      return {
        firstMs,
        secureContext: isSecureContext,
        inspection,
        frameStorageBlocked,
        sameTypeSourceLoads: loads.basic,
        errorRebuildSourceLoads: loads.syntax,
        timeoutRebuildSourceLoads: hangLoads,
        parallel: true,
        hostResponsive: true,
        releasedFrames: true,
      };
    }, url);
    assert.equal(report.secureContext, url === origin);
    rows.push({
      viewport,
      originKind: url === origin ? 'loopback' : 'insecure-http-name-mapped-to-loopback',
      ...report,
    });
    await context.close();
  }
  assert.equal(
    seen.some((url) => url.startsWith('/forbidden-')),
    false,
  );
  console.log(
    JSON.stringify(
      {
        node: process.version,
        os: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model },
        browser: await browser.version(),
        headless: true,
        playwright: 'external, not a project dependency',
        loopbackOnly: true,
        blockedNetworkRequestsReachedHost: 0,
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
