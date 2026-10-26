import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createPlayerDrag} from '../../web/listening/player-drag.js';
import {dockedPosition,TOOLBAR_ANCHORS} from '../../web/draft/whiteboard-dock.js';

function fixture(t,{reduced=false}={}){
  const dom=new JSDOM('<section><button>Material</button><div class="qfa-track"></div><span class="qfl-resize"></span><ul class="qfl-menu"><button>Item</button></ul></section>',{url:'http://localhost'}),w=dom.window,element=w.document.querySelector('section');
  let clock=0,next=1,reads=0,clicks=0,rect={left:12,top:12,width:360,height:125};
  const frames=new Map(),interactions=[],docks=[],captures=new Map();
  w.matchMedia=()=>({matches:reduced});Object.defineProperty(w.performance,'now',{value:()=>clock});
  w.requestAnimationFrame=fn=>{const id=next++;frames.set(id,fn);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
  for(const node of [element,...element.querySelectorAll('*')]){
    node.setPointerCapture=id=>captures.set(id,node);node.releasePointerCapture=id=>{if(captures.get(id)===node)captures.delete(id);};
  }
  const controller=createPlayerDrag({element,area:()=>({left:100,top:50,width:800,height:600}),box:()=>{reads++;return {...rect};},
    drawBall:box=>{rect={...box};element.style.left=`${box.left}px`;element.style.top=`${box.top}px`;},
    restore:dock=>{docks.push(dock);const pos=dock?dockedPosition(dock,{width:800,height:600},{width:360,height:125}):{left:12,top:12};rect={...pos,width:360,height:125};},
    interact:value=>interactions.push(value),closeMenus(){},save(){}});
  element.querySelector('button').addEventListener('click',()=>clicks++);
  const send=(name,x,y,target=element,time=clock)=>{
    const event=new w.MouseEvent(name,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
    Object.defineProperty(event,'pointerId',{value:7});Object.defineProperty(event,'timeStamp',{value:time});target.dispatchEvent(event);return event;
  };
  const paint=(delta=16)=>{clock+=delta;const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(clock);};
  const settle=()=>{for(let i=0;i<150&&frames.size;i++)paint();assert.equal(frames.size,0);};
  t.after(()=>{controller.destroy();dom.window.close();});
  return {element,controller,send,paint,settle,frames,interactions,docks,captures,button:element.querySelector('button'),get reads(){return reads;},get clicks(){return clicks;},get rect(){return rect;}};
}

test('a press keeps button clicks, captures immediately, and a real drag never clicks the pressed control',t=>{
  const f=fixture(t);f.send('pointerdown',200,100,f.button);assert.equal(f.captures.get(7),f.button);
  f.send('pointermove',203,102,f.button);assert.equal(f.controller.dragging,false);f.send('pointerup',203,102,f.button);f.button.click();assert.equal(f.clicks,1);
  f.send('pointerdown',200,100,f.button);f.send('pointermove',230,140,f.button);assert.equal(f.controller.dragging,true);assert.equal(f.captures.get(7),f.element);
  f.send('pointerup',230,140);f.button.click();assert.equal(f.clicks,1);assert.deepEqual(f.interactions,[true,false]);
  f.settle();assert.equal(f.element.dataset.settling,undefined);assert.equal(f.element.style.transform,'');
});

test('dragging uses one transform per frame without layout reads and release uses the toolbar spring and dock',t=>{
  const f=fixture(t);f.send('pointerdown',200,100,f.button);f.send('pointermove',240,150,f.button);
  const reads=f.reads,left=f.element.style.left,top=f.element.style.top;
  assert.equal(f.element.dataset.dragging,'true');assert.equal(f.rect.width,44);assert.equal(f.element.style.transform,'');
  f.send('pointermove',300,220);f.send('pointermove',340,260);assert.equal(f.frames.size,1);assert.equal(f.reads,reads);
  f.paint(300);assert.match(f.element.style.transform,/translate3d\(140px, 160px, 0\) scale\(1, 1\)/);
  assert.equal(f.element.style.left,left);assert.equal(f.element.style.top,top);assert.equal(f.reads,reads);
  f.send('pointerup',340,260);assert.ok(TOOLBAR_ANCHORS.includes(f.docks[0].anchor));assert.equal(f.element.dataset.dragging,undefined);assert.equal(f.element.dataset.settling,'true');f.settle();
  assert.ok(f.rect.left>=0&&f.rect.top>=0&&f.rect.left+f.rect.width<=800&&f.rect.top+f.rect.height<=600);
});

test('progress, resize and menu interactions do not drag; cancellation and disposal release capture and frames',t=>{
  const f=fixture(t);
  for(const selector of ['.qfa-track','.qfl-resize','.qfl-menu button']){
    const node=f.element.querySelector(selector);f.send('pointerdown',200,100,node);f.send('pointermove',240,140,node);assert.equal(f.controller.dragging,false);assert.equal(f.captures.size,0);
  }
  f.send('pointerdown',200,100,f.button);f.send('pointermove',240,140,f.button);f.paint(300);
  f.send('pointercancel',0,0);assert.deepEqual(f.docks,[undefined]);f.settle();assert.equal(f.rect.left,12);assert.equal(f.rect.top,12);assert.equal(f.captures.size,0);
  f.send('pointerdown',200,100,f.button);f.send('pointermove',240,140,f.button);f.controller.destroy();assert.equal(f.frames.size,0);assert.equal(f.captures.size,0);assert.equal(f.interactions.at(-1),false);
});

test('reduced motion keeps pointer following but skips shrink and spring; lost root capture cancels safely',t=>{
  const f=fixture(t,{reduced:true});f.send('pointerdown',200,100,f.button);f.send('pointermove',240,150,f.button);f.paint();
  assert.equal(f.element.dataset.shrinking,undefined);assert.match(f.element.style.transform,/scale\(1, 1\)/);
  f.send('pointerup',240,150);assert.equal(f.element.dataset.settling,undefined);assert.equal(f.frames.size,0);
  f.send('pointerdown',200,100,f.button);f.send('pointermove',240,150,f.button);f.send('lostpointercapture',0,0,f.button);assert.equal(f.controller.dragging,true);
  f.send('lostpointercapture',0,0,f.element);assert.equal(f.controller.dragging,false);assert.equal(f.interactions.at(-1),false);
});
