import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
// Only build the new package; prior packages and shared richtext stay immutable.
await build({entryPoints:[resolve(root,'extensions/基础题型/short-answer-1.3.0/src/rules.js')],outfile:resolve(root,'extensions/基础题型/short-answer-1.3.0/rules.js'),bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
