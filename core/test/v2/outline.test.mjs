import assert from 'node:assert/strict';
import { test } from 'node:test';
import { V2Server } from '../../server/v2/app.js';
import { outlineIndex } from '../../server/v2/repositories/outline.repository.js';
import {
  createReadFixture,
  fixtureBank,
  writeFixtureFile,
  SOLUTION_MARKER,
} from '../fixtures/v2-banks.mjs';

const invalidShapes = [
  ['null group', 'outline[0]', (bank) => (bank.outline[0] = null)],
  ['array group', 'outline[0]', (bank) => (bank.outline[0] = [])],
  ['missing items', 'outline[0].items', (bank) => delete bank.outline[0].items],
  ['null items', 'outline[0].items', (bank) => (bank.outline[0].items = null)],
  ['object items', 'outline[0].items', (bank) => (bank.outline[0].items = {})],
  ['string items', 'outline[0].items', (bank) => (bank.outline[0].items = 'bad')],
  ['null item', 'outline[0].items[0]', (bank) => (bank.outline[0].items[0] = null)],
  ['array item', 'outline[0].items[0]', (bank) => (bank.outline[0].items[0] = [])],
  ['null parts', 'outline[0].items[1].parts', (bank) => (bank.outline[0].items[1].parts = null)],
  ['object parts', 'outline[0].items[1].parts', (bank) => (bank.outline[0].items[1].parts = {})],
  ['string parts', 'outline[0].items[1].parts', (bank) => (bank.outline[0].items[1].parts = 'bad')],
  [
    'null part',
    'outline[0].items[1].parts[0]',
    (bank) => (bank.outline[0].items[1].parts[0] = null),
  ],
  [
    'array part',
    'outline[0].items[1].parts[0]',
    (bank) => (bank.outline[0].items[1].parts[0] = []),
  ],
];

test('malformed outline shapes and IDs report their exact field through HTTP', async (t) => {
  const fixture = createReadFixture();
  t.after(() => fixture.cleanup());
  const server = await new V2Server(fixture).start();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port()}/api/v2`;
  const catalog = await (await fetch(base + '/catalog')).json();
  const bankId = catalog.groups[0].items[0].bankId;
  const cases = [...invalidShapes];
  for (const [name, field, select] of [
    ['item', 'outline[0].items[0].id', (bank) => bank.outline[0].items[0]],
    ['part', 'outline[0].items[1].parts[0].id', (bank) => bank.outline[0].items[1].parts[0]],
  ]) {
    for (const value of [undefined, '', 0, 1, null, {}, []]) {
      cases.push([
        `${name} id ${JSON.stringify(value)}`,
        field,
        (bank) => (select(bank).id = value),
      ]);
    }
  }
  for (const [name, field, mutate] of cases) {
    await t.test(name, async () => {
      const bank = fixtureBank();
      mutate(bank);
      writeFixtureFile(fixture.bankFile, bank);
      const response = await fetch(base + '/banks/' + bankId + '/overview');
      const text = await response.text();
      assert.equal(response.status, 422);
      const { error } = JSON.parse(text);
      assert.equal(error.code, 'BANK_STRUCTURE_INVALID');
      assert.equal(error.bankId, bankId);
      assert.equal(error.field, field);
      assert.ok(error.message.includes(field));
      assert.doesNotMatch(error.message, /访问权限|STORAGE_UNAVAILABLE/);
      assert.ok(!text.includes(SOLUTION_MARKER));
    });
  }
});

test('outline IDs require only nonempty strings and retain existing score and duplicate checks', () => {
  const outline = [
    {
      items: [
        { id: '1', maxScore: 2 },
        { id: '01', parts: [{ id: '1', maxScore: 0.5 }] },
      ],
    },
    {
      items: [
        { id: '__proto__', maxScore: 3 },
        { id: '题号', maxScore: 1 },
      ],
    },
  ];
  const { items, maxScores } = outlineIndex(outline, 'bank');
  assert.deepEqual([...items.keys()], ['1', '01', '__proto__', '题号']);
  assert.equal(maxScores.get('01'), 0.5);
  assert.deepEqual([...outlineIndex([], 'bank').items], []);
  assert.deepEqual([...outlineIndex([{ items: [] }], 'bank').items], []);
  assert.throws(
    () => outlineIndex([{ items: [outline[0].items[0], outline[0].items[0]] }], 'bank'),
    {
      code: 'BANK_STRUCTURE_INVALID',
      context: { bankId: 'bank', questionId: '1', field: 'outline[0].items[1].id' },
    },
  );
});
