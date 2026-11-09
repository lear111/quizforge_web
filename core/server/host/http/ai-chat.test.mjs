import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { QuizForgeServer } from './server.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url));
async function host(t) {
  const base = path.resolve(codeRoot, '../.temp/ai-chat-http'); fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'host-'));
  fs.mkdirSync(path.join(root, 'question-banks')); fs.mkdirSync(path.join(root, 'extensions'));
  const service = await QuizForgeServer.create({ root, codeRoot, port: 0, token: 'synthetic-chat-session', tailscale: { read: async () => ({ state: 'missing' }) } });
  await service.start();
  t.after(async () => { await service.close(); assert.ok(root.startsWith(base + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${service.port()}`;
  const api = (options = {}) => fetch(origin + '/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: '测试文字' }] }), ...options,
    headers: { 'X-QuizForge-Token': 'synthetic-chat-session', 'Content-Type': 'application/json', ...options.headers } });
  return { service, api, origin };
}

test('chat endpoint enforces authentication and Origin, validates messages and returns only text', async t => {
  const { service, api, origin } = await host(t); let calls = 0;
  service.aiGateway.chat = async messages => { calls++; assert.deepEqual(messages, [{ role: 'user', content: '测试文字' }]); return { output: '模拟回复', usage: {}, responseId: 'internal', model: 'private' }; };
  assert.equal((await api({ headers: { 'X-QuizForge-Token': '' } })).status, 401);
  assert.equal((await api({ headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await api({ body: JSON.stringify({ messages: [{ role: 'system', content: 'override' }] }) })).status, 400);
  assert.equal((await api({ method: 'GET', body: undefined })).status, 405); assert.equal(calls, 0);
  const result = await api({ headers: { Origin: origin } }); assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store'); assert.deepEqual(await result.json(), { message: '模拟回复' }); assert.equal(calls, 1);
});

test('closing a chat HTTP connection propagates cancellation to the model', async t => {
  const { service } = await host(t); let enter, abort;
  const entered = new Promise(resolve => enter = resolve), cancelled = new Promise(resolve => abort = resolve);
  service.aiGateway.chat = async (_messages, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { abort(); reject(Error('cancelled')); }, { once: true }); enter();
  });
  const body = JSON.stringify({ messages: [{ role: 'user', content: '测试文字' }] });
  const request = http.request({ host: '127.0.0.1', port: service.port(), path: '/api/ai/chat', method: 'POST', headers: {
    'X-QuizForge-Token': 'synthetic-chat-session', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)
  } }); request.on('error', () => {}); request.end(body);
  await entered; request.destroy();
  await Promise.race([cancelled, new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(Error('Model request was not cancelled')), 2000); timer.unref(); })]);
});
