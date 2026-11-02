import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {bindLibraryTransfer} from '../../web/library/library-transfer.js';
const html=readFileSync(new URL('../../web/index.html',import.meta.url),'utf8');
test('new import sends the selected filename and completes without conflict choices',async t=>{
 const f=fixture(t);f.select('新的练习.qbank');await f.submit();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].headers['X-QuizForge-Filename'],encodeURIComponent('新的练习.qbank'));
 assert.equal(f.$('#library-import-choices'),null);assert.equal(f.results.length,1);
});
test('old package rejection retains the selected file and shows upgrade guidance',async t=>{
 const f=fixture(t,{request:async()=>{throw new Error('仅支持新版题库包（格式 3），请升级题库包');}});
 f.select();await f.submit();assert.equal(f.dialog.open,true);assert.match(f.$('#library-import-error').textContent,/升级题库包/);
 assert.equal(f.$('#library-import-confirm').disabled,false);
});
function fixture(t,overrides={}){
 const dom=new JSDOM(html),document=dom.window.document,saved=globalThis.document;globalThis.document=document;t.after(()=>{globalThis.document=saved;dom.window.close();});
 const $=selector=>document.querySelector(selector),dialog=$('#library-import-dialog');dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
 const calls=[],downloads=[],results=[],messages=[],context={kind:'bank',catalog:{canManage:true}};
 const transfer=bindLibraryTransfer({request:async(path,options)=>{calls.push({path,...options});return {importedBanks:1};},getContext:()=>context,beforeChange:async()=>{},onImported:async value=>results.push(value),onMessage:value=>messages.push(value),download:async(...args)=>downloads.push(args),...overrides});
 const select=(name='练习.qbank',size=123)=>{Object.defineProperty($('#library-import-file'),'files',{configurable:true,value:[{name,size}]});$('#library-import-file').dispatchEvent(new dom.window.Event('change'));};
 const submit=async()=>{$('#library-import-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));for(let i=0;i<15;i++)await Promise.resolve();};
 return {$,dialog,context,calls,downloads,results,messages,transfer,select,submit};
}
test('qbank import requires confirmation and preserves the binary file and MIME',async t=>{
 const f=fixture(t);f.select();assert.equal(f.calls.length,0);assert.equal(f.dialog.open,true);await f.submit();
 assert.equal(f.calls[0].path,'/api/library/import');assert.equal(f.calls[0].headers['Content-Type'],'application/vnd.quizforge.qbank');assert.equal(f.calls[0].body.name,'练习.qbank');assert.equal(f.results.length,1);assert.equal(f.dialog.open,false);
});
test('ordinary ZIP, oversized packages and remote clients never import',async t=>{
 const f=fixture(t);f.select('file.zip');assert.equal(f.$('#library-import-confirm').disabled,true);await f.submit();assert.equal(f.calls.length,0);
 f.select('file.qbank',128*1024*1024+1);await f.submit();assert.equal(f.calls.length,0);assert.match(f.$('#library-import-error').textContent,/128 MiB/);
 f.dialog.close();f.context.catalog.canManage=false;f.select();assert.equal(f.dialog.open,false);await f.submit();assert.equal(f.calls.length,0);
});
test('cancel and failed preparation do not upload, and failures permit retry',async t=>{
 let attempts=0;const f=fixture(t,{beforeChange:async()=>{if(++attempts===1)throw new Error('请先保存编辑');}});
 f.select();f.$('#library-import-cancel').click();await f.submit();assert.equal(attempts,0);
 f.select();await f.submit();assert.equal(f.calls.length,0);assert.equal(f.dialog.open,true);assert.match(f.$('#library-import-error').textContent,/保存编辑/);assert.equal(f.$('#library-import-confirm').disabled,false);
 await f.submit();assert.equal(f.calls.length,1);assert.equal(f.dialog.open,false);
});
test('export downloads one qbank file and is unavailable in extension lists or remote clients',async t=>{
 const f=fixture(t);await f.transfer.exportGroup({path:'资料',name:'资料'});assert.equal(f.calls[0].path,'/api/library/export');assert.deepEqual(JSON.parse(f.calls[0].body),{group:'资料'});assert.equal(f.calls[0].responseType,'blob');assert.equal(f.downloads[0][1],'资料.qbank');
 f.context.kind='extension';await f.transfer.exportGroup({path:'资料'});assert.equal(f.calls.length,1);f.context.kind='bank';f.context.catalog.canManage=false;await f.transfer.exportGroup({path:'资料'});assert.equal(f.calls.length,1);
});
test('busy import ignores duplicate submissions and retains the selected file on server errors',async t=>{
 let reject,pending=new Promise((_,r)=>reject=r),calls=0;const f=fixture(t,{request:async()=>{calls++;return pending;}});
 f.select();await f.submit();await f.submit();assert.equal(calls,1);assert.equal(f.$('#library-import-confirm').disabled,true);
 reject(new Error('内容冲突'));for(let i=0;i<15;i++)await Promise.resolve();assert.equal(f.dialog.open,true);assert.match(f.$('#library-import-error').textContent,/内容冲突/);assert.equal(f.$('#library-import-confirm').disabled,false);
});

test('individual bank export posts its exact physical path and downloads the bank name',async t=>{
 let failExport=false;const f=fixture(t,{beforeChange:async()=>{if(failExport)throw new Error('请先保存');}});await f.transfer.exportBank({path:'资料/练习',title:'练习'});
 assert.deepEqual(JSON.parse(f.calls[0].body),{bank:'资料/练习'});assert.equal(f.downloads[0][1],'练习.qbank');
 assert.match(f.messages.at(-1),/题库已导出/);
 failExport=true;await assert.rejects(f.transfer.exportBank({path:'资料/练习',title:'练习'},{throwOnError:true}),/请先保存/);assert.equal(f.calls.length,1);
 failExport=false;assert.equal(await f.transfer.exportBank({path:'资料/练习',title:'练习'},{throwOnError:true}),true);assert.equal(f.calls.length,2);
 f.context.kind='extension';await f.transfer.exportBank({path:'资料/练习'});assert.equal(f.calls.length,2);
 f.context.kind='bank';f.context.catalog.canManage=false;await f.transfer.exportBank({path:'练习'});assert.equal(f.calls.length,2);
});
