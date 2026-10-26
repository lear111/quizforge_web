import {createLibraryIndexClient} from '../../web/library/library-index-client.js';
import {createCollectionLoading} from '../../web/practice/collection-loading.js';
import {previewDraftAnswer,confirmAnswerPreview,answerStateForSave} from '../../web/practice/answer-preview.js';
import {renderLibraryView} from '../../web/library/library-view.js';
import {takeImportedBank} from '../../web/library/native-import.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createDraftBuffer,createWriteQueue} from '../../web/shared/write-queue.js';
import {createEditorSession} from '../../web/editor/editor-session.js';
import {checkEditorExit} from '../../web/editor/editor-navigation.js';
import {collectionFeature,practiceSaveLabel} from '../../web/practice/practice-context.js';
import {extensionGroups} from '../../web/library/extension-groups.js';

const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const hostSource=part('function transitionTo(', '\nconst active=')+
  part('async function mutate(', '\nfunction renderRecovery(')+
  part('async function saveInk(', '\nconst pageRequest=')+
  part('async function openCollection(', '\nfunction renderOutline(')+
  part('function syncSidebars(', '\nasync function refreshCatalog(')+
  part('async function refreshCatalog(', "\n$('#refresh')")+
  part("for(const key of ['library','outline'])$(`#${key}-toggle`)", '\nfor(const media');

function fixture(t,{drawer=false,developmentEnabled=false}={}){
  const dom=new JSDOM(html,{url:'http://localhost/'});t.after(()=>dom.window.close());
  const document=dom.window.document,collections=new Map(),errors=[],saved=[];
  const descriptors=new Map();
  const sandbox={allowDiscardEditor:checkEditorExit,disposeEditorSession(pane){pane.editorSession?.destroy();pane.editorSession=null;pane.plugin=null;},createLibraryIndexClient,takeImportedBank:catalog=>takeImportedBank(catalog,dom.window.location,dom.window.history),collectionLoading:createCollectionLoading(document),renderLibraryView,document,$:selector=>document.querySelector(selector),collections,activeKey:null,pendingLibraryKey:null,listMode:'bank',transition:Promise.resolve(),
    catalog:{banks:[],extensions:[],developmentEnabled},collapsedExtensionGroups:new Set(),extensionGroups,createDraftBuffer,collectionFeature,practiceSaveLabel,previewDraftAnswer,confirmAnswerPreview,
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
  vm.runInNewContext(`${hostSource}\n${part('async function start(){','\nstart().catch')}\nglobalThis.host={start,openCollection,suspendPane,activateReady,renderLibrary,syncSidebars,refreshCatalog};`,sandbox);
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

test('startup indexes banks without loading a question until the user selects a bank',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('bank');let release,started,collectionReads=0;
  const loading=new Promise(resolve=>{started=resolve;});const blocked=new Promise(resolve=>{release=resolve;});const request=f.sandbox.request;
  f.sandbox.request=async(path,options)=>{
    if(path==='/api/library/index')return {...f.sandbox.catalog,banks:[{id:'bank',title:'bank',kind:'bank',validationStatus:'pending'}]};
    if(path==='/api/settings/development')return {enabled:false};
    if(path==='bank:bank'){collectionReads++;assert.equal(options.timeoutMs,60000);started();await blocked;}
    return request(path);
  };
  t.after(()=>f.host.refreshCatalog.client?.stop());
  await f.host.start();assert.equal(collectionReads,0);assert.equal(f.collections.size,0);assert.equal(f.sandbox.activeKey,null);
  assert.equal(f.document.querySelector('#welcome').hidden,false);assert.equal(f.document.querySelector('#collection-loading').hidden,true);
  const selected=f.click('bank');await loading;assert.doesNotMatch(f.document.querySelector('[data-item-id="bank"]').textContent,/待校验/);assert.equal(f.collections.size,0);
  assert.equal(f.document.querySelector('#collection-loading').hidden,false);
  assert.equal(f.document.querySelector('.library-item.active')?.dataset.itemId,'bank');
  release();await selected;assert.equal(f.sandbox.activeKey,'bank:bank');assert.equal(f.document.querySelector('#collection-loading').hidden,true);
});

test('startup opens the installed import hint instead of the first bank and consumes it',async t=>{
  const f=fixture(t);f.add('first');f.add('imported');
  f.dom.window.history.replaceState(null,'','/?keep=yes&imported-bank=imported#view');
  const request=f.sandbox.request;
  f.sandbox.request=async(path,options)=>{
    if(path==='/api/library/index')return {...f.sandbox.catalog,canManage:true};
    if(path==='/api/settings/development')return {enabled:false};
    return request(path,options);
  };
  t.after(()=>f.host.refreshCatalog.client?.stop());
  await f.host.start();
  assert.equal(f.sandbox.activeKey,'bank:imported');
  assert.equal(f.collections.has('bank:first'),false);
  assert.equal(f.dom.window.location.search,'?keep=yes');
  assert.equal(f.dom.window.location.hash,'#view');
  assert.deepEqual(f.errors,[]);
});

test('returning to a suspended bank reads its question and overview concurrently',async t=>{
  const f=fixture(t);f.add('first');f.add('second');
  await f.host.openCollection('bank','first');await f.host.openCollection('bank','second');
  let releaseQuestion,releaseOverview;
  const question=new Promise(resolve=>{releaseQuestion=resolve;}),overview=new Promise(resolve=>{releaseOverview=resolve;});
  const seen=[],request=f.sandbox.request;
  f.sandbox.loadQuestion=async()=>{seen.push('question');return question;};
  f.sandbox.request=async path=>{if(path==='bank:first'){seen.push('overview');return overview;}return request(path);};
  const restoring=f.host.openCollection('bank','first');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen,['question','overview']);
  releaseQuestion({question:{id:'first'},state:{status:'draft'},stamp:{}});
  releaseOverview({...f.descriptors.get('bank:first'),states:{first:{status:'draft'}}});
  await restoring;
  assert.equal(f.sandbox.activeKey,'bank:first');assert.equal(f.collections.get('bank:first').payload.state.status,'draft');
});

test('collection loading stays visible until the first question is ready and retains the old frame',async t=>{
  const f=fixture(t);f.add('current');f.add('new');await f.host.openCollection('bank','current');
  const current=f.collections.get('bank:current'),oldFrame=current.plugin,show=f.sandbox.showQuestion;
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),loading=new Promise(resolve=>{started=resolve;});
  f.sandbox.showQuestion=async(...args)=>{started();await gate;return show(...args);};
  const opening=f.host.openCollection('bank','new');await loading;
  const status=f.document.querySelector('#collection-loading');assert.equal(status.hidden,false);assert.match(status.textContent,/正在加载首题/);
  assert.equal(f.sandbox.activeKey,'bank:current');assert.equal(current.plugin,oldFrame);assert.equal(oldFrame.destroyed,undefined);assert.equal(current.node.inert,true);
  assert.equal(f.document.querySelector('.library-item.active')?.dataset.itemId,'new');
  try{release();await opening;}finally{release();}
  assert.equal(status.hidden,true);assert.equal(f.document.querySelector('#panes').hasAttribute('aria-busy'),false);
  assert.equal(f.sandbox.activeKey,'bank:new');assert.equal(oldFrame.destroyed,true);assert.equal(f.collections.get('bank:new').node.inert,false);
  assert.equal(f.document.querySelector('.library-item.active')?.dataset.itemId,'new');
});

test('a failed first question clears loading and keeps the current answer frame usable',async t=>{
  const f=fixture(t);f.add('current');f.add('bad');await f.host.openCollection('bank','current');
  const current=f.collections.get('bank:current'),oldFrame=current.plugin;
  f.sandbox.showQuestion=async()=>{throw new Error('First question failed');};
  await assert.rejects(f.host.openCollection('bank','bad'),/First question failed/);
  assert.equal(f.document.querySelector('#collection-loading').hidden,true);assert.equal(f.collections.size,1);
  assert.equal(f.document.querySelector('.collection-candidate'),null);assert.equal(f.sandbox.activeKey,'bank:current');
  assert.equal(current.plugin,oldFrame);assert.equal(oldFrame.destroyed,undefined);assert.equal(current.node.inert,false);
  assert.equal(f.document.querySelector('.library-item.active')?.dataset.itemId,'current');
});

test('opening a development bank starts both metadata reads before either finishes',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('current');await f.host.openCollection('bank','current');
  const current=f.collections.get('bank:current'),calls=[];
  let releaseDescriptor,releaseCollection;
  const descriptor=new Promise(resolve=>{releaseDescriptor=resolve;}),collection=new Promise(resolve=>{releaseCollection=resolve;});
  f.sandbox.developmentPath=()=>'/development/new';
  f.sandbox.request=async(path,options)=>{calls.push(path);assert.equal(options.timeoutMs,60000);return path==='/development/new'?descriptor:collection;};
  const opening=f.host.openCollection('development-bank','new');
  try{
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(calls,['/development/new','development-bank:new']);
    assert.equal(f.sandbox.activeKey,'bank:current');assert.equal(current.plugin.destroyed,undefined);
    releaseDescriptor({development:{mode:'runtime'},revision:'r1'});await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.collections.size,1,'Both reads must finish before creating a new pane');
    releaseCollection({id:'new',title:'New bank',questions:[{id:'first'}],states:{}});
    await opening;assert.equal(f.sandbox.activeKey,'development-bank:new');
    assert.equal(f.collections.get('development-bank:new').developmentDescriptor.revision,'r1');
  }finally{
    releaseDescriptor({development:{mode:'runtime'},revision:'r1'});
    releaseCollection({id:'new',title:'New bank',questions:[{id:'first'}],states:{}});await opening;
  }
});

test('a failed parallel metadata read keeps the current question and observes both rejections',async t=>{
  for(const failed of ['/development/new','development-bank:new']){
    const f=fixture(t,{developmentEnabled:true});f.add('current');await f.host.openCollection('bank','current');
    const current=f.collections.get('bank:current'),rejects=new Map(),calls=[];
    f.sandbox.developmentPath=()=>'/development/new';
    f.sandbox.request=path=>{calls.push(path);return new Promise((_resolve,reject)=>rejects.set(path,reject));};
    const opening=f.host.openCollection('development-bank','new');
    const rejected=assert.rejects(opening,/read failed/);
    await new Promise(resolve=>setImmediate(resolve));
    try{
      assert.deepEqual(calls,['/development/new','development-bank:new']);
      rejects.get(failed)(new Error('read failed'));await rejected;
      assert.equal(f.sandbox.activeKey,'bank:current');assert.equal(f.collections.size,1);assert.equal(current.plugin.destroyed,undefined);
    }finally{
      for(const reject of rejects.values())reject(new Error('read failed'));await rejected;
    }
  }
});

test('the title row keeps both sidebar controls and the collection tab bar is gone',t=>{
  const f=fixture(t);f.host.syncSidebars();
  assert.equal(f.document.querySelector('#tabs,.tab-header,.tab-close,#library-hide,#outline-hide'),null);
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
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:true}:path==='/api/library/index'?{...f.sandbox.catalog,developmentEnabled:true}:request(path);
  await f.host.refreshCatalog();assert.equal(toggle.hidden,false);
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  assert.equal(f.sandbox.activeKey,'extension:formal-sample');assert.equal(f.document.querySelector('#library-label').textContent,'题型拓展');
  assert.equal(f.document.querySelector('#catalog-count'),null);
});

test('turning developer mode off can close a clean sample editor and returns to the previous bank',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('bank');f.add('sample','extension');await f.host.openCollection('bank','bank');
  f.collections.get('bank:bank').questionId='second';
  f.document.querySelector('#show-extensions').click();await f.sandbox.transition;
  const pane=f.collections.get('extension:sample');pane.view='edit';pane.plugin.isDirty=false;pane.plugin.getDocument=async()=>({changed:false});
  pane.editorSession=createEditorSession();pane.editorSession.add('first',{id:'first',plugin:pane.plugin,value:{contentVersion:'v1'}});
  const request=f.sandbox.request;
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:false}:path==='/api/library/index'?{...f.sandbox.catalog,developmentEnabled:false}:request(path);
  await f.host.refreshCatalog();
  assert.equal(f.document.querySelector('.library-switch').hidden,true);assert.equal(f.sandbox.listMode,'bank');
  assert.equal(f.sandbox.activeKey,'bank:bank');assert.equal(f.collections.get('bank:bank').questionId,'second');
  assert.equal(pane.editorSession,null);assert.equal(pane.view,'practice');assert.deepEqual(f.errors,[]);
});

test('turning developer mode off without any banks shows the welcome page and keeps the sample session',async t=>{
  const f=fixture(t,{developmentEnabled:true});f.add('sample','extension');f.sandbox.listMode='extension';await f.host.openCollection('extension','sample');
  f.sandbox.request=async path=>path==='/api/settings/development'?{enabled:false}:{...f.sandbox.catalog,developmentEnabled:false};
  await f.host.refreshCatalog();
  assert.equal(f.sandbox.activeKey,null);assert.equal(f.document.querySelector('#welcome').hidden,false);assert.equal(f.document.querySelector('.library-switch').hidden,true);
  assert.equal(f.collections.has('extension:sample'),true);assert.equal(f.collections.get('extension:sample').node.hidden,true);assert.deepEqual(f.errors,[]);
});

test('the title controls open and close mobile drawers with the scrim',t=>{
  const f=fixture(t,{drawer:true});f.host.syncSidebars();
  f.document.querySelector('#library-toggle').click();
  assert.equal(f.document.querySelector('.library').classList.contains('open'),true);assert.equal(f.document.querySelector('#scrim').hidden,false);
  f.document.querySelector('#outline-toggle').click();
  assert.equal(f.document.querySelector('.library').classList.contains('open'),false);assert.equal(f.document.querySelector('.outline').classList.contains('open'),true);
  f.document.querySelector('#outline-toggle').click();assert.equal(f.document.querySelector('#scrim').hidden,true);
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

test('unsaved current edit blocks switching banks from the file list without making draft requests',async t=>{
  const f=fixture(t);f.add('edit');f.add('other');await f.host.openCollection('bank','edit');
  const pane=f.collections.get('bank:edit');pane.view='edit';pane.plugin.isDirty=true;pane.plugin.getDocument=async()=>({changed:true});
  pane.editorSession=createEditorSession();pane.editorSession.add('first',{plugin:pane.plugin,value:{}});
  f.sandbox.showEditorQuestion=async(target,id)=>{assert.equal(target,pane);assert.equal(id,'first');target.plugin={flush:async()=>{}};};
  await f.click('other');assert.equal(f.errors.at(-1)?.code,'UNSAVED_EDITOR_CHANGES');
  assert.equal(f.sandbox.activeKey,'bank:edit');assert.equal(pane.view,'edit');assert.equal(pane.editorSession.isDirty,true);assert.equal(f.collections.has('bank:other'),false);assert.equal(pane.node.inert,false);
});

test('a clean current editor exits when switching to an already opened bank',async t=>{
  const f=fixture(t);f.add('edit');f.add('other');await f.host.openCollection('bank','other');await f.host.openCollection('bank','edit');
  const pane=f.collections.get('bank:edit');pane.view='edit';pane.plugin.isDirty=false;pane.plugin.getDocument=async()=>({changed:false});pane.editorSession=createEditorSession();pane.editorSession.add('first',{plugin:pane.plugin,value:{}});
  await f.click('other');assert.equal(f.sandbox.activeKey,'bank:other');assert.equal(pane.view,'practice');assert.equal(pane.editorSession,null);assert.deepEqual(f.errors,[]);
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
