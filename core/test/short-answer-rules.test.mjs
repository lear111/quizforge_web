import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const extension=fileURLToPath(new URL('../../extensions/short-answer/',import.meta.url));
const files={rules:`${extension}rules.js`,questionSchema:`${extension}question.schema.json`,answerSchema:`${extension}answer.schema.json`};
const bank=JSON.parse(readFileSync(new URL('../../question-banks/short-answer-demo/bank.json',import.meta.url),'utf8'));
const answer={formatVersion:1,document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'我的回答',marks:[{type:'bold'}]}]}]}};
const copy=value=>JSON.parse(JSON.stringify(value));
function call(payload){const result=spawnSync(process.execPath,[fileURLToPath(new URL('../server/rules-runner.cjs',import.meta.url))],{input:JSON.stringify({...files,...payload}),encoding:'utf8',timeout:4000,maxBuffer:3*1024*1024});assert.equal(result.error,undefined,result.error?.message);return JSON.parse(result.stdout);}
test('all short-answer demo documents validate; private reference and rubric appear only after submit',()=>{
  assert.equal(call({op:'validateBank',questions:bank.questions.map(row=>row.data)}).ok,true);
  for(const row of bank.questions){const before=call({op:'project',data:row.data,state:{submitted:false,result:null}});assert.equal(before.ok,true);assert.equal(before.data.projected.referenceAnswer,undefined);assert.equal(before.data.projected.rubric,undefined);assert.deepEqual(before.data.projected.stem,row.data.stem);
    const after=call({op:'submit',data:row.data,answer});assert.equal(after.ok,true);assert.deepEqual(after.data.projected.referenceAnswer,row.data.referenceAnswer);assert.deepEqual(after.data.projected.rubric,row.data.rubric);assert.deepEqual(after.data.result,{gradingStatus:'pending',score:null,maxScore:row.data.maxScore,correct:null,feedback:null});}
});
test('draft may be empty, submit cannot; malformed rich text and external image URLs are rejected',()=>{
  const data=bank.questions[0].data,empty={formatVersion:1,document:{type:'doc',content:[{type:'paragraph'}]}};
  assert.equal(call({op:'validateAnswer',data,answer:empty}).ok,true);assert.equal(call({op:'submit',data,answer:empty}).ok,false);
  for(const document of [{type:'doc',content:[{type:'image',attrs:{assetId:'a'.repeat(64),src:'https://example.com/private.png'}}]},{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'bad',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]},{type:'doc',content:[{type:'script',content:[]}]}])assert.equal(call({op:'validateAnswer',data,answer:{formatVersion:1,document}}).ok,false);
});
test('manual review accepts half points and never invents a score before confirmation',()=>{
  const data=bank.questions[0].data,pending=call({op:'submit',data,answer}).data.result;
  const score=call({op:'scoreBatch',questions:[{data,state:{status:'submitted',answer,result:pending}},{data,state:{status:'unanswered',answer:null,result:null}}]});assert.equal(score.ok,true);assert.deepEqual(score.data.scores,[{score:null,maxScore:5,gradingStatus:'pending'},{score:0,maxScore:5,gradingStatus:'unsubmitted'}]);
  for(const value of [0,.5,2.5,5]){const reviewed=call({op:'review',data,answer,review:{score:value,feedback:'人工确认'}});assert.equal(reviewed.ok,true);assert.deepEqual(reviewed.data.result,{gradingStatus:'graded',score:value,maxScore:5,correct:value===5,feedback:'人工确认'});}
  for(const value of [-.5,.25,5.5])assert.equal(call({op:'review',data,answer,review:{score:value}}).ok,false);
  const changed=copy(data);changed.maxScore=2.75;assert.equal(call({op:'validateBank',questions:[changed]}).ok,false);
});
