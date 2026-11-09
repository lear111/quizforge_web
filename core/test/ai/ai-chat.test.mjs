import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { bindAiChat } from '../../web/ai/ai-chat.js';
import { loadVueUi } from '../fixtures/vue-ui.mjs';
const html = await readFile(new URL('../../web/index.html', import.meta.url), 'utf8');
function page(t, request) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  loadVueUi(dom); const document = dom.window.document;
  const chat = bindAiChat({ document, request });
  t.after(() => { chat.destroy(); dom.window.close(); });
  const get = id => document.getElementById(id);
  function send(text) { get('ai-chat-input').value = text; get('ai-chat-input').dispatchEvent(new dom.window.Event('input')); get('ai-chat-form').requestSubmit(); }
  return { document, get, send, chat, dom };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('tabs retain the same single chat; sequential messages include only user-provided context and render plain text', async t => {
  const calls = [], { get, send, document, dom } = page(t, async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return { message: '<img src=x onerror=alert(1)> 回复' }; });
  get('ai-chat-tab').click(); assert.equal(get('outline-panel').hidden, true); assert.equal(get('ai-chat-panel').hidden, false);
  send('你好'); await flush();
  get('outline-tab').click(); get('ai-chat-tab').click(); send('再说一次'); await flush();
  assert.equal(calls[1].path, '/api/ai/chat'); assert.deepEqual(calls[1].body.messages, [
    { role: 'user', content: '你好' }, { role: 'assistant', content: '<img src=x onerror=alert(1)> 回复' }, { role: 'user', content: '再说一次' }
  ]);
  assert.equal(get('ai-chat-log').querySelectorAll('img').length, 0); assert.equal(get('ai-chat-log').querySelectorAll('.ai-chat-message').length, 4);
  get('ai-chat-tab').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(document.activeElement.id, 'outline-tab'); assert.equal(get('outline-panel').hidden, false);
});

test('send failures preserve input and a failed turn is excluded from the next request', async t => {
  const calls = []; const { get, send } = page(t, async (_path, options) => {
    calls.push(JSON.parse(options.body)); if (calls.length === 1) throw Object.assign(Error('missing'), { code: 'AI_NOT_CONFIGURED' }); return { message: '成功' };
  });
  send('保留内容'); await flush(); assert.equal(get('ai-chat-input').value, '保留内容'); assert.match(get('ai-chat-status').textContent, /设置/);
  send('重试内容'); await flush(); assert.deepEqual(calls[1].messages, [{ role: 'user', content: '重试内容' }]);
});

test('stop cancels upstream and discards a late response without losing a newly typed draft', async t => {
  let resolveFirst, signal, calls = 0;
  const { get, send, dom } = page(t, async (_path, options) => {
    if (++calls === 1) { signal = options.signal; return new Promise(resolve => resolveFirst = resolve); } return { message: '第二次回复' };
  });
  send('第一次'); get('ai-chat-input').value = '新输入'; get('ai-chat-input').dispatchEvent(new dom.window.Event('input')); get('ai-chat-stop').click();
  assert.equal(signal.aborted, true); assert.equal(get('ai-chat-input').value, '新输入');
  send('第二次'); await flush(); resolveFirst({ message: '过期回复' }); await flush();
  assert.equal(get('ai-chat-log').textContent.includes('过期回复'), false); assert.match(get('ai-chat-log').textContent, /第二次回复/);
});

test('IME composition does not submit, Shift+Enter is a newline, and refresh starts without history', async t => {
  let calls = 0; const { get, dom } = page(t, async () => { calls++; return { message: 'ok' }; });
  get('ai-chat-input').value = '中文输入';
  get('ai-chat-input').dispatchEvent(new dom.window.Event('input'));
  for (const options of [{ isComposing: true }, { shiftKey: true }]) get('ai-chat-input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options }));
  await flush(); assert.equal(calls, 0);
  get('ai-chat-input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await flush(); assert.equal(calls, 1);
  const fresh = page(t, async () => assert.fail()); assert.equal(fresh.get('ai-chat-log').querySelectorAll('.ai-chat-message').length, 0);
});

test('long conversations trim complete oldest pairs without splitting a turn or exceeding the server limit', async t => {
  const calls = []; const { send } = page(t, async (_path, options) => { calls.push(JSON.parse(options.body).messages); return { message: '答'.repeat(24000) }; });
  for (let i = 0; i < 4; i++) { send('问' + i); await flush(); }
  assert.equal(calls[2][0].content, '问1'); assert.equal(calls[3][0].content, '问2');
  for (const messages of calls) {
    assert.ok(messages.reduce((sum, item) => sum + item.content.length, 0) <= 48000);
    assert.ok(messages.length <= 33 && messages.length % 2 === 1);
    messages.forEach((item, index) => assert.equal(item.role, index % 2 ? 'assistant' : 'user'));
  }
});

test('a pending reply disables repeated submits and unmount cancels it without writing into a fresh chat', async t => {
  let resolve, signal, calls = 0;
  const f = page(t, async (_path, options) => { calls++; signal = options.signal; return new Promise(done => { resolve = done; }); });
  f.send('进行中的问题'); await flush();
  assert.equal(f.get('ai-chat-send').disabled, true); assert.equal(f.get('ai-chat-stop').hidden, false);
  assert.equal(f.get('ai-chat-log').getAttribute('aria-busy'), 'true');
  f.send('重复提交'); await flush(); assert.equal(calls, 1);
  f.chat.destroy(); assert.equal(signal.aborted, true);
  const fresh = page(t, async () => assert.fail('unmount must not resend'));
  resolve({ message: '已过期的内容' }); await flush();
  assert.equal(fresh.get('ai-chat-log').textContent.includes('已过期的内容'), false);
  assert.equal(fresh.get('ai-chat-input').value, '');
});

test('invalid model output restores the draft and never becomes conversation history', async t => {
  const calls = [], f = page(t, async (_path, options) => { calls.push(JSON.parse(options.body)); return calls.length === 1 ? { message: ' ' } : { message: '有效回复' }; });
  f.send('恢复这条输入'); await flush();
  assert.equal(f.get('ai-chat-input').value, '恢复这条输入');
  assert.equal(f.get('ai-chat-empty').hidden, false); assert.match(f.get('ai-chat-status').textContent, /没有返回/);
  f.send('再次发送'); await flush();
  assert.deepEqual(calls[1].messages, [{ role: 'user', content: '再次发送' }]);
});
