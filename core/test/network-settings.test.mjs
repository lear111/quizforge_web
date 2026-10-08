import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNetworkSettings} from '../web/network-settings.js';

function fixture(request,options={}) {
  class Element {
    constructor(){this.listeners=new Map();this.value='';this.checked=false;this.open=false;this.attributes={};this.children=[];}
    addEventListener(name,handler){this.listeners.set(name,handler);}
    removeEventListener(name){this.listeners.delete(name);}
    setAttribute(name,value){this.attributes[name]=value;}
    replaceChildren(){this.children=[];}
    append(node){this.children.push(node);}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){this.focused=true;}
    emit(name,event={preventDefault(){}}){return this.listeners.get(name)?.(event);}
  }
  const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:()=>new Element()};
  const view=bindNetworkSettings({request,document,...options});
  return {view,node:id=>nodes.get(`network-settings-${id}`)};
}

test('network save preserves exact password, locks repeated save and Escape, then clears secret',async()=>{
  const state={canManage:true,enabled:false,port:8790,passwordConfigured:false,urls:[]};
  let release,calls=0,submitted,flushes=0;
  const f=fixture(async(path,options)=>{
    assert.equal(path,'/api/settings/network');
    if(!options)return state;
    calls++;submitted=JSON.parse(options.body);
    return new Promise(resolve=>{release=()=>resolve({...state,enabled:true,passwordConfigured:true,urls:['http://192.168.1.2:8790/']});});
  },{beforeSave:()=>{flushes++;}});
  await f.view.open();
  f.node('enabled').checked=true;f.node('password').value='  secret88  ';
  const pending=f.node('form').emit('submit');
  await Promise.resolve();
  await f.node('form').emit('submit');
  let blocked=false;f.node('dialog').emit('cancel',{preventDefault(){blocked=true;}});
  assert.equal(blocked,true);assert.equal(f.node('save').disabled,true);
  assert.equal(calls,1);assert.equal(flushes,1);
  assert.deepEqual(submitted,{enabled:true,port:8790,password:'  secret88  '});
  release();await pending;
  assert.equal(f.node('password').value,'');assert.equal(f.node('save').disabled,false);
  assert.equal(f.node('urls').children[0].textContent,'http://192.168.1.2:8790/');
  f.view.destroy();
});

test('failed save retains input and remote settings are reported without trapping the dialog',async()=>{
  const f=fixture(async(path,options)=>{
    if(!options)return {canManage:true,enabled:true,port:8790,passwordConfigured:true,urls:[]};
    throw Object.assign(new Error('failure'),{code:'LAN_SETTINGS_UNAVAILABLE'});
  });
  await f.view.open();f.node('password').value='new-secret';
  await f.node('form').emit('submit');
  assert.equal(f.node('password').value,'new-secret');
  assert.equal(f.node('error').textContent,'端口被占用或设置保存失败，当前连接保留。');
  f.node('cancel').emit('click');assert.equal(f.node('dialog').open,false);
  const remote=fixture(async()=>{throw Object.assign(new Error('local only'),{code:'LOCAL_SETTINGS_ONLY'});});
  await remote.view.open();assert.equal(remote.node('save').disabled,true);
  assert.match(remote.node('error').textContent,/只能在本机修改/);
  remote.node('close').emit('click');assert.equal(remote.node('dialog').open,false);
  f.view.destroy();remote.view.destroy();
});
