import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentWatcher} from '../web/development-watch.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(options={}){
  const tasks=new Map(),listeners=new Map();let serial=0;
  const document={visibilityState:'visible',addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
  const watcher=createDevelopmentWatcher({revision:'a',document,schedule:fn=>{tasks.set(++serial,fn);return serial;},cancel:id=>tasks.delete(id),...options});
  const tick=async()=>{const [id,fn]=tasks.entries().next().value||[];if(fn){tasks.delete(id);fn();await settle();}};
  return {watcher,tasks,listeners,tick,hide(){document.visibilityState='hidden';listeners.get('visibilitychange')?.();},show(){document.visibilityState='visible';listeners.get('visibilitychange')?.();}};
}
test('only visible active preview polls, with no overlapping requests and full cleanup',async()=>{
  let checks=0,release;const f=fixture({check:()=>{checks++;return new Promise(resolve=>{release=resolve;});},reload:()=>{throw new Error('unused');}});
  assert.equal(f.tasks.size,0);f.watcher.setActive(true);await f.tick();assert.equal(checks,1);assert.equal(f.tasks.size,0);
  f.hide();f.show();f.watcher.setActive(true);assert.equal(f.tasks.size,0);
  release({revision:'a'});await settle();assert.equal(f.tasks.size,1);
  f.hide();assert.equal(f.tasks.size,0);f.show();assert.equal(f.tasks.size,1);f.watcher.setActive(false);assert.equal(f.tasks.size,0);
  f.watcher.destroy();assert.equal(f.listeners.size,0);
});
test('failed source reload preserves previous revision and retries without growing timers',async()=>{
  let reloads=0;const errors=[],f=fixture({check:async()=>({revision:'b'}),reload:async()=>{if(++reloads===1)throw new Error('half-written file');},onError:error=>errors.push(error.message)});
  f.watcher.setActive(true);await f.tick();assert.equal(f.watcher.revision,'a');assert.deepEqual(errors,['half-written file']);assert.equal(f.tasks.size,1);
  await f.tick();assert.equal(reloads,2);assert.equal(f.watcher.revision,'b');assert.equal(f.tasks.size,1);
  await f.tick();assert.equal(reloads,2);f.watcher.destroy();assert.equal(f.tasks.size,0);
});
test('a result that finishes after tab suspension is ignored, then checked on resume',async()=>{
  let release,reloads=0;const f=fixture({check:()=>new Promise(resolve=>{release=resolve;}),reload:async()=>{reloads++;}});
  f.watcher.setActive(true);await f.tick();f.watcher.setActive(false);release({revision:'b'});await settle();assert.equal(reloads,0);assert.equal(f.watcher.revision,'a');assert.equal(f.tasks.size,0);
  f.watcher.setActive(true);await f.tick();release({revision:'b'});await settle();assert.equal(reloads,1);assert.equal(f.watcher.revision,'b');f.watcher.destroy();
});

test('restoring the last valid source after an error reloads and clears failure state',async()=>{
  let source='b',reloads=0;const f=fixture({check:async()=>({revision:source}),reload:async()=>{reloads++;if(source==='b')throw new Error('incomplete write');}});
  f.watcher.setActive(true);await f.tick();assert.equal(f.watcher.revision,'a');
  source='a';await f.tick();assert.equal(reloads,2);assert.equal(f.watcher.revision,'a');
  await f.tick();assert.equal(reloads,2);f.watcher.destroy();assert.equal(f.tasks.size,0);
});
