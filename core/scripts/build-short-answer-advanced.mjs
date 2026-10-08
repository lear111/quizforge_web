import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
// Keep prior extension packages and SDK versions immutable.
await build({entryPoints:[resolve(root,'extensions/short-answer-1.2.2/src/rules.js')],outfile:resolve(root,'extensions/short-answer-1.2.2/rules.js'),bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
