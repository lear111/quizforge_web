import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {bindBankAuthoring} from '../../web/library/bank-authoring.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,request,refreshFailure=false) {
  const dom=new JSDOM(readFileSync(new URL('../../web/index.html',import.meta.url),'utf8'),{url:'http://localhost'});
  const document=dom.window.document,$=id=>document.getElementById(id),dialog=$('bank-author-dialog');
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const calls=[],changed=[],catalog={canManage:true,groups:{banks:['Group']},extensions:[{name:'Choice',group:'Types',referencePath:'extensions/Types/Choice'}]};
  const author=bindBankAuthoring({document,getContext:()=>({catalog}),beforeChange:async()=>{calls.push('flush');},request:async(uri,options)=>{calls.push({uri,options});return request(uri,options);},onChanged:async result=>{if(refreshFailure)throw new Error("Synthetic catalog failure");changed.push(result);},onMessage:()=>{}});
  const submit=async()=>{$('bank-author-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await tick();};
  t.after(()=>dom.window.close());return{author,$,dialog,calls,changed,catalog,submit};
}
test('create and save-as choose distinct source commands, flush before writes, and cannot be opened remotely',async t=>{
  const f=fixture(t,async()=>({uuid:'new-id',catalog:{}}));f.$('library-new-bank').click();assert.equal(f.dialog.open,true);
  f.$('bank-author-name').value='New';f.$('bank-author-group').value='Group';await f.submit();
  assert.equal(f.calls[0],'flush');assert.deepEqual(JSON.parse(f.calls[1].options.body),{name:'New',group:'Group',extension:'extensions/Types/Choice'});assert.equal(f.dialog.open,false);
  f.author.open('copy',{path:'Group/Original',group:'Group',title:'Original'});await f.submit();
  assert.deepEqual(JSON.parse(f.calls[3].options.body),{name:'Original 副本',group:'Group',source:'Group/Original'});
  f.catalog.canManage=false;f.author.open('create');assert.equal(f.dialog.open,false);
});
test('closing outline reads discards late success and failure without disabling a newly opened create dialog',async t=>{
  const pending=[],f=fixture(t,()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
  f.author.open('outline',{path:'Group/Bank'});assert.equal(f.$('bank-author-save').disabled,true);f.$('bank-author-close').click();
  f.author.open('create');assert.equal(f.$('bank-author-save').disabled,false);pending[0].reject(new Error('Stale error'));await tick();assert.equal(f.$('bank-author-error').hidden,true);
  f.$('bank-author-close').click();const row={path:'Group/Bank'};f.author.open('outline',row);f.$('bank-author-close').click();f.author.open('outline',row);
  pending[2].resolve({revision:'current',outline:[{items:[{question:'new'}]}],questions:[]});await tick();
  pending[1].resolve({revision:'stale',outline:[],questions:[]});await tick();assert.match(f.$('bank-author-json').value,/new/);
});
test('outline save carries its revision, reports conflicts, and upgrade report never serializes catalog bodies',async t=>{
  const f=fixture(t,async(uri,options)=>{
    if(!options)return{revision:'old',outline:[{items:[{question:'q1'}]}],questions:[{id:'q1',title:'Synthetic'}]};
    if(uri.endsWith('outline'))throw new Error('题库已变化');
    return{successful:[{}],skipped:[],failed:[{path:'bank.json',reason:'unknown field'}],affectedExtensions:[{path:'extensions/G/E'}],backupDirectory:'.backups/run',reportFile:'.backups/run/report.json',catalog:{banks:[{body:'SECRET BODY'}]}};
  });
  f.author.open('outline',{path:'Group/Bank'});await tick();await f.submit();assert.equal(f.$('bank-author-error').textContent,'题库已变化');assert.equal(JSON.parse(f.calls[2].options.body).revision,'old');
  f.$('bank-author-close').click();f.author.open('upgrade');await f.submit();assert.equal(f.dialog.open,true);assert.match(f.$('bank-author-report').textContent,/成功 1/);assert.doesNotMatch(f.$('bank-author-report').textContent,/SECRET/);assert.equal(f.$('bank-author-save').hidden,true);
});


test('a catalog refresh failure keeps the backup report visible and downloadable',async t=>{
 const f=fixture(t,async()=>({successful:[],skipped:[],failed:[{path:'question-banks/Bad',reason:'Invalid directory'}],affectedExtensions:[],backupDirectory:'.backups/run',reportFile:'.backups/run/report.json',catalogUnavailable:true}),true);
 f.author.open('upgrade');await f.submit();assert.equal(f.$('bank-author-report').hidden,false);assert.equal(f.$('bank-author-report-save').hidden,false);assert.match(f.$('bank-author-report').textContent,/Bad/);assert.match(f.$('bank-author-error').textContent,/报告已保留/);
});
