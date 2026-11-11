// Test-process-only diagnostics. Never imported by the application.
import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';

const key=Symbol.for('quizforge.b2a.diagnostics');
const access="globalThis[Symbol.for('quizforge.b2a.diagnostics')]";
export class LibraryDiagnostics {
  constructor() {this.context=new AsyncLocalStorage();this.sample=null;this.restores=[];this.transformed=[];}
  span(name,callback,root=false) {
    const parent=this.context.getStore();
    if(!parent&&(!root||!this.sample))return callback();
    const node={name,start:performance.now(),end:null,children:[],events:[]};
    (parent?parent.children:this.sample.roots).push(node);
    const end=()=>{node.end=performance.now();};
    return this.context.run(node,()=>{
      try {const value=callback();if(value&&typeof value.then==='function')return value.then(result=>{end();return result;},error=>{end();throw error;});end();return value;}
      catch(error){end();throw error;}
    });
  }
  event(value){this.context.getStore()?.events.push(value);}
  fileHash(file,callback){return this.span('file.sha256',()=>{this.event({kind:'rehash',file:String(file)});return callback();});}
  method(type,name,label=type.name+'.'+name,root=false){
    const original=type.prototype[name],diagnostics=this;
    if(typeof original!=='function')throw Error('Missing diagnostic target: '+label);
    type.prototype[name]=function(...args){return diagnostics.span(label,()=>original.apply(this,args),root);};
    this.restores.push(()=>{type.prototype[name]=original;});
  }
  install(coreRoot){
    globalThis[key]=this;
    const wrapExport=(source,name,label)=>{
      const before=`export function ${name}(`;
      if(source.split(before).length!==2)throw Error('Diagnostic source anchor changed: '+label);
      return source.replace(before,`function __b2a_${name}(`)+`\nexport const ${name}=(...args)=>${access}.span('${label}',()=>__b2a_${name}(...args));\n`;
    };
    const replace=(source,before,after)=>{if(source.split(before).length!==2)throw Error('Diagnostic source anchor is not unique: '+before);return source.replace(before,after);};
    const targets=new Map([
      [path.join(coreRoot,'server/host/platform/files.js'),source=>{for(const name of ['walkEntries','walkFiles','readBytes','readJson','safeFile','checkedStat'])source=wrapExport(source,name,'files.'+name);return source;}],
      [path.join(coreRoot,'server/host/extensions/extension-packages.js'),source=>wrapExport(source,'declaration','extension.declaration')],
      [path.join(coreRoot,'server/host/platform/file-cache.js'),source=>replace(source,'hash: hash(content)',`hash: ${access}.fileHash(file,()=>hash(content))`)],
      [path.join(coreRoot,'server/host/extensions/rule-engine.js'),source=>{
        source=replace(source,'const hashFile = async (file, checked = null) => {',`const hashFile = (file, checked = null) => ${access}.span('engine.hashFile',async()=>{`);
        source=replace(source,'return value;\n      };\n      files.push','return value;\n      });\n      files.push');
        return replace(source,"files.push(hash(readBytes(safeFile(path.join(this.codeRoot, 'server'), 'rules-runner.cjs'))));",`files.push(${access}.fileHash(path.join(this.codeRoot,'server','rules-runner.cjs'),()=>hash(readBytes(safeFile(path.join(this.codeRoot, 'server'), 'rules-runner.cjs')))));`);
      }],
      [path.join(coreRoot,'server/host/library/library.js'),source=>{
        source=replace(source,"const cached = this.loaded.get(kind + ':' + collectionId), scanned = this.indexer.cached?.snapshot.revision;",`const cached = ${access}.span('binding.readLookup',()=>this.loaded.get(kind + ':' + collectionId)), scanned = this.indexer.cached?.snapshot.revision;`);
        const start=source.indexOf('  async writeCollection('),end=source.indexOf('  async collection(',start);
        const part=replace(source.slice(start,end),"const cached = this.loaded.get(kind + ':' + collectionId);",`const cached = ${access}.span('binding.writeLookup',()=>this.loaded.get(kind + ':' + collectionId));`);
        return source.slice(0,start)+part+source.slice(end);
      }]
    ].map(([file,transform])=>[path.resolve(file),transform]));
    this.hook=registerHooks({load:(url,context,next)=>{
      const result=next(url,context);if(!url.startsWith('file:'))return result;
      const file=path.resolve(fileURLToPath(url)),transform=targets.get(file);if(!transform)return result;
      this.transformed.push(path.relative(coreRoot,file).replaceAll('\\','/'));
      const source=(Buffer.isBuffer(result.source)?result.source.toString('utf8'):String(result.source)).replaceAll('\r\n','\n');
      return {...result,source:transform(source)};
    }});
    for(const name of ['lstatSync','statSync','fstatSync','readdirSync','readFileSync','createReadStream']){
      const original=fs[name],diagnostics=this;
      fs[name]=function(file,...args){
        const node=diagnostics.context.getStore();if(!node)return original.call(this,file,...args);
        const start=performance.now();let value,error;
        try {value=original.call(this,file,...args);return value;}catch(caught){error=caught;throw caught;}
        finally {
          const event={kind:name,file:String(file),ms:performance.now()-start};
          if(name.endsWith('statSync'))event.type=error?'failed':value.isFile()?'file':value.isDirectory()?'directory':'other';
          if(error)event.error=error.code??error.name;node.events.push(event);
          if(name==='createReadStream'&&!error){
            // Streams in validationEnvironment are exactly the hashFile cache misses.
            if(this===fs&&node.name==='engine.hashFile')node.events.push({kind:'rehash',file:String(file)});
          }
        }
      };
      this.restores.push(()=>{fs[name]=original;});
    }
    const original=fs.realpathSync.native,diagnostics=this;
    fs.realpathSync.native=function(file,...args){const node=diagnostics.context.getStore();if(!node)return original.call(this,file,...args);const start=performance.now();try{return original.call(this,file,...args);}finally{node.events.push({kind:'realpath.native',file:String(file),ms:performance.now()-start});}};
    this.restores.push(()=>{fs.realpathSync.native=original;});
  }
  close(){for(const restore of this.restores.reverse())restore();this.hook?.deregister();delete globalThis[key];}
}

export function union(intervals){
  const sorted=intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((a,b)=>a[0]-b[0]);let total=0,start=0,end=0;
  for(const [a,b]of sorted){if(a>end){total+=end-start;start=a;end=b;}else end=Math.max(end,b);}return total+end-start;
}
export function flatten(roots){return roots.flatMap(node=>[node,...flatten(node.children)]);}
export function nodeMetrics(nodes){
  const events=nodes.flatMap(node=>[...node.events,...flatten(node.children).flatMap(child=>child.events)]),stats=events.filter(event=>/^(lstatSync|statSync|fstatSync)$/.test(event.kind));
  return {calls:nodes.length,ms:nodes.reduce((sum,node)=>sum+node.end-node.start,0),directories:new Set(events.filter(event=>event.kind==='readdirSync').map(event=>event.file)).size,
    directoryVisits:events.filter(event=>event.kind==='readdirSync').length,stats:stats.length,fileStats:stats.filter(event=>event.type==='file').length,directoryStats:stats.filter(event=>event.type==='directory').length,failedStats:stats.filter(event=>event.type==='failed').length,
    statMs:stats.reduce((sum,event)=>sum+event.ms,0),realpaths:events.filter(event=>event.kind==='realpath.native').length,realpathMs:events.filter(event=>event.kind==='realpath.native').reduce((sum,event)=>sum+event.ms,0),
    rehashCalls:events.filter(event=>event.kind==='rehash').length,rehashFiles:new Set(events.filter(event=>event.kind==='rehash').map(event=>event.file)).size};
}
