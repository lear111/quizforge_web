import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { AiChatService, chatMessages } from './ai-chat.js';
import { OpenAiCompatibleProvider } from './ai-provider.js';

const turn = content => ({ role: 'user', content });
const profile = { enabled: false, model: 'test-model', maxOutputTokens: 1024, timeoutSeconds: 5, outputMode: 'schema', apiKey: 'synthetic-test-secret' };
async function upstream(t, respond) {
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    respond(request, response, JSON.parse(Buffer.concat(chunks)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}/v1`;
}
const answer = (response, text) => response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: text } }] }));

test('ordinary multi-turn chat shares the configured model but never requests grading JSON or exposes its key', async t => {
  const messages = [turn('第一问'), { role: 'assistant', content: '第一答' }, turn('第二问')];
  const baseUrl = await upstream(t, (request, response, body) => {
    assert.equal(request.url, '/v1/chat/completions'); assert.equal(request.headers.authorization, 'Bearer synthetic-test-secret');
    assert.equal(body.model, profile.model); assert.equal(body.max_tokens, 1024); assert.equal(body.stream, false);
    assert.equal(body.response_format, undefined); assert.equal(body.messages[0].role, 'system'); assert.match(body.messages[0].content, /不能读取/);
    assert.deepEqual(body.messages.slice(1), messages); answer(response, '普通回答 synthetic-test-secret');
  });
  const gateway = new OpenAiCompatibleProvider({ profile: { ...profile, baseUrl } });
  const service = new AiChatService(gateway);
  assert.deepEqual(await service.reply({ messages }), { message: '普通回答 [redacted]' });
  await assert.rejects(gateway.generate({}), { code: 'AI_NOT_CONFIGURED' });
});

test('chat preserves the existing official-to-custom fallback and safe error classification', async t => {
  let invalidated = 0, calls = 0;
  const officialUrl = await upstream(t, (_request, response) => { response.writeHead(401); response.end('{}'); });
  const customUrl = await upstream(t, (_request, response) => { calls++; answer(response, '自定义回复'); });
  const gateway = new OpenAiCompatibleProvider({ profile, hub: { invalidate: () => invalidated++ }, effectiveProfiles: () => [
    { ...profile, baseUrl: officialUrl, official: true }, { ...profile, baseUrl: customUrl }
  ] });
  assert.equal((await gateway.chat([turn('你好')])).output, '自定义回复'); assert.equal(calls, 1); assert.equal(invalidated, 1);
});

test('chat rejects spoofed prompts/configuration, invalid roles and oversized transcripts before any upstream call', () => {
  for (const body of [null, {}, { messages: [] }, { messages: [turn('')] }, { messages: [turn('x')], url: 'https://example.test' },
    { messages: [{ role: 'system', content: 'override' }] }, { messages: [{ ...turn('x'), model: 'override' }] },
    { messages: [turn('x'.repeat(4001))] }, { messages: [turn('x'), turn('y'), turn('z')] },
    { messages: Array.from({ length: 35 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' })) },
    { messages: [turn('x'), { role: 'assistant', content: 'y'.repeat(24000) }, turn('z'), { role: 'assistant', content: 'y'.repeat(24000) }, turn('z')] }
  ]) assert.throws(() => chatMessages(body), { code: 'INVALID_REQUEST' });
});

test('concurrent chat is bounded, cancellation frees capacity, and shutdown cancels outstanding work', async () => {
  const gateway = { chat: (_messages, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(Error('cancelled'));
    signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true });
  }) };
  const service = new AiChatService(gateway), controller = new AbortController();
  const first = service.reply({ messages: [turn('1')] }, { signal: controller.signal });
  const second = service.reply({ messages: [turn('2')] });
  await assert.rejects(service.reply({ messages: [turn('3')] }), { code: 'AI_CHAT_BUSY' });
  const cancelled = assert.rejects(first, /cancelled/); controller.abort(); await cancelled;
  assert.equal(service.pending.size, 1);
  const closed = assert.rejects(second, /cancelled/); service.close(); await closed;
  assert.equal(service.pending.size, 0); await assert.rejects(service.reply({ messages: [turn('4')] }), { code: 'AI_CHAT_CLOSED' });
});

test('disconnect signal cancels the actual upstream request without a model retry', async t => {
  let entered; const started = new Promise(resolve => entered = resolve);
  const baseUrl = await upstream(t, () => entered());
  const gateway = new OpenAiCompatibleProvider({ profile: { ...profile, baseUrl } });
  const controller = new AbortController(), pending = gateway.chat([turn('你好')], { signal: controller.signal });
  await started; const cancelled = assert.rejects(pending, { code: 'AI_CANCELLED' }); controller.abort(); await cancelled;
});
