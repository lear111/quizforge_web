import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { V2Server } from '../../server/v2/app.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';
import { resourceReferences } from '../../server/v2/utils/asset-references.js';

async function setup(t, modify) {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  modify(fixture.bank.questions['1'], fixture);
  fs.writeFileSync(fixture.bankFile, JSON.stringify(fixture.bank));
  const server = await new V2Server(fixture).start();
  t.after(() => server.close());
  const request = async (route, body, method = 'GET') => {
    const response = await fetch(`http://127.0.0.1:${server.port()}${route}`, {
      method,
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      text,
      value: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : null,
    };
  };
  const bankId = (await request('/api/v2/catalog')).value.groups[0].items[0].bankId;
  const base = `/api/v2/banks/${bankId}`;
  const overview = (await request(base + '/overview')).value;
  return { fixture, request, base, snapshotId: overview.snapshotId, overview };
}

test('HTML asset scanning uses img[src], decodes HTML entities, and retains legacy JSON scanning', () => {
  const html =
    '<p>qf-asset:not-an-image</p><a href="qf-asset:not-an-image">x</a>' +
    '<img src="qf-asset:assets/a&#46;png"><IMG SRC="qf-asset:assets/a.png">' +
    '<img src="https://example.test/a"><script>"<img src=qf-asset:bad>"</script>';
  assert.deepEqual(
    [
      ...resourceReferences({
        nested: [html, { type: 'image', attrs: { src: 'qf-asset:assets/legacy.png' } }],
      }),
    ].sort(),
    ['qf-asset:assets/a.png', 'qf-asset:assets/legacy.png'],
  );
  assert.match(html, /&#46;/, 'scanner never rewrites HTML');
});

test('question HTML resources are deduplicated; private solution assets are inaccessible until locked', async (t) => {
  const marker = 'HTML_SOLUTION_ONLY_83a';
  const f = await setup(t, (record, fixture) => {
    record.question = {
      stem: '<p><img src="qf-asset:assets/figure.png"></p>',
      options: [{ content: '<img src="qf-asset:assets/figure.png">' }],
      legacy: { type: 'image', attrs: { src: 'qf-asset:assets/figure.png' } },
    };
    record.solution = {
      selected: 'a',
      explanation: `<p>${marker}<img src="qf-asset:assets/private.png"></p>`,
    };
    fs.copyFileSync(
      path.join(fixture.directory, 'assets/figure.png'),
      path.join(fixture.directory, 'assets/private.png'),
    );
  });
  const route = f.base + '/questions/1';
  const read = () => f.request(route + '?snapshotId=' + f.snapshotId);
  const publicQuestion = await read();
  assert.equal(publicQuestion.value.resources.length, 1);
  assert.equal(publicQuestion.value.question.stem, '<p><img src="qf-asset:assets/figure.png"></p>');
  assert.equal(publicQuestion.value.solution, null);
  assert.doesNotMatch(
    publicQuestion.text + JSON.stringify(f.overview),
    new RegExp(marker + '|private.png'),
  );
  const privateId = createHash('sha256').update('1\0qf-asset:assets/private.png').digest('hex');
  const asset = route + `/assets/${privateId}?snapshotId=${f.snapshotId}`;
  assert.equal((await f.request(asset)).status, 404);
  const submit = await f.request(
    route + '/submit',
    {
      requestId: 'html-lock',
      snapshotId: f.snapshotId,
      expectedRevision: 0,
      answer: { selected: 'a' },
    },
    'POST',
  );
  assert.equal(submit.status, 200);
  const locked = await read();
  assert.match(locked.text, new RegExp(marker));
  assert.equal(locked.value.resources.length, 2);
  assert.equal((await f.request(asset)).status, 200);
  const retry = await f.request(
    route + '/retry',
    {
      requestId: 'html-retry',
      snapshotId: f.snapshotId,
      expectedRevision: locked.value.state.revision,
    },
    'POST',
  );
  assert.equal(retry.status, 200);
  assert.equal((await f.request(asset)).status, 404);
});

for (const reference of [
  '../outside.png',
  'bank.json',
  '.qf-v2/practice/state.json',
  'assets\\bad.png',
]) {
  test(`HTML asset paths retain safety checks: ${reference}`, async (t) => {
    const f = await setup(t, (record) => {
      record.question = { stem: `<p><img src="qf-asset:${reference}"></p>` };
    });
    assert.equal(f.overview.initial.error.code, 'ASSET_PATH_INVALID');
    const response = await f.request(f.base + '/questions/1?snapshotId=' + f.snapshotId);
    assert.equal(response.value.error.code, 'ASSET_PATH_INVALID');
  });
}
