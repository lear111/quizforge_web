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
  assert.deepEqual(submitted,{enabled:true,publicEnabled:false,publicUrl:'',port:8790,password:'  secret88  '});
  release();await pending;
  assert.equal(f.node('password').value,'');assert.equal(f.node('save').disabled,false);
  assert.equal(f.node('urls').children[0].textContent,'http://192.168.1.2:8790/');
  f.view.destroy();
});

test('public switch requires the shared password and a public address before saving',async()=>{
  let saves=0,submitted;
  const state={canManage:true,enabled:false,publicEnabled:false,publicUrl:'',port:8790,passwordConfigured:false,urls:[]};
  const f=fixture(async(path,options)=>{
    if(!options)return state;
    saves++;submitted=JSON.parse(options.body);
    return {...state,...submitted,passwordConfigured:true};
  });
  await f.view.open();
  assert.equal(f.node('public-fields').hidden,true);
  f.node('public-enabled').checked=true;f.node('public-enabled').emit('change');
  assert.equal(f.node('password').required,true);assert.equal(f.node('public-url').required,true);assert.equal(f.node('public-fields').hidden,false);
  await f.node('form').emit('submit');assert.equal(saves,0);assert.equal(f.node('password').focused,true);
  f.node('password').value='secret-password';f.node('public-url').value='https://quiz.example.test/a';
  await f.node('form').emit('submit');assert.equal(saves,0);assert.equal(f.node('public-url').focused,true);
  f.node('public-url').value='https://quiz.example.test/';
  await f.node('form').emit('submit');assert.equal(saves,1);
  assert.deepEqual(submitted,{enabled:false,publicEnabled:true,publicUrl:'https://quiz.example.test/',port:8790,password:'secret-password'});
  assert.equal(f.node('password').value,'');assert.equal(f.node('addresses').hidden,false);
  assert.equal(f.node('urls').children[0].textContent,'https://quiz.example.test/');assert.match(f.node('status').textContent,/公网连接入口已开启/);
  f.view.destroy();
});

test('both modes retain the shared password, render both addresses and lock remote editing',async()=>{
  let submitted;
  const state={canManage:true,enabled:true,publicEnabled:true,publicUrl:'https://quiz.example.test/',port:8790,passwordConfigured:true,urls:['http://192.168.1.2:8790/']};
  const f=fixture(async(path,options)=>{if(!options)return state;submitted=JSON.parse(options.body);return {...state,...submitted};});
  await f.view.open();assert.equal(f.node('password').required,false);assert.equal(f.node('urls').children.length,2);
  await f.node('form').emit('submit');assert.equal('password' in submitted,false);
  assert.match(f.node('password-hint').textContent,/两种连接共用密码/);
  f.node('enabled').checked=false;f.node('public-enabled').checked=false;f.node('public-enabled').emit('change');
  assert.equal(f.node('password').required,false);assert.equal(f.node('public-url').required,false);assert.equal(f.node('public-fields').hidden,true);
  await f.node('form').emit('submit');assert.equal(f.node('addresses').hidden,true);assert.match(f.node('status').textContent,/仅本机/);
  const remote=fixture(async()=>({...state,canManage:false}));await remote.view.open();
  for(const field of ['enabled','public-enabled','public-url','port','password','save'])assert.equal(remote.node(field).disabled,true,field);
  assert.equal(remote.node('fields').hidden,true);
  f.view.destroy();remote.view.destroy();
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

test('an old running backend explains restarting and cannot silently enable public access',async()=>{
  const f=fixture(async()=>({canManage:true,enabled:true,port:8790,passwordConfigured:true,urls:[]}));
  await f.view.open();assert.equal(f.node('public-enabled').disabled,true);assert.equal(f.node('enabled').disabled,false);
  assert.match(f.node('error').textContent,/关闭原服务并重新启动/);
  f.view.destroy();
});
