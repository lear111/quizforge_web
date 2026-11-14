// Compare two local checkouts using only synthetic data and loopback requests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { V2Server } from '../../server/v2/app.js';
import { createReadFixture, writeFixtureFile } from '../../test/fixtures/v2-banks.mjs';

const token = 'synthetic-http-token';
const json = { 'Content-Type': 'application/json' };

function requester(server, records) {
  const authority = `127.0.0.1:${server.port()}`;
  return async (label, target, status, options = {}) => {
    const { method = 'GET', headers = {}, body } = options;
    const bytes = body === undefined ? null : Buffer.from(body);
    const record = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: '127.0.0.1',
          port: server.port(),
          method,
          path: target,
          headers: {
            'X-QuizForge-Token': token,
            ...(bytes ? { 'Content-Length': bytes.length, ...json } : {}),
            ...headers,
            ...(headers.Origin === 'same' ? { Origin: 'http://' + authority } : {}),
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () =>
            resolve({
              label,
              method,
              target,
              status: response.statusCode,
              statusMessage: response.statusMessage,
              headers: response.rawHeaders,
              body: Buffer.concat(chunks).toString('base64'),
            }),
          );
        },
      );
      request.on('error', reject);
      request.setTimeout(10000, () => request.destroy(new Error('HTTP capture timed out')));
      request.end(bytes);
    });
    records.push(record);
    assert.equal(record.status, status, label);
    if (record.headers.includes('application/json; charset=utf-8') && method !== 'HEAD') {
      return JSON.parse(Buffer.from(record.body, 'base64').toString('utf8'));
    }
    return null;
  };
}

async function shellRequests(send) {
  await send('root', '/', 200);
  await send('root HEAD', '/', 200, { method: 'HEAD' });
  await send('root query', '/?demo=1', 200);
  await send('JS', '/ui/quizforge-ui.js', 200);
  await send('CSS HEAD', '/ui/quizforge-web-local.css', 200, { method: 'HEAD' });
  await send('unknown UI', '/ui/other.js', 404);
  await send('unknown page', '/unavailable', 404);
  await send('root wrong method', '/', 404, { method: 'POST' });
  await send('legacy', '/api/collections', 410);
  await send('legacy without token', '/api/collections', 401, {
    headers: { 'X-QuizForge-Token': '' },
  });
  await send('unknown API read', '/api/v2/unknown', 501);
  await send('unknown API write', '/api/v2/unknown', 501, { method: 'PUT', body: 'not JSON' });
  await send('OPTIONS', '/api/v2/catalog', 501, { method: 'OPTIONS' });
  await send('asterisk target', '*', 400, { method: 'OPTIONS' });
  await send('absolute target', 'http://localhost/api/v2/catalog', 400);
  await send('case sensitive', '/api/v2/Catalog', 501);
  await send('malformed encoding', '/api/v2/%ZZ', 400);
  await send('invalid path field', '/api/v2/%2F', 400);
  await send('bad target', '//api/v2/catalog', 400);
  await send('host rejected', '/api/v2/catalog', 403, {
    headers: { Host: 'outside.example.test' },
  });
  await send('forwarded header rejected', '/api/v2/catalog', 403, {
    headers: { 'X-Forwarded-Host': 'outside.example.test' },
  });
  await send('origin rejected', '/api/v2/catalog', 403, {
    headers: { Origin: 'http://outside.example.test' },
  });
  await send('cross site rejected', '/api/v2/catalog', 403, {
    headers: { 'Sec-Fetch-Site': 'cross-site' },
  });
  await send('same origin health', '/api/v2/health', 200, { headers: { Origin: 'same' } });
  await send('health HEAD', '/api/v2/health', 200, { method: 'HEAD' });
  await send('canonical locator', '/api//v2/%68ealth/', 200);
}

async function readRequests(send, base, overview) {
  const suffix = `?snapshotId=${overview.snapshotId}`;
  const q = overview.initial.question;
  const ext = '/api/v2/extensions/' + q.extension.artifactId;
  const question = `${base}/questions/1`;
  await send('read question', question + suffix, 200);
  await send('read question HEAD', question + suffix, 200, { method: 'HEAD' });
  await send('missing question', `${base}/questions/missing` + suffix, 404);
  await send('stale snapshot', question + '?snapshotId=bad', 409);
  await send('asset', `${question}/assets/${q.resources[0].assetId}` + suffix, 200);
  const privateAsset = createHash('sha256').update('1\0qf-asset:assets/solution.txt').digest('hex');
  await send(
    'locked-only asset denied before lock',
    `${question}/assets/${privateAsset}` + suffix,
    404,
  );
  await send('manifest', ext + '/manifest', 200);
  for (const entry of ['practice-html', 'practice-js', 'practice-css', 'grade-js']) {
    await send(`extension ${entry}`, ext + '/files/' + entry, 200);
  }
  await send('missing extension file', ext + '/files/missing', 404);
  await send('missing extension', '/api/v2/extensions/missing/manifest', 404);
  await send('missing extension unknown read', '/api/v2/extensions/missing/unknown', 404);
  await send('existing extension unknown read', ext + '/unknown', 501);
  await send('SDK', '/api/v2/sdk/richtext/2.0.0/sdk.js' + suffix, 200);
  await send('SDK HEAD', '/api/v2/sdk/richtext/2.0.0/sdk.js' + suffix, 200, { method: 'HEAD' });
  await send('SDK without snapshot', '/api/v2/sdk/richtext/2.0.0/sdk.js', 200);
  await send('SDK unavailable', '/api/v2/sdk/richtext/9.0.0/sdk.js' + suffix, 404);
  const audio = `${base}/listening/local` + suffix;
  await send('local audio', audio, 200);
  await send('range', audio, 206, { headers: { Range: 'bytes=0-7' } });
  await send('suffix range HEAD', audio, 206, { method: 'HEAD', headers: { Range: 'bytes=-4' } });
  await send('bad range', audio, 416, { headers: { Range: 'bytes=999999-' } });
  await send('HTTPS audio metadata', `${base}/listening/https` + suffix, 200);
  await send('HTTP audio metadata', `${base}/listening/http` + suffix, 200);
}

function writers(send, base, snapshotId) {
  return (label, target, method, status, fields) =>
    send(label, base + target, status, {
      method,
      // Decimal spelling is part of the write/read contract, not JS stringification.
      body: JSON.stringify({ requestId: label, snapshotId, ...fields }).replace('0.1', '0.1000'),
    });
}

async function invalidBodies(send, answerPath) {
  await send('non-JSON', answerPath, 400, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: '{}',
  });
  await send('repeated JSON key', answerPath, 400, { method: 'PUT', body: '{"a":1,"a":2}' });
  await send('invalid JSON', answerPath, 400, { method: 'PUT', body: '{' });
  await send('large JSON', answerPath, 413, {
    method: 'PUT',
    body: ' '.repeat(32 * 1024 * 1024 + 1),
  });
}

async function practiceWrites(send, base, snapshotId, store) {
  const write = writers(send, base, snapshotId);
  const question = '/questions/1';
  const answerPath = `${base}${question}/answer`;
  await invalidBodies(send, answerPath);
  const fields = { expectedRevision: 0, answer: { selected: '乙', weight: 0.1 }, answered: true };
  const originalWrite = store.write;
  store.write = () => {
    throw new Error('simulated write failure');
  };
  try {
    await write('write failure', question + '/answer', 'PUT', 503, fields);
  } finally {
    store.write = originalWrite;
  }
  const saved = await write('save answer', question + '/answer', 'PUT', 200, fields);
  await write('revision conflict', question + '/answer', 'PUT', 409, fields);
  const replay = await write('save replay', question + '/answer', 'PUT', 200, {
    ...fields,
    requestId: 'save answer',
  });
  assert.deepEqual(replay, saved);
  const ink = await write('save ink', question + '/ink', 'PUT', 200, {
    expectedInkRevision: 0,
    ink: { strokes: [] },
  });
  const lock = await write('submit', question + '/submit', 'POST', 200, {
    expectedRevision: saved.state.revision,
    answer: fields.answer,
  });
  const result = {
    submissionId: lock.submissionId,
    expectedRevision: lock.state.revision,
    source: 'grader',
    result: { score: 2, parts: null, message: null },
  };
  await write('invalid score', question + '/result', 'PUT', 422, {
    ...result,
    result: { ...result.result, score: 99 },
  });
  const graded = await write('result', question + '/result', 'PUT', 200, result);
  return write('retry', question + '/retry', 'POST', 200, {
    expectedRevision: graded.state.revision,
    expectedInkRevision: ink.inkRevision,
  });
}

async function roundWrites(send, base, snapshotId, revision) {
  const write = writers(send, base, snapshotId);
  await write('refresh', '/refresh', 'POST', 200, { expectedSnapshotId: snapshotId });
  await write('round answer', '/questions/1/answer', 'PUT', 200, {
    expectedRevision: revision,
    answer: { selected: '乙' },
    answered: true,
  });
  const round = await write('finish', '/finish', 'POST', 200, {});
  const question = round.pendingGrading[0].question;
  const row = {
    questionId: question.questionId,
    submissionId: question.submissionId,
    expectedRevision: question.state.revision,
    result: { score: 2, parts: null, message: null },
  };
  await write('batch stale lock', '/results', 'PUT', 409, {
    results: [{ ...row, submissionId: 'old' }],
  });
  await write('batch results', '/results', 'PUT', 200, { results: [row] });
  await write('finish again', '/finish', 'POST', 200, {});
}

async function capture(Server, records) {
  const fixture = createReadFixture({ count: 6 });
  let server;
  try {
    writeFixtureFile(path.join(fixture.codeRoot, 'web/ui/quizforge-ui.js'), '// synthetic JS');
    writeFixtureFile(path.join(fixture.codeRoot, 'web/ui/quizforge-web-local.css'), 'body {}');
    server = await new Server({ ...fixture, token }).start();
    const store = server.library.stateStore;
    let serial = 0;
    store.uuid = () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
    store.now = () => '2026-01-01T00:00:00.000Z';
    const send = requester(server, records);
    await shellRequests(send);
    const catalog = await send('catalog', '/api/v2/catalog', 200);
    const base = '/api/v2/banks/' + catalog.groups[0].items[0].bankId;
    await send('unknown bank', '/api/v2/banks/missing/overview', 404);
    const overview = await send('overview', base + '/overview', 200);
    await send('overview HEAD', base + '/overview', 200, { method: 'HEAD' });
    await readRequests(send, base, overview);
    const retried = await practiceWrites(send, base, overview.snapshotId, store);
    await roundWrites(send, base, overview.snapshotId, retried.state.revision);
  } finally {
    await server?.close();
    fixture.cleanup();
  }
}

function normalize(record) {
  const headers = [];
  let body = record.body;
  for (let index = 0; index < record.headers.length; index += 2) {
    const name = record.headers[index];
    let value = record.headers[index + 1];
    if (name.toLowerCase() === 'date') {
      assert.ok(Number.isFinite(Date.parse(value)), record.label);
      value = '<date>';
    } else if (name.toLowerCase() === 'server-timing') {
      assert.match(value, /^[\w-]+;dur=\d+\.\d{3}(?:, [\w-]+;dur=\d+\.\d{3})*$/);
      value = value.replace(/dur=\d+\.\d{3}/g, 'dur=<ms>');
    } else if (
      record.label.startsWith('root') &&
      name.toLowerCase() === 'content-security-policy'
    ) {
      const nonce = /'nonce-([A-Za-z0-9+/]{24})'/.exec(value)?.[1];
      assert.ok(nonce, record.label);
      value = value.replaceAll(nonce, 'N'.repeat(24));
      if (record.method !== 'HEAD') {
        const html = Buffer.from(body, 'base64').toString('utf8');
        assert.equal(html.split(`nonce="${nonce}"`).length, 3);
        assert.ok(html.includes(`,${JSON.stringify(nonce)});`));
        body = Buffer.from(html.replaceAll(nonce, 'N'.repeat(24))).toString('base64');
      }
    }
    headers.push(name, value);
  }
  return { ...record, headers, body };
}

const [baseline, output] = process.argv.slice(2);
if (!baseline || !output) {
  throw new Error('Usage: node compare-v2-http.mjs <baseline checkout> <output directory>');
}
const relocatedEntry = path.resolve(baseline, 'core/server/v2/app.js');
const entry = fs.existsSync(relocatedEntry)
  ? relocatedEntry
  : path.resolve(baseline, 'core/server/host/v2/server.js');
const { V2Server: Before } = await import(pathToFileURL(entry).href);
fs.mkdirSync(output, { recursive: true });
const compare = [];
for (const [name, Server] of [
  ['before', Before],
  ['after', V2Server],
]) {
  const records = [];
  try {
    await capture(Server, records);
  } finally {
    const file = path.join(output, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n', { flag: 'wx' });
  }
  compare.push(records.map(normalize));
}
compare[0].forEach((record, index) => assert.deepEqual(compare[1][index], record, record.label));
assert.equal(compare[1].length, compare[0].length);
const sha256 = createHash('sha256').update(JSON.stringify(compare[0])).digest('hex');
console.log(JSON.stringify({ requests: compare[0].length, differences: 0, sha256 }));
