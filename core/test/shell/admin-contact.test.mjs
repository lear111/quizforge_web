import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {bindUserCenter} from '../../web/ai/user-center.js';
import {ADMIN_CONTACT_PATH} from '../../web/shell/admin-contact.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve)),html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
function fixture(t,read,{local=true,connected=false,asyncClose=false}={}){
  const dom=new JSDOM(html),document=dom.window.document,calls=[];t.after(()=>dom.window.close());
  const dialog=document.getElementById('admin-contact-dialog'),parent=document.getElementById('network-settings-dialog');parent.open=true;
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;const fire=()=>dialog.dispatchEvent(new dom.window.Event('close'));if(asyncClose)setImmediate(fire);else fire();};
  const request=async(path,options)=>{
    if(path===ADMIN_CONTACT_PATH){calls.push(options);return read(options,calls.length);}
    if(!local)throw Object.assign(Error('local only'),{code:'LOCAL_SETTINGS_ONLY'});
    return connected?{connected:true,user:{name:'示例用户'},device:{name:'演示电脑'},manageUrl:'https://example.test/devices'}:{connected:false};
  };
  const view=bindUserCenter({document,request,login:{cancel(){},login:async()=>null}});t.after(()=>view.destroy());
  return {document,view,calls,dialog,parent,get:id=>document.getElementById(id)};
}

test('contact is available without a Hub login, opens immediately, displays literal text and reads afresh on reopen',async t=>{
  let resolve;const text='<img src="https://example.test/track">\n<script>bad()</script>\n邮箱：support@example.test';
  const f=fixture(t,()=>new Promise(done=>resolve=done));await f.view.open();assert.equal(f.calls.length,0);
  f.get('user-center-contact').click();assert.equal(f.dialog.open,true);assert.match(f.get('admin-contact-status').textContent,/正在读取/);assert.equal(f.calls.length,1);
  resolve({content:text,revision:1});await settle();
  assert.equal(f.get('admin-contact-content').textContent,text);assert.equal(f.get('admin-contact-content').children.length,0);
  f.get('admin-contact-done').click();f.get('user-center-contact').click();
  assert.equal(f.calls.length,2);assert.equal(f.get('admin-contact-content').textContent,'');assert.equal(f.get('admin-contact-content').hidden,true);
  resolve({content:'更新的示例内容',revision:2});await settle();assert.equal(f.get('admin-contact-content').textContent,'更新的示例内容');
});

test('empty contact and failed or invalid reads have clear states and can retry',async t=>{
  let value={content:'',revision:0},fail=false;
  const f=fixture(t,async()=>{if(fail)throw Error('offline or timeout');return value;});await f.view.open();
  f.get('user-center-contact').click();await settle();assert.equal(f.get('admin-contact-status').textContent,'管理员尚未填写联系方式。');
  for(const invalid of [null,{content:7,revision:1},{content:'x'.repeat(4001),revision:1},{content:'x',revision:-1},{content:'x',revision:1.5}]){
    f.get('admin-contact-done').click();value=invalid;f.get('user-center-contact').click();await settle();
    assert.equal(f.get('admin-contact-status').textContent,'暂时无法读取联系方式，请重试。');assert.equal(f.get('admin-contact-retry').hidden,false);assert.equal(f.dialog.open,true);
  }
  fail=true;f.get('admin-contact-retry').click();await settle();assert.equal(f.get('admin-contact-status').getAttribute('role'),'alert');
  fail=false;value={content:'重新读取成功',revision:3};f.get('admin-contact-retry').click();await settle();
  assert.equal(f.get('admin-contact-content').textContent,'重新读取成功');assert.equal(f.get('admin-contact-retry').hidden,true);
});

test('closing cancels the read and late reads or close events cannot overwrite a newly opened contact',async t=>{
  const responses=[];const f=fixture(t,()=>new Promise(resolve=>responses.push(resolve)),{asyncClose:true});await f.view.open();
  f.get('user-center-contact').click();f.get('admin-contact-close').click();assert.equal(f.calls[0].signal.aborted,true);
  f.get('user-center-contact').click();await settle();assert.equal(f.calls[1].signal.aborted,false,'An old queued close event must not cancel the new read');
  responses[1]({content:'最新示例',revision:2});await settle();responses[0]({content:'旧示例',revision:1});await settle();
  assert.equal(f.get('admin-contact-content').textContent,'最新示例');
  f.get('admin-contact-done').click();f.get('user-center-contact').click();f.parent.dispatchEvent(new f.document.defaultView.Event('close'));
  assert.equal(f.calls[2].signal.aborted,true);assert.equal(f.dialog.open,false);
});

test('local-only access and device management remain intact',async t=>{
  const remote=fixture(t,()=>assert.fail('LAN must not read contact'),{local:false});await remote.view.open();
  assert.equal(remote.get('user-center-contact').hidden,true);assert.match(remote.get('user-center-status').textContent,/只能在运行 QuizForge/);
  const local=fixture(t,async()=>({content:'示例',revision:0}),{connected:true});await local.view.open();
  assert.equal(local.get('user-center-manage').getAttribute('href'),'https://example.test/devices');assert.equal(local.get('user-center-contact').hidden,false);
});
