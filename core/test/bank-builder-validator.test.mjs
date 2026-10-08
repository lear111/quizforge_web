import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const product=fileURLToPath(new URL('../../',import.meta.url));
const script=path.join(product,'skills','quizforge-bank-builder','scripts','validate-bank.mjs');
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
  cpSync(path.join(product,'extensions','single-choice'),extension,{recursive:true});
  const manifest=JSON.parse(readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.id='fixture.richtext-type';manifest.requiresRichText=copy(requirement);
  const examples=JSON.parse(readFileSync(path.join(extension,'examples.json'),'utf8'));examples.extension={id:manifest.id,version:manifest.version};
  write('staged/custom/examples.json',examples);write('staged/custom/manifest.json',manifest);
  write('bank/bank.json',{formatVersion:1,id:'fixture-bank',title:'Fixture bank',extension:examples.extension,questions:examples.questions});
  write('core/shared/richtext/service.json',service);
  for(const version of ['1.0.0','1.1.2'])for(const file of ['richtext.js','richtext-editor.js','richtext.css'])write(`core/shared/richtext/${version}/${file}`,'// fixture '+version);
  const run=()=>{const result=spawnSync(process.execPath,[script,'--project',root,'--bank',path.join(root,'bank'),'--extensions',staged],{encoding:'utf8',timeout:60000,maxBuffer:MiB});assert.equal(result.error,undefined,result.error?.message);return {code:result.status,report:JSON.parse(result.stdout)};};
  return {root,manifest,write,run};
}
const MiB=1024*1024;
function outlineType(f,body,{declared=true,minor=1}={}){
  const original=readFileSync(path.join(product,'extensions/single-choice/rules.js'),'utf8');assert.match(original,/QF\.defineType\(\s*\{/);
  f.write('staged/custom/rules.js',original.replace(/QF\.defineType\(\s*\{/,'QF.defineType({getOutlineItems(data){'+body+'},'));
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:minor,capabilities:declared?['practice','score','outline-items']:['practice','score']}});
}

test('bank builder validates a staged public richtext requirement with the normal rule runner and preserves files',t=>{
  const f=fixture(t),manifestBefore=readFileSync(path.join(f.root,'staged/custom/manifest.json')),bankBefore=readFileSync(path.join(f.root,'bank/bank.json'));
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.ok,true);assert.equal(result.report.summary.questions,3);assert.equal(result.report.summary.maxScore,3);assert.equal(result.report.summary.ruleBatches,2);
  assert.equal(result.report.summary.outlineRuleBatches,0);assert.equal(result.report.summary.exampleOutlineRuleBatches,0);
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
  cpSync(path.join(product,'extensions/single-choice/rules.js'),path.join(f.root,'staged/custom/rules.js'));
  f.write('staged/custom/manifest.json',{...f.manifest,requiresApi:{major:1,minMinor:1,capabilities:['outline-items']}});result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.outlineItems,0);assert.equal(result.report.summary.exampleOutlineItems,0);
});
