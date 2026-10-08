import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const sample=JSON.parse(read('question-banks/short-answer-demo/bank.json')).questions[1],plain=value=>JSON.parse(JSON.stringify(value));
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}),tick=()=>new Promise(resolve=>setTimeout(resolve,25));
async function fixture(t,{mode='practice',status='unanswered',answer=null,result=null,saveFailure=false}={}){
  const dom=new JSDOM(read('extensions/short-answer/practice.html'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});t.after(()=>dom.window.close());dom.window.eval(read('shared/richtext/1.0.0/richtext.js'));const api=dom.window.QFRichText;
  api.configure({resources:{get:async()=>({url:'blob:image',mime:'image/png',size:10}),put:async()=>({id:'a'.repeat(64),mime:'image/png',size:10})},async loadEditor(){dom.window.eval(read('shared/richtext/1.0.0/richtext-editor.js'));}});
  let hooks,editor;const calls=[];const context={mode,status,question:plain(sample),answer:plain(answer),result:plain(result),capabilities:{canSave:mode!=='history'&&status!=='submitted',canSubmit:mode!=='history'&&status!=='submitted',canRetry:mode!=='history'&&status==='submitted',canReview:mode!=='history'&&status==='submitted'}};
  const content={...api,createEditor(container,options){editor=api.createEditor(container,options);return editor;}};
  async function save(value){calls.push(plain(value));if(saveFailure)return {ok:false,error:{message:'磁盘写入失败'}};if(value.purpose==='draft'){context.answer=plain(value.data.answer);context.status='draft';}
    if(value.purpose==='submit'){context.answer=plain(value.data.answer);context.status='submitted';context.result={gradingStatus:'pending',score:null,maxScore:sample.data.maxScore,correct:null,feedback:null};context.capabilities={canSave:false,canSubmit:false,canRetry:true,canReview:true};}
    if(value.purpose==='review'){context.result={gradingStatus:'graded',score:value.data.review.score,maxScore:sample.data.maxScore,correct:value.data.review.score===sample.data.maxScore,feedback:null};}
    await hooks.onLoad(plain(context));return {ok:true};}
  dom.window.QF={content,page:{register:value=>{hooks=value;}},save,ui:{resize(){}},requestAction:async()=>({ok:true})};dom.window.eval(read('extensions/short-answer/practice.js'));await hooks.onLoad(plain(context));
  return {dom,api,hooks,context,calls,editor:()=>editor,byId:id=>dom.window.document.getElementById(id),async type(text){const field=dom.window.document.querySelector('.tiptap p');field.textContent=text;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));await tick();},async waitForPurpose(purpose){for(let i=0;i<80&&!calls.some(value=>value.purpose===purpose);i++)await tick();assert.ok(calls.some(value=>value.purpose===purpose));await tick();}};
}
test('latest typed answer flushes before navigation and submission reveals a pending self-review',async t=>{
  const f=await fixture(t);assert.equal(f.byId('submit-button').disabled,true);await f.type('完整回答');await f.hooks.onFlush();
  assert.equal(f.calls.at(-1).purpose,'draft');assert.deepEqual(f.calls.at(-1).data.answer,{formatVersion:1,document:doc('完整回答')});assert.equal(f.byId('submit-button').disabled,false);
  f.byId('submit-button').click();await f.waitForPurpose('submit');assert.equal(f.context.result.score,null);assert.match(f.byId('result-score').textContent,/待评分/);assert.equal(f.byId('review-panel').hidden,false);assert.equal(f.dom.window.document.querySelector('.tiptap'),null);f.hooks.onDispose();
});
test('self-review sends half-point score and later confirmation may adjust it',async t=>{
  const f=await fixture(t,{status:'submitted',answer:{formatVersion:1,document:doc('作答')},result:{gradingStatus:'pending',score:null,maxScore:3.5,correct:null,feedback:null}});
  f.byId('review-score').value='1.5';f.byId('review-score').dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.byId('review-value').textContent,'1.5 分');f.byId('review-confirm').click();await f.waitForPurpose('review');assert.deepEqual(f.calls[0],{purpose:'review',data:{review:{score:1.5}}});assert.match(f.byId('result-score').textContent,/1.5 \/ 3.5/);
  f.byId('review-score').value='3.5';f.byId('review-confirm').click();for(let i=0;i<30&&f.calls.length<2;i++)await tick();assert.equal(f.calls[1].data.review.score,3.5);f.hooks.onDispose();
});
test('history is static, has no editor and cannot submit, retry or review even if controls are clicked',async t=>{
  const f=await fixture(t,{mode:'history',status:'submitted',answer:{formatVersion:1,document:doc('冻结回答')},result:{gradingStatus:'graded',score:2.5,maxScore:3.5,correct:false,feedback:null}});
  assert.equal(f.dom.window.document.querySelector('.tiptap'),null);assert.equal(f.byId('review-panel').hidden,true);assert.equal(f.byId('submit-button').hidden,true);assert.equal(f.byId('retry-button').hidden,true);
  for(const id of ['submit-button','review-confirm','retry-button'])f.byId(id).dispatchEvent(new f.dom.window.Event('click'));await f.hooks.onFlush();await tick();assert.equal(f.calls.length,0);assert.match(f.byId('answer-host').textContent,/冻结回答/);f.hooks.onDispose();
});
test('failed draft flush keeps the typed answer in its editor and rejects navigation flush',async t=>{
  const f=await fixture(t,{saveFailure:true});await f.type('未保存回答');await assert.rejects(f.hooks.onFlush(),/磁盘写入失败/);assert.deepEqual(plain(f.editor().getDocument()),doc('未保存回答'));assert.match(f.byId('save-notice').textContent,/当前答案仍保留/);f.hooks.onDispose();
});
