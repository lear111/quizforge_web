import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {resolveExtensionApi} from '../web/api-bridges.js';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(check){for(let i=0;i<30&&!check();i++)await tick();assert.ok(check(),'Expected bridge reply');}

function fixture(t,folder,mode,context,{richtext=false}={}) {
  const file=mode==='edit'?'editor':'practice';
  const packagePath=folder==='short-answer'?'./fixtures/legacy-extensions/short-answer':`../../extensions/基础题型/${folder}`;
  const dom=new JSDOM(read(`${packagePath}/${file}.html`),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'}),sent=[];
  const parent={postMessage:value=>sent.push(structuredClone(value))};
  Object.defineProperty(dom.window,'parent',{value:parent});
  dom.window.structuredClone=structuredClone;
  dom.window.ResizeObserver=class{observe(){}disconnect(){}};
  const bridge=resolveExtensionApi(); // Unmodified legacy manifests/pages have no version declaration.
  const dependencies=JSON.parse(read(`${packagePath}/manifest.json`)).dependencies||[];
  const boot={session:'old-extension',context,api:bridge.api,dependencies};
  dom.window.eval(`(${bridge.bootstrap.toString()})(${JSON.stringify(boot)});`);
  if(richtext)dom.window.eval(read('../shared/richtext/1.0.0/richtext.js'));
  const receive=value=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:parent,data:{...value,channel:'quizforge-host',session:boot.session}}));
  t.after(async()=>{receive({kind:'dispose'});await tick();dom.window.close();});
  dom.window.eval(read(`${packagePath}/${file}.js`));
  return {dom,sent,receive,byId:id=>dom.window.document.getElementById(id)};
}

test('published single-choice 1.0.0 still renders and saves through the v1 bridge without changing its package',async t=>{
  const question=JSON.parse(read('../../extensions/基础题型/single-choice/examples.json')).questions[0];
  const context={mode:'practice',question,status:'unanswered',answer:null,result:null,capabilities:{canSave:true,canSubmit:true,canRetry:false}};
  const f=fixture(t,'single-choice','practice',context);
  await waitFor(()=>f.sent.some(value=>value.kind==='registered'));
  assert.equal(f.byId('question-title').textContent,question.title);
  const option=question.data.options[1],radio=f.dom.window.document.querySelector(`input[value="${option.id}"]`);
  radio.checked=true;radio.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
  await waitFor(()=>f.sent.some(value=>value.kind==='request'&&value.method==='save'));
  const request=f.sent.find(value=>value.kind==='request'&&value.method==='save');
  assert.deepEqual(request.args,{purpose:'draft',data:{answer:{selectedOptionId:option.id}}});
  f.receive({kind:'reply',id:request.id,reply:{ok:true,data:{status:'draft'}}});
  f.receive({kind:'flush',id:'leave'});
  await waitFor(()=>f.sent.some(value=>value.kind==='flushed'&&value.id==='leave'));
  assert.equal(f.sent.find(value=>value.id==='leave').ok,true);
  assert.equal(f.dom.window.QF.api.major,1);
});

test('published single-choice editor preserves its document and draft hooks through v1',async t=>{
  const question=JSON.parse(read('../../extensions/基础题型/single-choice/examples.json')).questions[0];
  const f=fixture(t,'single-choice','edit',{mode:'edit',question,capabilities:{canEdit:true}});
  await waitFor(()=>f.sent.some(value=>value.kind==='registered'));
  f.byId('edit-title').value='升级宿主后的题名';
  f.byId('edit-title').dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  f.receive({kind:'read-document',id:'save'});
  await waitFor(()=>f.sent.some(value=>value.kind==='document'));
  const document=f.sent.find(value=>value.kind==='document');
  assert.equal(document.ok,true);assert.equal(document.changed,true);assert.equal(document.document.title,'升级宿主后的题名');
  assert.deepEqual(document.document.data,question.data);
  f.receive({kind:'read-draft',id:'draft'});
  await waitFor(()=>f.sent.some(value=>value.kind==='editor-draft'));
  const draft=f.sent.find(value=>value.kind==='editor-draft');
  assert.equal(draft.supported,true);assert.equal(draft.draft.title,'升级宿主后的题名');
});

test('published short-answer 1.0.0 and its frozen richtext 1.0.0 render old history through v1',async t=>{
  const question=JSON.parse(read('./fixtures/legacy-extensions/short-answer/examples.json')).questions.find(value=>!JSON.stringify(value).includes('assetId'));
  const answer={formatVersion:1,document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'旧版历史答案'}]}]}};
  const context={mode:'history',question,status:'submitted',answer,result:{gradingStatus:'graded',score:1,maxScore:question.data.maxScore},capabilities:{canSave:false,canSubmit:false,canRetry:false,canReview:false}};
  const f=fixture(t,'short-answer','history',context,{richtext:true});
  await waitFor(()=>f.sent.some(value=>value.kind==='registered'));
  assert.match(f.byId('answer-host').textContent,/旧版历史答案/);
  assert.equal(f.dom.window.document.querySelector('.tiptap'),null);
  assert.equal(f.byId('submit-button').hidden,true);assert.equal(f.byId('review-panel').hidden,true);
  assert.equal(f.sent.some(value=>value.kind==='request'),false,'Read-only legacy history must not write or load a heavy editor.');
});
