import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const output = await build({
  entryPoints: [
    fileURLToPath(new URL('../../frontend/src/v2/stores/practice/page.ts', import.meta.url)),
  ],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { pictures } = await import(
  'data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].contents).toString('base64')
);

test('host preloads HTML img resources and legacy JSON nodes, deduplicating and gating solution', async (t) => {
  const window = new JSDOM('<!doctype html>').window;
  const previous = globalThis.document;
  globalThis.document = window.document;
  t.after(() => {
    globalThis.document = previous;
    window.close();
  });
  const calls = [];
  const ctx = {
    api: {
      questions: {
        async asset(q, id) {
          calls.push(id);
          return new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } });
        },
      },
    },
  };
  const q = {
    state: { locked: false },
    question: {
      stem: '<p><img src="qf-asset:a.png"><img src="qf-asset:a.png"></p><img src="https://example.test/remote">',
      legacy: { type: 'image', attrs: { src: 'qf-asset:b.png' } },
    },
    solution: { explanation: '<img src="qf-asset:secret.png">' },
    resources: [
      ['a', 'a.png'],
      ['b', 'b.png'],
      ['secret', 'secret.png'],
      ['other', 'unused.png'],
    ].map(([assetId, name]) => ({ assetId, reference: 'qf-asset:' + name })),
  };
  assert.deepEqual(
    (await pictures(ctx, q)).map((asset) => asset.assetId),
    ['a', 'b'],
  );
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(
    window.document.querySelectorAll('img,script').length,
    0,
    'parser template never enters document',
  );
  q.state.locked = true;
  assert.deepEqual(
    (await pictures(ctx, q, (id) => id === 'a')).map((asset) => asset.assetId),
    ['b', 'secret'],
  );
  assert.deepEqual(calls, ['a', 'b', 'b', 'secret']);
});
