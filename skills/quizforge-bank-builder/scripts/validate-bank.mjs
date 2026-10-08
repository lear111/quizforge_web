#!/usr/bin/env node
// Read-only package validator. Uses project-owned AJV and the existing trusted rule runner.
// Never loads .state, installs dependencies, starts HTTP, or prints question materials.
import {lstat, readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';

const MiB=1024*1024, ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/, ASSET_ID=/^[a-f0-9]{64}$/;
const FIELDS=['entry','script','style','rules','questionSchema','answerSchema','examples'];
const API={major:1,minor:0,capabilities:new Set(['practice','editor','editor-drafts','score','manual-review','ai-grading','resources','richtext','navigation','lifecycle'])};
const STRUCTURAL_KEYS=new Set(['stem','referenceAnswer','rubric','document','content','attrs','marks','type','text','assetId','options','answer','feedback']);
const report={ok:false,summary:{questions:0,questionTypes:0,images:0,referencedImages:0,ruleBatches:0,exampleQuestions:0,exampleRuleBatches:0,maxScore:0},errors:[],warnings:[]};
class Invalid extends Error {constructor(location,code){super(code);this.location=location;this.code=code;}}
const fail=(location,code)=>{throw new Invalid(location,code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.hasOwn(value,key);
const ptr=value=>String(value).replace(/~/g,'~0').replace(/\//g,'~1');
function text(value,key,max,location,optional=false){
  if(optional&&!own(value,key))return '';
  if(typeof value[key]!=='string'||value[key].length>max||(!optional&&!value[key].trim()))fail(location+'/'+key,'INVALID_TEXT');
  return value[key];
}
function id(value,key,location){if(!object(value)||typeof value[key]!=='string'||!ID.test(value[key]))fail(location+'/'+key,'INVALID_STABLE_ID');return value[key];}
function reference(value,location){if(!object(value))fail(location,'INVALID_EXTENSION_REFERENCE');return {id:id(value,'id',location),version:id(value,'version',location)};}
const key=ref=>ref.id+'@'+ref.version;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

function apiRequirements(manifest,location){
  if(!own(manifest,'requiresApi'))return;
  const value=manifest.requiresApi,where=location+'/requiresApi';
  if(!object(value)||Object.keys(value).some(name=>!['major','minMinor','capabilities'].includes(name))||!Number.isInteger(value.major)||value.major<1||value.major>2147483647||!Number.isInteger(value.minMinor)||value.minMinor<0||value.minMinor>2147483647)fail(where,'INVALID_API_REQUIREMENT');
  if(value.major!==API.major||value.minMinor>API.minor)fail(where,'UNSUPPORTED_EXTENSION_API');
  const capabilities=own(value,'capabilities')?value.capabilities:[];
  if(!Array.isArray(capabilities)||capabilities.length>100)fail(where+'/capabilities','INVALID_API_REQUIREMENT');
  const seen=new Set();
  for(let i=0;i<capabilities.length;i++){
    const name=capabilities[i];
    if(typeof name!=='string'||!name.trim()||seen.has(name))fail(where+'/capabilities/'+i,'INVALID_API_REQUIREMENT');seen.add(name);
    if(!API.capabilities.has(name))fail(where+'/capabilities/'+i,'UNSUPPORTED_API_CAPABILITY');
  }
}

async function normalPath(value,location){
  const absolute=path.resolve(value),root=path.parse(absolute).root;
  let current=root;
  for(const part of absolute.slice(root.length).split(path.sep).filter(Boolean)){
    if(part.toLowerCase()==='.state')fail(location,'STATE_ACCESS_FORBIDDEN');
    current=path.join(current,part);
    let stat;try{stat=await lstat(current);}catch{fail(location,'PATH_UNAVAILABLE');}
    if(stat.isSymbolicLink())fail(location,'SYMLINK_FORBIDDEN');
  }
  return absolute;
}
async function optionalExists(value,location){
  try{const stat=await lstat(value);if(stat.isSymbolicLink())fail(location,'SYMLINK_FORBIDDEN');return true;}
  catch(error){if(error instanceof Invalid)throw error;if(error.code==='ENOENT')return false;fail(location,'PATH_UNAVAILABLE');}
}
async function runtimeRoot(project){
  const core=path.join(project,'core');
  if(!await optionalExists(core,'project/core'))return {directory:project,location:'project'};
  await normalPath(core,'project/core');
  if(!(await lstat(core)).isDirectory())fail('project/core','INVALID_CORE_DIRECTORY');
  return {directory:core,location:'project/core'};
}
async function safeFile(directory,relative,limit,location){
  if(typeof relative!=='string'||!relative.trim()||relative.length>240||path.isAbsolute(relative)||/[\\:\0]/.test(relative))fail(location,'UNSAFE_DECLARED_PATH');
  const resolved=path.resolve(directory,relative),inside=path.relative(directory,resolved);
  if(!inside||inside.startsWith('..'+path.sep)||inside==='..'||path.isAbsolute(inside))fail(location,'PATH_ESCAPES_PACKAGE');
  await normalPath(resolved,location);
  const stat=await lstat(resolved);if(!stat.isFile()||stat.size>limit)fail(location,'INVALID_FILE_OR_SIZE');
  return resolved;
}
function checkJsonTokens(source,location){
  let at=0;const ws=()=>{while(/\s/.test(source[at]??'')&&at<source.length)at++;};
  const string=()=>{const start=at++;while(at<source.length){const ch=source[at++];if(ch==='\\')at++;else if(ch==='"')break;}const value=JSON.parse(source.slice(start,at));if(value.length>2_000_000)fail(location,'JSON_STRING_LIMIT');return value;};
  const value=depth=>{
    ws();const ch=source[at];
    if(ch==='{'||ch==='['){
      if(depth>=64)fail(location,'JSON_DEPTH_LIMIT');const close=ch==='{'?'}':']';at++;ws();const names=new Set();
      if(source[at]===close){at++;return;}
      while(at<source.length){if(ch==='{'){const name=string();if(names.has(name))fail(location,'JSON_DUPLICATE_KEY');names.add(name);ws();at++;}value(depth+1);ws();if(source[at++]===close)return;ws();}
    }else if(ch==='"')string();
    else{const start=at;while(at<source.length&&!/[\s,\]}]/.test(source[at]))at++;const token=source.slice(start,at);if(/^[-0-9]/.test(token)&&token.length>100)fail(location,'JSON_NUMBER_LIMIT');}
  };
  value(0);
}
async function jsonFile(file,limit,location){
  await normalPath(file,location);const stat=await lstat(file);if(!stat.isFile()||stat.size>limit)fail(location,'INVALID_JSON_FILE_OR_SIZE');
  let source,value;try{source=(await readFile(file,'utf8')).replace(/^\uFEFF/,'');value=JSON.parse(source);}catch{fail(location,'MALFORMED_JSON');}
  checkJsonTokens(source,location);return value;
}
function imageMime(bytes){
  if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(12,16).toString()==='IHDR')return 'image/png';
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
  if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  if(bytes.length>=10&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return 'image/gif';
  return null;
}
async function images(directory,location){
  const assets=path.join(directory,'assets'),result=new Map();result.files=[];if(!await optionalExists(assets,location))return result;
  await normalPath(assets,location);if(!(await lstat(assets)).isDirectory())fail(location,'INVALID_ASSET_DIRECTORY');
  let entries=1;const visit=async folder=>{
    const names=(await readdir(folder)).sort();
    for(const name of names){
      if(++entries>1000)fail(location,'ASSET_ENTRY_LIMIT');const file=path.join(folder,name),label=location+'/'+path.relative(assets,file).split(path.sep).map(ptr).join('/');
      await normalPath(file,label);const stat=await lstat(file);
      if(stat.isDirectory()){await visit(file);continue;}
      if(!stat.isFile()||stat.size===0||stat.size>4*MiB)fail(label,'IMAGE_SIZE_LIMIT');
      const bytes=await readFile(file),mime=imageMime(bytes);if(!mime)fail(label,'IMAGE_TYPE_UNSUPPORTED');
      const hash=sha(bytes);const item={hash,mime,bytes:bytes.length,location:label,relative:path.relative(assets,file).split(path.sep).join('/')};
      result.files.push(item);
      if(result.has(hash))report.warnings.push({location:label,code:'DUPLICATE_IMAGE_BYTES'});else result.set(hash,item);
    }
  };await visit(assets);return result;
}
function collectReferences(value,location,result){
  if(object(value)){
    if(value.type==='image'&&object(value.attrs)&&own(value.attrs,'assetId')){
      if(typeof value.attrs.assetId!=='string'||!ASSET_ID.test(value.attrs.assetId))fail(location+'/attrs/assetId','INVALID_IMAGE_ASSET_ID');
      result.push({id:value.attrs.assetId,location:location+'/attrs/assetId'});
    }
    for(const [name,child]of Object.entries(value))collectReferences(child,location+'/'+(STRUCTURAL_KEYS.has(name)?ptr(name):'<field>'),result);
  }else if(Array.isArray(value))value.forEach((child,index)=>collectReferences(child,location+'/'+index,result));
}
async function extensionIndex(roots){
  const index=new Map();
  for(let origin=0;origin<roots.length;origin++){
    const root=roots[origin],label=origin?'staged-extensions':'project-extensions';await normalPath(root,label);
    if(!(await lstat(root)).isDirectory())fail(label,'INVALID_EXTENSION_DIRECTORY');const folders=(await readdir(root)).sort();let count=0;
    for(const folder of folders){
      const directory=path.join(root,folder),where=label+'/'+ptr(folder),stat=await lstat(directory);
      if(stat.isSymbolicLink())fail(where,'SYMLINK_FORBIDDEN');if(!stat.isDirectory())continue;if(++count>200)fail(label,'EXTENSION_COUNT_LIMIT');
      if(!await optionalExists(path.join(directory,'manifest.json'),where+'/manifest.json'))continue;
      let manifest;try{manifest=await jsonFile(path.join(directory,'manifest.json'),256*1024,where+'/manifest.json');if(!object(manifest))fail(where,'INVALID_MANIFEST');id(manifest,'id',where);id(manifest,'version',where);}catch(error){if(!(error instanceof Invalid))throw error;report.warnings.push({location:error.location,code:'INVALID_UNRELATED_MANIFEST'});continue;}
      const values=index.get(key(manifest))??[];values.push({directory,manifest,location:where});index.set(key(manifest),values);
    }
  }return index;
}
async function loadExtension(candidate,coreRoot){
  const {directory,manifest,location}=candidate;apiRequirements(manifest,location);const files={};text(manifest,'name',300,location);text(manifest,'description',4000,location,true);
  for(const field of FIELDS)files[field]=await safeFile(directory,text(manifest,field,240,location),field==='examples'?8*MiB:MiB,location+'/'+field);
  if(own(manifest,'dependencies')){
    if(!Array.isArray(manifest.dependencies)||manifest.dependencies.length>4)fail(location+'/dependencies','INVALID_SDK_DEPENDENCIES');const used=new Set();
    for(let i=0;i<manifest.dependencies.length;i++){
      const where=location+'/dependencies/'+i,dependency=reference(manifest.dependencies[i],where);
      if(Object.keys(manifest.dependencies[i]).length!==2||dependency.id!=='quizforge.richtext'||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(dependency.version)||used.has(dependency.id))fail(where,'INVALID_SDK_DEPENDENCY');used.add(dependency.id);
      const sdk=path.join(coreRoot,'shared','richtext',dependency.version);
      for(const file of ['richtext.js','richtext-editor.js','richtext.css'])await safeFile(sdk,file,MiB,where+'/'+file);
    }
  }
  const fingerprint=createHash('sha256');
  const add=async(relative,file)=>{const bytes=await readFile(file);fingerprint.update(relative+'\0'+bytes.length+'\0');fingerprint.update(bytes);};
  await add('manifest.json',path.join(directory,'manifest.json'));for(const field of FIELDS)await add(field+':'+manifest[field],files[field]);
  if(await optionalExists(path.join(directory,'editor.json'),location+'/editor.json')){
    const editor=await jsonFile(path.join(directory,'editor.json'),256*1024,location+'/editor.json');if(!object(editor))fail(location+'/editor.json','INVALID_EDITOR');await add('editor.json',path.join(directory,'editor.json'));
    for(const field of ['entry','script','style']){const relative=text(editor,field,240,location+'/editor.json'),file=await safeFile(directory,relative,MiB,location+'/editor.json/'+field);await add('editor:'+relative,file);}
  }
  const assets=await images(directory,location+'/assets');for(const image of assets.files.sort((a,b)=>a.relative.localeCompare(b.relative)))fingerprint.update(image.relative+'\0'+image.hash+'\0');
  await jsonFile(files.questionSchema,MiB,location+'/questionSchema');await jsonFile(files.answerSchema,MiB,location+'/answerSchema');
  // AJV compilation and validation happen only in the deadline-limited project runner.
  return {...candidate,files,assets,fingerprint:fingerprint.digest('hex')};
}
function runnerRequest(extension,operation,questions){return {op:operation,apiVersion:{major:API.major,minor:API.minor},questions,rules:extension.files.rules,questionSchema:extension.files.questionSchema,answerSchema:extension.files.answerSchema};}
async function runRules(coreRoot,extension,operation,questions){
  const runner=path.join(coreRoot,'server','rules-runner.cjs'),input=Buffer.from(JSON.stringify(runnerRequest(extension,operation,questions)));if(input.length>8*MiB)return {ok:false,code:'RULE_INPUT_LIMIT'};
  const args=['--max-old-space-size=96','--disable-proto=throw','--permission'];
  for(const file of [runner,path.join(coreRoot,'node_modules'),extension.files.rules,extension.files.questionSchema,extension.files.answerSchema])args.push('--allow-fs-read='+file);
  args.push(runner);const env={};
  for(const name of ['SYSTEMROOT','WINDIR','PATH','TEMP','TMP','COMSPEC','PATHEXT'])if(process.env[name]!==undefined)env[name]=process.env[name];
  return await new Promise(resolve=>{
    let done=false,output=[],size=0,stderrBytes=0;const child=spawn(process.execPath,args,{cwd:coreRoot,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
    const stop=code=>{child.kill();finish({ok:false,code});};
    const timer=setTimeout(()=>stop('RULE_TIMEOUT'),8000);
    child.on('error',()=>finish({ok:false,code:'RULE_UNAVAILABLE'}));child.stdin.on('error',()=>{});
    child.stdout.on('data',bytes=>{size+=bytes.length;if(size>2*MiB)stop('RULE_OUTPUT_LIMIT');else output.push(bytes);});
    child.stderr.on('data',bytes=>{stderrBytes+=bytes.length;if(stderrBytes>64*1024)stop('RULE_OUTPUT_LIMIT');});
    child.on('close',code=>{if(done)return;let result;try{result=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{return finish({ok:false,code:'RULE_INVALID_RESPONSE'});}
      if(code!==0||result?.ok!==true)return finish({ok:false,code:result?.code==='SCORE_UNAVAILABLE'?'SCORE_UNAVAILABLE':'RULE_REJECTED'});finish({ok:true,data:result.data});});
    child.stdin.end(input);
  });
}
function chunks(rows,operation){
  const output=[];let batch=[],size=0;
  for(const row of rows){const input=operation==='validateBank'?row.data:{data:row.data,state:{status:'unanswered',answer:null,result:null}},bytes=Buffer.byteLength(JSON.stringify(input))+1;
    if(batch.length&&(batch.length>=512||size+bytes>512*1024)){output.push(batch);batch=[];size=0;}batch.push({...row,input});size+=bytes;
  }if(batch.length)output.push(batch);return output;
}
async function ruleFailureLocation(coreRoot,extension,operation,batch,code){
  if(!['RULE_REJECTED','SCORE_UNAVAILABLE'].includes(code))return batch[0].location+'/data';
  let rows=batch;for(let attempts=0;attempts<9&&rows.length>1;attempts++){
    const middle=Math.ceil(rows.length/2),left=rows.slice(0,middle),result=await runRules(coreRoot,extension,operation,left.map(row=>row.input));
    if(!result.ok){rows=left;if(!['RULE_REJECTED','SCORE_UNAVAILABLE'].includes(result.code))break;}else rows=rows.slice(middle);
  }return rows[0].location+'/data';
}
function documentRows(document,location='',owner=null){
  if(!object(document))fail(location||'/','INVALID_BANK');
  if(own(document,'formatVersion')){
    if(!Number.isInteger(document.formatVersion)||document.formatVersion<1||document.formatVersion>2147483647)fail(location+'/formatVersion','INVALID_BANK_FORMAT');
    if(document.formatVersion!==1)fail(location+'/formatVersion','UNSUPPORTED_BANK_FORMAT');
  }
  const bankId=id(document,'id',location);text(document,'title',300,location);text(document,'description',4000,location,true);
  const fallback=own(document,'extension')?reference(document.extension,location+'/extension'):null;
  if(owner&&(bankId!=='examples'||!fallback||key(fallback)!==key(owner)))fail(location+'/extension','INVALID_EXAMPLE_BINDING');
  if(!Array.isArray(document.questions)||!document.questions.length||document.questions.length>10000)fail(location+'/questions','QUESTION_COUNT_LIMIT');
  const rows=[],groups=new Map(),seen=new Set();document.questions.forEach((question,index)=>{
    const where=location+'/questions/'+index;if(!object(question))fail(where,'INVALID_QUESTION');const qid=id(question,'id',where);if(seen.has(qid))fail(where+'/id','DUPLICATE_QUESTION_ID');seen.add(qid);text(question,'title',300,where);
    if(!own(question,'data'))fail(where+'/data','MISSING_QUESTION_DATA');const extension=own(question,'extension')?reference(question.extension,where+'/extension'):fallback;
    if(!extension)fail(where+'/extension','MISSING_EXTENSION_REFERENCE');if(owner&&key(extension)!==key(owner))fail(where+'/extension','INVALID_EXAMPLE_BINDING');
    const row={index,location:where,data:question.data,extension};rows.push(row);const values=groups.get(key(extension))??[];values.push(row);groups.set(key(extension),values);
  });return {fallback,rows,groups};
}
function checkImages(rows,loaded,bankAssets,usedBankAssets,usedExtensionAssets){
  for(const row of rows){
    const extension=loaded.get(key(row.extension)),references=[],questionImages=new Set();let imageBytes=0;collectReferences(row.data,row.location+'/data',references);
    for(const reference of references){
      const image=bankAssets.get(reference.id)??extension.assets.get(reference.id);if(!image)fail(reference.location,'IMAGE_REFERENCE_NOT_FOUND');
      if(!questionImages.has(reference.id)){questionImages.add(reference.id);imageBytes+=image.bytes;if(imageBytes>16*MiB)fail(row.location+'/data','QUESTION_IMAGE_TOTAL_LIMIT');}
      if(bankAssets.has(reference.id))usedBankAssets.add(reference.id);else{const used=usedExtensionAssets.get(key(row.extension))??new Set();used.add(reference.id);usedExtensionAssets.set(key(row.extension),used);}
    }
  }
}
async function checkRules(coreRoot,extension,items,examples=false){
  let maxScore=0;
  for(const operation of ['validateBank','scoreBatch'])for(const batch of chunks(items,operation)){
    report.summary[examples?'exampleRuleBatches':'ruleBatches']++;const result=await runRules(coreRoot,extension,operation,batch.map(row=>row.input));
    if(!result.ok)fail(await ruleFailureLocation(coreRoot,extension,operation,batch,result.code),result.code);
    if(operation==='validateBank'&&result.data?.valid!==true)fail(batch[0].location+'/data','RULE_INVALID_BATCH_RESPONSE');
    if(operation==='scoreBatch'){
      if(!Array.isArray(result.data?.scores)||result.data.scores.length!==batch.length)fail(batch[0].location+'/data','SCORE_INVALID_BATCH_RESPONSE');
      result.data.scores.forEach((score,index)=>{if(!object(score)||score.gradingStatus!=='unsubmitted'||score.score!==0||!Number.isFinite(score.maxScore)||score.maxScore<0)fail(batch[index].location+'/data','INVALID_INITIAL_SCORE');maxScore+=score.maxScore;});
    }
  }return maxScore;
}
async function validate(options){
  if(Number(process.versions.node.split('.')[0])!==24)fail('environment','NODE_24_REQUIRED');
  const project=await normalPath(options.project,'project'),runtime=await runtimeRoot(project),coreRoot=runtime.directory;
  await safeFile(coreRoot,'server/rules-runner.cjs',MiB,runtime.location+'/server/rules-runner.cjs');await safeFile(coreRoot,'package.json',MiB,runtime.location+'/package.json');
  let ajvEntry;try{ajvEntry=createRequire(path.join(coreRoot,'package.json')).resolve('ajv');}catch{fail(runtime.location+'/node_modules/ajv','PROJECT_AJV_UNAVAILABLE');}
  const nodeModules=path.join(coreRoot,'node_modules'),ajvRelative=path.relative(nodeModules,ajvEntry);
  if(ajvRelative==='..'||ajvRelative.startsWith('..'+path.sep)||path.isAbsolute(ajvRelative))fail(runtime.location+'/node_modules/ajv','PROJECT_AJV_UNAVAILABLE');
  await normalPath(ajvEntry,runtime.location+'/node_modules/ajv');
  let bankFile=await normalPath(options.bank,'bank');if((await lstat(bankFile)).isDirectory())bankFile=await safeFile(bankFile,'bank.json',8*MiB,'bank/bank.json');else if(path.basename(bankFile)!=='bank.json'&&!bankFile.endsWith('.json'))fail('bank','JSON_BANK_REQUIRED');
  const bank=await jsonFile(bankFile,8*MiB,'bank');report.summary.questions=Array.isArray(bank?.questions)?bank.questions.length:0;
  const {fallback,rows,groups}=documentRows(bank);report.summary.questionTypes=groups.size;
  const roots=[path.join(project,'extensions')];if(options.extensions)roots.push(await normalPath(options.extensions,'staged-extensions'));const index=await extensionIndex(roots),loaded=new Map();
  const required=new Set(groups.keys());if(fallback)required.add(key(fallback));for(const [identity,candidates]of index)if(candidates.length>1)required.add(identity);
  for(const identity of required){
    const candidates=index.get(identity);if(!candidates)fail(identity===key(fallback??{})?'/extension':'/questions/'+groups.get(identity)[0].index+'/extension','EXTENSION_NOT_FOUND');
    let first;for(const candidate of candidates){const current=await loadExtension(candidate,coreRoot);if(first&&first.fingerprint!==current.fingerprint)fail(current.location,'EXTENSION_VERSION_CONTENT_CONFLICT');first??=current;}loaded.set(identity,first);
  }
  const directoryBank=path.basename(bankFile)==='bank.json'&&path.dirname(bankFile)!==path.join(project,'question-banks');
  const bankAssets=directoryBank?await images(path.dirname(bankFile),'bank/assets'):new Map(),usedBankAssets=new Set(),usedExtensionAssets=new Map();report.summary.images=bankAssets.size;
  if(!directoryBank&&await optionalExists(path.join(path.dirname(bankFile),'assets'),'bank/assets'))report.warnings.push({location:'bank/assets',code:'FLAT_BANK_ASSETS_NOT_IMPORTED'});
  checkImages(rows,loaded,bankAssets,usedBankAssets,usedExtensionAssets);
  const boundExtensions=new Set(groups.keys());if(fallback)boundExtensions.add(key(fallback));
  const exampleGroups=new Map();
  for(const identity of [...boundExtensions].sort()){
    const extension=loaded.get(identity),where=extension.location+'/examples';const examples=await jsonFile(extension.files.examples,8*MiB,where);
    const exampleRows=documentRows(examples,where,extension.manifest).rows;report.summary.exampleQuestions+=exampleRows.length;
    checkImages(exampleRows,loaded,new Map(),new Set(),usedExtensionAssets);exampleGroups.set(identity,exampleRows);
  }
  // Reject every bound package/example declaration before executing any extension rules.
  for(const [identity,exampleRows]of exampleGroups)await checkRules(coreRoot,loaded.get(identity),exampleRows,true);
  for(const image of bankAssets.values())if(!usedBankAssets.has(image.hash))report.warnings.push({location:image.location,code:'UNREFERENCED_BANK_IMAGE'});
  for(const identity of boundExtensions)for(const image of loaded.get(identity).assets.values())if(!usedExtensionAssets.get(identity)?.has(image.hash))report.warnings.push({location:image.location,code:'UNREFERENCED_EXTENSION_IMAGE'});
  report.summary.referencedImages=new Set([...usedBankAssets,...[...usedExtensionAssets.values()].flatMap(ids=>[...ids])]).size;
  for(const identity of [...groups.keys()].sort())report.summary.maxScore+=await checkRules(coreRoot,loaded.get(identity),groups.get(identity));
  if(!Number.isFinite(report.summary.maxScore))fail('/questions','TOTAL_SCORE_NOT_FINITE');report.ok=true;
}
function argumentsFor(args){
  if(args.length===1&&args[0]==='--help'){console.log('Usage: node validate-bank.mjs --project <quizforge_web product root> --bank <bank folder or JSON file> [--extensions <staged extensions folder>]\nRead-only. Runtime/AJV/SDK come from core/ when present; legacy flat fixtures are supported only without core/. Requires project-installed AJV and Node 24. Exit: 0 valid, 1 invalid, 2 usage/environment.');return null;}
  const options={};for(let i=0;i<args.length;i+=2){const flag=args[i],name=flag?.slice(2);if(!['--project','--bank','--extensions'].includes(flag)||!args[i+1]||own(options,name))fail('arguments','INVALID_ARGUMENTS');options[name]=args[i+1];}
  if(!options.project||!options.bank)fail('arguments','PROJECT_AND_BANK_REQUIRED');return options;
}
try{const options=argumentsFor(process.argv.slice(2));if(options){await validate(options);console.log(JSON.stringify(report,null,2));}}
catch(error){const invalid=error instanceof Invalid?error:new Invalid('validator','VALIDATION_UNAVAILABLE');report.errors.push({location:invalid.location,code:invalid.code});console.log(JSON.stringify(report,null,2));process.exitCode=['arguments','environment'].includes(invalid.location)||invalid.code==='PROJECT_AJV_UNAVAILABLE'?2:1;}
