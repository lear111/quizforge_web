import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const root = new URL('../../skills/quizforge-bank-builder/assets/development-scaffold/', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const question = JSON.parse(read('examples/bank.json')).questions[0];
function page(t, mode = 'practice', optional = false) {
  const dom = new JSDOM(read(mode === 'edit' ? 'editor.html' : 'practice.html'));
  t.after(() => dom.window.close());
  let hooks;
  const QF = {ui:{resize(){}},page:{register(value){hooks=value;return Promise.resolve();}},editor:{register(value){hooks=value;return Promise.resolve();}}};
  const source = read(mode === 'edit' ? 'editor.js' : 'practice.js');
  vm.runInNewContext(optional ? source.replace('scoreSlider: false, aiFeedback: false','scoreSlider: true, aiFeedback: true') : source, {document:dom.window.document,QF});
  const context = {mode,question,capabilities:{canEdit:mode==='edit'},status:'unanswered',answer:null,result:null};
  hooks.onLoad(context);
  return {document:dom.window.document,window:dom.window,hooks,context};
}

test('public projection hides answer and explanation before submission and preserves actual scores', () => {
  let rules;vm.runInNewContext(read('rules.js'),{QF:{defineType(value){rules=value;}}});
  const data = question.data;
  assert.equal(rules.project(data,{submitted:false}).answerAndExplanation,undefined);
  assert.equal(rules.project(data,{submitted:true}).answerAndExplanation,data.answerAndExplanation);
  assert.equal(rules.getScore(data,{submitted:false}).maxScore,data.maxScore);
  assert.equal(rules.getScore(data,{submitted:true,result:{score:.5,maxScore:1}}).score,.5);
  assert.equal(rules.grade,undefined,'UI skeleton must not fabricate grading.');
});

test('practice shows the complete stem and answer area, then demonstrates results without any save or AI service', t => {
  const {document,hooks} = page(t);
  assert.equal(document.getElementById('stem').textContent,question.data.stem);
  assert.equal(document.getElementById('result').hidden,true);
  assert.equal(document.getElementById('answer-and-explanation').textContent,'');
  document.getElementById('answer').value='我的回答';
  document.getElementById('submit').click();
  assert.equal(document.getElementById('result').hidden,false);
  assert.match(document.getElementById('answer-and-explanation').textContent,/没有保存或判分/);
  assert.equal(document.getElementById('score').hidden,true);
  assert.equal(document.getElementById('score-slider-area').hidden,true);
  assert.equal(document.getElementById('ai-feedback-area').hidden,true);
  hooks.onDispose();document.getElementById('result').hidden=true;
  document.getElementById('submit').click();assert.equal(document.getElementById('result').hidden,true);
});

test('optional submitted-state scoring and AI areas are only local marked demonstrations', t => {
  const {document,window} = page(t,'practice',true);
  assert.equal(document.getElementById('result').hidden,true);
  document.getElementById('submit').click();
  assert.equal(document.getElementById('score-slider-area').hidden,false);
  assert.equal(document.getElementById('ai-feedback-area').hidden,false);
  const slider=document.getElementById('score-slider');slider.value='.5';slider.dispatchEvent(new window.Event('input'));
  assert.match(document.getElementById('score-value').textContent,/0.5.*未保存/);
  assert.match(document.getElementById('ai-feedback').value,/尚未调用 AI/);
});

test('history displays actual saved score and explanation with all answering and grading controls read-only', t => {
  const {document,hooks,context} = page(t,'practice',true);
  hooks.onLoad({...context,mode:'history',status:'submitted',answer:{text:'已保存回答'},result:{score:.5,maxScore:1,feedback:'实际反馈'}});
  assert.equal(document.getElementById('answer').value,'已保存回答');
  assert.equal(document.getElementById('answer').disabled,true);
  assert.equal(document.getElementById('submit').hidden,true);
  assert.equal(document.getElementById('score').textContent,'0.5 / 1 分');
  assert.equal(document.getElementById('score-slider').disabled,true);
  assert.equal(document.getElementById('ai-feedback').value,'实际反馈');
  assert.equal(document.getElementById('answer-and-explanation').textContent,question.data.answerAndExplanation);
});

test('simple editor preserves unfinished fields and refuses to pretend that document saving is implemented', t => {
  const {document,hooks} = page(t,'edit');
  assert.equal(hooks.hasChanges(),false);
  document.getElementById('stem').value='';document.getElementById('max-score').value='';
  assert.equal(hooks.hasChanges(),true);
  const draft=hooks.exportDraft();
  assert.equal(draft.stem,'');assert.equal(draft.maxScoreText,'');
  document.getElementById('stem').value='被替换的输入';hooks.importDraft(draft);
  assert.equal(document.getElementById('stem').value,'');assert.equal(hooks.hasChanges(),true);
  assert.throws(()=>hooks.getDocument(),error=>error.code==='DEVELOPMENT_NOT_IMPLEMENTED');
  assert.equal(document.querySelectorAll('section').length,3);
});
