import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const product=fileURLToPath(new URL('../../',import.meta.url));
const script=path.join(product,'skills/quizforge-bank-builder/scripts/validate-bank.mjs');
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(t){
  const root=mkdtempSync(path.join(tmpdir(),'quizforge-group-validator-'));
  t.after(()=>{assert.ok(path.basename(root).startsWith('quizforge-group-validator-'));rmSync(root,{recursive:true,force:true});});
  const write=(relative,value)=>{const file=path.join(root,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
  mkdirSync(path.join(root,'extensions'),{recursive:true});
  cpSync(path.join(product,'core/server/rules-runner.cjs'),path.join(root,'core/server/rules-runner.cjs'),{recursive:true});
  write('core/package.json',{type:'module'});
  for(const name of ['ajv','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string'])cpSync(path.join(product,'core/node_modules',name),path.join(root,'core/node_modules',name),{recursive:true});
  const leaves={one:'extensions/基础/one',two:'extensions/基础/深层/two'},refs={};
  for(const [kind,base]of Object.entries(leaves)){
    const manifest={id:'fixture.'+kind,version:'1.0.0',name:'Type '+kind,requiresApi:{major:1,minMinor:2,capabilities:['practice','editor','score']},entry:'practice.html',script:'practice.js',style:'practice.css',rules:'rules.js',questionSchema:'question.schema.json',answerSchema:'answer.schema.json',examples:'examples/bank.json'};
    refs[kind]={id:manifest.id,version:manifest.version};write(base+'/manifest.json',manifest);
    write(base+'/practice.html','<article>fixture</article>');write(base+'/practice.js','// fixture');write(base+'/practice.css','article {color: black}');
    write(base+'/question.schema.json',{type:'object',additionalProperties:false,required:['kind','points'],properties:{kind:{const:kind},points:{type:'number',minimum:1}}});
    write(base+'/answer.schema.json',{type:'object',additionalProperties:false,properties:{answer:{type:'string'}}});
    write(base+'/rules.js',`QF.defineType({validateQuestion(data){return data.kind === '${kind}';},project(data){return {kind:data.kind,maxScore:data.points};},grade(data){return {score:data.points,maxScore:data.points,correct:true,feedback:{}};},getScore(data,state){return {score:state.submitted?state.result.score:0,maxScore:data.points};}});`);
    write(base+'/editor.json',{entry:'editor.html',script:'editor.js',style:'practice.css'});write(base+'/editor.html','<input>');write(base+'/editor.js','// fixture editor');
    write(base+'/examples/bank.json',{formatVersion:1,id:'examples',title:'Own sample '+kind,extension:refs[kind],questions:[{id:'example',title:'Example',data:{kind,points:1}}]});
  }
  const bank={formatVersion:1,id:'fixture-bank',title:'Fixture bank',questions:[{id:'q1',title:'Type one',extension:refs.one,data:{kind:'one',points:1}},{id:'q2',title:'Type two',extension:refs.two,data:{kind:'two',points:2}},{id:'q3',title:'Type one again',extension:refs.one,data:{kind:'one',points:3}}]};
  write('bank/bank.json',bank);
  const read=relative=>JSON.parse(readFileSync(path.join(root,relative),'utf8'));
  const run=(...flags)=>{const result=spawnSync(process.execPath,[script,'--project',root,'--bank',path.join(root,'bank'),...flags],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});assert.equal(result.error,undefined,result.error?.message);return {code:result.status,report:JSON.parse(result.stdout)};};
  return {root,leaves,refs,bank,read,write,run};
}

test('independent leaves in physical groups validate mixed banks and separate same-type samples without writes',t=>{
  const f=fixture(t);f.write('extensions/基础/README.md','A physical group of independent leaves.');f.write('extensions/基础/desktop.ini','[ViewState]');
  const before=readFileSync(path.join(f.root,'bank/bank.json')),result=f.run();
  assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.questionTypes,2);assert.equal(result.report.summary.exampleQuestions,2);assert.equal(result.report.summary.maxScore,6);assert.equal(result.report.summary.ruleBatches,4);assert.equal(result.report.summary.exampleRuleBatches,4);
  assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),before);assert.equal(existsSync(path.join(f.root,'.state')),false);assert.equal(existsSync(path.join(f.root,'.development')),false);assert.equal(existsSync(path.join(f.root,'extensions/基础/manifest.json')),false);
});

test('moving an entire independent leaf between groups preserves its binding and accepted data',t=>{
  const f=fixture(t),before=readFileSync(path.join(f.root,'bank/bank.json'));assert.equal(f.run().code,0);
  mkdirSync(path.join(f.root,'extensions/其他分组'),{recursive:true});renameSync(path.join(f.root,f.leaves.one),path.join(f.root,'extensions/其他分组/one'));
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.maxScore,6);assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),before);
});

test('multi-type manifest fields and typeId references are rejected instead of silently downgraded',t=>{
  const f=fixture(t),base=f.leaves.one,original=f.read(base+'/manifest.json');
  for(const extra of [{types:[]},{packageFormatVersion:1},{typeId:'one'}]){
    f.write(base+'/manifest.json',{...original,...extra});const result=f.run();assert.equal(result.report.errors[0].code,'MULTI_TYPE_EXTENSION_NOT_SUPPORTED');assert.equal(result.report.summary.ruleBatches,0);
  }
  f.write(base+'/manifest.json',original);const bank=clone(f.bank);bank.questions[0].extension.typeId='one';f.write('bank/bank.json',bank);assert.equal(f.run().report.errors[0].code,'MULTI_TYPE_BINDING_NOT_SUPPORTED');
  bank.questions[0].extension={development:'one',typeId:'one'};f.write('bank/bank.json',bank);assert.equal(f.run('--allow-development').report.errors[0].code,'MULTI_TYPE_BINDING_NOT_SUPPORTED');
});

test('each leaf sample accepts normal per-question defaults but never binds another leaf in the same group',t=>{
  const f=fixture(t),file=f.leaves.one+'/examples/bank.json',examples=f.read(file);
  delete examples.extension;examples.questions[0].extension=f.refs.one;f.write(file,examples);assert.equal(f.run().code,0);
  examples.questions[0].extension=f.refs.two;f.write(file,examples);
  const result=f.run();assert.equal(result.report.errors[0].code,'INVALID_EXAMPLE_BINDING');assert.equal(result.report.summary.exampleRuleBatches,0);
});

test('leaf schema and synchronous rules remain independent after directory grouping',t=>{
  const f=fixture(t),bank=clone(f.bank);bank.questions[1].data.kind='one';f.write('bank/bank.json',bank);
  const result=f.run();assert.equal(result.code,1);assert.equal(result.report.errors[0].code,'RULE_REJECTED');assert.equal(result.report.errors[0].location,'/questions/1/data');
});

test('group discovery respects four group levels and stops scanning inside leaf source directories',t=>{
  const f=fixture(t),deep='extensions/a/b/c/d/one';mkdirSync(path.dirname(path.join(f.root,deep)),{recursive:true});renameSync(path.join(f.root,f.leaves.one),path.join(f.root,deep));
  f.write(deep+'/src/another/manifest.json',{types:[]});assert.equal(f.run().code,0);
  const tooDeep='extensions/a/b/c/d/e/one';mkdirSync(path.dirname(path.join(f.root,tooDeep)),{recursive:true});renameSync(path.join(f.root,deep),path.join(f.root,tooDeep));
  const result=f.run();assert.equal(result.report.errors[0].code,'EXTENSION_GROUP_DEPTH_LIMIT');assert.equal(result.report.summary.ruleBatches,0);
});

test('tagged developer bindings use globally unique leaf names regardless of their group path',t=>{
  const f=fixture(t);f.write(f.leaves.one+'/development.json',{});
  const bank=clone(f.bank);for(const question of bank.questions)if(question.extension.id===f.refs.one.id)question.extension={development:'one'};f.write('bank/bank.json',bank);
  assert.equal(f.run().report.errors[0].code,'DEVELOPMENT_BINDING_REQUIRES_OPT_IN');assert.equal(f.run('--allow-development').code,0);
  const examples=f.read(f.leaves.one+'/examples/bank.json');delete examples.extension;examples.questions[0].extension={development:'one'};f.write(f.leaves.one+'/examples/bank.json',examples);assert.equal(f.run('--allow-development').code,0);
  mkdirSync(path.join(f.root,'extensions/其他分组'),{recursive:true});renameSync(path.join(f.root,f.leaves.one),path.join(f.root,'extensions/其他分组/one'));assert.equal(f.run('--allow-development').code,0);
  cpSync(path.join(f.root,'extensions/其他分组/one'),path.join(f.root,'extensions/重复分组/one'),{recursive:true});
  const conflict=f.run('--allow-development');assert.equal(conflict.report.errors[0].code,'DEVELOPMENT_FOLDER_CONFLICT');assert.equal(conflict.report.summary.ruleBatches,0);
});

test('legacy UI marker uses the same complete contract and partial leaf preview cannot claim full validation',t=>{
  const f=fixture(t);f.write(f.leaves.one+'/development.json',{mode:'ui',entry:'practice.html'});
  const bank=clone(f.bank);for(const question of bank.questions)if(question.extension.id===f.refs.one.id)question.extension={development:'one'};f.write('bank/bank.json',bank);
  assert.equal(f.run('--allow-development').code,0);
  const manifest=f.read(f.leaves.one+'/manifest.json');delete manifest.rules;f.write(f.leaves.one+'/manifest.json',manifest);
  assert.equal(f.run('--allow-development').report.errors[0].code,'DEVELOPMENT_NOT_IMPLEMENTED');
  const preview=f.run('--allow-development','--preview-only');assert.equal(preview.code,0,JSON.stringify(preview.report));assert.equal(preview.report.validation,'preview');assert.equal(preview.report.summary.maxScore,null);assert.equal(preview.report.summary.ruleBatches,0);assert.equal(preview.report.summary.exampleRuleBatches,0);
  f.write(f.leaves.one+'/development.json',{mode:'ui',types:[{id:'one',path:'types/one'}]});assert.equal(f.run('--allow-development').report.errors[0].code,'MULTI_TYPE_EXTENSION_NOT_SUPPORTED');
});

test('same independent identity in different groups cannot hide different resources',t=>{
  const f=fixture(t);cpSync(path.join(f.root,f.leaves.one),path.join(f.root,'extensions/其他分组/one-copy'),{recursive:true});
  f.write('extensions/其他分组/one-copy/practice.html','<article>different</article>');
  const result=f.run();assert.equal(result.report.errors[0].code,'EXTENSION_VERSION_CONTENT_CONFLICT');assert.equal(result.report.summary.ruleBatches,0);
});

test('authored examples and their uploaded images do not change the same-version extension code identity',t=>{
  const f=fixture(t),base=f.leaves.one,copy='extensions/其他分组/one-copy';
  const schema=f.read(base+'/question.schema.json');schema.properties.document={type:'object'};f.write(base+'/question.schema.json',schema);
  cpSync(path.join(f.root,base),path.join(f.root,copy),{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZJkAAAAASUVORK5CYII=','base64'),hash=createHash('sha256').update(png).digest('hex');
  mkdirSync(path.join(f.root,copy,'examples/assets'),{recursive:true});writeFileSync(path.join(f.root,copy,'examples/assets',hash+'.png'),png);
  const examples=f.read(copy+'/examples/bank.json');examples.title='Edited sample';examples.questions[0].data.points=2;examples.questions[0].data.document={type:'doc',content:[{type:'image',attrs:{assetId:hash}}]};f.write(copy+'/examples/bank.json',examples);
  const before=readFileSync(path.join(f.root,copy,'examples/bank.json')),result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.maxScore,6);assert.deepEqual(readFileSync(path.join(f.root,copy,'examples/bank.json')),before);
});

test('same-type sample images follow the nested ordinary bank directory and missing hashes fail',t=>{
  const f=fixture(t),base=f.leaves.two,png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZJkAAAAASUVORK5CYII=','base64'),hash=createHash('sha256').update(png).digest('hex');
  mkdirSync(path.join(f.root,base,'examples/assets'),{recursive:true});writeFileSync(path.join(f.root,base,'examples/assets',hash+'.png'),png);
  const schema=f.read(base+'/question.schema.json');schema.properties.document={type:'object'};f.write(base+'/question.schema.json',schema);
  const examples=f.read(base+'/examples/bank.json');examples.questions[0].data.document={type:'doc',content:[{type:'image',attrs:{assetId:hash}}]};f.write(base+'/examples/bank.json',examples);
  const result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.referencedImages,1);assert.equal(result.report.warnings.length,0);
  rmSync(path.join(f.root,base,'examples/assets',hash+'.png'));const missing=f.run();assert.equal(missing.report.errors[0].code,'IMAGE_REFERENCE_NOT_FOUND');assert.equal(missing.report.summary.exampleRuleBatches,0);
});

test('mixed bank root features accept partial boolean choices without changing scoring or source files',t=>{
  const f=fixture(t);for(const features of [{},{history:false},{editing:false,whiteboard:false,history:true}]){
    f.write('bank/bank.json',{...f.bank,features});const before=readFileSync(path.join(f.root,'bank/bank.json')),result=f.run();
    assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.summary.questions,3);assert.equal(result.report.summary.questionTypes,2);assert.equal(result.report.summary.maxScore,6);assert.equal(result.report.warnings.length,0);
    assert.deepEqual(readFileSync(path.join(f.root,'bank/bank.json')),before);assert.equal(existsSync(path.join(f.root,'.state')),false);
  }
});

test('root features reject unknown flags and every nonboolean shape before any extension rules',t=>{
  const f=fixture(t);for(const features of [null,[],true,'all',{history:0},{editing:'false'},{whiteboard:null},{future:true}]){
    f.write('bank/bank.json',{...f.bank,features});const result=f.run();assert.equal(result.code,1);assert.equal(result.report.errors[0].code,'INVALID_COLLECTION_FEATURES');assert.equal(result.report.errors[0].location,'/features');assert.equal(result.report.summary.ruleBatches,0);assert.equal(result.report.summary.exampleRuleBatches,0);
  }
});

test('features cannot be overridden per question even when all flags are booleans',t=>{
  const f=fixture(t),bank=clone(f.bank);bank.questions[1].features={editing:true,whiteboard:false,history:false};f.write('bank/bank.json',bank);
  const result=f.run();assert.equal(result.report.errors[0].code,'QUESTION_FEATURES_NOT_SUPPORTED');assert.equal(result.report.errors[0].location,'/questions/1/features');assert.equal(result.report.summary.ruleBatches,0);
});

test('existing same-type samples with disabled features remain valid and warn without rewriting',t=>{
  const f=fixture(t),file=f.leaves.one+'/examples/bank.json',examples=f.read(file);examples.features={history:false,editing:true};f.write(file,examples);
  const before=readFileSync(path.join(f.root,file)),result=f.run();assert.equal(result.code,0,JSON.stringify(result.report));assert.equal(result.report.warnings.length,1);assert.equal(result.report.warnings[0].code,'EXAMPLE_FEATURES_SHOULD_BE_ENABLED');assert.deepEqual(readFileSync(path.join(f.root,file)),before);
  examples.features={history:'false'};f.write(file,examples);const invalid=f.run();assert.equal(invalid.report.errors[0].code,'INVALID_COLLECTION_FEATURES');assert.equal(invalid.report.summary.exampleRuleBatches,0);
});

test('development samples retain feature semantics at every completeness level',t=>{
  const f=fixture(t),file=f.leaves.one+'/examples/bank.json',examples=f.read(file);delete examples.extension;examples.questions[0].extension={development:'one'};examples.features={editing:true,whiteboard:true,history:true};f.write(file,examples);
  const bank=clone(f.bank);for(const question of bank.questions)if(question.extension.id===f.refs.one.id)question.extension={development:'one'};bank.features={history:false};f.write('bank/bank.json',bank);f.write(f.leaves.one+'/development.json',{mode:'runtime'});
  assert.equal(f.run('--allow-development').code,0);
  f.write(f.leaves.one+'/development.json',{mode:'ui',entry:'practice.html',examples:'examples/bank.json'});
  const complete=f.run('--allow-development');assert.equal(complete.code,0);assert.equal(complete.report.warnings.length,0);
  const preview=f.run('--allow-development','--preview-only');assert.equal(preview.code,0);assert.equal(preview.report.summary.exampleRuleBatches,0);assert.equal(preview.report.fullRuntimeValidated,false);
  examples.features={history:false};f.write(file,examples);const oldUi=f.run('--allow-development','--preview-only');assert.equal(oldUi.code,0);assert.ok(oldUi.report.warnings.some(row=>row.code==='EXAMPLE_FEATURES_SHOULD_BE_ENABLED'));
  examples.features={unknown:false};f.write(file,examples);assert.equal(f.run('--allow-development').report.errors[0].code,'INVALID_COLLECTION_FEATURES');
});
