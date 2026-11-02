// Format 4 / bank format 2. Reference: V2 design 06 v0.8 and qbank-upgrade v1.
// This module never executes extension code or accesses a network.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ApiError } from '../platform/errors.js';
import { networkSource } from '../resources/listening.js';
import { checkPath, readBytes, safeFile, walkFiles, within, replaceFile } from '../platform/files.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const QID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const MIB = 1024 * 1024;
export function fail(at, reason) { throw new ApiError(422, 'INVALID_QUESTION_BANK', `${at}：${reason}`); }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof NumericToken);
export function fields(value, at, allowed) {
  if (!object(value)) fail(at, '必须为对象');
  const unknown = Object.keys(value).filter(key => !allowed.includes(key)).sort();
  if (unknown.length) fail(`${at}.${unknown[0]}`, '没有已定义的转换规则，不能丢弃或猜测此字段');
  return value;
}
function text(value, at, max, plain = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(at, `须为非空字符串，最多 ${max} 个 UTF-16 单元`);
  if (plain && (value.trim() !== value || /[\x00-\x1f\x7f-\x9f<>]/.test(value))) fail(at, '必须为不含首尾空白、控制字符、尖括号的纯文本');
  return value;
}
function array(value, at, max) { if (!Array.isArray(value) || !value.length || value.length > max) fail(at, `须为 1～${max} 项数组`); return value; }
class NumericToken {
  constructor(literal) { this.literal = literal; }
  toJSON() { return JSON.rawJSON(this.literal); }
}
const number = value => value instanceof NumericToken ? Number(value.literal) : value;
function version(value, expected, at) {
  if (value instanceof NumericToken ? value.literal !== String(expected) : value !== expected) fail(at, `只支持显式整数 ${expected}`);
}

// A small JSON reader retains ALL number tokens (also within opaque data),
// detects duplicate keys before parsing, and reports locations without values.
export function parseLossless(bytes, at, limit = 8 * MIB) {
  if (bytes.length > limit) fail(at, 'JSON 超过大小上限');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { fail(at, '不是有效的 UTF-8 JSON'); }
  let cursor = 0;
  const invalid = () => fail(at, `不是有效的 JSON（字符位置 ${cursor}）`);
  const space = () => { while (/[\t\r\n ]/.test(source[cursor] ?? '\0')) cursor++; };
  function string() {
    const start = cursor++;
    while (cursor < source.length) {
      if (source[cursor] === '\\') { cursor += 2; continue; }
      if (source[cursor++] === '"') {
        let result; try { result = JSON.parse(source.slice(start, cursor)); } catch { invalid(); }
        if (result.length > 2_000_000 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(result)) fail(at, 'JSON 字符串过长或含无效 Unicode');
        return result;
      }
    }
    invalid();
  }
  function value(depth) {
    space(); const c = source[cursor];
    if (c === '"') return string();
    if (c === '{' || c === '[') {
      if (depth >= 64) fail(at, 'JSON 容器深度超过 64');
      const isObject = c === '{', result = isObject ? {} : [], end = isObject ? '}' : ']'; cursor++; space();
      if (source[cursor] === end) { cursor++; return result; }
      for (;;) {
        space(); let key;
        if (isObject) {
          if (source[cursor] !== '"') invalid(); key = string(); space();
          if (Object.hasOwn(result, key)) fail(at, 'JSON 存在重复键');
          if (source[cursor++] !== ':') invalid();
        }
        const child = value(depth + 1);
        if (isObject) Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true }); else result.push(child);
        space(); if (source[cursor] === end) { cursor++; return result; }
        if (source[cursor++] !== ',') invalid();
      }
    }
    for (const [literal, decoded] of [['true', true], ['false', false], ['null', null]]) if (source.startsWith(literal, cursor)) { cursor += literal.length; return decoded; }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(cursor));
    if (!match) invalid();
    const token = match[0]; if (token.length > 100 || !Number.isFinite(Number(token))) fail(at, 'JSON 数字过长或不是有限数值');
    cursor += token.length; return new NumericToken(token);
  }
  const result = value(0); space(); if (cursor !== source.length) invalid(); return result;
}
export function losslessBytes(value) { return Buffer.from(JSON.stringify(value) + '\n'); }
export const ordinary = value => JSON.parse(losslessBytes(value));

export function safeRelative(name, at = name) {
  if (typeof name !== 'string' || !name || name.length > 2000 || name.startsWith('/') || name.includes('\\')) fail(at, '非法相对路径');
  const parts = name.split('/');
  if (parts.length > 32 || parts.some(p => !p || p === '.' || p === '..' || /[ .]$|[<>:"|?*\x00-\x1f\x7f-\x9f]/.test(p) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p))) fail(at, '路径含禁用字符、空段、点段或保留名称');
  return name;
}
export function resourceType(file, bytes) {
  const ext = path.posix.extname(file).toLowerCase();
  const starts = signature => bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  const signatures = { '.png': starts([137,80,78,71,13,10,26,10]), '.jpg': starts([255,216,255]), '.jpeg': starts([255,216,255]), '.gif': /^(GIF87a|GIF89a)/.test(bytes.toString('ascii',0,6)), '.webp': bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP', '.mp3': starts([73,68,51]) || bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 224) === 224, '.m4a': bytes.toString('ascii',4,8) === 'ftyp' };
  if (!signatures[ext]) fail(file, '资源类型未启用，或扩展名与文件头不一致；不自动转码');
  const kind = ['.mp3','.m4a'].includes(ext) ? 'audio' : 'image';
  if (bytes.length > (kind === 'audio' ? 32 : 4) * MIB) fail(file, '超过该资源类型大小上限');
  return kind;
}
export function binding(value, manifests, at, exampleOwner = null) {
  fields(value, at, ['path','id']);
  if (typeof value.path !== 'string' || !manifests.has(value.path)) fail(at + '.path', '必须准确绑定现有拓展，不能按 ID/版本/名称猜测');
  if (Object.hasOwn(value,'id') && value.id !== manifests.get(value.path).id) fail(at + '.id', '与 manifest.id 不一致');
  if (exampleOwner && value.path !== exampleOwner) fail(at + '.path', '拓展示例必须绑定所属拓展自己');
  return value.path;
}
function parts(values, owner, at) {
  const api = owner.requiresApi ?? {};
  const major=api.major instanceof NumericToken?api.major.literal==='1':api.major===1;
  const minor=api.minMinor instanceof NumericToken?/^\d+$/.test(api.minMinor.literal):Number.isInteger(api.minMinor);
  if (!major || !minor || number(api.minMinor) < 1 || !Array.isArray(api.capabilities) || !api.capabilities.includes('outline-items')) fail(at, 'parts 需要拓展声明 API 1.1+ 的 outline-items');
  const seen = new Set();
  for (const [i,p] of array(values,at,100).entries()) {
    const pos = `${at}[${i}]`; fields(p,pos,['id','label']); text(p.id,pos+'.id',128,true); text(p.label,pos+'.label',80,true);
    if (seen.has(p.id)) fail(pos+'.id','小题 ID 重复'); seen.add(p.id);
  }
}
export function readCentralOutline(raw, manifests, at = 'bank.json') {
  const questions = new Map((raw.questions ?? []).map(q => [q.id,q])), seen = new Set(), ordered = [];
  for (const [g,group] of array(raw.outline,at+'.outline',10000).entries()) {
    const pos = `${at}.outline[${g}]`; fields(group,pos,['group','items']);
    if (Object.hasOwn(group,'group')) text(group.group,pos+'.group',80,true);
    for (const [i,item] of array(group.items,pos+'.items',10000).entries()) {
      const location = `${pos}.items[${i}]`; fields(item,location,['question','label','parts']);
      if (typeof item.question !== 'string' || !questions.has(item.question) || seen.has(item.question)) fail(location+'.question','引用不存在或重复的题目');
      if (Object.hasOwn(item,'label') && Object.hasOwn(item,'parts')) fail(location,'label 与 parts 不能同时存在');
      const q = questions.get(item.question), owner = manifests.get((q.extension ?? raw.extension)?.path);
      if (Object.hasOwn(item,'label')) text(item.label,location+'.label',80,true);
      if (Object.hasOwn(item,'parts')) parts(item.parts,owner ?? {},location+'.parts');
      seen.add(item.question); ordered.push({ question:q, item, group:group.group, groupIndex:g });
    }
  }
  return ordered;
}

export class FormatFiles {
  constructor(root, directories = [root]) {
    this.root = path.resolve(root); this.files = new Map(); this.replacements = new Map(); this.renames = new Map();
    this.report = { banks:[], examples:[], movedAudio:[], rewrittenAudioReferences:[], affectedExtensions:[], uuidRule:'random UUIDv4; persisted once' };
    const seen = new Set();
    for (const file of directories.flatMap(directory => walkFiles(directory, 30000))) {
      checkPath(file); if (!fs.statSync(file).isFile()) continue;
      const relative = path.relative(root,file).replaceAll('\\','/'); safeRelative(relative);
      if (this.files.size >= 30000) fail('目录','文件数量超过上限');
      if (seen.has(relative.toLowerCase())) fail(relative,'路径重复（忽略大小写）'); seen.add(relative.toLowerCase()); this.files.set(relative,file);
    }
  }
  bytes(file, limit = 32 * MIB) { if (!this.files.has(file)) fail(file,'缺少文件'); return readBytes(this.files.get(file),limit); }
  document(file, limit) { return parseLossless(this.bytes(file,limit),file,limit); }
  assets(root, legacy) {
    const result = new Map();
    for (const file of this.files.keys()) {
      if (!file.startsWith(root+'/')) continue;
      const relative = file.slice(root.length+1), pieces = relative.split('/');
      if (!['assets','media'].includes(pieces[0])) continue;
      if (pieces.length !== 2 || pieces[0] === 'media' && !legacy) fail(file,'资源必须平铺在 assets/');
      const bytes = this.bytes(file), kind = resourceType(file,bytes), target = root+'/assets/'+pieces[1], key = 'assets/'+pieces[1];
      if (pieces[0] === 'media') {
        if (kind !== 'audio') fail(file,'media/ 只迁移音频，不能猜测用途');
        if ([...this.files.keys()].some(entry => entry.toLowerCase() === target.toLowerCase())) fail(file,'迁移目标与 assets 文件重名，不能覆盖');
        this.renames.set(file,target); this.report.movedAudio.push({from:file,to:target});
      }
      if ([...result.keys()].some(entry => entry.toLowerCase() === key.toLowerCase())) fail(file,'迁移后资源路径重名');
      result.set(key,{kind,hash:createHash('sha256').update(bytes).digest('hex')});
    }
    return result;
  }
  bank(file, manifests, {legacy=false,exampleOwner=null} = {}) {
    const raw = this.document(file), root = path.posix.dirname(file);
    fields(raw,file,['formatVersion','id','version','title','description','extension','features','listening','questions',...(!legacy?['outline']:[])]);
    if (!legacy || Object.hasOwn(raw,'formatVersion')) version(raw.formatVersion,legacy?1:2,file+'.formatVersion');
    if (!legacy && (typeof raw.id !== 'string' || !UUID.test(raw.id))) fail(file+'.id','必须为小写 UUID');
    if (Object.hasOwn(raw,'title')) text(raw.title,file+'.title',300);
    if (Object.hasOwn(raw,'description') && (typeof raw.description !== 'string' || raw.description.length > 4000)) fail(file+'.description','须为最多 4000 UTF-16 单元的字符串');
    if (Object.hasOwn(raw,'features')) { fields(raw.features,file+'.features',['editing','whiteboard','history','exam']); if (Object.values(raw.features).some(v=>typeof v!=='boolean')) fail(file+'.features','开关必须为布尔值'); }
    const assets = this.assets(root,legacy), materialIds = new Set();
    if (Object.hasOwn(raw,'listening')) {
      fields(raw.listening,file+'.listening',['materials','examMaterialId']);
      for (const [i,row] of array(raw.listening.materials,file+'.listening.materials',50).entries()) {
        const at = `${file}.listening.materials[${i}]`; fields(row,at,['id','title','file','url']);
        if (typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(row.id) || materialIds.has(row.id)) fail(at+'.id','听力 ID 无效或重复');
        materialIds.add(row.id); text(row.title,at+'.title',160);
        if (Object.hasOwn(row,'file') === Object.hasOwn(row,'url')) fail(at,'file 与 url 必须二选一');
        if (Object.hasOwn(row,'url')) { if (!networkSource(row.url)) fail(at+'.url','无效的网络听力地址'); continue; }
        if (legacy && typeof row.file === 'string' && row.file.startsWith('media/')) {
          if (!this.renames.has(root+'/'+row.file)) fail(at+'.file','引用的 media 音频不存在');
          const next = 'assets/'+row.file.slice(6); this.report.rewrittenAudioReferences.push({location:at+'.file',from:row.file,to:next}); row.file=next;
        }
        if (!assets.has(row.file) || assets.get(row.file).kind !== 'audio') fail(at+'.file','必须引用本题库可识别的音频文件');
      }
      if (Object.hasOwn(raw.listening,'examMaterialId') && !materialIds.has(raw.listening.examMaterialId)) fail(file+'.listening.examMaterialId','引用未声明的材料');
    }
    const fallback = Object.hasOwn(raw,'extension') ? binding(raw.extension,manifests,file+'.extension',exampleOwner) : null;
    const seen = new Set(), used = new Set(fallback?[fallback]:[]), groups = []; let previous = null;
    const imageHashes = new Set([...assets.values()].filter(a=>a.kind==='image').map(a=>a.hash));
    for (const [i,q] of array(raw.questions,file+'.questions',10000).entries()) {
      const at = `${file}.questions[${i}]`; fields(q,at,['id','title','extension','listening','data',...(legacy?['outline']:[])]);
      if (typeof q.id !== 'string' || !QID.test(q.id) || seen.has(q.id)) fail(at+'.id','题目 ID 无效或重复'); seen.add(q.id); text(q.title,at+'.title',300);
      if (!Object.hasOwn(q,'data')) fail(at+'.data','缺少题目数据');
      const owner = Object.hasOwn(q,'extension') ? binding(q.extension,manifests,at+'.extension',exampleOwner) : fallback;
      if (!owner) fail(at+'.extension','缺少有效拓展绑定'); used.add(owner);
      if (Object.hasOwn(q,'listening')) { fields(q.listening,at+'.listening',['materialId']); if (!materialIds.has(q.listening.materialId)) fail(at+'.listening.materialId','引用未声明的材料'); }
      const pending = [[q.data,at+'.data']];
      while (pending.length) {
        const [v,pos] = pending.pop();
        if (!v || typeof v !== 'object' || v instanceof NumericToken) continue;
        if (v.type === 'image' && object(v.attrs) && Object.hasOwn(v.attrs,'assetId') && !imageHashes.has(v.attrs.assetId)) fail(pos+'.attrs.assetId','引用不存在的本题库图片');
        for (const [k,child] of Object.entries(v)) pending.push([child,Array.isArray(v)?`${pos}[${k}]`:pos+'.'+k]);
      }
      if (legacy) {
        const item = {question:q.id};
        if (Object.hasOwn(q,'outline')) {
          const o=q.outline; fields(o,at+'.outline',['level','label','items']);
          if (o.level === 'question') { fields(o,at+'.outline',['level','label']); item.label=text(o.label,at+'.outline.label',80,true); }
          else if (o.level === 'parts') { fields(o,at+'.outline',['level','items']); parts(o.items,manifests.get(owner),at+'.outline.items'); item.parts=o.items; }
          else fail(at+'.outline.level','只支持 question / parts');
          delete q.outline;
        }
        if (previous !== owner) { groups.push({group:text(manifests.get(owner).name,owner+'/manifest.json.name',80,true),items:[]}); previous=owner; }
        groups.at(-1).items.push(item);
      }
    }
    if (legacy) {
      raw.formatVersion=2; raw.id=randomUUID(); raw.outline=groups;
      const bytes=losslessBytes(raw); if (bytes.length>8*MIB) fail(file,'转换后的 JSON 超过 8 MiB'); this.replacements.set(file,bytes);
      this.report[exampleOwner?'examples':'banks'].push({path:file,uuid:raw.id,questions:raw.questions.length,outlineGroups:groups.length});
      if (exampleOwner) this.report.affectedExtensions.push(exampleOwner);
    } else readCentralOutline(raw,manifests,file);
    return {raw,used};
  }
  apply() {
    for (const [file,bytes] of this.replacements) replaceFile(path.join(this.root,file),bytes);
    for (const [from,to] of this.renames) { fs.mkdirSync(path.dirname(path.join(this.root,to)),{recursive:true}); fs.renameSync(path.join(this.root,from),path.join(this.root,to)); }
    for (const from of this.renames.keys()) { const directory=path.dirname(path.join(this.root,from)); if (fs.existsSync(directory) && !fs.readdirSync(directory).length) fs.rmdirSync(directory); }
  }
}

export function readManifests(files, roots) {
  const manifests = new Map();
  for (const root of roots) {
    const file=root+'/manifest.json', m=files.document(file,256*1024);
    fields(m,file,['id','version','name','description','requiresApi','requiresRichText','dependencies','entry','script','style','rules','questionSchema','answerSchema','examples','assets']);
    for (const key of ['id','version']) if (!QID.test(text(m[key],file+'.'+key,120))) fail(file+'.'+key,'无效拓展 ID/版本');
    text(m.name,file+'.name',300);
    for (const key of ['entry','script','style','rules','questionSchema','answerSchema','examples']) {
      text(m[key],file+'.'+key,240); const normalized=path.posix.normalize(m[key]);
      if (m[key].startsWith('/') || /[\\:\0]/.test(m[key]) || normalized==='..' || normalized.startsWith('../') || !files.files.has(root+'/'+normalized)) fail(file+'.'+key,'声明的相对文件不存在或越界');
    }
    if (!/^examples\/[A-Za-z0-9._/-]+\.json$/.test(m.examples) || m.examples.split('/').includes('..')) fail(file+'.examples','不支持的示例文件路径');
    for (const name of files.files.keys()) if (name.startsWith(root+'/') && fs.statSync(files.files.get(name)).size>(name.endsWith('/manifest.json')||name.endsWith('/editor.json')?256*1024:8*MIB)) fail(name,'超过拓展文件大小上限');
    manifests.set(root,m);
  }
  return manifests;
}

export function packageFormat4(staging,{upgrade=false}={}) {
  const files=new FormatFiles(staging), marker=files.document('quizforge-package.json',256*1024);
  fields(marker,'quizforge-package.json',['format','formatVersion','group','scope']);
  version(marker.formatVersion,upgrade?3:4,'quizforge-package.json.formatVersion');
  if (marker.format!=='quizforge-bank-group') fail('quizforge-package.json.format','不是题库包');
  text(marker.group,'quizforge-package.json.group',120); safeRelative(marker.group); if (marker.group.includes('/')) fail('quizforge-package.json.group','分组名称不能包含路径');
  if (marker.scope!==undefined && !['group','bank'].includes(marker.scope)) fail('quizforge-package.json.scope','只支持 group / bank');
  const banks=new Set(),extensions=new Set();
  for (const file of files.files.keys()) {
    if (file==='quizforge-package.json') continue;
    const pieces=file.split('/');
    if (pieces.some(p=>['.instance.json','.bundle.json','development.json'].includes(p.toLowerCase()))) fail(file,'包不能包含宿主身份或开发配置');
    if (!['question-banks','extensions'].includes(pieces[0]) || pieces[1]!==marker.group || pieces.length<4) fail(file,'必须位于清单声明的唯一分组及实体目录内');
    const root=pieces.slice(0,3).join('/'); (pieces[0]==='question-banks'?banks:extensions).add(root);
    if (pieces[0]==='question-banks' && !(pieces.length===4 && pieces[3]==='bank.json') && !(pieces.length===5 && (pieces[3]==='assets'||upgrade&&pieces[3]==='media'))) fail(file,'题库内只允许 bank.json 和平铺资源');
  }
  if (!banks.size || banks.size>1000 || !extensions.size || extensions.size>200) fail('ZIP','题库须为 1～1000 本，拓展须为 1～200 个');
  if (marker.scope==='bank' && banks.size!==1) fail('quizforge-package.json.scope','单题库包必须恰好一本题库');
  const manifests=readManifests(files,extensions), ids=new Set(),used=new Set();
  for (const root of banks) { const result=files.bank(root+'/bank.json',manifests,{legacy:upgrade}); for (const key of result.used) used.add(key); unique(result.raw.id,root+'/bank.json.id'); }
  if (marker.scope==='bank' && (used.size!==extensions.size || [...used].some(p=>!extensions.has(p)))) fail('quizforge-package.json.scope','单题库包含未被题库绑定的拓展');
  for (const [root,m] of manifests) { const result=files.bank(root+'/'+m.examples,manifests,{legacy:upgrade,exampleOwner:root}); unique(result.raw.id,root+'/'+m.examples+'.id'); }
  function unique(id,at) { if (ids.has(id)) fail(at,'包内 UUID 重复'); ids.add(id); }
  if (upgrade) { marker.formatVersion=4; files.replacements.set('quizforge-package.json',losslessBytes(marker)); files.apply(); }
  return files.report;
}

// Safe whole-leaf snapshots for local transactions; never follows junctions.
export function checkedCopy(source,destination) {
  checkPath(source,{directory:true});
  for (const file of walkFiles(source,30000)) { if (!within(source,file)) fail('目录','路径越界'); checkPath(file); }
  fs.cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
}
