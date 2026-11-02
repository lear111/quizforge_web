import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FormatFiles, readManifests, parseLossless, ordinary, losslessBytes, checkedCopy, fail } from './format4.js';
import { readBytes, replaceFile, exists, safeDirectory, within, walkFiles, checkPath } from '../platform/files.js';

const relative = (root,file) => path.relative(root,file).replaceAll('\\','/');
// Path + fixed messages only. Never include data, answers, JSON excerpts or arbitrary
// filesystem exception text in the downloadable report.
export function upgradeFailure(error) { return error?.code === 'INVALID_QUESTION_BANK' ? error.message : `文件操作失败（${/^[A-Z_0-9]+$/.test(error?.code ?? '') ? error.code : 'IO_ERROR'}）`; }
export function discoverUpgradeLibrary(root) {
  const banks=[],extensions=[],failed=[];
  const reject=(file,reason)=>failed.push({path:relative(root,file),reason});
  function visit(directory,kind,depth) {
    try {
      checkPath(directory,{directory:true});
      const marker=path.join(directory,kind==='bank'?'bank.json':'manifest.json');
      if(depth>0 && (exists(marker) || kind==='extension'&&exists(path.join(directory,'development.json')))) {
        const rows=kind==='bank'?banks:extensions;
        if(rows.length>=(kind==='bank'?1000:200)) { reject(directory,'实体数量超过升级上限');return; }
        rows.push(kind==='bank'?marker:directory);return;
      }
      if(depth>=2){reject(directory,'实体文件夹缺少 bank.json 或 manifest.json，不猜测用途');return;}
      const names=fs.readdirSync(directory).sort();
      if(names.length>2000){reject(directory,'目录中的条目超过升级上限');return;}
      for(const name of names) {
        const file=path.join(directory,name);
        try {
          const stat=fs.lstatSync(file);
          if(stat.isSymbolicLink()){reject(file,'不升级链接或重解析目录');continue;}
          if(stat.isDirectory())visit(file,kind,depth+1);
          else if(kind==='bank'&&name.endsWith('.json')&&!name.startsWith('.'))banks.push(file);
        } catch(error) { reject(file,upgradeFailure(error)); }
      }
    }catch(error){reject(directory,upgradeFailure(error));}
  }
  for(const [name,kind] of [['question-banks','bank'],['extensions','extension']])if(exists(path.join(root,name)))visit(path.join(root,name),kind,0);
  return{banks,extensions,failed};
}
export function localManifests(root, directories = discoverUpgradeLibrary(root).extensions) {
  const manifests = new Map(), errors = new Map();
  for (const directory of directories) {
    const key=relative(root,directory);
    try { for (const entry of readManifests(new FormatFiles(root,[directory]),[key])) manifests.set(...entry); }
    catch(error) { errors.set(key,upgradeFailure(error)); }
  }
  return {manifests,errors};
}
function cleanup(directory) {
  // Only generated workspaces are removed. The full backup remains outside .temp.
  checkPath(directory,{directory:true});
  for (const file of walkFiles(directory,30000)) { if (!within(directory,file)) throw new Error('Unsafe cleanup'); checkPath(file); }
  fs.rmSync(directory,{recursive:true});
}

export function upgradeLocalLibrary(root,{beforeReplace = () => {},identities = new Map()} = {}) {
  root=path.resolve(root);
  const runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const backupRoot=path.join(root,'.backups','qbank-format4',runId);
  safeDirectory(backupRoot,true);
  const report={schemaVersion:1,startedAt:new Date().toISOString(),backupDirectory:backupRoot,reportFile:path.join(backupRoot,'report.json'),successful:[],skipped:[],failed:[],affectedExtensions:[],warnings:['示例升级改变拓展审核摘要；V2 必须重新审核受影响拓展。备份包含原题库及原资源，本报告不含题目正文与答案。']};
  const discovered=discoverUpgradeLibrary(root);
  report.failed.push(...discovered.failed);
  const {manifests,errors}=localManifests(root,discovered.extensions);
  // Discovery does not use the catalog/extension engine, so a malformed JSON in
  // one leaf does not prevent unrelated leaves from upgrading.
  const entities=discovered.banks.map(file=>({file,directory:path.dirname(file),kind:'bank'}));
  for (const directory of discovered.extensions) {
    const key=relative(root,directory),manifest=manifests.get(key);
    entities.push({directory,file:manifest?path.join(directory,manifest.examples):null,kind:'extension',owner:key});
  }
  const persist=()=>replaceFile(report.reportFile,Buffer.from(JSON.stringify(report,null,2)+'\n'));
  persist();
  for (const entity of entities) {
    const location=entity.file?relative(root,entity.file):entity.owner+'/manifest.json';
    let workspace,original,published=false;
    try {
      if (!entity.file) fail(location,errors.get(entity.owner) ?? '拓展声明无效');
      if (path.basename(entity.file)!=='bank.json' && entity.kind==='bank') fail(location,'旧独立 JSON 不属于格式 3 题库文件夹，须手工整理');
      const raw=ordinary(parseLossless(readBytes(entity.file,8*1024*1024),location));
      if (raw.formatVersion===2) { new FormatFiles(root,[entity.directory]).bank(location,manifests,{exampleOwner:entity.owner}); report.skipped.push({path:location,reason:'已是题库文件格式 2',uuid:raw.id}); persist(); continue; }
      const entityPath=relative(root,entity.directory),backup=path.join(backupRoot,'original',entityPath);
      // Copy ALL original files, including host identity and non-content files.
      // Conversion may reject them, but the backup is complete and independent.
      safeDirectory(path.dirname(backup),true); checkedCopy(entity.directory,backup);
      workspace=fs.mkdtempSync(path.join(safeDirectory(path.join(root,'.temp'),true),'format4-upgrade-'));
      const staged=path.join(workspace,entityPath); safeDirectory(path.dirname(staged),true); checkedCopy(entity.directory,staged);
      const files=new FormatFiles(workspace),file=relative(root,entity.file);
      if (entity.kind==='bank') for (const name of files.files.keys()) {
        const rel=path.posix.relative(entityPath,name);
        if (!['bank.json','.instance.json'].includes(rel) && !/^(assets|media)\/[^/]+$/.test(rel)) fail(name,'题库内有未定义用途的文件，不能丢弃或猜测');
      }
      files.bank(file,manifests,{legacy:true,exampleOwner:entity.owner}); files.apply();
      const previous=identities.get(location);
      if (entity.kind==='bank' && previous && !exists(path.join(staged,'.instance.json'))) replaceFile(path.join(staged,'.instance.json'),Buffer.from(JSON.stringify({schemaVersion:1,id:randomUUID(),upgradeRoute:previous.route,upgradeStateKey:previous.stateKey})+'\n'));
      // A second, read-only validation sees the final paths before replacement.
      new FormatFiles(workspace).bank(file,manifests,{exampleOwner:entity.owner});
      beforeReplace(entity);
      // Never overwrite a changed source with a stale staged copy.
      const sourceFiles=new FormatFiles(root,[entity.directory]),backupFiles=new FormatFiles(path.join(backupRoot,'original'),[backup]);
      if (sourceFiles.files.size!==backupFiles.files.size || [...sourceFiles.files].some(([name])=>!backupFiles.files.has(name)||!sourceFiles.bytes(name).equals(backupFiles.bytes(name)))) fail(location,'备份后原文件发生变化，请关闭外部编辑后重试');
      original=path.join(workspace,'original');
      // Same-volume directory rename, rollback on any publish failure. The
      // journal plus complete backup cover interruption between the two renames.
      report.inProgress={path:entityPath,original,staged,backup}; persist();
      fs.renameSync(entity.directory,original);
      try { fs.renameSync(staged,entity.directory); }
      catch(error) { fs.renameSync(original,entity.directory); original=null; throw error; }
      published=true;
      const row={path:location,backup,uuid:files.report[entity.kind==='bank'?'banks':'examples'][0].uuid,movedAudio:files.report.movedAudio,rewrittenAudioReferences:files.report.rewrittenAudioReferences};
      report.successful.push(row);
      if (entity.owner) report.affectedExtensions.push({path:entity.owner,examples:location,requiresReview:true});
      delete report.inProgress; persist(); original=null;
    } catch(error) {
      if (original) { try {
        if (published && exists(entity.directory)) fs.renameSync(entity.directory,path.join(workspace,'rejected'));
        fs.renameSync(original,entity.directory); original=null;
        report.successful=report.successful.filter(row=>row.path!==location);
        report.affectedExtensions=report.affectedExtensions.filter(row=>row.path!==entity.owner);
      } catch { report.warnings.push('目录回滚失败，请保留 inProgress 指定的 original 和完整备份。'); } }
      report.failed.push({path:location,reason:upgradeFailure(error)}); if (!original) delete report.inProgress; persist();
    } finally { if (workspace && !original) cleanup(workspace); }
  }
  report.finishedAt=new Date().toISOString(); persist(); return report;
}
