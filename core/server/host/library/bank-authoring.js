import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApiError, bad, requireObject } from '../platform/errors.js';
import { folderName } from './library-management.js';
import { localManifests } from './library-upgrade.js';
import { FormatFiles, parseLossless, losslessBytes, ordinary, readCentralOutline, checkedCopy, fail } from './format4.js';
import { readBytes, replaceFile, exists, safeDirectory } from '../platform/files.js';
import { scanBanks } from './directories.js';

export class BankAuthoring {
  constructor(library) { this.library=library; this.root=library.root; }
  select(value) {
    const base=path.join(this.root,'question-banks'), target=this.library.management.resolve(base,value);
    const file=path.join(target,'bank.json');
    if (!scanBanks(base).banks.includes(file)) throw new ApiError(404,'BANK_NOT_FOUND','请选择题库文件夹');
    return {directory:target,file};
  }
  async create(request) {
    requireObject(request);
    if (Object.keys(request).some(key=>!['name','group','source','extension'].includes(key)) || typeof request.name!=='string' || typeof (request.group??'')!=='string' || Object.hasOwn(request,'source')===Object.hasOwn(request,'extension') || typeof (request.source??request.extension)!=='string' || !(request.source??request.extension)) throw bad('Invalid bank authoring request');
    const {name,group='',source,extension}=request; folderName(name);
    const base=path.join(this.root,'question-banks'); safeDirectory(base,true);
    const parent=group?this.library.management.resolve(base,group):base;
    if (group && !this.library.management.groups('bank').includes(parent)) fail('group','请选择现有分组');
    const destination=path.join(parent,name); if (exists(destination)) throw new ApiError(409,'BANK_NAME_CONFLICT','已有同名题库或分组');
    const {manifests}=localManifests(this.root);
    const workspace=fs.mkdtempSync(path.join(safeDirectory(path.join(this.root,'.temp'),true),'format4-author-'));
    const staging=path.join(workspace,'question-banks','New','Bank'); safeDirectory(staging,true);
    try {
      if (source) {
        const chosen=this.select(source); checkedCopy(chosen.directory,path.join(workspace,'copy'));
        fs.rmdirSync(staging); fs.renameSync(path.join(workspace,'copy'),staging);
      } else {
        if (!manifests.has(extension)) fail('extension','请选择有效拓展');
        const m=manifests.get(extension),example=path.join(this.root,extension,m.examples),directory=path.dirname(example);
        fs.copyFileSync(example,path.join(staging,'bank.json'));
        for (const kind of ['assets','media']) if (exists(path.join(directory,kind))) checkedCopy(path.join(directory,kind),path.join(staging,kind));
      }
      const file='question-banks/New/Bank/bank.json', raw=ordinary(parseLossless(readBytes(path.join(staging,'bank.json')),file));
      const converter=new FormatFiles(workspace);
      if (raw.formatVersion!==2) { converter.bank(file,manifests,{legacy:true}); converter.apply(); }
      const result=parseLossless(readBytes(path.join(staging,'bank.json')),file);
      result.id=randomUUID(); result.formatVersion=2; result.title=name;
      replaceFile(path.join(staging,'bank.json'),losslessBytes(result));
      // Copies are new author identities AND new local practice instances.
      replaceFile(path.join(staging,'.instance.json'),Buffer.from(JSON.stringify({schemaVersion:1,id:randomUUID()})+'\n'));
      new FormatFiles(workspace).bank(file,manifests);
      fs.renameSync(staging,destination); this.library.invalidate();
      return {path:path.relative(base,destination).replaceAll('\\','/'),uuid:result.id,catalog:this.library.index()};
    } finally { fs.rmSync(workspace,{recursive:true}); }
  }
  outline(value) {
    const selected=this.select(value),bytes=readBytes(selected.file,8*1024*1024),raw=ordinary(parseLossless(bytes,'bank.json'));
    if (raw.formatVersion!==2) throw new ApiError(422,'BANK_FORMAT_UPGRADE_REQUIRED','请先升级本地题库，再编辑集中大纲');
    return {...selected,bytes,raw};
  }
  readOutline(value) {
    const {bytes,raw}=this.outline(value);
    return {outline:raw.outline,questions:raw.questions.map(q=>({id:q.id,title:q.title})),revision:this.library.files.hash(this.select(value).file),uuid:raw.id};
  }
  async saveOutline(request) {
    requireObject(request);
    if(Object.keys(request).some(key=>!['path','revision','outline'].includes(key)) || typeof request.revision!=='string') throw bad('Invalid outline request');
    const {file,bytes,raw}=this.outline(request.path);
    if (this.library.files.hash(file)!==request.revision) throw new ApiError(409,'CONTENT_CONFLICT','题库已变化，请重新打开大纲');
    raw.outline=request.outline; const {manifests}=localManifests(this.root); readCentralOutline(raw,manifests);
    // Change only the top-level outline; retain all other numeric source tokens.
    const replacement=parseLossless(bytes,'bank.json'); replacement.outline=request.outline;
    const result=losslessBytes(replacement); if (result.length>8*1024*1024) fail('outline','题库超过 8 MiB');
    replaceFile(file,result); this.library.invalidate();
    return {uuid:raw.id,catalog:this.library.index()};
  }
}
