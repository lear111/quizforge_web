import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {WhiteboardModel,emptyDraft,normalizeDraft} from '../../web/draft/whiteboard-model.js';
import {syncQuestionLayout,LEGACY_DRAFT_LAYOUT,draftHomeView,rememberDraftView,rememberDraftScroll} from '../../web/practice/question-layout.js';
import {mountWhiteboard} from '../../web/draft/whiteboard.js';
import {validateDraft} from '../../server/host/practice/whiteboard.js';

function fixture(t,{draft=null,pending=true,view='practice'}={}){
 const dom=new JSDOM('<div></div>');t.after(()=>dom.window.close());const model=new WhiteboardModel(draft),cameras=[],changes=[];
 const pane={view,draftLayoutPending:pending,world:dom.window.document.querySelector('div'),viewport:{clientWidth:1200},whiteboard:{loadGeneration:0,getDraft:()=>model.getDraft(),setViewCamera:value=>cameras.push(value),setViewport(){},initializeLayout:width=>{const changed=model.initializeLayout(width);if(changed)changes.push(model.getDraft());return changed;}}};
 return {pane,model,cameras,changes};
}
test('practice never initializes or saves a layout; first draft freezes device-independent width',t=>{
 const f=fixture(t);syncQuestionLayout(f.pane,false);assert.equal(f.changes.length,0);assert.equal(f.model.getDraft().layout,undefined);
 syncQuestionLayout(f.pane,true);assert.deepEqual(f.model.getDraft().layout,{width:760,padding:0,top:0});assert.equal(f.changes.length,1);
 f.pane.viewport.clientWidth=480;syncQuestionLayout(f.pane,true);assert.equal(f.pane.world.style.getPropertyValue('--qf-draft-width'),'760px');assert.equal(f.changes.length,1);
 syncQuestionLayout(f.pane,false);assert.equal(f.changes.length,1);assert.deepEqual(f.cameras.at(-1),{x:0,y:0,zoom:1});
});
test('legacy ink and read-only history keep their original coordinates and never write',t=>{
 const draft=emptyDraft();draft.viewport={x:30,y:50,zoom:2};draft.strokes=[{id:'old',color:'#334155',width:3,points:[{x:80,y:120,pressure:.5}]}];
 const f=fixture(t,{draft,pending:false,view:'history'});assert.deepEqual(syncQuestionLayout(f.pane,true),LEGACY_DRAFT_LAYOUT);assert.deepEqual(f.model.getDraft(),draft);assert.equal(f.changes.length,0);
 const modern={...draft,layout:{width:1440,padding:0,top:0}},g=fixture(t,{draft:modern,pending:false,view:'history'});syncQuestionLayout(g.pane,true);g.pane.viewport.clientWidth=390;syncQuestionLayout(g.pane,true);assert.deepEqual(g.model.getDraft(),modern);assert.equal(g.pane.world.style.getPropertyValue('--qf-draft-width'),'1440px');assert.equal(g.changes.length,0);
});
test('layout survives model reload and JSON transport and has matching client/server validation',()=>{
 const model=new WhiteboardModel();model.initializeLayout(1234);model.appendStroke({id:'ink',color:'#334155',width:3,points:[{x:100,y:200,pressure:.5}]});
 const draft=JSON.parse(JSON.stringify(model.getDraft()));validateDraft(draft);assert.deepEqual(normalizeDraft(draft),draft);assert.deepEqual(new WhiteboardModel(draft).getDraft(),draft);assert.equal(model.initializeLayout(390),false);
 for(const layout of [null,[],{width:99,padding:0,top:0},{width:10001,padding:0,top:0},{width:760,padding:-1,top:0},{width:760,padding:0,top:Infinity},{width:760,padding:0,top:0,extra:1}]){assert.throws(()=>normalizeDraft({...draft,layout}));assert.throws(()=>validateDraft({...draft,layout}));}
 const legacy=emptyDraft();validateDraft(legacy);assert.deepEqual(normalizeDraft(legacy),legacy);
});
test('draft initialization waits until question load is committed',t=>{
 const f=fixture(t);f.pane.loading=true;syncQuestionLayout(f.pane,true);assert.equal(f.changes.length,0);f.pane.loading=false;syncQuestionLayout(f.pane,true);assert.equal(f.changes.length,1);
});
test('layout resize reads only small metadata rather than cloning all ink',t=>{
 const f=fixture(t);f.pane.whiteboard.getLayout=()=>f.model.layout;f.pane.whiteboard.getDraft=()=>{throw new Error('Resize must not clone draft ink');};syncQuestionLayout(f.pane,false);syncQuestionLayout(f.pane,true);assert.equal(f.pane.world.style.getPropertyValue('--qf-draft-width'),'760px');
});

test('draft home view centres the logical card and fits narrow screens',()=>{
 assert.deepEqual(draftHomeView(1200,{width:760,padding:0,top:0}),{x:220,y:24,zoom:1});
 const phone=draftHomeView(390,{width:760,padding:0,top:0});assert.equal(phone.zoom,(390-24)/760);assert.ok(Math.abs((phone.x+380)*phone.zoom-195)<1e-9,'card centre stays at screen centre');assert.ok(Math.abs(phone.y*phone.zoom-24)<1e-9);
 assert.deepEqual(draftHomeView(1200,LEGACY_DRAFT_LAYOUT),{x:220,y:0,zoom:1},'legacy layouts already include their top margin');
});

// The real whiteboard and model: a first draft freezes its layout and saves
// viewport {0,0,1}. Returning to that question must not jump to the top-left.
function boardFixture(t){
 const dom=new JSDOM('<div id="viewport"><div id="world"></div></div>',{url:'http://127.0.0.1/'});t.after(()=>dom.window.close());
 const {window}=dom;window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};window.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){}});
 const viewport=window.document.querySelector('#viewport'),saved=new Map();let width=1200;
 Object.defineProperty(viewport,'clientWidth',{get:()=>width});
 const pane={view:'practice',loading:false,world:window.document.querySelector('#world'),viewport};
 pane.whiteboard=mountWhiteboard(viewport,{onChange:draft=>saved.set(pane.questionId,draft),onViewChange:camera=>rememberDraftView(pane,camera),onScroll:()=>rememberDraftScroll(pane)});
 t.after(()=>pane.whiteboard.destroy());pane.whiteboard.setMode('draft');
 const show=qid=>{pane.questionId=qid;pane.draftLayoutPending=!saved.has(qid);pane.whiteboard.load(saved.get(qid)??null);syncQuestionLayout(pane,true);
  // resizeStage applies the restored scroll once the stage has its height.
  const scroll=pane.draftScrollRestore;pane.draftScrollRestore=null;return scroll;};
 return {pane,saved,show,setWidth:value=>{width=value;}};
}
test('switching questions keeps every card at the same home view, including after the first draft saves its layout',t=>{
 const f=boardFixture(t),home={x:220,y:24,zoom:1};
 f.show('a');assert.deepEqual(f.saved.get('a').viewport,{x:0,y:0,zoom:1});assert.deepEqual(f.pane.whiteboard.getViewCamera(),home);
 f.show('b');assert.deepEqual(f.pane.whiteboard.getViewCamera(),home);
 f.show('a');assert.deepEqual(f.pane.whiteboard.getViewCamera(),home,'returning must not use the saved {0,0,1} viewport');
});
test('each question keeps its own pan, zoom and scroll for the session without saving them',t=>{
 const f=boardFixture(t);f.show('a');f.show('b');f.show('a');
 f.pane.whiteboard.setViewport({x:80,y:-40,zoom:1.5});f.pane.viewport.scrollTop=120;rememberDraftScroll(f.pane);
 assert.deepEqual(f.saved.get('a').viewport,{x:0,y:0,zoom:1},'the camera stays a per-device display choice');
 assert.equal(f.show('b'),0);assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:220,y:24,zoom:1});
 assert.equal(f.show('a'),120);assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:80,y:-40,zoom:1.5});
});
test('an untouched home view follows width changes while a moved view stays put',t=>{
 const f=boardFixture(t);f.show('a');f.setWidth(600);syncQuestionLayout(f.pane,true);
 assert.deepEqual(f.pane.whiteboard.getViewCamera(),draftHomeView(600,{width:760,padding:0,top:0}));
 f.pane.whiteboard.setViewport({x:10,y:20,zoom:1});f.setWidth(900);syncQuestionLayout(f.pane,true);
 assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:10,y:20,zoom:1});
 syncQuestionLayout(f.pane,false);syncQuestionLayout(f.pane,true);assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:10,y:20,zoom:1},'leaving and re-entering draft keeps the view');
});
test('a new question opened in draft mode moves to the home view of its newly frozen layout',t=>{
 const f=boardFixture(t);f.pane.loading=true;f.show('fresh');
 assert.deepEqual(f.pane.whiteboard.getViewCamera(),draftHomeView(1200,LEGACY_DRAFT_LAYOUT),'layout is not frozen while the question loads');
 f.pane.loading=false;syncQuestionLayout(f.pane,true);
 assert.deepEqual(f.pane.whiteboard.getViewCamera(),{x:220,y:24,zoom:1});
});
