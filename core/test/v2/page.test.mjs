import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/page.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'TestPages', platform: 'browser' });
function setup(t) {
  const dom = new JSDOM('<div id="app"></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1:8799' });
  dom.window.eval(compiled.outputFiles[0].text + '\nwindow.TestPages = TestPages;'); t.after(() => dom.window.close());
  const mount = (extra = {}) => dom.window.TestPages.mountQuestionPage(dom.window.document.getElementById('app'), { html: '<h2>题目</h2>', js: 'QF.page.register({load(){},getAnswer(){return {selected:"B"}}})', css: '', sdks: [] }, { question: { stem: '</script><!--<script>parent.intrusion=true</script>' }, solution: null, answer: null, result: null, item: { maxScore: 2 }, mode: 'practice', locked: false, ...extra }, 'trusted-nonce');
  const channel = page => JSON.parse(/const channel=("[^"]+")/.exec(page.frame.srcdoc)[1]);
  const send = (page, data, source = page.frame.contentWindow) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data: { channel: channel(page), ...data } }));
  return { dom, mount, send, channel };
}
test('page sandbox has no host origin/network and safely embeds hostile question text', async t => {
  const { mount, send, dom } = setup(t), page = mount();
  assert.equal(page.frame.getAttribute('sandbox'), 'allow-scripts');
  assert.match(page.frame.srcdoc, /connect-src 'none'/); assert.match(page.frame.srcdoc, /form-action 'none'/);
  assert.doesNotMatch(page.frame.srcdoc, /<!--<script>parent/);
  assert.match(page.frame.srcdoc, /\\u003c\/script>/);
  const parsed = new dom.window.DOMParser().parseFromString(page.frame.srcdoc, 'text/html');
  assert.equal(parsed.scripts.length, 1); assert.equal(parsed.scripts[0].nonce, 'trusted-nonce');
  send(page, { kind: 'ready' }); await page.ready; page.destroy();
});
test('answer replies require current frame, channel and request; destroying rejects pending work and late replies cannot affect another question', async t => {
  const { mount, send, dom, channel } = setup(t), page = mount();
  const sent = []; page.frame.contentWindow.postMessage = data => sent.push(data);
  send(page, { kind: 'ready' }); await page.ready;
  let completed = false;
  const answer = page.answer().then(value => { completed = true; return value; });
  await Promise.resolve(); assert.equal(sent.length, 1);
  send(page, { kind: 'answer', request: sent[0].request, value: { selected: 'spoofed' } }, dom.window);
  send(page, { kind: 'answer', channel: 'wrong', request: sent[0].request, value: 99 });
  send(page, { kind: 'answer', request: sent[0].request + 1, value: 99 });
  await Promise.resolve(); assert.equal(completed, false);
  send(page, { kind: 'answer', request: sent[0].request, value: { selected: 'B' } }); assert.deepEqual(JSON.parse(JSON.stringify(await answer)), { selected: 'B' });
  const pending = page.answer(); await Promise.resolve(); const refused = assert.rejects(pending, /题目已关闭/); const oldWindow = page.frame.contentWindow, oldChannel = channel(page);
  page.destroy(); await refused;
  const next = mount({ answer: { selected: 'A' } }); let nextReady = false; next.ready.then(() => { nextReady = true; });
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: oldWindow, data: { channel: oldChannel, kind: 'ready' } }));
  await Promise.resolve(); assert.equal(nextReady, false);
  send(next, { kind: 'ready' }); await next.ready; next.destroy(); assert.equal(dom.window.document.querySelectorAll('iframe').length, 0);
});
