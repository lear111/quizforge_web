import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../extensions/single-choice/editor.js', import.meta.url), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const sample = () => ({
  title: '题名',
  data: {
    stem: '题干\n第二行',
    options: [{id: 'first_option', text: '选项一'}, {id: 'B', text: '选项二'}, {id: 'legacy-3', text: '选项三'}],
    correctOptionId: 'legacy-3', explanation: '解析\n说明', maxScore: 2.5
  }
});

class Element {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
  }
  set innerHTML(_) { throw new Error('The editor must create text nodes instead of parsing question HTML.'); }
  append(...items) { for (const item of items) { this.children.push(item); item.parent = this; } }
  replaceChildren(...items) { this.children.forEach((item) => { item.parent = null; }); this.children = []; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); this.parent = null; }
  addEventListener(event, handler) { const list = this.listeners.get(event) || []; list.push(handler); this.listeners.set(event, list); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  focus() { this.focused = true; }
  fire(event) { for (const handler of this.listeners.get(event) || []) handler({preventDefault() {}}); }
}

function fixture(question = sample(), capabilities = {canEdit: true}) {
  const elements = new Map();
  let registered, resizes = 0;
  const QF = {
    editor: {register(value) { registered = value; }},
    ui: {resize() { resizes++; }}
  };
  vm.runInNewContext(source, {
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
      createElement: (tag) => new Element(tag),
      createElementNS: (_, tag) => new Element(tag)
    },
    window: {QF}, QF
  });
  registered.onLoad({mode: 'edit', question: {id: 'question-id', ...plain(question)}, capabilities});
  const byId = (id) => elements.get(id);
  const rows = () => byId('edit-options').children;
  return {registered, byId, rows, resizes: () => resizes, document: () => plain(registered.getDocument())};
}

test('unfinished authoring drafts preserve blank fields and restore without validating the form', () => {
  const f = fixture();
  f.byId('edit-title').value = '';
  f.byId('edit-score').value = '';
  f.byId('edit-stem').value = '';
  f.rows()[0].children[1].value = '';
  const draft = plain(f.registered.exportDraft());
  assert.equal(draft.scoreText, ''); assert.equal(draft.title, '');
  assert.throws(() => f.registered.getDocument(), /题名/);
  const restored = fixture(); restored.registered.importDraft(draft);
  assert.deepEqual(plain(restored.registered.exportDraft()), draft);
  assert.equal(restored.registered.hasChanges(), true);
});

test('editor preserves complete raw question, stable option IDs and fractional score on a clean round trip', () => {
  const question = sample();
  const f = fixture(question);
  assert.deepEqual(f.document(), question);
  assert.equal(f.registered.hasChanges(), false);
  assert.equal(f.byId('editor-fields').disabled, false);
  assert.ok(f.resizes() > 0);
  const firstDocument = f.document();
  firstDocument.data.options[0].text = 'a caller mutation';
  assert.equal(f.document().data.options[0].text, '选项一');
});

test('edits return title, multiline content, correct choice and score without changing option IDs', () => {
  const f = fixture();
  f.byId('edit-title').value = '新题名';
  f.byId('edit-stem').value = '新题干\n代码';
  f.rows()[0].children[1].value = '第一项修改';
  f.rows()[0].children[1].fire('input');
  f.byId('edit-correct').value = 'first_option';
  f.byId('edit-explanation').value = '新解析';
  f.byId('edit-score').value = '3.75';
  const document = f.document();
  assert.equal(document.title, '新题名');
  assert.equal(document.data.stem, '新题干\n代码');
  assert.deepEqual(document.data.options.map((option) => option.id), ['first_option', 'B', 'legacy-3']);
  assert.equal(document.data.options[0].text, '第一项修改');
  assert.equal(document.data.correctOptionId, 'first_option');
  assert.equal(document.data.maxScore, 3.75);
  assert.equal(f.registered.hasChanges(), true);
});

test('adding an option allocates an unused ID and retains the existing correct answer', () => {
  const f = fixture();
  f.byId('add-option').fire('click');
  assert.equal(f.rows().length, 4);
  assert.equal(f.byId('edit-correct').value, 'legacy-3');
  f.rows()[3].children[1].value = '新选项';
  const document = f.document();
  assert.deepEqual(document.data.options.map((option) => option.id), ['first_option', 'B', 'legacy-3', 'A']);
  assert.equal(new Set(document.data.options.map((option) => option.id)).size, 4);
});

test('deleting another option preserves answer ID and remaining IDs while relabeling visible letters', () => {
  const f = fixture();
  f.rows()[0].children[2].fire('click');
  const document = f.document();
  assert.deepEqual(document.data.options.map((option) => option.id), ['B', 'legacy-3']);
  assert.equal(document.data.correctOptionId, 'legacy-3');
  assert.equal(f.rows()[0].children[0].textContent, 'A');
  assert.equal(f.rows()[1].children[1].attributes.get('aria-label'), '选项 B');
});

test('deleting the correct option selects an existing answer and asks the author to confirm it', () => {
  const f = fixture();
  f.rows()[2].children[2].fire('click');
  assert.equal(f.document().data.correctOptionId, 'first_option');
  assert.match(f.byId('editor-notice').textContent, /原正确选项已删除/);
  assert.equal(f.byId('edit-correct').focused, true);
});

test('option controls enforce the 2 to 26 boundary even when their handlers are called directly', () => {
  const minimum = sample();
  minimum.data.options.pop(); minimum.data.correctOptionId = 'B';
  const lower = fixture(minimum);
  assert.equal(lower.rows()[0].children[2].disabled, true);
  lower.rows()[0].children[2].fire('click');
  assert.equal(lower.rows().length, 2);

  const maximum = sample();
  maximum.data.options = Array.from({length: 26}, (_, index) => ({id: String.fromCharCode(65 + index), text: `选项${index}`}));
  maximum.data.correctOptionId = 'Z';
  const upper = fixture(maximum);
  assert.equal(upper.byId('add-option').disabled, true);
  upper.byId('add-option').fire('click');
  assert.equal(upper.rows().length, 26);
  assert.equal(upper.document().data.correctOptionId, 'Z');
});

test('invalid author fields are rejected with readable feedback and focus', () => {
  const cases = [
    ['edit-title', '  ', /请填写题名/],
    ['edit-title', 'x'.repeat(301), /题名不能超过 300/],
    ['edit-stem', '', /请填写题干/],
    ['edit-stem', 'x'.repeat(20001), /题干不能超过 20000/],
    ['edit-explanation', '\n ', /请填写解析/],
    ['edit-explanation', 'x'.repeat(20001), /解析不能超过 20000/],
    ['edit-correct', 'missing-id', /请选择一个正确答案/],
    ...['', '0', '-1', 'Infinity', 'NaN', '100001'].map((value) => ['edit-score', value, /分值应大于 0/])
  ];
  for (const [id, value, message] of cases) {
    const f = fixture(); f.byId(id).value = value;
    assert.throws(() => f.document(), message);
    assert.equal(f.byId('editor-error').hidden, false);
    assert.equal(f.byId(id).attributes.get('aria-invalid'), 'true');
    assert.equal(f.byId(id).focused, true);
    assert.equal(f.registered.hasChanges(), true, 'Invalid unsaved input must still count as a change.');
  }
  for (const value of ['', 'x'.repeat(10001)]) {
    const f = fixture(); f.rows()[0].children[1].value = value;
    assert.throws(() => f.document(), /选项 A/);
    assert.equal(f.rows()[0].children[1].focused, true);
  }
});

test('duplicate or invalid option IDs cannot leave the editor as a valid document', () => {
  for (const id of ['B', 'bad id']) {
    const question = sample(); question.data.options[0].id = id;
    assert.throws(() => fixture(question).document(), /选项标识无效/);
  }
});

test('literal HTML is preserved as author text and is never parsed into editor markup', () => {
  const question = sample();
  question.title = '<script>example</script>';
  question.data.stem = '<img src=x onerror=alert(1)>';
  question.data.options[0].text = '<b>bold</b>';
  const f = fixture(question);
  assert.deepEqual(f.document(), question);
  assert.match(f.byId('edit-correct').children[0].textContent, /<b>bold<\/b>/);
});

test('missing edit permission disables fields and rejects document save', () => {
  const f = fixture(sample(), {canEdit: false});
  assert.equal(f.byId('editor-fields').disabled, true);
  assert.equal(f.byId('add-option').disabled, true);
  assert.throws(() => f.document(), /当前题目不能编辑/);
  f.byId('add-option').fire('click');
  assert.equal(f.rows().length, 3);
});
