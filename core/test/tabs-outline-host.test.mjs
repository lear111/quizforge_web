import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createEditorSession} from '../web/editor-session.js';
import {createWriteQueue,createDraftBuffer} from '../web/write-queue.js';
import {createQuestionCache} from '../web/question-cache.js';
import {unusedPagePrefixes} from '../web/extension-pages.js';
import {visibleQuestions,visibleQuestionId,hasScoreSummary,stateFor} from '../web/practice-context.js';
import {consecutiveQuestionGroups} from '../web/outline-groups.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const hostSource=part('function transitionTo(', '\nconst active=')+
  part('async function mutate(', '\nfunction renderRecovery(')+
  part('async function saveInk(', '\nconst pageRequest=')+
  part('async function allowDiscardEditor(', '\nasync function navigateQuestion(')+
  part('function disposeEditorSession(', '\nfunction writeEditorDraft(')+
  part('async function closeTab(', '\nfunction renderLibrary(')+
  part('function renderOutline(', '\nfunction updateChrome(');

function fixture(t){
  const dom=new JSDOM(readFileSync(new URL('../web/index.html',import.meta.url),'utf8'));
  t.after(()=>dom.window.close());
  const tabs=new Map(),errors=[],deletedDrafts=[],activations=[];
  const cache=createQuestionCache({schedule:null}),pages=createQuestionCache({schedule:null});
  t.after(()=>{cache.clear();pages.clear();});
  const sandbox={document:dom.window.document,$:selector=>dom.window.document.querySelector(selector),setTimeout,clearTimeout,Promise,tabs,activeKey:null,transition:Promise.resolve(),
    questionsCache:cache,pagesCache:pages,unusedPagePrefixes,visibleQuestions,visibleQuestionId,hasScoreSummary,stateFor,consecutiveQuestionGroups,
    active:()=>tabs.get(sandbox.activeKey),notice(){},failure:error=>errors.push(error),updateChrome(){},renderRecovery(){},
    editorDraftPath:(pane,id)=>`/drafts/${pane.id}/${id}`,request:async(path,options)=>{deletedDrafts.push({path,options});},
    confirm:()=>false,disposeScoreSummary(){},showScoreSummary(){},navigateQuestion(){},closeDrawers(){},
    el:(tag,className,text)=>{const node=dom.window.document.createElement(tag);node.className=className||'';if(text!=null)node.textContent=text;return node;},
    activateReady:async key=>{activations.push(key);sandbox.activeKey=key;host.renderTabs();host.renderOutline();},
  };
  vm.runInNewContext(`${hostSource}\nglobalThis.host={renderTabs,renderOutline,closeTab};`,sandbox);
  const host=sandbox.host;
  function add(id,{edit=false,changed=false,suspended=false}={}){
    const node=dom.window.document.createElement('section');dom.window.document.querySelector('#panes').append(node);
    const pane={id,key:`bank:${id}`,kind:'bank',node,closed:false,view:edit?'edit':'practice',questionId:'a',ink:createDraftBuffer(),
      collection:{title:id,questions:[{id:'a',title:'题干'}],states:{}},sizeObserver:{disconnect(){}},worldObserver:{disconnect(){}},
      whiteboard:suspended?null:{flush(){},destroy(){pane.whiteboardDestroyed=true;}},editorDraftWrites:Promise.resolve(),
      plugin:suspended?null:{flush:async()=>{},getDocument:async()=>({changed}),destroy(){pane.pluginDestroyed=true;}},
    };
    pane.writes=createWriteQueue({makeRequestId:()=>`write-${id}`,revisionFor:()=>0,send:async(_qid,body)=>{pane.savedInk=body.data;return {state:{status:'draft'}};}});
    if(edit){pane.editorSession=createEditorSession();pane.editorSession.add('a',{id:'a',plugin:pane.plugin,changed,container:null});}
    tabs.set(pane.key,pane);sandbox.activeKey??=pane.key;host.renderTabs();return pane;
  }
  async function clickClose(pane){
    dom.window.document.querySelector(`button[aria-label="关闭 ${pane.collection.title}"]`).click();
    await sandbox.transition;
  }
  return {dom,tabs,errors,deletedDrafts,activations,sandbox,host,cache,pages,add,clickClose};
}

test('closing a suspended tab removes its visible button without switching the active tab',async t=>{
  const f=fixture(t),active=f.add('active'),other=f.add('other',{suspended:true});
  f.cache.set(`${other.key}:a`,{answer:'old'});f.pages.set('choice:1.0.0:stamp',{html:'retained'});
  for(const pane of [active,other])pane.collection.extension={id:'choice',version:'1.0.0'};
  await f.clickClose(other);
  assert.equal(f.tabs.has(other.key),false);assert.equal(f.dom.window.document.querySelector('[aria-label="关闭 other"]'),null);
  assert.equal(f.sandbox.activeKey,active.key);assert.deepEqual(f.activations,[]);assert.equal(active.closed,false);assert.equal(active.node.inert,false);
  assert.equal(f.cache.get(`${other.key}:a`),null);assert.equal(f.pages.get('choice:1.0.0:stamp').html,'retained');assert.deepEqual(f.errors,[]);
  await f.host.closeTab(other.key);assert.deepEqual(f.errors,[],'A queued second close must be harmless.');
});

test('active tab close waits for answer and ink writes before selecting the remaining tab',async t=>{
  const f=fixture(t),active=f.add('active'),other=f.add('other',{suspended:true});
  let finish;
  const write=new Promise(resolve=>{finish=resolve;});
  active.plugin.flush=()=>active.writes.enqueue('a','draft',{answer:'unsaved'});
  active.writes=createWriteQueue({makeRequestId:()=> 'write',revisionFor:()=>0,send:async(_id,body)=>{if(body.action==='draft')await write;active.savedActions??=[];active.savedActions.push(body);return {state:{status:'draft'}};}});
  active.ink.replace({strokes:[{points:[[1,2]]}]});
  const closing=f.clickClose(active);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.tabs.has(active.key),true);assert.equal(active.closed,false);assert.equal(active.node.isConnected,true);
  finish();await closing;
  assert.deepEqual(active.savedActions.map(row=>row.action),['draft','whiteboard']);assert.equal(active.ink.pending,false);
  assert.equal(active.closed,true);assert.equal(active.node.isConnected,false);assert.equal(f.sandbox.activeKey,other.key);assert.deepEqual(f.errors,[]);
});

test('failed saving keeps the tab and its local input available for retry',async t=>{
  const f=fixture(t),pane=f.add('active');pane.ink.replace({strokes:[{points:[[3,4]]}]});
  pane.writes=createWriteQueue({makeRequestId:()=> 'failed',revisionFor:()=>0,send:async()=>{throw new Error('offline');}});
  await f.clickClose(pane);
  assert.equal(f.tabs.has(pane.key),true);assert.equal(pane.node.isConnected,true);assert.equal(pane.ink.pending,true);assert.equal(pane.closed,false);assert.equal(pane.node.inert,false);
  assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/offline/);
});

test('unsaved active and suspended editors require a discard decision and keep drafts when cancelled',async t=>{
  for(const suspended of [false,true]){
    const f=fixture(t),pane=f.add(`edit-${suspended}`,{edit:true,changed:true,suspended});let asked=0;
    f.sandbox.confirm=()=>{asked++;return false;};
    await f.clickClose(pane);
    assert.equal(asked,1);assert.equal(f.tabs.has(pane.key),true);assert.equal(pane.editorSession.isDirty,true);assert.equal(pane.node.inert,false);assert.deepEqual(f.deletedDrafts,[]);
    f.sandbox.confirm=()=>{asked++;return true;};await f.clickClose(pane);
    assert.equal(asked,2);assert.equal(f.tabs.has(pane.key),false);assert.equal(pane.editorSession,null);
    assert.deepEqual(f.deletedDrafts.map(row=>row.options.method),['DELETE']);assert.deepEqual(f.errors,[]);
  }
});

test('Enter and Space on the close button retain native button activation instead of activating the tab',async t=>{
  const f=fixture(t);f.add('active');const other=f.add('other',{suspended:true});
  const button=f.dom.window.document.querySelector('[aria-label="关闭 other"]');
  for(const key of ['Enter',' ']){
    const event=new f.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});button.dispatchEvent(event);
    assert.equal(event.defaultPrevented,false);await f.sandbox.transition;assert.deepEqual(f.activations,[]);
  }
  // jsdom does not synthesize a native keyboard click; dispatch the resulting click.
  button.click();await f.sandbox.transition;assert.equal(f.tabs.has(other.key),false);assert.deepEqual(f.activations,[]);
});

test('outline shows consecutive type groups and numbered states with only the summary entry',t=>{
  const f=fixture(t),pane=f.add('mixed');
  const choice={id:'choice',version:'1.0.0',name:'单选题'},text={id:'text',version:'1.0.0',name:'简答题'};
  pane.collection.questions=[{id:'a',title:'甲',type:choice},{id:'b',title:'乙',type:text},{id:'c',title:'丙',type:choice}];
  pane.collection.states={a:{status:'submitted',result:{score:1,maxScore:1,correct:true}},b:{status:'submitted',result:{gradingStatus:'pending'}},c:{status:'draft'}};
  f.host.renderOutline();const outline=f.dom.window.document.querySelector('.outline');
  assert.deepEqual([...outline.querySelectorAll('.outline-group-title')].map(node=>node.textContent),['单选题','简答题','单选题']);
  assert.deepEqual([...outline.querySelectorAll('.outline-item')].map(node=>node.textContent),['1','2','3']);
  assert.equal(outline.querySelector('[data-question-id="a"]').classList.contains('correct'),true);assert.equal(outline.querySelector('[data-question-id="b"]').classList.contains('pending-review'),true);assert.equal(outline.querySelector('[data-question-id="c"]').classList.contains('draft'),true);
  assert.equal(outline.querySelector('#outline-count'),null);assert.equal(outline.querySelector('#outline-summary'),null);assert.doesNotMatch(outline.textContent,/已提交|得分|共.*题/);assert.equal(outline.querySelector('.outline-score-summary').textContent,'分值汇总');
});
