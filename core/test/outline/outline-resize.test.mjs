import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {bindOutlineResize} from '../../web/outline/outline-resize.js';
import {bindAiChat} from '../../web/ai/ai-chat.js';
import {loadVueUi} from '../fixtures/vue-ui.mjs';

const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
function fixture(t,{saved,width=1440}={}){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'}),win=dom.window,document=win.document;
  loadVueUi(dom);
  win.innerWidth=width;
  if(saved!==undefined)win.localStorage.setItem('quizforge-outline-width',saved);
  const shell=document.querySelector('.app-shell'),outline=document.querySelector('.outline'),handle=document.querySelector('#outline-resize'),library=document.querySelector('.library');
  let left=232,notifySize;
  win.ResizeObserver=class{constructor(callback){notifySize=callback;}observe(){}disconnect(){}};
  shell.getBoundingClientRect=()=>({width:win.innerWidth});
  library.getBoundingClientRect=()=>({width:left});
  const value=()=>shell.style.getPropertyValue('--outline-width');
  outline.getBoundingClientRect=()=>({width:Number.parseFloat(value())||(shell.classList.contains('ai-chat-open')?340:228)});
  const controller=bindOutlineResize({shell,outline,handle,window:win});
  const chat=bindAiChat({document,request:()=>assert.fail('resizing must not send a chat request')});
  t.after(()=>{chat.destroy();controller.destroy();win.close();});
  function pointer(target,type,x,id=1){
    const event=new win.MouseEvent(type,{clientX:x,button:0,bubbles:true,cancelable:true});
    Object.defineProperty(event,'pointerId',{value:id});target.dispatchEvent(event);
  }
  const key=key=>handle.dispatchEvent(new win.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  return {win,document,shell,outline,library,handle,controller,chat,pointer,key,value,resizeLeft(width){left=width;notifySize();}};
}

test('dragging the left edge expands the shared pane, retains conversation and saves on release',async t=>{
  const f=fixture(t);
  f.document.querySelector('#ai-chat-input').value='保留输入';
  f.pointer(f.handle,'pointerdown',1212);f.pointer(f.win,'pointermove',1112);
  assert.equal(f.value(),'328px');assert.ok(f.document.querySelector('.outline-resize-shield'));
  assert.equal(f.win.localStorage.getItem('quizforge-outline-width'),null);
  f.pointer(f.win,'pointerup',1112);
  assert.equal(f.win.localStorage.getItem('quizforge-outline-width'),'328');
  assert.equal(f.document.querySelector('.outline-resize-shield'),null);
  f.document.querySelector('#ai-chat-tab').click();await Promise.resolve();
  assert.equal(f.value(),'328px');assert.equal(f.document.querySelector('#ai-chat-input').value,'保留输入');
  f.document.querySelector('#outline-tab').click();await Promise.resolve();assert.equal(f.value(),'328px');
});

test('limits leave room for questions and respond to the other pane and window resizing',t=>{
  const f=fixture(t,{saved:'580'});
  f.resizeLeft(480);f.win.innerWidth=1120;f.win.dispatchEvent(new f.win.Event('resize'));
  assert.equal(f.value(),'320px');assert.equal(f.handle.getAttribute('aria-valuemax'),'320');
  f.library.hidden=true;f.resizeLeft(480);assert.equal(f.value(),'580px');
  f.pointer(f.handle,'pointerdown',800);f.pointer(f.win,'pointermove',9999,2);assert.equal(f.value(),'580px');
  f.pointer(f.win,'pointermove',9999);assert.equal(f.value(),'220px');
  f.pointer(f.win,'pointermove',-9999);assert.equal(f.value(),'600px');f.pointer(f.win,'pointerup',0);
});

test('cancel, keyboard controls, default reset and storage failure do not strand a drag shield',t=>{
  const f=fixture(t,{saved:'400'});
  f.pointer(f.handle,'pointerdown',1000);f.pointer(f.win,'pointermove',900);f.pointer(f.win,'pointercancel',900);
  assert.equal(f.value(),'400px');assert.equal(f.document.querySelector('.outline-resize-shield'),null);
  f.key('ArrowLeft');assert.equal(f.value(),'416px');f.key('ArrowRight');assert.equal(f.value(),'400px');
  f.key('Home');assert.equal(f.value(),'220px');f.key('End');assert.equal(f.value(),'600px');
  f.handle.dispatchEvent(new f.win.MouseEvent('dblclick',{bubbles:true}));
  assert.equal(f.value(),'');assert.equal(f.win.localStorage.getItem('quizforge-outline-width'),null);
  Object.defineProperty(f.win,'localStorage',{get(){throw Error('blocked');}});
  f.key('ArrowLeft');assert.equal(f.value(),'244px');
  f.pointer(f.handle,'pointerdown',1000);f.controller.destroy();assert.equal(f.document.querySelector('.outline-resize-shield'),null);
});

test('mobile overlay, collapsed sidebar and fullscreen disable dragging and retain desktop preference',async t=>{
  const f=fixture(t,{saved:'400'});
  f.pointer(f.handle,'pointerdown',1000);f.pointer(f.win,'pointermove',900);
  f.win.innerWidth=390;f.win.dispatchEvent(new f.win.Event('resize'));
  assert.equal(f.handle.hidden,true);assert.equal(f.document.querySelector('.outline-resize-shield'),null);
  f.pointer(f.handle,'pointerdown',300);f.pointer(f.win,'pointermove',200);assert.equal(f.value(),'500px');
  f.win.innerWidth=1440;f.win.dispatchEvent(new f.win.Event('resize'));assert.equal(f.value(),'400px');
  f.outline.hidden=true;await Promise.resolve();assert.equal(f.handle.hidden,true);
  f.outline.hidden=false;f.shell.classList.add('draft-fullscreen');await Promise.resolve();assert.equal(f.handle.hidden,true);
  f.shell.classList.remove('draft-fullscreen');await Promise.resolve();assert.equal(f.handle.hidden,false);assert.equal(f.value(),'400px');
});
