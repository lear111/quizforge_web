import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import lamejs from '@breezystack/lamejs';

const extension = new URL('../../../extensions/基础题型/听力理解/', import.meta.url);
const sources = new URL('../../scripts/build/listening/', import.meta.url);
const read = (name, base = sources) => fs.readFileSync(new URL(name, base), 'utf8');
const sample = () => JSON.parse(read('examples/bank.json', extension)).questions[0];
const plain = value => JSON.parse(JSON.stringify(value));

function windowFor(t, html = '') {
  const dom = new JSDOM(html, {runScripts:'outside-only', url:'http://localhost/'});
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLMediaElement.prototype.pause = function () {};
  w.HTMLMediaElement.prototype.load = function () {};
  w.eval(read('audio-reference.js'));w.eval(read('audio-player.js'));
  return w;
}

test('a compact speed select controls playback without volume or mute controls', t => {
  const w = windowFor(t, '<main></main>');
  const player = w.QFAudioPlayer.create(w.document.querySelector('main'));
  const select = player.el.querySelector('select[aria-label="播放倍速"]');
  assert.ok(select);assert.equal(select.multiple,false);assert.equal(select.size,0);
  assert.deepEqual(Array.from(select.options, option=>option.textContent),['0.75×','1×','1.25×','1.5×','2×']);
  assert.equal(select.value,'1');
  for(const rate of ['0.75','1','1.25','1.5','2']) {
    select.value=rate;select.dispatchEvent(new w.Event('change'));
    assert.equal(player.audio.playbackRate,Number(rate));
    assert.equal(select.selectedOptions[0].textContent,rate+'×');
  }
  select.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(player.getSpeed(),2,'native select arrow keys must not be intercepted');
  player.setSpeed(1.25);assert.equal(select.value,'1.25');
  assert.equal(player.el.querySelector('.qfa-volume, .qfa-mute, input[type="range"], .qfa-speed-btn'),null);
  player.el.dispatchEvent(new w.KeyboardEvent('keydown',{key:'m',bubbles:true}));
  assert.equal(player.audio.muted,false);
  player.destroy();
});

test('disposing a player preserves borrowed media sources for submitted review, retry and editor preview', t => {
  const w = windowFor(t, '<main></main><audio src="data:audio/mpeg;base64,//NAZA=="></audio>');
  const audio = w.document.querySelector('audio'), original = audio.getAttribute('src');
  const player = w.QFAudioPlayer.create(w.document.querySelector('main'), {audio});
  player.destroy();assert.equal(audio.getAttribute('src'),original);
  const restored = w.QFAudioPlayer.create(w.document.querySelector('main'), {audio});
  assert.equal(restored.audio.getAttribute('src'),original);restored.destroy();
});

test('each new player starts at 1x regardless of old preferences, caller defaults or reused media', t => {
  const w = windowFor(t, '<main></main><audio></audio>');w.localStorage.setItem('qf-listen-speed','1.5');
  const host=w.document.querySelector('main'), audio=w.document.querySelector('audio');
  audio.playbackRate=2;audio.defaultPlaybackRate=2;
  const options={audio,speed:2,storageKey:'qf-listen-speed',speeds:[0.75,1.5,2]};
  const player = w.QFAudioPlayer.create(host,options);
  assert.equal(player.getSpeed(),1);assert.equal(audio.defaultPlaybackRate,1);
  assert.equal(player.el.querySelector('select').value,'1');
  player.setSpeed(2);player.destroy();
  const next=w.QFAudioPlayer.create(host,options);
  assert.equal(next.getSpeed(),1);next.destroy();
});

test('inline MP3 references reject unsupported data URLs, fake headers, invalid base64 and oversize audio', () => {
  const box = {};vm.runInNewContext(read('audio-reference.js'), box);
  const valid = 'data:audio/mpeg;base64,' + Buffer.from([255,243,80,196,0,0]).toString('base64');
  assert.equal(box.QFListeningAudio.isReference(valid),true);
  for (const invalid of ['https://example.test/clip.mp3','data:text/html;base64,SUQzAA==','data:audio/mpeg;base64,aGVsbG8=','data:audio/mpeg;base64,SUQzA=', 'data:audio/mpeg;base64,'+Buffer.alloc(1024*1024+1,255).toString('base64')]) assert.equal(box.QFListeningAudio.isReference(invalid),false);
  assert.equal(box.QFListeningAudio.isReference('assets/clip.mp3'),true);
});

test('the real encoder downmixes stereo to 40 kbps MP3, reports progress and honors cancellation', async () => {
  const box = {lamejs, Blob, DOMException, performance, setTimeout};
  vm.runInNewContext(read('audio-reference.js') + '\n' + read('audio-import.js'), box);
  const samples = Float32Array.from({length:32000},(_,i)=>Math.sin(i/16000*440*Math.PI*2)*.2);
  const pcm = {sampleRate:16000,length:samples.length,duration:2,numberOfChannels:2,getChannelData:()=>samples};
  const progress = [], blob = await box.QFListeningImport.encodePcm(pcm,{onProgress:value=>progress.push(value)});
  assert.equal(blob.type,'audio/mpeg');assert.ok(blob.size>9000 && blob.size<12000, String(blob.size));
  assert.equal(progress.at(-1),100);
  const data = Buffer.from(await blob.arrayBuffer()).toString('base64');
  assert.equal(box.QFListeningAudio.isInline('data:audio/mpeg;base64,'+data),true);
  const abort = new AbortController();abort.abort();
  await assert.rejects(box.QFListeningImport.encodePcm(pcm,{signal:abort.signal}),{name:'AbortError'});
});

async function practice(t, {limit=0,plays=0,status='draft',mode='practice'}={}) {
  const w=windowFor(t,read('practice.html',extension));
  const saved=[];let hooks;
  w.QF = {
    content:{render:()=>({ready:Promise.resolve(),destroy(){}})},ui:{resize(){}},
    page:{register(value){hooks=value;return Promise.resolve();},async reportAnswerState(){return {ok:true,data:{stateId:'1'}};}},
    async save(value){saved.push(plain(value));return {ok:true,data:{}};}
  };
  w.eval(read('listen-page.js'));
  const question=sample();question.data.playLimit=limit;
  const context={mode,status,question,answer:{selectedOptionId:null,plays},capabilities:{canSave:mode!=='history',canSubmit:status!=='submitted',canRetry:status==='submitted'},result:{score:0,maxScore:5}};
  await hooks.onLoad(context);
  return {w,hooks,saved,context,audio:()=>w.document.querySelector('audio[data-asset]'),button:()=>w.document.querySelector('.qfa-toggle')};
}

test('unlimited listening can finish more than five times without producing invalid answer drafts', async t => {
  const f=await practice(t);
  for(let i=0;i<7;i++)f.audio().dispatchEvent(new f.w.Event('ended'));
  await f.hooks.onFlush();assert.equal(f.saved.length,0);assert.equal(f.button().disabled,false);
});

test('legacy two-play limits and exhausted saved counts never lock audio after replay, reload or retry', async t => {
  const f=await practice(t,{limit:2});
  for(let i=0;i<7;i++)f.audio().dispatchEvent(new f.w.Event('ended'));
  await f.hooks.onFlush();assert.equal(f.saved.length,0);assert.equal(f.button().disabled,false);
  const restored=await practice(t,{limit:2,plays:2});assert.equal(restored.button().disabled,false);
  await restored.hooks.onLoad({...restored.context,status:'submitted'});assert.equal(restored.button().disabled,false);
  assert.ok(restored.audio().getAttribute('src'),'submit must preserve the audio source');
  await restored.hooks.onLoad({...restored.context,status:'unanswered',answer:null});assert.equal(restored.button().disabled,false);
  assert.match(restored.w.document.getElementById('play-hint').textContent,/不限次数播放/);
});

test('submitted and history playback remains unlimited and performs no draft writes', async t => {
  for(const options of [{status:'submitted'},{mode:'history',status:'submitted'}]) {
    const f=await practice(t,{limit:2,plays:2,...options});
    for(let i=0;i<7;i++)f.audio().dispatchEvent(new f.w.Event('ended'));
    await f.hooks.onFlush();assert.equal(f.saved.length,0);assert.equal(f.button().disabled,false);
  }
});

test('a local imported MP3 is playable after reload and is preserved by question projection', async t => {
  const f=await practice(t);const question=sample();
  question.data.audio='data:audio/mpeg;base64,'+Buffer.from([255,243,80,196,0,0]).toString('base64');
  await f.hooks.onLoad({...f.context,question:{...question,id:'imported'}});
  assert.equal(f.w.document.querySelector('audio[data-imported-audio]').getAttribute('src'),question.data.audio);
  let rules;vm.runInNewContext(read('rules.js',extension),{QF:{defineType:value=>{rules=value;}}});
  assert.equal(rules.validateQuestion(question.data),true);
  assert.equal(rules.project(question.data,{}).audio,question.data.audio);
});
