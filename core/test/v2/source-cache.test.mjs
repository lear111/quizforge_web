import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const compiled = await build({
  stdin: {
    contents: `export { createPageSourceCache } from './services/source-cache';
      export { createApi } from './api';`,
    resolveDir: fileURLToPath(new URL('../../frontend/src/v2', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { createPageSourceCache, createApi } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);
function cacheFor(loaders) {
  const api = createApi({
    token: () => '',
    unauthorized() {},
    async fetch(route, options) {
      const body = route.endsWith('/manifest')
        ? JSON.stringify(await loaders.json(route, options.signal))
        : await loaders.text(route, options.signal);
      return new Response(body);
    },
  });
  return createPageSourceCache(api);
}
test('one snapshot shares source Promises and SDKs across types; a failed load can be retried', async () => {
  const calls = [];
  let fail = false;
  const cache = cacheFor({
    json: async (route) => {
      calls.push(route);
      return {
        name: route.includes('/b/') ? '判断题' : '单选题',
        sdkVersions: { richtext: '1.0.0' },
      };
    },
    text: async (route) => {
      calls.push(route);
      if (fail) {
        throw Error('offline');
      }
      return route;
    },
  });
  cache.scope('bank', 's1', '');
  const a = cache.load('a');
  assert.equal(cache.load('a'), a);
  assert.equal((await a).name, '单选题');
  await cache.load('b');
  assert.deepEqual(
    calls.filter((x) => x.includes('/sdk/')),
    [
      '/api/v2/sdk/richtext/1.0.0/richtext.js?snapshotId=s1',
      '/api/v2/sdk/richtext/1.0.0/richtext.css?snapshotId=s1',
    ],
  );
  assert.match((await a).css, /richtext\.css\?snapshotId=s1/);
  assert.equal(calls.filter((x) => x.includes('/a/manifest')).length, 1);
  fail = true;
  await assert.rejects(cache.load('broken'), /offline/);
  fail = false;
  await cache.load('broken');
  assert.equal(calls.filter((x) => x.includes('/broken/manifest')).length, 2);
  cache.dispose();
});
test('bank, snapshot and credentials isolate entries and abort pending loads; late completion is never adopted', async () => {
  let resolve;
  const signals = [],
    cache = cacheFor({
      json: (route, signal) => {
        signals.push(signal);
        return new Promise((r) => {
          resolve = r;
        });
      },
      text: async () => '',
    });
  cache.scope('a', 's1', 'token1');
  const old = cache.load('type');
  const refused = assert.rejects(old, /失效|关闭/);
  cache.scope('b', 's1', 'token1');
  resolve({ name: '旧', sdkVersions: {} });
  await refused;
  assert.equal(signals[0].aborted, true);
  const next = cache.load('type');
  resolve({ name: '新', sdkVersions: {} });
  assert.equal((await next).name, '新');
  for (const [bank, snap, auth] of [
    ['b', 's2', 'token1'],
    ['b', 's2', 'token2'],
  ]) {
    cache.scope(bank, snap, auth);
    const p = cache.load('type');
    resolve({ name: 'next', sdkVersions: {} });
    await p;
  }
  assert.equal(signals.length, 4);
  cache.dispose();
});
