import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { V2Server } from '../../server/v2/app.js';
import { relativePath } from '../../server/v2/utils/io.js';
import { writeFixtureFile } from '../fixtures/v2-banks.mjs';
import { running } from '../fixtures/v2-readonly.mjs';

test('resources reject traversal, reserved names, redirects and cross-question access', async (t) => {
  const { fixture, open, get, base } = await running(t);
  for (const relative of [
    '../x',
    '/x',
    'assets\\x',
    'assets/x:y',
    'assets/CON.png',
    'assets/x.',
    'assets/x ',
    'assets//x',
    'assets/./x',
    'assets/x?query',
  ]) {
    assert.throws(() => relativePath(fixture.directory, relative), { code: 'ASSET_PATH_INVALID' });
  }
  const opened = (await open()).body;
  const q = opened.initial.question,
    token = '?snapshotId=' + opened.snapshotId;
  assert.equal(
    (await get(base + '/questions/2/assets/' + q.resources[0].assetId + token)).response.status,
    404,
  );
  const outside = path.join(fixture.root, 'outside');
  writeFixtureFile(path.join(outside, 'secret.png'), 'not public');
  const linked = path.join(fixture.directory, 'assets', 'linked');
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const bad = await open();
  assert.equal(bad.response.status, 422);
  assert.equal(bad.body.error.code, 'ASSET_PATH_INVALID');
  fs.rmSync(linked, { recursive: true });
  fixture.bank.questions['1'].question.stem = 'qf-asset:../outside/secret.png';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'ASSET_PATH_INVALID');
  fixture.bank.questions['1'].question.stem = 'qf-asset:bank.json';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await open()).body.initial.error.code, 'ASSET_PATH_INVALID');
});

test('read-only endpoints enforce Host, Origin and fresh-token boundaries without reading old LAN settings', async (t) => {
  const { fixture, server, get, url } = await running(t);
  assert.equal(
    (await get('/api/v2/health', { headers: { Origin: 'http://attacker.test' } })).response.status,
    403,
  );
  assert.equal(
    (await get('/api/v2/health', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).response.status,
    403,
  );
  assert.equal(
    (await get('/api/v2/health', { headers: { 'X-Forwarded-Host': '127.0.0.1' } })).response.status,
    403,
  );
  const rejected = await new Promise((resolve, reject) => {
    const request = http.get(
      url + '/api/v2/health',
      { headers: { Host: 'attacker.test:' + server.port() } },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      },
    );
    request.on('error', reject);
  });
  assert.equal(rejected, 403);
  const secured = await new V2Server({ ...fixture, token: 'new-token-1234' }).start();
  t.after(() => secured.close());
  const endpoint = `http://127.0.0.1:${secured.port()}/api/v2/health`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal(
    (await fetch(endpoint, { headers: { 'X-QuizForge-Token': 'new-token-1234' } })).status,
    200,
  );
  assert.throws(() => new V2Server({ ...fixture, host: '0.0.0.0' }), { code: 'AUTH_REQUIRED' });
});
