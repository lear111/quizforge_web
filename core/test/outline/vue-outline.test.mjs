import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {renderOutlineView,destroyOutlineView} from '../../web/outline/outline-view.js';

function fixture(t){
  const dom=new JSDOM('<nav id="outline-list"></nav>',{runScripts:'outside-only'});loadVueUi(dom);
  const document=dom.window.document,root=document.querySelector('nav'),calls=[];
  t.after(()=>{destroyOutlineView(document);dom.window.close();});
  const pane={view:'practice',questionId:'a',collection:{questions:[{id:'a',title:'题目A'},{id:'b',title:'题目B'}],states:{}}};
  const render=(value=pane,label='current')=>renderOutlineView({document,pane:value,onNavigate:(...args)=>calls.push([label,...args]),onSummary:()=>calls.push([label,'summary'])});
  return {dom,document,root,pane,calls,render,button:id=>root.querySelector(`[data-question-id="${id}"]`)};
}

test('keyed outline retains keyboard focus while grading, labels and current question change',t=>{
  const f=fixture(t);f.render();const a=f.button('a'),b=f.button('b');a.focus();
  f.pane.collection.states.a={status:'submitted',result:{score:1,maxScore:1}};f.pane.questionId='b';f.pane.collection.questions[0].outlineLabel='甲';f.render();
  assert.equal(f.button('a'),a);assert.equal(f.button('b'),b);assert.equal(f.document.activeElement,a);
  assert.equal(a.textContent,'甲');assert.equal(a.classList.contains('correct'),true);assert.equal(a.getAttribute('aria-current'),'false');assert.equal(b.getAttribute('aria-current'),'true');
});

test('same question IDs in a different pane remount and cannot call the old pane',t=>{
  const f=fixture(t);f.render(f.pane,'old');const old=f.button('a');
  const next={...f.pane,collection:{...f.pane.collection}};f.render(next,'new');assert.notEqual(f.button('a'),old);
  old.click();f.button('a').click();assert.deepEqual(f.calls,[['new','a',null]]);
});

test('new callbacks replace old handlers without multiplying navigation or summary actions',t=>{
  const f=fixture(t);for(let i=0;i<15;i++)f.render(f.pane,String(i));
  f.button('a').click();f.root.querySelector('.outline-score-summary').click();
  assert.deepEqual(f.calls,[['14','a',null],['14','summary']]);
});

test('closed and unmounted panes ignore detached buttons; another mount works',t=>{
  const f=fixture(t);f.render();const old=f.button('a'),summary=f.root.querySelector('.outline-score-summary');
  f.pane.closed=true;old.click();summary.click();assert.deepEqual(f.calls,[]);
  f.pane.closed=false;destroyOutlineView(f.document);destroyOutlineView(f.document);old.click();summary.click();assert.deepEqual(f.calls,[]);assert.equal(f.root.children.length,0);
  f.render();f.button('a').click();assert.deepEqual(f.calls,[['current','a',null]]);
});

test('removing a child fences its old callback while reordered children keep their nodes',t=>{
  const f=fixture(t);f.pane.collection.questions=[{id:'a',title:'组合',outlineItems:[{id:'first',label:'1'},{id:'second',label:'2'}]}];f.render();
  const first=f.root.querySelector('[data-outline-item-id="first"]'),second=f.root.querySelector('[data-outline-item-id="second"]');
  f.pane.collection.questions[0].outlineItems.reverse();f.render();assert.equal(f.root.querySelector('.outline-child'),second);
  f.pane.collection.questions[0].outlineItems=[{id:'second',label:'新编号'}];f.render();first.click();second.click();assert.deepEqual(f.calls,[['current','a','second']]);assert.equal(second.textContent,'新编号');
});

test('only display fields cross into Vue; arbitrary answer, ink and question data remain outside',t=>{
  const f=fixture(t),circular={};circular.self=circular;f.pane.collection.questions[0].data=circular;f.pane.collection.states.a={status:'draft',answer:circular,revision:10,ink:circular};
  const original=f.dom.window.QuizForgeUI.renderOutline;let snapshot;
  f.dom.window.QuizForgeUI.renderOutline=options=>{snapshot=options.input;return original(options);};
  assert.doesNotThrow(()=>f.render());const row=snapshot.groups[0].questions[0];
  assert.deepEqual(Object.keys(row.state),['status','result','outlineStates']);assert.equal('data' in row,false);assert.equal('pane' in snapshot,false);assert.doesNotThrow(()=>JSON.stringify(snapshot));assert.equal(f.button('a').classList.contains('draft'),true);
});

test('labels render as literal text and deleted history clears the previous matrix',t=>{
  const f=fixture(t);f.pane.collection.questions[0].outlineLabel='<img src=x onerror=alert(1)>';f.pane.collection.extension={id:'x',name:'<script>bad</script>'};f.render();
  assert.equal(f.root.querySelector('img,script'),null);assert.equal(f.button('a').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.root.querySelector('h2').textContent,'<script>bad</script>');
  const old=f.button('a');f.pane.view='history-deleted';f.render();assert.equal(f.root.querySelector('button'),null);old.click();assert.deepEqual(f.calls,[]);
});

test('unrecognized child reports are ignored without leaking prototype statuses',t=>{
  const f=fixture(t);f.pane.collection.questions=[{id:'a',title:'组合',outlineItems:[{id:'one',label:'1'},{id:'two',label:'2'}]}];
  f.pane.collection.states.a={status:'submitted',outlineStates:[null,{id:'one',status:'toString'},{id:'two',status:'correct'}]};
  assert.doesNotThrow(()=>f.render());assert.match(f.root.querySelector('[data-outline-item-id="one"]').getAttribute('aria-label'),/未提供小题状态/);assert.equal(f.root.querySelector('[data-outline-item-id="two"]').classList.contains('correct'),true);
});
