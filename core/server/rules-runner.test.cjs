'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const runner = path.resolve(__dirname, 'rules-runner.cjs');
const modules = path.resolve(__dirname, '../node_modules');
function fixture(t, rules) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qf-rules-')); t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const files = {rules:path.join(directory,'rules.js'),questionSchema:path.join(directory,'question.json'),answerSchema:path.join(directory,'answer.json')};
  fs.writeFileSync(files.rules,rules); fs.writeFileSync(files.questionSchema,JSON.stringify({type:'object',required:['secret'],additionalProperties:false,properties:{secret:{type:'string'}}})); fs.writeFileSync(files.answerSchema,JSON.stringify({type:'string',minLength:1})); return files;
}
const normal = `QF.defineType({project(data,state){return state.submitted?{reveal:data.secret}:{prompt:'public'};},validateAnswer(answer){return answer!=='bad';},grade(data,answer){return {score:answer===data.secret?1:0,maxScore:1,correct:answer===data.secret,feedback:'graded'};}});`;
function call(files, payload, extra=[]) {
  const args=['--permission','--max-old-space-size=96',`--allow-fs-read=${runner}`,`--allow-fs-read=${modules}`,...Object.values(files).map(file=>`--allow-fs-read=${file}`),...extra,runner];
  const result=spawnSync(process.execPath,args,{input:JSON.stringify({...files,...payload}),encoding:'utf8',timeout:4000,maxBuffer:3*1024*1024,env:{SystemRoot:process.env.SystemRoot}});
  assert.equal(result.error,undefined,result.error?.message); return {status:result.status,body:JSON.parse(result.stdout)};
}

test('development partial rules display data without relaxing formal registration', t => {
  const files=fixture(t,`QF.defineType({project(data){return {prompt:data.secret};}});`);
  const request={op:'project',data:{secret:'design fixture'},state:{submitted:false,result:null}};
  assert.equal(call(files,request).body.ok,false,'Formal extensions still require a grade hook.');
  const preview=call(files,{...request,development:true,questionSchema:null,answerSchema:null}).body;
  assert.deepEqual(preview.data,{projected:{prompt:'design fixture'}});
  const submit=call(files,{op:'submit',development:true,data:{secret:'design fixture'},answer:'yes'}).body;
  assert.equal(submit.ok,false);assert.equal(submit.code,'DEVELOPMENT_NOT_IMPLEMENTED');
  assert.match(submit.error,/grade/);assert.equal(Object.hasOwn(submit,'data'),false);
});

test('a development page without rule hooks has no invented score', t => {
  const files=fixture(t,`QF.defineType({});`);
  const preview=call(files,{op:'projectBatch',development:true,questions:[{data:{secret:'fixture'},state:{submitted:false,result:null}}]}).body;
  assert.deepEqual(preview.data,{projected:[{secret:'fixture'}]});
  const summary=call(files,{op:'scoreBatch',development:true,questions:[{data:{secret:'fixture'},state:{status:'unanswered',answer:null,result:null}}]}).body;
  assert.equal(summary.ok,false);assert.equal(summary.code,'DEVELOPMENT_NOT_IMPLEMENTED');
  assert.equal(Object.hasOwn(summary,'data'),false);
});

test('missing development answer schema cannot pretend to save or submit an answer', t => {
  const files=fixture(t,normal);
  for(const op of ['validateAnswer','submit']){
    const value=call(files,{op,development:true,answerSchema:null,data:{secret:'yes'},answer:'yes'}).body;
    assert.equal(value.ok,false,op);assert.equal(value.code,'DEVELOPMENT_NOT_IMPLEMENTED',op);
    assert.match(value.error,/answer schema/);
  }
});

test('explicit development placeholders report unsupported operations without valid grade data', t => {
  const files=fixture(t,`QF.defineType({project(){return {maxScore:1};},grade(){const error=new Error('Grading is unfinished');error.code='DEVELOPMENT_NOT_IMPLEMENTED';throw error;}});`);
  const request={op:'submit',data:{secret:'yes'},answer:'yes'};
  const development=call(files,{...request,development:true}).body;
  assert.equal(development.ok,false);assert.equal(development.code,'DEVELOPMENT_NOT_IMPLEMENTED');
  const formal=call(files,request).body;
  assert.equal(formal.ok,false);assert.equal(Object.hasOwn(formal,'code'),false,'No extra public contract for formal extensions.');
});

test('complete development rules keep formal grading and schema validation', t => {
  const files=fixture(t,normal),request={op:'submit',data:{secret:'yes'},answer:'yes'};
  assert.deepEqual(call(files,{...request,development:true}).body,call(files,request).body);
  const invalid=call(files,{...request,development:true,answer:7}).body;
  assert.equal(invalid.ok,false);assert.match(invalid.error,/schema/);
});
test('draft-07 AJV validates raw questions and answers before rules',t=>{
  const files=fixture(t,normal); assert.equal(require('ajv/package.json').version,'8.20.0');
  assert.equal(call(files,{op:'validateBank',questions:[{secret:'yes'}]}).body.ok,true);
  assert.equal(call(files,{op:'validateBank',questions:[{secret:7}]}).body.ok,false);
  assert.equal(call(files,{op:'submit',data:{secret:'yes'},answer:{value:'yes'}}).body.ok,false);
  assert.equal(call(files,{op:'validateAnswer',data:{secret:'yes'},answer:'bad'}).body.ok,false);
});
test('only public projection is returned until submission',t=>{
  const files=fixture(t,normal); const projected=call(files,{op:'project',data:{secret:'yes'},state:{submitted:false,result:null}});
  assert.deepEqual(projected.body.data,{projected:{prompt:'public'}});
  const graded=call(files,{op:'submit',data:{secret:'yes'},answer:'yes'}); assert.equal(graded.body.data.result.score,1); assert.equal(graded.body.data.projected.reveal,'yes');
});

test('legacy rules and explicit v1 rules share an immutable host contract without changing grading',t=>{
  const files=fixture(t,`QF.defineType({
    project(data,state){
      let protectedMetadata=false;try{QF.api.capabilities.push('unexpected');}catch{protectedMetadata=true;}
      return {major:QF.api.major,minor:QF.api.minor,protectedMetadata,
        frozen:Object.isFrozen(QF.api)&&Object.isFrozen(QF.api.capabilities),
        canReview:QF.api.capabilities.includes('manual-review'),reveal:state.submitted?data.secret:null};
    },
    grade(data,answer){return {score:answer===data.secret?1:0,maxScore:1,correct:answer===data.secret,feedback:'graded'};}
  });`);
  const request={op:'project',data:{secret:'yes'},state:{submitted:false,result:null}};
  const legacy=call(files,request).body,declared=call(files,{...request,apiVersion:{major:1,minor:0,description:'v1'}}).body;
  assert.deepEqual(legacy,declared);
  assert.deepEqual(legacy.data.projected,{major:1,minor:2,protectedMetadata:true,frozen:true,canReview:true,reveal:null});
  const submitted=call(files,{op:'submit',data:{secret:'yes'},answer:'yes',apiVersion:{major:1,minor:0}}).body;
  assert.equal(submitted.data.result.score,1);assert.equal(submitted.data.projected.reveal,'yes');
});

test('invalid and future rule API versions are rejected before reading extension code',t=>{
  const files=fixture(t,normal);
  for(const apiVersion of [{major:2,minor:0},{major:1,minor:3}]){
    const result=call(files,{rules:path.join(path.dirname(files.rules),'missing.js'),op:'capabilities',apiVersion}).body;
    assert.equal(result.ok,false);assert.equal(result.code,'UNSUPPORTED_API_VERSION');
  }
  for(const apiVersion of [null,{major:'1',minor:0},{major:1,minor:-1},{major:1}]){
    const result=call(files,{rules:path.join(path.dirname(files.rules),'missing.js'),op:'capabilities',apiVersion}).body;
    assert.equal(result.ok,false);assert.equal(result.code,'INVALID_API_VERSION');
  }
});

test('getScore v1.2 adds bounded child display states without changing aggregate scoring',t=>{
  const hook=`QF.defineType({project(){return {maxScore:3};},grade(){return {};},
    getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:3,
      outlineStates:state.submitted?state.result.feedback:[{id:'part-a',status:'unanswered'}]};}});`;
  const files=fixture(t,hook), result={score:1,maxScore:3,correct:false,feedback:[{id:'part-a',status:'correct'},{id:'part-b',status:'incorrect'}]};
  for(const minor of [0,1,2]){
    const response=call(files,{op:'scoreBatch',apiVersion:{major:1,minor},questions:[
      {data:{secret:'x'},state:{status:'unanswered',answer:null,result:null}},
      {data:{secret:'x'},state:{status:'draft',answer:'saved',result:null}},
      {data:{secret:'x'},state:{status:'submitted',answer:'saved',result}},
      {data:{secret:'x'},state:{status:'submitted',answer:'saved',result:{gradingStatus:'pending',score:null,maxScore:3,correct:null,feedback:[{id:'part-a',status:'correct'},{id:'part-b',status:'unanswered'}]}}}
    ]}).body;
    assert.equal(response.ok,true,JSON.stringify(response));
    assert.deepEqual(response.data.scores.map(row=>row.score),[0,0,1,null]);
    assert.equal(response.data.scores[0].outlineStates[0].status,'unanswered');
    assert.equal(response.data.scores[1].outlineStates[0].status,'unanswered');
    assert.deepEqual(response.data.scores[2].outlineStates,result.feedback);
    assert.equal(response.data.scores[3].outlineStates[1].status,'unanswered');
  }
});

test('invalid outline states and pre-submit grading are rejected while absence and empty arrays remain valid',t=>{
  const payload={op:'scoreBatch',questions:[{data:{secret:'x'},state:{status:'draft',answer:'saved',result:null}}]};
  for(const expression of ['null','{}',"[{id:'a',status:'wrong'}]","[{id:'a',status:'correct'}]","[{id:'a',status:'incorrect'}]","[{id:'a',status:'unanswered',score:1}]","[{id:'a',status:'unanswered'},{id:'a',status:'unanswered'}]","[{id:'<a>',status:'unanswered'}]","[{id:' a',status:'unanswered'}]","[{id:'x'.repeat(129),status:'unanswered'}]","Array.from({length:101},(_,i)=>({id:String(i),status:'unanswered'}))"]){
    const files=fixture(t,`QF.defineType({project(){return {};},grade(){return {};},getScore(){return {score:0,maxScore:1,outlineStates:${expression}};}});`);
    const response=call(files,payload).body;assert.equal(response.ok,false,expression);assert.equal(response.code,'INVALID_OUTLINE_STATES',expression);
  }
  for(const addition of ['',',outlineStates:[]']){
    const files=fixture(t,`QF.defineType({project(){return {};},grade(){return {};},getScore(){return {score:0,maxScore:1${addition}};}});`);
    const response=call(files,payload).body;assert.equal(response.ok,true);assert.equal(Object.hasOwn(response.data.scores[0],'outlineStates'),!!addition);
  }
});
test('outline status contract stays three-state even after submission',t=>{
  const payload={op:'scoreBatch',questions:[{data:{secret:'x'},state:{status:'submitted',answer:'saved',result:{score:0.5,maxScore:1,correct:false,feedback:null}}}]};
  for(const status of ['draft','partial','pending-review','submitted']){
    const files=fixture(t,`QF.defineType({project(){return {};},grade(){return {};},getScore(){return {score:0.5,maxScore:1,outlineStates:[{id:'a',status:'${status}'}]};}});`);
    const response=call(files,payload).body;assert.equal(response.ok,false,status);assert.equal(response.code,'INVALID_OUTLINE_STATES',status);
  }
});
test('batch projections preserve order and keep unsubmitted answers hidden',t=>{
  const files=fixture(t,normal);
  const result=call(files,{op:'projectBatch',questions:[
    {data:{secret:'first-secret'},state:{submitted:false,result:null}},
    {data:{secret:'second-secret'},state:{submitted:true,result:{score:1}}},
    {data:{secret:'third-secret'},state:{submitted:false,result:null}}
  ]});
  assert.equal(result.body.ok,true);
  assert.deepEqual(result.body.data.projected,[{prompt:'public'},{reveal:'second-secret'},{prompt:'public'}]);
  assert.equal(JSON.stringify(result.body).includes('first-secret'),false);
  assert.equal(JSON.stringify(result.body).includes('third-secret'),false);
});
test('batch projection rejects invalid questions, states and accumulated output',t=>{
  const files=fixture(t,normal);
  assert.equal(call(files,{op:'projectBatch',questions:[{data:{secret:7},state:{submitted:false}}]}).body.ok,false);
  assert.equal(call(files,{op:'projectBatch',questions:[{data:{secret:'yes'},state:{submitted:'false'}}]}).body.ok,false);
  const large=fixture(t,`QF.defineType({project(){return 'x'.repeat(1100000);},grade(){return {};}});`);
  assert.equal(call(large,{op:'projectBatch',questions:[1,2].map(()=>({data:{secret:'yes'},state:{submitted:false}}))}).body.ok,false);
});
test('VM rule cannot directly access process, require, fetch or filesystem',t=>{
  const files=fixture(t,`QF.defineType({project(){return {process:typeof process,require:typeof require,fetch:typeof fetch};},grade(){return {score:0,maxScore:1,correct:false,feedback:''};}});`);
  assert.deepEqual(call(files,{op:'project',data:{secret:'yes'},state:{submitted:false}}).body.data.projected,{process:'undefined',require:'undefined',fetch:'undefined'});
  const inaccessible={...files,rules:__filename}; const result=call(files,{...inaccessible,op:'project',data:{secret:'yes'},state:{submitted:false}}); assert.equal(result.body.ok,false);
});
test('VM loops, oversized output and invalid grades are rejected',t=>{
  let files=fixture(t,`QF.defineType({project(){while(true){}},grade(){return {};}});`); const before=Date.now(); assert.equal(call(files,{op:'project',data:{secret:'yes'},state:{submitted:false}}).body.ok,false); assert.ok(Date.now()-before<3500);
  files=fixture(t,`QF.defineType({project(){return 'x'.repeat(2200000);},grade(){return {};}});`); assert.equal(call(files,{op:'project',data:{secret:'yes'},state:{submitted:false}}).body.ok,false);
  files=fixture(t,`QF.defineType({project(){return {};},grade(){return {score:2,maxScore:1,correct:true,feedback:''};}});`); assert.equal(call(files,{op:'submit',data:{secret:'yes'},answer:'yes'}).body.ok,false);
});

const manual = `QF.defineType({project(data,state){return state.submitted?{reference:data.secret}:{prompt:'public'};},grade(){return {gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:'pending'};},review(data,answer,value){if(!Number.isInteger(value.score*2))throw Error('half points');return {gradingStatus:'graded',score:value.score,maxScore:5,correct:value.score===5,feedback:'reviewed'};},getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:5};}});`;

test('pending grade preserves unknown score and scoring batch separates graded and unsubmitted',t=>{
  const files=fixture(t,manual), submitted=call(files,{op:'submit',data:{secret:'reference'},answer:'answer'});
  assert.equal(submitted.body.ok,true); const pending=submitted.body.data.result;
  assert.equal(pending.score,null); assert.equal(pending.correct,null); assert.equal(pending.gradingStatus,'pending');
  const batch=call(files,{op:'scoreBatch',questions:[
    {data:{secret:'a'},state:{status:'submitted',answer:'answer',result:pending}},
    {data:{secret:'b'},state:{status:'submitted',answer:'answer',result:{score:2.5,maxScore:5,correct:false,feedback:'legacy'}}},
    {data:{secret:'c'},state:{status:'draft',answer:'answer',result:null}}
  ]});
  assert.equal(batch.body.ok,true); assert.deepEqual(batch.body.data.scores,[
    {score:null,maxScore:5,gradingStatus:'pending'}, {score:2.5,maxScore:5,gradingStatus:'graded'}, {score:0,maxScore:5,gradingStatus:'unsubmitted'}
  ]);
});

test('review delegates half-point validation and host rejects invalid ranges or pending review results',t=>{
  const files=fixture(t,manual), payload={op:'review',data:{secret:'a'},answer:'answer',review:{score:3.5}};
  const reviewed=call(files,payload); assert.equal(reviewed.body.ok,true); assert.equal(reviewed.body.data.result.score,3.5);
  assert.equal(reviewed.body.data.projected.reference,'a');
  for(const value of [-0.5,5.5,2.25,'3.5'])assert.equal(call(files,{...payload,review:{score:value}}).body.ok,false);
  assert.equal(call(files,{...payload,answer:''}).body.ok,false);
  const stillPending=fixture(t,manual.replace("gradingStatus:'graded',score:value.score,maxScore:5,correct:value.score===5", "gradingStatus:'pending',score:null,maxScore:5,correct:null"));
  assert.equal(call(stillPending,payload).body.ok,false);
  assert.equal(call(fixture(t,normal),payload).body.ok,false);
  assert.equal(call(fixture(t,manual.replace('review(data,answer,value)', 'review:3,unused(data,answer,value)')),payload).body.ok,false);
});

test('pending results cannot smuggle a zero score or a correctness boolean',t=>{
  for(const invalid of [manual.replace("gradingStatus:'pending',score:null", "gradingStatus:'pending',score:0"),manual.replace('correct:null', 'correct:false')]) {
    assert.equal(call(fixture(t,invalid),{op:'submit',data:{secret:'a'},answer:'answer'}).body.ok,false);
  }
});

test('AI preparation is an optional server rule hook and raw data never leaks through capability probing',t=>{
  const hook=manual.replace('project(data,state)', "prepareAiGrading(data,answer){return {protocolVersion:1,question:[{type:'text',text:'prompt'}],answer:[{type:'text',text:answer}],referenceAnswer:[{type:'text',text:data.secret}],rubric:[{type:'text',text:'rubric'}],maxScore:5,scoreStep:0.5};},project(data,state)");
  const files=fixture(t,hook);
  assert.deepEqual(call(files,{op:'capabilities'}).body.data,{canAiGrade:true,canOutlineItems:false});
  const prepared=call(files,{op:'prepareAiGrading',data:{secret:'private reference'},answer:'submitted answer',state:{status:'submitted',submitted:true,result:{gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:null}}});
  assert.equal(prepared.body.ok,true); assert.equal(prepared.body.data.gradingInput.referenceAnswer[0].text,'private reference'); assert.equal(prepared.body.data.maxScore,5);
  assert.equal(call(fixture(t,normal),{op:'capabilities'}).body.data.canAiGrade,false);
  assert.equal(call(files,{op:'prepareAiGrading',data:{secret:'a'},answer:'',state:{result:{}}}).body.ok,false);
});

test('AI scoring consistency rejects mismatched getScore without extending legacy review rules',t=>{
  const hook=manual.replace('project(data,state)', 'prepareAiGrading(){return {};},project(data,state)');
  const pending={op:'prepareAiGrading',data:{secret:'a'},answer:'answer',state:{status:'submitted',submitted:true,result:{gradingStatus:'pending',score:null,maxScore:5,correct:null,feedback:null}}};
  const review={op:'review',data:{secret:'a'},answer:'answer',review:{score:3.5}};
  for(const bad of [hook.replace('score:state.submitted?state.result.score:0', 'score:0'),hook.replace('getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:5}', 'getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:4}')]) {
    const files=fixture(t,bad);
    for(const payload of [pending,review]) { const result=call(files,payload).body; assert.equal(result.ok,false); assert.equal(result.code,'SCORE_UNAVAILABLE'); }
  }
  assert.equal(call(fixture(t,manual.replace('score:state.submitted?state.result.score:0', 'score:0')),review).body.ok,true);
});

test('outline metadata is opt-in, ordered, bounded and independent of parent grading',t=>{
  const hook=normal.replace('project(data,state)', "getOutlineItems(){return [{id:'part-2',label:'(2)'},{id:'part-1',label:'(1)'},{id:'读写题',label:'补充题'}];},project(data,state)");
  const files=fixture(t,hook), contract={apiVersion:{major:1,minor:1},outlineItemsDeclared:true};
  const probe=call(files,{...contract,op:'validateBank',questions:[{secret:'yes'}],withCapabilities:true}).body;
  assert.equal(probe.ok,true);assert.equal(probe.data.capabilities.canOutlineItems,true);
  const metadata=call(files,{...contract,op:'outlineBatch',questions:[{secret:'yes'},{secret:'other'}]}).body;
  assert.equal(metadata.ok,true);assert.equal(metadata.data.outlineItems.length,2);
  assert.deepEqual(metadata.data.outlineItems[0],[{id:'part-2',label:'(2)'},{id:'part-1',label:'(1)'},{id:'读写题',label:'补充题'}]);
  assert.equal(JSON.stringify(metadata).includes('yes'),false);
  const submitted=call(files,{...contract,op:'submit',data:{secret:'yes'},answer:'yes'}).body;
  assert.equal(submitted.ok,true);assert.equal(submitted.data.result.score,1);assert.equal(submitted.data.result.maxScore,1);
  const missing=call(fixture(t,normal),{...contract,op:'outlineBatch',questions:[{secret:'yes'}]}).body;
  assert.deepEqual(missing.data,{outlineItems:[[]]});
  for(const payload of [{op:'validateBank',questions:[{secret:'yes'}]}, {...contract,apiVersion:{major:1,minor:0},op:'outlineBatch',questions:[{secret:'yes'}]}, {...contract,outlineItemsDeclared:false,op:'capabilities'}]) {
    const rejected=call(files,payload).body;assert.equal(rejected.ok,false);assert.equal(rejected.code,'INVALID_OUTLINE_ITEMS');
  }
});

test('outline hook rejects malformed arrays, unsafe labels, duplicate ids and hidden fields',t=>{
  const contract={apiVersion:{major:1,minor:1},outlineItemsDeclared:true,op:'outlineBatch',questions:[{secret:'yes'}]};
  for(const expression of ['undefined','null','{}',"[{id:'same',label:'1'},{id:'same',label:'2'}]","[{id:'x',label:'<b>1</b>'}]","[{id:'x',label:'1',secret:'hidden'}]","[{id:' x',label:'1'}]","[{id:'x',label:'\\n'}]","[{id:'x'.repeat(129),label:'1'}]","[{id:'x',label:'1'.repeat(81)}]","Array.from({length:101},(_,i)=>({id:String(i),label:'1'}))"]) {
    const hook=normal.replace('project(data,state)',`getOutlineItems(){return ${expression};},project(data,state)`);
    const result=call(fixture(t,hook),contract).body;assert.equal(result.ok,false,expression);assert.equal(result.code,'INVALID_OUTLINE_ITEMS',expression);
  }
});
