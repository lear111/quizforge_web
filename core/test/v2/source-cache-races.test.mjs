import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/services/source-cache.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { createPageSourceCache } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const manifest = (name, version = '1') => ({
  name,
  sdkVersions: { richtext: version, ignored: 'skip' },
});
const sdk = (version) => ({ js: 'sdk-js:' + version, css: 'sdk-css:' + version });
function fixture(t, options = {}) {
  const calls = [];
  const record = (call) => {
    calls.push(call);
    options.called?.(call, calls);
  };
  const cache = createPageSourceCache({
    extensions: {
      manifest(id, signal) {
        record({ kind: 'manifest', id, signal });
        return options.manifest ? options.manifest(id, signal) : Promise.resolve(manifest(id));
      },
      file(id, entry, signal) {
        record({ kind: 'file', id, entry, signal });
        return options.file ? options.file(id, entry, signal) : Promise.resolve(id + ':' + entry);
      },
    },
    sdk: {
      richtext(version, snapshot, signal) {
        record({ kind: 'sdk', version, snapshot, signal });
        return options.sdk ? options.sdk(version, snapshot, signal) : Promise.resolve(sdk(version));
      },
    },
  });
  t.after(() => cache.dispose());
  return { cache, calls, of: (kind) => calls.filter((call) => call.kind === kind) };
}

test('concurrent types share pending SDKs by version and keep the manifest/SDK/file request order', async (t) => {
  const filesReady = deferred(),
    firstSdk = deferred(),
    secondSdk = deferred();
  const f = fixture(t, {
    manifest: (id) =>
      Promise.resolve(id === 'd' ? { name: 'd' } : manifest(id, id === 'c' ? '2' : '1')),
    sdk: (version) => (version === '1' ? firstSdk.promise : secondSdk.promise),
    called: (_call, calls) => {
      if (calls.filter((call) => call.kind === 'file').length === 12) {
        filesReady.resolve();
      }
    },
  });
  f.cache.scope('bank', 's', 'auth');
  const a = f.cache.load('a');
  assert.equal(f.cache.load('a'), a);
  const b = f.cache.load('b'),
    c = f.cache.load('c'),
    d = f.cache.load('d');
  assert.deepEqual(
    f.calls.map((call) => call.kind),
    ['manifest', 'manifest', 'manifest', 'manifest'],
  );
  await filesReady.promise;
  assert.equal(new Set(f.calls.map((call) => call.signal)).size, 1);
  assert.deepEqual(
    f.of('sdk').map((call) => call.version),
    ['1', '2'],
  );
  assert.deepEqual(
    f.calls
      .slice(4)
      .map((call) => (call.kind === 'sdk' ? 'sdk:' + call.version : call.id + ':' + call.entry)),
    [
      'sdk:1',
      'a:practice-html',
      'a:practice-js',
      'a:practice-css',
      'b:practice-html',
      'b:practice-js',
      'b:practice-css',
      'sdk:2',
      'c:practice-html',
      'c:practice-js',
      'c:practice-css',
      'd:practice-html',
      'd:practice-js',
      'd:practice-css',
    ],
  );
  firstSdk.resolve(sdk('1'));
  secondSdk.resolve(sdk('2'));
  const [av, bv, cv, dv] = await Promise.all([a, b, c, d]);
  assert.deepEqual(av, {
    name: 'a',
    html: 'a:practice-html',
    js: 'a:practice-js',
    css: 'sdk-css:1\na:practice-css',
    sdks: ['sdk-js:1'],
  });
  assert.deepEqual(bv.sdks, ['sdk-js:1']);
  assert.deepEqual(cv.sdks, ['sdk-js:2']);
  assert.equal(dv.css, 'd:practice-css');
  assert.deepEqual(dv.sdks, []);
  assert.equal(f.cache.load('a'), a);
  assert.equal(await f.cache.load('a'), av);
});

test('identical scope retains entries and each bank/snapshot/authorization change clears both caches', async (t) => {
  const f = fixture(t);
  f.cache.scope('bank', 's1', 'auth1');
  let previous = f.cache.load('type');
  await previous;
  const firstSignal = f.of('manifest')[0].signal;
  f.cache.scope('bank', 's1', 'auth1');
  assert.equal(f.cache.load('type'), previous);
  assert.equal(firstSignal.aborted, false);
  for (const scope of [
    ['other', 's1', 'auth1'],
    ['other', 's2', 'auth1'],
    ['other', 's2', 'auth2'],
  ]) {
    const oldSignal = f.of('manifest').at(-1).signal;
    f.cache.scope(...scope);
    assert.equal(oldSignal.aborted, true);
    const current = f.cache.load('type');
    assert.notEqual(current, previous);
    await current;
    assert.equal(f.of('manifest').at(-1).signal.aborted, false);
    previous = current;
  }
  assert.equal(f.of('manifest').length, 4);
  assert.equal(f.of('file').length, 12);
  assert.deepEqual(
    f.of('sdk').map((call) => call.snapshot),
    ['s1', 's1', 's2', 's2'],
  );
});

test('late SDK rejection cannot evict the replacement SDK or page Promise from a new scope', async (t) => {
  const oldSdk = deferred(),
    newSdk = deferred(),
    oldStarted = deferred(),
    newStarted = deferred(),
    otherStarted = deferred();
  const failure = Error('old sdk failed');
  const f = fixture(t, {
    sdk: (_version, snapshot) => {
      if (snapshot === 'old') {
        oldStarted.resolve();
        return oldSdk.promise;
      }
      newStarted.resolve();
      return newSdk.promise;
    },
    called: (call) => {
      if (call.id === 'other' && call.entry === 'practice-css') {
        otherStarted.resolve();
      }
    },
  });
  f.cache.scope('bank', 'old', 'auth');
  const old = f.cache.load('same'),
    refused = assert.rejects(old, (error) => error === failure);
  await oldStarted.promise;
  const oldSignal = f.of('sdk')[0].signal;
  f.cache.scope('bank', 'new', 'auth');
  assert.equal(oldSignal.aborted, true);
  const current = f.cache.load('same');
  await newStarted.promise;
  oldSdk.reject(failure);
  await refused;
  assert.equal(f.cache.load('same'), current);
  const other = f.cache.load('other');
  await otherStarted.promise;
  assert.equal(f.of('sdk').length, 2);
  newSdk.resolve(sdk('new'));
  assert.deepEqual((await current).sdks, ['sdk-js:new']);
  assert.deepEqual((await other).sdks, ['sdk-js:new']);
});

test('old resources completing successfully are rejected after assembly and cannot replace fresh content', async (t) => {
  const oldSdk = deferred(),
    started = deferred();
  const f = fixture(t, {
    sdk: (_version, snapshot) => {
      if (snapshot === 'old') {
        started.resolve();
        return oldSdk.promise;
      }
      return Promise.resolve(sdk('new'));
    },
  });
  f.cache.scope('bank', 'old', 'auth');
  const old = f.cache.load('type');
  const refused = assert.rejects(old, { message: '题型文件加载已失效，请重新打开本题。' });
  await started.promise;
  f.cache.scope('bank', 'new', 'auth');
  const current = f.cache.load('type'),
    value = await current;
  oldSdk.resolve(sdk('old'));
  await refused;
  assert.equal(f.cache.load('type'), current);
  assert.equal(await f.cache.load('type'), value);
  assert.deepEqual((await f.cache.load('other')).sdks, ['sdk-js:new']);
  assert.equal(f.of('sdk').length, 2);
});

test('manifest, SDK and file failures keep the error and allow retry without aborting the shared scope', async (t) => {
  for (const stage of ['manifest', 'sdk', 'file']) {
    const failure = Error(stage + ' failed');
    let failed = false;
    const reply = (kind, value) => {
      if (kind === stage && !failed) {
        failed = true;
        return Promise.reject(failure);
      }
      return Promise.resolve(value);
    };
    const f = fixture(t, {
      manifest: (id) => reply('manifest', manifest(id)),
      sdk: (version) => reply('sdk', sdk(version)),
      file: (id, entry) => reply('file', id + ':' + entry),
    });
    f.cache.scope('bank', 's', 'auth');
    const first = f.cache.load('type');
    await assert.rejects(first, (error) => error === failure);
    assert.ok(f.calls.every((call) => !call.signal.aborted));
    const retry = f.cache.load('type');
    assert.notEqual(first, retry);
    assert.equal((await retry).name, 'type');
    assert.equal(f.of('manifest').length, 2);
    assert.equal(f.of('sdk').length, stage === 'sdk' ? 2 : 1);
    assert.equal(f.cache.load('type'), retry);
  }
});

test('dispose aborts and empties caches but preserves reuse and the prior snapshot until scoped again', async (t) => {
  const manifestGate = deferred();
  let first = true;
  const f = fixture(t, {
    manifest: (id) => {
      if (first) {
        first = false;
        return manifestGate.promise;
      }
      return Promise.resolve(manifest(id));
    },
  });
  f.cache.scope('bank', 'snapshot', 'auth');
  const old = f.cache.load('type'),
    refused = assert.rejects(old, /失效/);
  const oldSignal = f.of('manifest')[0].signal;
  f.cache.dispose();
  assert.equal(oldSignal.aborted, true);
  const fresh = f.cache.load('type');
  assert.notEqual(fresh, old);
  const freshSignal = f.of('manifest').at(-1).signal;
  await fresh;
  manifestGate.resolve(manifest('old'));
  await refused;
  assert.equal(f.cache.load('type'), fresh);
  assert.equal(f.of('file').length, 3, 'a stale manifest starts no files');
  assert.equal(f.of('sdk')[0].snapshot, 'snapshot');
  assert.equal(f.calls.filter((call) => call.signal === freshSignal).length, 5);
  f.cache.scope('bank', 'snapshot', 'auth');
  assert.equal(freshSignal.aborted, true, 'dispose reset the scope key');
  const restored = f.cache.load('type');
  assert.notEqual(restored, fresh);
  await restored;
  assert.equal(f.of('sdk').length, 2);
  f.cache.dispose();
  assert.equal(f.of('manifest').at(-1).signal.aborted, true);
});
