import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {bindDevelopmentSettings} from '../web/development-settings.js';
import {bindAiSettings} from '../web/ai-settings.js';
import {extensionGroups} from '../web/extension-groups.js';
import {visibleQuestions,navigationIndex,collectionFeature,practiceSaveLabel,contextFor} from '../web/practice-context.js';
import {consecutiveQuestionGroups} from '../web/outline-groups.js';
import {createDraftBuffer} from '../web/write-queue.js';
import {createEditorSession} from '../web/editor-session.js';
import {canEditCollection} from '../web/practice-context.js';

const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('developer tab persists a local toggle and switches within the existing settings dialog',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document,calls=[];document.querySelector('#network-settings-dialog').open=true;
  const request=async(path,options)=>{calls.push([path,options]);return path.endsWith('/development')?{enabled:options?JSON.parse(options.body).enabled:false,canManage:true}:{enabled:false,canManage:true};};
  const ai=bindAiSettings({request,document}),dev=bindDevelopmentSettings({request,document});t.after(()=>{ai.destroy();dev.destroy();});
  document.querySelector('#settings-development-tab').click();await settle();assert.equal(document.querySelector('#development-settings-panel').hidden,false);assert.equal(document.querySelector('#network-settings-form').hidden,true);assert.equal(document.querySelector('#ai-settings-panel').hidden,true);
  assert.equal(document.querySelector('#development-settings-save'),null);assert.equal(document.querySelector('#development-settings-status').hidden,true);
  assert.equal(document.querySelector('#development-settings-enabled').getAttribute('aria-label'),'开发者模式');
  document.querySelector('#development-settings-enabled').checked=true;document.querySelector('#development-settings-enabled').dispatchEvent(new dom.window.Event('change'));await settle();assert.deepEqual(JSON.parse(calls.at(-1)[1].body),{enabled:true});
  document.querySelector('#settings-ai-tab').click();await settle();assert.equal(document.querySelector('#development-settings-panel').hidden,true);assert.equal(document.querySelector('#ai-settings-panel').hidden,false);assert.equal(document.querySelector('#settings-development-tab').getAttribute('aria-selected'),'false');
  document.querySelector('#settings-network-tab').click();assert.equal(document.querySelector('#network-settings-form').hidden,false);assert.equal(document.querySelector('#ai-settings-panel').hidden,true);
});

test('developer switch serializes its pending save and captures the chosen value',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;document.querySelector('#network-settings-dialog').open=true;
  let finish;const pending=new Promise(resolve=>{finish=resolve;}),writes=[],updated=[];
  const dev=bindDevelopmentSettings({document,request:async(_path,options)=>{if(!options)return {enabled:false,canManage:true};writes.push(JSON.parse(options.body));await pending;return {enabled:true,canManage:true};},onSaved:value=>updated.push(value.enabled)});t.after(()=>dev.destroy());await dev.open();
  const toggle=document.querySelector('#development-settings-enabled');toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change'));await settle();
  assert.equal(toggle.disabled,true);assert.equal(document.querySelector('#development-settings-form').getAttribute('aria-busy'),'true');
  toggle.checked=false;toggle.dispatchEvent(new dom.window.Event('change'));assert.deepEqual(writes,[{enabled:true}]);
  finish();await settle();assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);assert.deepEqual(updated,[true]);assert.equal(document.querySelector('#development-settings-status').hidden,true);
});

test('developer switch restores the confirmed setting on failures before and after persistence',async t=>{
  for(const failure of ['prepare','write','refresh']){
    const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;document.querySelector('#network-settings-dialog').open=true;
    const dev=bindDevelopmentSettings({document,beforeSave:async()=>{if(failure==='prepare')throw new Error('draft not saved');},request:async(_path,options)=>{if(!options)return {enabled:false,canManage:true};if(failure==='write')throw new Error('offline');return {enabled:true,canManage:true};},onSaved:async()=>{if(failure==='refresh')throw new Error('catalog unavailable');}});t.after(()=>dev.destroy());await dev.open();
    const toggle=document.querySelector('#development-settings-enabled');toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change'));await settle();
    assert.equal(toggle.checked,failure==='refresh');assert.equal(toggle.disabled,false);assert.equal(document.querySelector('#development-settings-error').hidden,false);assert.equal(document.querySelector('#development-settings-form').getAttribute('aria-busy'),'false');
  }
});

test('reopening the developer panel waits for its pending save before reading the current setting',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;document.querySelector('#network-settings-dialog').open=true;
  let finish,stored=false,reads=0;const pending=new Promise(resolve=>{finish=resolve;});
  const dev=bindDevelopmentSettings({document,request:async(_path,options)=>{if(options){await pending;stored=JSON.parse(options.body).enabled;}else reads++;return {enabled:stored,canManage:true};}});t.after(()=>dev.destroy());await dev.open();
  const toggle=document.querySelector('#development-settings-enabled');toggle.checked=true;toggle.dispatchEvent(new dom.window.Event('change'));await settle();
  document.querySelector('#settings-network-tab').click();const reopening=dev.open();await settle();assert.equal(reads,1);
  finish();await reopening;assert.equal(reads,2);assert.equal(toggle.checked,true);assert.equal(toggle.disabled,false);assert.equal(document.querySelector('#development-settings-status').hidden,true);
});
test('remote developer setting is visible and cannot write',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;document.querySelector('#network-settings-dialog').open=true;let calls=0;
  const dev=bindDevelopmentSettings({request:async()=>{calls++;return {enabled:true,canManage:false};},document});t.after(()=>dev.destroy());await dev.open();
  assert.equal(document.querySelector('#development-settings-enabled').checked,true);assert.equal(document.querySelector('#development-settings-enabled').disabled,true);
  document.querySelector('#development-settings-enabled').checked=false;document.querySelector('#development-settings-enabled').dispatchEvent(new dom.window.Event('change'));await settle();assert.equal(calls,1);assert.equal(document.querySelector('#development-settings-enabled').checked,true);assert.match(document.querySelector('#development-settings-status').textContent,/只能/);
});
test('missing developer endpoint explains restarting the old service and recovers after retry',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document;document.querySelector('#network-settings-dialog').open=true;let outdated=true;
  const dev=bindDevelopmentSettings({request:async()=>{if(outdated)throw Object.assign(new Error('Endpoint not found'),{code:'NOT_FOUND'});return {enabled:false,canManage:true};},document});t.after(()=>dev.destroy());
  await dev.open();
  assert.match(document.querySelector('#development-settings-status').textContent,/尚未提供开发者接口/);
  assert.match(document.querySelector('#development-settings-error').textContent,/关闭原启动窗口.*重新启动/);
  assert.equal(document.querySelector('#development-settings-error').hidden,false);
  assert.equal(document.querySelector('#development-settings-enabled').disabled,true);
  assert.equal(document.querySelector('#development-settings-form').getAttribute('aria-busy'),'false');
  outdated=false;await dev.open();
  assert.equal(document.querySelector('#development-settings-error').hidden,true);
  assert.equal(document.querySelector('#development-settings-enabled').disabled,false);
  assert.equal(document.querySelector('#development-settings-status').hidden,true);assert.equal(document.querySelector('#development-settings-enabled').checked,false);
});
test('formal and development packages remain in one extension list with distinct routing and badges',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document,opened=[];
  const sandbox={document,$:selector=>document.querySelector(selector),listMode:'extension',activeKey:null,extensionGroups,collapsedExtensionGroups:new Set(),catalog:{developmentEnabled:true,banks:[],extensions:[{id:'choice',title:'单选',questionCount:2},{id:'choice-dev',title:'单选开发',kind:'development',development:{mode:'ui'}}]},notice(){},transitionTo:fn=>fn(),openCollection:(...args)=>opened.push(args),el:(tag,classes,text)=>{const node=document.createElement(tag);node.className=classes||'';if(text!=null)node.textContent=text;return node;}};
  vm.runInNewContext(part('function renderLibrary(', '\nfunction renderOutline(')+'\nrenderLibrary();',sandbox);
  const items=[...document.querySelectorAll('.library-item')];assert.equal(items.length,2);assert.equal(document.querySelectorAll('#library-list .development-badge').length,1);assert.doesNotMatch(items[1].textContent,/UI 预览|功能调试/);items[0].click();items[1].click();assert.deepEqual(opened,[['extension','choice'],['development','choice-dev']]);
  assert.equal(document.querySelectorAll('.library-switch button').length,2,'No separate developer list group.');
});
test('disabling developer mode saves pending editor drafts before removing development pages without discarding them',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const node=dom.window.document.createElement('section');dom.window.document.body.append(node);const steps=[];
  const pane={id:'bank',key:'development-bank:bank',kind:'development-bank',development:{mode:'runtime'},view:'edit',node,editorDraftWrites:Promise.resolve(),plugin:{destroy(){steps.push('destroy');}},whiteboard:{destroy(){}},sizeObserver:{disconnect(){}},worldObserver:{disconnect(){}},developmentWatcher:{destroy(){steps.push('stop-watch');}}},collections=new Map([[pane.key,pane]]);
  const sandbox={collections,activeKey:pane.key,clearTimeout,flushPane:async()=>steps.push('flush'),persistEditorDraft:async()=>{steps.push('draft-put');pane.editorDraftWrites=Promise.resolve();},disposeEditorSession(){},disposeScoreSummary(){},questionsCache:{deleteCollection(){}},pagesCache:{deleteCollection(){}},unusedPagePrefixes:()=>[],activateReady:async key=>{assert.equal(key,null);steps.push('activate');},updateChrome(){}};
  vm.runInNewContext(part('async function prepareDevelopmentSettings(', '\nfunction watchDevelopment(')+'\nglobalThis.prepare=prepareDevelopmentSettings;',sandbox);await sandbox.prepare({enabled:false});
  assert.equal(collections.size,0);assert.equal(pane.closed,true);assert.equal(node.isConnected,false);assert.deepEqual(steps,['flush','draft-put','stop-watch','destroy','activate']);
});


test('unfinished development uses ordinary practice, editor and history branches without a publish control',()=>{
  assert.doesNotMatch(source,/mountDevelopmentPreview|showDevelopmentPage|showRuntimeDevelopmentEditor|uiDevelopment|previewDevelopmentEditor|bindDevelopmentPublish/);
  assert.doesNotMatch(part('async function navigateQuestion(', '\nasync function returnToPractice('),/development-edit|development-preview/);
  assert.match(part('async function navigateQuestion(', '\nasync function returnToPractice('),/showEditorQuestion.*showHistoryQuestion/s);
});

test('ordinary candidate-first loading retains the previous frame after a broken development registration, with a local retry',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());const document=dom.window.document,node=document.createElement('section'),frameHost=document.createElement('div');node.append(frameHost);document.body.append(node);
  const oldHost=document.createElement('div'),oldFrame=document.createElement('iframe');oldHost.append(oldFrame);frameHost.append(oldHost);let destroyed=0,broken=true,seen;
  const extension={id:'dev.demo',version:'0.0.0',development:{folder:'demo'}},collection={title:'开发样例',extension,questions:[{id:'old'},{id:'q'}],states:{}};
  const pane={key:'development:demo',kind:'development',id:'demo',node,frameHost,collection,development:{folder:'demo'},questionId:'old',payload:{question:{id:'old',data:{}},state:{status:'unanswered'}},plugin:{frame:oldFrame,destroy(){destroyed++;oldHost.remove();}},viewport:{scrollTop:0,scrollLeft:0,clientWidth:1000},whiteboard:{load(){},setMode(){},setReadOnly(){}},ink:createDraftBuffer(),tools:{},draftMode:false};
  const payload={question:{id:'q',title:'样例',data:{}},state:{status:'unanswered',revision:0},stamp:{contentVersion:'same',packageVersion:'changed'}};
  const sandbox={collectionFeature,practiceSaveLabel,contextFor,structuredClone,setTimeout,clearTimeout,performance,document,confirm:()=>true,active:()=>pane,loadQuestion:async()=>payload,questionExtension:()=>extension,collectionHasExtension:()=>true,extensionPageRoute:()=>({key:'page',path:'/page'}),pagesCache:{load:async()=>({html:'bad'}),clear(){}},questionsCache:{delete(){}},questionCacheKey:()=>'',request:async()=>({}),prepareAssets:async value=>value,pageRequest(){},setEditorLayout(){},disposeEditorSession(){},disposeScoreSummary(){},syncPracticeCamera(){},renderOutline(){},updateChrome(){},saveStatus(){},transitionTo:fn=>fn(),mountExtension:(container,_assets,context)=>{seen=context;const frame=document.createElement('iframe');container.append(frame);return {frame,ready:broken?Promise.reject(new Error('registration failed')):Promise.resolve(),destroy(){frame.remove();}};},el:(tag,classes,text)=>{const element=document.createElement(tag);element.className=classes||'';if(text!=null)element.textContent=text;return element;}};
  vm.runInNewContext(part('async function showQuestion(', '\nfunction syncPracticeCamera(')+'\nglobalThis.show=showQuestion;',sandbox);
  await assert.rejects(sandbox.show(pane,'q'),/registration failed/);assert.equal(destroyed,0);assert.equal(frameHost.firstElementChild,oldHost);assert.equal(pane.questionId,'old');assert.equal(pane.loading,false);assert.equal(node.querySelector('[role=alert]').textContent.includes('registration failed'),true);
  broken=false;await sandbox.show(pane,'q');assert.equal(destroyed,1);assert.equal(pane.questionId,'q');assert.equal(node.querySelector('[role=alert]'),null);assert.equal(seen.mode,'example');assert.equal(seen.capabilities.canWhiteboard,true);assert.equal(seen.capabilities.canHistory,true);
});

test('development CSS hot refresh uses normal collection and mounts without changing selected question or saved answer',async t=>{
  const dom=new JSDOM(html);t.after(()=>dom.window.close());let options,shown;
  const pane={id:'demo',kind:'development',key:'development:demo',view:'practice',questionId:'q',viewport:{scrollTop:37},collection:{questions:[{id:'q'}]},development:{folder:'demo'}};
  const descriptor={title:'示例',revision:'new',development:{folder:'demo'}},collection={title:'示例',questions:[{id:'q'}],states:{q:{answer:{text:'saved'},status:'unanswered'}}},catalog={banks:[],extensions:[{id:'demo',kind:'development',mode:'ui'}]};
  const sandbox={catalog,request:async path=>path.includes('/collections/')?collection:descriptor,collectionPath:()=>'/api/collections/development/demo',createDevelopmentWatcher:value=>{options=value;return {setActive(){}};},active:()=>pane,transitionTo:fn=>fn(),flushPane:async()=>true,saveStatus(){},questionsCache:{deleteCollection(){}},loadQuestion:async()=>({question:{id:'q'},state:collection.states.q}),showQuestion:async(target,id,value)=>{shown=value;target.collection=value.collection;},updateChrome(){},renderLibrary(){}};
  vm.runInNewContext(part('const developmentPath=', '\nasync function openCollection(')+'\nglobalThis.watch=watchDevelopment;',sandbox);
  sandbox.watch(pane,{revision:'old'});await options.reload('new',()=>true);assert.equal(shown.preserveFrame,true);assert.equal(shown.payload.state.answer.text,'saved');assert.equal(pane.questionId,'q');assert.equal(pane.viewport.scrollTop,37);assert.equal(catalog.extensions[0].mode,undefined);
  shown=null;pane.view='edit';await options.reload('again',()=>true);assert.equal(shown,null);assert.equal(pane.needsRefresh,true);
  pane.view='practice';pane.plugin={hasUnsavedInput:true};sandbox.flushPane=async()=>false;await options.reload('again',()=>true);assert.equal(shown,null,'Untracked form input must not be overwritten by hot refresh.');
});

test('unsaved development question frames pause, restore exact inputs and reject a fifth retention without losing input',t=>{
  const dom=new JSDOM('<section><div></div></section>');t.after(()=>dom.window.close());const document=dom.window.document,node=document.querySelector('section'),frameHost=node.firstElementChild,activity=[];
  const pane={node,frameHost,viewport:{scrollTop:8},tools:{},draftMode:false,ink:createDraftBuffer(),whiteboard:{getDraft:()=>({strokes:[]}),load(){},setMode(){}},collection:{states:{}}};
  const sandbox={createDraftBuffer,clearPageFailure(){},syncPracticeCamera(){},renderOutline(){},updateChrome(){}};
  vm.runInNewContext(part('function parkDevelopmentQuestion(', '\nfunction syncPracticeCamera(')+'\nglobalThis.host={parkDevelopmentQuestion,restoreDevelopmentQuestion,disposeRetainedQuestions};',sandbox);
  const install=id=>{const host=document.createElement('div'),frame=document.createElement('iframe');host.append(frame);frameHost.append(host);pane.questionId=id;pane.payload={question:{id},answer:'saved'};pane.plugin={frame,setActive:value=>activity.push([id,value]),destroy(){host.remove();}};};
  for(let i=0;i<4;i++){install(String(i));sandbox.host.parkDevelopmentQuestion(pane);}install('fifth');const fifth=pane.plugin;assert.throws(()=>sandbox.host.parkDevelopmentQuestion(pane),/4 张/);assert.equal(pane.plugin,fifth);assert.equal(pane.retainedQuestions.size,4);
  assert.equal(sandbox.host.restoreDevelopmentQuestion(pane,'0'),true);assert.equal(pane.payload.question.id,'0');assert.equal(pane.retainedQuestions.size,3);assert.deepEqual(activity[0],['0',false]);assert.deepEqual(activity.at(-1),['0',true]);
  sandbox.host.disposeRetainedQuestions(pane);assert.equal(pane.retainedQuestions.size,0);assert.equal(frameHost.children.length,1);
});

test('failed development flush can suspend without destroying the original input or blocking another collection',async t=>{
  const dom=new JSDOM('<section></section>');t.after(()=>dom.window.close());const pane={node:dom.window.document.querySelector('section'),development:{folder:'demo'},viewport:{scrollTop:5},plugin:{destroy(){throw new Error('Input must be retained');}},whiteboard:{destroy(){throw new Error('Draft must be retained');}},view:'practice'};
  const sandbox={clearTimeout,flushPane:async()=>false};vm.runInNewContext(part('async function suspendPane(', '\nasync function activateReady(')+'\nglobalThis.suspend=suspendPane;',sandbox);await sandbox.suspend(pane);assert.equal(pane.keepRuntime,true);assert.equal(pane.node.inert,true);assert.equal(pane.savedScrollTop,5);
});


test('broken development editor registration keeps the current practice frame and mode',async t=>{
  const dom=new JSDOM('<section><div></div></section>');t.after(()=>dom.window.close());const document=dom.window.document,node=document.querySelector('section'),frameHost=node.firstElementChild,old=document.createElement('iframe');frameHost.append(old);let failures=0;
  const oldPlugin={frame:old,flush:async()=>{},destroy(){throw new Error('Current practice input must remain');}},pane={kind:'development',id:'demo',development:{folder:'demo'},node,frameHost,plugin:oldPlugin,view:'practice',questionId:'q',collection:{questions:[{id:'q'}]},viewport:{scrollTop:0},whiteboard:{},tools:{}};
  const sandbox={canEditCollection,collectionFeature,document,active:()=>pane,request:async path=>path.endsWith('/editor')?{editor:{html:'broken'},question:{id:'q'},contentVersion:'q'}:{draft:null},questionPath:()=>'/q',editorDraftPath:()=>'/draft',prepareAssets:async value=>value,newEditorSession:()=>createEditorSession(),updateChrome(){},pageRequest(){},setEditorLayout(){},scheduleEditorDraft(){},showPageFailure(){failures++;},el:(tag,classes)=>{const node=document.createElement(tag);node.className=classes;return node;},mountExtension:container=>{const frame=document.createElement('iframe');container.append(frame);return {frame,ready:Promise.reject(new Error('editor registration failed')),destroy(){frame.remove();}};}};
  vm.runInNewContext(part('async function showEditorQuestion(', '\nasync function openEditor(')+'\nglobalThis.show=showEditorQuestion;',sandbox);
  await assert.rejects(sandbox.show(pane,'q'),/editor registration failed/);assert.equal(pane.plugin,oldPlugin);assert.equal(pane.view,'practice');assert.equal(pane.questionId,'q');assert.equal(pane.loading,false);assert.equal(frameHost.children.length,1);assert.equal(frameHost.firstElementChild,old);assert.equal(failures,1);
});
