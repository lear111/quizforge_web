import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/page.ts', import.meta.url))], bundle: true, write: false, format: 'iife', globalName: 'TestPages', platform: 'browser' });
function setup(t) {
  const dom = new JSDOM('<div id="app"></div>', { runScripts: 'outside-only', url: 'http://127.0.0.1:8799' });
  dom.window.eval(compiled.outputFiles[0].text + '\nwindow.TestPages = TestPages;'); t.after(() => dom.window.close());
  const mount = (extra = {}, options = {}) => dom.window.TestPages.mountQuestionPage(dom.window.document.getElementById('app'), { html: '<h2>题目</h2>', js: 'QF.page.register({load(){},getAnswer(){return {selected:"B"}}})', css: '', sdks: [] }, { question: { stem: '</script><!--<script>parent.intrusion=true</script>' }, solution: null, answer: null, result: null, item: { maxScore: 2 }, mode: 'practice', locked: false, ...extra }, 'trusted-nonce', options);
  const channel = page => JSON.parse(/const channel=("[^"]+")/.exec(page.frame.srcdoc)[1]);
  const send = (page, data, source = page.frame.contentWindow) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source, data: { channel: channel(page), version: 0, ...data } }));
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
  assert.doesNotMatch(parsed.scripts[0].textContent, /trusted-nonce|script\.nonce/);
  assert.match(parsed.scripts[0].textContent, /document\.currentScript\.remove\(\)/);
  assert.match(parsed.scripts[0].textContent, /URL\.revokeObjectURL/);
  send(page, { kind: 'ready' }); await page.ready; page.destroy();
});

test('same-question context updates require matching acknowledgement without replacing the frame; changed notifications are scoped', async t => {
  const { mount, send, dom } = setup(t), changed = [], page = mount({}, { title: '判断题', onChanged: kind => changed.push(kind) }), posts = [];
  page.frame.contentWindow.postMessage = (data, origin, transfer) => posts.push({ data, transfer });
  assert.equal(page.frame.title, '判断题作答'); send(page, { kind: 'ready' }); await page.ready;
  send(page, { kind: 'changed', inputKind: 'choice' }); send(page, { kind: 'changed', inputKind: 'text' }, dom.window);
  assert.deepEqual(changed, ['choice']); const frame = page.frame;
  const update = page.update({ question: {}, answer: { selected: 'B' }, solution: { explanation: 'locked' }, result: null, item: {}, mode: 'practice', locked: true });
  for (let i = 0; i < 6; i++) await Promise.resolve(); const post = posts.at(-1).data; assert.equal(post.kind, 'context');
  let done = false; update.then(() => { done = true; });
  send(page, { kind: 'updated', request: post.request, version: 0 }); await Promise.resolve(); assert.equal(done, false);
  send(page, { kind: 'updated', request: post.request, version: post.version }); await update;
  assert.equal(page.frame, frame); assert.equal(dom.window.document.querySelectorAll('iframe').length, 1);
  send(page, { kind: 'changed', inputKind: 'text', version: 0 }); assert.deepEqual(changed, ['choice']); page.destroy();
});

test('picture bytes are transferred once, never embedded in srcdoc; dispose rejects pending context updates', async t => {
  const { mount, send } = setup(t), bytes = new ArrayBuffer(16), row = { assetId: 'a', reference: 'qf-asset:assets/p.png', bytes, type: 'image/png' };
  const page = mount({}, { resources: [row] }), posts = [];
  page.frame.contentWindow.postMessage = (data, origin, transfer) => posts.push({ data, transfer });
  send(page, { kind: 'initialized' }); assert.equal(posts[0].transfer[0], bytes); assert.equal(posts[0].data.resources[0].reference, row.reference);
  send(page, { kind: 'ready' }); await page.ready;
  const update = page.update({ question: {}, answer: null, solution: null, result: null, item: {}, mode: 'practice', locked: false }, [row]);
  const refusal = assert.rejects(update, /题目已关闭/); for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.deepEqual([...posts.at(-1).transfer], []); page.destroy(); await refusal;
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
