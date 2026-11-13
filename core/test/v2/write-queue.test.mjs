import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../frontend/src/v2/write-queue.ts', import.meta.url))], bundle: true, write: false, format: 'esm' });
const { createWriteQueue } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

test('answer and ink share queue, capture latest revision on first dispatch, retain exact failed request for retry', async () => {
  const queue = createWriteQueue(); let revision = 0, release;
  const sent = [], gate = new Promise(resolve => { release = resolve; });
  const first = queue.enqueue(async () => { await gate; revision = 1; });
  let captures = 0, attempts = 0;
  const ink = queue.prepare(() => { captures++; return { route: '/ink', body: JSON.stringify({ requestId: 'ink-1', expectedRevision: revision, ink: { strokes: ['one'] } }) }; }, async (route, body) => {
    sent.push([route, body]); if (++attempts === 1) throw new Error('transport'); return 2;
  }, result => { revision = result; });
  const waiting = ink(); assert.equal(captures, 0); release(); await first;
  await assert.rejects(waiting, /transport/); assert.equal(JSON.parse(sent[0][1]).expectedRevision, 1);
  revision = 9; await ink(); assert.deepEqual(sent[1], sent[0]); assert.equal(captures, 1);
  const answer = queue.prepare(() => ({ route: '/draft', body: JSON.stringify({ expectedRevision: revision }) }), async (_route, body) => { assert.equal(JSON.parse(body).expectedRevision, 2); return 3; }, n => { revision = n; });
  await answer(); await queue.drain(); assert.equal(revision, 3);
});
