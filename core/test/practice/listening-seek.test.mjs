import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

function fixture(t){
  const css=fs.readFileSync(new URL('../../web/listening/audio-player.css',import.meta.url),'utf8');
  const dom=new JSDOM(`<style>${css}</style><main></main><audio></audio>`,{url:'http://localhost',runScripts:'outside-only'}),w=dom.window;
  const frames=new Map();let next=1,paused=true;
  w.requestAnimationFrame=fn=>{const id=next++;frames.set(id,fn);return id;};w.cancelAnimationFrame=id=>frames.delete(id);
  const audio=w.document.querySelector('audio');Object.defineProperty(audio,'duration',{value:60});Object.defineProperty(audio,'paused',{get:()=>paused});
  audio.load=()=>{};audio.pause=()=>{paused=true;audio.dispatchEvent(new w.Event('pause'));};audio.play=()=>{paused=false;audio.dispatchEvent(new w.Event('play'));return Promise.resolve();};
  w.eval(fs.readFileSync(new URL('../../web/listening/audio-player.js',import.meta.url),'utf8'));
  const player=w.QFAudioPlayer.create(w.document.querySelector('main'),{audio}),root=w.document.querySelector('.qfa'),track=root.querySelector('.qfa-track');
  track.getBoundingClientRect=()=>({left:100,width:200});track.setPointerCapture=()=>{};track.releasePointerCapture=()=>{};
  const paint=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(0);};
  const update=value=>{audio.currentTime=value;audio.dispatchEvent(new w.Event('timeupdate'));};
  const point=(name,x)=>track.dispatchEvent(new w.MouseEvent(name,{bubbles:true,cancelable:true,button:0,clientX:x}));
  function assertPosition(percent){
    assert.equal(root.querySelector('.qfa-played').style.width,`${percent}%`);
    assert.equal(root.querySelector('.qfa-thumb').style.left,`${percent}%`);
    assert.equal(w.getComputedStyle(root.querySelector('.qfa-played')).transition,'none');
  }
  t.after(()=>{player.destroy();dom.window.close();});return {w,audio,player,root,track,frames,paint,update,point,assertPosition};
}

test('click and drag synchronize fill and dot immediately, including timeupdate before the next paint',t=>{
  const f=fixture(t);f.update(6);assert.equal(f.root.dataset.qfaSmooth,'true');
  f.point('pointerdown',250);f.assertPosition(75);assert.equal(f.root.dataset.qfaSmooth,'false');
  f.point('pointermove',150);f.assertPosition(25);f.point('pointerup',150);
  f.update(15);f.assertPosition(25);f.paint();f.update(15);f.assertPosition(25);f.paint();
  f.update(16);assert.equal(f.root.dataset.qfaSmooth,'true');
  assert.match(f.w.getComputedStyle(f.root.querySelector('.qfa-played')).transition,/width \.08s linear/);
  assert.match(f.w.getComputedStyle(f.root.querySelector('.qfa-thumb')).transition,/left \.08s linear/);
});

test('keyboard and skip seeks remain instant and repeated seeks leave only one pending frame',t=>{
  const f=fixture(t);f.track.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));f.assertPosition(100);
  f.player.seekBy(-15);f.assertPosition(75);f.player.seekTo(30);f.assertPosition(50);assert.equal(f.frames.size,1);
  f.player.destroy();assert.equal(f.frames.size,0);
});

test('dragging while playing resumes playback without reintroducing the indicator transition',async t=>{
  const f=fixture(t);await f.player.play();f.point('pointerdown',200);f.assertPosition(50);assert.equal(f.audio.paused,true);
  f.point('pointerup',200);assert.equal(f.audio.paused,false);f.update(30);f.assertPosition(50);
  f.player.setSource('');assert.equal(f.frames.size,0);f.assertPosition(50);
});
