import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { PracticePosition } from '../../server/host/v2/position.js';
import { createReadFixture, writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';

test('position is independent of state, restored after restart, moved with bank, and removed positions fall back', async t => {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  let server = await new V2Server(fixture).start(); t.after(() => server.close());
  const api = async (route, input) => {
    const response = await fetch(`http://127.0.0.1:${server.port()}/api/v2` + route, input === undefined ? {} : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const text = await response.text(); assert.ok(!text.includes(SOLUTION_MARKER)); return { status: response.status, body: JSON.parse(text) };
  };
  let id = (await api('/catalog')).body.groups[0].items[0].bankId, base = `/banks/${id}`;
  assert.equal((await api(base + '/position')).status, 409);
  const first = (await api(base + '/overview')).body;
  assert.equal(first.initial.question.questionId, '1');
  const file = server.library.stateStore.file(fixture.directory), bytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  assert.equal((await api(base + '/position', { questionId: '8' })).status, 200);
  assert.deepEqual((await api(base + '/position')).body, { questionId: '8' });
  assert.deepEqual(fs.existsSync(file) ? fs.readFileSync(file) : null, bytes);
  assert.equal((await api(base + '/overview')).body.snapshotId, first.snapshotId);
  assert.equal((await api(base + '/overview')).body.initial.question.questionId, '8');
  assert.equal((await api(base + '/position', { questionId: 'missing' })).status, 404);
  assert.equal((await api(base + '/position', { questionId: '1', answer: 'no' })).status, 400);
  await server.close(); server = await new V2Server(fixture).start();
  assert.equal((await api(base + '/overview')).body.initial.question.questionId, '8');
  const moved = path.join(path.dirname(fixture.directory), 'moved'); fs.renameSync(fixture.directory, moved);
  id = (await api('/catalog')).body.groups[0].items[0].bankId; base = `/banks/${id}`;
  assert.equal((await api(base + '/overview')).body.initial.question.questionId, '8');
  const bank = structuredClone(fixture.bank); delete bank.questions['8']; bank.outline.forEach(group => { group.items = group.items.filter(item => item.id !== '8'); });
  writeFixtureFile(path.join(moved, 'bank.json'), bank);
  assert.equal((await api(base + '/overview')).body.initial.question.questionId, '1');
  assert.deepEqual((await api(base + '/position')).body, { questionId: null });
  fs.unlinkSync(path.join(moved, '.qf-v2/position.json'));
  assert.equal((await api(base + '/overview')).body.lastQuestionId, null);
});

test('position write failure preserves old file; invalid input and unsafe local paths do not overwrite', t => {
  const fixture = createReadFixture(); t.after(() => fixture.cleanup());
  const position = new PracticePosition(); position.save(fixture.directory, '1');
  const file = position.file(fixture.directory), old = fs.readFileSync(file);
  const failing = new PracticePosition({ write() { throw new Error('simulated'); } });
  assert.throws(() => failing.save(fixture.directory, '2'), { code: 'POSITION_UNAVAILABLE' });
  assert.ok(fs.readFileSync(file).equals(old));
  fs.writeFileSync(file, '{"formatVersion":2,"questionId":"1","questionId":"2"}');
  assert.throws(() => position.read(fixture.directory), { code: 'POSITION_UNAVAILABLE' });
  fs.rmSync(path.dirname(file), { recursive: true });
  const outside = path.join(fixture.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.dirname(file), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => position.save(fixture.directory, '2'));
  assert.equal(fs.readdirSync(outside).length, 0);
});
