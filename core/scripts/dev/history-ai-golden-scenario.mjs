// Independent second golden scenario. Existing state-golden fixtures stay intact.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const names=['wholeAutomatic','targetAutomatic','finishThenSubmit','incompatibleFinish','allOptionalDraft','allOptionalSubmitted'];
const rules=`QF.defineType({
 validateQuestion:d=>typeof d.stem==='string',validateAnswer:a=>typeof a?.value==='string',
 project:(d,c)=>({stem:d.stem,...(c.submitted?{expected:'A'}:{})}),
 grade:(d,a)=>({score:3,maxScore:3,correct:true,gradingStatus:'graded',feedback:'Synthetic feedback'}),
 review:(d,a,r,c)=>({...c.state.result,score:r.score,maxScore:3,correct:r.score===3,gradingStatus:'graded',feedback:r.feedback||'Reviewed'}),
 getOutlineItems:d=>d.parts||[],getScore:(d,s)=>({score:s.result?.score||0,maxScore:3,outlineStates:(d.parts||[]).map(p=>({id:p.id,status:s.submitted?'correct':s.status==='draft'?'draft':'unanswered'}))}),
 prepareAiGrading:(d,a)=>({protocolVersion:1,question:[{type:'text',text:d.stem}],answer:[{type:'text',text:a.value}],referenceAnswer:[{type:'text',text:'A'}],maxScore:3,scoreStep:0.5})
});`;

export async function runHistoryAiScenario(codeRoot,{memory=false,observe=()=>{}}={}) {
  const RealDate=globalThis.Date,uuid=crypto.randomUUID,random=crypto.randomBytes;let sequence=0;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-11-11T12:00:00.000Z']));}};
  crypto.randomUUID=()=>`10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;crypto.randomBytes=n=>Buffer.alloc(n,42);syncBuiltinESMExports();
  const module=relative=>import(pathToFileURL(path.join(codeRoot,'server/host',relative)).href);
  const [{StateStore,unsubmittedState},{Library},{RuleEngine},{cloneJson,jsonBytes},{summarize,validateRound}]=await Promise.all([module('practice/state-store.js'),module('library/library.js'),module('extensions/rule-engine.js'),module('platform/json.js'),module('history/history-rounds.js')]);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qf-history-ai-golden-'));let engine,library;
  const write=(relative,value)=>{const file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:jsonBytes(value));};
  const states={},checks=[],payloadPairs=[];
  try {
    const ext='extensions/GoldenAi/type/',questions=Array.from({length:3},(_,i)=>({id:'q'+(i+1),title:'Synthetic '+(i+1),extension:{path:'extensions/GoldenAi/type'},data:{stem:'Synthetic '+(i+1),...(i===0?{parts:[{id:'p0',label:'1'},{id:'p1',label:'2'}]}:{})}}));
    write(ext+'manifest.json',{id:'golden.ai',version:'1.0.0',name:'Golden AI',entry:'practice.html',script:'practice.js',style:'practice.css',rules:'rules.js',examples:'examples.json',questionSchema:'question.schema.json',answerSchema:'answer.schema.json',requiresApi:{major:1,minMinor:3,capabilities:['practice','score','outline-items','answer-state','manual-review','ai-grading']}});
    write(ext+'question.schema.json',{type:'object',required:['stem'],properties:{stem:{type:'string'},parts:{type:'array'}},additionalProperties:false});write(ext+'answer.schema.json',{type:'object',required:['value'],properties:{value:{type:'string'}},additionalProperties:false});
    write(ext+'practice.html','<p>Synthetic AI history</p>');write(ext+'practice.js','/* synthetic */');write(ext+'practice.css','p { color: black; }');write(ext+'rules.js',rules);write(ext+'examples.json',{id:'golden-ai-examples',title:'Synthetic AI examples',questions});
    for(const name of names)write(`question-banks/GoldenAi/${name}/bank.json`,{id:name,title:name,questions});
    engine=await RuleEngine.create(codeRoot);library=new Library(root,codeRoot,engine);
    for(const name of names) {
      const collection=await library.collection('bank',name),store=memory?StateStore.memory(root,engine):new StateStore(root,engine);store.stampKey=Buffer.alloc(32,42);let actionId=0;
      const guarded=async(label,fn)=>{const before=store.load(collection),bytes=jsonBytes(before);let result;try{result=await fn();}catch(error){error.message=name+'/'+label+': '+error.message;throw error;}assert.ok(jsonBytes(before).equals(bytes),'old graph changed: '+name+'/'+label);checks.push(name+'/'+label);return result;};
      const act=(qid,action,data)=>guarded(action+':'+qid,()=>store.act(collection,collection.question(qid),{requestId:name+'-'+(++actionId),revision:store.load(collection).questions[qid]?.revision??0,action,data}));
      const submit=qid=>act(qid,'submit',{answer:{value:'A'}});
      const confirm=async(target=null)=>{
        const q=collection.question('q1'),snapshot=await store.prepareAiGrading(collection,q,target===null?{}:{targetId:target}),taskId=(target===null?'a':'b').repeat(64);
        await guarded('bind',()=>store.bindAiTask(collection,q,snapshot,taskId));
        await guarded('confirm',()=>store.confirmAi(collection,q,snapshot,taskId,name+'-confirm','candidate-1',2.5,{score:2.5,maxScore:3,feedback:'Synthetic AI feedback'}));
        const state=store.load(collection).questions.q1;assert.equal(target===null?state.aiTaskId:state.aiTaskIds[target],taskId);
      };
      const finish=async()=>{const summary=await store.summary(collection);return guarded('finish',()=>store.finish(collection,{requestId:name+'-finish',roundId:summary.roundId,summaryVersion:summary.summaryVersion}));};
      await submit('q1');await confirm(name==='targetAutomatic'?'p0':null);
      if(name.endsWith('Automatic')) {
        await submit('q2');await submit('q3');
        // d3505cf always sets explicitCompletion=true. New API rounds do NOT
        // auto-close. Seed the supported legacy automatic-completion variant,
        // then let the actual baseline summarize calculate completed status.
        const legacy=cloneJson(store.load(collection)),round=legacy.historyRounds.at(-1);
        assert.equal(round.status,'in-progress');assert.equal(round.explicitCompletion,true);
        delete round.explicitCompletion;summarize(round);assert.equal(round.status,'completed');validateRound(round);store.commit(collection,legacy);
        checks.push(name+'/legacy-auto-completed');await act('q2','retry',{});await submit('q2');
        assert.equal(store.load(collection).historyRounds.length,2);
      } else if(name==='finishThenSubmit') {
        await finish();assert.equal(store.load(collection).questions.q2,undefined);await submit('q2');assert.equal(store.load(collection).historyRounds.length,2);
      } else if(name==='incompatibleFinish') {
        // Supported frozen-history shape with a different extension signature;
        // current questions and their stored content identities remain intact.
        const seed=cloneJson(store.load(collection));seed.historyRounds.at(-1).extensionFingerprint='f'.repeat(64);store.commit(collection,seed);
        await finish();assert.equal(store.load(collection).historyRounds[0].interruptionReason,'collection-changed');assert.equal(store.load(collection).historyRounds.length,2);
      } else {
        await finish();const seed=cloneJson(store.load(collection)),q=seed.questions.q1;
        Object.assign(q,{aiTaskId:'a'.repeat(64),aiTaskIds:{p0:'b'.repeat(64)},aiTargetGenerations:{p0:1},submissionGeneration:1,gradingGeneration:2,answerState:{status:'draft',outlineStates:[{id:'p0',status:'draft'}]},outlineStates:[{id:'p0',status:'correct'}],receipts:[{id:'optional-old',request:{requestId:'optional-old'},response:{saved:true}}]});
        for(const field of ['aiTaskId','aiTaskIds','aiTargetGenerations','submissionGeneration','gradingGeneration','answerState','outlineStates','receipts'])assert.ok(Object.hasOwn(q,field),'optional coverage missing '+field);
        if(name==='allOptionalDraft'){q.status='draft';q.result=null;}
        q.draft={schemaVersion:1,viewport:{x:0,y:0,zoom:1},paper:{color:'#ffffff',pattern:'plain'},strokes:[{id:'optional-ink',color:'#334455',width:2,points:[{x:1,y:2,pressure:0.5}]}]};
        store.commit(collection,seed);
        const source=store.load(collection),baseStates=collection.questions.map(item=>unsubmittedState(source.questions[item.id]??{status:'unanswered',revision:0,answer:null,result:null,draft:null,receipts:[]}));
        const expected=await store.freezeRound(collection,source,baseStates);
        await submit('q2');
        payloadPairs.push({name,expected:expected.questions[0].payload,actual:store.load(collection).historyRounds.at(-1).questions[0].payload});
      }
      const saved=memory?jsonBytes(store.load(collection)):fs.readFileSync(store.file(collection));
      for(const round of store.load(collection).historyRounds)validateRound(round);
      states[name]=JSON.parse(saved.toString('utf8'));
      await observe({name,state:store.load(collection),store,collection});
    }
    // Only synthetic integer-valued data is used here. The fixture is a JSON
    // envelope of six actual final state files, compared as a complete Buffer.
    const bytes=jsonBytes(states);return {bytes,checks,payloadPairs};
  } finally {
    library?.close();await engine?.close();
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('qf-history-ai-golden-'));fs.rmSync(root,{recursive:true,force:true});
    globalThis.Date=RealDate;crypto.randomUUID=uuid;crypto.randomBytes=random;syncBuiltinESMExports();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [coreRoot,output,mode]=process.argv.slice(2);if(!coreRoot||!output)throw Error('Usage: history-ai-golden-scenario.mjs <core-root> <new-output> [memory]');
  if(fs.existsSync(output))throw Error('Refusing to overwrite an existing golden file');
  const result=await runHistoryAiScenario(path.resolve(coreRoot),{memory:mode==='memory'});fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,result.bytes,{flag:'wx'});
  console.log(JSON.stringify({bytes:result.bytes.length,sha256:crypto.createHash('sha256').update(result.bytes).digest('hex'),checks:result.checks}));
}
