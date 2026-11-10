// Test-only deterministic scenario. Run in an isolated process, never a host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {pathToFileURL, fileURLToPath} from 'node:url';

const rulesSource = `QF.defineType({
  validateQuestion: d => typeof d.stem === 'string',
  validateAnswer: a => !!a && typeof a.value === 'string' && a.value !== 'REJECT',
  project: (d,c) => ({stem:d.stem,...(c.submitted?{expected:'A'}:{})}),
  grade: (d,a) => ({score:a.value==='A'?3:0,maxScore:3,correct:a.value==='A',gradingStatus:'graded',feedback:'Synthetic feedback'}),
  review: (d,a,r,c) => ({...c.result,score:r.score,maxScore:3,correct:r.score===3,gradingStatus:'graded',feedback:r.feedback || 'Reviewed'}),
  getOutlineItems: d => d.parts || [],
  getScore: (d,s) => ({score:s.result?.score || 0,maxScore:3,outlineStates:(d.parts || []).map(p=>({id:p.id,status:s.submitted?(s.result.correct?'correct':'incorrect'):(s.status==='draft'?'draft':'unanswered')}))}),
  prepareAiGrading: (d,a,c) => ({protocolVersion:1,question:[{type:'text',text:d.stem}],answer:[{type:'text',text:a.value}],referenceAnswer:[{type:'text',text:'A'}],maxScore:3,scoreStep:0.5})
});`;

export async function runScenario(codeRoot, {memory = false, observe = () => {}, beforeAction = () => {}, afterAction = () => {}} = {}) {
  // Keep real Date.now/performance clocks and rule-runner timeout behavior.
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-11-10T12:00:00.000Z'])); } };
  let sequence = 0;
  const originalUUID = crypto.randomUUID, originalBytes = crypto.randomBytes;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  crypto.randomBytes = size => Buffer.alloc(size, 42);
  syncBuiltinESMExports();
  const module = relative => import(pathToFileURL(path.join(codeRoot, 'server/host', relative)).href);
  const [{StateStore}, {Library}, {RuleEngine}, {cloneJson, jsonBytes, parseJson}] = await Promise.all([
    module('practice/state-store.js'), module('library/library.js'), module('extensions/rule-engine.js'), module('platform/json.js')
  ]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'qf-state-golden-'));
  const write = (relative, value) => { const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:jsonBytes(value)); };
  let engine, library;
  const events = [];
  try {
    const rawQuestions = Array.from({length:20},(_,i)=>({id:'q'+String(i+1).padStart(3,'0'),title:'Synthetic '+(i+1),extension:{path:'extensions/Golden/type'+i%3},data:{stem:'Synthetic problem '+(i+1),...(i%3===2?{parts:[{id:'p0',label:'1'},{id:'p1',label:'2'}]}:{})}}));
    for(let type=0;type<3;type++) {
      const base='extensions/Golden/type'+type+'/';
      write(base+'manifest.json',{id:'golden.type'+type,version:'1.0.0',name:'Golden '+type,entry:'practice.html',script:'practice.js',style:'practice.css',rules:'rules.js',examples:'examples.json',questionSchema:'question.schema.json',answerSchema:'answer.schema.json',requiresApi:{major:1,minMinor:1,capabilities:['practice','score','outline-items','manual-review','ai-grading']}});
      write(base+'question.schema.json',{type:'object',required:['stem'],properties:{stem:{type:'string'},parts:{type:'array',items:{type:'object'}}},additionalProperties:false});
      write(base+'answer.schema.json',{type:'object',required:['value'],properties:{value:{type:'string'}},additionalProperties:false});
      write(base+'practice.html','<p>Deterministic golden fixture</p>');write(base+'practice.js','/* synthetic page */');write(base+'practice.css','p { color: black; }');write(base+'rules.js',rulesSource);
      write(base+'examples.json',{id:'golden-examples-'+type,title:'Golden examples',questions:[rawQuestions[type]]});
    }
    write('question-banks/Golden/bank/bank.json',{id:'golden-bank',title:'Golden state fixture',questions:rawQuestions});
    engine=await RuleEngine.create(codeRoot);library=new Library(root,codeRoot,engine);
    const collection=await library.collection('bank','golden-bank'), store=memory?StateStore.memory(root,engine):new StateStore(root,engine);
    store.stampKey=Buffer.alloc(32,42);
    const ink = n => ({schemaVersion:1,viewport:{x:0,y:0,zoom:1},paper:{color:'#ffffff',pattern:'plain'},strokes:[{id:'ink-'+n,color:'#334455',width:2,points:[{x:n,y:12,pressure:0.5},{x:n+10,y:20,pressure:0.7}]}]});
    const seed=cloneJson(store.load(collection));
    for(const [i,q] of collection.questions.entries()) seed.questions[q.id]={status:'draft',revision:8,fingerprint:q.fingerprint,answer:{value:'A'},result:null,draft:ink(i),receipts:[]};
    // Numeric node metadata, including floating and rounded integer literals.
    seed.questions.q020.answer=parseJson('{"value":"A"}');
    const old=seed.questions.q020;
    old.receipts=Array.from({length:8},(_,i)=>({id:'old-request-'+i,request:{requestId:'old-request-'+i,revision:i,action:i%2?'whiteboard':'draft',data:i%2?{draft:ink(i)}:{answer:{value:'A'}}},response:{state:{status:'draft',revision:i+1,answer:{value:'A'},result:null},draft:ink(i)}}));
    const round=await store.freezeRound(collection,seed,collection.questions.map(q=>seed.questions[q.id]));round.status='interrupted';round.interruptionReason='synthetic-seed';seed.historyRounds=[round];
    store.commit(collection,seed);
    let operation=0;
    async function guarded(label, fn, {failure = false} = {}) {
      const before=store.load(collection), bytes=jsonBytes(before), disk=memory?null:fs.readFileSync(store.file(collection)), cached=store.cachedBytes;
      let result;
      beforeAction(label);
      if(failure) await assert.rejects(fn,failure); else result=await fn();
      afterAction(label);
      assert.ok(jsonBytes(before).equals(bytes),'old state mutated: '+label);
      if(failure) {assert.equal(store.load(collection),before);assert.equal(store.cachedBytes,cached);if(disk)assert.ok(fs.readFileSync(store.file(collection)).equals(disk));}
      events.push(label); await observe({label,before,after:store.load(collection),store,collection,bytes});return result;
    }
    const request = (qid,action,data) => ({requestId:'golden-action-'+String(++operation).padStart(3,'0'),revision:store.load(collection).questions[qid].revision,action,data});
    const act = (qid,action,data) => guarded(action+':'+qid,()=>store.act(collection,collection.question(qid),request(qid,action,data)));
    const replay=request('q001','draft',{answer:{value:'B'}});
    const first=await guarded('draft:first',()=>store.act(collection,collection.question('q001'),replay));
    assert.deepEqual(await guarded('replay',()=>store.act(collection,collection.question('q001'),replay)),first);
    await act('q001','whiteboard',{draft:ink(50)});
    await guarded('rule-rejected',()=>store.act(collection,collection.question('q001'),request('q001','draft',{answer:{value:'REJECT'}})),{failure:error=>error.code==='RULE_REJECTED'});
    if(!memory) {
      const rename=fs.renameSync;let injected=0;
      const retry=request('q002','draft',{answer:{value:'B'}});
      fs.renameSync=(source,target)=>{if(target===store.file(collection)&&injected++===0)throw Object.assign(new Error('synthetic disk failure'),{code:'EIO'});return rename(source,target);};
      try {await guarded('write-failed',()=>store.act(collection,collection.question('q002'),retry),{failure:error=>error.code==='STATE_WRITE_FAILED'});}finally{fs.renameSync=rename;}
      assert.equal(injected,1);await guarded('write-retry',()=>store.act(collection,collection.question('q002'),retry));
    } else {
      // The successful retry has exactly the same request ID in the memory run.
      operation++;await guarded('write-retry',()=>store.act(collection,collection.question('q002'),{requestId:'golden-action-'+String(operation).padStart(3,'0'),revision:8,action:'draft',data:{answer:{value:'B'}}}));
    }
    await act('q001','submit',{answer:{value:'A'}});await act('q002','submit',{answer:{value:'B'}});await act('q003','submit',{answer:{value:'A'}});
    await act('q001','review',{review:{score:2.5,feedback:'Whole review'}});
    // Exercise both targeted maps, including deletion by a manual review.
    let snap=await store.prepareAiGrading(collection,collection.question('q003'),{targetId:'p0'});
    await guarded('bind:target',()=>store.bindAiTask(collection,collection.question('q003'),snap,'a'.repeat(64)));
    await act('q003','review',{review:{score:2,targetId:'p0',feedback:'Target review'}});
    snap=await store.prepareAiGrading(collection,collection.question('q003'),{targetId:'p1'});
    await guarded('bind:target',()=>store.bindAiTask(collection,collection.question('q003'),snap,'c'.repeat(64)));
    await act('q003','review',{review:{score:2.5,targetId:'p1',feedback:'Second target review'}});
    snap=await store.prepareAiGrading(collection,collection.question('q001'),{});
    await guarded('bind:whole',()=>store.bindAiTask(collection,collection.question('q001'),snap,'b'.repeat(64)));
    await guarded('confirm-ai',()=>store.confirmAi(collection,collection.question('q001'),snap,'b'.repeat(64),'golden-confirm-001','candidate-001',2.5,{score:2.5,maxScore:3,feedback:'Synthetic AI feedback'}));
    await act('q002','retry',{});await act('q002','submit',{answer:{value:'A'}});
    const summary=await store.summary(collection);
    await guarded('finish',()=>store.finish(collection,{requestId:'golden-finish-001',roundId:summary.roundId,summaryVersion:summary.summaryVersion}));
    const finished=await store.summary(collection);
    await guarded('restart',()=>store.restart(collection,{requestId:'golden-restart-001',roundId:finished.roundId,summaryVersion:finished.summaryVersion}));
    await act('q001','draft',{answer:{value:'B'}});await act('q001','whiteboard',{draft:ink(70)});
    const bytes=memory?jsonBytes(store.load(collection)):fs.readFileSync(store.file(collection));
    assert.ok(bytes.length<=300*1024);return {bytes,events,questions:collection.questions.length};
  } finally {
    library?.close();await engine?.close();
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-state-golden-'));fs.rmSync(root,{recursive:true,force:true});
    globalThis.Date=RealDate;crypto.randomUUID=originalUUID;crypto.randomBytes=originalBytes;syncBuiltinESMExports();
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [codeRoot, output, mode]=process.argv.slice(2);
  if(!codeRoot||!output)throw Error('Usage: state-golden-scenario.mjs <core-directory> <new-output-file> [memory]');
  if(fs.existsSync(output))throw Error('Refusing to overwrite an existing golden file');
  const {bytes,events,questions}=await runScenario(path.resolve(codeRoot),{memory:mode==='memory'});
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,bytes,{flag:'wx'});
  console.log(JSON.stringify({bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),questions,events}));
}
