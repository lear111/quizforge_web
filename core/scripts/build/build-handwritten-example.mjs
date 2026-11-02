import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LibraryArchive} from '../../server/host/library/library-archive.js';
import {ResourceStore} from '../../server/host/resources/resources.js';
import {upgradeLocalLibrary} from '../../server/host/library/library-upgrade.js';

const product=fileURLToPath(new URL('../../../',import.meta.url));
export function buildHandwrittenExample(output=path.join(product,'.temp','answer-area-delivery','手写答题示例.qbank')){
  const temporary=path.join(product,'.temp');fs.mkdirSync(temporary,{recursive:true});
  const stage=fs.mkdtempSync(path.join(temporary,'handwritten-example-'));
  try{
    const relative='extensions/手写答题示例/手写简答题',extension=path.join(stage,relative);
    fs.cpSync(path.join(product,'core/examples/handwritten-short-answer'),extension,{recursive:true});
    const raw=JSON.parse(fs.readFileSync(path.join(extension,'examples/bank.json'),'utf8'));raw.id='handwritten-answer-demo';raw.title='手写答题示例';
    const bank=path.join(stage,'question-banks/手写答题示例/手写答题示例');fs.mkdirSync(bank,{recursive:true});fs.writeFileSync(path.join(bank,'bank.json'),JSON.stringify(raw,null,2));
    const upgraded=upgradeLocalLibrary(stage);if(upgraded.failed.length)throw new Error('Example format-4 upgrade failed: '+JSON.stringify(upgraded.failed));
    return new LibraryArchive(stage,new ResourceStore(stage)).exportGroup('手写答题示例').then(pack=>{
      try{fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.copyFileSync(pack.file,output,fs.constants.COPYFILE_EXCL);return {file:path.resolve(output),formatVersion:4,questions:raw.questions.length};}finally{pack.close();}
    }).finally(()=>{if(path.dirname(stage)!==temporary)throw Error('Unexpected staging path');fs.rmSync(stage,{recursive:true,force:true});});
  }catch(error){if(path.dirname(stage)===temporary)fs.rmSync(stage,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildHandwrittenExample(process.argv[2])));
