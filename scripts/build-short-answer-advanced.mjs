import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
// Keep released 1.0.0 / 1.1.0 extension packages and SDK versions immutable.
await build({entryPoints:[resolve(root,'extensions/short-answer-1.2.0/src/rules.js')],outfile:resolve(root,'extensions/short-answer-1.2.0/rules.js'),bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
