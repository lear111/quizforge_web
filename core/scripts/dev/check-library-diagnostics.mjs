// Validate the diagnostic apparatus independently of application behaviour.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {LibraryDiagnostics,flatten,nodeMetrics,union} from './library-diagnostic-hooks.mjs';

const core=fileURLToPath(new URL('../../',import.meta.url)),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'qf-b2a-probe-'));
const originals=Object.fromEntries(['lstatSync','statSync','fstatSync','readdirSync','readFileSync','createReadStream'].map(name=>[name,fs[name]])),realpath=fs.realpathSync.native;
const diagnostics=new LibraryDiagnostics();let checks=0;
try{
  const file=path.join(temporary,'probe.txt'),content=Buffer.from('B2a synthetic probe');fs.writeFileSync(file,content);
  diagnostics.install(core);
  const {FileCache}=await import(pathToFileURL(path.join(core,'server/host/platform/file-cache.js')));diagnostics.method(FileCache,'entry');diagnostics.method(FileCache,'hash');
  const sample={roots:[]};diagnostics.sample=sample;
  const cache=new FileCache(),expected=crypto.createHash('sha256').update(content).digest('hex');
  await diagnostics.span('probe',async()=>{
    assert.equal(cache.hash(file),expected);checks++;
    assert.equal(cache.hash(file),expected);checks++;
    assert.equal(await diagnostics.span('engine.hashFile',async()=>{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}),expected);checks++;
    const marker={};assert.equal(diagnostics.span('identity',()=>marker),marker);checks++;
    await assert.rejects(diagnostics.span('reject',async()=>{throw Error('probe rejection');}),/probe rejection/);checks++;
  },true);
  const all=flatten(sample.roots),total=nodeMetrics(sample.roots),cached=nodeMetrics(all.filter(node=>node.name==='FileCache.hash'));
  assert.equal(total.rehashCalls,2);assert.equal(total.rehashFiles,1);checks++;
  assert.equal(cached.calls,2);assert.equal(cached.rehashCalls,1);checks++;
  assert.equal(nodeMetrics(all.filter(node=>node.name==='engine.hashFile')).rehashCalls,1);checks++;
  assert.ok(total.fileStats>0&&total.realpaths>0&&total.directories===0);checks++;
  assert.ok(all.every(node=>node.end!==null&&node.end>=node.start));checks++;
  assert.equal(union([[0,10],[2,5],[10,15]]),15);checks++;
  assert.ok(fs.readFileSync(file).equals(content));checks++;
}finally{
  diagnostics.sample=null;diagnostics.close();
  for(const [name,original]of Object.entries(originals))assert.equal(fs[name],original);assert.equal(fs.realpathSync.native,realpath);checks++;
  assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('qf-b2a-probe-'));fs.rmSync(temporary,{recursive:true,force:true});
}
console.log(JSON.stringify({checks,passed:checks,failed:0}));
