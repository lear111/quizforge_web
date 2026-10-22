import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { HubConnection, HUB_ORIGIN } from './hub-connection.js';
import { AiSettings } from './ai-settings.js';
import { OpenAiCompatibleProvider, classifyOfficial } from './ai-provider.js';
import { safeDirectory, within } from '../platform/files.js';

const codeRoot = fileURLToPath(new URL('../../../', import.meta.url)), temporaryRoot = path.join(path.dirname(codeRoot), '.temp', 'hub-connection');
function directory(t) { safeDirectory(temporaryRoot, true); const root = fs.mkdtempSync(path.join(temporaryRoot, 'hub-')); t.after(() => { assert.ok(within(temporaryRoot, root) && root !== temporaryRoot); fs.rmSync(root, { recursive: true, force: true }); }); return root; }
const TOKEN = 'qfd_' + 'A'.repeat(43);

// A minimal stand-in for the Hub side of docs/HUB_CONNECT_AI.md.
async function fakeHub(t, { gateway } = {}) {
  const state = { grants: new Map(), requests: [], revoked: false, points: 30 };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    state.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    const authorized = req.headers.authorization === 'Bearer ' + TOKEN && !state.revoked;
    if (req.url === '/api/connect/token') {
      const grant = state.grants.get(body.code); state.grants.delete(body.code);
      const valid = grant && createHash('sha256').update(body.code_verifier).digest('base64url') === grant.challenge && body.redirect_uri === grant.redirectUri && body.client === 'web' && body.v === 1;
      return valid ? send(200, { token: TOKEN, device: { id: 'device-1', name: grant.name, client: 'web', created: '2026-10-22T00:00:00Z' }, user: { name: 'alice' } }) : send(400, { error: { code: 'INVALID_GRANT', message: '授权已过期或无效，请重新登录' } });
    }
    if (req.url === '/api/connect/me') return authorized ? send(200, { user: { name: 'alice' }, device: { id: 'device-1', name: 'pc', client: 'web' }, ai: { enabled: true, model: '通义千问 qwen-vl-plus', vision: true, points: state.points, tokensPerPoint: 1000 } }) : send(401, { error: { code: 'DEVICE_TOKEN_INVALID', message: 'x' } });
    if (req.url === '/api/connect/redeem') {
      if (!authorized) return send(401, { error: { code: 'DEVICE_TOKEN_INVALID', message: 'x' } });
      if (body.code !== 'AI-GOOD-CODE-0000-0000') return send(400, { error: { code: 'REDEEM_CODE_INVALID', message: '<b>server text</b>' } });
      state.points += 100; return send(200, { added: 100, points: state.points });
    }
    if (req.url === '/api/connect/logout') { state.revoked = true; res.writeHead(204).end(); return; }
    if (req.url === '/api/ai/v1/chat/completions') {
      if (!authorized) return send(401, { error: { code: 'DEVICE_TOKEN_INVALID', message: 'x' } });
      const [status, value] = gateway ? gateway(body) : [200, { id: 'qf-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"score":2,"feedback":"不错"}' } }], usage: { total_tokens: 50 } }];
      return send(status, value);
    }
    send(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  // What the Hub consent page does: remember the challenge and hand back a code.
  const allow = authorizeUrl => {
    const url = new URL(authorizeUrl), code = 'C'.repeat(43);
    state.grants.set(code, { challenge: url.searchParams.get('code_challenge'), redirectUri: url.searchParams.get('redirect_uri'), name: url.searchParams.get('device_name') });
    return new URLSearchParams({ code, state: url.searchParams.get('state') });
  };
  return { origin, state, allow };
}
const gradingInput = { protocolVersion: 1, maxScore: 5, scoreStep: 1, question: [{ type: 'text', text: '题目' }], answer: [{ type: 'text', text: '答案' }], referenceAnswer: [{ type: 'text', text: '参考' }] };

test('the login link follows the protocol: fixed Hub origin, loopback callback, PKCE S256 and a device name', t => {
  const hub = new HubConnection(directory(t), { hostname: 'STUDY\u0007-PC' });
  const url = new URL(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl);
  assert.equal(url.origin, HUB_ORIGIN); assert.equal(url.pathname, '/connect/authorize');
  assert.deepEqual([...url.searchParams.keys()], ['v', 'client', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'device_name']);
  assert.equal(url.searchParams.get('client'), 'web'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/); assert.equal(url.searchParams.get('device_name'), 'STUDY-PC');
  assert.ok(url.searchParams.get('state').length >= 32);
});

test('completing login saves only the device token, reads quota, and logout revokes it', async t => {
  const root = directory(t), fake = await fakeHub(t), hub = new HubConnection(root, { origin: fake.origin, hostname: 'pc' });
  await assert.rejects(hub.complete(new URLSearchParams({ code: 'C'.repeat(43), state: 'unknown-state-value-0000' })), { code: 'HUB_CONNECT_EXPIRED' });
  const denied = new URL(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl);
  await assert.rejects(hub.complete(new URLSearchParams({ error: 'access_denied', state: denied.searchParams.get('state') })), { code: 'HUB_CONNECT_DENIED' });
  const query = fake.allow(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl);
  assert.deepEqual(await hub.complete(query), { connected: true, user: { name: 'alice' }, device: { name: 'pc', client: 'web' } });
  await assert.rejects(hub.complete(query), { code: 'HUB_CONNECT_EXPIRED' }, 'a state is single-use');
  const saved = JSON.parse(fs.readFileSync(hub.file, 'utf8'));
  assert.equal(saved.token, TOKEN); assert.equal('verifier' in saved, false);
  assert.equal(new HubConnection(root, { origin: fake.origin }).token(), TOKEN, 'the connection survives a restart');
  const account = await hub.account();
  assert.deepEqual(account.ai, { enabled: true, model: '通义千问 qwen-vl-plus', points: 30 });
  assert.deepEqual(await hub.redeem(' AI-GOOD-CODE-0000-0000 '), { added: 100, points: 130 });
  await assert.rejects(hub.redeem('AI-WRONG'), error => error.code === 'REDEEM_CODE_INVALID' && error.status === 400 && !error.message.includes('<b>'), 'the message is our own, not the server text');
  await assert.rejects(hub.redeem(''), { code: 'REDEEM_CODE_INVALID' });
  assert.deepEqual(await hub.logout(), { connected: false });
  assert.equal(fake.state.revoked, true); assert.equal(fs.existsSync(hub.file), false);
});

test('a token the Hub rejects logs this computer out', async t => {
  const fake = await fakeHub(t), hub = new HubConnection(directory(t), { origin: fake.origin });
  await hub.complete(fake.allow(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl));
  fake.state.revoked = true;
  assert.deepEqual(await hub.account(), { connected: false, expired: true });
  assert.equal(hub.token(), null);
});

test('the free quota grades through the Hub gateway with the device token and keeps custom settings', async t => {
  const root = directory(t), fake = await fakeHub(t), hub = new HubConnection(root, { origin: fake.origin });
  const settings = new AiSettings(root); settings.attachHub(hub);
  await settings.update({ enabled: true, baseUrl: 'https://custom.example/v1', model: 'my-model', apiKey: 'synthetic-custom-key' });
  await settings.update({ useOfficial: true, useCustom: false });
  assert.deepEqual([settings.status().useOfficial, settings.status().useCustom], [true, false]); assert.equal(settings.profile.baseUrl, 'https://custom.example/v1', 'custom fields stay saved');
  const provider = new OpenAiCompatibleProvider(settings, { read() { throw new Error('no images'); } });
  await assert.rejects(provider.generate({ gradingInput }), { code: 'AI_OFFICIAL_LOGIN' }, 'the free quota alone needs a login');
  await hub.complete(fake.allow(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl));
  const result = await provider.generate({ gradingInput });
  assert.equal(result.provider, 'quizforge-official'); assert.equal(result.model, 'quizforge-official'); assert.equal(result.output, '{"score":2,"feedback":"不错"}');
  const sent = fake.state.requests.find(entry => entry.url === '/api/ai/v1/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer ' + TOKEN); assert.equal(sent.body.model, 'quizforge-official'); assert.deepEqual(sent.body.response_format, { type: 'json_object' });
  assert.equal(JSON.stringify(sent.body).includes('synthetic-custom-key'), false, 'the custom key never reaches the Hub');
  await settings.update({ useOfficial: false, useCustom: true });
  assert.equal(provider.configured(true).baseUrl, 'https://custom.example/v1', 'switching back restores the custom model');
});

test('gateway errors become clear, non-retried messages and a rejected token logs out', async t => {
  let reply = [402, { error: { code: 'AI_POINTS_EXHAUSTED', message: 'x', points: 0 } }];
  const root = directory(t), fake = await fakeHub(t, { gateway: () => reply }), hub = new HubConnection(root, { origin: fake.origin });
  const settings = new AiSettings(root); settings.attachHub(hub); await settings.update({ useOfficial: true, enabled: true });
  await hub.complete(fake.allow(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl));
  const provider = new OpenAiCompatibleProvider(settings, { read() {} });
  await assert.rejects(provider.generate({ gradingInput }), error => error.code === 'AI_OFFICIAL_POINTS' && !error.retryable && /兑换码/.test(error.message));
  reply = [503, { error: { code: 'AI_BUDGET_EXHAUSTED', message: 'x' } }];
  await assert.rejects(provider.generate({ gradingInput }), { code: 'AI_OFFICIAL_BUDGET' });
  reply = [502, { error: { code: 'AI_UPSTREAM_FAILED', message: 'x' } }];
  await assert.rejects(provider.generate({ gradingInput }), error => error.code === 'AI_UPSTREAM' && error.retryable);
  fake.state.revoked = true;
  await assert.rejects(provider.generate({ gradingInput }), { code: 'AI_OFFICIAL_LOGIN' });
  assert.equal(hub.token(), null, 'the rejected token is forgotten');
  assert.equal(classifyOfficial(404, Buffer.from('{"error":{"code":"OFFICIAL_AI_DISABLED"}}')).code, 'AI_OFFICIAL_UNAVAILABLE');
  assert.equal(classifyOfficial(413, Buffer.from('{}')).code, 'AI_INPUT_LIMIT');
  await assert.rejects(provider.testConnection(), { code: 'AI_NOT_CONFIGURED' }, 'model diagnostics never spend the free quota');
});

test('with both sources on, the free quota grades first and the custom model takes over when it cannot', async t => {
  let reply = null;
  const root = directory(t), fake = await fakeHub(t, { gateway: () => reply ?? [200, { id: 'qf-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"score":2,"feedback":"免费"}' } }], usage: { total_tokens: 50 } }] });
  const custom = [];
  const local = http.createServer(async (req, res) => { const chunks = []; for await (const chunk of req) chunks.push(chunk); custom.push({ authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'local-1', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"score":1,"feedback":"自定义"}' } }] })); });
  local.listen(0, '127.0.0.1'); await once(local, 'listening'); t.after(() => local.close());
  const hub = new HubConnection(root, { origin: fake.origin }), settings = new AiSettings(root); settings.attachHub(hub);
  await settings.update({ enabled: true, useOfficial: true, useCustom: true, baseUrl: `http://127.0.0.1:${local.address().port}/v1`, model: 'local-model', apiKey: 'synthetic-local-key' });
  const provider = new OpenAiCompatibleProvider(settings, { read() {} });
  assert.equal((await provider.generate({ gradingInput })).provider, 'openai-compatible', 'without a login the custom model grades');
  await hub.complete(fake.allow(hub.start('http://127.0.0.1:8787/hub/connect/callback').authorizeUrl));
  const first = await provider.generate({ gradingInput });
  assert.equal(first.provider, 'quizforge-official'); assert.equal(custom.length, 1, 'the free quota is tried first');
  for (const [status, code] of [[402, 'AI_POINTS_EXHAUSTED'], [503, 'AI_BUDGET_EXHAUSTED'], [502, 'AI_UPSTREAM_FAILED'], [404, 'OFFICIAL_AI_DISABLED']]) {
    reply = [status, { error: { code, message: 'x' } }];
    const result = await provider.generate({ gradingInput });
    assert.equal(result.provider, 'openai-compatible', code); assert.equal(result.output, '{"score":1,"feedback":"自定义"}');
  }
  assert.equal(custom.at(-1).authorization, 'Bearer synthetic-local-key'); assert.equal(JSON.stringify(custom).includes('qfd_'), false, 'the device token never reaches the custom model');
  reply = [400, { error: { code: 'AI_REQUEST_UNSUPPORTED', message: 'x' } }];
  await assert.rejects(provider.generate({ gradingInput }), { code: 'AI_CONFIG' }, 'a request problem is not hidden by switching models');
  reply = null; const frozen = provider.freeze(); await settings.update({ useCustom: false });
  reply = [402, { error: { code: 'AI_POINTS_EXHAUSTED', message: 'x' } }];
  assert.equal((await frozen.generate({ gradingInput })).provider, 'openai-compatible', 'a queued task keeps the sources it started with');
  await assert.rejects(provider.generate({ gradingInput }), { code: 'AI_OFFICIAL_POINTS' }, 'with only the free quota there is nothing to fall back to');
});

test('settings saved with one source before this version keep working', t => {
  const root = directory(t), file = path.join(root, '.state', 'ai', 'profile.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, provider: 'openai-compatible', source: 'official', enabled: true, baseUrl: '', model: '', apiKey: '', vision: false, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 90, autoGrade: false }));
  assert.deepEqual([new AiSettings(root).profile.useOfficial, new AiSettings(root).profile.useCustom], [true, false]);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, provider: 'openai-compatible', source: 'custom', enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'local', apiKey: '', vision: false, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 90, autoGrade: false }));
  assert.deepEqual([new AiSettings(root).profile.useOfficial, new AiSettings(root).profile.useCustom], [false, true]);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, provider: 'openai-compatible', enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'local', apiKey: '', vision: false, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 90, autoGrade: false }));
  assert.deepEqual([new AiSettings(root).profile.useOfficial, new AiSettings(root).profile.useCustom], [false, true], 'files from before any source field mean the custom model');
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, provider: 'openai-compatible', enabled: false, baseUrl: '', model: '', apiKey: '', vision: false, outputMode: 'json', maxOutputTokens: 8192, timeoutSeconds: 90, autoGrade: false }));
  assert.deepEqual([new AiSettings(root).profile.useOfficial, new AiSettings(root).profile.useCustom], [false, false]);
});
