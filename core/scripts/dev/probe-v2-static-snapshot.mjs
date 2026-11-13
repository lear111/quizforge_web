// Isolated, loopback-only proof for the tracked public showcase. No archive IO.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { V2Server } from '../../server/host/v2/server.js';
import { capturePage } from './v2-static-snapshot-dom.mjs';

const core = fileURLToPath(new URL('../../', import.meta.url)), repo = path.dirname(core);
const { chromium } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-v2-static-'));
const out = path.join(repo, '.temp/v2-static-snapshot');
const nonce = randomBytes(18).toString('base64');
const sizes = value => ({ raw: Buffer.byteLength(value), gzip: gzipSync(value).length });
function replaceOnce(code, before, after) {
  assert.equal(code.split(before).length, 2, 'changed capture anchor: ' + before);
  return code.replace(before, () => after);
}
async function bundle() {
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, 'v2-static-snapshot-harness.mjs')],
    bundle: true, write: false, format: 'iife', target: 'es2022',
    plugins: [{
      name: 'capture-only-in-the-probe',
      setup(build) {
        build.onLoad({ filter: /[\\/]v2[\\/]page\.ts$/ }, ({ path: filename }) => {
          let code = fs.readFileSync(filename, 'utf8');
          // Use the same frame/channel/version guards and request table as getAnswer.
          // The host injects the serializer; no author API is added.
          code = replaceOnce(code, "if(data.kind!=='answer'||data.version!==version)return;",
            "if(data.version!==version)return;\n      if(data.kind==='snapshot'){try{send({kind:'snapshot',request:data.request,value:(${capturePageForProbe})(root(),assets)});}catch{send({kind:'snapshot',request:data.request,error:true});}return;}\n      if(data.kind!=='answer')return;");
          code = 'const capturePageForProbe=' + JSON.stringify(capturePage.toString()) + ';\n' + code;
          code = replaceOnce(code, "['answer', 'updated']", "['answer', 'updated', 'snapshot']");
          code = replaceOnce(code, "async function read(kind: 'answer')", "async function read(kind: 'answer' | 'snapshot')");
          code = replaceOnce(code, "answer: () => read('answer'),", "answer: () => read('answer'), capture: () => read('snapshot'),");
          return { contents: code, loader: 'ts' };
        });
      },
    }],
  });
  return result.outputFiles[0].contents;
}
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#live,#saved{width:min(860px,calc(100% - 24px));margin:auto}iframe{width:100%;border:0;display:block}</style><div id="live"></div><div id="saved" style="display:none"></div><script nonce="' + nonce + '" src="/__probe.js"></script>';
const screenshot = async (page, slot, filename) => {
  const frame = page.frameLocator('#' + slot + ' iframe'), question = frame.locator('#question');
  await question.evaluate(async node => {
    await node.ownerDocument.fonts.ready;
    await Promise.all([...node.querySelectorAll('img')].map(image => image.decode()));
  });
  return question.screenshot({ path: filename, animations: 'disabled', timeout: 12000 });
};
async function pixels(a, b) {
  const [left, right] = await Promise.all([loadImage(a), loadImage(b)]);
  if (left.width !== right.width || left.height !== right.height) return { sameSize: false, live: [left.width, left.height], static: [right.width, right.height] };
  const ctx = createCanvas(left.width, left.height).getContext('2d');
  const rgb = image => { ctx.clearRect(0, 0, left.width, left.height); ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, left.width, left.height).data; };
  const first = rgb(left), second = rgb(right); let different = 0;
  for (let i = 0; i < first.length; i += 4) if (first[i] !== second[i] || first[i+1] !== second[i+1] || first[i+2] !== second[i+2] || first[i+3] !== second[i+3]) different++;
  return { sameSize: true, width: left.width, height: left.height, different, compared: first.length / 4 };
}
const details = node => ({
  checked: [...node.querySelectorAll('input:checked')].map(input => input.value),
  result: node.querySelector('#result')?.textContent,
  feedback: node.querySelector('#feedback')?.textContent,
  disabled: [...node.querySelectorAll('input')].every(input => input.disabled),
  tables: [...node.querySelectorAll('table')].map(table => [table.rows.length, getComputedStyle(table).borderCollapse]),
  math: [...node.querySelectorAll('math')].map(math => [math.namespaceURI, Math.round(math.getBoundingClientRect().width * 100) / 100, Math.round(math.getBoundingClientRect().height * 100) / 100]),
  images: [...node.querySelectorAll('img')].map(image => [image.naturalWidth, image.naturalHeight]),
});

let server, browser;
try {
  fs.mkdirSync(out, { recursive: true });
  const js = await bundle();
  const source = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  fs.cpSync(path.join(repo, 'examples/v2/extensions'), path.join(root, 'extensions'), { recursive: true });
  const bank = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
  const directory = path.join(root, 'question-banks/basic');
  fs.mkdirSync(directory, { recursive: true }); fs.copyFileSync(path.join(source, 'bank.json'), path.join(directory, 'bank.json'));
  fs.cpSync(path.join(source, 'assets'), path.join(directory, 'assets'), { recursive: true });
  server = new V2Server({ root, codeRoot: core });
  const handle = server.handle.bind(server);
  server.handle = (request, response) => {
    if (!['/__probe', '/__probe.js'].includes(request.url)) return handle(request, response);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce + "' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'self'; frame-src 'self'; worker-src blob:; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(request.url.endsWith('.js') ? js : html);
  };
  await server.start();
  const origin = 'http://127.0.0.1:' + server.port();
  const api = async (route, method, body) => {
    const response = await fetch(origin + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.ok, true, route + ' HTTP ' + response.status);
    return response.json();
  };
  const bankId = (await api('/api/v2/catalog')).groups[0].items[0].bankId, base = '/api/v2/banks/' + bankId;
  const { snapshotId } = await api(base + '/overview');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [], groups = [], network = [], blocked = [], cssByType = new Map();
  for (const [view, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await context.route('**/*', route => {
      const url = route.request().url();
      if (new URL(url).origin === origin) return route.continue();
      blocked.push(url); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => network.push(request.url()));
    await page.goto(origin + '/__probe');
    await page.waitForFunction(() => Boolean(window.staticProbe));
    const rows = [];
    for (const group of bank.outline) for (const item of group.items) {
      const question = bank.questions[item.id], route = base + '/questions/' + item.id;
      let q;
      if (view === 'desktop') {
        const solution = question.solution, wrong = item.id === 'true-false-sample-false';
        const answer = Object.hasOwn(solution, 'value') ? { value: wrong ? !solution.value : solution.value } : { selected: solution.selected };
        const locked = await api(route + '/submit', 'POST', { requestId: 's-' + item.id, snapshotId, expectedRevision: 0, answer });
        const result = await page.evaluate(q => window.staticProbe.score(q), locked);
        assert.equal(result.score, wrong ? 0 : item.maxScore);
        q = await api(route + '/result', 'PUT', { requestId: 'r-' + item.id, snapshotId, submissionId: locked.submissionId, expectedRevision: locked.state.revision, source: 'grader', result });
      } else q = await api(route + '?snapshotId=' + snapshotId);
      assert.ok(q.state.locked && q.result);
      await page.evaluate(() => { document.querySelector('#live').style.display = ''; document.querySelector('#saved').style.display = 'none'; });
      const captured = await page.evaluate(q => window.staticProbe.load(q), q);
      const live = await screenshot(page, 'live', path.join(out, view + '-' + item.id + '-live.png'));
      const liveDetails = await page.frameLocator('#live iframe').locator('#question').evaluate(details);
      const before = network.length;
      await page.evaluate(({html,css,images}) => { window.staticProbe.render(html, css, images);
        const height = document.querySelector('#live iframe').getBoundingClientRect().height;
        document.querySelector('#saved iframe').style.height = height + 'px';
        document.querySelector('#live').style.display = 'none'; document.querySelector('#saved').style.display = ''; }, captured);
      const restored = await screenshot(page, 'saved', path.join(out, view + '-' + item.id + '-static.png'));
      const restoredDetails = await page.frameLocator('#saved iframe').locator('#question').evaluate(details);
      assert.equal(network.length, before, 'static renderer issued a request');
      assert.deepEqual(restoredDetails, liveDetails);
      assert.equal(restoredDetails.disabled, true);
      assert.ok(restoredDetails.feedback === '回答正确' || restoredDetails.feedback === '回答错误');
      if (restoredDetails.images.length) assert.match(captured.html, /src="qf-asset:/);
      if (!cssByType.has(question.type)) cssByType.set(question.type, captured.css);
      rows.push({ id: item.id, type: question.type, ...sizes(captured.html), imageBytes: Object.values(captured.images).reduce((sum, data) => sum + Buffer.from(data.split(',')[1], 'base64').length, 0), duration: captured.duration, reused: captured.reused, ...restoredDetails, pixels: await pixels(live, restored), digest: createHash('sha256').update(captured.html).digest('hex') });
    }
    assert.equal(rows.length, 7);
    assert.equal(rows.filter(r => r.reused).length, 4, 'only first question of each type uses a fresh frame');
    assert.ok(rows.some(r => r.images.length) && rows.some(r => r.tables.length) && rows.some(r => r.math.length));
    const before = network.length;
    const canary = '<p>visible marker</p><script>document.body.dataset.ran="yes"</script><img src="https://snapshot.invalid/picture.png" onerror="document.body.dataset.ran=\'yes\'"><a href="javascript:void(0)">probe link</a><iframe src="https://snapshot.invalid/frame"></iframe><object data="https://snapshot.invalid/object"></object>';
    const clean = await page.evaluate(markup => window.staticProbe.render(markup, '', {}), canary);
    assert.doesNotMatch(clean, /<script|onerror=|href=|<iframe|<object|snapshot\.invalid/i);
    const saved = page.frameLocator('#saved iframe');
    await saved.getByText('probe link').click();
    assert.equal(await saved.locator('body').getAttribute('data-ran'), null);
    assert.equal(network.length, before, 'cleaned canary issued a request');
    assert.equal(await page.locator('#saved iframe').getAttribute('sandbox'), '');
    assert.equal(await saved.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content').then(s => s.includes("script-src 'none'") && s.includes("connect-src 'none'")), true);
    groups.push({ view, viewport, rows });
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  const sdk = fs.readFileSync(path.join(core, 'shared/richtext/1.1.3/richtext.css'), 'utf8');
  const result = { environment: { browser: browser.version(), system: os.release(), node: process.version }, css: Object.fromEntries([...cssByType].map(([name, css]) => [name, sizes(css.slice(sdk.length + 1))])), sdkCss: sizes(sdk), groups, cleanCanary: true, requestsBlockedByRoute: blocked.length };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.ok(groups.every(group => group.rows.every(row => row.pixels.sameSize && row.pixels.different === 0)), 'static screenshot differs; inspect the result and screenshots');
} finally {
  await browser?.close(); server?.server.closeAllConnections(); await server?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
