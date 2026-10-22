import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { AiSettings } from './ai-settings.js';
import { NetworkSettings, normalizePublicUrl } from '../http/network-settings.js';
import { hostKey, sameIpv6Subnet } from '../http/network-addresses.js';
import { OpenAiCompatibleProvider, boundedRequest, classify } from './ai-provider.js';
import { challenge, runDiagnostics, closeEnough } from './ai-diagnostics.js';
import { EditorDraftStore } from '../editor/editor-drafts.js';
import { PracticeSessions } from '../practice/practice-sessions.js';
import { safeDirectory, within } from '../platform/files.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), temporaryRoot = path.join(path.dirname(codeRoot), '.temp', 'node-migration');
function directory(t) { safeDirectory(temporaryRoot, true); const root = fs.mkdtempSync(path.join(temporaryRoot, 'settings-')); t.after(() => { assert.ok(within(temporaryRoot, root) && root !== temporaryRoot); fs.rmSync(root, { recursive: true, force: true }); }); return root; }
test('network password hashes and saved settings reopen without exposing the password', async t => {
  const root = directory(t), settings = new NetworkSettings(root, 8788), password = 'fixture-password';
  const candidate = await settings.candidate({ enabled: true, publicEnabled: true, publicUrl: 'https://example.com/', port: 8788, password }, 8787); settings.save(candidate);
  assert.equal(fs.readFileSync(settings.file, 'utf8').includes(password), false);
  const reopened = new NetworkSettings(root, 8788), token = await reopened.login(password, '192.168.1.2'); assert.equal(reopened.authenticated(token), true);
  await assert.rejects(reopened.login('wrong', '192.168.1.2'), { code: 'PASSWORD_REQUIRED' });
  reopened.save(await reopened.candidate({ enabled: false, publicEnabled: false, publicUrl: '', port: 8788 }, 8787)); assert.equal(reopened.authenticated(token), false);
});
test('remote addresses normalize IPv6 identities and refuse local/public URL tricks', () => {
  assert.equal(normalizePublicUrl('https://Example.com:443/'), 'https://example.com/'); assert.equal(hostKey('2001:db8::1'), hostKey('[2001:0db8:0:0:0:0:0:1]'));
  assert.equal(sameIpv6Subnet('2001:db8:1234:5678::1', '2001:db8:1234:5678::2', 64), true); assert.equal(sameIpv6Subnet('2001:db8::1', '2001:db9::1', 32), false);
  for (const value of ['http://127.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'https://example.com/path', 'https://user:pass@example.com/', 'http://[fe80::1]/']) assert.throws(() => normalizePublicUrl(value), { code: 'INVALID_PUBLIC_URL' });
});
test('AI settings preserve masked-key editing and owner-protected saved credentials', async t => {
  const root = directory(t), settings = new AiSettings(root), key = 'fixture-secret';
  await settings.update({ baseUrl: 'https://example.com/v1', model: 'fixture', apiKey: key }); assert.equal(settings.status().apiKeyConfigured, true); assert.equal(Object.hasOwn(settings.status(), 'apiKey'), false);
  const reopened = new AiSettings(root); assert.equal(reopened.credential().apiKey, key); await reopened.update({ apiKey: '', clearApiKey: true }); assert.equal(reopened.credential().apiKey, '');
  await assert.rejects(reopened.update({ enabled: true, baseUrl: 'http://203.0.113.10/v1', model: 'fixture' }), { code: 'INVALID_REQUEST' });
});
test('editor drafts remain separate from question validation and reject extra fields', t => {
  const root = directory(t), store = new EditorDraftStore(root), request = { contentVersion: 'a'.repeat(64), changed: true, draft: { unfinished: true } };
  assert.deepEqual(store.get('bank', 'question'), { draft: null }); assert.equal(store.put('bank', 'question', request).saved, true); assert.deepEqual(store.get('bank', 'question'), request); assert.throws(() => store.put('bank', 'question', { ...request, extra: true }), { code: 'INVALID_REQUEST' }); assert.equal(store.delete('bank', 'question').deleted, true);
});
test('page practice expiry cannot replace a leased session', async () => {
  let now = 0, created = 0, closed = 0; const sessions = new PracticeSessions(async () => ({ sequence: ++created, bytes: () => 0, close: () => closed++ }), { now: () => now }), id = '12345678-1234-1234-1234-123456789012';
  const first = await sessions.acquire(id, true, false); now = 31 * 60 * 1000; const second = await sessions.acquire(id, true, false); assert.equal(second.session, first.session); first.close(); second.close(); now += 31 * 60 * 1000;
  const third = await sessions.acquire(id, true, false); assert.equal(third.session.sequence, 2); assert.equal(closed, 1); third.close(); sessions.close();
});
test('model diagnostics test text, score format and randomized image and preserve the report', async () => {
  const image = challenge(); assert.match(image.expected, /^[A-Z2-9]{6}$/); assert.match(image.dataUrl, /^data:image\/png;base64,/); let report;
  const settings = { profile: { baseUrl: 'https://example.com/v1', model: 'fixture', timeoutSeconds: 90 }, async saveTest(tested, value, vision, mode) { report = value; assert.equal(vision, true); assert.equal(mode, 'json'); return { enabled: false }; } }, probes = [];
  const result = await runDiagnostics(settings, async (profile, content) => { probes.push(content); return { output: probes.length === 1 ? '{"score":2.5,"feedback":"ok"}' : JSON.stringify({ score: 0, feedback: image.expected }) }; }, () => image);
  assert.equal(result.status, 'passed'); assert.equal(result.calls, 2); assert.equal(report.checks.length, 3); assert.equal(probes[1][0].text.includes(image.expected), false);
});

test('disabled AI remains disabled across persisted settings reload without losing automatic preference',async t=>{
  const testRoot=directory(t),settings=new AiSettings(testRoot);
  await settings.update({enabled:true,autoGrade:true,baseUrl:'https://example.com/v1',model:'fixture',apiKey:'synthetic-key'});
  assert.equal((await settings.update({enabled:false})).enabled,false);
  const reloaded=new AiSettings(testRoot);assert.equal(reloaded.status().enabled,false);assert.equal(reloaded.status().autoGrade,true);
  assert.equal(reloaded.credential().apiKey,'synthetic-key');
});
async function server(t, handler) { const service = http.createServer(handler); service.listen(0, '127.0.0.1'); await once(service, 'listening'); t.after(() => { service.closeAllConnections(); service.close(); }); return `http://127.0.0.1:${service.address().port}/v1`; }
test('native model gateway sends the existing combined prompt and redacts returned key', async t => {
  let sent; const baseUrl = await server(t, async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); sent = JSON.parse(Buffer.concat(chunks)); response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"score":1,"feedback":"fixture-secret"}' } }], usage: { total_tokens: 9 } })); });
  const profile = { enabled: true, baseUrl, model: 'fixture', apiKey: 'fixture-secret', outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 2, vision: false }, gateway = new OpenAiCompatibleProvider({ profile }, { read() { throw new Error(); } });
  const input = { protocolVersion: 1, question: [{ type: 'text', text: 'question' }], answer: [{ type: 'text', text: 'answer' }], referenceAnswer: [], rubric: [{ type: 'text', text: 'basis' }], maxScore: 2, scoreStep: .5 };
  const result = await gateway.generate({ gradingInput: input }); assert.equal(result.output.includes('fixture-secret'), false); assert.equal(sent.max_tokens, 8192); assert.ok(sent.messages[1].content.some(block => block.text?.includes('参考答案与评分依据'))); assert.ok(sent.messages[1].content.some(block => block.text === '评分依据：'));
  input.answer = [{ type: 'image', assetId: 'a'.repeat(64) }]; await assert.rejects(gateway.generate({ gradingInput: input }), { code: 'AI_VISION_UNSUPPORTED' });
});
test('gateway rejects oversized streaming responses, redirects and timeout without leaking server text', async t => {
  const oversized = await server(t, (request, response) => response.end(Buffer.alloc(2 * 1024 * 1024 + 1, 65))), profile = { apiKey: '', timeoutSeconds: 2 };
  await assert.rejects(boundedRequest(oversized + '/chat/completions', Buffer.from('{}'), profile), { code: 'AI_RESPONSE_LIMIT' });
  const waiting = await server(t, () => {}); await assert.rejects(boundedRequest(waiting, Buffer.from('{}'), { ...profile, timeoutSeconds: .05 }), { code: 'AI_TIMEOUT' });
  assert.equal(classify('https://example.com/v1', 302, Buffer.from('{}')).code, 'AI_CONFIG');
  assert.equal(classify('https://dashscope.aliyuncs.com/v1', 429, Buffer.from('{"error":{"code":"insufficient_quota"}}')).code, 'AI_RATE_LIMIT');
  assert.equal(classify('https://example.com/v1', 429, Buffer.from('{"error":{"code":"insufficient_quota"}}')).code, 'AI_QUOTA');
});

test('the vision check ignores case, spaces and separators and allows one wrong character', () => {
  assert.equal(closeEnough('k7m 2-p5', 'K7M2P5'), true);
  assert.equal(closeEnough('K7M2PS', 'K7M2P5'), true, 'one misread character');
  assert.equal(closeEnough('K7M2P', 'K7M2P5'), true, 'one missing character');
  assert.equal(closeEnough('K7N2PS', 'K7M2P5'), false, 'two misread characters');
  assert.equal(closeEnough('', 'K7M2P5'), false);
});
