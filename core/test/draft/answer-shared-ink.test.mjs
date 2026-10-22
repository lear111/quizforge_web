import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {mountWhiteboard} from '../../web/draft/whiteboard.js';
import {createSharedAnswerAreaService} from '../../shared/answer-area/1.3.2/component.js';
import {answerAreaModel} from '../../shared/answer-area/1.3.0/model.js';
import {strokeInRectangle} from '../../web/draft/answer-ink.js';
import {readFileSync} from 'node:fs';

function fixture(t){
 const dom=new JSDOM('<div class="question-viewport"><iframe></iframe></div>',{pretendToBeVisual:true});t.after(()=>dom.window.close());const {document}=dom.window,drawn=[];
 Object.defineProperty(dom.window,'devicePixelRatio',{value:2});dom.window.HTMLCanvasElement.prototype.getContext=()=>new Proxy({quadraticCurveTo(...args){drawn.push(args);}},{get:(o,k)=>o[k]??(()=>{})});
 const viewport=document.querySelector('div'),frame=document.querySelector('iframe');Object.defineProperty(viewport,'clientWidth',{value:900});Object.defineProperty(viewport,'clientHeight',{value:700});
 frame.getBoundingClientRect=()=>({left:0,top:0,width:760,height:900});Object.defineProperty(frame,'clientWidth',{value:760});
 const rootSize=dom.window.HTMLElement.prototype.getBoundingClientRect;dom.window.HTMLElement.prototype.getBoundingClientRect=function(){return this.classList.contains('qf-whiteboard')?{left:0,top:0,width:900,height:700}:rootSize.call(this);};
 const updates=[],whiteboard=mountWhiteboard(viewport);t.after(()=>whiteboard.destroy());whiteboard.setMode('draft');whiteboard.setViewport({x:0,y:0,zoom:1},{emit:false});
 const canvas=document.querySelector('canvas');canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:700});
 frame.qfSharedAnswerAreas=[{id:'answer',document:{type:'qf-answer-area',formatVersion:1,id:'answer',width:200,height:120,strokes:[]},rect:[100,100,200,120],writable:true,displayInk:true}];
 frame.addEventListener('qf-answer-ink',event=>{updates.push(event.detail);const area=frame.qfSharedAnswerAreas.find(area=>area.id===event.detail.id);area.document={...area.document,...event.detail,inkSource:'draft'};});
 function pointer(type,x,y){const event=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientX:x,clientY:y,button:0,pointerId:9,pointerType:'pen',pressure:.5});canvas.dispatchEvent(event);}
 function stroke(from,to){pointer('pointerdown',...from);pointer('pointermove',(from[0]+to[0])/2,(from[1]+to[1])/2);pointer('pointerup',...to);whiteboard.flush();}
 viewport.dispatchEvent(new dom.window.CustomEvent('qf-shared-answer-layout'));
 return {dom,document,viewport,frame,canvas,whiteboard,updates,drawn,stroke,pointer};
}

test('one host canvas writes across the answer boundary, crops only its range, and shares undo/redo and selection',async t=>{
 const f=fixture(t);f.stroke([50,140],[350,140]);assert.equal(f.whiteboard.getDraft().strokes.length,1);const crop=f.updates.at(-1);
 assert.equal(crop.strokes.length,1,JSON.stringify({crop,draft:f.whiteboard.getDraft()}));assert.ok(crop.strokes[0].points[0].x<0);assert.ok(crop.strokes[0].points.at(-1).x>200);assert.deepEqual(crop.anchor,{x:100,y:100,width:200,height:120});
 const count=f.updates.length;f.stroke([10,10],[30,30]);assert.equal(f.whiteboard.getDraft().strokes.length,2);assert.equal(f.updates.length,count,'outside ink does not become an answer');
 f.document.querySelector('[data-action=undo]').click();assert.equal(f.whiteboard.getDraft().strokes.length,1);f.document.querySelector('[data-action=undo]').click();assert.equal(f.updates.at(-1).strokes.length,0);
 f.document.querySelector('[data-action=redo]').click();assert.equal(f.updates.at(-1).strokes.length,1);
 f.document.querySelector('[data-tool=select-ink]').click();f.pointer('pointerdown',40,120);f.pointer('pointermove',360,160);f.pointer('pointerup',360,160);
 f.pointer('pointerdown',80,140);f.pointer('pointermove',80,340);f.pointer('pointerup',80,340);assert.equal(f.updates.at(-1).strokes.length,0,'moving a stroke outside the crop removes it from the answer');
 f.document.querySelector('[data-action=undo]').click();assert.equal(f.updates.at(-1).strokes.length,1);
 f.whiteboard.setMode('practice');await new Promise(resolve=>setTimeout(resolve,35));assert.equal(f.canvas.hidden,false);assert.ok(f.drawn.length>0,'practice uses the host smooth renderer for retained answer ink');
 assert.equal(f.document.querySelectorAll('canvas').length,1);
});

test('a crossing line is included, a diagonal missing the crop is excluded, and pressure width is respected',()=>{
 const rect={x:100,y:100,width:100,height:100},stroke=points=>({id:'s',width:3,color:'#334155',points:points.map(([x,y])=>({x,y,pressure:.5}))});
 assert.equal(strokeInRectangle(stroke([[0,150],[300,150]]),rect),true);assert.equal(strokeInRectangle(stroke([[0,0],[90,300]]),rect),false);assert.equal(strokeInRectangle(stroke([[150,150]]),rect),true);
});

test('restored answer strokes join the host once, preserve identity after reload, and ignore hidden candidate frames',t=>{
 const f=fixture(t),doc=f.frame.qfSharedAnswerAreas[0].document;
 const original={id:'kept',color:'#334155',width:3,points:[{x:20,y:30,pressure:.5}]};
 f.whiteboard.load(null);f.frame.qfSharedAnswerAreas[0].document={...doc,inkSource:'draft',anchor:{x:100,y:100,width:200,height:120},strokes:[original]};
 f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.equal(f.whiteboard.getDraft().strokes.length,1);assert.deepEqual(f.whiteboard.getDraft().strokes[0].points[0],{x:120,y:130,pressure:.5});
 const draft=f.whiteboard.getDraft();f.whiteboard.load(draft);f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.equal(f.whiteboard.getDraft().strokes.length,1);
 const wrapper=f.document.createElement('div');wrapper.className='collection-candidate';const hidden=f.document.createElement('iframe');hidden.qfSharedAnswerAreas=[{...f.frame.qfSharedAnswerAreas[0],id:'other',document:{...doc,id:'other',strokes:[{...original,id:'hidden'}]}}];hidden.getBoundingClientRect=f.frame.getBoundingClientRect;wrapper.append(hidden);f.viewport.append(wrapper);
 f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.equal(f.whiteboard.getDraft().strokes.length,1,'candidate ink must not leak into the current question');
});

test('the range component has no visible canvas or placeholder, keeps all guidance outside, and receives host ink',async t=>{
 const dom=new JSDOM('<div id="area"></div>',{pretendToBeVisual:true});t.after(()=>dom.window.close());const {document}=dom.window;dom.window.HTMLCanvasElement.prototype.getContext=()=>({measureText:()=>({width:9})});let locked=false;const saved=[],regions=[];
 const service=createSharedAnswerAreaService({document,model:answerAreaModel(),getContext:()=>({mode:'practice',capabilities:{canSave:!locked}}),resources:{get:async()=>({url:'blob:frozen'})},onChange(){},onRegions:value=>regions.push(value),onSync:async()=>{}});t.after(()=>service.destroy());
 const area=service.api.mount(document.getElementById('area'),{id:'answer',allowText:true,sharedInk:true,onChange:value=>saved.push(value)}),text=document.querySelector('textarea');
 assert.equal(document.querySelectorAll('canvas').length,0);assert.equal(text.placeholder,'');assert.equal(document.querySelector('.qf-answer-shared-surface').textContent,'');assert.equal(document.querySelector('.qf-answer-shared-instruction').textContent,'下方答题区的打字以及手写输入，都将作为答案进行评分');assert.equal(area.isEmpty(),true);
 text.value='文字';text.dispatchEvent(new dom.window.Event('input'));service.setInk({id:'answer',strokes:[{id:'host',color:'#334155',width:3,points:[{x:20,y:30,pressure:.5}]}],anchor:{x:100,y:100,width:760,height:480}});await area.flush();assert.equal(area.getDocument().text,'文字');assert.equal(area.getDocument().inkSource,'draft');assert.equal(area.getDocument().strokes.length,1);assert.equal(saved.at(-1).strokes.length,1);
 locked=true;service.refresh();service.setInk({id:'answer',strokes:[]});assert.equal(area.getDocument().strokes.length,1);assert.equal(text.readOnly,true);
});


test('growing an answer makes room for old external notes without absorbing them or shifting the existing answer',t=>{
 const f=fixture(t),row=f.frame.qfSharedAnswerAreas[0];row.autoGrow=true;
 f.stroke([120,140],[180,140]);const owned=f.whiteboard.getDraft().strokes[0];f.stroke([120,280],[180,280]);const note=f.whiteboard.getDraft().strokes[1];
 row.rect=[100,100,200,300];row.document={...row.document,height:300};f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));
 const raw=f.whiteboard.getDraft();assert.deepEqual(raw.strokes.find(item=>item.id===owned.id),owned);assert.ok(raw.strokes.find(item=>item.id===note.id).points[0].y>400);assert.deepEqual(f.updates.at(-1).strokes.map(item=>item.id),[owned.id]);
 const saved=raw;f.whiteboard.load(saved);f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.deepEqual(f.updates.at(-1).strokes.map(item=>item.id),[owned.id]);
});

test('layout changes move the later answer and its undo history together while retaining its local coordinates',t=>{
 const f=fixture(t),row=f.frame.qfSharedAnswerAreas[0];row.autoGrow=true;f.stroke([120,140],[180,140]);
 const later={...row,id:'later',document:{...row.document,id:'later',strokes:[],anchor:undefined},rect:[100,450,200,120],autoGrow:true};delete later.document.anchor;f.frame.qfSharedAnswerAreas.push(later);f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));
 f.stroke([120,480],[180,480]);const before=structuredClone(later.document.strokes),id=before[0].id;
 row.rect=[100,100,200,300];row.document={...row.document,height:300};later.rect=[100,630,200,120];f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));
 assert.deepEqual(later.document.strokes,before);assert.equal(f.whiteboard.getDraft().strokes.find(item=>item.id===id).points[0].y,660);
 f.document.querySelector('[data-action=undo]').click();assert.equal(later.document.strokes.length,0);f.document.querySelector('[data-action=redo]').click();assert.deepEqual(later.document.strokes,before);
});

test('typing holes affect only a transparent hit layer and leave the single visible ink canvas uncut',async t=>{
 const f=fixture(t);f.stroke([120,140],[180,140]);f.frame.qfInteractiveRegions=[[100,100,200,120]];f.document.querySelector('[data-tool=hand]').click();f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-interactive-regions'));await new Promise(resolve=>setTimeout(resolve,40));
 assert.equal(f.canvas.style.getPropertyValue('clip-path'),'');assert.match(f.document.querySelector('.qf-whiteboard-input').style.getPropertyValue('clip-path'),/M100 100/);assert.equal(f.canvas.hidden,false);assert.equal(f.document.querySelectorAll('canvas').length,1);
});


test('transient subpixel crop reports during a layout switch do not publish invalid anchors or erase saved ink',t=>{
 const f=fixture(t);f.stroke([120,140],[180,140]);const answer=structuredClone(f.frame.qfSharedAnswerAreas[0].document),count=f.updates.length;
 f.frame.qfSharedAnswerAreas[0].rect=[100,100,.1,.1];f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.equal(f.updates.length,count);assert.deepEqual(f.frame.qfSharedAnswerAreas[0].document,answer);
 f.frame.qfSharedAnswerAreas[0].rect=[100,100,200,120];f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.deepEqual(f.frame.qfSharedAnswerAreas[0].document,answer);
});


function attachPicture(f){const row=f.frame.qfSharedAnswerAreas[0];row.imagesEditable=true;row.document={...row.document,images:[{type:'image',id:'photo',attrs:{assetId:'b'.repeat(64)},x:20,y:20,width:100,height:60}]};return row;}

test('double taps select an image through the shared host canvas without leaving pen dots or erasing existing handwriting',async t=>{
 const f=fixture(t);attachPicture(f);const commands=[];f.frame.addEventListener('qf-answer-area-command',event=>commands.push(event.detail));
 for(let index=0;index<2;index++){f.pointer('pointerdown',150,150);f.pointer('pointerup',150,150);}await new Promise(resolve=>setTimeout(resolve,400));assert.equal(f.whiteboard.getDraft().strokes.length,0);assert.deepEqual(commands.at(-1),{action:'select-image',id:'answer',imageId:'photo'});
 f.stroke([130,150],[190,160]);const before=f.whiteboard.getDraft();f.document.querySelector('[data-tool=eraser]').click();for(let index=0;index<2;index++){f.pointer('pointerdown',150,150);f.pointer('pointerup',150,150);}await new Promise(resolve=>setTimeout(resolve,400));assert.deepEqual(f.whiteboard.getDraft(),before);
});

test('single image taps still write after disambiguation or flush, and a moved pen remains ordinary continuous ink',async t=>{
 const f=fixture(t);attachPicture(f);f.pointer('pointerdown',150,150);f.pointer('pointerup',150,150);assert.equal(f.whiteboard.getDraft().strokes.length,0);f.whiteboard.flush();assert.equal(f.whiteboard.getDraft().strokes.length,1);
 f.stroke([135,155],[195,165]);assert.equal(f.whiteboard.getDraft().strokes.length,2);assert.ok(f.whiteboard.getDraft().strokes[1].points.length>1);
});

test('selected image controls punch only one unioned input hole, and an outside tap deselects without adding ink',async t=>{
 const f=fixture(t),row=attachPicture(f),commands=[];row.selectedImageId='photo';row.imageControls=[[120,120,100,60],[120,120,100,60]];f.frame.addEventListener('qf-answer-area-command',event=>commands.push(event.detail));f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));await new Promise(resolve=>setTimeout(resolve,40));const clip=f.document.querySelector('.qf-whiteboard-input').style.getPropertyValue('clip-path');assert.equal((clip.match(/M120 120/g)||[]).length,1);
 f.pointer('pointerdown',350,250);f.pointer('pointerup',350,250);assert.equal(f.whiteboard.getDraft().strokes.length,0);assert.equal(commands.at(-1).action,'deactivate-image');
});


test('a temporary image resize cannot relocate scratch notes; cancellation keeps notes and undo unchanged, commit grows once',t=>{
 const f=fixture(t),row=attachPicture(f);row.autoGrow=true;f.stroke([120,280],[180,280]);const before=f.whiteboard.getDraft(),count=f.updates.length;
 row.imagePreview=true;row.rect=[100,100,200,300];f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.deepEqual(f.whiteboard.getDraft(),before);assert.equal(f.updates.length,count);
 row.imagePreview=false;row.rect=[100,100,200,120];f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.deepEqual(f.whiteboard.getDraft(),before);
 row.rect=[100,100,200,300];row.document={...row.document,height:300};f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));assert.ok(f.whiteboard.getDraft().strokes[0].points[0].y>400);f.document.querySelector('[data-action=undo]').click();assert.equal(f.whiteboard.getDraft().strokes.length,0);
});

test('loading another question or destroying the whiteboard cancels an unresolved image tap',async t=>{
 for(const operation of ['load','destroy']){const f=fixture(t);attachPicture(f);const commands=[];f.frame.addEventListener('qf-answer-area-command',event=>commands.push(event.detail));f.pointer('pointerdown',150,150);f.pointer('pointerup',150,150);if(operation==='load')f.whiteboard.load(null);else f.whiteboard.destroy();await new Promise(resolve=>setTimeout(resolve,400));assert.equal(f.whiteboard.getDraft().strokes.length,0);assert.equal(commands.length,0);}
});


test('short handwriting inside a photo retains its actual path rather than collapsing to a dot',t=>{
 const f=fixture(t);attachPicture(f);f.pointer('pointerdown',150,150);f.pointer('pointermove',152,151);f.pointer('pointerup',154,152);f.whiteboard.flush();const stroke=f.whiteboard.getDraft().strokes[0];assert.equal(stroke.points.length,3);assert.deepEqual(stroke.points.at(-1),{x:154,y:152,pressure:.5});
});

test('narrow practice layouts keep the host canvas so saved answer ink stays visible',()=>{
  // Practice mode paints only answer-area ink; hiding the whole whiteboard on phones made it vanish.
  const css=readFileSync(new URL('../../web/shell/refinements.css',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\.question-pane:not\(\.is-draft\)\s*\.qf-whiteboard\s*\{\s*display\s*:\s*none/);
});

test('after 重做 in draft mode, a stale answer document cannot bring removed strokes back',t=>{
 const f=fixture(t),saves=[];f.stroke([150,140],[250,140]);const removed=f.whiteboard.getDraft().strokes.map(stroke=>stroke.id);assert.equal(removed.length,1);
 const submitted=structuredClone(f.frame.qfSharedAnswerAreas[0].document);assert.equal(submitted.strokes.length,1);
 // The host reloads the board without the answer ink, while the old area still reports its submitted document.
 f.whiteboard.load({schemaVersion:1,viewport:{x:0,y:0,zoom:1},paper:{color:'#ffffff',pattern:'plain'},strokes:[]});f.whiteboard.forgetAnswerInk(removed);
 f.frame.qfSharedAnswerAreas[0].document=submitted;f.viewport.addEventListener('qf-answer-ink',()=>saves.push(1));
 f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));
 assert.deepEqual(f.whiteboard.getDraft().strokes,[],'the removed answer stroke stays removed');
 // A later normal load starts fresh: restoring a saved answer still adopts its ink.
 f.whiteboard.load(null);f.frame.qfSharedAnswerAreas[0].document=submitted;f.viewport.dispatchEvent(new f.dom.window.CustomEvent('qf-shared-answer-layout'));
 assert.equal(f.whiteboard.getDraft().strokes.length,1);
});
