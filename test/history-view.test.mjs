import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryView,historyProgress} from '../web/history-view.js';
const entry=(id,status='unanswered')=>({payload:{question:{id,title:`Old ${id}`,data:{stem:`frozen ${id}`}},extension:{id:'choice',version:'1.0.0'},state:{status,answer:null,result:null},draft:null}});

test('history keeps frozen bank order and per-question state, without live bank data',()=>{
  const a=entry('a','submitted'),b=entry('b');
  const record={questions:[a,b],collection:{questions:[{id:'b',title:'Old b'},{id:'a',title:'Old a'}]},page:{html:'old shared'}};
  const view=createHistoryView(record);
  assert.deepEqual(view.questions.map(row=>row.id),['b','a']);
  assert.equal(view.states.a.status,'submitted');
  assert.equal(view.states.b.status,'unanswered');
  assert.equal(view.entry('a').payload.question.data.stem,'frozen a');
  assert.equal(view.entry('b').page.html,'old shared');
});
test('legacy views preserve distinct frozen pages and known questions only',()=>{
  const a=entry('a'),b={...entry('b'),page:{html:'old variant'}};
  const view=createHistoryView({legacy:true,questions:[a,b],page:{html:'first'}});
  assert.deepEqual(view.questions.map(row=>row.id),['a','b']);
  assert.equal(view.entry('b').page.html,'old variant');
  assert.throws(()=>view.entry('unknown'),/没有/);
});
test('missing or duplicate frozen question entries fail before displaying a mismatched bank',()=>{
  assert.throws(()=>createHistoryView({questions:[entry('a')],collection:{questions:[{id:'a'},{id:'missing'}]}}),/不完整/);
  assert.throws(()=>createHistoryView({questions:[entry('a')],collection:{questions:[{id:'a'},{id:'a'}]}}),/不完整/);
});
test('record progress distinguishes incomplete, completed and legacy sets',()=>{
  assert.equal(historyProgress({status:'active',submittedCount:2,questionCount:5}),'进行中 · 已提交 2 / 5 题');
  assert.equal(historyProgress({status:'completed',submittedCount:5,questionCount:5}),'已完成 · 已提交 5 / 5 题');
  assert.equal(historyProgress({legacy:true,knownQuestionCount:4,questionCount:4}),'旧版记录 · 已保留 4 题');
});

test('mixed history resolves each shared frozen page and keeps extension versions in its outline',()=>{
  const choice={id:'choice',version:'1.0.0',name:'选择题'},text={id:'text',version:'2.0.0',name:'简答题'};
  const a={...entry('a'),pageKey:'choice-page'},b={...entry('b'),pageKey:'text-page'},c={...entry('c'),pageKey:'choice-page'};
  b.payload.extension=text;
  const pages={'choice-page':{html:'frozen choice',script:'old choice',style:'',extension:choice},'text-page':{html:'frozen text',script:'old text',style:'',extension:text}};
  const view=createHistoryView({extension:null,collection:{extension:null,questions:[{id:'a'},{id:'b'},{id:'c'}]},questions:[a,b,c],pages});
  assert.equal(view.entry('a').page,pages['choice-page']);assert.equal(view.entry('c').page,pages['choice-page']);assert.equal(view.entry('b').page,pages['text-page']);
  assert.deepEqual(view.questions.map(row=>[row.id,row.type.id,row.type.version]),[['a','choice','1.0.0'],['b','text','2.0.0'],['c','choice','1.0.0']]);
});

test('mixed history rejects missing references even when an old shared page is available',()=>{
  const a={...entry('a'),pageKey:'missing'};
  assert.throws(()=>createHistoryView({questions:[a],pages:{},page:{html:'fallback'}}),/引用缺失/);
  assert.throws(()=>createHistoryView({questions:[entry('a')],pages:{},page:{html:'fallback'}}),/引用缺失/);
  assert.throws(()=>createHistoryView({questions:[{...entry('a'),pageKey:null}],page:{html:'fallback'}}),/引用缺失/);
  assert.throws(()=>createHistoryView({questions:[entry('a')]}),/页面数据缺失/);
});

test('mixed history rejects pages from another extension or another version',()=>{
  const a={...entry('a'),pageKey:'frozen'};
  for(const extension of [{id:'text',version:'1.0.0'},{id:'choice',version:'2.0.0'},undefined]){
    assert.throws(()=>createHistoryView({questions:[a],pages:{frozen:{html:'wrong',extension}}}),/不匹配/);
  }
});

test('duplicate frozen payloads cannot silently replace an earlier question',()=>{
  assert.throws(()=>createHistoryView({questions:[entry('a'),entry('a')],collection:{questions:[{id:'a'}]},page:{html:'shared'}}),/不完整/);
});
