import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';

test('V2 save Server-Timing separates parse, validation/assembly, serialization and write; diagnostics can be disabled', async (t) => {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  for (const timings of [true, false]) {
    const server = await new V2Server({ ...fixture, timings }).start();
    try {
      const root = `http://127.0.0.1:${server.port()}/api/v2`;
      const catalog = await (await fetch(root + '/catalog')).json(),
        id = catalog.groups[0].items[0].bankId;
      const opened = await (await fetch(`${root}/banks/${id}/overview`)).json();
      const response = await fetch(`${root}/banks/${id}/questions/1/answer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshotId: opened.snapshotId,
          requestId: `timing-${timings}`,
          expectedRevision: opened.initial.question.state.revision,
          answer: 'synthetic',
        }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).answer, 'synthetic');
      const header = response.headers.get('Server-Timing');
      if (!timings) {
        assert.equal(header, null);
        continue;
      }
      const values = Object.fromEntries(
        header.split(', ').map((row) => {
          const [key, duration] = row.split(';dur=');
          return [key, Number(duration)];
        }),
      );
      assert.deepEqual(Object.keys(values), [
        'parse',
        'validate',
        'serialize',
        'write',
        'other',
        'total',
      ]);
      assert.ok(Object.values(values).every((n) => Number.isFinite(n) && n >= 0));
      assert.ok(values.write > 0 && values.serialize > 0 && values.parse > 0);
      assert.ok(
        Math.abs(
          values.parse +
            values.validate +
            values.serialize +
            values.write +
            values.other -
            values.total,
        ) < 0.004,
      );
    } finally {
      server.server.closeAllConnections();
      await server.close();
    }
  }
});

test('V2 GET overview reports exclusive phases on the save timing switch without changing the JSON', async (t) => {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const phases = [
    'locate-bank',
    'bank-tree',
    'bank-json',
    'extension-scan',
    'extension-resolve',
    'sdk-digest',
    'snapshot-id',
    'content-fingerprint',
    'state-check',
    'ink-index',
    'ink-body',
    'assemble',
    'serialize',
    'other',
  ];
  let enabledBytes;
  for (const timings of [true, false]) {
    const server = await new V2Server({ ...fixture, timings }).start();
    try {
      const root = `http://127.0.0.1:${server.port()}/api/v2`;
      const catalog = await fetch(root + '/catalog');
      assert.equal(catalog.headers.get('Server-Timing'), null);
      const id = (await catalog.json()).groups[0].items[0].bankId;
      const url = `${root}/banks/${id}`;
      await (await fetch(url + '/overview')).text();
      const overview = await fetch(url + '/overview');
      assert.equal(overview.status, 200);
      const bytes = Buffer.from(await overview.arrayBuffer()),
        header = overview.headers.get('Server-Timing');
      const snapshotId = JSON.parse(bytes.toString('utf8')).snapshotId;
      const question = await fetch(`${url}/questions/1?snapshotId=${snapshotId}`);
      assert.equal(question.status, 200);
      assert.equal(question.headers.get('Server-Timing'), null);
      await question.text();
      if (!timings) {
        assert.equal(header, null);
        assert.ok(bytes.equals(enabledBytes));
        continue;
      }
      enabledBytes = bytes;
      const values = Object.fromEntries(
        header.split(', ').map((row) => {
          const [key, duration] = row.split(';dur=');
          return [key, Number(duration)];
        }),
      );
      assert.deepEqual(Object.keys(values), [...phases, 'total']);
      assert.ok(Object.values(values).every((n) => Number.isFinite(n) && n >= 0));
      for (const key of [
        'bank-tree',
        'bank-json',
        'extension-resolve',
        'state-check',
        'ink-index',
        'serialize',
      ]) {
        assert.ok(values[key] > 0, key);
      }
      assert.equal(values['extension-scan'], 0);
      assert.equal(values['sdk-digest'], 0);
      // Each phase and total are independently rounded to 0.001 ms.
      assert.ok(Math.abs(phases.reduce((sum, key) => sum + values[key], 0) - values.total) < 0.008);
    } finally {
      server.server.closeAllConnections();
      await server.close();
    }
  }
});
