import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {toAiBlocks,prepareAiGrading} from './fixtures/legacy-extensions/short-answer-1.1.0/src/ai-document.js';
const coreRoot=new URL('../',import.meta.url),root=new URL('../../',import.meta.url),sample=JSON.parse(readFileSync(new URL('core/test/fixtures/legacy-banks/short-answer-ai-demo/bank.json',root),'utf8'));
const doc=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]}),answer={formatVersion:1,document:doc('回答')};
const copy=value=>JSON.parse(JSON.stringify(value));
test('pure conversion preserves paragraph, nested list, code and image order without runtime URLs',()=>{
  const document={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'标题'}]},{type:'paragraph',content:[{type:'text',text:'第一行'},{type:'hardBreak'},{type:'text',text:'第二行',marks:[{type:'bold'}]}]},{type:'orderedList',attrs:{start:2},content:[{type:'listItem',content:[doc('项目').content[0],{type:'bulletList',content:[{type:'listItem',content:[doc('子项').content[0]]}]}]}]},{type:'image',attrs:{assetId:'a'.repeat(64),alt:'流程图'}},{type:'codeBlock',attrs:{language:'java'},content:[{type:'text',text:'return 1;'}]},{type:'blockquote',content:[doc('引用内容').content[0]]}]};
  const before=copy(document),blocks=toAiBlocks(document);assert.deepEqual(document,before);assert.equal(blocks.length,3);assert.deepEqual(blocks[1],{type:'image',assetId:'a'.repeat(64),alt:'流程图'});assert.match(blocks[0].text,/## 标题\n\n第一行\n第二行/);assert.match(blocks[0].text,/2\. 项目/);assert.match(blocks[0].text,/• 子项/);assert.match(blocks[2].text,/```java\nreturn 1;\n```/);assert.match(blocks[2].text,/> 引用内容/);assert.equal(JSON.stringify(blocks).includes('src'),false);
});
test('protocol contains private reference only in grading input and rejects empty or malformed submitted content',()=>{
  const data=sample.questions[0].data,result=prepareAiGrading(data,answer);assert.deepEqual(Object.keys(result),['protocolVersion','question','answer','referenceAnswer','rubric','maxScore','scoreStep']);assert.equal(result.protocolVersion,1);assert.equal(result.scoreStep,.5);assert.deepEqual(result.answer,[{type:'text',text:'回答'}]);assert.ok(result.referenceAnswer.length);assert.ok(result.rubric.length);
  assert.throws(()=>prepareAiGrading(data,{formatVersion:1,document:{type:'doc',content:[{type:'paragraph'}]}}),/文档/);const unsafe=copy(data);unsafe.stem={type:'doc',content:[{type:'image',attrs:{assetId:'b'.repeat(64),src:'https://example.com/picture.png'}}]};assert.throws(()=>prepareAiGrading(unsafe,answer),/文档/);
});
test('packaged new extension exposes AI capability through real runner while old public projection stays private',()=>{
  const extension=fileURLToPath(new URL('core/test/fixtures/legacy-extensions/short-answer-1.1.0/',root)),files={rules:extension+'rules.js',questionSchema:extension+'question.schema.json',answerSchema:extension+'answer.schema.json'};
  function call(payload){const process=spawnSync(globalThis.process.execPath,[fileURLToPath(new URL('server/rules-runner.cjs',coreRoot))],{input:JSON.stringify({...files,...payload}),encoding:'utf8',timeout:5000,maxBuffer:3*1024*1024});assert.equal(process.error,undefined,process.error?.message);return JSON.parse(process.stdout);}
  assert.equal(call({op:'validateBank',questions:sample.questions.map(row=>row.data)}).ok,true);
  const before=call({op:'project',data:sample.questions[0].data,state:{submitted:false,result:null},withCapabilities:true});assert.equal(before.ok,true);assert.equal(before.data.projected.referenceAnswer,undefined);assert.equal(before.data.projected.rubric,undefined);assert.equal(before.data.capabilities.canAiGrade,true);
  const state={status:'submitted',submitted:true,result:{gradingStatus:'pending',score:null,correct:null,maxScore:sample.questions[0].data.maxScore,feedback:null}};
  const prepared=call({op:'prepareAiGrading',data:sample.questions[0].data,answer,state});assert.equal(prepared.ok,true);assert.deepEqual(prepared.data.gradingInput,prepareAiGrading(sample.questions[0].data,answer));
});
