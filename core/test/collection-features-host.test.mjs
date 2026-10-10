import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createEditorSession} from '../web/editor-session.js';
import {createExtensionRouter} from '../web/extension-requests.js';
import {collectionFeature,canEditCollection,practiceSaveLabel,visibleQuestions,navigationIndex,hasScoreSummary,canViewDraft,draftViewActive} from '../web/practice-context.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const helpers={collectionFeature,canEditCollection,practiceSaveLabel,canViewDraft,draftViewActive};

test('collection features default to enabled for ordinary banks and formal/runtime examples including unfinished development samples',t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;
  const pane={kind:'extension',view:'practice',payload:{},questionId:'q',collection:{title:'样例',questions:[{id:'q'}]}};
  const sandbox={...helpers,document,$:selector=>document.querySelector(selector),active:()=>pane,draftFullscreen:{sync(){}},visibleQuestions,navigationIndex,hasScoreSummary,saveStatus(){},developmentTitle:()=> '开发',el:(tag,classes,text)=>{const node=document.createElement(tag);node.className=classes;if(text!=null)node.textContent=text;return node;}};
  vm.runInNewContext(part('function updateChrome(', '\nfunction syncSidebars(')+'\nglobalThis.update=updateChrome;',sandbox);
  for(const kind of ['bank','extension','development-bank','development']){pane.kind=kind;pane.development=kind.startsWith('development')?{mode:'runtime'}:null;sandbox.update();for(const id of ['edit-open','draft-toggle','history-open'])assert.equal(document.querySelector('#'+id).hidden,false,`${kind} ${id}`);assert.equal(document.querySelector('#development-edit').hidden,true);}
  pane.collection.features={editing:false,whiteboard:false,history:false};sandbox.update();for(const id of ['edit-open','draft-toggle','history-open'])assert.equal(document.querySelector('#'+id).hidden,true);
  pane.collection.features={};pane.view='summary';pane.summaryShown=true;pane.scoreSummary={finished:true};sandbox.update();assert.equal(document.querySelector('#history-open').hidden,true);pane.scoreSummary.historyId='round';sandbox.update();assert.equal(document.querySelector('#history-open').hidden,false);
  pane.kind='development';pane.development={folder:'demo'};pane.view='practice';pane.payload={};pane.summaryShown=false;sandbox.update();assert.equal(document.querySelector('#edit-open').hidden,false);assert.equal(document.querySelector('#development-edit').hidden,true);assert.equal(document.querySelector('#development-publish-open').hidden,true);pane.collection.features.editing=false;sandbox.update();assert.equal(document.querySelector('#edit-open').hidden,true);
});

test('transient samples restore local unfinished editor drafts and save real question changes without editor-draft storage',async t=>{
  const dom=new JSDOM('<body></body>');t.after(()=>dom.window.close());const document=dom.window.document,node=document.createElement('section'),frameHost=document.createElement('div');node.append(frameHost);document.body.append(node);
  const collection={title:'样例题库',features:{editing:true,whiteboard:true,history:false},questions:[{id:'a'},{id:'b'}],states:{}},pane={id:'essay',kind:'extension',node,frameHost,view:'practice',questionId:'a',collection,viewport:{scrollTop:0},whiteboard:{setMode(){}},tools:{},plugin:null};
  const calls=[],forms=[],messages=[];let persisted=0;
  const sandbox={...helpers,document,structuredClone,clearTimeout,setTimeout,active:()=>pane,pendingWrites:0,request:async(path,options)=>{
    calls.push({path,options});if(path.includes('editor-drafts'))throw new Error('Transient editors must not reach persistent draft storage');
    const id=path.split('/').at(-2);
    if(path.endsWith('/editor'))return {question:{id,title:id,data:{text:id}},editor:{html:'editor'},revision:0,contentVersion:id};
    if(path.endsWith('/edit')){persisted++;return {collection,payload:{state:{revision:1},stamp:{contentVersion:id}}};}
    if(path==='/collection')return collection;
    throw new Error(`Unexpected request ${path}`);
  },questionPath:(_kind,_id,qid)=>`/questions/${qid}`,collectionPath:()=>'/collection',editorDraftPath:(_pane,qid)=>`/editor-drafts/${qid}`,makeRequestId:()=> 'request',prepareAssets:async value=>value,createEditorSession,questionsCache:{deleteCollection(){},set(){}},questionCacheKey:(_pane,id)=>id,loadQuestion:async(_pane,id)=>({question:{id},state:{status:'unanswered'}}),showQuestion:async(target,_id,options)=>{target.collection=options.collection;target.view='practice';},refreshCatalog:async()=>{},notice:value=>messages.push(value),pageRequest(){},setEditorLayout(){},syncPracticeCamera(){},renderOutline(){},updateChrome(){},saveStatus(){},el:(tag,classes)=>{const child=document.createElement(tag);child.className=classes;return child;},mountExtension:(container,_assets,context,options)=>{
    const frame=document.createElement('iframe');container.append(frame);const form={draft:options.editorDraft||{text:context.question.data.text},changed:false};forms.push(form);
    return {frame,ready:Promise.resolve(),flush:async()=>{},exportDraft:async()=>({supported:true,changed:form.changed,draft:form.draft}),getDocument:async()=>({changed:form.changed,document:{title:context.question.title,data:{text:form.draft.text}}}),update(){},destroy(){frame.remove();}};
  }};
  vm.runInNewContext(part('function writeEditorDraft(', '\nconst developmentPath=')+'\nglobalThis.host={showEditorQuestion,saveEditor};',sandbox);
  await sandbox.host.showEditorQuestion(pane,'a');forms[0].draft.text='unfinished a';forms[0].changed=true;await sandbox.host.showEditorQuestion(pane,'b');await sandbox.host.showEditorQuestion(pane,'a');assert.equal(forms.at(-1).draft.text,'unfinished a');forms.at(-1).changed=true;
  await sandbox.host.saveEditor(pane);assert.equal(persisted,1);assert.equal(calls.some(call=>call.path.includes('editor-drafts')),false);assert.equal(pane.view,'practice');assert.match(messages.at(-1),/已保存 1 道题目的修改/);assert.doesNotMatch(messages.at(-1),/旧历史/);
});

test('resource uploads are transient only in history-disabled practice, while question editing uploads stay permanent',async()=>{
  const calls=[],pane={kind:'extension',id:'sample',view:'practice',collection:{features:{history:false}}};
  const sandbox={...helpers,createExtensionRouter,request:async(path,options)=>{calls.push({path,options});return {};},readResource:async()=>({}),sdkCache:{},mutate(){},transitionTo(){},requestAi(){}};
  vm.runInNewContext(part('const pageRequest=', '\nfunction requestAi(')+'\nglobalThis.route=pageRequest;',sandbox);
  await sandbox.route(pane,'resource-put',{data:'image'});assert.equal(calls.at(-1).options.headers['X-QuizForge-Transient-Resource'],'true');
  pane.view='edit';await sandbox.route(pane,'resource-put',{data:'question-image'});assert.equal(calls.at(-1).options.headers['X-QuizForge-Transient-Resource'],undefined);
  pane.view='practice';pane.collection.features.history=true;await sandbox.route(pane,'resource-put',{data:'answer-image'});assert.equal(calls.at(-1).options.headers['X-QuizForge-Transient-Resource'],undefined);
});

test('disabled whiteboard refuses host ink writes while practice labels and scoped example draft paths stay accurate',async()=>{
  let sends=0;const pane={view:'practice',id:'essay',kind:'extension',collection:{features:{whiteboard:false,history:false}},ink:{clear(){}},writes:{enqueue(){sends++;}}};
  const sandbox={...helpers,clearTimeout,request(){throw new Error('No history calls');},encodeURIComponent,active:()=>pane};
  vm.runInNewContext(part('const editorDraftPath=', '\nasync function prepareAssets(')+part('async function mutate(', '\nfunction renderRecovery(')+part('async function openHistoryList(', '\nasync function showHistory(')+'\nglobalThis.host={mutate,openHistoryList,editorDraftPath};',sandbox);
  await assert.rejects(sandbox.host.mutate(pane,'whiteboard',{draft:{}}),error=>error.code==='FEATURE_DISABLED');assert.equal(sends,0);await sandbox.host.openHistoryList(pane);assert.equal(practiceSaveLabel(pane),'当前会话');
  assert.equal(sandbox.host.editorDraftPath(pane,'q'),'/api/editor-drafts/essay/q?kind=extension');pane.kind='development';assert.equal(sandbox.host.editorDraftPath(pane,'q'),'/api/development/editor-drafts/essay/q?kind=development');pane.kind='bank';assert.equal(sandbox.host.editorDraftPath(pane,'q'),'/api/editor-drafts/essay/q');
});
