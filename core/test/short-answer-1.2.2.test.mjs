import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
function run(version,payload){
  const path=fileURLToPath(new URL(`extensions/short-answer-${version}/`,root));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('core/server/rules-runner.cjs',root))],{
    input:JSON.stringify({apiVersion:{major:1,minor:0},rules:path+'rules.js',questionSchema:path+'question.schema.json',answerSchema:path+'answer.schema.json',...payload}),
    encoding:'utf8',timeout:5000,maxBuffer:3*1024*1024
  });
  assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stderr);
  const reply=JSON.parse(result.stdout);assert.equal(reply.ok,true,JSON.stringify(reply.error));return reply.data;
}

test('new package has exact SDK/API bindings while question and answer schemas stay compatible',()=>{
  const manifest=JSON.parse(read('extensions/short-answer-1.2.2/manifest.json'));
  assert.equal(manifest.version,'1.2.2');assert.deepEqual(manifest.dependencies,[{id:'quizforge.richtext',version:'1.1.2'}]);
  assert.equal(manifest.requiresApi.major,1);assert.equal(manifest.requiresApi.minMinor,0);
  for(const schema of ['question.schema.json','answer.schema.json'])assert.equal(read('extensions/short-answer-1.2.2/'+schema),read('extensions/short-answer-1.2.1/'+schema));
  const examples=JSON.parse(read('extensions/short-answer-1.2.2/examples.json'));assert.equal(examples.formatVersion,1);assert.equal(examples.extension.version,'1.2.2');
  run('1.2.2',{op:'validateBank',questions:examples.questions.map(question=>question.data)});
});

test('new rules preserve old rich-answer projection, pending grading, manual score and AI content',()=>{
  const examples=JSON.parse(read('extensions/short-answer-1.2.1/examples.json'));
  const data=examples.questions.at(-1).data;
  const answer={formatVersion:1,document:{type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'由表格与公式可得：'},{type:'inlineMath',attrs:{latex:'\\bar{x}=4'}}]},
    {type:'image',attrs:{assetId:'a'.repeat(64),alt:'说明图',width:240,align:'center'}}
  ]}};
  const pending={gradingStatus:'pending',score:null,maxScore:data.maxScore,correct:null,feedback:null};
  const inputs=[
    {op:'project',data,state:{submitted:false,result:null},withCapabilities:true},
    {op:'submit',data,answer,withCapabilities:true},
    {op:'review',data,answer,review:{score:2.5,feedback:'最终得分：2.5 / 5 分'},withCapabilities:true},
    {op:'prepareAiGrading',data,answer,state:{submitted:true,status:'submitted',result:pending}}
  ];
  for(const input of inputs)assert.deepEqual(run('1.2.2',input),run('1.2.1',input));
});
