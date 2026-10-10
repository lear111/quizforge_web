import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createDraftBuffer,createWriteQueue} from '../web/write-queue.js';
import {createEditorSession} from '../web/editor-session.js';
import {collectionFeature,practiceSaveLabel} from '../web/practice-context.js';
import {extensionGroups} from '../web/extension-groups.js';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const hostSource=part('function transitionTo(', '\nconst active=')+
  part('async function mutate(', '\nfunction renderRecovery(')+
  part('async function saveInk(', '\nconst pageRequest=')+
  part('async function openCollection(', '\nfunction renderOutline(')+
  part('function syncSidebars(', '\nasync function refreshCatalog(')+
  part('async function refreshCatalog(', "\n$('#refresh')")+
  part("for(const key of ['library','outline']){for(const suffix", '\nfor(const media');

function fixture(t,{drawer=false,developmentEnabled=false}={}){
  const dom=new JSDOM(html,{url:'http://localhost/'});t.after(()=>dom.window.close());
  const document=dom.window.document,collections=new Map(),errors=[],saved=[];
  const descriptors=new Map();
  const sandbox={document,$:selector=>document.querySelector(selector),collections,activeKey:null,listMode:'bank',transition:Promise.resolve(),
    catalog:{banks:[],extensions:[],developmentEnabled},collapsedExtensionGroups:new Set(),extensionGroups,createDraftBuffer,collectionFeature,practiceSaveLabel,
    sidebarPreferences:{library:true,outline:true},libraryDrawer:{matches:drawer},outlineDrawer:{matches:drawer},localStorage:dom.window.localStorage,
    active:()=>collections.get(sandbox.activeKey),notice(){},failure:error=>errors.push(error),renderOutline(){},renderRecovery(){},saveStatus(){},
    updateChrome(){document.querySelector('#document-title').textContent=sandbox.active()?.collection.title||'选择一本题库';},
    draftFullscreen:{getState:()=>({active:false})},syncPracticeCamera(){},watchDevelopment(){},
    ResizeObserver:class {observe(){}disconnect(){}},clearTimeout,setTimeout,
    mountWhiteboard:()=>({setFullscreenState(){},flush(){},destroy(){this.destroyed=true;}}),
    el:(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;},
    collectionPath:(kind,id)=>`${kind}:${id}`,request:async path=>structuredClone(descriptors.get(path)),
    loadQuestion:async(pane,id)=>({question:{id},state:{status:'unanswered'},stamp:{}}),sameQuestionStamp:()=>true,
    makeWriteQueue:pane=>createWriteQueue({makeRequestId:()=>`write-${pane.id}`,revisionFor:()=>0,send:async(id,body)=>{saved.push({id,...body});return {state:{status:'draft'}};}}),
    showQuestion:async(pane,id,{collection=pane.collection,payload}={})=>{
      pane.collection=collection;pane.questionId=id;pane.payload=payload||{state:{status:'unanswered'}};pane.loading=false;
      pane.plugin={flush:async()=>{},setActive(){},destroy(){this.destroyed=true;}};
    },
  };
  vm.runInNewContext(`${hostSource}\nglobalThis.host={openCollection,suspendPane,activateReady,renderLibrary,syncSidebars,refreshCatalog};`,sandbox);
  function add(id,kind='bank'){
    const row={id,title:id,questions:[{id:'first',title:'甲'},{id:'second',title:'乙'}],states:{}};
    descriptors.set(`${kind}:${id}`,row);sandbox.catalog[kind==='bank'?'banks':'extensions'].push({id,title:id,questionCount:2});
    return row;
  }
  async function click(id){
    document.querySelector(`[data-item-id="${id}"]`).click();await sandbox.transition;
  }
  return {dom,document,collections,errors,saved,descriptors,sandbox,host:sandbox.host,add,click};
}

test('the title row keeps both sidebar controls and the collection tab bar is gone',t=>{
  const f=fixture(t);f.host.syncSidebars();
  assert.equal(f.document.querySelector('#tabs,.tab-header,.tab-close'),null);
  for(const key of ['library','outline']){
    const toggle=f.document.querySelector(`#${key}-toggle`),sidebar=f.document.querySelector(`.${key}`);
    assert.equal(toggle.closest('.document-header')!=null,true);
    toggle.click();assert.equal(sidebar.hidden,true);assert.equal(sidebar.inert,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.match(toggle.getAttribute('aria-label'),/显示/);assert.equal(toggle.isConnected,true);
    toggle.click();assert.equal(sidebar.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
  }
});

test('normal mode exposes only banks and developer mode enables the full extension list',async t=>{
  const f=fixture(t);f.add('bank');f.add('formal-sample','extension');await f.host.openCollection('bank','bank');
  const toggle=f.document.querySelector('.library-switch');
  assert.equal(toggle.hidden,true);assert.equal(f.document.querySelector('#catalog-count'),null);
  assert.doesNotMatch(f.document.querySelector('#welcome p').textContent,/拓展/);
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  assert.equal(f.sandbox.listMode,'bank');assert.equal(f.sandbox.activeKey,'bank:bank');
  const request=f.sandbox.request;
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:true}:path==='/api/catalog'?f.sandbox.catalog:request(path);
  await f.host.refreshCatalog();assert.equal(toggle.hidden,false);
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  assert.equal(f.sandbox.activeKey,'extension:formal-sample');assert.equal(f.document.querySelector('#library-label').textContent,'题型拓展');
  assert.equal(f.document.querySelector('#catalog-count'),null);
});

test('turning developer mode off returns to the previous bank and preserves a sample editor draft',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('bank');f.add('sample','extension');await f.host.openCollection('bank','bank');
  f.collections.get('bank:bank').questionId='second';
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  const pane=f.collections.get('extension:sample'),draft={stem:'样例的未保存修改'},persisted=[];
  pane.view='edit';pane.plugin.exportDraft=async()=>({supported:true,changed:true,draft});
  pane.editorSession=createEditorSession({persistDraft:async(id,entry,snapshot)=>persisted.push(snapshot.draft)});
  pane.editorSession.add('first',{id:'first',plugin:pane.plugin,changed:true,value:{contentVersion:'v1'}});
  const request=f.sandbox.request;
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:false}:path==='/api/catalog'?f.sandbox.catalog:request(path);
  await f.host.refreshCatalog();
  assert.equal(f.document.querySelector('.library-switch').hidden,true);assert.equal(f.sandbox.listMode,'bank');
  assert.equal(f.sandbox.activeKey,'bank:bank');assert.equal(f.collections.get('bank:bank').questionId,'second');
  assert.deepEqual(persisted,[draft]);assert.equal(pane.editorSession.isDirty,true);assert.deepEqual(f.errors,[]);
});

test('turning developer mode off without any banks shows the welcome page and keeps the sample session',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('sample','extension');f.sandbox.listMode='extension';await f.host.openCollection('extension','sample');
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:false}:f.sandbox.catalog;
  await f.host.refreshCatalog();
  assert.equal(f.sandbox.activeKey,null);assert.equal(f.document.querySelector('#welcome').hidden,false);assert.equal(f.document.querySelector('.library-switch').hidden,true);
  assert.equal(f.collections.has('extension:sample'),true);assert.equal(f.collections.get('extension:sample').node.hidden,true);assert.deepEqual(f.errors,[]);
});

test('the relocated controls open mobile drawers and retain their hide buttons and scrim',t=>{
  const f=fixture(t,{drawer:true});f.host.syncSidebars();
  f.document.querySelector('#library-toggle').click();
  assert.equal(f.document.querySelector('.library').classList.contains('open'),true);assert.equal(f.document.querySelector('#scrim').hidden,false);
  f.document.querySelector('#outline-toggle').click();
  assert.equal(f.document.querySelector('.library').classList.contains('open'),false);assert.equal(f.document.querySelector('.outline').classList.contains('open'),true);
  f.document.querySelector('#outline-hide').click();assert.equal(f.document.querySelector('#scrim').hidden,true);
});

test('sidebar switching saves answers and ink, releases the inactive runtime and restores its question',async t=>{
  const f=fixture(t);f.add('one');f.add('two');await f.host.openCollection('bank','one');
  const pane=f.collections.get('bank:one'),plugin=pane.plugin,whiteboard=pane.whiteboard;
  let answerPending=true;
  pane.questionId='second';pane.plugin.flush=async()=>{if(answerPending){await pane.writes.enqueue('second','draft',{answer:'B'});answerPending=false;}};
  pane.ink.replace({strokes:[{points:[[1,2]]}]});
  await f.click('two');
  assert.deepEqual(f.saved.map(value=>value.action),['draft','whiteboard']);
  assert.equal(plugin.destroyed,true);assert.equal(whiteboard.destroyed,true);assert.equal(pane.node.hidden,true);assert.equal(pane.ink.pending,false);
  await f.click('one');assert.equal(f.sandbox.activeKey,'bank:one');assert.equal(pane.questionId,'second');
  assert.equal(pane.node.hidden,false);assert.equal(f.document.querySelector('#document-title').textContent,'one');assert.deepEqual(f.errors,[]);
});

test('unsaved editor drafts survive switching away and returning from the file list',async t=>{
  const f=fixture(t);f.add('edit');f.add('other');await f.host.openCollection('bank','edit');
  const pane=f.collections.get('bank:edit'),draft={stem:'修改中的题干'},persisted=[];
  pane.view='edit';pane.plugin.exportDraft=async()=>({supported:true,changed:true,draft});
  pane.editorSession=createEditorSession({persistDraft:async(id,entry,snapshot)=>persisted.push({id,draft:snapshot.draft})});
  pane.editorSession.add('first',{id:'first',plugin:pane.plugin,changed:true,value:{contentVersion:'v1'}});
  f.sandbox.showEditorQuestion=async(target,id)=>{assert.equal(target,pane);assert.equal(id,'first');target.plugin={flush:async()=>{}};};
  await f.click('other');assert.deepEqual(persisted,[{id:'first',draft}]);assert.equal(pane.editorSession.isDirty,true);
  await f.click('edit');assert.equal(pane.view,'edit');assert.equal(pane.editorSession.isDirty,true);assert.deepEqual(f.errors,[]);
});

test('save failures keep the current question and input available instead of switching collections',async t=>{
  const f=fixture(t);f.add('one');f.add('two');await f.host.openCollection('bank','one');
  const pane=f.collections.get('bank:one');pane.ink.replace({strokes:[{points:[[3,4]]}]});
  pane.writes=createWriteQueue({makeRequestId:()=> 'failed',revisionFor:()=>0,send:async()=>{throw new Error('offline');}});
  await f.click('two');assert.equal(f.sandbox.activeKey,'bank:one');assert.equal(pane.ink.pending,true);assert.equal(pane.node.inert,false);
  assert.equal(pane.plugin.destroyed,undefined);assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/offline/);
});

test('switching collections restores the selected question from the same readonly history record',async t=>{
  const f=fixture(t);f.add('history');f.add('other');await f.host.openCollection('bank','history');
  const pane=f.collections.get('bank:history'),entry={id:'round-1',collectionTitle:'冻结题库',questions:[]};
  pane.view='history';pane.historyEntry=entry;pane.historyView={};pane.historyQuestionId='second';
  const request=f.sandbox.request;
  f.sandbox.historyPath=()=>'/history';
  f.sandbox.request=async path=>path==='/history/round-1'?entry:request(path);
  f.sandbox.createHistoryView=value=>{assert.equal(value,entry);return {frozen:true};};
  f.sandbox.showHistoryQuestion=async(target,id)=>{assert.equal(target,pane);assert.equal(id,'second');target.plugin={};};
  await f.click('other');assert.equal(pane.pausedHistoryId,'round-1');assert.equal(pane.historyView,null);
  await f.click('history');assert.equal(pane.view,'history');assert.equal(pane.historyEntry,entry);assert.equal(pane.historyQuestionId,'second');
  assert.equal(pane.historyView.frozen,true);assert.deepEqual(f.errors,[]);
});

test('direct collection browsing has no former eight-tab limit and the extension list still switches',async t=>{
  const f=fixture(t,{developmentEnabled:true});for(let i=0;i<9;i++)f.add(`bank-${i}`);f.add('sample','extension');
  await f.host.openCollection('bank','bank-0');
  for(let i=1;i<9;i++)await f.click(`bank-${i}`);
  assert.equal(f.collections.size,9);assert.equal(f.document.querySelectorAll('.question-pane:not([hidden])').length,1);
  await f.click('bank-0');
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  assert.equal(f.sandbox.activeKey,'extension:sample');assert.equal(f.document.querySelector('#document-title').textContent,'sample');
  f.document.querySelector('#show-banks').click();await f.sandbox.transition;
  assert.equal(f.sandbox.activeKey,'bank:bank-0');assert.deepEqual(f.errors,[]);
});
