import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';

test('V2 save Server-Timing separates parse, validation/assembly, serialization and write; diagnostics can be disabled', async t => {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  for (const timings of [true, false]) {
    const server = await new V2Server({ ...fixture, timings }).start();
    try {
      const root = `http://127.0.0.1:${server.port()}/api/v2`;
      const catalog = await (await fetch(root + '/catalog')).json(), id = catalog.groups[0].items[0].bankId;
      const opened = await (await fetch(`${root}/banks/${id}/overview`)).json();
      const response = await fetch(`${root}/banks/${id}/questions/1/draft`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: opened.snapshotId, requestId: `timing-${timings}`, expectedRevision: opened.initial.question.state.revision, answer: 'synthetic' }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).answer, 'synthetic');
      const header = response.headers.get('Server-Timing');
      if (!timings) { assert.equal(header, null); continue; }
      const values = Object.fromEntries(header.split(', ').map(row => { const [key, duration] = row.split(';dur='); return [key, Number(duration)]; }));
      assert.deepEqual(Object.keys(values), ['parse', 'validate', 'serialize', 'write', 'other', 'total']);
      assert.ok(Object.values(values).every(n => Number.isFinite(n) && n >= 0));
      assert.ok(values.write > 0 && values.serialize > 0 && values.parse > 0);
      assert.ok(Math.abs(values.parse + values.validate + values.serialize + values.write + values.other - values.total) < .004);
    } finally { server.server.closeAllConnections(); await server.close(); }
  }
});
