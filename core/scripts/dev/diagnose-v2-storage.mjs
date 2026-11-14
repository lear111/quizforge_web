import { copyBrowserFixture } from '../../test/fixtures/v2-browser.mjs';
// Synthetic, test-only prototype hooks; timings are exclusive.
// Instrumentation overhead is not subtracted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
let current = null;
const stack = [];
const trace = (name, action) => {
  if (!current) {
    return action();
  }
  const frame = { start: performance.now(), children: 0 };
  stack.push(frame);
  try {
    return action();
  } finally {
    const duration = performance.now() - frame.start;
    stack.pop();
    if (stack.length) {
      stack.at(-1).children += duration;
    }
    current[name] = (current[name] || 0) + duration - frame.children;
    current[name + '.calls'] = (current[name + '.calls'] || 0) + 1;
  }
};
const token = Symbol.for('qf.v2.storage.profile');
globalThis[token] = (action, args) => trace('state.freeze', () => action(...args));
const hook = registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (url.endsWith('/v2/services/practice.service.js')) {
      result.source =
        String(result.source).replace('freezeJson,', 'freezeJson as baseFreezeJson,') +
        '\nconst freezeJson=(...args)=>globalThis[Symbol.for("qf.v2.storage.profile")](baseFreezeJson,args);\n';
    }
    return result;
  },
});
const { V2Server } = await import('../../server/v2/app.js');
import { jsonBytes, parseJson, freezeJson } from '../../server/host/platform/json.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-storage-profile-'));
copyBrowserFixture(root);
let server;
const stats = (a) => {
  a.sort((a, b) => a - b);
  return { median: a[Math.ceil(a.length * 0.5) - 1], p95: a[Math.ceil(a.length * 0.95) - 1] };
};
try {
  server = await new V2Server({ root, codeRoot: path.resolve('core') }).start();
  const origin = `http://127.0.0.1:${server.port()}`;
  const catalog = await fetch(origin + '/api/v2/catalog').then((r) => r.json()),
    id = catalog.groups[0].items[0].bankId;
  const opened = await fetch(origin + `/api/v2/banks/${id}/overview`).then((r) => r.json()),
    lib = server.library,
    store = lib.stateStore;
  const rows = [];
  for (const [obj, keys, label] of [
    [lib, ['snapshot', 'question', 'resolution', 'visibleAssets', 'state'], 'library'],
    [store, ['load', 'get', 'file', 'commit', 'apply'], 'state'],
  ]) {
    for (const key of keys) {
      const original = obj[key];
      obj[key] = function (...args) {
        if (!current) {
          return original.apply(this, args);
        }
        return trace(label + '.' + key, () => original.apply(this, args));
      };
    }
  }
  for (let i = 0; i < 35; i++) {
    current = null;
    const q = store.get(lib.opened.get(id), '1');
    current = {};
    const r = await fetch(origin + `/api/v2/banks/${id}/questions/1/answer`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        snapshotId: opened.snapshotId,
        requestId: 'd' + i,
        expectedRevision: q.revision,
        answer: { selected: 'A' },
      }),
    });
    await r.json();
    const timing = r.headers.get('server-timing');
    const validate = Number(/validate;dur=([0-9.]+)/.exec(timing)[1]);
    current['validate.other'] =
      validate -
      ['library.snapshot', 'state.apply', 'state.freeze', 'state.file'].reduce(
        (n, key) => n + (current[key] || 0),
        0,
      );
    rows.push({ ...current, timing });
    current = null;
  }
  const data = rows.slice(5),
    result = {
      exclusive: Object.fromEntries(
        Object.keys(data[0])
          .filter((k) => k !== 'timing')
          .map((k) => [k, stats(data.map((r) => r[k] || 0))]),
      ),
      timings: data.map((r) => r.timing),
    };
  if (!process.argv.includes('--save-only')) {
    const strokes = Array.from({ length: 10000 }, (_, i) => ({
      id: 'pen-' + i,
      color: '#334155',
      width: 3,
      points: Array.from({ length: 8 }, (_, j) => ({
        x: 30 + (i % 20) * 24 + j * 2,
        y: 40 + Math.floor(i / 20) * 22 + (j % 3),
        pressure: 0.5,
      })),
    }));
    const raw = { strokes },
      parsed = parseJson(JSON.stringify(raw));
    freezeJson(parsed);
    result.serialization = { bytes: jsonBytes(raw).length };
    for (const [name, value, fn] of [
      ['raw-custom', raw, jsonBytes],
      ['numeric-frozen-custom', parsed, jsonBytes],
      ['native', raw, JSON.stringify],
    ]) {
      let a = [];
      for (let i = 0; i < 35; i++) {
        const t = performance.now();
        fn(value);
        if (i >= 5) {
          a.push(performance.now() - t);
        }
      }
      result.serialization[name] = stats(a);
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  server?.server.closeAllConnections();
  await server?.close();
  hook.deregister();
  delete globalThis[token];
  fs.rmSync(root, { recursive: true, force: true });
}
