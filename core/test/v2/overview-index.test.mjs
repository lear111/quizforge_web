import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/v2/app.js';
import { addFixtureExtension, createReadFixture, writeFixtureFile } from '../fixtures/v2-banks.mjs';

async function setup(t) {
  const fixture = createReadFixture();
  const server = new V2Server(fixture);
  t.after(async () => {
    await server.close();
    fixture.cleanup();
  });
  const { types, sharedSdks } = server.library;
  const counts = { scans: 0, sdkRebuilds: 0 };
  const scan = types.scan.bind(types);
  types.scan = () => {
    counts.scans++;
    return scan();
  };
  const rebuild = sharedSdks.rebuild.bind(sharedSdks);
  sharedSdks.rebuild = () => {
    counts.sdkRebuilds++;
    return rebuild();
  };
  const bankId = server.library.locations()[0].bankId;
  await server.start();
  const base = `http://127.0.0.1:${server.port()}/api/v2`;
  const request = async (endpoint, refresh = false) => {
    const response = await fetch(
      base + endpoint,
      refresh
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }
        : {},
    );
    assert.equal(response.status, 200);
    return response.json();
  };
  return {
    fixture,
    counts,
    catalog: () => request('/catalog'),
    overview: () => request(`/banks/${bankId}/overview`),
    refresh: () => request(`/banks/${bankId}/refresh`, true),
  };
}

test('startup, catalog and refresh rebuild; opening never visits unrelated installed extensions', async (t) => {
  const { fixture, counts, overview, catalog, refresh } = await setup(t);
  assert.deepEqual(counts, { scans: 1, sdkRebuilds: 1 });
  const first = await overview();
  const unused = addFixtureExtension(fixture.root, { name: 'unused', version: '3.0.0' });
  await catalog();
  const visits = [];
  const stat = fs.lstatSync;
  fs.lstatSync = (file, ...args) => {
    if (typeof file === 'string' && file.startsWith(unused + path.sep)) {
      visits.push(file);
    }
    return stat(file, ...args);
  };
  try {
    for (let index = 0; index < 3; index++) {
      const opened = await overview();
      assert.deepEqual(opened, first);
    }
  } finally {
    fs.lstatSync = stat;
  }
  assert.deepEqual(visits, []);
  assert.deepEqual(counts, { scans: 2, sdkRebuilds: 2 });
  await refresh();
  assert.deepEqual(counts, { scans: 3, sdkRebuilds: 3 });
});

test('a miss scans once for all types; catalog and refresh discover additions and removals', async (t) => {
  const { fixture, counts, overview, catalog, refresh } = await setup(t);
  const typeId = 'quizforge.new-choice';
  const added = addFixtureExtension(fixture.root, { name: 'new', id: typeId });
  fixture.bank.questions['1'].type = `${typeId}@2`;
  fixture.bank.questions['2'].type = 'quizforge.missing@2';
  writeFixtureFile(fixture.bankFile, fixture.bank);
  assert.equal((await overview()).initial.question.extension.id, typeId);
  assert.deepEqual(counts, { scans: 2, sdkRebuilds: 1 });
  const manifest = path.join(added, 'manifest.json');
  const original = fs.readFileSync(manifest);
  fs.unlinkSync(manifest);
  await catalog();
  assert.equal((await overview()).initial.error.code, 'EXTENSION_NOT_FOUND');
  assert.deepEqual(counts, { scans: 4, sdkRebuilds: 2 });
  writeFixtureFile(manifest, original);
  assert.equal((await refresh()).initial.question.extension.id, typeId);
  assert.deepEqual(counts, { scans: 5, sdkRebuilds: 3 });
});

test('a changed used manifest updates the descriptor without a scan or SDK traversal', async (t) => {
  const { fixture, counts, overview } = await setup(t);
  const first = await overview();
  const file = path.join(fixture.extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file));
  writeFixtureFile(file, { ...manifest, version: '2.2.0' });
  const next = await overview();
  assert.notEqual(first.snapshotId, next.snapshotId);
  assert.equal(next.initial.question.extension.version, '2.2.0');
  assert.deepEqual(counts, { scans: 1, sdkRebuilds: 1 });
});

test('catalog and refresh publish SDK changes to new snapshots; ordinary opens reuse the digest', async (t) => {
  const { fixture, counts, overview, catalog, refresh } = await setup(t);
  const first = await overview();
  const file = path.join(fixture.codeRoot, 'shared', 'richtext', '2.0.0', 'sdk.js');
  fs.appendFileSync(file, '\n/* new SDK bytes */');
  assert.equal((await overview()).snapshotId, first.snapshotId);
  await catalog();
  const next = await overview();
  assert.notEqual(first.snapshotId, next.snapshotId);
  assert.equal(next.activeCleared, false);
  assert.deepEqual(next.initial.question.extension, first.initial.question.extension);
  fs.unlinkSync(file);
  fs.rmdirSync(path.dirname(file));
  assert.equal((await overview()).snapshotId, next.snapshotId);
  assert.equal((await refresh()).initial.error.code, 'SDK_UNAVAILABLE');
  assert.deepEqual(counts, { scans: 3, sdkRebuilds: 3 });
});
