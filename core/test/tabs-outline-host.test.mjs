import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,stateFor} from '../web/practice-context.js';
import {consecutiveQuestionGroups} from '../web/outline-groups.js';
import {navigateOutlineTarget} from '../web/outline-navigation.js';
import {createHistoryView} from '../web/history-view.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const hostSource=part('function transitionTo(', '\nconst active=')+
  part('function renderOutline(', '\nfunction updateChrome(');

function fixture(t){
  const dom=new JSDOM(readFileSync(new URL('../web/index.html',import.meta.url),'utf8'));
  t.after(()=>dom.window.close());
  const collections=new Map(),errors=[];
  const sandbox={document:dom.window.document,$:selector=>dom.window.document.querySelector(selector),Promise,collections,activeKey:null,transition:Promise.resolve(),
    visibleQuestions,visibleQuestionId,hasScoreSummary,stateFor,consecutiveQuestionGroups,navigateOutlineTarget,
    active:()=>collections.get(sandbox.activeKey),notice(){},failure:error=>errors.push(error),updateChrome(){},renderRecovery(){},
    showScoreSummary(){},navigateQuestion(){},closeDrawers(){},
    el:(tag,className,text)=>{const node=dom.window.document.createElement(tag);node.className=className||'';if(text!=null)node.textContent=text;return node;},
  };
  vm.runInNewContext(`${hostSource}\nglobalThis.host={renderOutline};`,sandbox);
  const host=sandbox.host;
  function add(id){
    const node=dom.window.document.createElement('section');dom.window.document.querySelector('#panes').append(node);
    const pane={id,key:`bank:${id}`,kind:'bank',node,closed:false,view:'practice',questionId:'a',
      collection:{title:id,questions:[{id:'a',title:'题干'}],states:{}},plugin:{}};
    collections.set(pane.key,pane);sandbox.activeKey??=pane.key;return pane;
  }
  return {dom,collections,errors,sandbox,host,add};
}

test('outline replaces composite parent buttons with ordered children in one matrix without independent statuses',async t=>{
  const f=fixture(t),pane=f.add('composite');
  const single={id:'choice',name:'单选'},composite={id:'parts',name:'复合题'};
  pane.collection.questions=[{id:'a',title:'普通题',type:single},{id:'parent',title:'大题',type:composite,outlineItems:[{id:'second',label:'2'},{id:'first',label:'1'}]},{id:'last',title:'普通题',type:single}];
  pane.questionId='parent';pane.collection.states.parent={status:'submitted',result:{correct:true}};pane.outlineItemId='second';
  f.host.renderOutline();
  const root=f.dom.window.document.querySelector('#outline-list');
  assert.deepEqual([...root.querySelectorAll('.outline-group-title')].map(node=>node.textContent),['单选','复合题','单选']);
  assert.deepEqual([...root.querySelectorAll('.outline-child')].map(node=>[node.dataset.questionId,node.dataset.outlineItemId,node.textContent]),[['parent','second','2'],['parent','first','1']]);
  assert.deepEqual([...root.querySelectorAll('.outline-item')].map(node=>node.textContent),['1','2','1','3']);
  assert.equal(root.querySelector('[data-question-id="parent"]:not([data-outline-item-id])'),null);
  assert.equal(root.querySelector('.outline-parent'),null);assert.equal(root.querySelector('.outline-child-matrix'),null);
  assert.equal(root.querySelectorAll('.outline-matrix')[1].children.length,2);
  assert.equal(root.querySelector('.outline-child.active').dataset.outlineItemId,'second');
  assert.equal(root.querySelectorAll('.outline-child.correct').length,0);
  assert.equal(pane.collection.questions.length,3);
  let called=0;pane.plugin.navigateOutline=async id=>{called++;assert.equal(id,'first');assert.equal(pane.node.inert,false);};
  root.querySelector('[data-outline-item-id="first"]').click();await f.sandbox.transition;
  assert.equal(called,1);assert.equal(pane.outlineItemId,'first');assert.deepEqual(f.errors,[]);
});

test('adjacent composites share a flat matrix and titles follow parent types and original question order',t=>{
  const f=fixture(t),pane=f.add('groups'),reading={id:'reading',version:'1.0.0',name:'阅读理解'},choice={id:'choice',version:'1.0.0',name:'单选题'};
  pane.collection.questions=[
    {id:'a',title:'甲',type:reading,outlineItems:[{id:'x',label:'21',type:'choice'},{id:'y',label:'22',type:'text'}]},
    {id:'b',title:'乙',type:reading,outlineItems:[{id:'x',label:'23'}]},
    {id:'ordinary',title:'普通题',type:choice},
    {id:'c',title:'丙',type:reading,outlineItems:[{id:'x',label:'25'}]},
    {id:'d',title:'新版本',type:{...reading,version:'2.0.0'},outlineItems:[{id:'x',label:'26'}]},
  ];
  f.host.renderOutline();const root=f.dom.window.document.querySelector('#outline-list'),matrices=[...root.querySelectorAll('.outline-matrix')];
  assert.deepEqual([...root.querySelectorAll('.outline-group-title')].map(node=>node.textContent),['阅读理解','单选题','阅读理解','阅读理解']);
  assert.deepEqual(matrices.map(matrix=>[...matrix.children].map(node=>node.textContent)),[['21','22','23'],['3'],['25'],['26']]);
  assert.equal(matrices.every(matrix=>[...matrix.children].every(node=>node.tagName==='BUTTON')),true);
  assert.deepEqual([...matrices[0].children].map(node=>node.dataset.questionId),['a','a','b']);
  assert.equal(root.querySelector('.outline-parent,.outline-child-matrix'),null);
  const css=readFileSync(new URL('../web/refinements.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.outline-parent\s*\{|\.outline-child-matrix\s*\{/,'No parent column or child separator remains.');
});

for(const view of ['practice','edit','history'])test(`matrix clicks retain parent routing and child focus in ${view}`,async t=>{
  const f=fixture(t),pane=f.add(`navigation-${view}`),type={id:'reading',name:'阅读理解'},frozenRows=[
    {id:'ordinary',title:'大题',type,outlineLabel:'三'},
    {id:'parent',title:'组合题',type,outlineItems:[{id:'old-part',label:'21'}]},
  ],calls=[];
  pane.view=view;pane.collection.questions=frozenRows;pane.questionId='parent';pane.historyQuestionId='parent';pane.outlineItemId='old-part';
  if(view==='history'){
    pane.historyView=createHistoryView({page:{html:'',script:'',style:''},collection:{questions:frozenRows},questions:frozenRows.map(row=>({payload:{question:{id:row.id,title:row.title},state:{status:'unanswered'}}}))});
    pane.collection.questions=[{id:'ordinary',title:'新大题',type,outlineLabel:'新编号'},{id:'parent',title:'新组合',type,outlineItems:[{id:'new-part',label:'99'}]}];
  }
  f.sandbox.navigateQuestion=async(target,id)=>{
    assert.equal(target,pane);calls.push(['parent',view,id]);await Promise.resolve();
    if(view==='history')target.historyQuestionId=id;else target.questionId=id;
    target.plugin={navigateOutline:async itemId=>{calls.push(['child',view,itemId]);assert.equal(target.node.inert,false);}};
  };
  f.host.renderOutline();const root=f.dom.window.document.querySelector('#outline-list');
  assert.deepEqual([...root.querySelectorAll('.outline-item')].map(node=>node.textContent),['三','21']);
  root.querySelector('[data-question-id="ordinary"]').click();await f.sandbox.transition;
  assert.equal(pane.outlineItemId,null);
  root.querySelector('[data-outline-item-id="old-part"]').click();await f.sandbox.transition;
  assert.deepEqual(calls,[['parent',view,'ordinary'],['parent',view,'parent'],['child',view,'old-part']]);
  assert.equal(pane.outlineItemId,'old-part');assert.equal(root.querySelector('.outline-child.active').textContent,'21');
  assert.equal(root.querySelector('[data-outline-item-id="new-part"]'),null);assert.deepEqual(f.errors,[]);
});

test('old flat outline keeps its original parent number buttons',t=>{
  const f=fixture(t),pane=f.add('legacy');
  pane.collection.questions.push({id:'b',title:'旧题'});f.host.renderOutline();
  const root=f.dom.window.document.querySelector('#outline-list');
  assert.deepEqual([...root.querySelectorAll('.outline-item')].map(node=>node.textContent),['1','2']);
  assert.equal(root.querySelector('.outline-parent'),null);assert.equal(root.querySelector('.outline-child'),null);
});

test('outline shows consecutive type groups and numbered states with only the summary entry',t=>{
  const f=fixture(t),pane=f.add('mixed');
  const choice={id:'choice',version:'1.0.0',name:'单选题'},text={id:'text',version:'1.0.0',name:'简答题'};
  pane.collection.questions=[{id:'a',title:'甲',type:choice},{id:'b',title:'乙',type:text},{id:'c',title:'丙',type:choice}];
  pane.collection.states={a:{status:'submitted',result:{score:1,maxScore:1,correct:true}},b:{status:'submitted',result:{gradingStatus:'pending'}},c:{status:'draft'}};
  f.host.renderOutline();const outline=f.dom.window.document.querySelector('.outline');
  assert.deepEqual([...outline.querySelectorAll('.outline-group-title')].map(node=>node.textContent),['单选题','简答题','单选题']);
  assert.deepEqual([...outline.querySelectorAll('.outline-item')].map(node=>node.textContent),['1','2','3']);
  assert.equal(outline.querySelector('[data-question-id="a"]').classList.contains('correct'),true);assert.equal(outline.querySelector('[data-question-id="b"]').classList.contains('incorrect'),true);assert.equal(outline.querySelector('[data-question-id="c"]').classList.contains('unanswered'),true);
  assert.equal(outline.querySelector('#outline-count'),null);assert.equal(outline.querySelector('#outline-summary'),null);assert.doesNotMatch(outline.textContent,/已提交|得分|共.*题/);assert.equal(outline.querySelector('.outline-score-summary').textContent,'分值汇总');
});

test('child states are scoped to their parent and keep colors while selected in practice and edit',t=>{
  const f=fixture(t),pane=f.add('states'),statuses=['correct','incorrect','unanswered'];
  pane.collection.questions=[{id:'a',title:'甲',outlineItems:statuses.map((status,i)=>({id:String(i),label:String(i+1)}))},{id:'b',title:'乙',outlineItems:[{id:'0',label:'4'}]},{id:'c',title:'丙',outlineItems:[{id:'0',label:'5'}]}];
  pane.collection.states={a:{status:'submitted',result:{correct:false},outlineStates:statuses.map((status,i)=>({id:String(i),status}))},b:{status:'submitted',outlineStates:[{id:'0',status:'incorrect'}]},c:{status:'draft',outlineStates:[{id:'0',status:'correct'}]}};
  const style=f.dom.window.document.createElement('style');style.textContent=readFileSync(new URL('../web/refinements.css',import.meta.url),'utf8');f.dom.window.document.head.append(style);
  for(const view of ['practice','edit']){
    pane.view=view;
    for(const [selected,color]of [['0','rgb(237, 246, 241)'],['1','rgb(255, 240, 237)']]){
      pane.outlineItemId=selected;f.host.renderOutline();const root=f.dom.window.document.querySelector('#outline-list');
      statuses.forEach((status,i)=>assert.equal(root.querySelector(`[data-question-id="a"][data-outline-item-id="${i}"]`).classList.contains(status),true));
      const active=root.querySelector(`[data-question-id="a"][data-outline-item-id="${selected}"]`);
      assert.equal(active.classList.contains('active'),true);assert.equal(f.dom.window.getComputedStyle(active).backgroundColor,color);
      assert.equal(root.querySelector('[data-question-id="b"][data-outline-item-id="0"]').classList.contains('incorrect'),true);
      assert.equal(root.querySelector('[data-question-id="c"][data-outline-item-id="0"]').classList.contains('unanswered'),true);
      assert.match(root.querySelector('[data-outline-item-id="1"]').getAttribute('aria-label'),/错误/);
      assert.equal(root.querySelector('.draft,.partial,.pending-review'),null);
    }
  }
  assert.doesNotMatch(style.textContent,/\.outline-item\.(draft|partial|pending-review)\s*\{/);
});

test('summary ignores a previous round child result and frozen history keeps its own states and jump',async t=>{
  const f=fixture(t),pane=f.add('round-states'),row={id:'a',title:'甲',outlineItems:[{id:'same',label:'1'}]};
  pane.collection.questions=[row];pane.collection.states.a={status:'submitted',result:{correct:true},outlineStates:[{id:'same',status:'correct'}]};
  pane.summaryShown=true;pane.scoreSummary={questions:[{id:'a',submitted:false}]};f.host.renderOutline();
  const button=()=>f.dom.window.document.querySelector('.outline-child');assert.equal(button().classList.contains('correct'),false);
  assert.equal(button().classList.contains('unanswered'),true);
  pane.scoreSummary.questions[0].outlineStates=[{id:'same',status:'correct'}];f.host.renderOutline();assert.equal(button().classList.contains('unanswered'),true);
  pane.scoreSummary.questions[0].submitted=true;pane.scoreSummary.questions[0].outlineStates=[{id:'same',status:'incorrect'}];f.host.renderOutline();assert.equal(button().classList.contains('incorrect'),true);
  pane.view='history';pane.summaryShown=false;pane.historyQuestionId='a';pane.historyEntry={};pane.historyView={questions:[row],states:{a:{status:'submitted',result:{correct:false},outlineStates:[{id:'same',status:'incorrect'}]}}};
  pane.plugin.navigateOutline=async id=>assert.equal(id,'same');f.host.renderOutline();assert.equal(button().classList.contains('incorrect'),true);
  button().click();await f.sandbox.transition;assert.equal(pane.outlineItemId,'same');assert.deepEqual(f.errors,[]);
  pane.view='practice';pane.collection.states.a={status:'unanswered',result:null,outlineStates:[{id:'same',status:'correct'}]};f.host.renderOutline();assert.equal(button().classList.contains('correct'),false);assert.equal(button().classList.contains('unanswered'),true);
});

test('ordinary question correctness uses full numeric score and summary snapshots instead of a correctness flag',t=>{
  const f=fixture(t),pane=f.add('scores');
  pane.collection.questions=[{id:'a',title:'满分'},{id:'b',title:'部分分'},{id:'c',title:'零分'},{id:'d',title:'未提交'},{id:'e',title:'未判分'}];
  pane.collection.states={a:{status:'submitted',result:{score:2,maxScore:2,correct:false}},b:{status:'submitted',result:{score:.5,maxScore:2,correct:true}},c:{status:'submitted',result:{score:0,maxScore:2,correct:true}},d:{status:'draft',result:{score:2,maxScore:2,correct:true}},e:{status:'submitted',result:{score:null,maxScore:2,correct:null,gradingStatus:'pending'}}};
  f.host.renderOutline();const button=id=>f.dom.window.document.querySelector(`[data-question-id="${id}"]`);
  for(const [id,status]of [['a','correct'],['b','incorrect'],['c','incorrect'],['d','unanswered'],['e','incorrect']])assert.equal(button(id).classList.contains(status),true);
  pane.summaryShown=true;pane.scoreSummary={questions:[{id:'a',submitted:true,score:1,maxScore:2},{id:'b',submitted:true,score:2,maxScore:2},{id:'c',submitted:false,score:0,maxScore:2}]};f.host.renderOutline();
  assert.equal(button('a').classList.contains('incorrect'),true);assert.equal(button('b').classList.contains('correct'),true);assert.equal(button('c').classList.contains('unanswered'),true);
});
