import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteQueue,createDraftBuffer} from '../web/write-queue.js';

function fixture(send) {
  let revision=0,id=0;
  const queue=createWriteQueue({send,revisionFor:()=>revision,makeRequestId:()=>String(++id),onSaved:(_qid,_action,value)=>{revision=value.state.revision;}});
  return queue;
}
test('whiteboard confirmation does not permit leaving a failed answer behind',async()=>{
  const queue=fixture(async(_qid,body)=>{if(body.action==='draft')throw Object.assign(new Error('offline'),{status:503});return {state:{revision:1}};});
  await assert.rejects(queue.enqueue('q1','draft',{answer:'B'}));
  await queue.enqueue('q1','whiteboard',{draft:{strokes:[]}});
  await queue.settled();
  assert.equal(queue.hasFailures,true);
  assert.deepEqual(queue.failures.map(value=>[value.questionId,value.action,value.data]),[['q1','draft',{answer:'B'}]]);
});
test('submitting the preserved answer confirms it but leaves a failed whiteboard pending',async()=>{
  const queue=fixture(async(_qid,body)=>{if(body.action!=='submit')throw new Error('unavailable');return {state:{revision:1}};});
  await assert.rejects(queue.enqueue('q1','draft',{answer:'B'}));
  await assert.rejects(queue.enqueue('q1','whiteboard',{draft:{strokes:['ink']}}));
  await queue.enqueue('q1','submit',{answer:'B'});
  assert.deepEqual(queue.failures.map(value=>value.action),['whiteboard']);
});
test('writes use confirmed revisions in order and snapshot input immediately',async()=>{
  const bodies=[],data={answer:{selectedOptionId:'A'}};
  const queue=fixture(async(_qid,body)=>{bodies.push(structuredClone(body));return {state:{revision:body.revision+1}};});
  const first=queue.enqueue('q1','draft',data);
  data.answer.selectedOptionId='B';
  const second=queue.enqueue('q1','submit',data);
  await Promise.all([first,second]);
  assert.deepEqual(bodies.map(value=>[value.revision,value.data.answer.selectedOptionId]),[[0,'A'],[1,'B']]);
});
test('lost network replies retry the same request once; HTTP conflicts are not retried',async()=>{
  const bodies=[];
  const queue=fixture(async(_qid,body)=>{bodies.push(structuredClone(body));if(bodies.length===1)throw new TypeError('lost reply');if(body.action==='submit')throw Object.assign(new Error('conflict'),{status:409});return {state:{revision:1}};});
  await queue.enqueue('q1','draft',{answer:'A'});
  assert.deepEqual(bodies[0],bodies[1]);
  await assert.rejects(queue.enqueue('q1','submit',{answer:'B'}));
  assert.equal(bodies.length,3);
  assert.equal(queue.hasFailures,true);
});
test('a confirmed retry clears an answer failure without clearing another question',async()=>{
  const queue=fixture(async(_qid,body)=>{if(body.action==='draft')throw new Error('failed');return {state:{revision:1}};});
  await assert.rejects(queue.enqueue('q1','draft',{answer:'A'}));
  await assert.rejects(queue.enqueue('q2','draft',{answer:'B'}));
  await queue.enqueue('q1','retry',{});
  assert.deepEqual(queue.failures.map(value=>value.questionId),['q2']);
});
test('writes and network retries keep the version of the question displayed when enqueued',async()=>{
  const bodies=[],conditions={contentVersion:'old-question'};
  const queue=fixture(async(_qid,body)=>{bodies.push(structuredClone(body));if(bodies.length===1)throw new TypeError('lost reply');throw Object.assign(new Error('question changed'),{status:409});});
  const save=queue.enqueue('q1','draft',{answer:'A'},conditions);
  conditions.contentVersion='new-question';
  await assert.rejects(save);
  assert.deepEqual(bodies[0],bodies[1]);
  assert.equal(bodies[0].contentVersion,'old-question');
  assert.equal(queue.failures[0].contentVersion,'old-question');
});
test('an older failed ink write cannot restore its snapshot after newer ink is queued',async()=>{
  const ink=createDraftBuffer();let failFirst;
  const queue=fixture(async(_qid,body)=>{if(body.data.draft.strokes.length===1)await new Promise((_resolve,reject)=>{failFirst=reject;});return {state:{revision:1}};});
  const save=async()=>{const snapshot=ink.take();try{await queue.enqueue('q1','whiteboard',{draft:snapshot.value});}catch(error){ink.restore(snapshot);throw error;}};
  ink.replace({strokes:['old']});const first=save();
  await Promise.resolve();
  ink.replace({strokes:['old','new']});const second=save();
  failFirst(new Error('first save failed'));
  await assert.rejects(first);await second;
  assert.equal(ink.pending,false);
  assert.equal(queue.hasFailures,false);
});
test('latest failed ink remains available for retry; explicit clear invalidates old writes',()=>{
  const ink=createDraftBuffer();ink.replace({strokes:['latest']});const latest=ink.take();
  assert.equal(ink.restore(latest),true);assert.deepEqual(ink.take().value,{strokes:['latest']});
  ink.clear();assert.equal(ink.restore(latest),false);assert.equal(ink.pending,false);
});
