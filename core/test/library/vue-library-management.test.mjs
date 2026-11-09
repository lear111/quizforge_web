import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {loadVueUi} from '../fixtures/vue-ui.mjs';
import {bindLibraryManagement} from '../../web/library/library-management.js';

const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,overrides={}){
  const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'}),document=dom.window.document;
  loadVueUi(dom);
  const dialog=document.querySelector('#library-manage-dialog'),get=id=>document.querySelector(`#library-manage-${id}`);
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const calls=[],changed=[];
  const config={document,getContext:()=>({kind:'bank',catalog:{canManage:true,groups:{banks:['资料','另一组']}}}),
    request:async(...args)=>{calls.push(args);return {ok:true};},beforeChange:async()=>{},onChanged:async(...args)=>changed.push(args),onExport:async()=>{},...overrides};
  const manager=bindLibraryManagement(config);
  t.after(()=>{manager.destroy();dom.window.close();});
  const submit=async()=>{get('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await flush();};
  return {dom,document,dialog,get,config,manager,calls,changed,submit};
}

test('pending preparation locks all exits and repeated submits; one saved operation reaches the host',async t=>{
  const gate=deferred(),f=fixture(t,{beforeChange:()=>gate.promise});
  f.manager.open('item',{path:'资料/练习',title:'练习',group:'资料'});
  f.get('name').value='新名称';await f.submit();
  assert.equal(f.get('form').getAttribute('aria-busy'),'true');
  assert.ok([...f.get('form').querySelectorAll('button,input,select')].every(node=>node.disabled));
  const escape=new f.dom.window.Event('cancel',{cancelable:true});f.dialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented,true);assert.equal(f.dialog.open,true);
  await f.submit();f.manager.open('group',null,'create');assert.equal(f.get('title').textContent,'编辑题库');
  gate.resolve();await flush();
  assert.equal(f.calls.length,1);assert.equal(f.changed.length,1);assert.equal(f.dialog.open,false);
  assert.equal(JSON.parse(f.calls[0][1].body).name,'新名称');
});

test('destroy during preparation prevents the later write; the new mount has only its own handlers',async t=>{
  const gate=deferred(),f=fixture(t,{beforeChange:()=>gate.promise});
  f.manager.open('item',{path:'old',title:'Old'});await f.submit();f.manager.destroy();
  assert.equal(f.get('form'),null);assert.equal(f.dialog.open,false);
  const writes=[],next=bindLibraryManagement({...f.config,beforeChange:async()=>{},request:async(...args)=>{writes.push(args);return {};}});
  t.after(()=>next.destroy());next.open('item',{path:'new',title:'New'});
  gate.resolve();await flush();assert.equal(f.calls.length,0);assert.equal(f.get('name').value,'New');
  await f.submit();assert.equal(writes.length,1);assert.equal(JSON.parse(writes[0][1].body).path,'new');
});

test('a late response after teardown cannot update the catalog or close a newly mounted dialog',async t=>{
  const reply=deferred(),f=fixture(t,{request:()=>reply.promise});
  f.manager.open('item',{path:'old',title:'Old'});await f.submit();f.manager.destroy();
  const next=bindLibraryManagement(f.config);t.after(()=>next.destroy());next.open('group',null,'create');
  reply.resolve({catalog:{}});await flush();
  assert.equal(f.changed.length,0);assert.equal(f.dialog.open,true);assert.equal(f.get('title').textContent,'新建分组');
  assert.equal(f.get('confirm').disabled,false);
});

test('Escape leaves delete confirmation for the unsaved edit and restores focus; queued close cannot reset a reopened form',async t=>{
  const f=fixture(t);f.manager.open('item',{path:'资料/练习',title:'练习',group:'资料'});
  assert.equal(f.document.activeElement,f.get('name'));
  f.get('name').value='尚未保存';f.get('group').value='另一组';f.get('delete').click();
  assert.equal(f.document.activeElement,f.get('cancel'));
  f.dialog.dispatchEvent(new f.dom.window.Event('cancel',{cancelable:true}));
  assert.equal(f.get('name').value,'尚未保存');assert.equal(f.get('group').value,'另一组');assert.equal(f.document.activeElement,f.get('name'));
  f.get('close').click();assert.equal(f.dialog.open,false);
  f.manager.open('group',null,'create');
  // The close event from the previous edit is dispatched after the new open.
  f.dialog.dispatchEvent(new f.dom.window.Event('close'));
  f.get('name').value='新分组';await f.submit();
  assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0][1].body).action,'create');
});

test('mixed shared groups keep the document boundary and all labels and errors stay plain text',async t=>{
  const name='<img src=x onerror=alert(1)>',f=fixture(t,{getContext:()=>({kind:'bank',catalog:{canManage:true,banks:[],documents:[{group:name}],groups:{banks:[name]}}})});
  f.manager.open('group',{path:name,name});
  assert.equal(f.get('export').hidden,true);assert.match(f.get('hint').textContent,/PDF、Word/);
  f.get('delete').click();assert.ok(f.get('hint').textContent.includes(name));assert.equal(f.get('form').querySelector('img'),null);
});

test('a backend error retains the input for retry, and a real close discards the old draft',async t=>{
  let attempt=0;const f=fixture(t,{request:async()=>{if(++attempt===1)throw Error('名称已存在');return {};}});
  f.manager.open('item',{path:'old',title:'Old'});f.get('name').value='重名';await f.submit();
  assert.equal(f.dialog.open,true);assert.equal(f.get('name').value,'重名');assert.equal(f.get('error').textContent,'名称已存在');
  f.get('name').value='改名后';await f.submit();assert.equal(attempt,2);assert.equal(f.dialog.open,false);
  f.dialog.dispatchEvent(new f.dom.window.Event('close'));f.manager.open('item',{path:'next',title:'Next'});
  assert.equal(f.get('name').value,'Next');assert.equal(f.get('error').hidden,true);
});
