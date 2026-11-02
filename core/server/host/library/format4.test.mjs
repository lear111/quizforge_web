import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packageFormat4, parseLossless, losslessBytes, ordinary, FormatFiles, readManifests } from './format4.js';
import { upgradeLocalLibrary } from './library-upgrade.js';
import { LibraryArchive } from './library-archive.js';
import { ResourceStore } from '../resources/resources.js';
import { prepareCollection, finishCollection } from './collections.js';
import { Library } from './library.js';
import { RuleEngine } from '../extensions/rule-engine.js';
import { StateStore } from '../practice/state-store.js';
import { QuizForgeServer } from '../http/server.js';
import { networkSource } from '../resources/listening.js';
import { randomUUID } from 'node:crypto';
import { copyFixture } from '../../../test/fixtures/installed-library.mjs';

const code=fileURLToPath(new URL('../../../',import.meta.url)), product=path.dirname(code);
const base=path.join(product,'.temp','format4-tests');fs.mkdirSync(base,{recursive:true});
export const EXT='extensions/Group/Choice',BANK='question-banks/Group/Bank';
export function fixture(t) {
  const root=fs.mkdtempSync(path.join(base,'case-'));
  const put=(name,value)=>{ const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value)); };
  const manifest={id:'choice',version:'1.0.0',name:'选择题',requiresApi:{major:1,minMinor:1,capabilities:['practice','outline-items']},entry:'practice.html',script:'practice.js',style:'practice.css',rules:'rules.js',questionSchema:'question.schema.json',answerSchema:'answer.schema.json',examples:'examples/bank.json'};
  const bank={formatVersion:1,id:'old-bank',title:'Synthetic',extension:{path:EXT},questions:[{id:'q1',title:'Synthetic question',data:{test:1},outline:{level:'question',label:'甲'}}]};
  put('quizforge-package.json',{format:'quizforge-bank-group',formatVersion:3,group:'Group'});
  put(EXT+'/manifest.json',manifest);
  for (const file of ['practice.html','practice.js','practice.css','rules.js','question.schema.json','answer.schema.json']) put(EXT+'/'+file,'{}');
  put(BANK+'/bank.json',bank);put(EXT+'/examples/bank.json',{...bank,id:'examples'});
  return {root,put,bank,manifest,get:name=>fs.readFileSync(path.join(root,name)),json:name=>JSON.parse(fs.readFileSync(path.join(root,name)))};
}

export async function runtimeFixture(t) {
  const f=fixture(t),source=path.join(code,'test/fixtures/legacy-extensions/single-choice-1.0.0');
  copyFixture(source,path.join(f.root,EXT),{recursive:true});
  const manifest=f.json(EXT+'/manifest.json'),raw=f.json(EXT+'/examples.json');
  manifest.examples='examples/bank.json';f.put(EXT+'/manifest.json',manifest);f.put(EXT+'/examples/bank.json',raw);fs.unlinkSync(path.join(f.root,EXT,'examples.json'));
  f.put(BANK+'/bank.json',{...raw,id:'old-bank',title:'Synthetic runtime'});
  const engine=await RuleEngine.create(code);engine.validationEnvironment=async()=> 'format4-test-fixture';
  const library=new Library(f.root,code,engine);t.after(()=>{library.close();engine.close();});
  return {...f,library,engine};
}

test('format 3 conversion creates distinct UUIDv4 once, moves audio bytes and preserves all opaque numeric tokens',t=>{
  const f=fixture(t),audio=Buffer.from('ID3synthetic');f.put(BANK+'/media/a.mp3',audio);
  f.bank.listening={materials:[{id:'a',title:'Audio',file:'media/a.mp3'}]};f.bank.questions[0].listening={materialId:'a'};
  f.put(BANK+'/bank.json',JSON.stringify(f.bank).replace('"test":1','"test":-0,"big":9007199254740993,"decimal":1.0,"exponent":1e21'));
  const script=f.get(EXT+'/practice.js'),manifest=f.get(EXT+'/manifest.json');
  const report=packageFormat4(f.root,{upgrade:true});
  const raw=f.json(BANK+'/bank.json'),example=f.json(EXT+'/examples/bank.json');
  assert.match(raw.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); assert.notEqual(raw.id,example.id);
  assert.deepEqual(raw.outline,[{group:'选择题',items:[{question:'q1',label:'甲'}]}]);assert.equal(raw.questions[0].outline,undefined);
  for (const token of ['"test":-0','"big":9007199254740993','"decimal":1.0','"exponent":1e21']) assert.ok(f.get(BANK+'/bank.json').includes(Buffer.from(token)));
  assert.deepEqual(f.get(BANK+'/assets/a.mp3'),audio);assert.equal(raw.listening.materials[0].file,'assets/a.mp3');
  assert.deepEqual(f.get(EXT+'/manifest.json'),manifest);assert.deepEqual(f.get(EXT+'/practice.js'),script);
  assert.deepEqual(report.affectedExtensions,[EXT]);assert.equal(JSON.stringify(report).includes('Synthetic question'),false);
  packageFormat4(f.root);assert.equal(f.json(BANK+'/bank.json').id,raw.id);
});

for (const kind of ['unknown-root','unknown-question','unknown-outline','wav','collision','wrong-binding','duplicate-key','bad-number','nested-assets','duplicate-id']) test(`strict conversion rejects ${kind} with location and no writes`,t=>{
  const f=fixture(t);
  if(kind==='unknown-root')f.bank.groups=[];
  if(kind==='unknown-question')f.bank.questions[0].group='Wrong';
  if(kind==='unknown-outline')f.bank.questions[0].outline.other=true;
  if(kind==='network')f.bank.listening={materials:[{id:'a',title:'A',url:'https://invalid.test/a.mp3'}]};
  if(kind==='wav')f.put(BANK+'/media/a.wav',Buffer.from('RIFF1234WAVE'));
  if(kind==='collision'){f.put(BANK+'/media/a.mp3',Buffer.from('ID3'));f.put(BANK+'/assets/A.mp3',Buffer.from('ID3'));}
  if(kind==='wrong-binding')f.bank.extension={path:'extensions/Group/Missing'};
  if(kind==='nested-assets')f.put(BANK+'/assets/sub/a.mp3',Buffer.from('ID3'));
  if(kind==='duplicate-id')f.bank.questions.push({...f.bank.questions[0]});
  f.put(BANK+'/bank.json',f.bank);
  if(kind==='duplicate-key')f.put(BANK+'/bank.json','{"id":"a","id":"b"}');
  if(kind==='bad-number')f.put(BANK+'/bank.json','{"formatVersion":1e9999}');
  const before=f.get(BANK+'/bank.json');assert.throws(()=>packageFormat4(f.root,{upgrade:true}),e=>e.code==='INVALID_QUESTION_BANK'&&e.message.includes(kind==='nested-assets'?'/assets/':'bank.json')||kind==='wav'||kind==='collision');
  assert.deepEqual(f.get(BANK+'/bank.json'),before);assert.equal(f.json('quizforge-package.json').formatVersion,3);
});

test('batch upgrade: full backups, independent failures, example reporting and repeat stability',t=>{
  const f=fixture(t);f.put(BANK+'/.instance.json',{schemaVersion:1,id:'10000000-0000-4000-8000-000000000001'});
  f.put('question-banks/Group/Bad/bank.json',{...f.bank,unknown:'NO-PAYLOAD-IN-REPORT'});
  const before=f.get(BANK+'/bank.json'),report=upgradeLocalLibrary(f.root);
  assert.equal(report.successful.length,2);assert.equal(report.failed.length,1);assert.equal(report.affectedExtensions.length,1);
  const success=report.successful.find(r=>r.path===BANK+'/bank.json');
  assert.deepEqual(fs.readFileSync(path.join(success.backup,'bank.json')),before);
  assert.deepEqual(fs.readFileSync(path.join(success.backup,'.instance.json')),f.get(BANK+'/.instance.json'));
  assert.equal(JSON.stringify(report).includes('NO-PAYLOAD'),false);
  const after=f.get(BANK+'/bank.json'),again=upgradeLocalLibrary(f.root);assert.equal(again.skipped.length,2);assert.equal(again.successful.length,0);assert.deepEqual(f.get(BANK+'/bank.json'),after);
});

test('failure before publish keeps source byte-identical; source modified during backup is not overwritten',t=>{
  const f=fixture(t),before=f.get(BANK+'/bank.json');
  const report=upgradeLocalLibrary(f.root,{beforeReplace:()=>{throw Object.assign(new Error('SECRET'),{code:'EACCES'});}});
  assert.deepEqual(f.get(BANK+'/bank.json'),before);assert.equal(report.successful.length,0);assert.ok(report.failed.length>=2);assert.equal(JSON.stringify(report).includes('SECRET'),false);
  const changed=upgradeLocalLibrary(f.root,{beforeReplace:entity=>{if(entity.kind==='bank')f.put(BANK+'/bank.json',JSON.stringify({...f.bank,title:'External edit'}));}});
  assert.ok(changed.failed.some(r=>r.reason.includes('发生变化')));assert.equal(f.json(BANK+'/bank.json').title,'External edit');
});

test('central outline controls visibility, order, labels and separate same-name groups; all hidden questions validated',async()=>{
  const extension={id:'e',version:'1',referencePath:EXT,fingerprint:'f',outlineItemsDeclared:true},available=new Map([['path:'+EXT,extension]]);
  const raw={formatVersion:2,id:'10000000-0000-4000-8000-000000000001',extension:{path:EXT},questions:[{id:'a',title:'A',data:{n:1}},{id:'b',title:'B',data:{n:2}},{id:'hidden',title:'Hidden',data:{n:3}}],outline:[{group:'Same',items:[{question:'b',label:'B'}]},{group:'Same',items:[{question:'a',parts:[{id:'p1',label:'P1'}]}]}]};
  const prepared=prepareCollection(raw,'bank',null,raw.id,available);
  const seen=[];const {collection}=await finishCollection({run:async(_e,r)=>{seen.push(...r.questions);return {valid:true};}},prepared);
  assert.deepEqual(collection.questions.map(q=>q.id),['b','a']);assert.equal(collection.hiddenQuestionCount,1);assert.equal(seen.length,3);assert.equal(collection.questions[1].outlineGroupIndex,1);
  for(const outline of [[{items:[{question:'missing'}]}],[{items:[{question:'a'},{question:'a'}]}],[]])assert.throws(()=>prepareCollection({...raw,outline},'bank',null,raw.id,available));
});

test('Python reference differential: all output structures and non-JSON bytes match except UUIDs',async t=>{
  const reference=process.env.QF_FORMAT4_REFERENCE;
  if(!reference){t.skip('Set QF_FORMAT4_REFERENCE to the read-only V2 tools/qbank-upgrade/upgrade.py');return;}
  const f=fixture(t);f.put(BANK+'/media/a.mp3',Buffer.from('ID3audio'));f.bank.listening={materials:[{id:'a',title:'A',file:'media/a.mp3'}]};f.put(BANK+'/bank.json',f.bank);
  const archive=new LibraryArchive(f.root,new ResourceStore(f.root)),input=path.join(base,path.basename(f.root)+'-input.qbank'),output=input+'-python.qbank';await archive.zip(f.root,input);
  const run=spawnSync('python',['-B',reference,input,output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const python=path.join(base,path.basename(f.root)+'-python');fs.mkdirSync(python);await archive.unzip(output,python);
  packageFormat4(f.root,{upgrade:true});
  const actual=new FormatFiles(f.root),expected=new FormatFiles(python);
  assert.deepEqual([...actual.files.keys()].sort(),[...expected.files.keys()].sort());
  for(const name of actual.files.keys()){
    if(name===BANK+'/bank.json'||name===EXT+'/examples/bank.json'){const a=ordinary(actual.document(name)),b=ordinary(expected.document(name));delete a.id;delete b.id;assert.deepEqual(a,b,name);}
    else assert.deepEqual(actual.bytes(name),expected.bytes(name),name);
  }
});

test('permanent UUID: upgrade, edit, rename, repeated repack and import retain author identity; save-as creates new identity',async t=>{
  const f=await runtimeFixture(t),oldRow=f.library.index().banks[0],oldCollection=await f.library.collection('bank',oldRow.id);
  const oldKey=oldCollection.stateKey(),states=new StateStore(f.root,f.engine),q=oldCollection.questions[0];
  await states.act(oldCollection,q,{requestId:randomUUID(),revision:0,action:'draft',data:{answer:{selectedOptionId:q.data.correctOptionId}}});
  const result=await f.library.upgradeLocal();assert.equal(result.failed.length,0,JSON.stringify(result.failed));
  const raw=f.json(BANK+'/bank.json'),id=raw.id,row=f.library.index().banks[0],collection=await f.library.collection('bank',row.id);
  assert.equal(row.id,oldRow.id);assert.equal(collection.stateKey(),oldKey);
  assert.equal((await states.question(collection,collection.questions[0])).state.status,'draft');
  const edit=await f.library.prepareEdit(collection,collection.questions[0].id,'Edited title',collection.questions[0].data);
  fs.writeFileSync(edit.path,edit.after);f.library.invalidate();assert.equal(f.json(BANK+'/bank.json').id,id);
  await f.library.manage({kind:'bank',action:'update',target:'item',path:'Group/Bank',group:'Group',name:'Renamed'});
  assert.equal(f.json('question-banks/Group/Renamed/bank.json').id,id);
  for(let count=0;count<2;count++){
    const pack=await f.library.exportGroup('Group');
    const stage=path.join(f.root,'.temp','repack-'+count);fs.mkdirSync(stage);const archive=new LibraryArchive(f.root,f.library.resources);await archive.unzip(pack.file,stage);pack.close();
    packageFormat4(stage);assert.equal(JSON.parse(fs.readFileSync(path.join(stage,'question-banks/Group/Renamed/bank.json'))).id,id);
  }
  const copied=await f.library.createBank({name:'Copy',source:'Group/Renamed'});assert.notEqual(copied.uuid,id);assert.match(copied.uuid,/^[a-f0-9-]{36}$/);
  const fresh=await f.library.createBank({name:'New',extension:EXT});assert.notEqual(fresh.uuid,id);assert.notEqual(fresh.uuid,copied.uuid);
  const outline=f.library.readOutline('Group/Renamed'),reversed=[{group:'Reordered',items:[...outline.outline.flatMap(g=>g.items)].reverse()}];
  await f.library.saveOutline({path:'Group/Renamed',revision:outline.revision,outline:reversed});assert.equal(f.json('question-banks/Group/Renamed/bank.json').id,id);
  await assert.rejects(f.library.saveOutline({path:'Group/Renamed',revision:outline.revision,outline:reversed}),{code:'CONTENT_CONFLICT'});
});

test('legacy package auto-upgrades in isolation; repeated format-4 imports retain UUID but separate practice instances',async t=>{
  const f=await runtimeFixture(t),archive=new LibraryArchive(f.root,f.library.resources),input=path.join(base,path.basename(f.root)+'-legacy.qbank');
  await archive.zip(f.root,input);const bytes=fs.readFileSync(input),before=f.get(BANK+'/bank.json');
  const target=fs.mkdtempSync(path.join(base,'target-')),library=new Library(target,code,f.engine);t.after(()=>library.close());
  const imported=await library.importPackage(bytes,'Import.qbank');assert.equal(imported.upgradedFrom,3);assert.equal(imported.importedBanks,1);assert.deepEqual(f.get(BANK+'/bank.json'),before);
  const id=JSON.parse(fs.readFileSync(path.join(target,'question-banks/Import/Bank/bank.json'))).id;
  const output=await library.exportBank('Import/Bank');const format4=fs.readFileSync(output.file);output.close();
  const again=await library.importPackage(format4,'Another.qbank');assert.equal(again.upgradedFrom,null);assert.equal(again.scope,'bank');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target,'question-banks/Another/bank.json'))).id,id);
  const rows=library.index().banks;assert.equal(new Set(rows.map(r=>r.id)).size,2);
});


test('network URLs survive conversion, packaging, imports and frozen exam data without fetching',async t=>{
  const f=await runtimeFixture(t),url='https://media.example.test/stable.mp3?version=1';
  const raw=f.json(BANK+'/bank.json');raw.listening={materials:[{id:'a',title:'Audio',url}],examMaterialId:'a'};raw.questions[0].listening={materialId:'a'};f.put(BANK+'/bank.json',raw);
  const report=await f.library.upgradeLocal();assert.equal(report.failed.length,0);
  const authored=f.json(BANK+'/bank.json'),row=f.library.index().banks[0],collection=await f.library.collection('bank',row.id);
  assert.equal(authored.listening.materials[0].url,url);assert.equal(collection.listening.materials[0].url,url);
  const service=await QuizForgeServer.create({root:f.root,codeRoot:code,port:0,tailscale:{read:async()=>({state:'missing'})}});await service.start();t.after(()=>service.close());
  const origin='http://127.0.0.1:'+service.port(),uri='/api/collections/bank/'+row.id;
  assert.match((await fetch(origin+'/')).headers.get('content-security-policy'),/connect-src 'self' https:/);
  const response=await fetch(origin+uri+'/exams',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),durationMinutes:null})});
  const exam=await response.json();assert.equal(response.status,200,JSON.stringify(exam));
  const frozen=await (await fetch(origin+'/api/collections/exam/'+exam.id)).json();assert.equal(frozen.listening.materials[0].url,url);
  assert.deepEqual(frozen.outline,collection.outline);assert.deepEqual(frozen.questions.map(q=>q.outlineGroupIndex),collection.questions.map(q=>q.outlineGroupIndex));
  assert.equal((await fetch(origin+uri+'/listening/a')).status,422);
  const output=await f.library.exportBank('Group/Bank');let bytes;try{bytes=fs.readFileSync(output.file);}finally{output.close();}
  const result=await f.library.importPackage(bytes,'Network.qbank'),copy=f.json('question-banks/Network/bank.json');
  assert.equal(copy.id,authored.id);assert.equal(copy.listening.materials[0].url,url);assert.equal(result.upgradedFrom,null);
  assert.equal(fs.existsSync(path.join(f.root,'question-banks/Network/assets')),false);
  for (const bad of [{},{file:'assets/a.mp3',url},{url:'http://media.example.test/a.mp3'}]){
    const bank=f.json(BANK+'/bank.json');bank.listening.materials=[{id:'a',title:'A',...bad}];f.put(BANK+'/bank.json',bank);
    assert.throws(()=>new FormatFiles(f.root,[path.join(f.root,BANK)]).bank(BANK+'/bank.json',new Map([[EXT,f.json(EXT+'/manifest.json')]])));
  }
});


test('v0.8 server address audit: blocked common local hosts and documented unresolved limit/reserved/canonical differences',()=>{
  for(const url of ['http://media.example.test/a','https://user:pass@media.example.test/a','https://media.example.test/a#x','https://localhost/a','https://a.local/a','https://server/a','https://127.0.0.1/a','https://10.0.0.1/a','https://169.254.1.1/a','https://[::1]/a','https://[::ffff:127.0.0.1]/a'])assert.equal(networkSource(url),false,url);
  // Keep these mismatches explicit until author decides how to align the contract.
  for(const url of ['https://192.0.2.1/a','https://198.51.100.1/a','https://203.0.113.1/a','https://[2001:db8::1]/a','https://MEDIA.example.test:443/a','https://media.example.test/'+ 'a'.repeat(2050)])assert.equal(networkSource(url),true,url.slice(0,80));
});


test('failed staged-directory publish rolls back that leaf and continues upgrading other leaves',t=>{
  const f=fixture(t),before=f.get(BANK+'/bank.json'),rename=fs.renameSync;let injected=false;
  fs.renameSync=(from,to)=>{if(!injected&&to===path.join(f.root,BANK)&&from.includes('format4-upgrade-')){injected=true;throw Object.assign(new Error('Synthetic publish failure'),{code:'EACCES'});}return rename(from,to);};
  let report;try{report=upgradeLocalLibrary(f.root);}finally{fs.renameSync=rename;}
  assert.equal(injected,true);assert.deepEqual(f.get(BANK+'/bank.json'),before);assert.equal(report.failed.length,1);assert.equal(report.successful.length,1);assert.equal(f.json(EXT+'/examples/bank.json').formatVersion,2);
});
for(const mode of ['parts-and-separate-same-name-extensions','example-audio-and-numeric-tokens'])test('Python structural differential: '+mode,async t=>{
  const reference=process.env.QF_FORMAT4_REFERENCE;if(!reference){t.skip('Set QF_FORMAT4_REFERENCE');return;}
  const f=fixture(t);
  if(mode==='parts-and-separate-same-name-extensions'){
    const other='extensions/Group/Other';fs.cpSync(path.join(f.root,EXT),path.join(f.root,other),{recursive:true});
    const m=f.json(other+'/manifest.json');m.id='other';f.put(other+'/manifest.json',m);const example=f.json(other+'/examples/bank.json');example.extension={path:other};f.put(other+'/examples/bank.json',example);
    f.bank.questions[0].outline={level:'parts',items:[{id:'p1',label:'1'}]};f.bank.questions.push({id:'q2',title:'Two',extension:{path:other},data:{a:1}},{id:'q3',title:'Three',data:{a:2}});f.put(BANK+'/bank.json',f.bank);
  }else{
    const example=f.json(EXT+'/examples/bank.json');example.listening={materials:[{id:'a',title:'Example audio',file:'media/a.m4a'}]};f.put(EXT+'/examples/bank.json',JSON.stringify(example).replace('"test":1','"test":-0,"decimal":1.0,"big":9007199254740993'));f.put(EXT+'/examples/media/a.m4a',Buffer.from('0000ftypM4A'));
  }
  const archive=new LibraryArchive(f.root,new ResourceStore(f.root)),input=path.join(base,path.basename(f.root)+'-diff.qbank'),output=input+'.output';await archive.zip(f.root,input);
  const run=spawnSync('python',['-B',reference,input,output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);const expected=path.join(base,path.basename(f.root)+'-expected');fs.mkdirSync(expected);await archive.unzip(output,expected);packageFormat4(f.root,{upgrade:true});
  const actualFiles=new FormatFiles(f.root),expectedFiles=new FormatFiles(expected);assert.deepEqual([...actualFiles.files.keys()].sort(),[...expectedFiles.files.keys()].sort());
  for(const name of actualFiles.files.keys()){
    if(name.endsWith('/bank.json')){const a=actualFiles.document(name),b=expectedFiles.document(name);delete a.id;delete b.id;assert.equal(losslessBytes(a).toString(),losslessBytes(b).toString(),name);}else assert.deepEqual(actualFiles.bytes(name),expectedFiles.bytes(name),name);
  }
});


test('lossless parser consumes exactly one UTF-8 BOM and rejects a second',()=>{
  assert.deepEqual(ordinary(parseLossless(Buffer.from('\ufeff{"a":1}'),'synthetic.json')),{a:1});
  assert.throws(()=>parseLossless(Buffer.from('\ufeff\ufeff{"a":1}'),'synthetic.json'),{code:'INVALID_QUESTION_BANK'});
});


test('invalid directory discovery does not block valid leaves or hide the completed upgrade report',async t=>{
  const f=await runtimeFixture(t),row=f.library.index().banks[0],old=await f.library.collection('bank',row.id),key=old.stateKey();
  const states=new StateStore(f.root,f.engine);await states.act(old,old.questions[0],{requestId:randomUUID(),revision:0,action:'draft',data:{answer:{selectedOptionId:old.questions[0].data.correctOptionId}}});
  f.put('question-banks/Broken/Empty/unrecognized.txt','unknown');f.library.invalidate();
  const report=await f.library.upgradeLocal();assert.equal(report.successful.length,2);assert.equal(report.failed.length,1);assert.equal(report.catalogUnavailable,true);assert.ok(report.failed[0].path.includes('Broken/Empty'));
  // Move only this synthetic invalid folder outside the library, then recover.
  fs.renameSync(path.join(f.root,'question-banks/Broken'),path.join(f.root,'invalid-synthetic-folder'));f.library.invalidate();
  const current=await f.library.collection('bank',row.id);assert.equal(current.stateKey(),key);assert.equal((await states.question(current,current.questions[0])).state.status,'draft');
});
