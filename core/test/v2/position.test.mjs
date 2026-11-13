import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { V2Server } from '../../server/host/v2/server.js';
import { createReadFixture } from '../fixtures/v2-banks.mjs';

test('D32 browsing and ink never create state or move the last answered position; restart follows last draft/submit/retry', async t => {
 const fixture=createReadFixture();t.after(()=>fixture.cleanup());
 const server=await new V2Server(fixture).start();t.after(()=>server.close());
 const api=async(route,body,method='PUT')=>{const r=await fetch(`http://127.0.0.1:${server.port()}${route}`,body===undefined?{}:{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json()};
 const bankId=(await api('/api/v2/catalog')).groups[0].items[0].bankId,base=`/api/v2/banks/${bankId}`;
 let overview=await api(base+'/overview'),snapshotId=overview.snapshotId;
 for(const id of ['5','9'])await api(`${base}/questions/${id}?snapshotId=${snapshotId}`);
 assert.equal(fs.existsSync(path.join(fixture.directory,'.qf-v2')),false);
 await api(base+'/questions/9/ink',{snapshotId,requestId:'ink',expectedInkRevision:0,ink:[1]});
 assert.equal(fs.existsSync(path.join(fixture.directory,'.qf-v2/state.json')),false);
 assert.equal((await api(base+'/overview')).lastQuestionId,null);
 await api(base+'/questions/5/answer',{snapshotId,requestId:'draft',expectedRevision:0,answer:'five'});
 const submitted=await api(base+'/questions/9/submit',{snapshotId,requestId:'submit',expectedRevision:0,answer:'nine'},'POST');
 await api(base+'/questions/5/retry',{snapshotId,requestId:'retry',expectedRevision:1},'POST');
 await api(base+'/questions/9/result',{snapshotId,requestId:'grade',expectedResultRevision:0,submission:submitted.submission,source:'grader',result:{status:'graded',score:2}});
 await api(`${base}/questions/9?snapshotId=${snapshotId}`);
 const restarted=await new V2Server(fixture).start();t.after(()=>restarted.close());
 overview=await fetch(`http://127.0.0.1:${restarted.port()}${base}/overview`).then(r=>r.json());
 assert.equal(overview.lastQuestionId,'5');assert.equal(overview.initial.question.questionId,'5');
 assert.equal(fs.existsSync(path.join(fixture.directory,'.qf-v2/position.json')),false);
});
