import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNetworkSettings} from '../../web/shell/network-settings.js';

function fixture(request,options={}) {
  class Element {
    constructor(){this.listeners=new Map();this.value='';this.checked=false;this.open=false;this.attributes={};this.children=[];}
    addEventListener(name,handler){this.listeners.set(name,handler);}
    removeEventListener(name){this.listeners.delete(name);}
    setAttribute(name,value){this.attributes[name]=value;}
    replaceChildren(){this.children=[];}
    append(...nodes){this.children.push(...nodes);}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){this.focused=true;}
    emit(name,event={preventDefault(){}}){return this.listeners.get(name)?.(event);}
  }
  const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement:()=>new Element()};
  const copied=[];
  const view=bindNetworkSettings({request,document,clipboard:{writeText:async value=>{copied.push(value);}},...options});
  return {view,copied,node:id=>nodes.get(`network-settings-${id}`)};
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
  assert.equal(f.node('lan-urls').children[0].children[0].textContent,'http://192.168.1.2:8790/');
  f.view.destroy();
});

const urlsOf=(f,key)=>f.node(`${key}-urls`).children.map(line=>line.children[0].textContent);

test('outside switch needs the shared password; the custom address is optional but validated',async()=>{
  let saves=0,submitted;
  const state={canManage:true,enabled:false,publicEnabled:false,publicUrl:'',port:8790,passwordConfigured:false,urls:[]};
  const f=fixture(async(path,options)=>{
    if(!options)return state;
    saves++;submitted=JSON.parse(options.body);
    return {...state,...submitted,passwordConfigured:true};
  });
  await f.view.open();
  assert.match(f.node('custom-note').textContent,/开启“外网连接”后可用/);
  f.node('public-enabled').checked=true;f.node('public-enabled').emit('change');
  assert.equal(f.node('password').required,true);assert.equal(f.node('public-url').required,undefined,'the custom address is never required');
  await f.node('form').emit('submit');assert.equal(saves,0);assert.equal(f.node('password').focused,true);
  f.node('password').value='secret-password';
  await f.node('form').emit('submit');assert.equal(saves,1,'saving works without any typed address');
  assert.deepEqual(submitted,{enabled:false,publicEnabled:true,publicUrl:'',port:8790,password:'secret-password'});
  f.node('public-url').value='https://quiz.example.test/a';
  await f.node('form').emit('submit');assert.equal(saves,1);assert.equal(f.node('public-url').focused,true);
  f.node('public-url').value='https://quiz.example.test/';
  await f.node('form').emit('submit');assert.equal(saves,2);assert.equal(submitted.publicUrl,'https://quiz.example.test/');
  assert.deepEqual(urlsOf(f,'custom'),['https://quiz.example.test/']);assert.match(f.node('status').textContent,/外网连接已开启/);
  f.view.destroy();
});

test('both modes retain the shared password, list LAN and custom addresses and lock remote editing',async()=>{
  let submitted;
  const state={canManage:true,enabled:true,publicEnabled:true,publicUrl:'https://quiz.example.test/',port:8790,passwordConfigured:true,urls:['http://192.168.1.2:8790/']};
  const f=fixture(async(path,options)=>{if(!options)return state;submitted=JSON.parse(options.body);return {...state,...submitted};});
  await f.view.open();assert.equal(f.node('password').required,false);
  assert.deepEqual(urlsOf(f,'lan'),['http://192.168.1.2:8790/']);assert.deepEqual(urlsOf(f,'custom'),['https://quiz.example.test/']);
  await f.node('form').emit('submit');assert.equal('password' in submitted,false);
  assert.match(f.node('password-hint').textContent,/所有连接共用/);
  f.node('enabled').checked=false;f.node('public-enabled').checked=false;f.node('public-enabled').emit('change');
  assert.equal(f.node('password').required,false);
  await f.node('form').emit('submit');assert.deepEqual(urlsOf(f,'lan'),[]);assert.deepEqual(urlsOf(f,'custom'),[]);assert.match(f.node('status').textContent,/仅本机/);
  const remote=fixture(async()=>({...state,canManage:false}));await remote.view.open();
  for(const field of ['enabled','public-enabled','public-url','port','password','save','refresh'])assert.equal(remote.node(field).disabled,true,field);
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

test('detected IPv6 and Tailscale addresses are listed without typing, and copy buttons copy them',async()=>{
  const v6='http://[2001:db8::1234]:8790/',ts='https://pc.tail1234.ts.net/';
  const state={canManage:true,enabled:true,publicEnabled:true,publicUrl:'',port:8790,passwordConfigured:true,ipv6Supported:true,urls:['http://192.168.1.2:8790/','http://[2001:db8::1234]:8790/'],publicIpv6Urls:[v6],tailscale:{state:'running',name:'pc.tail1234.ts.net',url:ts}};
  const f=fixture(async()=>state);await f.view.open();
  assert.deepEqual(urlsOf(f,'lan'),['http://192.168.1.2:8790/'],'IPv6 is listed in its own row');
  assert.deepEqual(urlsOf(f,'ipv6'),[v6]);assert.match(f.node('ipv6-note').textContent,/放行 IPv6 入站/);
  assert.deepEqual(urlsOf(f,'tailscale'),[ts]);assert.match(f.node('tailscale-note').textContent,/同一 Tailscale 账号/);
  await f.node('tailscale-urls').children[0].children[1].emit('click');assert.deepEqual(f.copied,[ts]);
  const closed=fixture(async()=>({...state,publicEnabled:false}));await closed.view.open();
  assert.deepEqual(urlsOf(closed,'ipv6'),[]);assert.deepEqual(urlsOf(closed,'tailscale'),[]);assert.match(closed.node('tailscale-note').textContent,/开启“外网连接”后可用/);
  f.view.destroy();closed.view.destroy();
});

test('Tailscale lists only a browser address; missing and stopped clients are distinct',async()=>{
  const base={canManage:true,enabled:false,publicEnabled:true,publicUrl:'',port:8788,passwordConfigured:true,urls:[],publicIpv6Urls:[]};
  const plain=fixture(async()=>({...base,tailscale:{state:'running',name:'pc.tail1234.ts.net',url:'http://pc.tail1234.ts.net:8788/'}}));await plain.view.open();
  assert.deepEqual(urlsOf(plain,'tailscale'),['http://pc.tail1234.ts.net:8788/']);assert.doesNotMatch(plain.node('tailscale-note').textContent,/tailscale serve|命令/);
  const missing=fixture(async()=>({...base,tailscale:{state:'missing'}}));await missing.view.open();
  assert.match(missing.node('tailscale-note').textContent,/未检测到 Tailscale/);
  const stopped=fixture(async()=>({...base,tailscale:{state:'stopped'}}));await stopped.view.open();
  assert.match(stopped.node('tailscale-note').textContent,/未运行或未登录/);
  const old=fixture(async()=>base);await old.view.open();assert.match(old.node('tailscale-note').textContent,/未检测到 Tailscale/);
  for(const view of [plain,missing,stopped,old])view.view.destroy();
});

test('the LAN row shows HTTPS addresses when LAN HTTPS is on, otherwise HTTP',async()=>{
  const state={canManage:true,enabled:true,publicEnabled:false,publicUrl:'',port:8788,passwordConfigured:true,urls:['http://192.168.1.2:8788/'],https:{enabled:false,configured:false,port:8789,urls:[]}};
  const plain=fixture(async()=>state);await plain.view.open();assert.deepEqual(urlsOf(plain,'lan'),['http://192.168.1.2:8788/']);
  const secure=fixture(async()=>({...state,https:{enabled:true,configured:true,port:8789,urls:['https://192.168.1.2:8789/']}}));await secure.view.open();
  assert.deepEqual(urlsOf(secure,'lan'),['https://192.168.1.2:8789/']);
  plain.view.destroy();secure.view.destroy();
});

test('refresh re-detects addresses without discarding unsaved edits',async()=>{
  const paths=[];let tailscale={state:'stopped'};
  const state={canManage:true,enabled:true,publicEnabled:true,publicUrl:'',port:8788,passwordConfigured:true,urls:['http://192.168.1.2:8788/'],publicIpv6Urls:[]};
  const f=fixture(async path=>{paths.push(path);return {...state,tailscale};});
  await f.view.open();f.node('port').value='9000';f.node('enabled').checked=false;
  tailscale={state:'running',name:'pc.tail1234.ts.net',url:'https://pc.tail1234.ts.net/'};
  await f.node('refresh').emit('click');
  assert.deepEqual(paths,['/api/settings/network','/api/settings/network?refresh=1']);
  assert.deepEqual(urlsOf(f,'tailscale'),['https://pc.tail1234.ts.net/']);
  assert.equal(f.node('port').value,'9000');assert.equal(f.node('enabled').checked,false,'unsaved edits stay');
  f.view.destroy();
});

test('IPv6 unavailable and no global IPv6 address are distinct states',async()=>{
  const state={canManage:true,enabled:false,publicEnabled:true,publicUrl:'',port:8790,passwordConfigured:true,urls:[],publicIpv6Urls:[]};
  const v4=fixture(async()=>({...state,ipv6Supported:false}));await v4.view.open();
  assert.match(v4.node('ipv6-note').textContent,/未启用 IPv6/);assert.deepEqual(urlsOf(v4,'ipv6'),[]);
  const v6=fixture(async()=>({...state,ipv6Supported:true}));await v6.view.open();
  assert.match(v6.node('ipv6-note').textContent,/未检测到本机公网 IPv6/);
  v4.view.destroy();v6.view.destroy();
});

test('LAN HTTPS shows the root fingerprint and QR codes, follows the LAN switch and confirms regeneration',async()=>{
  const https={enabled:true,configured:true,port:8789,urls:['https://192.168.1.2:8789/'],certificateUrls:['http://192.168.1.2:8788/quizforge-lan-ca.crt'],fingerprint:'AB:CD',rootValidTo:'2036-10-16T12:00:00.000Z',serverValidTo:'2027-11-17T00:00:00.000Z',certificateQr:'data:image/svg+xml;base64,PHN2Zy8+',urlQr:'javascript:alert(1)'};
  const state={canManage:true,enabled:true,publicEnabled:false,publicUrl:'',port:8788,passwordConfigured:true,urls:['http://192.168.1.2:8788/'],https};
  const calls=[];let confirmed=0;
  const f=fixture(async(path,options)=>{calls.push({path,options});if(!options)return state;if(path.endsWith('/regenerate'))return {...state,https:{...https,fingerprint:'EF:01'}};const body=JSON.parse(options.body);return {...state,...body,https:{...https,enabled:body.httpsEnabled,configured:body.httpsEnabled,port:body.httpsPort}};},{confirm:()=>{confirmed++;return confirmed>1;}});
  await f.view.open();
  assert.equal(f.node('https').hidden,false);assert.equal(f.node('https-enabled').checked,true);assert.equal(f.node('https-port').value,'8789');assert.equal(f.node('https-details').hidden,false);
  assert.equal(f.node('https-fingerprint').textContent,'AB:CD');assert.equal(f.node('https-certificate-urls').children[0].textContent,'http://192.168.1.2:8788/quizforge-lan-ca.crt');
  assert.equal(f.node('https-certificate-qr').src,https.certificateQr);assert.equal(f.node('https-url-qr').hidden,true,'only inline SVG data is shown');
  assert.match(f.node('https-validity').textContent,/2036-10-16/);
  f.node('https-port').value='8788';await f.node('form').emit('submit');assert.equal(calls.length,1,'HTTPS port must differ from the LAN port');
  f.node('https-port').value='8790';f.node('enabled').checked=false;f.node('enabled').emit('change');
  assert.equal(f.node('https-enabled').checked,false);assert.equal(f.node('https-enabled').disabled,true);
  await f.node('form').emit('submit');assert.deepEqual(JSON.parse(calls.at(-1).options.body),{enabled:false,publicEnabled:false,publicUrl:'',port:8788,httpsEnabled:false,httpsPort:8790});
  f.node('enabled').checked=true;f.node('enabled').emit('change');f.node('https-enabled').checked=true;await f.node('form').emit('submit');
  assert.equal(JSON.parse(calls.at(-1).options.body).httpsEnabled,true);
  const before=calls.length;await f.node('https-regenerate').emit('click');assert.equal(calls.length,before,'cancelled confirmation keeps the root');
  await f.node('https-regenerate').emit('click');assert.equal(calls.at(-1).path,'/api/settings/network/https/regenerate');assert.equal(calls.at(-1).options.method,'POST');
  assert.equal(f.node('https-fingerprint').textContent,'EF:01');assert.match(f.node('https-status').textContent,/删除旧的 QuizForge 证书/);
  f.view.destroy();
});

test('HTTPS panel stays hidden for an older backend and on remote devices',async()=>{
  const f=fixture(async()=>({canManage:true,enabled:false,port:8790,passwordConfigured:false,urls:[]}));
  await f.view.open();assert.equal(f.node('https').hidden,true);f.view.destroy();
  const remote=fixture(async()=>({canManage:false,enabled:true,port:8790,passwordConfigured:true,urls:[],https:{enabled:true,configured:true,port:8791}}));
  await remote.view.open();assert.equal(remote.node('https').hidden,true);remote.view.destroy();
});
