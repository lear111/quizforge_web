import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

const immutable = 'private, max-age=31536000, immutable';
async function setup(t, development = false) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  if (development) {
    const file = path.join(fixture.extension, 'manifest.json');
    writeFixtureFile(file, { ...JSON.parse(fs.readFileSync(file, 'utf8')), development: true });
  }
  const server = await new V2Server({ ...fixture, development }).start();
  t.after(() => server.close());
  const token = 'synthetic-local-token';
  server.token = token;
  const api = async (route, data, method = 'POST', auth = token) => {
    const response = await fetch(`http://127.0.0.1:${server.port()}${route}`, {
      headers: {
        'X-QuizForge-Token': auth,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { method, body: JSON.stringify(data) } : {}),
    });
    const text = await response.text();
    return {
      response,
      text,
      body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
    };
  };
  const catalog = await api('/api/v2/catalog'),
    base = '/api/v2/banks/' + catalog.body.groups[0].items[0].bankId;
  const opened = await api(base + '/overview'),
    s = opened.body.snapshotId,
    q = opened.body.initial.question,
    suffix = '?snapshotId=' + s;
  return { fixture, server, api, base, opened, s, q, suffix };
}

test('only versioned public resources use private immutable cache; API, errors and authorization stay no-store', async (t) => {
  const { api, base, opened, q, suffix } = await setup(t);
  const extension = '/api/v2/extensions/' + q.extension.artifactId;
  for (const route of [
    extension + '/manifest',
    ...['practice-html', 'practice-js', 'practice-css', 'grade-js'].map(
      (f) => extension + '/files/' + f,
    ),
    '/api/v2/sdk/richtext/2.0.0/sdk.js' + suffix,
    base + '/questions/1/assets/' + q.resources[0].assetId + suffix,
  ]) {
    const ok = await api(route);
    assert.equal(ok.response.status, 200, route);
    assert.equal(ok.response.headers.get('cache-control'), immutable, route);
    assert.equal(ok.response.headers.get('vary'), 'X-QuizForge-Token');
    const unauthorized = await api(route, undefined, 'GET', 'invalid');
    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(opened.response.headers.get('cache-control'), 'no-store');
  for (const route of [
    '/api/v2/catalog',
    base + '/questions/1' + suffix,
    '/api/v2/sdk/richtext/2.0.0/sdk.js',
    '/api/v2/sdk/richtext/2.0.0/sdk.js?snapshotId=bad',
    extension + '/files/absent',
  ]) {
    const r = await api(route);
    assert.equal(r.response.headers.get('cache-control'), 'no-store', route);
    assert.ok(!r.text.includes(SOLUTION_MARKER));
  }
});

test('solution-only resource is never cached even when locked, and becomes inaccessible again after retry', async (t) => {
  const { api, base, s, suffix } = await setup(t);
  const assetId = createHash('sha256').update('1\0qf-asset:assets/solution.txt').digest('hex'),
    route = base + '/questions/1/assets/' + assetId + suffix;
  const hidden = await api(route);
  assert.equal(hidden.response.status, 404);
  assert.equal(hidden.response.headers.get('cache-control'), 'no-store');
  assert.ok(!hidden.text.includes(SOLUTION_MARKER));
  const write = (op, fields, method = 'POST') =>
    api(base + '/questions/1/' + op, { snapshotId: s, ...fields }, method);
  const draft = await write('answer', { requestId: 'd', expectedRevision: 0, answer: {} }, 'PUT');
  const ink = await write(
    'ink',
    { requestId: 'i', expectedInkRevision: 0, ink: { strokes: [] } },
    'PUT',
  );
  const locked = await write('submit', {
    requestId: 's',
    expectedRevision: draft.body.state.revision,
    answer: {},
  });
  const visible = await api(route);
  assert.equal(visible.response.status, 200);
  assert.equal(visible.text, SOLUTION_MARKER);
  assert.equal(visible.response.headers.get('cache-control'), 'no-store');
  const graded = await write(
    'result',
    {
      requestId: 'g',
      submissionId: locked.body.submissionId,
      expectedRevision: locked.body.state.revision,
      source: 'grader',
      result: { score: 0, parts: null, message: null },
    },
    'PUT',
  );
  const retry = await write('retry', {
    requestId: 'r',
    expectedRevision: graded.body.state.revision,
    expectedInkRevision: ink.body.inkRevision,
  });
  for (const r of [draft, ink, locked, graded, retry]) {
    assert.equal(r.response.status, 200, r.text);
    assert.equal(r.response.headers.get('cache-control'), 'no-store');
  }
  const denied = await api(route);
  assert.equal(denied.response.status, 404);
  assert.equal(denied.response.headers.get('cache-control'), 'no-store');
  assert.ok(!denied.text.includes(SOLUTION_MARKER));
  const refreshed = await api(base + '/refresh', { snapshotId: s });
  assert.equal(refreshed.response.status, 200);
  assert.equal(refreshed.response.headers.get('cache-control'), 'no-store');
});

test('development artifacts are no-store; refreshing SDK or image bytes changes the versioned URL scope', async (t) => {
  const { fixture, api, base, s, q } = await setup(t, true);
  for (const endpoint of ['/manifest', '/files/practice-js']) {
    assert.equal(
      (await api('/api/v2/extensions/' + q.extension.artifactId + endpoint)).response.headers.get(
        'cache-control',
      ),
      'no-store',
    );
  }
  fs.appendFileSync(path.join(fixture.codeRoot, 'shared/richtext/2.0.0/sdk.js'), '\n/* changed */');
  const sdk = (await api(base + '/overview')).body;
  assert.notEqual(sdk.snapshotId, s);
  fs.appendFileSync(path.join(fixture.directory, 'assets/figure.png'), 'x');
  const image = (await api(base + '/overview')).body;
  assert.notEqual(image.snapshotId, sdk.snapshotId);
  fs.appendFileSync(path.join(fixture.extension, 'practice.js'), '\n/* changed */');
  const type = (await api(base + '/overview')).body;
  assert.notEqual(type.initial.question.extension.artifactId, q.extension.artifactId);
});

test('external edits before refresh cannot cache new bytes under an older resource identity', async (t) => {
  const { fixture, api, base, s, q, suffix } = await setup(t);
  const routes = [
    [
      path.join(fixture.directory, 'assets/figure.png'),
      base + '/questions/1/assets/' + q.resources[0].assetId + suffix,
    ],
    [
      path.join(fixture.codeRoot, 'shared/richtext/2.0.0/sdk.js'),
      '/api/v2/sdk/richtext/2.0.0/sdk.js' + suffix,
    ],
    [
      path.join(fixture.extension, 'practice.js'),
      '/api/v2/extensions/' + q.extension.artifactId + '/files/practice-js',
    ],
  ];
  for (const [file, route] of routes) {
    assert.equal((await api(route)).response.headers.get('cache-control'), immutable);
    fs.appendFileSync(file, '\nchanged');
    const stale = await api(route);
    assert.equal(stale.response.status, 200);
    assert.match(stale.text, /changed$/);
    assert.equal(stale.response.headers.get('cache-control'), 'no-store');
  }
  const fresh = (await api(base + '/overview')).body;
  assert.notEqual(fresh.snapshotId, s);
  assert.notEqual(fresh.initial.question.extension.artifactId, q.extension.artifactId);
  assert.equal((await api(routes[0][1])).response.headers.get('cache-control'), 'no-store');
  assert.equal(
    (await api(routes[0][1].replace(s, fresh.snapshotId))).response.headers.get('cache-control'),
    immutable,
  );
});
