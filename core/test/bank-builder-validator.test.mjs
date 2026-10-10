import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const product=fileURLToPath(new URL('../../',import.meta.url));
const script=path.join(product,'skills','quizforge-bank-builder','scripts','validate-bank.mjs');
const singleChoice=path.join(product,'extensions','基础题型','single-choice');
const copy=value=>JSON.parse(JSON.stringify(value));
const requirement={major:1,minMinor:0,documentFormat:1,documentProfile:'advanced-v1',capabilities:['images','tables','math']};
const service={schemaVersion:1,api:{major:1,minor:0,documentFormat:1},defaultProfile:'advanced-v1',profiles:[
  {id:'basic-v1',provider:{id:'quizforge.richtext',version:'1.0.0'},capabilities:['basic-formatting','images'],legacyVersions:['1.0.0']},
  {id:'advanced-v1',provider:{id:'quizforge.richtext',version:'1.1.2'},capabilities:['basic-formatting','images','advanced-formatting','tables','math','image-resize'],legacyVersions:['1.1.0','1.1.1','1.1.2']}
]};
function fixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'quizforge-bank-validator-')),core=path.join(root,'core'),staged=path.join(root,'staged'),extension=path.join(staged,'custom');
  t.after(()=>{assert.ok(path.basename(root).startsWith('quizforge-bank-validator-'));rmSync(root,{recursive:true,force:true});});
  const write=(relative,value)=>{const file=path.join(root,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  mkdirSync(path.join(root,'extensions'));mkdirSync(path.join(core,'server'),{recursive:true});
  cpSync(path.join(product,'core','server','rules-runner.cjs'),path.join(core,'server','rules-runner.cjs'));
  write('core/package.json',{type:'module'});
  for(const name of ['ajv','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'])cpSync(path.join(product,'core','node_modules',name),path.join(core,'node_modules',name),{recursive:true});
  cpSync(singleChoice,extension,{recursive:true});
  const manifest=JSON.parse(readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.id='fixture.richtext-type';manifest.requiresRichText=copy(requirement);
  const examples=JSON.parse(readFileSync(path.join(extension,'examples.json'),'utf8'));examples.extension={id:manifest.id,version:manifest.version};
  write('staged/custom/examples.json',examples);write('staged/custom/manifest.json',manifest);
  write('bank/bank.json',{formatVersion:1,id:'fixture-bank',title:'Fixture bank',extension:examples.extension,questions:examples.questions});
  write('core/shared/richtext/service.json',service);
  for(const version of ['1.0.0','1.1.2'])for(const file of ['richtext.js','richtext-editor.js','richtext.css'])write(`core/shared/richtext/${version}/${file}`,'// fixture '+version);
  const run=(...flags)=>{const result=spawnSync(process.execPath,[script,'--project',root,'--bank',path.join(root,'bank'),'--extensions',staged,...flags],{encoding:'utf8',timeout:60000,maxBuffer:MiB});assert.equal(result.error,undefined,result.error?.message);return {code:result.status,report:JSON.parse(result.stdout)};};
  return {root,manifest,write,run};
}
const MiB=1024*1024;
function outlineType(f,body,{declared=true,minor=1}={}){
  const original=readFileSync(path.join(singleChoice,'rules.js'),'utf8');assert.match(original,/QF\.defineType\(\s*\{/);
  f.write('staged/custom/rules.js',original.replace(/QF\.defineType\(\s*\{/,'QF.defineType({getOutlineItems(data){'+body+'},'));
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:minor,capabilities:declared?['practice','score','outline-items']:['practice','score']}});
}
function readFixture(f,relative){return JSON.parse(readFileSync(path.join(f.root,relative),'utf8'));}
function explicitExamples(f){
  const examples=readFixture(f,'staged/custom/examples.json');
  for(const [index,question]of examples.questions.entries())question.outline={level:'question',label:String(index+1)};
  f.write('staged/custom/examples.json',examples);
}

test('bank builder validates a staged public richtext requirement with the normal rule runner and preserves files',t=>{
  const f=fixture(t),manifestBefore=readFileSync(path.join(f.root,'staged/custom/manifest.json')),bankBefore=readFileSync(path.join(f.root,'bank/bank.json'));
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.ok,true);assert.equal(result.report.summary.questions,3);assert.equal(result.report.summary.maxScore,3);assert.equal(result.report.summary.ruleBatches,2);
  assert.equal(result.report.summary.outlineRuleBatches,0);assert.equal(result.report.summary.exampleOutlineRuleBatches,0);
  assert.equal(result.report.summary.outlineBytes,1+3*3); // Three empty host metadata rows.
  assert.deepEqual(readFileSync(path.join(f.root,'staged/custom/manifest.json')),manifestBefore);assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),bankBefore);assert.equal(existsSync(path.join(f.root,'.state')),false);
});

test('bank builder rejects unsupported or malformed public requirements before executing rules',t=>{
  const f=fixture(t);
  const cases=[
    [{...requirement,major:2},'UNSUPPORTED_RICHTEXT_API'],[{...requirement,minMinor:1},'UNSUPPORTED_RICHTEXT_API'],
    [{...requirement,documentFormat:2},'UNSUPPORTED_RICHTEXT_DOCUMENT_FORMAT'],[{...requirement,documentProfile:'future-v1'},'UNSUPPORTED_RICHTEXT_PROFILE'],
    [{...requirement,documentProfile:'basic-v1'},'UNSUPPORTED_RICHTEXT_CAPABILITY'],[{...requirement,capabilities:['unknown']},'UNSUPPORTED_RICHTEXT_CAPABILITY'],
    [{...requirement,capabilities:['images','images']},'INVALID_RICHTEXT_REQUIREMENT'],[{...requirement,major:1.5},'INVALID_RICHTEXT_REQUIREMENT'],
    [{...requirement,tiptapVersion:'3.31.4'},'INVALID_RICHTEXT_REQUIREMENT'],[{major:1,minMinor:0,documentFormat:1},'INVALID_RICHTEXT_REQUIREMENT']
  ];
  for(const [requiresRichText,expected]of cases){f.write('staged/custom/manifest.json',{...f.manifest,requiresRichText});const result=f.run();assert.equal(result.code,1);assert.equal(result.report.errors[0].code,expected);assert.equal(result.report.summary.ruleBatches,0);assert.equal(result.report.summary.exampleRuleBatches,0);}
  f.write('staged/custom/manifest.json',{...f.manifest,dependencies:[]});assert.equal(f.run().report.errors[0].code,'INVALID_RICHTEXT_REQUIREMENT');
});

test('known legacy dependencies validate the selected compatible provider without changing old manifests',t=>{
  const f=fixture(t),manifest={...f.manifest,dependencies:[{id:'quizforge.richtext',version:'1.1.0'}]};delete manifest.requiresRichText;f.write('staged/custom/manifest.json',manifest);
  // The declared old implementation is absent; its public profile selects the installed patch.
  const before=readFileSync(path.join(f.root,'staged/custom/manifest.json')),result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.deepEqual(readFileSync(path.join(f.root,'staged/custom/manifest.json')),before);
  rmSync(path.join(f.root,'core/shared/richtext/1.1.2/richtext-editor.js'));assert.equal(f.run().report.ok,false);
});

test('unknown legacy dependencies remain exact and legacy flat projects do not require a registry',t=>{
  const f=fixture(t),manifest={...f.manifest,dependencies:[{id:'quizforge.richtext',version:'1.0.9'}]};delete manifest.requiresRichText;f.write('staged/custom/manifest.json',manifest);
  assert.equal(f.run().report.ok,false);
  for(const file of ['richtext.js','richtext-editor.js','richtext.css'])f.write(`core/shared/richtext/1.0.9/${file}`,'// exact legacy provider');
  assert.equal(f.run().code,0);
  rmSync(path.join(f.root,'core/shared/richtext/service.json'));assert.equal(f.run().code,0);
  // The same runtime files are supported at the product root only when core/ is absent.
  for(const name of ['server','package.json','node_modules','shared'])cpSync(path.join(f.root,'core',name),path.join(f.root,name),{recursive:true});
  rmSync(path.join(f.root,'core'),{recursive:true});assert.equal(f.run().code,0);
});

test('registry errors and missing new service fail before rule execution',t=>{
  const f=fixture(t);
  for(const value of [{...service,extra:true},{...service,defaultProfile:'missing'},{...service,profiles:[service.profiles[0],service.profiles[0]]},{...service,api:{major:1,minor:0,documentFormat:1,implementation:'tiptap'}},{...service,profiles:[{...service.profiles[0],capabilities:['tables']}]},{...service,profiles:[{...service.profiles[0],capabilities:[]}]},{...service,profiles:[{...service.profiles[1],capabilities:['unknown']}]},{...service,profiles:[{...service.profiles[0],id:'future-v1'}]}]){
    f.write('core/shared/richtext/service.json',value);const result=f.run();assert.equal(result.report.errors[0].code,'INVALID_RICHTEXT_SERVICE');assert.equal(result.report.summary.exampleRuleBatches,0);
  }
  rmSync(path.join(f.root,'core/shared/richtext/service.json'));assert.equal(f.run().report.errors[0].code,'RICHTEXT_SERVICE_UNAVAILABLE');
});

test('staged outline extension preserves parent question count, scores and files while checking ordered child metadata',t=>{
  const f=fixture(t);outlineType(f,"return data.options.map((option,index)=>({id:option.id,label:'小问'+(index+1)}));");
  const bank=readFileSync(path.join(f.root,'bank/bank.json')),manifest=readFileSync(path.join(f.root,'staged/custom/manifest.json')),result=f.run();
  assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.questions,3);assert.equal(result.report.summary.maxScore,3);
  assert.equal(result.report.summary.outlineItems,12);assert.equal(result.report.summary.exampleOutlineItems,12);assert.equal(result.report.summary.outlineRuleBatches,1);assert.equal(result.report.summary.exampleOutlineRuleBatches,1);
  const metadata=JSON.parse(bank).questions.map(question=>({outlineItems:question.data.options.map((option,index)=>({id:option.id,label:'小问'+(index+1)}))}));
  assert.equal(result.report.summary.outlineBytes,1+metadata.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row))+1,0));
  assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),bank);assert.deepEqual(readFileSync(path.join(f.root,'staged/custom/manifest.json')),manifest);assert.equal(existsSync(path.join(f.root,'.state')),false);
});

test('invalid child metadata from real staged rules fails before parent scoring',t=>{
  const f=fixture(t);
  for(const body of [
    'return [{id:"p1",label:"(1)"},{id:"p1",label:"(2)"}];',
    'return [{id:"p1",label:"<b>(1)</b>"}];',
    'return [{id:"p1",label:"(1)",maxScore:2}];',
    'return Array.from({length:101},(_,i)=>({id:"p"+i,label:String(i)}));',
    'return Promise.resolve([{id:"p1",label:"(1)"}]);'
  ]){
    outlineType(f,body);const result=f.run();assert.equal(result.code,1,JSON.stringify(result.report));assert.equal(result.report.errors[0].code,'INVALID_OUTLINE_ITEMS');assert.equal(result.report.summary.ruleBatches,0);
  }
});

test('outline opt-in requires API 1.1 but declared capability without a hook remains empty',t=>{
  const f=fixture(t);outlineType(f,'return [{id:"p1",label:"(1)"}];',{minor:0});
  let result=f.run();assert.equal(result.report.errors[0].code,'INVALID_API_REQUIREMENT');assert.equal(result.report.summary.exampleRuleBatches,0);
  outlineType(f,'return [{id:"p1",label:"(1)"}];',{declared:false});result=f.run();assert.equal(result.report.errors[0].code,'INVALID_OUTLINE_ITEMS');
  cpSync(path.join(singleChoice,'rules.js'),path.join(f.root,'staged/custom/rules.js'));
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:1,capabilities:['outline-items']}});result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.outlineItems,0);assert.equal(result.report.summary.exampleOutlineItems,0);
  assert.equal(result.report.summary.outlineBytes,1+3*3); // Empty generated lists are omitted by the host.
});

test('explicit parent or part entries override a throwing outline hook without changing counts, scores or source order',t=>{
  const f=fixture(t);outlineType(f,'throw new Error("Bank metadata must not invoke this hook");');explicitExamples(f);
  const bank=readFixture(f,'bank/bank.json');
  bank.questions[0].outline={level:'question',label:'三'};
  bank.questions[1].outline={level:'parts',items:[{id:'part-23',label:'23'},{id:'part-21',label:'21'}]};
  // Item IDs are scoped to the parent; a second parent may use the same ID.
  bank.questions[2].outline={level:'parts',items:[{id:'part-23',label:'(一)'}]};
  f.write('bank/bank.json',bank);
  const bankBefore=readFileSync(path.join(f.root,'bank/bank.json')),manifestBefore=readFileSync(path.join(f.root,'staged/custom/manifest.json')),result=f.run();
  assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.questions,3);assert.equal(result.report.summary.questionTypes,1);assert.equal(result.report.summary.maxScore,3);
  assert.equal(result.report.summary.outlineItems,3);assert.equal(result.report.summary.exampleOutlineItems,0);assert.equal(result.report.summary.outlineRuleBatches,0);assert.equal(result.report.summary.exampleOutlineRuleBatches,0);
  const metadata=[{outlineLabel:'三'},...bank.questions.slice(1).map(question=>({outlineItems:question.outline.items}))];
  assert.equal(result.report.summary.outlineBytes,1+metadata.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row))+1,0));
  assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),bankBefore);assert.deepEqual(readFileSync(path.join(f.root,'staged/custom/manifest.json')),manifestBefore);assert.equal(existsSync(path.join(f.root,'.state')),false);
});

test('explicit and legacy rows coexist and only missing outline declarations call the old generator',t=>{
  const f=fixture(t);outlineType(f,'if(data.stem.startsWith("DECLARED:"))throw new Error("Unexpected regeneration");return data.options.map((option,index)=>({id:option.id,label:String(index+1)}));');
  const bank=readFixture(f,'bank/bank.json');
  bank.questions[0].data.stem='DECLARED:'+bank.questions[0].data.stem;bank.questions[0].outline={level:'parts',items:[{id:'custom-second',label:'22'},{id:'custom-first',label:'21'}]};
  bank.questions[2].data.stem='DECLARED:'+bank.questions[2].data.stem;bank.questions[2].outline={level:'question',label:'五'};
  f.write('bank/bank.json',bank);const result=f.run();
  assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.outlineItems,6);assert.equal(result.report.summary.outlineRuleBatches,1);assert.equal(result.report.summary.exampleOutlineItems,12);assert.equal(result.report.summary.maxScore,3);
  const metadata=[{outlineItems:bank.questions[0].outline.items},{outlineItems:bank.questions[1].data.options.map((option,index)=>({id:option.id,label:String(index+1)}))},{outlineLabel:'五'}];
  assert.equal(result.report.summary.outlineBytes,1+metadata.reduce((sum,row)=>sum+Buffer.byteLength(JSON.stringify(row))+1,0));
});

test('malformed explicit outlines fail before any package rules execute',t=>{
  const f=fixture(t),bank=readFixture(f,'bank/bank.json');
  const item={id:'part-21',label:'21'},parts=items=>({level:'parts',items});
  const cases=[null,[],{}, {level:'children',items:[item]},
    {level:'question'}, {level:'question',label:''}, {level:'question',label:' 1'}, {level:'question',label:'1 '}, {level:'question',label:'<b>1</b>'}, {level:'question',label:'1\u0000'}, {level:'question',label:'1'.repeat(81)}, {level:'question',label:'三',items:[item]},
    {level:'parts'}, parts(null),parts([]),parts(Array.from({length:101},(_,i)=>({id:'p'+i,label:String(i)}))),parts([item,item]),parts([{...item,score:1}]),parts([{label:'21'}]),parts([{id:'',label:'21'}]),parts([{id:' '.repeat(128),label:'21'}]),parts([{id:'p'.repeat(129),label:'21'}]),parts([{id:'<p>',label:'21'}]),parts([{id:'p\u0085',label:'21'}]),parts([{id:'p',label:21}]),parts([{id:'p',label:'21\n'}]),{...parts([item]),label:'三'}
  ];
  for(const outline of cases){const value=copy(bank);value.questions[0].outline=outline;f.write('bank/bank.json',value);const result=f.run();assert.equal(result.code,1,JSON.stringify(outline));assert.equal(result.report.errors[0].code,'INVALID_OUTLINE_ITEMS',JSON.stringify(outline));assert.match(result.report.errors[0].location,/^\/questions\/0\/outline/);assert.equal(result.report.summary.exampleRuleBatches,0);assert.equal(result.report.summary.ruleBatches,0);}
});

test('explicit part navigation requires declared API 1.1 while explicit parent entries support old extensions',t=>{
  const f=fixture(t),bank=readFixture(f,'bank/bank.json');bank.questions[0].outline={level:'parts',items:[{id:'part-21',label:'21'}]};f.write('bank/bank.json',bank);
  for(const requiresApi of [undefined,{major:1,minMinor:0,capabilities:['practice']},{major:1,minMinor:1,capabilities:['practice']}]){
    const manifest={...f.manifest};if(requiresApi)manifest.requiresApi=requiresApi;else delete manifest.requiresApi;f.write('staged/custom/manifest.json',manifest);
    const result=f.run();assert.equal(result.code,1);assert.equal(result.report.errors[0].code,'OUTLINE_CAPABILITY_REQUIRED');assert.equal(result.report.errors[0].location,'/questions/0/outline');assert.equal(result.report.summary.exampleRuleBatches,0);assert.equal(result.report.summary.ruleBatches,0);
  }
  bank.questions[0].outline={level:'question',label:'三'};f.write('bank/bank.json',bank);f.write('staged/custom/manifest.json',f.manifest);
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.outlineItems,0);assert.equal(result.report.summary.outlineRuleBatches,0);assert.equal(result.report.summary.maxScore,3);
});

test('explicit parts need only navigation capability, not a getOutlineItems rule hook',t=>{
  const f=fixture(t);f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:1,capabilities:['outline-items']}});explicitExamples(f);
  const bank=readFixture(f,'bank/bank.json');for(const question of bank.questions)question.outline={level:'parts',items:[{id:'部'.repeat(128),label:'题'.repeat(80)}]};f.write('bank/bank.json',bank);
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.outlineItems,3);assert.equal(result.report.summary.outlineRuleBatches,0);assert.equal(result.report.summary.maxScore,3);
});

test('API 1.2 score states validate without a new capability and fail on pre-submit correctness',t=>{
  const f=fixture(t),bank=readFixture(f,'bank/bank.json');
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:2,capabilities:['score','outline-items']}});
  explicitExamples(f);for(const question of bank.questions)question.outline={level:'parts',items:[{id:'part-21',label:'21'}]};f.write('bank/bank.json',bank);
  const rules=`QF.defineType({project(data){return {stem:data.stem,maxScore:1};},grade(){return {};},getScore(){return {score:0,maxScore:1,outlineStates:[{id:'part-21',status:'unanswered'}]};}});`;
  f.write('staged/custom/rules.js',rules);const before=readFileSync(path.join(f.root,'bank/bank.json')),valid=f.run();assert.equal(valid.code,0,JSON.stringify(valid.report));assert.equal(valid.report.summary.maxScore,3);assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),before);
  f.write('staged/custom/rules.js',rules.replace("status:'unanswered'","status:'correct'"));const bad=f.run();assert.equal(bad.code,1);assert.equal(bad.report.errors[0].code,'INVALID_OUTLINE_STATES');
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:3,capabilities:['score']}});const future=f.run();assert.equal(future.report.errors[0].code,'UNSUPPORTED_EXTENSION_API');assert.equal(future.report.summary.ruleBatches,0);
});

test('explicit and generated navigation metadata share the bank aggregate size limit',t=>{
  const f=fixture(t);outlineType(f,'return Array.from({length:data.stem.startsWith("TAIL:")?10:100},(_,i)=>({id:"部".repeat(124)+i,label:"题".repeat(80)}));');explicitExamples(f);
  const bank=readFixture(f,'bank/bank.json'),base=bank.questions[0];bank.questions=Array.from({length:133},(_,i)=>({...copy(base),id:'q'+i}));
  const items=Array.from({length:100},(_,i)=>({id:'部'.repeat(124)+i,label:'题'.repeat(80)}));
  bank.questions[0].outline={level:'parts',items};bank.questions.at(-1).data.stem='TAIL:'+bank.questions.at(-1).data.stem;f.write('bank/bank.json',bank);
  // Arrays alone fit, but the exact host metadata rows exceed the same 8 MiB.
  const outlines=[...Array.from({length:132},()=>items),items.slice(0,10)];
  assert.equal(1+outlines.reduce((sum,value)=>sum+Buffer.byteLength(JSON.stringify(value))+1,0),8387287);
  assert.equal(1+outlines.reduce((sum,value)=>sum+Buffer.byteLength(JSON.stringify({outlineItems:value}))+1,0),8389548);
  const result=f.run();assert.equal(result.code,1,JSON.stringify(result.report));assert.equal(result.report.errors[0].code,'INVALID_OUTLINE_ITEMS');assert.ok(result.report.summary.outlineRuleBatches>0);assert.equal(result.report.summary.questions,133);assert.equal(result.report.summary.maxScore,0);
});

function developmentFixture(f,mode=null){
  cpSync(path.join(f.root,'staged/custom'),path.join(f.root,'extensions/custom-dev'),{recursive:true});
  f.write('extensions/custom-dev/development.json',mode?{mode}:{});
  const bank=readFixture(f,'bank/bank.json');bank.extension={development:'custom-dev'};f.write('bank/bank.json',bank);return bank;
}

test('tagged development bindings require opt-in and validate alongside exact formal bindings without touching state',t=>{
  const f=fixture(t),bank=developmentFixture(f);bank.questions[1].extension={id:f.manifest.id,version:f.manifest.version};f.write('bank/bank.json',bank);
  const bankBefore=readFileSync(path.join(f.root,'bank/bank.json')),markerBefore=readFileSync(path.join(f.root,'extensions/custom-dev/development.json'));
  const denied=f.run();assert.equal(denied.code,1);assert.equal(denied.report.errors[0].code,'DEVELOPMENT_BINDING_REQUIRES_OPT_IN');assert.equal(denied.report.summary.ruleBatches,0);
  const valid=f.run('--allow-development');assert.equal(valid.code,0,JSON.stringify(valid.report));assert.equal(valid.report.summary.questions,3);assert.equal(valid.report.summary.questionTypes,2);assert.equal(valid.report.summary.maxScore,3);
  assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),bankBefore);assert.deepEqual(readFileSync(path.join(f.root,'extensions/custom-dev/development.json')),markerBefore);
  assert.equal(existsSync(path.join(f.root,'.state')),false);assert.equal(existsSync(path.join(f.root,'.development')),false);
});

test('legacy marker modes do not choose a separate pipeline and invalid markers fail before rules',t=>{
  const f=fixture(t);developmentFixture(f);
  for(const marker of [{},{name:'开发题型'}, {mode:'ui'}, {mode:'runtime'}]){
    f.write('extensions/custom-dev/development.json',marker);const result=f.run('--allow-development');assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.validation,'full');assert.equal(result.report.fullRuntimeValidated,true);
  }
  for(const [marker,expected]of [[{mode:'future'},'INVALID_DEVELOPMENT_MARKER'],[null,'INVALID_DEVELOPMENT_MARKER'],[{unexpected:true},'INVALID_DEVELOPMENT_MARKER']]){
    f.write('extensions/custom-dev/development.json',marker);const result=f.run('--allow-development');assert.equal(result.code,1);assert.equal(result.report.errors[0].code,expected);assert.equal(result.report.summary.exampleRuleBatches,0);assert.equal(result.report.summary.ruleBatches,0);
  }
});

test('preview checks incomplete development files without executing rules or claiming scores',t=>{
  const f=fixture(t);developmentFixture(f);
  const manifest=readFixture(f,'extensions/custom-dev/manifest.json');delete manifest.answerSchema;f.write('extensions/custom-dev/manifest.json',manifest);
  f.write('extensions/custom-dev/rules.js','throw new Error("Preview must not execute this");');
  const before=readFileSync(path.join(f.root,'bank/bank.json')),valid=f.run('--allow-development','--preview-only');
  assert.equal(valid.code,0,JSON.stringify(valid.report));assert.equal(valid.report.validation,'preview');assert.equal(valid.report.fullRuntimeValidated,false);assert.equal(valid.report.summary.maxScore,null);assert.equal(valid.report.summary.ruleBatches,0);assert.equal(valid.report.summary.exampleRuleBatches,0);assert.equal(valid.report.warnings[0].code,'PREVIEW_ONLY_NO_RUNTIME_VALIDATION');
  assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),before);assert.equal(existsSync(path.join(f.root,'.state')),false);assert.equal(existsSync(path.join(f.root,'.development')),false);
  const full=f.run('--allow-development');assert.equal(full.code,1);assert.equal(full.report.errors[0].code,'DEVELOPMENT_NOT_IMPLEMENTED');assert.equal(full.report.fullRuntimeValidated,false);
  const optIn=f.run('--preview-only');assert.equal(optIn.code,2);assert.equal(optIn.report.errors[0].code,'PREVIEW_REQUIRES_DEVELOPMENT_OPT_IN');
});

test('preview still rejects malformed schemas, incompatible API, bad data and resources',t=>{
  const f=fixture(t),bank=developmentFixture(f),manifest=readFixture(f,'extensions/custom-dev/manifest.json');
  f.write('extensions/custom-dev/question.schema.json',{type:'unknown'});assert.equal(f.run('--allow-development','--preview-only').report.errors[0].code,'INVALID_SCHEMA');
  cpSync(path.join(singleChoice,'question.schema.json'),path.join(f.root,'extensions/custom-dev/question.schema.json'));
  bank.questions[0].data={};f.write('bank/bank.json',bank);assert.equal(f.run('--allow-development','--preview-only').report.errors[0].code,'INVALID_QUESTION_SCHEMA_DATA');
  f.write('bank/bank.json',{...bank,questions:readFixture(f,'staged/custom/examples.json').questions});
  f.write('extensions/custom-dev/manifest.json',{...manifest,requiresApi:{major:1,minMinor:3}});assert.equal(f.run('--allow-development','--preview-only').report.errors[0].code,'UNSUPPORTED_EXTENSION_API');
  f.write('extensions/custom-dev/manifest.json',{...manifest,entry:'../outside.html'});assert.equal(f.run('--allow-development','--preview-only').report.errors[0].code,'PATH_ESCAPES_PACKAGE');
});

test('legacy bare UI remains read-only preview input while new tagged skeleton is not a full type',t=>{
  const f=fixture(t);developmentFixture(f);
  rmSync(path.join(f.root,'extensions/custom-dev/manifest.json'));
  f.write('extensions/custom-dev/development.json',{mode:'ui',entry:'practice.html',examples:'examples.json'});
  const examples=readFixture(f,'extensions/custom-dev/examples.json');examples.extension={development:'custom-dev'};f.write('extensions/custom-dev/examples.json',examples);
  const before=readFileSync(path.join(f.root,'extensions/custom-dev/development.json')),preview=f.run('--allow-development','--preview-only');
  assert.equal(preview.code,0,JSON.stringify(preview.report));assert.equal(preview.report.summary.exampleQuestions,3);assert.equal(preview.report.summary.maxScore,null);assert.deepEqual(readFileSync(path.join(f.root,'extensions/custom-dev/development.json')),before);
  assert.equal(f.run('--allow-development').report.errors[0].code,'DEVELOPMENT_NOT_IMPLEMENTED');
  f.write('extensions/custom-dev/development.json',{mode:'ui',entry:'practice.html'});const bare=f.run('--allow-development','--preview-only');assert.equal(bare.code,0);assert.ok(bare.report.warnings.some(row=>row.code==='DEVELOPMENT_EXAMPLES_MISSING'));
});

test('bundled QF display scaffold previews its self-bound samples but cannot pass full grading validation',t=>{
  const f=fixture(t),folder='scaffold-dev';
  cpSync(path.join(product,'skills/quizforge-bank-builder/assets/development-scaffold'),path.join(f.root,'extensions',folder),{recursive:true});
  const examples=readFixture(f,'extensions/'+folder+'/examples/bank.json');f.write('bank/bank.json',{...examples,id:'scaffold-bank',extension:{development:folder}});
  const preview=f.run('--allow-development','--preview-only');assert.equal(preview.code,0,JSON.stringify(preview.report));assert.equal(preview.report.summary.exampleQuestions,1);assert.equal(preview.report.summary.maxScore,null);
  const full=f.run('--allow-development');assert.equal(full.code,1);assert.equal(full.report.errors[0].code,'RULE_REJECTED');assert.equal(full.report.fullRuntimeValidated,false);
});

test('formal identity lookup never uses a development directory even with opt-in',t=>{
  const f=fixture(t);developmentFixture(f);rmSync(path.join(f.root,'staged/custom'),{recursive:true});
  const bank=readFixture(f,'bank/bank.json');bank.extension={id:f.manifest.id,version:f.manifest.version};f.write('bank/bank.json',bank);
  const result=f.run('--allow-development');assert.equal(result.code,1);assert.equal(result.report.errors[0].code,'EXTENSION_NOT_FOUND');assert.equal(result.report.summary.ruleBatches,0);
});

test('development references are explicit scoped folders and still run schema and rule validation',t=>{
  const f=fixture(t),bank=developmentFixture(f);
  for(const [reference,expected]of [[{development:'../custom-dev'},'INVALID_STABLE_ID'],[{development:'custom-dev',id:f.manifest.id},'INVALID_EXTENSION_REFERENCE'],[{development:'missing-dev'},'EXTENSION_NOT_FOUND']]){
    f.write('bank/bank.json',{...bank,extension:reference});const result=f.run('--allow-development');assert.equal(result.code,1);assert.equal(result.report.errors[0].code,expected);assert.equal(result.report.summary.ruleBatches,0);
  }
  bank.questions[0].data.correctOptionId='missing';f.write('bank/bank.json',bank);const invalid=f.run('--allow-development');assert.equal(invalid.code,1);assert.equal(invalid.report.errors[0].code,'RULE_REJECTED');assert.equal(invalid.report.errors[0].location,'/questions/0/data');assert.ok(invalid.report.summary.ruleBatches>0);
});

test('extension prototype leftovers are ignored as resources while bank assets remain strict',t=>{
  const f=fixture(t);developmentFixture(f);f.write('extensions/custom-dev/assets/icon.svg','<svg xmlns="http://www.w3.org/2000/svg"/>');f.write('extensions/custom-dev/assets/sample.woff2','fixture font bytes');
  f.write('extensions/custom-dev/development.json',{mode:'runtime',assets:['assets/icon.svg','assets/sample.woff2']});
  const valid=f.run('--allow-development');assert.equal(valid.code,0,JSON.stringify(valid.report));assert.equal(valid.report.summary.images,0);assert.equal(valid.report.summary.referencedImages,0);assert.equal(valid.report.summary.maxScore,3);
  f.write('extensions/custom-dev/development.json',{mode:'runtime'});const undeclared=f.run('--allow-development');assert.equal(undeclared.code,0,JSON.stringify(undeclared.report));assert.equal(undeclared.report.summary.referencedImages,0);assert.equal(undeclared.report.summary.maxScore,3);
  f.write('bank/assets/unused.svg','<svg/>');const bankAsset=f.run('--allow-development');assert.equal(bankAsset.code,1);assert.equal(bankAsset.report.errors[0].code,'IMAGE_TYPE_UNSUPPORTED');assert.equal(bankAsset.report.errors[0].location,'bank/assets/unused.svg');assert.equal(bankAsset.report.summary.ruleBatches,0);
});

test('static asset declarations retain path, type, size and fingerprint checks for formal packages',t=>{
  const f=fixture(t);
  for(const [assets,expected]of [[['../escape.svg'],'PATH_ESCAPES_PACKAGE'],[['assets/icon.exe'],'STATIC_ASSET_TYPE_UNSUPPORTED'],[['assets/icon.svg','assets/icon.svg'],'INVALID_STATIC_ASSETS']]){
    f.write('staged/custom/assets/icon.svg','<svg/>');f.write('staged/custom/manifest.json',{...f.manifest,assets});const invalid=f.run();assert.equal(invalid.code,1);assert.equal(invalid.report.errors[0].code,expected);assert.equal(invalid.report.summary.ruleBatches,0);
  }
  f.write('staged/custom/manifest.json',{...f.manifest,assets:['assets/icon.svg']});f.write('staged/custom/assets/icon.svg','x'.repeat(MiB+1));const large=f.run();assert.equal(large.code,1);assert.equal(large.report.errors[0].code,'INVALID_FILE_OR_SIZE');
  f.write('staged/custom/assets/icon.svg','<svg/>');cpSync(path.join(f.root,'staged/custom'),path.join(f.root,'extensions/formal-copy'),{recursive:true});f.write('extensions/formal-copy/assets/icon.svg','<svg><path/></svg>');const conflict=f.run();assert.equal(conflict.code,1);assert.equal(conflict.report.errors[0].code,'EXTENSION_VERSION_CONTENT_CONFLICT');assert.equal(conflict.report.summary.ruleBatches,0);
});
