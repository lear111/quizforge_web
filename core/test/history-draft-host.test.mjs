import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {mountWhiteboard} from '../web/whiteboard.js';
import {emptyDraft} from '../web/whiteboard-model.js';
import {practiceViewport} from '../web/view-camera.js';
import {createHistoryView,historyProgress} from '../web/history-view.js';
import * as context from '../web/practice-context.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const hostSource=part('async function toggleDraftMode(', '\nfunction setEditorLayout(')+
  part('function resizeStage(', '\nasync function allowDiscardEditor(')+
  part('async function showHistory(', '\nfunction disposeEditorSession(')+
  part('function updateChrome(', '\nfunction syncSidebars(');

function frozen(value){for(const child of Object.values(value||{}))if(child&&typeof child==='object')frozen(child);return Object.freeze(value);}
function fixture(t){
  const dom=new JSDOM(html),{document}=dom.window;t.after(()=>dom.window.close());
  dom.window.requestAnimationFrame=()=>1;dom.window.cancelAnimationFrame=()=>{};
  dom.window.ResizeObserver=class{observe(){}disconnect(){}};
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({});
  const node=document.createElement('section'),viewport=document.createElement('div'),tools=document.createElement('div'),stage=document.createElement('div'),world=document.createElement('div'),frameHost=document.createElement('div');
  node.append(tools,viewport);viewport.append(stage);stage.append(world);world.append(frameHost);document.querySelector('#panes').append(node);
  let width=1000;
  Object.defineProperties(viewport,{clientWidth:{get:()=>width},clientHeight:{value:600}});
  Object.defineProperty(world,'offsetHeight',{value:500});
  const extension={id:'choice',version:'1.0.0'},page={extension,apiVersion:{major:1,minor:0},html:'frozen page'};
  const questions=['a','b'].map((id,i)=>{
    const draft=emptyDraft();draft.viewport={x:30+i*10,y:50+i*20,zoom:1+i*.5};draft.paper={color:'#fff3ce',pattern:i?'dots':'grid'};
    draft.strokes.push({id:`ink-${id}`,color:'#334155',width:3,points:[{x:40,y:50,pressure:.5}]});
    return {page,payload:{extension,question:{id,title:id,data:{}},draft,state:{status:'submitted',answer:{value:id},result:{score:1,maxScore:1}}}};
  });
  const record=frozen({id:'round',collectionTitle:'历史题库',createdAt:'2026-10-10T00:00:00Z',status:'completed',submittedCount:2,questionCount:2,summary:{},collection:{questions:[{id:'a'},{id:'b'}]},questions});
  const changes=[],mounts=[],calls=[];
  const pane={view:'history',kind:'bank',collection:{title:'当前题库',questions:[{id:'live'}],states:{}},historyEntry:record,historyView:createHistoryView(record),node,viewport,tools,stage,world,frameHost,loading:false,draftMode:true,historyDraftMode:false,questionId:'live',payload:null};
  pane.whiteboard=mountWhiteboard(viewport,{toolbarContainer:tools,onChange:value=>changes.push(value),onViewChange:camera=>sandbox.host.resizeStage(pane,camera)});t.after(()=>pane.whiteboard.destroy());
  const sandbox={...context,document,structuredClone,practiceViewport,createHistoryView,historyProgress,phoneLayout:{matches:false},active:()=>pane,$:selector=>document.querySelector(selector),draftFullscreen:{sync(){}},historyTime:()=> '时间',developmentTitle:()=> '',prepareAssets:async value=>structuredClone(value),disposeEditorSession(){},disposeScoreSummary(target){target.summaryShown=false;target.node.classList.remove('is-summary');},allowDiscardEditor:async()=>true,allowLeaveDevelopmentInput:()=>true,flushPane:async()=>{calls.push('flush');},historyPath:()=>'/history',request:async()=>{calls.push('request');return record;},renderOutline(){},saveStatus(){},setEditorLayout(){},pageRequest(){},notice(){},el:(tag,classes,text)=>{const element=document.createElement(tag);element.className=classes;if(text!=null)element.textContent=text;return element;},mountExtension:(container,_page,ctx)=>{
    const frame=document.createElement('iframe');Object.defineProperty(frame,'offsetHeight',{value:400});container.append(frame);mounts.push(ctx);return {frame,ready:Promise.resolve(),destroy(){frame.remove();}};
  }};
  vm.runInNewContext(hostSource+'\nglobalThis.host={toggleDraftMode,showHistory,showHistoryQuestion,updateChrome,syncPracticeCamera,resizeStage};',sandbox);
  return {...sandbox.host,pane,record,document,changes,mounts,calls,phone:sandbox.phoneLayout,setWidth:value=>{width=value;}};
}

test('history switches to the saved draft and back without writes, iframe reloads or changing the practice mode',async t=>{
  const f=fixture(t);await f.showHistoryQuestion(f.pane,'a');
  const button=f.document.querySelector('#draft-toggle'),draft=f.record.questions[0].payload.draft;
  assert.equal(button.hidden,false);assert.match(button.textContent,/草稿/);assert.equal(button.getAttribute('aria-pressed'),'false');
  assert.notDeepEqual(f.pane.whiteboard.getViewCamera(),draft.viewport);
  await f.toggleDraftMode();
  assert.equal(f.pane.node.classList.contains('is-draft'),true);assert.equal(f.pane.tools.hidden,false);
  assert.deepEqual(f.pane.whiteboard.getViewCamera(),draft.viewport);
  assert.equal(button.getAttribute('aria-pressed'),'true');assert.match(button.textContent,/返回练习/);
  f.pane.whiteboard.setViewport({x:30,y:80,zoom:2});assert.equal(f.pane.stage.style.height,'1160px');
  for(const capability of Object.values(f.mounts[0].capabilities))assert.equal(capability,false);
  await f.toggleDraftMode();
  assert.equal(f.pane.node.classList.contains('is-draft'),false);assert.equal(f.pane.tools.hidden,true);
  assert.equal(f.pane.draftMode,true);assert.equal(f.mounts.length,1);assert.deepEqual(f.calls,[]);assert.deepEqual(f.changes,[]);
  assert.deepEqual(f.pane.whiteboard.getDraft(),draft);
});

test('history retains draft mode across question navigation and restores each camera even on phones',async t=>{
  const f=fixture(t);f.phone.matches=true;f.setWidth(390);
  await f.showHistoryQuestion(f.pane,'a');assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:0,y:0,zoom:1});
  await f.toggleDraftMode();await f.showHistoryQuestion(f.pane,'b');
  assert.equal(f.pane.historyDraftMode,true);assert.equal(f.pane.node.classList.contains('is-draft'),true);
  assert.deepEqual(f.pane.whiteboard.getViewCamera(),f.record.questions[1].payload.draft.viewport);
  f.pane.summaryShown=true;f.updateChrome();assert.equal(f.document.querySelector('#draft-toggle').hidden,true);
  await f.showHistoryQuestion(f.pane,'a');assert.equal(f.pane.summaryShown,false);assert.equal(f.document.querySelector('#draft-toggle').hidden,false);
  assert.deepEqual(f.pane.whiteboard.getViewCamera(),f.record.questions[0].payload.draft.viewport);
  assert.deepEqual(f.changes,[]);assert.deepEqual(f.calls,[]);
});

test('history uses frozen whiteboard permissions and a new record starts in practice layout',async t=>{
  const f=fixture(t);f.pane.collection.features={whiteboard:false};
  await f.showHistoryQuestion(f.pane,'a');assert.equal(f.document.querySelector('#draft-toggle').hidden,false,'Live settings cannot remove a saved whiteboard.');
  await f.toggleDraftMode();assert.equal(f.pane.historyDraftMode,true);
  await f.showHistory(f.pane,'round');assert.equal(f.pane.historyDraftMode,false);assert.equal(f.pane.node.classList.contains('is-draft'),false);
  f.pane.historyEntry={...f.record,collection:{...f.record.collection,features:{whiteboard:false}}};f.updateChrome();
  assert.equal(f.document.querySelector('#draft-toggle').hidden,true);await f.toggleDraftMode();assert.equal(f.pane.historyDraftMode,false);
});
