import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));
// Build only the legacy advanced regression fixture; active packages stay untouched.
await build({entryPoints:[resolve(root,'core/test/fixtures/legacy-extensions/short-answer-1.2.2/src/rules.js')],outfile:resolve(root,'core/test/fixtures/legacy-extensions/short-answer-1.2.2/rules.js'),bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'});
