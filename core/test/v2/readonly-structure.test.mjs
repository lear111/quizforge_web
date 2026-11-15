import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFixtureFile, SOLUTION_MARKER } from '../fixtures/v2-banks.mjs';
import { running } from '../fixtures/v2-readonly.mjs';

test('bad questions are lazy and isolated; unreferenced questions are ignored; part structure stays opaque', async (t) => {
  const { fixture, open, get, base } = await running(t);
  fixture.bank.questions['1'].question = [];
  delete fixture.bank.questions['3'];
  fixture.bank.questions['4'].type = 'not.installed@2';
  fixture.bank.questions['5'].solution = null;
  // Outline parts need not match question.parts: the page owns that contract.
  fixture.bank.questions['2'].question.parts = { unrelated: {} };
  writeFixtureFile(fixture.bankFile, fixture.bank);
  const { body, response } = await open();
  assert.equal(response.status, 200);
  assert.equal(body.states.length, 20);
  assert.equal(body.initial.error.code, 'QUESTION_INVALID');
  assert.equal(body.initial.error.questionId, '1');
  const query = '?snapshotId=' + body.snapshotId;
  for (const [id, code, status] of [
    ['1', 'QUESTION_INVALID', 422],
    ['3', 'QUESTION_NOT_FOUND', 404],
    ['4', 'EXTENSION_NOT_FOUND', 404],
    ['5', 'QUESTION_INVALID', 422],
    ['ignored', 'QUESTION_NOT_FOUND', 404],
  ]) {
    const bad = await get(base + '/questions/' + id + query);
    assert.equal(bad.response.status, status);
    assert.equal(bad.body.error.code, code);
    assert.equal(bad.body.error.questionId, id);
  }
  assert.equal((await get(base + '/questions/2' + query)).response.status, 200);
});

test('D46 outline validation rejects missing outline, duplicate IDs and invalid scores while allowing an empty bank', async (t) => {
  const { fixture, open } = await running(t);
  const cases = [
    (bank) => {
      bank.outline = {};
    },
    (bank) => {
      bank.outline[0].items[1].id = '1';
    },
    (bank) => {
      bank.outline[0].items[1].parts[1].id = 'p1';
    },
    (bank) => {
      bank.outline[0].items[1].parts = [];
    },
    (bank) => {
      bank.outline[0].items[0].maxScore = 0;
    },
    (bank) => {
      bank.outline[0].items[0].maxScore = -1;
    },
    (bank) => {
      bank.outline[0].items[0].maxScore = '2';
    },
    (bank) => {
      bank.outline[0].items[1].parts.forEach((part) => {
        part.maxScore = 1e308;
      });
    },
  ];
  for (const mutate of cases) {
    const bank = structuredClone(fixture.bank);
    mutate(bank);
    writeFixtureFile(fixture.bankFile, bank);
    const { body, response } = await open();
    assert.equal(response.status, 422);
    assert.match(body.error.message, /[\u4e00-\u9fff]/);
    assert.ok(body.error.code === 'BANK_STRUCTURE_INVALID');
    assert.ok(!JSON.stringify(body).includes(fixture.root));
  }
  writeFixtureFile(fixture.bankFile, {
    ...fixture.bank,
    outline: [
      {
        title: '数字题号',
        items: [
          { id: '10', label: '甲', maxScore: 1 },
          { id: '2', label: '乙', maxScore: 1 },
        ],
      },
    ],
  });
  const ordered = (await open()).body;
  assert.deepEqual(
    ordered.states.map((item) => item.questionId),
    ['10', '2'],
  );
  assert.equal(ordered.initial.question.questionId, '10');
  writeFixtureFile(fixture.bankFile, { ...fixture.bank, outline: [], questions: {} });
  const empty = await open();
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.initial.question, null);
  assert.deepEqual(empty.body.states, []);
});

test('strict duplicate-key and invalid JSON diagnostics expose positions, not private values', async (t) => {
  const { fixture, open } = await running(t);
  for (const text of [
    '{"title":"' + SOLUTION_MARKER + '","title":"duplicate"}',
    '{"formatVersion":2,"n":NaN}',
    '{"outline":[]',
  ]) {
    writeFixtureFile(fixture.bankFile, text);
    const bad = await open();
    assert.equal(bad.response.status, 400);
    assert.ok(['JSON_DUPLICATE_KEY', 'JSON_INVALID'].includes(bad.body.error.code));
    assert.equal(typeof bad.body.error.details.offset, 'number');
    assert.ok(bad.body.error.details.line >= 1);
    assert.ok(bad.body.error.details.column >= 1);
  }
});

// D46 deliberately removes authoring metadata checks, not score or path safety checks.
test('D46 ignored metadata and listening references never prevent opening or reading valid questions', async (t) => {
  const { fixture, open, get, base } = await running(t);
  const cases = [
    (bank) => {
      bank.formatVersion = 1;
    },
    (bank) => {
      bank.outline[0].items[1].label = 'bad';
    },
    (bank) => {
      delete bank.outline[0].items[0].label;
    },
    (bank) => {
      bank.outline[0].items[0].listening = 'missing';
    },
    (bank) => {
      bank.listening.https.src = 'ftp://example.test/a';
    },
    (bank) => {
      bank.listening.local.src = '../escape.wav';
    },
    (bank) => {
      bank.features.exam = 'yes';
    },
    (bank) => {
      bank.id = null;
      delete bank.title;
      delete bank.description;
      delete bank.features;
    },
    (bank) => {
      delete bank.outline[0].title;
      delete bank.outline[0].items[1].parts[0].label;
    },
    (bank) => {
      bank.listening = 'ignored';
    },
  ];
  for (const mutate of cases) {
    const bank = structuredClone(fixture.bank);
    mutate(bank);
    writeFixtureFile(fixture.bankFile, bank);
    const { body, response } = await open();
    assert.equal(response.status, 200);
    assert.equal(body.initial.error, null);
    assert.equal(body.initial.question.questionId, '1');
    assert.deepEqual(
      body.states.map((item) => item.questionId),
      fixture.bank.outline.flatMap((group) => group.items.map((item) => item.id)),
    );
    const record = await get(base + '/questions/1?snapshotId=' + body.snapshotId);
    assert.equal(record.response.status, 200);
  }
  const minimal = structuredClone(fixture.bank);
  delete minimal.id;
  delete minimal.title;
  delete minimal.description;
  delete minimal.features;
  writeFixtureFile(fixture.bankFile, minimal);
  const info = (await open()).body.bank;
  assert.equal(info.sourceId, '');
  assert.equal(info.title, '');
  assert.equal(info.description, '');
  assert.deepEqual(info.features, { history: true, exam: true });
  const catalog = (await get('/api/v2/catalog')).body;
  assert.equal(catalog.groups[0].items[0].availability, 'available');
  // Missing question bodies are a per-question error, not an outline/open error.
  delete minimal.questions;
  writeFixtureFile(fixture.bankFile, minimal);
  const missing = await open();
  assert.equal(missing.response.status, 200);
  assert.equal(missing.body.initial.error.code, 'QUESTION_NOT_FOUND');
  assert.equal(missing.body.states.length, fixture.bank.outline.flatMap((g) => g.items).length);
});
