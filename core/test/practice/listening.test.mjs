import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {createListeningPlayer} from '../../web/listening/listening-player.js';
import {fitWidth,clampPosition} from '../../web/listening/geometry.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,requestOverride){
  const dom=new JSDOM('<main><section class="question-pane"><div class="question-viewport"></div></section></main>',{url:'http://localhost',runScripts:'outside-only'}),w=dom.window,document=w.document;
  w.matchMedia=()=>({matches:false});w.ResizeObserver=class{observe(){}disconnect(){}};
  Object.defineProperty(w.HTMLElement.prototype,'offsetHeight',{get(){return 240;}});Object.defineProperty(w.HTMLElement.prototype,'offsetWidth',{get(){return parseFloat(this.style.width)||300;}});
  const handlers=new Map(),audio=new w.EventTarget(),calls=[],urls=new Set(),requests=[];let playing=false,time=0,src='',rate=1;
  const emit=name=>{for(const fn of handlers.get(name)||[])fn();};
  const player={audio,getCurrentTime:()=>time,getDuration:()=>60,isPlaying:()=>playing,getState:()=>playing?'playing':'paused',pause(){if(playing){playing=false;emit('pause');}},play(){playing=true;emit('play');},toggle(){if(playing)this.pause();else this.play();return Promise.resolve();},setSource(value){src=value;calls.push(value);time=0;if(value)queueMicrotask(()=>audio.dispatchEvent(new w.Event('loadedmetadata')));},seekTo(value){time=value;},setSpeed(value){rate=value;emit('ratechange');},getSpeed:()=>rate,on(name,fn){handlers.set(name,[...handlers.get(name)||[],fn]);},destroy(){this.pause();},get source(){return src;}};
  const request=(path,options)=>{requests.push({path,options});return requestOverride?requestOverride(path,options):Promise.resolve(new Blob(['ID3-demo'],{type:'audio/mpeg'}));};
  const view=createListeningPlayer({document,request,URL:{createObjectURL(){const url='blob:fixture/'+calls.length;urls.add(url);return url;},revokeObjectURL:url=>urls.delete(url)},createPlayer(host){host.innerHTML='<div class="qfa"><div class="qfa-transport"><button class="qfa-toggle"></button><div class="qfa-track" tabindex="0"></div><span class="qfa-time"></span><button class="qfa-back"></button><button class="qfa-forward"></button></div></div>';return player;}});
  const pane={key:'bank:one',kind:'bank',id:'one',view:'practice',questionId:'q1',node:document.querySelector('section'),viewport:document.querySelector('.question-viewport'),collection:{listening:{materials:[{id:'a',title:'A',revision:'1'},{id:'b',title:'B',revision:'2'},{id:'exam',title:'Whole exam',revision:'3'}],examMaterialId:'exam'},questions:[{id:'q1',listening:{materialId:'a'}},{id:'q2',listening:{materialId:'a'}},{id:'q3'},{id:'q4',listening:{materialId:'b'}}]}};
  Object.defineProperty(pane.viewport,'clientWidth',{value:800});Object.defineProperty(pane.viewport,'clientHeight',{value:600});
  t.after(()=>{view.destroy();dom.window.close();});return {view,pane,player,calls,requests,urls,w,root:()=>document.querySelector('.qf-listening'),setTime:value=>{time=value;}};
}
test('one shared source continues across listening questions, pauses on ordinary questions, and is independent of answer writes',async t=>{
  const f=fixture(t);f.view.setContext(null);f.view.setContext(null);f.view.setContext(f.pane);await tick();f.player.play();f.setTime(19);const source=f.player.source;
  f.pane.questionId='q2';f.view.setContext(f.pane);await tick();assert.equal(f.player.source,source);assert.equal(f.player.getCurrentTime(),19);assert.equal(f.player.isPlaying(),true);assert.equal(f.requests.length,1);
  f.pane.questionId='q3';f.view.setContext(f.pane);assert.equal(f.root().hidden,true);assert.equal(f.player.isPlaying(),false);
  f.pane.questionId='q1';f.view.setContext(f.pane);assert.equal(f.player.getCurrentTime(),19);assert.equal(f.root().hidden,false);assert.ok(f.requests.every(row=>!row.options.method));
  f.view.destroy();assert.equal(f.urls.size,0);assert.equal(f.player.isPlaying(),false);
});
test('exam audio remains playing in a compact window on ordinary questions and stops after hand-in',async t=>{
  const f=fixture(t);f.pane.kind='exam';f.pane.key='exam:one';f.pane.exam={status:'in-progress'};f.view.setContext(f.pane);await tick();assert.match(f.requests[0].path,/listening\/exam$/);f.player.play();f.setTime(24);const src=f.player.source;
  f.pane.questionId='q3';f.view.setContext(f.pane);assert.equal(f.player.source,src);assert.equal(f.player.getCurrentTime(),24);assert.equal(f.player.isPlaying(),true);assert.equal(f.root().hidden,false);assert.equal(f.root().dataset.compact,'true');
  f.root().querySelector('.qfl-expand').click();assert.equal(f.root().dataset.compact,'false');
  f.pane.exam.status='completed';f.view.setContext(f.pane);assert.equal(f.player.isPlaying(),false);assert.equal(f.root().hidden,true);
});
test('late audio responses from an abandoned bank cannot play or replace the active source',async t=>{
  let resolveFirst;let n=0;const f=fixture(t,()=>++n===1?new Promise(resolve=>{resolveFirst=resolve;}):Promise.resolve(new Blob(['new'],{type:'audio/mpeg'})));
  f.view.setContext(f.pane);const second={...f.pane,key:'bank:two',id:'two'};f.view.setContext(second);await tick();const src=f.player.source;resolveFirst(new Blob(['old'],{type:'audio/mpeg'}));await tick();assert.equal(f.player.source,src);assert.equal(f.urls.size,1);
});
test('audio read failures provide retry, and editor/history views pause and hide playback',async t=>{
  let n=0;const f=fixture(t,()=>++n===1?Promise.reject(new Error('offline')):Promise.resolve(new Blob(['audio'],{type:'audio/mpeg'})));
  f.view.setContext(f.pane);await tick();assert.equal(f.root().querySelector('.qfl-retry').hidden,false);f.root().querySelector('.qfl-retry').click();await tick();assert.equal(f.root().querySelector('.qfl-retry').hidden,true);f.player.play();
  for(const view of ['edit','history']){f.pane.view=view;f.view.setContext(f.pane);assert.equal(f.root().hidden,true);assert.equal(f.player.isPlaying(),false);}
});
test('the reused player actually pauses borrowed audio during disposal',t=>{
  const dom=new JSDOM('<div></div><audio></audio>',{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.eval(fs.readFileSync(new URL('../../web/listening/audio-player.js',import.meta.url),'utf8'));const audio=w.document.querySelector('audio');let pauses=0;audio.pause=()=>pauses++;const player=w.QFAudioPlayer.create(w.document.querySelector('div'),{audio});player.destroy();assert.equal(pauses,1);
});
test('width changes without scaling height and movement stays within the preview',()=>{
  const area={width:390,height:600},size={...fitWidth(1000,area),height:130};assert.equal(size.width,374);
  assert.equal(fitWidth(1,{width:1000}).width,300);assert.equal(fitWidth(9999,{width:1000}).width,560);assert.equal(fitWidth(NaN,{width:1000}).width,360);
  assert.equal(fitWidth(360,{width:250}).width,234);
  const p=clampPosition({x:1000,y:-1000},size,area);assert.ok(p.x>=8&&p.y>=8&&p.x+size.width<=area.width-8&&p.y+size.height<=area.height-8);
});
test('exam exposes the same material, seek and speed controls and keeps a manual selection across cards',async t=>{
  const f=fixture(t);f.pane.kind='exam';f.pane.key='exam:one';f.pane.exam={status:'in-progress'};f.view.setContext(f.pane);await tick();
  assert.equal(f.root().querySelector('.qfa-track').tabIndex,0);
  f.root().querySelector('.qfl-speed-button').click();assert.equal(f.root().querySelector('.qfl-speed-menu').hidden,false);
  f.root().querySelector('[data-rate="1.5"]').click();assert.equal(f.player.getSpeed(),1.5);
  f.root().querySelector('.qfl-material').click();assert.equal(f.root().querySelector('.qfl-material-menu').hidden,false);
  f.root().querySelector('[data-material-id="b"]').click();await tick();assert.match(f.requests.at(-1).path,/listening\/b$/);
  f.setTime(17);f.player.play();f.pane.questionId='q2';f.view.setContext(f.pane);await tick();assert.equal(f.player.getCurrentTime(),17);assert.match(f.requests.at(-1).path,/listening\/b$/);
});
test('width keyboard controls, capsule restore, safe titles and menu close work together',async t=>{
  const f=fixture(t);f.pane.collection.listening.materials[0].title='<img src=x onerror=alert(1)>';f.view.setContext(f.pane);await tick();
  assert.equal(f.root().querySelector('.qfl-title').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.root().querySelector('img'),null);
  const handle=f.root().querySelector('.qfl-resize');handle.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));assert.equal(f.root().style.width,'560px');
  f.root().querySelector('.qfl-material').click();f.root().dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(f.root().querySelector('.qfl-material-menu').hidden,true);
  f.root().querySelector('.qfl-collapse').click();assert.equal(f.root().dataset.compact,'true');f.root().querySelector('.qfl-expand').click();assert.equal(f.root().style.width,'560px');
  handle.dispatchEvent(new f.w.MouseEvent('dblclick',{bubbles:true}));assert.equal(f.root().style.width,'360px');assert.equal(f.root().querySelector('.qfl-content').style.transform,'');
});
test('listening styles preserve the host pane positioning for all collections',t=>{
  const shell=fs.readFileSync(new URL('../../web/shell/app.css',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../../web/listening/listening.css',import.meta.url),'utf8');
  const base=shell.match(/\.question-pane\{[^}]+\}/)[0];
  const dom=new JSDOM(`<style>${base}\n${css}</style><section class="question-pane"></section>`,{url:'http://localhost'});t.after(()=>dom.window.close());
  assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('section')).position,'absolute');
});
