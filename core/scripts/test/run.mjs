import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const core=fileURLToPath(new URL('../../',import.meta.url));
const scope=process.argv[2]||'all';
if(!['all','host','perf'].includes(scope))throw new Error('Unknown test scope');
const collect=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.name==='fixtures'?[]:entry.isDirectory()?collect(path.join(directory,entry.name)):/\.test\.(mjs|cjs)$/.test(entry.name)?[path.join(directory,entry.name)]:[]);
const performance=path.join(core,'test','performance');
const tests=(scope==='perf'?collect(performance):[...(scope==='all'?collect(path.join(core,'test')).filter(file=>!file.startsWith(performance+path.sep)):[]),...collect(path.join(core,'server','host')),...(scope==='all'?fs.readdirSync(path.join(core,'server')).filter(name=>name.endsWith('.test.cjs')).map(name=>path.join(core,'server',name)):[])]).sort();
if(!tests.length)throw new Error('No tests discovered');
const child=spawn(process.execPath,['--import',pathToFileURL(path.join(core,'scripts','test','test-environment.mjs')).href,'--test','--test-concurrency='+ (process.env.QF_TEST_CONCURRENCY||4),...tests],{cwd:core,stdio:'inherit',windowsHide:true});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=code??1;if(signal)console.error('Test process ended: '+signal);});
