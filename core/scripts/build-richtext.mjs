import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readFile,writeFile,access} from 'node:fs/promises';
const version=process.argv[2]==='--version'?process.argv[3]:null;
if(process.argv.length!==4||!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version||''))throw new Error('Specify a new component release: npm run build:richtext -- --version <version>');
const root=fileURLToPath(new URL('..',import.meta.url)),shared=resolve(root,'shared/richtext',version);
for(const file of ['richtext.js','richtext-editor.js','THIRD_PARTY_NOTICES.md']){
  try{await access(resolve(shared,file));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  throw new Error(`Published component ${version} cannot be rebuilt; create a new version directory with src/ and richtext.css.`);
}
const options={bundle:true,format:'iife',platform:'browser',target:['es2022'],minify:true,legalComments:'eof'};
await build({...options,entryPoints:[resolve(shared,'src/static.js')],outfile:resolve(shared,'richtext.js')});
await build({...options,entryPoints:[resolve(shared,'src/editor.js')],outfile:resolve(shared,'richtext-editor.js')});
const licenses=[];
for(const [name,file] of [
  ['Tiptap','node_modules/@tiptap/core/LICENSE.md'],['Tiptap PM and third-party dependencies','node_modules/@tiptap/pm/THIRD_PARTY_LICENSES.md'],
  ['ProseMirror model','node_modules/prosemirror-model/LICENSE'],['ProseMirror state','node_modules/prosemirror-state/LICENSE'],['ProseMirror view','node_modules/prosemirror-view/LICENSE'],
  ['ProseMirror transform','node_modules/prosemirror-transform/LICENSE'],['ProseMirror commands','node_modules/prosemirror-commands/LICENSE'],['ProseMirror history','node_modules/prosemirror-history/LICENSE'],
  ['ProseMirror keymap','node_modules/prosemirror-keymap/LICENSE'],['ProseMirror input rules','node_modules/prosemirror-inputrules/LICENSE'],['ProseMirror schema list','node_modules/prosemirror-schema-list/LICENSE'],
  ['ProseMirror gap cursor','node_modules/prosemirror-gapcursor/LICENSE'],['ProseMirror drop cursor','node_modules/prosemirror-dropcursor/LICENSE'],['orderedmap','node_modules/orderedmap/LICENSE'],
  ['w3c-keyname','node_modules/w3c-keyname/LICENSE'],['rope-sequence','node_modules/rope-sequence/LICENSE']]) {
  licenses.push(`## ${name}\n\n${await readFile(resolve(root,file),'utf8')}`);
}
await writeFile(resolve(shared,'THIRD_PARTY_NOTICES.md'),`# Bundled rich-text dependencies\n\nOfficial Tiptap 3.31.4 and ProseMirror. Rebuilt from locally installed, version-locked npm packages.\n\n${licenses.join('\n\n')}`);
