import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { basicDemo, repo } from '../../scripts/dev/stage-v2-basic-demo.mjs';

test('public V2 showcase preserves all seven original choice/judgement questions, labels, scores, rich text and assets', () => {
  const { bank, assets, source } = basicDemo();
  const directory = path.join(repo, 'examples/v2/question-banks/基础题型/基础题型展示');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'bank.json'), 'utf8')), bank);
  assert.equal(Object.keys(bank.questions).length, 7);
  assert.deepEqual(
    bank.outline.flatMap((g) => g.items.map((i) => i.label)),
    ['1', '2', '3', '7', '8', '9', '10'],
  );
  assert.deepEqual(
    bank.outline.map((g) => g.items.map((i) => i.maxScore)),
    [
      [2, 2, 2],
      [4, 4],
      [2, 2],
    ],
  );
  assert.equal(
    Object.keys(bank.questions).some((id) => /short|answer-area/.test(id)),
    false,
  );
  const original = JSON.parse(fs.readFileSync(path.join(source, 'bank.json'), 'utf8'));
  const restoreRefs = (value) => {
    if (Array.isArray(value)) {
      return value.map(restoreRefs);
    }
    if (!value || typeof value !== 'object') {
      return value;
    }
    const copy = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restoreRefs(v)]));
    if (copy.type === 'image') {
      copy.attrs.assetId = copy.attrs.src.slice('qf-asset:assets/'.length, -4);
      delete copy.attrs.src;
    }
    return copy;
  };
  for (const [id, q] of Object.entries(bank.questions)) {
    const old = original.questions.find((q) => q.id === id);
    assert.deepEqual(restoreRefs(q.question.stem), old.data.stem);
    assert.deepEqual(restoreRefs(q.solution.explanation), old.data.answerAndExplanation);
    if (q.question.options) {
      assert.deepEqual(restoreRefs(q.question.options), old.data.options);
    }
    assert.deepEqual(
      q.solution.selected ?? q.solution.value,
      old.data.correctOptionId ?? old.data.correctOptionIds ?? old.data.correctAnswer,
    );
  }
  assert.equal(assets.length, 1);
  for (const asset of assets) {
    assert.ok(
      fs
        .readFileSync(path.join(directory, asset))
        .equals(fs.readFileSync(path.join(source, asset))),
    );
  }
});

test('three V2 graders preserve original all-or-nothing scoring, including empty and false answers', () => {
  const { bank } = basicDemo();
  const graders = new Map();
  for (const title of ['单选题', '多选题', '判断题']) {
    const directory = path.join(repo, 'examples/v2/extensions/基础题型', title);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(manifest.apiVersion, 2);
    assert.equal(manifest.sdkVersions.richtext, '1.1.3');
    let registered;
    vm.runInNewContext(fs.readFileSync(path.join(directory, 'grade.js'), 'utf8'), {
      QF: {
        grader: {
          register(v) {
            registered = v;
          },
        },
      },
    });
    graders.set(title, registered);
  }
  for (const group of bank.outline) {
    for (const item of group.items) {
      const q = bank.questions[item.id],
        grader = graders.get(group.title);
      const expected =
        group.title === '判断题' ? { value: q.solution.value } : { selected: q.solution.selected };
      const score = (answer) => grader.grade(q.question, q.solution, answer, item).score;
      assert.equal(score(expected), item.maxScore, item.id);
      assert.equal(score(null), 0, item.id);
      if (group.title === '单选题') {
        assert.equal(
          score({ selected: q.question.options.find((o) => o.id !== q.solution.selected).id }),
          0,
        );
      }
      if (group.title === '判断题') {
        assert.equal(score({ value: !q.solution.value }), 0);
      }
      if (group.title === '多选题') {
        assert.equal(score({ selected: [...expected.selected].reverse() }), item.maxScore);
        assert.equal(score({ selected: expected.selected.slice(1) }), 0);
        assert.equal(score({ selected: q.question.options.map((o) => o.id) }), 0);
        assert.throws(() => score({ selected: ['unknown'] }));
        assert.throws(() => score({ selected: [expected.selected[0], expected.selected[0]] }));
      }
    }
  }
});
