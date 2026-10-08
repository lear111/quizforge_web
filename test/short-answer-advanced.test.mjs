import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {validateDocument} from '../shared/richtext/1.1.1/src/document.js';
import {toAiBlocks,prepareAiGrading} from '../extensions/short-answer-1.2.1/src/ai-document.js';

const root=new URL('../',import.meta.url),read=path=>readFileSync(new URL(path,root),'utf8');
const examples=JSON.parse(read('extensions/short-answer-1.2.1/examples.json'));
const copy=value=>JSON.parse(JSON.stringify(value)),paragraph=text=>({type:'paragraph',content:[{type:'text',text}]}),doc=text=>({type:'doc',content:[paragraph(text)]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('AI conversion retains formulas, table positions and diagram order without formatting or runtime URLs',()=>{
  const document={type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'求平均数：',marks:[{type:'highlight',attrs:{color:'#FFF000'}}]},{type:'inlineMath',attrs:{latex:'\\bar{x}=4'}}]},
    {type:'table',content:[
      {type:'tableRow',content:[{type:'tableHeader',attrs:{rowspan:2},content:[paragraph('类别')]},{type:'tableHeader',content:[paragraph('数值')]}]},
      {type:'tableRow',content:[{type:'tableCell',content:[{type:'image',attrs:{assetId:'a'.repeat(64),alt:'测量图',width:200,align:'center'}},paragraph('4')]}]}
    ]},
    {type:'blockMath',attrs:{latex:'\\frac{2+4+6}{3}=4'}}
  ]};
  const original=copy(document),blocks=toAiBlocks(document);assert.deepEqual(document,original);
  assert.match(blocks[0].text,/\$\\bar\{x\}=4\$/);assert.match(blocks[0].text,/第 1 行，第 1 列（表头）（跨 2 行）/);assert.match(blocks[0].text,/第 2 行，第 2 列/);
  assert.deepEqual(blocks[1],{type:'image',assetId:'a'.repeat(64),alt:'测量图'});
  assert.match(blocks[2].text,/\$\$\n\\frac\{2\+4\+6\}\{3\}=4\n\$\$/);assert.equal(JSON.stringify(blocks).includes('#FFF000'),false);assert.equal(JSON.stringify(blocks).includes('width'),false);
});

test('packaged 1.2.1 validates advanced examples and grades through the normal host protocol',()=>{
  const extension=fileURLToPath(new URL('extensions/short-answer-1.2.1/',root)),files={rules:extension+'rules.js',questionSchema:extension+'question.schema.json',answerSchema:extension+'answer.schema.json'};
  function call(payload){const run=spawnSync(process.execPath,[fileURLToPath(new URL('server/rules-runner.cjs',root))],{input:JSON.stringify({...files,...payload}),encoding:'utf8',timeout:5000,maxBuffer:3*1024*1024});assert.equal(run.error,undefined,run.error?.message);return JSON.parse(run.stdout);}
  assert.equal(call({op:'validateBank',questions:examples.questions.map(row=>row.data)}).ok,true);
  const data=examples.questions.at(-1).data,answer={formatVersion:1,document:{type:'doc',content:[{type:'blockMath',attrs:{latex:'\\bar{x}=4'}}]}};
  const before=call({op:'project',data,state:{submitted:false,result:null},withCapabilities:true});assert.equal(before.ok,true);assert.equal(before.data.projected.referenceAnswer,undefined);assert.equal(before.data.capabilities.canAiGrade,true);
  const prepared=call({op:'prepareAiGrading',data,answer,state:{submitted:true,status:'submitted',result:{gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:null}}});assert.equal(prepared.ok,true,prepared.error);assert.deepEqual(prepared.data.gradingInput,prepareAiGrading(data,answer));
});

async function editorFixture(t,question=examples.questions.at(-1)){
  const dom=new JSDOM(read('extensions/short-answer-1.2.1/editor.html'),{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());
  let hooks,current=null,editorCount=0,flushCount=0;
  const content={validateDocument,render(host,value){host.textContent=JSON.stringify(value);return {ready:Promise.resolve(),destroy(){host.replaceChildren();}};},createEditor(host,options){
    editorCount++;let value=copy(options.doc),destroyed=false;
    current={update(document){value=copy(document);options.onChange(value);},getDocument:()=>copy(value),ready:Promise.resolve(),focus(){},async flush(){flushCount++;},destroy(){if(destroyed)return;destroyed=true;editorCount--;host.replaceChildren();}};return current;
  }};
  dom.window.QF={content,ui:{resize(){}},editor:{register(value){hooks=value;}}};dom.window.eval(read('extensions/short-answer-1.2.1/editor.js'));
  await hooks.onLoad({mode:'edit',question:copy(question),capabilities:{canEdit:true}});
  return {dom,hooks,byId:id=>dom.window.document.getElementById(id),current:()=>current,editorCount:()=>editorCount,flushCount:()=>flushCount,async activate(field){dom.window.document.getElementById('activate-'+field).click();await tick();await tick();}};
}

test('authoring has a single stem and derives hidden protocol title instead of a separate title field',async t=>{
  const f=await editorFixture(t);assert.equal(f.byId('edit-title'),null);assert.equal(f.hooks.hasChanges(),false);
  await f.activate('stem');f.current().update(doc('新的题干 '+('长'.repeat(330))));
  const saved=await f.hooks.getDocument();assert.equal(saved.title.length,300);assert.match(saved.title,/新的题干/);assert.equal(saved.data.formatVersion,1);assert.equal(saved.data.maxScore,5);assert.equal(f.hooks.hasChanges(),true);
  const draft=await f.hooks.exportDraft();assert.equal(Object.hasOwn(draft,'title'),false);assert.equal(draft.documents.stem.content[0].content[0].text,saved.data.stem.content[0].content[0].text);f.hooks.onDispose();assert.equal(f.editorCount(),0);
});

test('switching fields flushes one shared editor and a draft preserves advanced nodes',async t=>{
  const f=await editorFixture(t);await f.activate('stem');assert.equal(f.editorCount(),1);
  const formula={type:'doc',content:[{type:'blockMath',attrs:{latex:'x^2+1'}}]};f.current().update(formula);await f.activate('referenceAnswer');assert.equal(f.editorCount(),1);assert.ok(f.flushCount()>0);
  f.current().update(doc('新的参考答案'));const draft=await f.hooks.exportDraft();await f.hooks.importDraft(draft);assert.equal(f.editorCount(),0);
  const saved=await f.hooks.getDocument();assert.deepEqual(copy(saved.data.stem),formula);assert.equal(saved.title,'x^2+1');assert.equal(saved.data.referenceAnswer.content[0].content[0].text,'新的参考答案');f.hooks.onDispose();
});

test('image-only stems remain valid and empty stems still cannot be saved',async t=>{
  const f=await editorFixture(t);await f.activate('stem');f.current().update({type:'doc',content:[{type:'image',attrs:{assetId:'b'.repeat(64),alt:'示意图',width:300}}]});
  assert.equal((await f.hooks.getDocument()).title,'简答题');f.current().update({type:'doc',content:[{type:'paragraph'}]});await assert.rejects(f.hooks.getDocument(),/请填写题干/);f.hooks.onDispose();
});

test('practice displays only the rich stem and history remains read-only',async t=>{
  const dom=new JSDOM(read('extensions/short-answer-1.2.1/practice.html'),{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());
  const rendered=[],aiCalls=[];let hooks,editors=0,created=0;
  const content={isEmpty:value=>!validateDocument(value,{requireContent:true}),render(host,value){rendered.push({id:host.id,doc:copy(value)});host.textContent=JSON.stringify(value);return {ready:Promise.resolve(),destroy(){host.replaceChildren();}};},createEditor(){created++;editors++;return {ready:Promise.resolve(),getDocument:()=>doc('回答'),flush:async()=>{},destroy(){editors--;}};}};
  dom.window.QF={content,ui:{resize(){}},page:{register(value){hooks=value;}},ai:{getTask(){aiCalls.push('getTask');return Promise.resolve({ok:true,data:{task:null}});}},save:async()=>({ok:true})};dom.window.eval(read('extensions/short-answer-1.2.1/practice-ai.js'));
  const question=copy(examples.questions.at(-1));
  await hooks.onLoad({mode:'history',status:'submitted',question,answer:{formatVersion:1,document:doc('回答')},result:{gradingStatus:'graded',score:4,maxScore:5,correct:false,feedback:'最终得分：4 / 5 分'},capabilities:{canSave:false,canSubmit:false,canReview:false,canAiGrade:false}});
  assert.equal(dom.window.document.getElementById('question-title'),null);assert.deepEqual(rendered.find(row=>row.id==='stem').doc,question.data.stem);assert.equal(editors,0);assert.deepEqual(aiCalls,[]);assert.match(dom.window.document.getElementById('result-feedback').textContent,/最终得分/);
  const draft={mode:'practice',status:'draft',question,answer:{formatVersion:1,document:doc('回答')},result:null,capabilities:{canSave:true,canSubmit:true,canReview:false,canAiGrade:false}};
  await hooks.onLoad(draft);assert.equal(editors,1);assert.equal(created,1);await hooks.onLoad(copy(draft));assert.equal(editors,1);assert.equal(created,1,'An autosave context update must keep the same editor instance');hooks.onDispose();assert.equal(editors,0);
});
